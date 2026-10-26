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
    page.getByRole("dialog", { name: "Pack Planner" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "Planner search tabs" }),
  ).toBeVisible();
  for (const name of [
    "Course Search",
    "GEP Search",
    "Major Plan Search",
    "Instructors",
  ]) {
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  }
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

  await page.getByRole("tab", { name: "Instructors" }).click();
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
