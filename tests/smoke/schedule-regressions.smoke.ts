import { expect, test } from "@playwright/test";

test("selects cart and enrolled cards independently for the same course", async ({
  page,
}) => {
  await page.goto("/planner-staging.html?tab=schedule");
  const enrolled = page.getByRole("button", {
    name: /CSC 326.*Enrolled.*Software Engineering/,
  });
  await expect(enrolled).toBeVisible();
  await page.evaluate(async () => {
    const cachePath = "/src/course-management/cache/courseRetrieval.ts";
    const signalPath = "/src/course-management/cache/scheduleCacheSignal.ts";
    const { setGenericCache } = await import(cachePath);
    const { notifyScheduleDataChanged } = await import(signalPath);
    await setGenericCache("shopCartTableData", {
      duplicate: {
        classs: "CSC 326",
        crse_title: "Software Engineering",
        enroll_class_nbr: "99999",
        _mypackTerm: "2027 Spring Term",
        section_details: [
          {
            class_nbr: "99999",
            section: "002",
            meet_days: "Mon",
            time: "8:00 AM - 9:00 AM",
            type: "Lecture",
          },
        ],
      },
    });
    await notifyScheduleDataChanged();
  });
  const cart = page.getByRole("button", {
    name: /CSC 326.*Cart.*Software Engineering/,
  });
  await cart.click();
  await expect(cart).toHaveAttribute("aria-expanded", "true");
  await expect(enrolled).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("button", { name: "Replace", exact: true }).first(),
  ).toBeVisible();
  await enrolled.click();
  await expect(enrolled).toHaveAttribute("aria-expanded", "true");
  await expect(cart).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(/You're enrolled in this course/)).toBeVisible();
});

for (const restoreSucceeds of [false, true]) {
  test(`keeps the swap error visible after removal (recovery ${restoreSucceeds ? "succeeds" : "fails"})`, async ({
    page,
  }) => {
    await page.goto("/planner-staging.html?tab=schedule");
    await page.getByRole("button", { name: /Lab · Sec 201A/ }).click();
    await page.evaluate((restoreSucceeds) => {
      const originalFetch = window.fetch;
      let attempts = 0;
      window.fetch = async (...args) => {
        if (String(args[0]).includes("IScript_addClassToShopCart")) {
          attempts++;
          // Allow the removal notification to unmount the course picker.
          await new Promise((resolve) => setTimeout(resolve, 300));
          if (attempts === 1 || !restoreSucceeds) {
            return new Response(
              JSON.stringify({
                status: "error",
                message: "Test: class is full.",
              }),
            );
          }
        }
        return originalFetch(...args);
      };
    }, restoreSucceeds);
    await page
      .getByRole("button", { name: /Swap to/ })
      .first()
      .click();
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Section swap failed" });
    await expect(alert).toContainText("Test: class is full.");
    const course = page.getByRole("button", {
      name: /^CH 101\s*Cart/,
    });
    if (restoreSucceeds) {
      await expect(course).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Lab · Sec 201A/ }),
      ).toBeVisible();
    } else {
      await expect(course).toHaveCount(0);
      await expect(alert).toContainText("Add it to your cart again.");
    }
  });
}
