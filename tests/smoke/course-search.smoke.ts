import { expect, test, type Page, type Route } from "@playwright/test";

import fixture from "../../src/staging/courseSearchFixture.json" with { type: "json" };

const suggestions = (page: Page) =>
  page.locator('[data-slot="combobox-list"]').getByRole("option");
const endpoint = "**/courseSearchFixture.json?*";
const finder = (page: Page) =>
  page.getByRole("combobox", { name: "Find a course", exact: true });

async function select(page: Page, query: string, key = "Enter") {
  await finder(page).click();
  await finder(page).fill(query);
  await expect(finder(page)).toHaveAttribute("aria-expanded", "true");
  await expect(suggestions(page).first()).toBeVisible();
  await finder(page).press(key);
}

test("code/topic suggestions, keyboard selection, browsing, local filters and cache", async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(endpoint, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ json: fixture });
  });
  await page.goto("/planner-staging.html?course-search");
  await page.locator("#extension-overlay-root").evaluate((element) => {
    element.classList.add("dark");
    element.setAttribute("data-mpp-theme", "dark");
  });
  await expect(
    page.getByRole("heading", {
      name: "Course search staging — synthetic sections",
    }),
  ).toBeVisible();
  await finder(page).fill("chem 101");
  await expect(suggestions(page).first()).toContainText("CH-101");
  await expect(suggestions(page).filter({ hasText: "BCH-351" })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("chemistry-search.png"),
    fullPage: true,
    animations: "disabled",
  });
  await finder(page).fill("operating systems");
  await expect(suggestions(page).first()).toContainText("Operating Systems");
  expect(requests).toHaveLength(0);
  await finder(page).press("Escape");
  await expect(suggestions(page)).toHaveCount(0);
  await finder(page).fill("e101");
  await expect(suggestions(page).first()).toContainText("E-101");
  await finder(page).press("Shift+Tab");
  expect(requests).toHaveLength(0);
  await select(page, "e101", "Tab");
  await expect(page.getByText(/^E-101 —/)).toBeVisible();
  await expect(page.getByText(/1 section group loaded/)).toBeVisible();
  await expect(finder(page)).not.toBeFocused();
  expect(requests).toHaveLength(1);
  await page
    .getByRole("combobox", { name: "Sort by" })
    .selectOption({ index: 1 });
  const instructor = page.getByRole("combobox", {
    name: "Instructor",
    exact: true,
  });
  await instructor.fill("Test");
  await instructor.press("Enter");
  expect(requests).toHaveLength(1);

  await page
    .getByRole("button", { name: "Browse by subject", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Course", exact: true }),
  ).toHaveValue(/E-101/);
  await page
    .getByRole("button", { name: "Find a course", exact: true })
    .click();
  await expect(finder(page)).toHaveValue(/E-101/);
  expect(requests).toHaveLength(1);
  await select(page, "csc246");
  await expect(page.getByText(/^CSC-246 —/)).toBeVisible();
  await expect(page.getByText(/1 section group loaded/)).toBeVisible();
  expect(requests).toHaveLength(2);
  await select(page, "e 101");
  await expect(page.getByText(/1 section group loaded/)).toBeVisible();
  expect(requests).toHaveLength(2);

  const term = page.getByRole("combobox", { name: "Term", exact: true });
  await term.fill("2026 Fall");
  await term.press("Enter");
  await expect(
    page.getByText(/2026 Fall Term: 1 section group loaded/),
  ).toBeVisible();
  expect(requests).toHaveLength(3);
  await finder(page).fill("process scheduling");
  await expect(suggestions(page).first()).toBeVisible();
  expect(requests).toHaveLength(3);
  await page.screenshot({
    path: testInfo.outputPath("course-search.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await finder(page).press("Escape");
  await finder(page)
    .locator("..")
    .locator('[data-slot="combobox-clear"]')
    .click();
  await expect(page.getByText("Sections", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 section group loaded/)).toHaveCount(0);
});

test("browse selection, restored selections, clearing pending results and untouched Tab", async ({
  page,
}) => {
  let requests = 0;
  await page.route(endpoint, async (route) => {
    requests++;
    await route.fulfill({ json: fixture });
  });
  await page.goto("/planner-staging.html?course-search&selected=E-101");
  await expect(page.getByText(/1 section group loaded/)).toBeVisible();
  expect(requests).toBe(1);
  await page.reload();
  await expect(page.getByText(/1 section group loaded/)).toBeVisible();
  expect(requests).toBe(1);
  await finder(page).click();
  await finder(page).press("Tab");
  expect(requests).toBe(1);
  await page
    .getByRole("button", { name: "Browse by subject", exact: true })
    .click();
  const subject = page.getByRole("combobox", { name: "Subject", exact: true });
  await subject.fill("CSC");
  await subject.press("Tab");
  const course = page.getByRole("combobox", { name: "Course", exact: true });
  await course.fill("246");
  await course.press("Tab");
  await expect(page.getByText(/^CSC-246 —/)).toBeVisible();
  await expect(page.getByText(/1 section group loaded/)).toBeVisible();
  expect(requests).toBe(2);
  await page
    .getByRole("button", { name: "Find a course", exact: true })
    .click();
  await expect(finder(page)).toHaveValue(/CSC-246/);
  await finder(page).fill("operating systems");
  await page.getByRole("option", { name: /CSC-501/ }).click();
  await expect(page.getByText(/^CSC-501 —/)).toBeVisible();

  let pending: Route | undefined;
  await page.unroute(endpoint);
  await page.route(endpoint, (route) => {
    pending = route;
  });
  await select(page, "ma241");
  await expect.poll(() => Boolean(pending)).toBe(true);
  await finder(page)
    .locator("..")
    .locator('[data-slot="combobox-clear"]')
    .click();
  await pending!.fulfill({ json: fixture });
  await expect(page.getByText("Sections", { exact: true })).toBeVisible();
  await expect(page.getByText(/1 section group loaded/)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("latest selection wins, repeated in-flight selections deduplicate, errors retry", async ({
  page,
}) => {
  const pending: Route[] = [];
  await page.route(endpoint, (route) => {
    pending.push(route);
  });
  await page.goto("/planner-staging.html?course-search");
  await select(page, "e101");
  await expect.poll(() => pending.length).toBe(1);
  await select(page, "csc246");
  await expect.poll(() => pending.length).toBe(2);
  await select(page, "e101");
  expect(pending).toHaveLength(2);
  await pending[0].fulfill({ json: fixture });
  await expect(page.getByText(/1 section group loaded/)).toBeVisible();
  await pending[1].fulfill({ status: 503, body: "Unavailable" });
  await expect(page.getByText(/^E-101 —/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await select(page, "csc246");
  await expect.poll(() => pending.length).toBe(3);
  await pending[2].fulfill({ status: 503, body: "Unavailable" });
  await expect(page.getByRole("alert")).toContainText("503");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => pending.length).toBe(4);
  await pending[3].fulfill({ json: null });
  await expect(
    page.getByText("No sections found for this course and term."),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
