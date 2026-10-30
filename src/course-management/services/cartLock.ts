import { tryLock } from "../../utils/webLocks";
import type { ModifiedSection } from "../types/section";
import { normalizeCourseCode } from "../utils/cartCourses";

import { termIdOf } from "./myPackSession";

/** Held by one cart change to a course; passed to the steps it runs. */
export type CourseLock = { key: string };

export const COURSE_BUSY_MESSAGE =
  "Another change to this course is still in progress. Wait for it to finish, then try again.";

/** "2271|PY 205": one course in one term. */
export function courseLockKey(
  term: string | null | undefined,
  code: string | null | undefined,
): string | null {
  const strm = termIdOf(term);
  const course = code ? normalizeCourseCode(code) : null;
  return strm && course ? `${strm}|${course}` : null;
}

export function courseLockKeyOf(section: ModifiedSection): string | null {
  return courseLockKey(section.term, section.courseData?.code);
}

export const courseLockName = (key: string) => `mypack-cart-course:${key}`;

/**
 * Runs one cart change to a course while no other tab or frame is changing
 * it: a second change would act on a cart the first is still rewriting.
 * Steps of a change that already holds the course (`held`) run directly.
 */
export function withCourseLock<T>(
  key: string | null,
  held: CourseLock | undefined,
  work: (lock: CourseLock | undefined) => Promise<T>,
  busy: () => T,
): Promise<T> {
  if (!key || held?.key === key) {
    return work(held);
  }
  const lock = { key };
  return tryLock(courseLockName(key), () => work(lock), busy);
}
