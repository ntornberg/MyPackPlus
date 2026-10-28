import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inCartTerm, inMyPackTerm, termIdOf } from "./myPackSession";

vi.mock("./mypackScriptUrl", () => ({
  generateMyPackScriptContentUrl: () => "https://example.com/s/SETUP",
}));
vi.mock("../../utils/logger", () => ({ AppLogger: { warn: vi.fn() } }));

/** A page whose term picker shows `label`. */
function stubPage(label: string | null) {
  const option = { textContent: label };
  vi.stubGlobal("document", {
    querySelectorAll: (selector: string) =>
      selector === "iframe" || !label ? [] : [option],
  });
}

describe("myPackSession", () => {
  let terms: string[];
  beforeEach(() => {
    terms = [];
    stubPage(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  const setTerm = async (strm: string) => {
    terms.push(strm);
  };

  it("maps term labels to term codes", () => {
    expect(termIdOf("2027  Spring Term")).toBe("2271");
    expect(termIdOf("Someday")).toBeNull();
    expect(termIdOf(undefined)).toBeNull();
  });

  it("switches the session to the work's term, then back to the page's", async () => {
    stubPage("2027 Spring Term");
    const seen: string[] = [];
    await inMyPackTerm("2268", setTerm, async () => {
      seen.push(terms.at(-1)!);
    });
    expect(seen).toEqual(["2268"]);
    expect(terms).toEqual(["2268", "2271"]);
  });

  it("doesn't switch back when the page already shows the term", async () => {
    stubPage("2027 Spring Term");
    await inMyPackTerm("2271", setTerm, async () => undefined);
    expect(terms).toEqual(["2271"]);
  });

  it("runs one term's work at a time", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = inMyPackTerm("2268", setTerm, () => held);
    const second = inMyPackTerm("2271", setTerm, async () => terms.at(-1));
    await Promise.resolve();
    expect(terms).toEqual(["2268"]);
    release();
    await first;
    await expect(second).resolves.toBe("2271");
  });

  it("keeps going after a failed run", async () => {
    await expect(
      inMyPackTerm("2268", setTerm, () => Promise.reject(new Error("x"))),
    ).rejects.toThrow("x");
    await expect(inMyPackTerm("2271", setTerm, async () => "ok")).resolves.toBe(
      "ok",
    );
  });

  it("refuses cart work for an unknown term", () => {
    const work = vi.fn(async () => "sent");
    expect(inCartTerm("Someday", work)).toMatch(/which term/);
    expect(inCartTerm(null, work)).toMatch(/which term/);
    expect(work).not.toHaveBeenCalled();
  });

  it("refuses cart work for a term MyPack isn't showing", () => {
    stubPage("2027 Spring Term");
    const work = vi.fn(async () => "sent");
    expect(inCartTerm("2026 Fall Term", work)).toBe(
      "Nothing was changed: MyPack is showing 2027 Spring Term. Switch MyPack's term to 2026 Fall Term to change that term's cart.",
    );
    expect(work).not.toHaveBeenCalled();
  });

  it("sets the cart's term through the Wizard before the cart request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );
    await inCartTerm("2026 Fall Term", async () => undefined);
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get("enrollTermSelect")).toBe("2268");
  });
});
