import { expect, test } from "@playwright/test";

test("online cart courses appear above the hours and disappear after cart removal", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://**/*", (route) =>
    route.fulfill({ json: { data: { courses: [], profs: [] } } }),
  );
  await page.goto("/planner-staging.html?personal");
  await expect(page).toHaveTitle("Pack Planner Staging");

  await page.evaluate(async () => {
    const paths = {
      react: "/node_modules/.vite/deps/react.js",
      dom: "/node_modules/.vite/deps/react-dom_client.js",
      view: "/src/course-management/components/calendar/CalendarView.tsx",
      cache: "/src/course-management/cache/courseRetrieval.ts",
      storage: "/src/degree-planning/services/siteResponseStorage.ts",
      signal: "/src/course-management/cache/scheduleCacheSignal.ts",
    };
    const [
      React,
      ReactDOM,
      { CalendarView },
      { setGenericCache },
      { setupListener },
      { notifyScheduleDataChanged },
    ] = await Promise.all([
      import(paths.react),
      import(paths.dom),
      import(paths.view),
      import(paths.cache),
      import(paths.storage),
      import(paths.signal),
    ]);
    await setupListener();
    await setGenericCache("shopCartTableData", {
      online: {
        classs: "CSC 316",
        _mypackTerm: "2027 Spring Term",
        section_details: [
          { section: "601", meet_days: null, time: null, type: "Lecture" },
        ],
      },
    });
    await setGenericCache("shopCartCalEventsData", {
      dateOnly: { title: "CSC 316 (601)", start: "2026-10-26", allDay: true },
      repeated: { title: "CSC 316 (601)", start: "2026-10-28", allDay: true },
      midnight: {
        title: "CSC 316 (602)",
        start: "2026-10-26T00:00:00",
        end: "2026-10-27T00:00:00",
      },
      timed: {
        title: "CSC 316 (001)",
        start: "2026-10-26T11:45:00",
        end: "2026-10-26T13:00:00",
      },
    });
    await setGenericCache("scheduleCalEventsData", {
      enrolled: {
        title: "MA 241 (001)",
        start: "2026-10-27T09:00:00",
        end: "2026-10-27T10:00:00",
      },
    });
    await notifyScheduleDataChanged();

    document.getElementById("root")!.hidden = true;
    const host = document.createElement("div");
    host.id = "extension-overlay-root";
    host.setAttribute("data-mpp-theme", "dark");
    document.body.append(host);
    ReactDOM.default.createRoot(host).render(
      React.default.createElement(
        "div",
        {
          id: "calendar-test",
          className: "mypack-shell bg-background p-4 text-foreground",
        },
        React.default.createElement(CalendarView, {
          dayTime: "TBD",
          courseData: { code: "CSC 492 (601)" },
        }),
      ),
    );
  });

  const calendar = page.locator("#calendar-test");
  const untimed = calendar.getByRole("region", {
    name: "Online / no fixed meeting time",
  });
  await expect(untimed).toBeVisible();
  await expect(untimed.getByRole("listitem")).toHaveCount(3);
  await expect(
    untimed.getByText("CSC 316 (601)", { exact: true }),
  ).toBeVisible();
  await expect(
    untimed.getByText("CSC 316 (602)", { exact: true }),
  ).toBeVisible();
  await expect(
    untimed.getByText("CSC 492 (601)", { exact: true }),
  ).toBeVisible();
  await expect(untimed).not.toContainText("CSC 316 (001)");
  await expect(
    calendar.getByText("CSC 316 (001)", { exact: true }),
  ).toBeVisible();
  await expect(
    calendar.getByText("MA 241 (001)", { exact: true }),
  ).toBeVisible();
  await expect(calendar.getByText("12AM", { exact: true })).toHaveCount(0);
  await calendar.screenshot({
    path: testInfo.outputPath("online-courses.png"),
  });

  await page.evaluate(() => {
    for (const responseType of [
      "_getShopCartTableData",
      "_getShopCartCalEvents",
    ]) {
      window.postMessage(
        {
          source: "realFetchHook",
          type: "CLASS_DATA",
          payload: {
            responseType,
            data: [],
            fullSnapshot: true,
          },
        },
        window.location.origin,
      );
    }
  });
  await expect(untimed.getByRole("listitem")).toHaveCount(1);
  await expect(untimed).toContainText("CSC 492 (601)");
  await expect(
    calendar.getByText("CSC 316 (001)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    calendar.getByText("MA 241 (001)", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
