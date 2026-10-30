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
  | { success: false; authRequired?: boolean; error?: string };

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
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status} ${res.statusText}` };
    }
    return { success: true, data: await res.json() };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
