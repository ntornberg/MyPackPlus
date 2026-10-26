import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1368, height: 912 } });

test("selected filter labels wrap and remain searchable and clearable", async ({
  page,
}) => {
  // A long course title, so the selected label has to wrap.
  await page.goto("/planner-staging.html?course=CSC%20246&theme=dark");
  await page
    .getByRole("button", { name: "Browse by subject", exact: true })
    .click();
  const course = page.getByRole("combobox", { name: "Course", exact: true });
  const group = course.locator("..");
  const label = group.locator('span[aria-hidden="true"]');
  await expect(label).toContainText("Operating Systems");
  expect(await label.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(
    await label.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThan(35);
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await page.screenshot({ path: join(tmpdir(), "planner-course-labels.png") });
  await course.focus();
  await expect(label).toHaveCSS("visibility", "hidden");
  await course.fill("316");
  await page.getByRole("option", { name: /CSC-316/ }).click();
  await page.getByText(/^Use Search to filter, then pick a row/).click();
  await expect(label).toContainText("CSC-316");
  await expect(label).toHaveCSS("visibility", "visible");
  await group.locator('[data-slot="combobox-clear"]').click();
  await expect(course).toHaveValue("");
  await expect(label).toHaveCount(0);
});

test("requirement source and program labels fit the narrow panel", async ({
  page,
}) => {
  await page.route("https://**/*", (route) =>
    route.fulfill({ json: { data: { courses: [], profs: [] } } }),
  );
  await page.goto("/planner-staging.html?personal");
  for (const name of ["My requirements", "Explore majors"]) {
    const button = page.getByRole("radio", { name, exact: true });
    await expect(button).toBeVisible();
    expect(
      await button.evaluate(
        (el) =>
          el.scrollWidth <= el.clientWidth &&
          el.scrollHeight <= el.clientHeight,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: join(tmpdir(), "planner-filter-labels.png") });
  await page
    .getByRole("radio", { name: "Explore majors", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Explore majors", exact: true }),
  ).toBeChecked();
});
