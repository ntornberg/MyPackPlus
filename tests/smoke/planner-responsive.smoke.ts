import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

for (const [width, height] of [
  [768, 1024],
  [820, 1180],
  [1024, 768],
  [1180, 820],
  [1244, 900],
  [1280, 800],
  [912, 1368],
  [1368, 912],
  [1440, 960],
  [1920, 1080],
]) {
  test(`planner fits ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/planner-staging.html");
    await expect(page).toHaveTitle("Pack Planner Staging");

    for (const tab of ["Course Search", "GEP Search", "Major Plan Search"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const row = page.getByRole("option").first();
      await row.click();
      await expect(row).toHaveAttribute("aria-selected", "true");
      const grades = row.getByRole("group", { name: "Grade distribution" });
      await expect(grades).toBeVisible();
      const bounds = await grades.evaluate((element) => {
        const title = element.previousElementSibling!.getBoundingClientRect();
        const chart = element.getBoundingClientRect();
        return { titleWidth: title.width, stacked: chart.top >= title.bottom };
      });
      expect(bounds.titleWidth).toBeGreaterThanOrEqual(220);
      // Narrow cards must put the chart below the title instead of squeezing it.
      if ((await row.boundingBox())!.width < 500)
        expect(bounds.stacked).toBe(true);

      const overflow = await page
        .locator("#extension-overlay-root")
        .evaluate((root) =>
          [
            root,
            ...root.querySelectorAll(
              '[role="option"], [data-slot="card"], .overflow-x-auto',
            ),
          ]
            .filter(
              (element): element is HTMLElement =>
                element instanceof HTMLElement,
            )
            .filter(
              (element) =>
                element.clientWidth > 0 &&
                element.scrollWidth > element.clientWidth + 2,
            )
            .map((element) => element.className),
        );
      expect(overflow).toEqual([]);
    }
    await page.getByRole("tab", { name: "Course Search", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: "Course Search", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await page.screenshot({
      path: join(tmpdir(), `planner-${width}x${height}.png`),
      animations: "disabled",
    });
    expect(errors).toEqual([]);
  });
}
