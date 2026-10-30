import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compareVersions,
  fetchStatusWorkerStatusDirect,
  isOutdated,
} from "./statusWorker";

afterEach(() => vi.unstubAllGlobals());

describe("compareVersions", () => {
  it("compares each part numerically", () => {
    expect(compareVersions("3.9.9", "3.10.0")).toBe(-1);
    expect(compareVersions("3.10.0", "3.9.9")).toBe(1);
    expect(compareVersions("3.9.9", "3.9.9")).toBe(0);
  });

  it("treats missing parts as zero", () => {
    expect(compareVersions("3.10", "3.10.0")).toBe(0);
    expect(compareVersions("4", "3.99.99")).toBe(1);
  });
});

describe("isOutdated", () => {
  it("flags only a running version older than the latest", () => {
    expect(isOutdated("3.9.9", "3.10.0")).toBe(true);
    expect(isOutdated("3.10.0", "3.10.0")).toBe(false);
    expect(isOutdated("3.11.0", "3.10.0")).toBe(false);
  });

  it("never flags when either version is missing or malformed", () => {
    expect(isOutdated("3.9.9", undefined)).toBe(false);
    expect(isOutdated("", "3.10.0")).toBe(false);
    expect(isOutdated("3.9.9", "v3.10")).toBe(false);
  });
});

describe("fetchStatusWorkerStatusDirect", () => {
  const base = {
    ok: true,
    level: "ok",
    message: "Up",
    updatedAt: "2026-10-29T00:00:00.000Z",
  };

  function stubResponse(body: unknown) {
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => ({ version: "3.9.9" }) },
    });
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(body));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("reads the release fields and sends the running version", async () => {
    const fetchMock = stubResponse({
      ...base,
      latestVersion: "3.10.0",
      releaseNotes: "Faster search",
    });

    const status = await fetchStatusWorkerStatusDirect();

    expect(status).toMatchObject({
      latestVersion: "3.10.0",
      releaseNotes: "Faster search",
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("version=3.9.9");
  });

  it("still accepts a worker that sends no release fields", async () => {
    stubResponse(base);

    const status = await fetchStatusWorkerStatusDirect();

    expect(status).toMatchObject({ level: "ok", message: "Up" });
    expect(status?.latestVersion).toBeUndefined();
  });
});
