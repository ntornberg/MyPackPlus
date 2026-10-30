import { test, expect } from "@playwright/test";

test("course info strip loads, then stays inside the native section cell", async ({
  page,
}, info) => {
  await page.route("**/course-info-strip-fixture.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><head><title>Course info strip fixture</title></head><body></body></html>",
    }),
  );
  await page.goto("/course-info-strip-fixture.html");
  await page.evaluate(async () => {
    const host = document.createElement("div");
    host.id = "testdivPSPAGECONTAINER";
    const frame = document.createElement("iframe");
    frame.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;z-index:999999;background:white";
    host.append(frame);
    document.body.append(host);
    const doc = frame.contentDocument!;
    const section = (n: string, days: string) =>
      `<tr><td>-</td><td>CSC 297</td><td>Cybersecurity Topics</td><td>Sat/Unsat</td><td>1.00</td><td>Open</td><td><button>Add To Cart</button></td></tr><tr class="child"><td colspan="7"><table id="searchResultsInner${n}"><thead><tr><th>SECTION</th><th>DAYS</th><th>INSTRUCTOR</th></tr></thead><tbody><tr><td>${n}</td><td>${days}</td><td data-label="INSTRUCTOR">Carter,Samuel William</td></tr></tbody></table></td></tr>`;
    doc.body.innerHTML = `<div role="dialog" class="ui-dialog cust-ui-dialog" style="width:900px"><div class="ui-dialog-titlebar">Search results</div><div id="dialogResults" style="position:relative"><table id="classSearchTable"><tbody>${section("002", "Tue")}${section("003", "Fri")}</tbody></table></div></div>`;

    const refreshPath = "/@react-refresh";
    const refresh = (await import(refreshPath)).default;
    refresh.injectIntoGlobalHook(window);
    Object.assign(window, {
      $RefreshReg$: () => {},
      $RefreshSig$: () => (type: unknown) => type,
      __vite_plugin_react_preamble_installed__: true,
    });
    const stripPath = "/src/course-management/services/courseInfoStrip.ts";
    const { renderCourseInfoPlaceholder, renderCourseInfoStrip } = await import(
      stripPath
    );
    const scraperPath = "/src/course-management/services/scraper.ts";
    const { applyIframeStyles } = await import(scraperPath);
    const card = (text: string) => {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText = "height:180px;border:1px solid #ccc";
      return el;
    };
    const course = { abr: "CSC 297", instructor: "Carter,Samuel William" };
    const rows = doc.querySelectorAll("tr.child");
    rows.forEach((row) => renderCourseInfoPlaceholder(row, course));
    await applyIframeStyles(doc.querySelector("#classSearchTable"));
    Object.assign(window, {
      finishLoading: () => {
        renderCourseInfoStrip(rows[0], course, {
          gradeElement: card("grade card"),
          professorElement: card("rmp card"),
          data: {
            CourseData: {
              course_name: "CSC 297",
              subject: "CSC",
              instructor_name: "Carter,Samuel William",
              a_average: 0,
              b_average: 0,
              c_average: 0,
              d_average: 0,
              f_average: 0,
              class_avg_min: 0,
              class_avg_max: 0,
              s_average: 95,
              u_average: 2,
              w_average: 3,
            },
            RateMyProfInfo: {
              master_name: "Carter,Samuel William",
              first_name: "Samuel William",
              last_name: "Carter",
              id: "2954321",
              avgRating: 4.6,
              numRatings: 3,
              avgDifficulty: 2.7,
              wouldTakeAgainPct: 100,
              ratingState: "rated",
            },
          },
        });
        renderCourseInfoStrip(rows[1], course, {
          gradeElement: card("grade card"),
          professorElement: card("rmp card"),
          data: null,
        });
      },
    });
  });

  const frame = page.frameLocator("#testdivPSPAGECONTAINER iframe");
  const loading = frame.getByRole("status");
  await expect(loading).toHaveCount(2);
  await expect(loading.first()).toContainText(
    "MyPack Plus is loading grades & ratings",
  );
  await expect(loading.first()).toContainText("Samuel William Carter");
  await page.screenshot({ path: info.outputPath("loading.png") });

  await page.evaluate(() =>
    (window as unknown as { finishLoading: () => void }).finishLoading(),
  );
  await expect(loading).toHaveCount(0);
  const summary = frame.locator(".mypack-info-strip-summary");
  await expect(summary).toHaveCount(1);
  await expect(summary).toContainText("Grades");
  for (const text of [
    "S 95%",
    "U 2%",
    "W 3%",
    "4.6 / 5",
    "3 ratings",
    "2.7 / 5 difficulty",
    "100% would take again",
  ]) {
    await expect(summary).toContainText(text);
  }
  await expect(
    summary.getByRole("img", { name: "4.6 out of 5 stars" }),
  ).toBeVisible();
  await expect(frame.locator(".mypack-info-strip--empty")).toContainText(
    "No grades or ratings",
  );
  // Collapsed, the strip adds a line or two and no column to MyPack's table.
  expect((await summary.boundingBox())!.height).toBeLessThan(64);
  expect(
    await frame
      .locator("#classSearchTable > tbody > tr.child")
      .first()
      .evaluate((row) => row.querySelectorAll(":scope > td").length),
  ).toBe(1);
  await page.screenshot({ path: info.outputPath("collapsed.png") });

  // Narrow dialogs wrap the RMP stats; labels and Details stay on the first
  // line, and a wrapped stat shows no leading divider.
  await frame
    .locator("#classSearchTable")
    .evaluate((table) => ((table as HTMLElement).style.width = "460px"));
  const tops = await summary.evaluate((el) =>
    [
      el.querySelector(".mypack-info-strip-label"),
      el.querySelector(".mypack-info-strip-row"),
      el.querySelector(".mypack-info-strip-more"),
    ].map((node) => Math.round(node!.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  const visibleDividerAtLineStart = await summary.evaluate((el) => {
    const rowLeft = el
      .querySelector(".mypack-info-strip-row")!
      .getBoundingClientRect().left;
    return [...el.querySelectorAll(".mypack-info-strip-stat")].some((stat) => {
      const left = stat.getBoundingClientRect().left;
      return left >= rowLeft - 0.5 && left < rowLeft + 4;
    });
  });
  expect(visibleDividerAtLineStart).toBe(false);
  await page.screenshot({ path: info.outputPath("narrow.png") });
  await frame
    .locator("#classSearchTable")
    .evaluate((table) => ((table as HTMLElement).style.width = ""));

  // The name opens RMP directly without expanding the details.
  const popup = page.waitForEvent("popup");
  await page
    .context()
    .route("https://www.ratemyprofessors.com/**", (r) =>
      r.fulfill({ body: "rmp" }),
    );
  await summary.getByRole("link", { name: /Samuel William Carter/ }).click();
  const rmp = await popup;
  await rmp.waitForLoadState();
  expect(rmp.url()).toContain("2954321");
  await expect(frame.getByText("grade card")).toBeHidden();

  await summary.click();
  await expect(frame.getByText("grade card")).toBeVisible();
  await expect(frame.getByText("rmp card")).toBeVisible();
  await page.screenshot({ path: info.outputPath("expanded.png") });
});
