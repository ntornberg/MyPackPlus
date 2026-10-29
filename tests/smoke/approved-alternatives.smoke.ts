import { expect, test } from "@playwright/test";
import type { DegreeAudit } from "../../src/degree-planning/services/degreeAudit";
import type { RequirementChoices } from "../../src/degree-planning/services/requirementChoices";

const registrarHtml = `<div class="course"><h1>TST 440 <small>Database Systems</small><span class="units">Units: 3</span></h1><p>Synthetic section</p><table class="section-table"><tbody><tr><td>001</td><td>LEC</td><td>12345</td><td><span>Open</span> 10/30</td><td>MoWe 10:00 AM - 11:15 AM</td><td>Test Hall</td><td><a class="instructor-link">Test Instructor</a></td><td>01/01/2027 - 05/01/2027</td><td></td><td></td></tr></tbody></table></div>`;

for (const status of ["P", "E"] as const) {
  test(`approved alternatives remain browsable for ${status === "P" ? "planned" : "enrolled"} requirements`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://**/*", (route) =>
      route.request().method() === "POST" &&
      route.request().headers()["content-type"]?.includes("form-urlencoded")
        ? route.fulfill({ body: JSON.stringify({ html: registrarHtml }) })
        : route.fulfill({
            json: { data: { results: [], instructors: {} }, meta: {} },
          }),
    );
    await page.goto("/planner-staging.html?personal&network=real");
    await expect(page.getByText(/Fall 2023 catalog/)).toBeVisible();
    await page.evaluate(async (status) => {
      const stored = await chrome.storage.local.get([
        "degreeAudits",
        "degreeRequirementChoices",
      ]);
      const audits = stored.degreeAudits as Record<string, DegreeAudit>;
      const choices = stored.degreeRequirementChoices as Record<
        string,
        RequirementChoices
      >;
      for (const [key, audit] of Object.entries(audits)) {
        audit.capturedAt += 1;
        for (const group of audit.groups) {
          if (group.id !== "200") continue;
          group.lines = group.lines.filter((line) => line.status !== "U");
          for (const line of group.lines) {
            if (line.status === "P" || line.status === "E")
              line.status = status;
          }
          group.status = status;
        }
        choices[key].auditCapturedAt = audit.capturedAt;
      }
      await chrome.storage.local.set({
        degreeAudits: audits,
        degreeRequirementChoices: choices,
      });
    }, status);
    await page.getByRole("radio", { name: "All", exact: true }).click();
    const group = page
      .locator("details")
      .filter({
        has: page.locator("summary").filter({ hasText: "Other Electives" }),
      })
      .first();
    await group.locator("summary").first().click();
    await expect(
      group.getByText(/Approved alternatives/).first(),
    ).toBeVisible();
    await expect(group.getByText("Approved Course 440").first()).toBeVisible();
    await expect(group.getByText("Still needed to finish")).toHaveCount(0);
    await expect(
      group
        .locator("[data-course-row]")
        .filter({
          hasText: status === "P" ? "Parallel Computing" : "Security Topics",
        })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Refresh sections", exact: true }),
    ).toBeEnabled();
    await expect(group.getByText("Open to load sections")).toHaveCount(0);
    await group
      .getByRole("button", { name: /Approved Course 440/ })
      .first()
      .click();
    await expect(
      page.getByText("Test Instructor", { exact: true }).first(),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
