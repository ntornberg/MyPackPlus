/** Long enough for a whole-subject registrar search, short enough to not look frozen. */
export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

/** Thrown when a request is aborted because it ran past its time limit. */
export class FetchTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(
      `Request to ${url.split("?")[0]} timed out after ${Math.round(timeoutMs / 1000)}s`,
    );
    this.name = "FetchTimeoutError";
  }
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * `fetch` that rejects with a FetchTimeoutError instead of waiting forever on
 * a stalled upstream. The limit covers downloading the body too: the returned
 * response is already buffered, so reading it can't hang.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // Buffer the body under the same timer so a slow stream also times out.
    const body = NULL_BODY_STATUSES.has(response.status)
      ? null
      : await response.arrayBuffer();
    const buffered = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    // A constructed Response loses these; callers use them to spot redirects.
    return Object.defineProperties(buffered, {
      url: { value: response.url },
      redirected: { value: response.redirected },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new FetchTimeoutError(url, timeoutMs);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}
