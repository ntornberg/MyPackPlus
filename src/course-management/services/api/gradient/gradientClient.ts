import {
  generateCacheKey,
  getGenericCacheMany,
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
/**
 * Fetched courses are written together after this long: each write rewrites the whole
 * category in chrome.storage, so one write per course made big searches quadratic.
 */
const CACHE_WRITE_DELAY_MS = 2000;
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
  // The background worker queues these, so every tab shares one request limit.
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
}

const inflightCourses = new Map<string, Promise<GradientCourse>>();

/** Fetches a course once, however many callers ask for it at the same time. */
function fetchShared(courseKey: string): Promise<GradientCourse> {
  let request = inflightCourses.get(courseKey);
  if (!request) {
    const [subject = "", course = ""] = courseKey.split(" ");
    request = fetchGradientCourse(subject, course).finally(() =>
      inflightCourses.delete(courseKey),
    );
    inflightCourses.set(courseKey, request);
  }
  return request;
}

const pendingWrites: Record<string, string> = {};
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function queueCacheWrite(hash: string, course: GradientCourse): void {
  pendingWrites[hash] = JSON.stringify(course);
  writeTimer ??= setTimeout(
    () => void flushCacheWrites(),
    CACHE_WRITE_DELAY_MS,
  );
}

async function flushCacheWrites(): Promise<void> {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  const entries = { ...pendingWrites };
  for (const hash of Object.keys(entries)) delete pendingWrites[hash];
  if (Object.keys(entries).length === 0) return;
  try {
    await setGenericCache(CACHE_CATEGORY, entries, CACHE_TTL_MS);
  } catch {
    // Caching is best effort; the courses are fetched again next time.
  }
}

export type GradientCourses = {
  /** Keyed by the requested course, e.g. "CSC 316". Missing when its fetch failed. */
  courses: Map<string, GradientCourse>;
  /** Why some courses are missing, when any are. */
  failure?: unknown;
};

/** One course settling during `loadGradientCourses`, cached or fetched. */
export type GradientCourseProgress = {
  key: string;
  /** Missing when this course's fetch failed. */
  course?: GradientCourse;
  /** Courses settled so far, this one included. */
  done: number;
  total: number;
};

/**
 * Gradient history for each course (cached for a week), e.g. ["CSC 316", "MA 241"], with one
 * cache read for the batch. Courses that fail are left out and reported in `failure`; throws
 * only when every course fails, e.g. `GradientAuthRequiredError` when signed out.
 * `onCourse` hears about each course as it settles, so callers can show it before the rest.
 */
export async function loadGradientCourses(
  courseKeys: string[],
  onCourse?: (progress: GradientCourseProgress) => void,
): Promise<GradientCourses> {
  const keys = [...new Set(courseKeys)].filter((key) => {
    const [subject, course] = key.split(" ");
    return !!subject && !!course;
  });
  const courses = new Map<string, GradientCourse>();
  if (keys.length === 0) return { courses };

  const hashes = await Promise.all(
    keys.map((key) =>
      generateCacheKey(`gradient-${GRADIENT_CACHE_VERSION}-${key}`),
    ),
  );
  const cached = await getGenericCacheMany(CACHE_CATEGORY, hashes);
  let done = 0;
  const settle = (key: string, course?: GradientCourse) =>
    onCourse?.({ key, course, done: ++done, total: keys.length });
  const results = await Promise.allSettled(
    keys.map(async (key, index) => {
      const hash = hashes[index]!;
      const hit = cached[hash];
      if (hit) {
        try {
          const course = JSON.parse(hit.combinedData) as GradientCourse;
          settle(key, course);
          return course;
        } catch {
          // Refetch a malformed entry.
        }
      }
      try {
        const course = await fetchShared(key);
        queueCacheWrite(hash, course);
        settle(key, course);
        return course;
      } catch (error) {
        settle(key);
        throw error;
      }
    }),
  );
  await flushCacheWrites();

  let failure: unknown;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") courses.set(keys[index]!, result.value);
    else failure ??= result.reason;
  });
  if (courses.size === 0 && failure !== undefined) throw failure;
  return failure === undefined ? { courses } : { courses, failure };
}

/** Lets the next request try Gradient again right away, e.g. after the student signs in. */
export function retryGradientSignIn(): void {
  signedOutAt = 0;
  setGradientAuthState("unknown");
}

/** Test hook: forget backoff and in-flight requests. */
export function resetGradientClientForTests(): void {
  signedOutAt = 0;
  inflightCourses.clear();
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  for (const hash of Object.keys(pendingWrites)) delete pendingWrites[hash];
  setGradientAuthState("unknown");
}
