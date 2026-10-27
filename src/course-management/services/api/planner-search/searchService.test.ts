import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseHTMLContent: vi.fn(),
}));

vi.mock("../../../../utils/course-search/parseRegistrarUtil", () => ({
  parseHTMLContent: mocks.parseHTMLContent,
  formCourseURL: vi.fn(() => "form-data"),
}));

import { batchSearchOpenCourses } from "./searchService";

const WORKER_URL = "https://cloudflareworker.nicktornberg12.workers.dev/";
const REGISTRAR_URL = "https://webappprd.acs.ncsu.edu/php/coursecat/search.php";

/** Stubs the background fetch, answering each URL with its given response. */
function stubBackground(responses: Record<string, unknown>) {
  const sendMessage = vi.fn(
    (message: { url: string }, callback: (response: unknown) => void) =>
      callback(responses[message.url]),
  );
  vi.stubGlobal("chrome", { runtime: { sendMessage, lastError: undefined } });
  return sendMessage;
}

const sentUrls = (sendMessage: ReturnType<typeof stubBackground>) =>
  sendMessage.mock.calls.map(([message]) => message.url);

describe("batchSearchOpenCourses", () => {
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
    expect(mocks.parseHTMLContent).toHaveBeenCalledWith({
      success: true,
      data: "worker",
    });
  });

  it("searches the registrar directly when the worker fails", async () => {
    const sendMessage = stubBackground({
      [WORKER_URL]: { success: false, error: "HTTP 503" },
      [REGISTRAR_URL]: { success: true, data: "registrar" },
    });

    const courses = await batchSearchOpenCourses("2026 Fall Term", "MA");

    expect(sentUrls(sendMessage)).toEqual([WORKER_URL, REGISTRAR_URL]);
    expect(mocks.parseHTMLContent).toHaveBeenCalledWith({
      success: true,
      data: "registrar",
    });
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
