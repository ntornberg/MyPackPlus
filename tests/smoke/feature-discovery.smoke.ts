import { expect, test } from "@playwright/test";

test("instructor and RMP cues explain separate actions without unsolicited hints", async ({
  page,
  isMobile,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://**/*", (route) =>
    route.fulfill({ json: { sections: [] } }),
  );
  await page.goto("/planner-staging.html");
  await expect(page).toHaveTitle("Pack Planner Staging");
  await expect(page.getByRole("tooltip")).toHaveCount(0);

  const instructor = page
    .getByRole("button", { name: /Jason.*King|King.*Jason/ })
    .first();
  await expect(instructor).toBeVisible();
  const card = page.getByRole("option").filter({ has: instructor });
  const otherCard = page
    .getByRole("option")
    .filter({ hasText: "PY 208" })
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
  await expect(page.getByRole("dialog")).toContainText("Grade history");
  await expect(card).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await instructor.click();
  await expect(page.getByRole("dialog")).toContainText("Grade history");
  await expect(card).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Escape");

  const rmp = page
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
