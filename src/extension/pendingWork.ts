let inFlight = 0;
let idleWaiters: Array<() => void> = [];

/** Marks work an extension reload must not cut off, such as cart requests. */
export async function trackWork<T>(work: () => Promise<T>): Promise<T> {
  inFlight += 1;
  try {
    return await work();
  } finally {
    inFlight -= 1;
    if (inFlight === 0) {
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
