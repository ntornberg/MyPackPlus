import { expect, test } from "@playwright/test";

// The registrar answers every search with one synthetic TST 440 section.
const registrarHtml = `<div class="course"><h1>TST 440 <small>Database Systems</small><span class="units">Units: 3</span></h1><p>Synthetic section</p><table class="section-table"><tbody><tr><td>001</td><td>LEC</td><td>12345</td><td><span>Open</span> 10/30</td><td>MoWe 10:00 AM - 11:15 AM</td><td>Test Hall</td><td><a class="instructor-link">Test Instructor</a></td><td>01/01/2027 - 05/01/2027</td><td></td><td></td></tr></tbody></table></div>`;

test.beforeEach(async ({ page }) => {
  // `?network=real` sends requests out of the page; nothing reaches a real backend.
  await page.route("https://**/*", (route) =>
    route.request().method() === "POST" &&
    route.request().headers()["content-type"]?.includes("form-urlencoded")
      ? route.fulfill({ body: JSON.stringify({ html: registrarHtml }) })
      : route.fulfill({
          json: { data: { results: [], instructors: {} }, meta: {} },
        }),
  );
});

const electives = (page: import("@playwright/test").Page) =>
  page.locator("summary").filter({ hasText: /Other Electives/ });

test("my requirements show audit status, approved options and real sections", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/planner-staging.html?personal&network=real");
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
  // The program searches as soon as it's shown; Search reruns it.
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
  await expect(page.getByText(/Unofficial requirements/)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "NC State catalog" }),
  ).toHaveAttribute(
    "href",
    "https://catalog.ncsu.edu/undergraduate/#majorstext",
  );
});

test("an unavailable approved list never hides applied audit courses", async ({
  page,
}) => {
  await page.goto("/planner-staging.html?personal&unavailable&network=real");
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
  await page.goto("/planner-staging.html?personal&network=real");
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
  await page.screenshot({ path: testInfo.outputPath("footer-selection.png") });
  expect(errors).toEqual([]);
});
