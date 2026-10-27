import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchMyPackText,
  isSignInResponse,
  MyPackSessionExpiredError,
} from "./myPackClient";

const signInPage = `<form action="?cmd=login&languageCd=ENG" method="post">
  <input type="text" id="userid" name="userid">
  <input type="password" id="pwd" name="pwd">
</form>`;

const notRedirected = { redirected: false, url: "" };

describe("isSignInResponse", () => {
  it("recognizes the PeopleSoft sign-in page", () => {
    expect(isSignInResponse(notRedirected, signInPage)).toBe(true);
  });

  it("recognizes a redirect to the sign-in page", () => {
    expect(
      isSignInResponse(
        {
          redirected: true,
          url: "https://portalsp.acs.ncsu.edu/psp/CS92PRD/?cmd=login",
        },
        "",
      ),
    ).toBe(true);
  });

  it("does not flag script data", () => {
    expect(isSignInResponse(notRedirected, '{"terms":[{"strm":"2271"}]}')).toBe(
      false,
    );
    expect(
      isSignInResponse(
        notRedirected,
        '<div id="useridDisplay">Signed in</div>',
      ),
    ).toBe(false);
  });
});

describe("fetchMyPackText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the body of a normal response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"ok":true}')),
    );
    await expect(fetchMyPackText("/psc/x")).resolves.toBe('{"ok":true}');
  });

  it("throws MyPackSessionExpiredError for a 200 sign-in page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(signInPage)),
    );
    await expect(fetchMyPackText("/psc/x")).rejects.toBeInstanceOf(
      MyPackSessionExpiredError,
    );
  });
});
