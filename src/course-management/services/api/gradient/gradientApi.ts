import { fetchWithTimeout } from "../../../../utils/fetchWithTimeout";

/**
 * Gradient (gradient.ncsu.edu) JSON API, called from the background worker with the
 * student's own NC State session. Kept free of storage/UI imports so the worker can load it.
 */
export const GRADIENT_ORIGIN = "https://gradient.ncsu.edu";

/** Where students sign in; Gradient redirects to NC State's Shibboleth from here. */
export const GRADIENT_SIGN_IN_URL = `${GRADIENT_ORIGIN}/`;

/** Message asking the background worker to make a Gradient request. */
export const GRADIENT_FETCH_MESSAGE = "gradientFetch";

/** The only paths the worker will request, so the message can't proxy anything else. */
export const GRADIENT_PATHS = [
  "/api/course-options",
  "/api/course-distributions",
] as const;

export type GradientPath = (typeof GRADIENT_PATHS)[number];

export type GradientFetchMessage = {
  type: typeof GRADIENT_FETCH_MESSAGE;
  path: GradientPath;
  params: Record<string, string>;
};

export type GradientFetchResponse =
  | { success: true; data: unknown }
  | {
      success: false;
      authRequired?: boolean;
      /** Gradient asked us to slow down (429/503). */
      rateLimited?: boolean;
      /** How long Gradient asked us to wait, from `Retry-After`. */
      retryAfterMs?: number;
      error?: string;
    };

/** `{ instructors, years, sems }` from `/api/course-options`. */
export type GradientCourseOptions = {
  instructors: { id: number; unity_id: string | null; name: string }[];
};

/** `{ raw, percentage }` per grade (A..F, S, U, IN, LA, AU, NR, W, TOTAL). */
export type GradientGradeCells = Record<string, { raw: number }>;

/** One row of `individual` from `/api/course-distributions`. */
export type GradientDistributionRow = {
  /** "CSC-316-051-2266": the last segment is the registrar term code. */
  courseId: string;
  instructorName: string;
  /** "Summer I '26" */
  courseSem: string;
  grades: GradientGradeCells;
};

export type GradientDistributions = { individual: GradientDistributionRow[] };

export function isGradientFetchMessage(
  message: unknown,
): message is GradientFetchMessage {
  if (!message || typeof message !== "object") return false;
  const { type, path, params } = message as Partial<GradientFetchMessage>;
  return (
    type === GRADIENT_FETCH_MESSAGE &&
    GRADIENT_PATHS.includes(path as GradientPath) &&
    !!params &&
    typeof params === "object" &&
    Object.values(params).every((value) => typeof value === "string")
  );
}

/**
 * Requests a Gradient API path with the browser's Gradient cookies. Signed-out requests are
 * redirected to the NC State login page, so a redirect off Gradient, an auth status or a
 * non-JSON answer all mean the student needs to sign in.
 */
export async function fetchGradientDirect(
  path: GradientPath,
  params: Record<string, string>,
): Promise<GradientFetchResponse> {
  const url = `${GRADIENT_ORIGIN}${path}?${new URLSearchParams(params)}`;
  try {
    const res = await fetchWithTimeout(url, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const leftGradient =
      res.redirected && !res.url.startsWith(`${GRADIENT_ORIGIN}/`);
    const isJson = (res.headers.get("content-type") ?? "").includes(
      "application/json",
    );
    if (
      leftGradient ||
      [401, 403, 419].includes(res.status) ||
      (res.ok && !isJson)
    ) {
      return { success: false, authRequired: true };
    }
    if (res.status === 429 || res.status === 503) {
      const retryAfterSeconds = Number(res.headers.get("retry-after"));
      return {
        success: false,
        rateLimited: true,
        retryAfterMs:
          retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : DEFAULT_RATE_LIMIT_PAUSE_MS,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status} ${res.statusText}` };
    }
    return { success: true, data: await res.json() };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/** Gradient requests in flight at once across every tab and frame. */
const MAX_CONCURRENT_REQUESTS = 4;
/** Pause after a 429/503 that didn't say how long to wait. */
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60 * 1000;
/** Cap on a server-sent `Retry-After`, so one odd header can't stall grades for hours. */
const MAX_RATE_LIMIT_PAUSE_MS = 10 * 60 * 1000;
/** Longest a request waits out a pause before giving up, so the page isn't left hanging. */
const MAX_RATE_LIMIT_WAIT_MS = 2 * 60 * 1000;
/** Sends per request, counting the first, before a 429/503 is handed back. */
const MAX_RATE_LIMIT_ATTEMPTS = 3;

let activeRequests = 0;
const waitingRequests: (() => void)[] = [];
let pausedUntil = 0;
let signedOutAt = 0;

function acquireRequestSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitingRequests.push(resolve));
}

/** Hands the slot straight to the next waiter so the limit is never overshot. */
function releaseRequestSlot(): void {
  const next = waitingRequests.shift();
  if (next) next();
  else activeRequests--;
}

function rateLimitedResponse(waitMs: number): GradientFetchResponse {
  return {
    success: false,
    rateLimited: true,
    retryAfterMs: waitMs,
    error: "Gradient asked to slow down",
  };
}

/**
 * `fetchGradientDirect` behind one worker-wide queue. Requests queued before a signed-out
 * answer are answered without going out (each would bounce through the NC State login).
 * A 429/503 pauses every request until Gradient's `Retry-After` passes; requests wait out
 * the pause and are sent again, up to `MAX_RATE_LIMIT_ATTEMPTS` sends each, and fail only
 * when the pause is longer than `MAX_RATE_LIMIT_WAIT_MS`.
 */
export async function fetchGradientQueued(
  path: GradientPath,
  params: Record<string, string>,
): Promise<GradientFetchResponse> {
  const queuedAt = Date.now();
  for (let attempt = 1; ; attempt++) {
    // Wait outside the queue so a paused request doesn't hold a slot.
    let waitMs = pausedUntil - Date.now();
    while (waitMs > 0) {
      if (waitMs > MAX_RATE_LIMIT_WAIT_MS) return rateLimitedResponse(waitMs);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      waitMs = pausedUntil - Date.now();
    }
    await acquireRequestSlot();
    let response: GradientFetchResponse;
    try {
      if (signedOutAt >= queuedAt) {
        return { success: false, authRequired: true };
      }
      // Another request may have been rate-limited while this one waited for a slot.
      if (Date.now() < pausedUntil) {
        attempt--;
        continue;
      }
      response = await fetchGradientDirect(path, params);
      if (!response.success) {
        if (response.authRequired) signedOutAt = Date.now();
        if (response.rateLimited) {
          pausedUntil = Math.max(
            pausedUntil,
            Date.now() +
              Math.min(
                response.retryAfterMs ?? DEFAULT_RATE_LIMIT_PAUSE_MS,
                MAX_RATE_LIMIT_PAUSE_MS,
              ),
          );
        }
      }
    } finally {
      releaseRequestSlot();
    }
    if (
      response.success ||
      !response.rateLimited ||
      attempt >= MAX_RATE_LIMIT_ATTEMPTS
    ) {
      return response;
    }
  }
}

/** Test hook: forget the queue, pause and signed-out state. */
export function resetGradientQueueForTests(): void {
  activeRequests = 0;
  waitingRequests.length = 0;
  pausedUntil = 0;
  signedOutAt = 0;
}
