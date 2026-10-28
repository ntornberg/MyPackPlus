import { expect, test, type Page } from "@playwright/test";

function failOnAppErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      errors.push(message.text());
    }
  });

  return errors;
}

test("opens the real planner with every tab", async ({ page }) => {
  const errors = failOnAppErrors(page);

  await page.goto("/planner-staging.html");

  await expect(page).toHaveTitle("Pack Planner Staging");
  await expect(
    page.getByRole("dialog", { name: "MyPack+ Planner" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Planner search tabs" }),
  ).toBeVisible();
  for (const name of [
    "Schedule",
    "Course Search",
    "GEP Search",
    "Major Plan Search",
  ]) {
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: "Look up instructor" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Find a course", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("loads dummy data in every tab", async ({ page }) => {
  const errors = failOnAppErrors(page);

  await page.goto("/planner-staging.html?course=CSC%20316");
  await expect(page.getByText(/section groups? loaded/)).toBeVisible();
  await expect(page.locator('[role="option"]').first()).toContainText(
    "CSC 316",
  );

  await page.getByRole("tab", { name: "GEP Search" }).click();
  await expect(page.getByText("Your GEP progress")).toBeVisible();
  await page
    .getByRole("button", { name: /Visual and Performing Arts/ })
    .click();
  await expect(
    page.getByText(/courses in \d+ departments · 2027 Spring Term/),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Major Plan Search" }).click();
  await expect(
    page.getByRole("radio", { name: "My requirements", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByText(/Computer Science BS · Fall 2025 catalog/),
  ).toBeVisible();

  await page.getByRole("button", { name: "Look up instructor" }).click();
  await expect(
    page.getByRole("dialog", { name: "Look up instructor" }),
  ).toBeVisible();
  await page.getByPlaceholder(/Name, Unity ID, or subject/).fill("CSC");
  await expect(page.getByText(/\d+ matches for “CSC”/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("toggles theme and adds to cart without leaving staging", async ({
  page,
}) => {
  const errors = failOnAppErrors(page);

  await page.goto("/planner-staging.html?course=PY%20208&theme=dark");
  await expect(page.locator("html")).toHaveAttribute("data-mpp-theme", "dark");

  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mpp-theme", "light");

  await page.getByRole("button", { name: "Add to cart" }).first().click();
  await expect(page.getByText("Added to cart").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("lists the schedule and replaces a cart section", async ({ page }) => {
  const errors = failOnAppErrors(page);

  await page.goto("/planner-staging.html?tab=schedule");
  const courses = page.getByRole("list", { name: "Your courses" });
  for (const code of ["CSC 326", "CSC 411", "ENG 331", "ST 370"]) {
    await expect(courses.getByText(code, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByText("Courses in your cart aren't enrolled yet"),
  ).toBeVisible();

  // The course row, not the section cards nested inside it.
  const eng = courses
    .getByRole("listitem")
    .filter({ has: page.getByText("ENG 331", { exact: true }) })
    .first();
  await eng.getByRole("button", { name: "Show other sections" }).click();
  await expect(
    eng.getByRole("button", { name: "Replace", exact: true }).first(),
  ).toBeVisible();
  const replacement = await eng.getByRole("option").first().innerText();
  const replacementSection = replacement.match(/Section (\S+)/)![1];

  await eng
    .getByRole("button", { name: "Replace", exact: true })
    .first()
    .click();
  await expect(page.getByText("Replace in cart?")).toBeVisible();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Replace", exact: true })
    .click();
  await expect(eng.locator("p").first()).toContainText(
    `Sec ${replacementSection}`,
  );
  expect(errors).toEqual([]);
});
