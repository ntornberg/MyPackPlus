import { beforeEach, describe, expect, it, vi } from "vitest";

import { getGradientAuthState } from "./gradientAuthState";
import {
  GradientAuthRequiredError,
  loadGradientCourse,
  resetGradientClientForTests,
  retryGradientSignIn,
} from "./gradientClient";

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    generateCacheKey: vi.fn(async (value: string) => `hash:${value}`),
    getGenericCache: vi.fn(async (_category: string, hash: string) =>
      store.has(hash) ? { combinedData: store.get(hash)! } : null,
    ),
    setGenericCache: vi.fn(
      async (_category: string, entries: Record<string, string>) => {
        for (const [hash, value] of Object.entries(entries)) {
          store.set(hash, value);
        }
      },
    ),
  };
});

vi.mock("../../../cache/courseRetrieval", () => ({
  generateCacheKey: mocks.generateCacheKey,
  getGenericCache: mocks.getGenericCache,
  setGenericCache: mocks.setGenericCache,
}));

const options = {
  instructors: [{ id: 9361, unity_id: "JDBrock", name: "Brock,Janet Dean" }],
};
const distributions = {
  individual: [
    {
      courseName: "CSC 316 - Section 001",
      courseId: "CSC-316-001-2258",
      instructorName: "Brock,Janet Dean",
      courseSem: "Fall '25",
      grades: { A: { raw: 10, percentage: "50%" }, TOTAL: { raw: 20 } },
      googleChart: { rows: [] },
    },
  ],
};

type Handler = (message: {
  path: string;
  params: Record<string, string>;
}) => unknown;

function stubBackground(handler: Handler) {
  const sendMessage = vi.fn(
    (message: Parameters<Handler>[0], callback: (r: unknown) => void) => {
      queueMicrotask(() => callback(handler(message)));
    },
  );
  vi.stubGlobal("chrome", { runtime: { sendMessage, lastError: undefined } });
  return sendMessage;
}

beforeEach(() => {
  mocks.store.clear();
  vi.clearAllMocks();
  resetGradientClientForTests();
});

describe("loadGradientCourse", () => {
  it("loads options and distributions, trims them and caches the result", async () => {
    const send = stubBackground(({ path }) => ({
      success: true,
      data: path === "/api/course-options" ? options : distributions,
    }));

    const course = await loadGradientCourse("CSC 316");

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([m]) => m.params)).toEqual([
      { subject: "CSC", course: "316" },
      { subject: "CSC", course: "316" },
    ]);
    expect(course).toEqual({
      instructors: [{ name: "Brock,Janet Dean", unityId: "jdbrock" }],
      sections: [
        {
          instructorName: "Brock,Janet Dean",
          term: "Fall '25",
          termCode: "2258",
          counts: { A: 10, TOTAL: 20 },
        },
      ],
    });
    expect(getGradientAuthState()).toBe("ok");

    await loadGradientCourse("CSC 316");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    const send = stubBackground(({ path }) => ({
      success: true,
      data: path === "/api/course-options" ? options : distributions,
    }));

    const [a, b] = await Promise.all([
      loadGradientCourse("CSC 316"),
      loadGradientCourse("CSC 316"),
    ]);

    expect(a).toBe(b);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("asks for sign-in, backs off, and retries after the student returns", async () => {
    const send = stubBackground(() => ({
      success: false,
      authRequired: true,
    }));

    await expect(loadGradientCourse("CSC 316")).rejects.toBeInstanceOf(
      GradientAuthRequiredError,
    );
    expect(getGradientAuthState()).toBe("signedOut");
    expect(mocks.setGenericCache).not.toHaveBeenCalled();

    const calls = send.mock.calls.length;
    await expect(loadGradientCourse("MA 241")).rejects.toBeInstanceOf(
      GradientAuthRequiredError,
    );
    expect(send).toHaveBeenCalledTimes(calls);

    retryGradientSignIn();
    await expect(loadGradientCourse("MA 241")).rejects.toBeInstanceOf(
      GradientAuthRequiredError,
    );
    expect(send.mock.calls.length).toBeGreaterThan(calls);
  });
});
