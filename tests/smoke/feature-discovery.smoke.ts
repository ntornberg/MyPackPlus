import { expect, test } from "@playwright/test";

test("instructor and RMP cues explain separate actions without unsolicited hints", async ({
  page,
  isMobile,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/planner-staging.html?course=CSC%20316");
  await expect(page).toHaveTitle("Pack Planner Staging");
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  // Staging instructors are fictional and generated from the course code.
  const instructor = page
    .getByRole("button", { name: "Marisol Reyes", exact: true })
    .first();
  await expect(instructor).toBeVisible();
  const card = page.locator('[role="option"]').filter({ has: instructor });
  const otherCard = page
    .locator('[role="option"]')
    .filter({ hasNot: instructor })
    .first();
  await otherCard.focus();
  await page.keyboard.press("Enter");
  await expect(card).toHaveAttribute("aria-selected", "false");
  if (!isMobile) {
    await instructor.hover();
    await expect(page.getByRole("tooltip")).toContainText("View ratings");
    await page.keyboard.press("Escape");
  }
  await instructor.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "View ratings, grade history & upcoming classes",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-slot="popover-content"]')).toContainText(
    "Grade history",
  );
  await expect(card).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await instructor.click();
  await expect(page.locator('[data-slot="popover-content"]')).toContainText(
    "Grade history",
  );
  await expect(card).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Escape");

  const rmp = card
    .getByRole("link", {
      name: /out of 5\. Open Rate My Professor in a new tab/,
    })
    .first();
  await expect(rmp).toContainText("RMP");
  await expect(rmp).toHaveAttribute("target", "_blank");
  await expect(rmp).toHaveAttribute("href", /ratemyprofessors\.com/);
  await rmp.focus();
  await expect(page.getByRole("tooltip")).toContainText(
    "Open Rate My Professor in a new tab",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await card.screenshot({
    path: testInfo.outputPath("feature-discovery.png"),
  });
  expect(errors).toEqual([]);
});
