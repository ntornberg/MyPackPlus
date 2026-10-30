import {
  generateCacheKey,
  getGenericCache,
  setGenericCache,
} from "../../../cache/courseRetrieval";

import {
  GRADIENT_FETCH_MESSAGE,
  type GradientCourseOptions,
  type GradientDistributions,
  type GradientFetchResponse,
  type GradientPath,
} from "./gradientApi";
import { setGradientAuthState } from "./gradientAuthState";

/** One section's grade counts, trimmed from Gradient's response (no chart blobs). */
export type GradientSection = {
  instructorName: string;
  /** "Summer I '26" */
  term: string;
  /** Registrar term code, e.g. "2266"; sorts chronologically. */
  termCode: string;
  /** Raw counts keyed by grade: A..F, S, U, W, TOTAL, ... */
  counts: Record<string, number>;
};

/** A course's whole Gradient history, every instructor and term. */
export type GradientCourse = {
  sections: GradientSection[];
  instructors: { name: string; unityId: string | null }[];
};

/** Thrown when Gradient needs the student to sign in with their NC State account. */
export class GradientAuthRequiredError extends Error {
  constructor() {
    super("Sign in to Gradient to load grade history");
    this.name = "GradientAuthRequiredError";
  }
}

const CACHE_CATEGORY = "gradientCourse";
// Bump when `GradientCourse` changes shape.
const GRADIENT_CACHE_VERSION = "v1";
/** History only changes once a term. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CONCURRENT_COURSES = 4;
/** After a signed-out answer, skip requests for this long instead of redirecting each one. */
const SIGNED_OUT_BACKOFF_MS = 60 * 1000;

let signedOutAt = 0;

/** Asks the background worker for a Gradient path (page CORS blocks it here). */
function requestGradient(
  path: GradientPath,
  params: Record<string, string>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: GRADIENT_FETCH_MESSAGE, path, params },
      (response: GradientFetchResponse | undefined) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response) {
          reject(new Error("Received null response from background fetch"));
          return;
        }
        if (!response.success) {
          if (response.authRequired) {
            signedOutAt = Date.now();
            setGradientAuthState("signedOut");
            reject(new GradientAuthRequiredError());
          } else {
            reject(new Error(`Gradient request failed: ${response.error}`));
          }
          return;
        }
        signedOutAt = 0;
        setGradientAuthState("ok");
        resolve(response.data);
      },
    );
  });
}

let activeCourses = 0;
const waitingCourses: (() => void)[] = [];

function acquireSlot(): Promise<void> {
  if (activeCourses < MAX_CONCURRENT_COURSES) {
    activeCourses++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitingCourses.push(resolve));
}

/** Hands the slot straight to the next waiter so the limit is never overshot. */
function releaseSlot(): void {
  const next = waitingCourses.shift();
  if (next) next();
  else activeCourses--;
}

export function toGradientCourse(
  options: GradientCourseOptions,
  distributions: GradientDistributions,
): GradientCourse {
  return {
    instructors: (options.instructors ?? []).map((instructor) => ({
      name: instructor.name,
      unityId: instructor.unity_id?.trim().toLowerCase() || null,
    })),
    sections: (distributions.individual ?? []).map((row) => ({
      instructorName: row.instructorName,
      term: row.courseSem,
      termCode: row.courseId.split("-").pop() ?? "",
      counts: Object.fromEntries(
        Object.entries(row.grades ?? {}).map(([grade, cell]) => [
          grade,
          Number(cell?.raw) || 0,
        ]),
      ),
    })),
  };
}

async function fetchGradientCourse(
  subject: string,
  course: string,
): Promise<GradientCourse> {
  if (signedOutAt && Date.now() - signedOutAt < SIGNED_OUT_BACKOFF_MS) {
    throw new GradientAuthRequiredError();
  }
  await acquireSlot();
  try {
    const params = { subject, course };
    // No filters: every term and instructor in one response.
    const [options, distributions] = await Promise.all([
      requestGradient("/api/course-options", params),
      requestGradient("/api/course-distributions", params),
    ]);
    return toGradientCourse(
      options as GradientCourseOptions,
      distributions as GradientDistributions,
    );
  } finally {
    releaseSlot();
  }
}

const inflightCourses = new Map<string, Promise<GradientCourse>>();

/**
 * A course's Gradient history (cached for a week), e.g. for "CSC 316". Throws
 * `GradientAuthRequiredError` when the student isn't signed in to Gradient.
 */
export function loadGradientCourse(courseKey: string): Promise<GradientCourse> {
  let request = inflightCourses.get(courseKey);
  if (!request) {
    request = loadUncached(courseKey).finally(() =>
      inflightCourses.delete(courseKey),
    );
    inflightCourses.set(courseKey, request);
  }
  return request;
}

async function loadUncached(courseKey: string): Promise<GradientCourse> {
  const [subject, course] = courseKey.split(" ");
  if (!subject || !course) return { sections: [], instructors: [] };
  const hash = await generateCacheKey(
    `gradient-${GRADIENT_CACHE_VERSION}-${courseKey}`,
  );
  const cached = await getGenericCache(CACHE_CATEGORY, hash);
  if (cached) {
    return JSON.parse(cached.combinedData) as GradientCourse;
  }
  const data = await fetchGradientCourse(subject, course);
  await setGenericCache(
    CACHE_CATEGORY,
    { [hash]: JSON.stringify(data) },
    CACHE_TTL_MS,
  );
  return data;
}

/** Lets the next request try Gradient again right away, e.g. after the student signs in. */
export function retryGradientSignIn(): void {
  signedOutAt = 0;
  setGradientAuthState("unknown");
}

/** Test hook: forget backoff and in-flight requests. */
export function resetGradientClientForTests(): void {
  signedOutAt = 0;
  activeCourses = 0;
  waitingCourses.length = 0;
  inflightCourses.clear();
  setGradientAuthState("unknown");
}
