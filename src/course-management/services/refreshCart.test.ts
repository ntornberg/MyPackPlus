import { afterEach, expect, it, vi } from "vitest";

import { refreshCart } from "./refreshCart";

afterEach(() => vi.unstubAllGlobals());

it("requests fresh cart data in the page and its MyPack iframe", () => {
  const postMessage = vi.fn();
  const framePostMessage = vi.fn();
  const origin = "https://portalsp.acs.ncsu.edu";
  vi.stubGlobal("window", { location: { origin }, postMessage });
  vi.stubGlobal("document", {
    querySelectorAll: () => [
      { contentWindow: { postMessage: framePostMessage } },
      { contentWindow: null },
    ],
  });

  refreshCart();

  const message = { type: "MYPACK_REFRESH_CART", source: "content-script" };
  expect(postMessage).toHaveBeenCalledExactlyOnceWith(message, origin);
  expect(framePostMessage).toHaveBeenCalledExactlyOnceWith(message, origin);
});
