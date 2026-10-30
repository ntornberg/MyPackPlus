import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FetchTimeoutError, fetchWithTimeout } from "./fetchWithTimeout";

/** A fetch that never settles until its signal aborts, like a stalled server. */
function hangingFetch(_url: string, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("Aborted", "AbortError")),
    );
  });
}

describe("fetchWithTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns the response when the server answers in time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 201 })),
    );
    const response = await fetchWithTimeout("https://example.test/a", {}, 1000);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("ok");
  });

  it("rejects with a FetchTimeoutError when the server stalls", async () => {
    vi.stubGlobal("fetch", vi.fn(hangingFetch));
    const request = fetchWithTimeout("https://example.test/a?q=1", {}, 1000);
    const assertion = expect(request).rejects.toThrow(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    await expect(request).rejects.toThrow(
      "Request to https://example.test/a timed out after 1s",
    );
  });

  it("times out a body that stops streaming", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            init?.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("Aborted", "AbortError")),
            );
          },
        });
        return new Response(body);
      }),
    );
    const request = fetchWithTimeout("https://example.test/a", {}, 1000);
    const assertion = expect(request).rejects.toThrow(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("passes network errors through unchanged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(fetchWithTimeout("https://example.test/a")).rejects.toThrow(
      new TypeError("Failed to fetch"),
    );
  });

  it("handles responses that have no body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const response = await fetchWithTimeout("https://example.test/a");
    expect(response.status).toBe(204);
  });
});
