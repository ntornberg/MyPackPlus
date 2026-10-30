import {
  hasWebLocks,
  withExclusiveLock,
  withSharedLock,
} from "../utils/webLocks";

let inFlight = 0;
let idleWaiters: Array<() => void> = [];

// While this page has cart work in flight it holds this lock shared; an
// update takes it exclusively, so it waits for work in every MyPack tab and
// frame, not just the one where Update now was clicked.
const CART_WORK_LOCK = "mypack-cart-work";
let releaseWorkLock: (() => void) | null = null;
let workLockGranted: Promise<void> | null = null;
let workLockHeld = false;

/** Takes the shared lock for this page's work; null when nothing to wait for. */
function holdWorkLock(): Promise<void> | null {
  if (workLockHeld || !hasWebLocks()) return null;
  workLockGranted ??= new Promise<void>((granted) => {
    void withSharedLock(
      CART_WORK_LOCK,
      () =>
        new Promise<void>((release) => {
          workLockHeld = true;
          releaseWorkLock = release;
          granted();
        }),
    );
  });
  return workLockGranted;
}

/** Marks work an extension reload must not cut off, such as cart requests. */
export async function trackWork<T>(work: () => Promise<T>): Promise<T> {
  inFlight += 1;
  try {
    const granted = holdWorkLock();
    if (granted) await granted;
    return await work();
  } finally {
    inFlight -= 1;
    if (inFlight === 0) {
      releaseWorkLock?.();
      releaseWorkLock = null;
      workLockGranted = null;
      workLockHeld = false;
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }
  }
}

export function waitForIdle(): Promise<void> {
  if (inFlight === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

/** Longest an update may hold cart work back if the reload never comes. */
const UPDATE_HOLD_MS = 10_000;

/**
 * Waits for cart work in every MyPack tab and frame, then runs `apply` while
 * no new work can start, so an update reload never cuts a swap in half.
 */
export function whenNoCartWork(apply: () => Promise<unknown>): Promise<void> {
  return withExclusiveLock(CART_WORK_LOCK, async () => {
    // With locks, holding this already means every page's work is done; work
    // started since waits behind it, so waiting for it here would deadlock.
    if (!hasWebLocks()) await waitForIdle();
    await Promise.race([
      apply().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, UPDATE_HOLD_MS)),
    ]);
  });
}
