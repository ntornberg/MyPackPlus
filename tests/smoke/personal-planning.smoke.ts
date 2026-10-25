import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Only synthetic data leaves the staging bridge; no real backend is contacted.
  await page.route("https://**/*", (route) =>
    route.fulfill({ json: { data: { courses: [], profs: [] } } }),
  );
});

const electives = (page: import("@playwright/test").Page) =>
  page.locator("summary").filter({ hasText: /Other Electives/ });

test("my requirements show audit status, approved options and real sections", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/planner-staging.html?personal");
  await expect(page).toHaveTitle("Pack Planner Staging");
  await expect(page.getByText(/Fall 2023 catalog/)).toBeVisible();
  await expect(page.getByText("1 / 2")).toBeVisible();

  // "Still needed" hides the complete Core group.
  await expect(
    page.locator("summary").filter({ hasText: /^Core/ }),
  ).toHaveCount(0);
  await electives(page).click();
  await expect(page.getByText(/Completed\s*· S · Fall '25/)).toBeVisible();
  await expect(page.getByText(/Completed\s*· S · Spring '26/)).toBeVisible();
  await expect(page.getByText(/Planned\s*· Spring '27/)).toBeVisible();
  await expect(page.getByText(/Enrolled\s*· Fall '26/)).toBeVisible();
  // Approved options are listed, with no availability claims before a search.
  await expect(page.getByText("Approved Course 499")).toBeVisible();
  await expect(page.getByText("OTH 540")).toBeVisible();
  await expect(page.getByText("Not offered this term")).toHaveCount(0);

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText("1 offered")).toBeVisible();
  await expect(page.getByText("1 section · 1 open")).toBeVisible();
  // "Hide courses with no open sections" drops options without sections,
  // but never the courses the audit applied.
  await expect(page.getByText("Approved Course 499")).toHaveCount(0);
  await expect(page.getByText("Parallel Computing")).toBeVisible();

  await page.getByRole("button", { name: /Approved Course 440/ }).click();
  await expect(
    page.getByText("Test Instructor", { exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("personal-planning.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);

  await page.getByRole("radio", { name: "Explore majors" }).click();
  await expect(page.getByText(/Unverified bundled requirements/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Official NC State catalog/ }),
  ).toHaveAttribute(
    "href",
    "https://catalog.ncsu.edu/undergraduate/#majorstext",
  );
});

test("an unavailable approved list never hides applied audit courses", async ({
  page,
}) => {
  await page.goto("/planner-staging.html?personal&unavailable");
  await expect(
    page.getByText(/approved-course lists couldn.t load/),
  ).toBeVisible();
  await electives(page).click();
  await expect(page.getByText("Security Topics")).toBeVisible();
  await expect(page.getByText(/Enrolled\s*· Fall '26/)).toBeVisible();
});

test("blank space below the section divider selects the card while its cart button does not", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/planner-staging.html?personal");
  await electives(page).click();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Search", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: /Approved Course 440/ }).click();

  const card = page
    .getByRole("option")
    .filter({ hasText: "Section 001" })
    .first();
  await expect(card).toHaveAttribute("aria-selected", "false");
  await card.getByRole("button", { name: "Add to cart" }).click();
  await expect(card).toHaveAttribute("aria-selected", "false");

  const footer = card.locator("div.border-t");
  const bounds = await footer.boundingBox();
  expect(bounds).not.toBeNull();
  await footer.click({ position: { x: 8, y: bounds!.height - 8 } });
  await expect(card).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Section preview selected")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("footer-selection.png") });
  expect(errors).toEqual([]);
});
