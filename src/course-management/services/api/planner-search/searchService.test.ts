import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseHTMLContent: vi.fn(),
}));

vi.mock("../../../../utils/course-search/parseRegistrarUtil", () => ({
  parseHTMLContent: mocks.parseHTMLContent,
  formCourseURL: vi.fn(() => "form-data"),
}));

import {
  batchSearchOpenCourses,
  parseRegistrarSearch,
  searchOpenCoursesByParams,
} from "./searchService";

const WORKER_URL = "https://cloudflareworker.nicktornberg12.workers.dev/";
const REGISTRAR_URL = "https://webappprd.acs.ncsu.edu/php/coursecat/search.php";

type FetchResult = { success: boolean; data?: string; error?: string };

/** Stubs the background search: fetches each URL's response, then parses it. */
function stubBackground(responses: Record<string, FetchResult>) {
  const sendMessage = vi.fn(
    (message: { url: string }, callback: (response: unknown) => void) => {
      const { data, ...result } = responses[message.url]!;
      callback(
        result.success
          ? { ...result, courses: parseRegistrarSearch(data!) }
          : result,
      );
    },
  );
  vi.stubGlobal("chrome", { runtime: { sendMessage, lastError: undefined } });
  return sendMessage;
}

const sentUrls = (sendMessage: ReturnType<typeof stubBackground>) =>
  sendMessage.mock.calls.map(([message]) => message.url);

describe("batchSearchOpenCourses", () => {
  it("selects the exact requested code and combines its blocks", async () => {
    stubBackground({ [REGISTRAR_URL]: { success: true, data: "fixture" } });
    mocks.parseHTMLContent.mockReturnValue([
      { code: "CSC 490", sections: [] },
      {
        code: "CSC 491",
        sections: [{ classNumber: "1", section: "001", component: "LEC" }],
      },
      {
        code: "CSC 491",
        sections: [{ classNumber: "2", section: "002", component: "LEC" }],
      },
    ]);
    const result = await searchOpenCoursesByParams(
      "2027 Spring Term",
      "CSC - Computer Science",
      "491",
    );
    expect(result?.code).toBe("CSC 491");
    expect(result?.sections.map((section) => section.classNumber)).toEqual([
      "1",
      "2",
    ]);
    expect(
      await searchOpenCoursesByParams("2027 Spring Term", "CSC", "491L"),
    ).toBeNull();
  });
  beforeEach(() => {
    mocks.parseHTMLContent.mockReturnValue([{ code: "MA 241", sections: [] }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.parseHTMLContent.mockReset();
  });

  it("searches through the worker when it responds", async () => {
    const sendMessage = stubBackground({
      [WORKER_URL]: { success: true, data: "worker" },
    });

    await batchSearchOpenCourses("2026 Fall Term", "MA");

    expect(sentUrls(sendMessage)).toEqual([WORKER_URL]);
    expect(mocks.parseHTMLContent).toHaveBeenCalledWith({ data: "worker" });
  });

  it("searches the registrar directly when the worker fails", async () => {
    const sendMessage = stubBackground({
      [WORKER_URL]: { success: false, error: "HTTP 503" },
      [REGISTRAR_URL]: { success: true, data: "registrar" },
    });

    const courses = await batchSearchOpenCourses("2026 Fall Term", "MA");

    expect(sentUrls(sendMessage)).toEqual([WORKER_URL, REGISTRAR_URL]);
    expect(mocks.parseHTMLContent).toHaveBeenCalledWith({ data: "registrar" });
    expect(courses).toEqual([{ code: "MA 241", sections: [] }]);
  });

  it("throws when the registrar fails too", async () => {
    stubBackground({
      [WORKER_URL]: { success: false, error: "HTTP 503" },
      [REGISTRAR_URL]: { success: false, error: "HTTP 500" },
    });

    await expect(
      batchSearchOpenCourses("2026 Fall Term", "MA"),
    ).rejects.toThrow("HTTP 500");
  });
});
