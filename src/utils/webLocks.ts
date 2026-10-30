/**
 * Named locks shared by every same-origin tab and frame (the Web Locks API),
 * so MyPack pages open side by side take turns. Where the API is missing
 * (tests, old browsers) they fall back to this context alone.
 */

function lockManager(): LockManager | null {
  try {
    return typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks
      : null;
  } catch {
    return null;
  }
}

/** Whether locks reach other tabs and frames, not just this context. */
export function hasWebLocks(): boolean {
  return lockManager() !== null;
}

const queues = new Map<string, Promise<unknown>>();
const held = new Map<string, number>();

function hold(name: string, delta: number) {
  const count = (held.get(name) ?? 0) + delta;
  if (count > 0) held.set(name, count);
  else held.delete(name);
}

/** Runs `work` once no other holder of `name` is running, then releases it. */
export function withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const locks = lockManager();
  if (locks) {
    return locks.request(name, work);
  }
  const run = async () => {
    hold(name, 1);
    try {
      return await work();
    } finally {
      hold(name, -1);
    }
  };
  const result = (queues.get(name) ?? Promise.resolve()).then(run, run);
  queues.set(
    name,
    result.catch(() => undefined),
  );
  return result;
}

/**
 * Runs `work` holding `name` if nobody holds it now; otherwise returns
 * `busy()` without waiting.
 */
export function tryLock<T>(
  name: string,
  work: () => Promise<T>,
  busy: () => T,
): Promise<T> {
  const locks = lockManager();
  if (locks) {
    return locks.request(name, { ifAvailable: true }, (lock) =>
      lock ? work() : busy(),
    );
  }
  if (held.has(name)) {
    return Promise.resolve(busy());
  }
  return withLock(name, work);
}

/**
 * Runs `work` alongside other shared holders of `name`; an exclusive
 * holder (see {@link withExclusiveLock}) waits for all of them.
 */
export function withSharedLock<T>(
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const locks = lockManager();
  if (!locks) {
    return work();
  }
  return locks.request(name, { mode: "shared" }, work);
}

/** Waits for every shared holder of `name` anywhere, then runs `work` alone. */
export function withExclusiveLock<T>(
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const locks = lockManager();
  if (!locks) {
    return work();
  }
  return locks.request(name, { mode: "exclusive" }, work);
}

/** Whether any tab or frame holds `name` right now. */
export async function isLockHeld(name: string): Promise<boolean> {
  const locks = lockManager();
  if (!locks) {
    return held.has(name);
  }
  const { held: holders = [] } = await locks.query();
  return holders.some((lock) => lock.name === name);
}
