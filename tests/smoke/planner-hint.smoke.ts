import { expect, test } from "@playwright/test";

test("launcher hint disappears and stays dismissed without a guide dialog", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await page.goto("/planner-staging.html?launcher");
  const hint = page.getByRole("tooltip");
  await expect(hint).toHaveText("Plan your courses here");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const bubble = page.locator('[data-slot="tooltip-content"]');
  const bounds = await bubble.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({ path: testInfo.outputPath("planner-hint.png") });
  await page.clock.fastForward(6100);
  await expect(hint).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open Pack Planner" }),
  ).toBeVisible();
  await expect(hint).toHaveCount(0);
});

test("opening the planner dismisses the hint immediately", async ({ page }) => {
  await page.route("https://**/*", (route) => route.fulfill({ json: {} }));
  await page.goto("/planner-staging.html?launcher");
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.getByRole("button", { name: "Open Pack Planner" }).click();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Pack Planner", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("firstStartDismissed")),
  ).toBe("true");
});
