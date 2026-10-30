import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchGradientQueued, resetGradientQueueForTests } from "./gradientApi";

function jsonResponse(status = 200, headers: Record<string, string> = {}) {
  return new Response(status === 200 ? "{}" : null, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  resetGradientQueueForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const params = { subject: "CSC", course: "316" };

describe("fetchGradientQueued", () => {
  it("never has more than four requests in flight", async () => {
    let active = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return jsonResponse();
      }),
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        fetchGradientQueued("/api/course-options", params),
      ),
    );

    expect(results.every((result) => result.success)).toBe(true);
    expect(peak).toBe(4);
  });

  it("waits out Retry-After after a 429 and sends the request again", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { "retry-after": "30" }))
      .mockImplementation(async () => jsonResponse());
    vi.stubGlobal("fetch", fetchMock);

    const first = fetchGradientQueued("/api/course-options", params);
    await vi.advanceTimersByTimeAsync(0);
    // Sent during the pause: waits for it instead of failing or going out.
    const second = fetchGradientQueued("/api/course-distributions", params);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await first).toMatchObject({ success: true });
    expect(await second).toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after three rate-limited sends", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      jsonResponse(429, { "retry-after": "1" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchGradientQueued("/api/course-options", params);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toMatchObject({ success: false, rateLimited: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("fails right away when Gradient asks for a pause too long to wait out", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () =>
      jsonResponse(429, { "retry-after": "300" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await fetchGradientQueued("/api/course-options", params),
    ).toMatchObject({ success: false, rateLimited: true });
    expect(
      await fetchGradientQueued("/api/course-options", params),
    ).toMatchObject({ success: false, rateLimited: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers requests queued behind a signed-out response without sending them", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("<html>", { headers: { "content-type": "text/html" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        fetchGradientQueued("/api/course-options", params),
      ),
    );

    expect(
      results.every((result) => !result.success && result.authRequired),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
