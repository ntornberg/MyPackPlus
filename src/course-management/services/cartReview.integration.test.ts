import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  setupListener,
  whenSiteResponsesStored,
} from "../../degree-planning/services/siteResponseStorage";
import { getCacheCategory, setGenericCache } from "../cache/courseRetrieval";
import type { ScheduleEvent } from "../types/calendar";
import type { ToCartPayload } from "../types/cart";
import type { ModifiedSection } from "../types/section";
import { scheduleCoursesFrom } from "../utils/scheduleCourses";

import { addSectionToCart } from "./addSectionToCart";
import { applyOfferings, fetchMyPackOfferings } from "./myPackOfferings";
import {
  removeClassFromCart,
  removeSectionFromCart,
} from "./removeSectionFromCart";
import { replaceCartSection, changeCartLab } from "./replaceCartSection";

// Real services and cache implementation; only browser/storage/network boundaries
// are simulated. These are ordinary assertions, intentionally red for open bugs.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const location = new URL(
  "https://portalsp.acs.ncsu.edu/psc/CS92PRD/EMPLOYEE/NCSIS/s/",
);
const section = (classNumber: string, component = "LEC"): ModifiedSection => ({
  id: classNumber,
  classNumber,
  section: classNumber,
  component,
  availability: "Open",
  enrollment: "1/20",
  dayTime: "Mo 9:00 AM - 9:50 AM",
  location: "Test room",
  instructor_name: [],
  dates: "",
  notes: null,
  requisites: null,
  course_id: "test-course",
  catalog_nbr: "205",
  term: "2027 Spring Term",
  courseData: {
    code: "PY 205",
    title: "Fixture",
    units: "3",
    description: "",
    prerequisite: null,
    sections: [],
  },
});
const oldLecture = section("11111");
const newLecture = section("22222");
const sharedLab = section("33333", "LAB");
const newLab = section("44444", "LAB");
const options = { wait_list_okay: "Y", grading_basis: "SUS", unt_taken: "4" };
const payload = (lecture = "11111", related = ["33333"]): ToCartPayload => ({
  class_nbr: lecture,
  crse_id: "test-course",
  catalog_nbr: "205",
  course_career: "UGRD",
  session_code: "1",
  rqmnt_designtn: "",
  ...options,
  ...Object.fromEntries(
    related.map((n, i) => [`relate_class_nbr_${i + 1}`, n]),
  ),
});
const row = (lecture: string) => ({
  crse_id: "test-course",
  class_nbr: lecture,
  enroll_class_nbr: lecture,
  classs: "PY 205",
  ...options,
  add_to_cart_data: [payload(lecture)],
  section_details: [{ class_nbr: lecture }, { class_nbr: "33333" }],
});
let stored: Record<string, unknown>;
let requests: URL[];
let serverTerm: string;
let serverCart: Map<string, ToCartPayload>;
let messageListener: (event: unknown) => void;
let onRefresh: () => void;
let respond: (url: URL) => Promise<Response>;
const success = () => Response.json({ status: "success", message: "OK" });
const failure = () =>
  Response.json({ status: "error", message: "Fixture rejection" });
const mutations = () =>
  requests.filter((u) =>
    /IScript_(addClassToShopCart|deleteClassOnShopCart)/.test(u.pathname),
  );
const adds = () =>
  mutations().filter((u) => u.pathname.endsWith("IScript_addClassToShopCart"));
const deletes = () =>
  mutations().filter((u) =>
    u.pathname.endsWith("IScript_deleteClassOnShopCart"),
  );

beforeEach(() => {
  stored = {};
  requests = [];
  serverTerm = "2271";
  serverCart = new Map([["2271:11111", payload()]]);
  onRefresh = () => {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => structuredClone({ [key]: stored[key] }),
        set: async (items: Record<string, unknown>) => {
          Object.assign(stored, structuredClone(items));
        },
        remove: async (keys: string | string[]) => {
          for (const key of [keys].flat()) delete stored[key];
        },
      },
    },
  });
  vi.stubGlobal("window", {
    location,
    postMessage: (message: { type: string }) => {
      if (message.type === "MYPACK_REFRESH_CART") onRefresh();
    },
    addEventListener: (_: string, listener: typeof messageListener) => {
      messageListener = listener;
    },
  });
  // The Enrollment Wizard's term picker shows Spring, the session's term.
  vi.stubGlobal("document", {
    querySelector: () => null,
    querySelectorAll: (selector: string) =>
      selector === "select option:checked"
        ? [{ textContent: "2027 Spring Term" }]
        : [],
  });
  respond = async (url) => {
    if (url.pathname.endsWith("IScript_Enroll_Wizard_SETUP")) {
      serverTerm = url.searchParams.get("enrollTermSelect")!;
      return success();
    }
    if (url.pathname.endsWith("IScript_getClassSearchResults")) {
      return Response.json({ data: [row("11111")] });
    }
    const number = url.searchParams.get("class_nbr");
    if (url.pathname.endsWith("IScript_addClassToShopCart")) {
      serverCart.set(
        `${serverTerm}:${number}`,
        Object.fromEntries(url.searchParams) as ToCartPayload,
      );
    } else if (url.pathname.endsWith("IScript_deleteClassOnShopCart")) {
      serverCart.delete(`${serverTerm}:${number}`);
    } else throw new Error(`Unexpected test endpoint: ${url.pathname}`);
    return success();
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input), location);
      requests.push(url);
      return respond(url);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("cart review: term isolation (server model, requires live confirmation)", () => {
  it.each(["cold", "warm", "expired"])(
    "keeps a term A add in A after a %s term B lookup",
    async (cache) => {
      vi.useFakeTimers();
      if (cache !== "cold") {
        await fetchMyPackOfferings("PY 205", "2026 Fall Term", location);
        serverTerm = "2271";
        if (cache === "expired") vi.advanceTimersByTime(30 * 60 * 1000 + 1);
      }
      await fetchMyPackOfferings("PY 205", "2026 Fall Term", location);
      await addSectionToCart(newLecture);
      expect(serverCart.has("2271:22222")).toBe(true);
      expect(serverTerm, "native actions inherit the session term").toBe(
        "2271",
      );
    },
  );
  it("does not trust a cached A offering after a B lookup", async () => {
    await fetchMyPackOfferings("PY 205", "2027 Spring Term", location);
    await fetchMyPackOfferings("PY 205", "2026 Fall Term", location);
    await fetchMyPackOfferings("PY 205", "2027 Spring Term", location);
    await addSectionToCart(newLecture);
    expect(serverCart.has("2271:22222")).toBe(true);
  });
  it.each(["search-first", "add-first"])(
    "isolates overlapping lookup/add: %s",
    async (order) => {
      const entered = deferred<void>();
      const release = deferred<void>();
      const original = respond;
      respond = async (url) => {
        const held =
          order === "search-first"
            ? "IScript_getClassSearchResults"
            : "IScript_addClassToShopCart";
        if (url.pathname.endsWith(held)) {
          entered.resolve();
          await release.promise;
        }
        return original(url);
      };
      const first =
        order === "search-first"
          ? fetchMyPackOfferings("PY 205", "2027 Spring Term", location)
          : addSectionToCart(newLecture);
      await entered.promise;
      const second =
        order === "search-first"
          ? addSectionToCart(newLecture)
          : fetchMyPackOfferings("PY 205", "2027 Spring Term", location);
      // Drain currently runnable work without deadlocking a future shared queue.
      await new Promise<void>((resolve) => setImmediate(resolve));
      release.resolve();
      await Promise.all([first, second]);
      expect(serverCart.has("2271:22222")).toBe(true);
    },
  );
});

describe("cart review: MyPack's own buttons keep the page's term", () => {
  it("never switches MyPack to a term it isn't showing", async () => {
    await expect(
      fetchMyPackOfferings("PY 205", "2026 Fall Term", location),
    ).resolves.toBeNull();
    await addSectionToCart({ ...newLecture, term: "2026 Fall Term" });
    expect(
      requests.filter((u) => u.searchParams.get("enrollTermSelect") === "2268"),
    ).toEqual([]);
    expect(mutations()).toEqual([]);
    expect(serverTerm).toBe("2271");
  });
});

describe("cart review: real replacement and removal", () => {
  it.each(["old-first", "new-first", "new-only", "empty"])(
    "deletes the old enrollment row with %s cache",
    async (order) => {
      const entries =
        order === "old-first"
          ? ["11111", "22222"]
          : order === "new-first"
            ? ["22222", "11111"]
            : order === "new-only"
              ? ["22222"]
              : [];
      await setGenericCache(
        "shopCartTableData",
        Object.fromEntries(entries.map((n) => [`test-course|${n}`, row(n)])),
      );
      await replaceCartSection(
        { section: sharedLab, parent: oldLecture },
        { section: sharedLab, parent: newLecture },
      );
      expect(deletes().map((u) => u.searchParams.get("class_nbr"))).toEqual([
        "11111",
      ]);
      expect([...serverCart.keys()]).toEqual(["2271:22222"]);
    },
  );
  it.each([
    { cached: true, labFirst: true },
    { cached: false, labFirst: true },
    { cached: true, labFirst: false },
    { cached: false, labFirst: false },
  ])(
    "Schedule Remove uses enrollment number (cached=$cached, labFirst=$labFirst)",
    async ({ cached, labFirst }) => {
      if (cached)
        await setGenericCache("shopCartTableData", { old: row("11111") });
      const events = (
        labFirst ? [sharedLab, oldLecture] : [oldLecture, sharedLab]
      ).map((s, i) => ({
        id: i,
        subj: "PY 205",
        start: "9:00 AM",
        end: "9:50 AM",
        days: [],
        color: "#000",
        course: {
          code: "PY 205",
          classNumber: s.classNumber,
          section: s.section,
          component: s.component,
          instructors: [],
        },
      })) as ScheduleEvent[];
      const course = scheduleCoursesFrom(events, [])[0];
      const result = await removeClassFromCart(course.classNumbers);
      expect(
        !result.ok ||
          deletes().every((u) => u.searchParams.get("class_nbr") === "11111"),
      ).toBe(true);
    },
  );
  it("keeps the shared lab calendar event after replacing its lecture", async () => {
    await setGenericCache("shopCartTableData", { old: row("11111") });
    await setGenericCache("shopCartCalEventsData", {
      old: { class_nbr: "11111" },
      shared: { class_nbr: "33333" },
    });
    await replaceCartSection(
      { section: sharedLab, parent: oldLecture },
      { section: sharedLab, parent: newLecture },
    );
    expect(
      (await getCacheCategory("shopCartCalEventsData"))?.shared,
    ).toBeDefined();
  });
});

describe("cart review: options and recovery", () => {
  it.each(
    ["replace", "lab-change", "restore"].flatMap((action) =>
      [false, true].map((exact) => ({ action, exact })),
    ),
  )(
    "preserves original cart options on $action (offering defaults=$exact)",
    async ({ action, exact }) => {
      await setGenericCache("shopCartTableData", { old: row("11111") });
      if (action === "restore") {
        const original = respond;
        respond = async (url) =>
          url.searchParams.get("relate_class_nbr_1") === "44444"
            ? failure()
            : original(url);
      }
      const addOptions = exact
        ? {
            payload: {
              ...payload(action === "replace" ? "22222" : "11111", ["44444"]),
              wait_list_okay: "N",
              grading_basis: "GRD",
              unt_taken: "3",
            },
          }
        : {};
      if (action === "replace")
        await replaceCartSection(
          { section: sharedLab, parent: oldLecture },
          { section: newLab, parent: newLecture },
          addOptions,
        );
      else await changeCartLab(oldLecture, sharedLab, newLab, addOptions);
      expect(adds().length).toBeGreaterThan(0);
      for (const request of adds())
        expect(Object.fromEntries(request.searchParams)).toMatchObject(options);
    },
  );
  it("refuses a destructive lab change without exact pairings", async () => {
    await changeCartLab(oldLecture, sharedLab, newLab);
    expect(mutations()).toHaveLength(0);
  });
  it("refuses a destructive lab change after a pairing request fails", async () => {
    const original = respond;
    respond = async (url) =>
      url.pathname.endsWith("IScript_getClassSearchResults")
        ? new Response(null, { status: 503 })
        : original(url);
    await expect(
      fetchMyPackOfferings("PY 205", "2027 Spring Term", location),
    ).rejects.toThrow();
    await changeCartLab(oldLecture, sharedLab, newLab);
    expect(mutations()).toHaveLength(0);
  });
  it("restores every original option and related section when exact payloads are supplied", async () => {
    const original = respond;
    respond = async (url) =>
      url.searchParams.get("relate_class_nbr_1") === "44444"
        ? failure()
        : original(url);
    const result = await changeCartLab(
      oldLecture,
      sharedLab,
      newLab,
      { payload: payload("11111", ["44444", "55555"]) },
      { payload: payload("11111", ["33333", "55555"]) },
    );
    expect(result).toMatchObject({ ok: false, partial: false });
    expect(Object.fromEntries(adds().at(-1)!.searchParams)).toEqual(
      payload("11111", ["33333", "55555"]),
    );
    expect(serverCart.get("2271:11111")).toEqual(
      payload("11111", ["33333", "55555"]),
    );
  });
  it("reports failed recovery as partial failure", async () => {
    // A lab change needs the original row to put back; see the refusal tests.
    await setGenericCache("shopCartTableData", { old: row("11111") });
    const original = respond;
    respond = async (url) =>
      url.pathname.endsWith("IScript_addClassToShopCart")
        ? failure()
        : original(url);
    const result = await changeCartLab(oldLecture, sharedLab, newLab);
    expect(result).toMatchObject({ ok: false, partial: true });
    expect(serverCart.size).toBe(0);
  });
});

describe("cart review: races and multi-component offerings", () => {
  it("does not let an older refresh erase a completed lab change", async () => {
    await setupListener();
    // A lab change needs the original row to put back; see the refusal tests.
    await setGenericCache("shopCartTableData", { old: row("11111") });
    const refresh = deferred<void>();
    let staleResponse!: Promise<void>;
    onRefresh = () => {
      staleResponse = refresh.promise.then(async () => {
        messageListener({
          source: window,
          data: {
            source: "realFetchHook",
            type: "CLASS_DATA",
            payload: { responseType: "_getShopCartTableData", data: [] },
          },
        });
        await whenSiteResponsesStored();
      });
    };
    await changeCartLab(oldLecture, sharedLab, newLab);
    expect(
      Object.keys((await getCacheCategory("shopCartTableData")) ?? {}),
    ).toHaveLength(1);
    refresh.resolve();
    await staleResponse;
    expect(
      Object.keys((await getCacheCategory("shopCartTableData")) ?? {}),
    ).toHaveLength(1);
  });
  it("coalesces duplicate in-flight adds", async () => {
    const gate = deferred<void>();
    const original = respond;
    respond = async (url) => {
      await gate.promise;
      return original(url);
    };
    const first = addSectionToCart(newLecture);
    const second = addSectionToCart(newLecture);
    gate.resolve();
    await Promise.all([first, second]);
    expect(adds()).toHaveLength(1);
  });
  it.each(["remove", "replace"])(
    "does not start %s while a lab change owns the course",
    async (action) => {
      // A lab change needs the original row to put back; see the refusal tests.
      await setGenericCache("shopCartTableData", { old: row("11111") });
      const entered = deferred<void>();
      const gate = deferred<void>();
      const original = respond;
      respond = async (url) => {
        if (url.pathname.endsWith("IScript_addClassToShopCart")) {
          entered.resolve();
          await gate.promise;
        }
        return original(url);
      };
      const first = changeCartLab(oldLecture, sharedLab, newLab);
      await entered.promise;
      const second =
        action === "remove"
          ? removeSectionFromCart(oldLecture)
          : replaceCartSection(
              { section: oldLecture },
              { section: newLecture },
            );
      // Let the second operation reach the network boundary while the first is held.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const started = mutations().length;
      gate.resolve();
      await Promise.all([first, second]);
      expect(started).toBe(2);
    },
  );
  it("provides a complete exact payload for every exposed related-section choice", () => {
    const rec1 = section("55555", "REC"),
      rec2 = section("66666", "REC");
    const offerings = [
      ["33333", "55555"],
      ["33333", "66666"],
      ["44444", "66666"],
    ].map((related) => ({
      enroll: "11111",
      related,
      payload: payload("11111", related),
    }));
    const groups = applyOfferings(
      [{ lecture: oldLecture, labs: [sharedLab, newLab, rec1, rec2] }],
      offerings,
    );
    for (const group of groups)
      for (const choice of group.labs ?? []) {
        const exact = group.cartPayloads?.[choice.classNumber];
        expect(
          exact,
          `missing exact payload for ${choice.classNumber}`,
        ).toBeDefined();
        expect(
          offerings.some(
            (o) => JSON.stringify(o.payload) === JSON.stringify(exact),
          ),
        ).toBe(true);
      }
  });
});
