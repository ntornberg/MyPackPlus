import { test, expect } from "@playwright/test";

test("special topics wrap in both densities", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://**/functions/v1/**", (r) =>
    r.fulfill({ json: { data: { results: [], instructors: {} }, meta: {} } }),
  );
  await page.route(
    "https://cloudflareworker.nicktornberg12.workers.dev/**",
    (r) => r.fulfill({ json: { html: "" } }),
  );
  const topic = "Generative AI for Computer Systems and Long Topic Names";
  await page.route(
    "https://webappprd.acs.ncsu.edu/php/coursecat/search.php",
    (r) =>
      r.fulfill({
        json: {
          html: `<section class="course"><h1>CSC 491 <small>Special Topics</small><span class="units">Units: 3</span></h1><p>Offering description</p><p>Prerequisites</p><table class="section-table"><tr><td>001</td><td>Lec</td><td>10001</td><td>Open 10/10</td><td>M 1:00 PM - 2:00 PM</td><td>Room</td><td></td><td>dates</td><td>${topic}</td><td></td></tr></table></section>`,
        },
      }),
  );
  await page.goto(
    "/planner-staging.html?network=real&course-search&theme=dark",
  );
  const finder = page.getByRole("combobox", {
    name: "Find a course",
    exact: true,
  });
  await finder.fill("CSC 491");
  await page
    .locator('[data-slot="combobox-list"]')
    .getByRole("option")
    .first()
    .waitFor();
  await finder.press("Enter");
  const card = page
    .getByRole("listbox", { name: "Course sections" })
    .getByRole("option")
    .first();
  await expect(card).toBeVisible();
  for (const density of ["Compact", "Detailed"]) {
    await page.getByRole("button", { name: "Planner settings" }).click();
    await page.getByRole("radio", { name: `${density} section cards` }).click();
    await page.keyboard.press("Escape");
    const label = card.getByText(`Topic: ${topic}`, { exact: true });
    await expect(label).toBeVisible();
    expect(
      await label.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await card.click();
    await expect(
      page.getByText(`Topic: ${topic}`, { exact: true }),
    ).toHaveCount(2);
    await page.screenshot({
      path: info.outputPath(`topics-${density}.png`),
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("native search topic link wraps with info toggled", async ({
  page,
}, info) => {
  await page.route("**/native-topic-fixture.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><head><title>Native topic fixture</title></head><body></body></html>",
    }),
  );
  await page.goto("/native-topic-fixture.html");
  await page.evaluate(async () => {
    const host = document.createElement("div");
    host.id = "testdivPSPAGECONTAINER";
    const frame = document.createElement("iframe");
    frame.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;z-index:999999;background:white";
    host.append(frame);
    document.body.append(host);
    const doc = frame.contentDocument!;
    doc.body.innerHTML = `<div role="dialog" class="ui-dialog cust-ui-dialog"><div class="ui-dialog-titlebar">Search results</div><div id="dialogTopics" style="position:relative"><table id="classSearchTable"><tbody><tr><td>-</td><td>CSC 491</td><td><a href="#details" style="display:block;max-width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Special Topics in CSC (Generative AI for Computer Systems and Long Topic Names)</a></td><td>Graded</td><td>3.00</td><td>Open</td><td><button>Add To Cart</button></td><td class="mypack-course-info-cell">Course information</td></tr><tr class="child"><td colspan="7">Section 001 - Wed/Fri</td><td class="mypack-extension-cell">Grades and ratings</td></tr></tbody></table></div></div>`;
    doc.querySelector("a")!.addEventListener("click", (e) => {
      e.preventDefault();
      doc.body.dataset.clicked = "yes";
    });
    const refreshPath = "/@react-refresh";
    const refresh = (await import(refreshPath)).default;
    refresh.injectIntoGlobalHook(window);
    Object.assign(window, {
      $RefreshReg$: () => {},
      $RefreshSig$: () => (type: unknown) => type,
      __vite_plugin_react_preamble_installed__: true,
    });
    const path = "/src/course-management/services/scraper.ts";
    const { applyIframeStyles } = await import(path);
    await applyIframeStyles(doc.querySelector("table"));
  });
  const frame = page.frameLocator("#testdivPSPAGECONTAINER iframe");
  const link = frame.getByRole("link");
  for (let i = 0; i < 2; i++) {
    await expect(link).toBeVisible();
    expect(
      await link.evaluate((el) => ({
        wrap: getComputedStyle(el).whiteSpace,
        fits: el.scrollWidth <= el.clientWidth + 1,
      })),
    ).toEqual({ wrap: "normal", fits: true });
    await expect(
      frame.getByRole("button", { name: "Add To Cart", exact: true }),
    ).toBeEnabled();
    await link.click();
    await page.screenshot({
      path: info.outputPath(`native-topics-${i}.png`),
      fullPage: true,
    });
    await frame
      .getByRole("button", {
        name:
          i === 0 ? "Hide extension info panel" : "Show extension info panel",
      })
      .click();
  }
});
