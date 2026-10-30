import { beforeEach, describe, expect, it, vi } from "vitest";

import { getGradientAuthState } from "./gradientAuthState";
import {
  GradientAuthRequiredError,
  loadGradientCourses,
  resetGradientClientForTests,
  retryGradientSignIn,
} from "./gradientClient";

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    generateCacheKey: vi.fn(async (value: string) => `hash:${value}`),
    getGenericCacheMany: vi.fn(async (_category: string, hashes: string[]) =>
      Object.fromEntries(
        hashes
          .filter((hash) => store.has(hash))
          .map((hash) => [hash, { combinedData: store.get(hash)! }]),
      ),
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
  getGenericCacheMany: mocks.getGenericCacheMany,
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

/** One course through the batch API, rejecting with its failure. */
async function loadOne(key: string) {
  const { courses } = await loadGradientCourses([key]);
  return courses.get(key);
}

describe("loadGradientCourses", () => {
  it("loads options and distributions, trims them and caches the result", async () => {
    const send = stubBackground(({ path }) => ({
      success: true,
      data: path === "/api/course-options" ? options : distributions,
    }));

    const course = await loadOne("CSC 316");

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

    await loadOne("CSC 316");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    const send = stubBackground(({ path }) => ({
      success: true,
      data: path === "/api/course-options" ? options : distributions,
    }));

    const [a, b] = await Promise.all([loadOne("CSC 316"), loadOne("CSC 316")]);

    expect(a).toBe(b);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("asks for sign-in, backs off, and retries after the student returns", async () => {
    const send = stubBackground(() => ({
      success: false,
      authRequired: true,
    }));

    await expect(loadOne("CSC 316")).rejects.toBeInstanceOf(
      GradientAuthRequiredError,
    );
    expect(getGradientAuthState()).toBe("signedOut");
    expect(mocks.setGenericCache).not.toHaveBeenCalled();

    const calls = send.mock.calls.length;
    await expect(loadOne("MA 241")).rejects.toBeInstanceOf(
      GradientAuthRequiredError,
    );
    expect(send).toHaveBeenCalledTimes(calls);

    retryGradientSignIn();
    await expect(loadOne("MA 241")).rejects.toBeInstanceOf(
      GradientAuthRequiredError,
    );
    expect(send.mock.calls.length).toBeGreaterThan(calls);
  });

  it("reads the cache once and writes fetched courses together", async () => {
    const send = stubBackground(({ path }) => ({
      success: true,
      data: path === "/api/course-options" ? options : distributions,
    }));

    const { courses } = await loadGradientCourses(["CSC 316", "MA 241"]);

    expect([...courses.keys()]).toEqual(["CSC 316", "MA 241"]);
    expect(send).toHaveBeenCalledTimes(4);
    expect(mocks.getGenericCacheMany).toHaveBeenCalledTimes(1);
    expect(mocks.setGenericCache).toHaveBeenCalledTimes(1);
    expect(Object.keys(mocks.setGenericCache.mock.calls[0]![1])).toHaveLength(
      2,
    );
  });

  it("keeps the courses that loaded when others fail", async () => {
    stubBackground(({ path, params }) =>
      params.subject === "MA"
        ? { success: false, rateLimited: true, error: "HTTP 429" }
        : {
            success: true,
            data: path === "/api/course-options" ? options : distributions,
          },
    );

    const { courses, failure } = await loadGradientCourses([
      "CSC 316",
      "MA 241",
    ]);

    expect([...courses.keys()]).toEqual(["CSC 316"]);
    expect(failure).toBeInstanceOf(Error);
    expect(Object.keys(mocks.setGenericCache.mock.calls[0]![1])).toEqual([
      "hash:gradient-v1-CSC 316",
    ]);
  });

  it("reports each course as it settles, cached, fetched or failed", async () => {
    mocks.store.set(
      "hash:gradient-v1-ST 311",
      JSON.stringify({ sections: [], instructors: [] }),
    );
    stubBackground(({ path, params }) =>
      params.subject === "MA"
        ? { success: false, error: "HTTP 500" }
        : {
            success: true,
            data: path === "/api/course-options" ? options : distributions,
          },
    );
    const onCourse = vi.fn();

    await loadGradientCourses(["ST 311", "CSC 316", "MA 241"], onCourse);

    const updates = onCourse.mock.calls.map(([update]) => update);
    expect(updates[0]).toMatchObject({ key: "ST 311", done: 1, total: 3 });
    expect(updates.map(({ done }) => done)).toEqual([1, 2, 3]);
    expect(updates.find(({ key }) => key === "CSC 316")?.course).toBeDefined();
    expect(updates.find(({ key }) => key === "MA 241")?.course).toBeUndefined();
  });
});
