import {
  auditKey,
  DEGREE_AUDITS_STORAGE_KEY,
  parseDegreeDetailsResponse,
} from "../../degree-planning/services/degreeAudit";
import {
  personalAuditFixture,
  requirementFixture,
} from "../../degree-planning/services/fixtures/personalPlanning";
import { PACK_PLANNER_STORAGE_KEY } from "../../degree-planning/services/packPlanner";
import { PLANNING_SYNCED_AT_KEY } from "../../degree-planning/services/planningSync";
import {
  parseRequirementChoices,
  REQUIREMENT_CHOICES_STORAGE_KEY,
} from "../../degree-planning/services/requirementChoices";
import { DEPT_COURSES } from "../../generated/catalogs/course-search/departmentCourses.typed";

/** A fictional Computer Science BS student, partway through the degree. */

const courseIds = new Map(
  Object.values(DEPT_COURSES).flatMap((courses) =>
    Object.entries(courses as Record<string, { course_id: string }>).map(
      ([code, course]) => [code.replace("-", " "), course.course_id] as const,
    ),
  ),
);

type LineStatus = "C" | "E" | "P" | "U";

function line(
  code: string,
  title: string,
  status: LineStatus,
  extras: {
    term?: [string, string];
    grade?: string;
    requirement?: [string, string];
  } = {},
) {
  const [subject = "", catalog = ""] = code ? code.split(" ") : [];
  const [term, termDescr] = extras.term ?? ["", ""];
  const [requirement, reqDescr] = extras.requirement ?? ["", ""];
  return {
    subject,
    catalog_nbr: catalog,
    crse_id: code ? (courseIds.get(code) ?? "") : "",
    crse_offer_nbr: code ? "1" : "",
    descr: title,
    term,
    term_descr: termDescr,
    grade: extras.grade ?? "",
    units: status === "U" ? "Verify" : "3.000",
    requirement,
    req_descr: reqDescr,
    status,
    MultipleUse: "N",
    is_exc_req: "",
    note: "",
  };
}

const FALL_25: [string, string] = ["2258", "Fall '25"];
const SPRING_26: [string, string] = ["2261", "Spring '26"];
const FALL_26: [string, string] = ["2268", "Fall '26"];
const SPRING_27: [string, string] = ["2271", "Spring '27"];
const CSC_ELECTIVES: [string, string] = ["000301", "CSC Advanced Electives"];
const STATISTICS: [string, string] = ["000302", "Statistics Requirement"];

const demoAuditHtml = `<script>var details = ${JSON.stringify({
  rqrmnt_groups: [
    {
      rq_grp_nbr: "000100",
      rq_grp_descr: "Computer Science Core",
      min_units_reqd: "24",
      rq_grp_lines: [
        line("CSC 116", "Introduction to Computing - Java", "C", {
          term: FALL_25,
          grade: "A",
        }),
        line("CSC 216", "Software Development Fundamentals", "C", {
          term: SPRING_26,
          grade: "A-",
        }),
        line("CSC 226", "Discrete Mathematics", "C", {
          term: SPRING_26,
          grade: "B+",
        }),
        line("CSC 230", "C and Software Tools", "E", { term: FALL_26 }),
        line("CSC 316", "Data Structures and Algorithms", "P", {
          term: SPRING_27,
        }),
        line("CSC 326", "Software Engineering", "P", { term: SPRING_27 }),
        line("CSC 333", "Automata, Grammars, and Computability", "U"),
        line("CSC 246", "Operating Systems for Computer Scientists", "U"),
      ],
    },
    {
      rq_grp_nbr: "000200",
      rq_grp_descr: "Mathematics and Statistics",
      min_units_reqd: "12",
      rq_grp_lines: [
        line("MA 141", "Calculus I", "C", { term: FALL_25, grade: "A" }),
        line("MA 241", "Calculus II", "E", { term: FALL_26 }),
        line("", "Statistics Requirement", "U", { requirement: STATISTICS }),
      ],
    },
    {
      rq_grp_nbr: "000300",
      rq_grp_descr: "Advanced Electives",
      min_units_reqd: "9",
      rq_grp_lines: [
        line("CSC 411", "Introduction to Artificial Intelligence", "P", {
          term: SPRING_27,
          requirement: CSC_ELECTIVES,
        }),
        line("", "CSC Advanced Electives", "U", { requirement: CSC_ELECTIVES }),
      ],
    },
    {
      rq_grp_nbr: "000400",
      rq_grp_descr: "General Education Program",
      min_units_reqd: "39",
      // GEP categories are matched by requirement name; no id, so no
      // approved-course list is requested for them.
      rq_grp_lines: [
        line("HI 254", "Modern U.S. History", "C", {
          term: FALL_25,
          grade: "A",
          requirement: ["", "GEP Humanities"],
        }),
        line("ENG 265", "American Literature I", "C", {
          term: SPRING_26,
          grade: "B+",
          requirement: ["", "GEP Foundations of American Democracy"],
        }),
        line("MA 141", "Calculus I", "C", {
          term: FALL_25,
          grade: "A",
          requirement: ["", "GEP Mathematical Sciences"],
        }),
        line("PY 205", "Physics for Engineers and Scientists I", "E", {
          term: FALL_26,
          requirement: ["", "GEP Natural Sciences"],
        }),
        line("PSY 200", "Introduction to Psychology", "P", {
          term: SPRING_27,
          requirement: ["", "GEP Social Sciences"],
        }),
        line("HESF 101", "Fitness and Wellness", "C", {
          term: FALL_25,
          grade: "S",
          requirement: ["", "GEP Health and Exercise Studies"],
        }),
        ...[
          "GEP Visual and Performing Arts",
          "GEP Interdisciplinary Perspectives",
          "GEP Global Knowledge",
          "GEP U.S. Diversity",
        ].map((name) => line("", name, "U", { requirement: ["", name] })),
      ],
    },
  ],
})};</script>`;

const demoAuditUrl =
  "https://portalsp.acs.ncsu.edu/psc/CS92PRD/EMPLOYEE/NCSIS/s/WEBLIB_DEGAUDIT.ISCRIPT1.FieldFormula.IScript_getDegreeDetails?acad_plan=14CSCBS&acad_sub_plan=NOSUBPLAN&acad_plan_type=MAJ&req_term=2258";

function approved(code: string, title: string) {
  const [subject, catalog] = code.split(" ") as [string, string];
  return {
    crse_id: courseIds.get(code) ?? "",
    crse_offer_nbr: "1",
    subject,
    catalog_nbr: catalog,
    crse_title: title,
    units_min: "3.00",
    units_max: "3.00",
    take_units: "3.00",
    pending_type: "",
  };
}

function choiceList(
  [requirement, name]: [string, string],
  minUnits: string,
  courses: [string, string][],
) {
  return {
    requirement,
    rq_main_descr: name,
    rq_main_min_units_reqd: minUnits,
    rq_main_min_crses_reqd: "0.00",
    rq_main_code: "",
    message: "",
    rq_lines: [
      {
        rq_line_key_nbr: "0001",
        rq_line_descr: `Choose from approved ${name.toLowerCase()}`,
        rq_line_min_units_reqd: "0.00",
        rq_line_max_units_allowd: "0.00",
        rq_line_grade_points_min: "0.00",
        courses: courses.map(([code, title]) => approved(code, title)),
      },
    ],
  };
}

const demoChoices = {
  [CSC_ELECTIVES[0]]: choiceList(CSC_ELECTIVES, "9.00", [
    ["CSC 401", "Data and Computer Communications Networks"],
    ["CSC 411", "Introduction to Artificial Intelligence"],
    ["CSC 422", "Automated Learning and Data Analysis"],
    ["CSC 440", "Database Management Systems"],
    ["CSC 453", "Introduction to Internet of Things [IoT] Systems"],
    ["CSC 461", "Computer Graphics"],
  ]),
  [STATISTICS[0]]: choiceList(STATISTICS, "3.00", [
    ["ST 370", "Probability and Statistics for Engineers"],
    ["ST 371", "Introduction to Probability and Distribution Theory"],
  ]),
};

/**
 * chrome.storage contents for the Major Plan tab. `dataset: "test"` keeps the
 * synthetic TST audit the personal-planning smoke tests assert on.
 */
export function stagingPlanningStorage({
  dataset,
  choicesUnavailable,
}: {
  dataset: "demo" | "test";
  choicesUnavailable: boolean;
}): Record<string, unknown> {
  const now = Date.now();
  const audit =
    dataset === "test"
      ? { ...personalAuditFixture, capturedAt: now }
      : {
          ...parseDegreeDetailsResponse(demoAuditHtml, demoAuditUrl, now)!,
          name: "Computer Science BS",
        };
  const lists =
    dataset === "test"
      ? {
          "000001": requirementFixture(),
          "000002": requirementFixture("000002"),
        }
      : demoChoices;
  const results = Object.fromEntries(
    Object.entries(lists).map(([requirement, list], index) => [
      `${requirement}|`,
      choicesUnavailable && index === 1
        ? { error: "Choices unavailable: session expired" }
        : {
            list: parseRequirementChoices(list, requirement),
            capturedAt: now,
          },
    ]),
  );
  return {
    [DEGREE_AUDITS_STORAGE_KEY]: { [auditKey(audit)]: audit },
    [PLANNING_SYNCED_AT_KEY]: now,
    [REQUIREMENT_CHOICES_STORAGE_KEY]: {
      [auditKey(audit)]: {
        auditCapturedAt: audit.capturedAt,
        capturedAt: now,
        results,
      },
    },
    [PACK_PLANNER_STORAGE_KEY]:
      dataset === "test"
        ? {}
        : {
            "2271": {
              strm: "2271",
              term: "2027 Spring Term",
              courses: [
                { courseId: "4417", subject: "CSC", catalogNbr: "316" },
                { courseId: "4422", subject: "CSC", catalogNbr: "326" },
                { courseId: "4437", subject: "CSC", catalogNbr: "411" },
              ],
            },
          },
  };
}
