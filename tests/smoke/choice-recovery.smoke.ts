import { expect, test, type Page, type Route } from "@playwright/test";
const requirementFixture = (requirement: string) => ({
  requirement,
  rq_main_descr: "Approved choices",
  rq_main_min_units_reqd: "3",
  rq_main_min_crses_reqd: "1",
  rq_main_code: "",
  message: "",
  rq_lines: [
    {
      rq_line_key_nbr: "1",
      rq_line_descr: "Options",
      rq_line_min_units_reqd: "3",
      rq_line_max_units_allowd: "3",
      rq_line_grade_points_min: "0",
      courses: [
        {
          crse_id: "000440",
          crse_offer_nbr: "1",
          subject: "TST",
          catalog_nbr: "440",
          crse_title: "Approved Course 440",
          units_min: "3",
          units_max: "3",
          take_units: "3",
          pending_type: "",
        },
      ],
    },
  ],
});

const portal = "https://portalsp.acs.ncsu.edu";
const path = "/psc/CS92PRD/EMPLOYEE/NCSIS/c/planner-test";
const listScript = "IScript_getRequirementList";
const registrarHtml = `<div class="course"><h1>TST 440 <small>Database Systems</small><span class="units">Units: 3</span></h1><p>Synthetic section</p><table class="section-table"><tbody><tr><td>001</td><td>LEC</td><td>12345</td><td><span>Open</span> 10/30</td><td>MoWe 10:00 AM - 11:15 AM</td><td>Test Hall</td><td><a class="instructor-link">Test Instructor</a></td><td>01/01/2027 - 05/01/2027</td><td></td><td></td></tr></tbody></table></div>`;

/** Serve local staging under a mocked portal origin; no request reaches MyPack. */
async function setup(
  page: Page,
  handleList: (route: Route, id: string) => Promise<void>,
  onTrack = false,
) {
  await page.route("https://**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === portal) {
      if (url.pathname.includes(listScript))
        return handleList(route, url.searchParams.get("requirement")!);
      if (url.pathname.includes("/s/"))
        return route.fulfill({ status: 503, body: "Unexpected script" });
      const localPath =
        url.pathname === path ? "/planner-staging.html" : url.pathname;
      const response = await route.fetch({
        url: "http://127.0.0.1:4173" + localPath + url.search,
      });
      return route.fulfill({ response });
    }
    return route.fulfill({
      json:
        route.request().method() === "POST" &&
        route.request().headers()["content-type"]?.includes("form-urlencoded")
          ? { html: registrarHtml }
          : { data: { results: [], instructors: {} }, meta: {} },
    });
  });
  await page.goto(portal + path + "?bare&network=real");
  // Mount the real Major Plan component with test-owned props and a synthetic audit.
  await page.evaluate(async (onTrack) => {
    const { personalAuditFixture } = await import(
      "/src/degree-planning/services/fixtures/personalPlanning.ts"
    );
    const audit = structuredClone({
      ...personalAuditFixture,
      capturedAt: Date.now(),
    });
    if (onTrack)
      for (const group of audit.groups)
        group.lines = group.lines.filter((line) => line.status !== "U");
    const { default: ReactDOM } = await import(
      "/node_modules/.vite/deps/react-dom_client.js"
    );
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const { default: MajorPlanSearch } = await import(
      "/src/course-management/components/search-tabs/MajorPlanSearch.tsx"
    );
    const { MajorPlanSearchDataInitialState } = await import(
      "/src/course-management/components/tab-state/tabState.ts"
    );
    await chrome.storage.local.set({
      degreeAudits: {
        [audit.plan + "|" + audit.subplan + "|" + audit.reqTerm]: audit,
      },
      planningDataSyncedAt: Date.now(),
    });
    function Harness() {
      const [state, setState] = React.useState({
        ...MajorPlanSearchDataInitialState,
        selectedTerm: "2027 Spring Term",
        planSource: "personal",
        requirementFilter: "all",
        hideNoSections: false,
      });
      return React.createElement(MajorPlanSearch, {
        majorPlanSearchData: state,
        setMajorPlanSearchTabData: (key: unknown, value: unknown) =>
          setState((previous: object) => ({
            ...previous,
            ...(typeof key === "string" ? { [key]: value } : (key as object)),
          })),
        onPreviewSectionChange: () => {},
        selectedPreviewId: null,
        previewContent: null,
      });
    }
    ReactDOM.createRoot(document.getElementById("root")!).render(
      React.createElement(Harness),
    );
  }, onTrack);
}
const group = (page: Page) =>
  page
    .locator("details")
    .filter({
      has: page.locator("summary").filter({ hasText: "Other Electives" }),
    })
    .first();

test("partial choices remain usable, retry targets only failed lists, and refresh sections does not reload choices", async ({
  page,
}) => {
  const calls: string[] = [];
  let release!: () => void;
  let fail = true;
  await setup(page, async (route, id) => {
    calls.push(id);
    if (id === "000002" && fail) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return route.fulfill({ status: 503, body: "Unavailable" });
    }
    return route.fulfill({ json: requirementFixture(id) });
  });
  await expect(
    page.getByText("Loading approved choices: 1 of 2", { exact: true }),
  ).toBeVisible();
  await group(page).locator("summary").first().click();
  await expect(
    group(page).getByText("Approved Course 440").first(),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("button", { name: "Retry failed lists" }),
  ).toBeVisible();
  await expect(page.getByText(/Loading approved choices:/)).toHaveCount(0);
  expect(calls).toEqual(["000001", "000002"]);
  fail = false;
  await page.getByRole("button", { name: "Retry failed lists" }).click();
  await expect(
    page.getByRole("button", { name: "Retry failed lists" }),
  ).toHaveCount(0);
  expect(calls).toEqual(["000001", "000002", "000002"]);
  await expect(
    page.getByRole("button", { name: "Refresh sections" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Refresh sections" }).click();
  await expect(
    page.getByRole("button", { name: "Refresh sections" }),
  ).toBeEnabled();
  expect(calls).toHaveLength(3);
});

test("changing audit context ignores delayed results and preserves expanded groups on refresh", async ({
  page,
}) => {
  let release!: () => void;
  let delayed = true;
  const calls: string[] = [];
  await setup(page, async (route, id) => {
    calls.push(id);
    if (id === "000002" && delayed) {
      delayed = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return route.fulfill({ json: requirementFixture(id) });
  });
  await expect(
    page.getByText("Loading approved choices: 1 of 2", { exact: true }),
  ).toBeVisible();
  await group(page).locator("summary").first().click();
  await page.evaluate(async () => {
    const { degreeAudits } = await chrome.storage.local.get("degreeAudits");
    for (const audit of Object.values(degreeAudits) as { capturedAt: number }[])
      audit.capturedAt++;
    await chrome.storage.local.set({ degreeAudits });
  });
  await expect.poll(() => calls.length).toBe(4);
  release();
  await expect(page.getByText(/Loading approved choices:/)).toHaveCount(0);
  await expect(group(page)).toHaveAttribute("open", "");
  await expect(
    group(page).getByText("Approved Course 440").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry failed lists" }),
  ).toHaveCount(0);
});

test("planned and enrolled alternatives load once, only after their group opens", async ({
  page,
}) => {
  const calls: string[] = [];
  await setup(
    page,
    async (route, id) => {
      calls.push(id);
      return route.fulfill({ json: requirementFixture(id) });
    },
    true,
  );
  await expect(group(page).locator("summary")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh sections" }),
  ).toBeEnabled();
  expect(calls).toEqual([]);
  await group(page).locator("summary").first().click();
  await expect(
    group(page).getByText("Approved Course 440").first(),
  ).toBeVisible();
  expect(calls.sort()).toEqual(["000001", "000002"]);
  await group(page).locator("summary").first().click();
  await group(page).locator("summary").first().click();
  await expect(
    group(page).getByText("Approved Course 440").first(),
  ).toBeVisible();
  expect(calls).toHaveLength(2);
});
