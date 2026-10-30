import { expect, test, type Page } from "@playwright/test";

import type {
  ReviewCartEntry,
  ReviewWindow,
} from "../fixtures/cartReviewTypes";

test("cart review: calendar retains shared lab after lecture replacement", async ({
  page,
}) => {
  await page.route(
    /IScript_(addClassToShopCart|deleteClassOnShopCart|Enroll_Wizard_SETUP)/,
    (route) => route.fulfill({ json: { status: "success", message: "OK" } }),
  );
  await page.goto("/planner-staging.html?bare");
  await page.evaluate(async () => {
    const cachePath = "/src/course-management/cache/courseRetrieval.ts";
    const fixturePath = "/tests/fixtures/cartReviewHarness.tsx";
    const { setGenericCache } = await import(cachePath);
    const { mountReviewCalendar } = await import(fixturePath);
    await setGenericCache("shopCartTableData", {
      old: {
        classs: "PY 205",
        enroll_class_nbr: "11111",
        crse_id: "test-course",
        section_details: [{ class_nbr: "11111" }, { class_nbr: "33333" }],
      },
    });
    await setGenericCache("shopCartCalEventsData", {
      old: {
        class_nbr: "11111",
        title: "PY 205 (11111)",
        start: "2027-01-11T09:00:00",
        end: "2027-01-11T09:50:00",
      },
      shared: {
        class_nbr: "33333",
        title: "PY 205 (33333)",
        start: "2027-01-12T11:00:00",
        end: "2027-01-12T11:50:00",
      },
    });
    mountReviewCalendar();
  });
  const calendar = page.locator("#cart-review-calendar");
  await expect(
    calendar
      .getByRole("button", {
        name: "PY 205 (33333) class information",
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page.evaluate(async () => {
    const fixturePath = "/tests/fixtures/cartReviewHarness.tsx";
    const servicePath = "/src/course-management/services/replaceCartSection.ts";
    const { section } = await import(fixturePath);
    const { replaceCartSection } = await import(servicePath);
    const result = await replaceCartSection(
      { section: section("33333", "LAB"), parent: section("11111") },
      { section: section("33333", "LAB"), parent: section("22222") },
    );
    if (!result.ok) throw new Error(result.message);
  });
  await expect(
    calendar.getByRole("button", {
      name: "PY 205 (11111) class information",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect
    .soft(
      calendar
        .getByRole("button", {
          name: "PY 205 LEC class information",
          exact: true,
        })
        .first(),
    )
    .toBeVisible();
  await expect(
    calendar
      .getByRole("button", {
        name: "PY 205 LAB class information",
        exact: true,
      })
      .first(),
  ).toBeVisible();
});

// Mount production cells in the existing staging runtime, without changing the
// shipped UI. Imports are variables so Vite resolves them inside the browser.
async function mountCell(page: Page, inCart = false) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/planner-staging.html?tab=schedule");
  await expect(
    page.getByRole("dialog", { name: "MyPack+ Planner" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close planner" }).click();
  await page.evaluate(async (inCart) => {
    const harnessPath = "/tests/fixtures/cartReviewHarness.tsx";
    const { mountCartReview } = await import(harnessPath);
    mountCartReview(inCart);
  }, inCart);
  await expect
    .poll(() => page.locator("#cart-review-cell button").count(), {
      message: "Production cart cell must mount before the interaction test",
    })
    .toBe(1);
  expect(errors).toEqual([]);
}

test("cart review: double-click Add sends one request and disables the pending control", async ({
  page,
}) => {
  await mountCell(page);
  const add = page
    .locator("#cart-review-cell")
    .getByRole("button", { name: "Add to cart" });
  await add.dblclick();
  const disabled = await add.isDisabled();
  const observed = await page.evaluate(() => {
    const state = (window as unknown as ReviewWindow).cartReview;
    const count = state.requests.length;
    state.releases.forEach((release: () => void) => release());
    return count;
  });
  expect(observed).toBe(1);
  expect(disabled).toBe(true);
});

test("cart review: missing-present-missing lecture does not break hook order", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    )
      errors.push(message.text());
  });
  await mountCell(page);
  for (const present of [false, true, false, true]) {
    await page.evaluate(
      (present) =>
        (window as unknown as ReviewWindow).cartReview.render(present),
      present,
    );
    await expect(page.locator("#cart-review-cell button")).toHaveCount(
      present ? 1 : 0,
    );
  }
  expect(errors).toEqual([]);
});

test("cart review: Remove confirmation names the actual lab rather than a newly picked lab", async ({
  page,
}) => {
  await mountCell(page, true);
  await page.evaluate(async () => {
    const cachePath = "/src/course-management/cache/courseRetrieval.ts";
    const { setGenericCache } = await import(cachePath);
    await setGenericCache("shopCartTableData", {
      original: {
        classs: "PY 205",
        enroll_class_nbr: "11111",
        section_details: [{ class_nbr: "11111" }, { class_nbr: "33333" }],
      },
    });
  });
  await page
    .locator("#cart-review-cell")
    .getByRole("button", { name: "In cart. Remove from cart" })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText("33333");
  await expect(page.getByRole("alertdialog")).not.toContainText("44444");
});

test("cart review: a successful lab change survives an older captured refresh in Schedule", async ({
  page,
}) => {
  await page.goto("/planner-staging.html?tab=schedule");
  await page.getByRole("button", { name: /Lab · Sec 201A/ }).click();
  await page
    .getByRole("button", { name: /Swap to/ })
    .first()
    .click();
  const course = page.getByRole("button", { name: /^CH 101\s*Cart/ });
  await expect(course).toBeVisible();
  await page.evaluate(async () => {
    const pendingPath = "/src/extension/pendingWork.ts";
    const { waitForIdle } = await import(pendingPath);
    await waitForIdle();
    const storagePath = "/src/degree-planning/services/siteResponseStorage.ts";
    const { setupListener } = await import(storagePath);
    await setupListener();
    await new Promise<void>((resolve) => {
      const delivered = (event: MessageEvent) => {
        if (event.data?.reviewMarker !== "stale-refresh") return;
        window.removeEventListener("message", delivered);
        resolve();
      };
      window.addEventListener("message", delivered);
      window.postMessage(
        {
          reviewMarker: "stale-refresh",
          source: "realFetchHook",
          type: "CLASS_DATA",
          payload: {
            responseType: "_getShopCartTableData",
            data: [],
          },
        },
        window.location.origin,
      );
    });
  });
  // The acknowledgement above ensures the response reached storage listeners.
  await page.evaluate(async () => {
    const storagePath = "/src/degree-planning/services/siteResponseStorage.ts";
    const { whenSiteResponsesStored } = await import(storagePath);
    await whenSiteResponsesStored();
  });
  // Read durable state as well as UI, so a render still showing the old row
  // cannot make the test pass before React processes the invalidation.
  const retained = await page.evaluate(async () => {
    const path = "/src/course-management/cache/courseRetrieval.ts";
    const { getCacheCategory } = await import(path);
    return Object.values(await getCacheCategory("shopCartTableData")).some(
      (entry) => (entry as ReviewCartEntry).combinedData.classs === "CH 101",
    );
  });
  expect.soft(retained).toBe(true);
  await expect(course).toBeVisible();
});

test("cart review: unknown original lab does not permit guessed destructive swap", async ({
  page,
}) => {
  await page.goto("/planner-staging.html?tab=schedule");
  await expect(
    page.getByRole("button", { name: /Lab · Sec 201A/ }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const cachePath = "/src/course-management/cache/courseRetrieval.ts";
    const signalPath = "/src/course-management/cache/scheduleCacheSignal.ts";
    const { getCacheCategory, replaceGenericCache } = await import(cachePath);
    const { notifyScheduleDataChanged } = await import(signalPath);
    const entries = await getCacheCategory("shopCartTableData");
    const rows = Object.fromEntries(
      Object.entries(entries as Record<string, ReviewCartEntry>).map(
        ([key, entry]) => {
          const row = entry.combinedData;
          if (row.classs === "CH 101")
            row.section_details = row.section_details.map(
              (
                s: ReviewCartEntry["combinedData"]["section_details"][number],
              ) =>
                /lab/i.test(s.type)
                  ? { ...s, class_nbr: "999999", section: "999Z" }
                  : s,
            );
          return [key, row];
        },
      ),
    );
    await replaceGenericCache("shopCartTableData", rows);
    await notifyScheduleDataChanged();
  });
  const lab = page.getByRole("button", { name: /Lab · Sec/ });
  await lab.click();
  const swaps = page.getByRole("button", { name: /Swap to/ });
  const enabled = await swaps.evaluateAll(
    (buttons) =>
      buttons.filter((b) => !(b as HTMLButtonElement).disabled).length,
  );
  expect(enabled).toBe(0);
});
