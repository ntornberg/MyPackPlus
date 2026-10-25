import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

const hookSource = readFileSync(
  new URL("../../public/realFetchHook.js", import.meta.url),
  "utf8",
);

describe("cart refresh through the page hook", () => {
  let requests: FakeXHR[];
  let messageHandlers: ((event: unknown) => void)[];
  let pageWindow: {
    XMLHttpRequest: typeof FakeXHR;
    parent: object;
    location: { origin: string };
    __receiverReady: boolean;
    addEventListener: (
      type: string,
      listener: (event: unknown) => void,
    ) => void;
    postMessage: ReturnType<typeof vi.fn>;
  };

  class FakeXHR {
    method = "";
    url = "";
    headers: string[][] = [];
    body: unknown;
    responseText = "";
    status = 200;
    load?: () => Promise<void>;
    constructor() {
      requests.push(this);
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers.push([name, value]);
    }
    send(body?: unknown) {
      this.body = body;
    }
    addEventListener(type: string, listener: () => Promise<void>) {
      if (type === "load") this.load = listener;
    }
  }

  function refresh(
    source: object = pageWindow,
    origin = pageWindow.location.origin,
  ) {
    for (const handler of messageHandlers)
      handler({
        source,
        origin,
        data: { type: "MYPACK_REFRESH_CART", source: "content-script" },
      });
  }

  beforeEach(() => {
    requests = [];
    messageHandlers = [];
    pageWindow = {
      XMLHttpRequest: FakeXHR,
      parent: {},
      location: { origin: "https://portalsp.acs.ncsu.edu" },
      __receiverReady: true,
      addEventListener: (type, listener) => {
        if (type === "message") messageHandlers.push(listener);
      },
      postMessage: vi.fn(),
    };
    runInNewContext(hookSource, { window: pageWindow, setTimeout: vi.fn() });
  });

  it("repeats the latest cart request with its method, term, headers and body, then publishes fresh data", async () => {
    const original = new pageWindow.XMLHttpRequest();
    original.open("POST", "/s/WEBLIB_ENROLL._getShopCartTableData?term=2271");
    original.setRequestHeader(
      "Content-Type",
      "application/x-www-form-urlencoded",
    );
    original.send("term=2271");

    refresh(pageWindow.parent);

    expect(requests).toHaveLength(2);
    const replay = requests[1];
    expect(replay.method).toBe(original.method);
    expect(replay.url).toBe(original.url);
    expect(replay.headers).toEqual([
      ...original.headers,
      ["Cache-Control", "no-cache"],
    ]);
    expect(replay.body).toBe(original.body);
    replay.responseText = JSON.stringify({ data: [] });
    await replay.load?.();
    expect(pageWindow.postMessage).toHaveBeenCalledWith(
      {
        source: "realFetchHook",
        type: "CLASS_DATA",
        payload: {
          responseType: "_getShopCartTableData",
          data: [],
          fullSnapshot: true,
        },
      },
      pageWindow.location.origin,
    );
  });

  it("does nothing before MyPack has requested cart data", () => {
    refresh();
    expect(requests).toHaveLength(0);
  });

  it("refreshes the separate calendar feed as well as the table without accumulating replay headers", async () => {
    for (const type of ["_getShopCartTableData", "_getShopCartCalEvents"]) {
      const original = new pageWindow.XMLHttpRequest();
      original.open("GET", `/s/${type}?term=2271`);
      original.send();
    }
    refresh();
    expect(requests.slice(2).map(({ url }) => url)).toEqual([
      "/s/_getShopCartTableData?term=2271",
      "/s/_getShopCartCalEvents?term=2271",
    ]);
    requests[3].responseText = JSON.stringify([
      {
        title: "CSC 316 (001)",
        start: "2026-10-26T11:45:00",
        end: "2026-10-26T13:00:00",
      },
    ]);
    await requests[3].load?.();
    expect(pageWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          responseType: "_getShopCartCalEvents",
          fullSnapshot: true,
        }),
      }),
      pageWindow.location.origin,
    );

    refresh();
    expect(requests).toHaveLength(6);
    expect(requests[5].headers).toEqual([["Cache-Control", "no-cache"]]);
  });

  it("does not publish an unsuccessful cart response as an empty cart", async () => {
    const cart = new pageWindow.XMLHttpRequest();
    cart.open("GET", "/_getShopCartTableData");
    cart.send();
    cart.status = 500;
    cart.responseText = JSON.stringify({ data: [] });
    await cart.load?.();
    expect(pageWindow.postMessage).not.toHaveBeenCalled();
  });

  it("does not repeat unrelated requests or accept messages from other windows or origins", () => {
    const schedule = new pageWindow.XMLHttpRequest();
    schedule.open("GET", "/_getScheduleTableData");
    schedule.send();
    refresh();
    expect(requests).toHaveLength(1);

    const cart = new pageWindow.XMLHttpRequest();
    cart.open("GET", "/_getShopCartTableData");
    cart.send();
    refresh({});
    refresh(pageWindow.parent, "https://other.example");
    expect(requests).toHaveLength(2);
    refresh();
    expect(requests).toHaveLength(3);
  });
});
