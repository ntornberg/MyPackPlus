import { expect, test } from "@playwright/test";

test("calendar hover card supports focus, hover, fallback and cached reopening", async ({
  page,
}) => {
  let requests = 0;
  let slowStarted = false;
  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  await page.route(
    "https://**/functions/v1/grades-v2-course",
    async (route) => {
      requests++;
      const request = route.request().postDataJSON();
      if (request.course === "MA 241") {
        slowStarted = true;
        await slowGate;
      }
      await route.fulfill({
        json: {
          data: {
            results: [
              {
                request,
                ambiguous: false,
                instructor_id: null,
                grade:
                  request.instructor_name && request.course === "CSC 316"
                    ? null
                    : {
                        a_average: request.course === "MA 242" ? 90 : 60,
                        b_average: request.course === "MA 242" ? 0 : 30,
                        c_average: 10,
                        d_average: 0,
                        f_average: 0,
                      },
              },
            ],
            instructors: {},
          },
          meta: {},
        },
      });
    },
  );
  await page.goto("/planner-staging.html?bare");
  await page.evaluate(async () => {
    const paths = {
      react: "/node_modules/.vite/deps/react.js",
      dom: "/node_modules/.vite/deps/react-dom_client.js",
      view: "/src/course-management/components/calendar/CalendarView.tsx",
    };
    const [React, ReactDOM, { CalendarView }] = await Promise.all([
      import(paths.react),
      import(paths.dom),
      import(paths.view),
    ]);
    document.getElementById("root")!.hidden = true;
    document
      .getElementById("extension-overlay-root")
      ?.setAttribute("id", "hidden-staging-overlay");
    const host = document.createElement("div");
    host.id = "extension-overlay-root";
    document.body.append(host);
    const event = {
      id: 1,
      subj: "CSC 316",
      color: "#123456",
      start: "9:00 AM",
      end: "10:00 AM",
      days: [{ day: "Mon", isOverlapping: false }],
      course: {
        code: "CSC 316",
        section: "001",
        title: "Data Structures",
        location: "Engineering",
        instructors: [{ name: "Teacher" }],
      },
    };
    ReactDOM.default.createRoot(host).render(
      React.default.createElement(CalendarView, {
        staticBackgroundEvents: [
          event,
          { ...event, id: 2, allDay: true },
          ...["MA 241", "MA 242"].map((code, i) => ({
            ...event,
            id: i + 3,
            allDay: true,
            subj: code,
            course: { ...event.course, code },
          })),
        ],
      }),
    );
  });
  const block = page
    .locator('#extension-overlay-root [data-calendar-event="1"]')
    .first();
  await block.focus();
  const card = page.getByRole("dialog", { name: "CSC 316 class information" });
  await expect(card).toContainText("Data Structures");
  await expect(card).toContainText("Course-wide grade history");
  await expect(card).toContainText("A: 60%");
  expect(requests).toBe(2);
  await card.hover();
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await page
    .locator('#extension-overlay-root [data-calendar-event="2"]')
    .hover();
  await expect(card).toContainText("Online / no fixed meeting time");
  await expect(card).toContainText("A: 60%");
  expect(requests).toBe(2);
  await page
    .locator('#extension-overlay-root [data-calendar-event="3"]')
    .focus();
  await expect.poll(() => slowStarted).toBe(true);
  await page
    .locator('#extension-overlay-root [data-calendar-event="4"]')
    .focus();
  const fastCard = page.getByRole("dialog", {
    name: "MA 242 class information",
  });
  await expect(fastCard).toContainText("A: 90%");
  const slowResponse = page.waitForResponse(
    (response) => response.request().postData()?.includes("MA 241") ?? false,
  );
  releaseSlow();
  await slowResponse;
  await expect(fastCard).toContainText("A: 90%");
});

test("native calendar supplements the original popup and handles redraw and term changes", async ({
  page,
}, testInfo) => {
  await page.route("https://**/functions/v1/**", (route) =>
    route.fulfill({
      json: { data: { results: [], instructors: {} }, meta: {} },
    }),
  );
  await page.goto("/planner-staging.html?bare");
  await page.evaluate(async () => {
    document.getElementById("root")!.hidden = true;
    document
      .getElementById("extension-overlay-root")
      ?.setAttribute("id", "hidden-staging-overlay");
    const fixture = document.createElement("div");
    fixture.innerHTML =
      '<select id="enroll-term-select"><option>2027 Spring Term</option><option>2026 Fall Term</option></select><div id="calendar-container"><div id="enroll-wizard-calendar"><div class="fc-event tooltipstered" tabindex="0" aria-label="My Shopping Cart item"><span class="fc-event-title">CSC 316 (601)</span></div><div class="fc-event" tabindex="0" aria-label="My Event"><span class="fc-event-title">Lunch</span></div></div></div>';
    document.body.append(fixture);
    fixture
      .querySelector(".fc-event")!
      .addEventListener("click", () => (fixture.dataset.clicked = "yes"));
    fixture.id = "native-fixture";
    const original = document.createElement("div");
    original.className = "tooltipster-base";
    original.style.cssText =
      "position:fixed;left:20px;top:90px;width:220px;height:120px;background:white;border:1px solid black;display:none;z-index:9999";
    original.innerHTML =
      '<div class="tooltipster-content">CSC 316 (601)<button id="original-action">Original MyPack action</button></div>';
    document.body.append(original);
    fixture.querySelector(".fc-event")!.addEventListener("pointerenter", () => {
      original.style.display = "block";
    });
    fixture.querySelector(".fc-event")!.addEventListener("focusin", () => {
      original.style.display = "block";
    });
    original
      .querySelector("button")!
      .addEventListener("click", () => (original.dataset.clicked = "yes"));
    const paths = {
      cache: "/src/course-management/cache/courseRetrieval.ts",
      native: "/src/course-management/components/calendar/nativeCalendar.tsx",
      css: "/src/index.css?inline",
    };
    const [{ setGenericCache }, { watchNativeCalendar }, css] =
      await Promise.all([
        import(paths.cache),
        import(paths.native),
        import(paths.css),
      ]);
    await setGenericCache("shopCartTableData", {
      hover: {
        classs: "CSC 316",
        crse_title: "Data Structures",
        _mypackTerm: "2027 Spring Term",
        section_details: [
          {
            section: "601",
            meet_days: null,
            time: null,
            instructors: ["Teacher"],
            location: "Online",
          },
        ],
      },
    });
    watchNativeCalendar(css.default);
  });
  const course = page.locator('.fc-event[aria-label="My Shopping Cart item"]');
  await expect(page.locator("#extension-overlay-root")).toBeAttached();
  await course.hover();
  const card = page.getByRole("dialog", { name: "CSC 316 class information" });
  await expect(card).toContainText("Data Structures");
  // Moving between the event's children must not close and reopen the card,
  // which restarts its animation. Both flips land in one task, so read them
  // from the mutation records rather than the current attribute.
  await card.evaluate((element) => {
    const root = element.getRootNode() as Document | ShadowRoot;
    new MutationObserver((records) => {
      if (
        !element.isConnected ||
        records.some((record) => record.oldValue === "closed")
      )
        document.body.dataset.cardBlinked = "yes";
    }).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ["data-state"],
    });
  });
  const eventBox = (await course.boundingBox())!;
  const titleBox = (await course.locator(".fc-event-title").boundingBox())!;
  for (let i = 0; i < 4; i++) {
    await page.mouse.move(titleBox.x + 2, titleBox.y + titleBox.height / 2);
    await page.mouse.move(
      eventBox.x + eventBox.width - 4,
      eventBox.y + eventBox.height / 2,
    );
  }
  await page.waitForTimeout(100);
  await expect(card).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute(
    "data-card-blinked",
    "yes",
  );
  await expect(page.locator(".tooltipster-content")).toHaveText(
    "CSC 316 (601)Original MyPack action",
  );
  await page.locator("#original-action").click();
  await expect(page.locator(".tooltipster-base")).toHaveAttribute(
    "data-clicked",
    "yes",
  );
  await expect(card).toBeVisible();
  const originalBox = (await page.locator(".tooltipster-base").boundingBox())!;
  const extraBox = (await card.boundingBox())!;
  expect(
    extraBox.x >= originalBox.x + originalBox.width ||
      extraBox.x + extraBox.width <= originalBox.x ||
      extraBox.y >= originalBox.y + originalBox.height,
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("native-supplement.png") });
  await course.click();
  await expect(page.locator("#native-fixture")).toHaveAttribute(
    "data-clicked",
    "yes",
  );
  await page.evaluate(() => {
    const event = document.querySelector(".fc-event")!;
    event.replaceWith(event.cloneNode(true));
  });
  await expect(card).toBeHidden();
  await course.focus();
  await expect(card).toBeVisible();
  await page
    .locator("#enroll-term-select")
    .selectOption({ label: "2026 Fall Term" });
  await expect(card).toBeHidden();
  await expect(course).toHaveClass(/tooltipstered/);
  await expect(page.locator(".tooltipster-content")).toHaveText(
    "CSC 316 (601)Original MyPack action",
  );
});
