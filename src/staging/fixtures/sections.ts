import { DEPT_COURSES } from "../../generated/catalogs/course-search/departmentCourses.typed";

import { instructorForSection } from "./instructors";
import { hashString, pick, seededRandom } from "./random";

/**
 * Dummy registrar sections for every catalog course. Data is derived from the
 * course code, so any course a tab asks for gets the same believable sections
 * on every load.
 */

const LECTURE_SLOTS = [
  "MW 8:30 AM - 9:45 AM",
  "MW 10:15 AM - 11:30 AM",
  "MW 11:45 AM - 1:00 PM",
  "MW 1:30 PM - 2:45 PM",
  "MW 3:00 PM - 4:15 PM",
  "TuTh 8:30 AM - 9:45 AM",
  "TuTh 10:15 AM - 11:30 AM",
  "TuTh 11:45 AM - 1:00 PM",
  "TuTh 1:30 PM - 2:45 PM",
  "TuTh 3:00 PM - 4:15 PM",
  "MWF 9:35 AM - 10:25 AM",
  "MWF 10:40 AM - 11:30 AM",
  "MWF 12:50 PM - 1:40 PM",
];

const LAB_SLOTS = [
  "M 2:20 PM - 4:10 PM",
  "Tu 9:00 AM - 10:50 AM",
  "W 3:00 PM - 4:50 PM",
  "Th 1:30 PM - 3:20 PM",
  "F 11:45 AM - 1:35 PM",
];

const ROOMS = [
  "Engineering Bldg II 1231",
  "Engineering Bldg III 2211",
  "SAS Hall 1102",
  "Withers Hall 140",
  "Tompkins Hall G108",
  "Caldwell Hall G107",
  "Riddick Hall 301",
  "Poe Hall 216",
  "Harrelson Hall 210",
  "Cox Hall 214",
];

/** Courses that always have labs, so lab pickers show up in screenshots. */
const LAB_COURSES = new Set([
  "PY 205",
  "PY 208",
  "CH 101",
  "CH 201",
  "BIO 181",
  "BIO 183",
  "CSC 116",
  "CSC 216",
]);

type DummySection = {
  section: string;
  component: "Lec" | "Lab";
  classNumber: string;
  availability: string;
  enrollment: string;
  dayTime: string;
  location: string;
  instructor: { name: string; unityId: string | null };
  notes?: string;
  requisites?: string;
};

function availability(random: () => number, capacity: number) {
  const roll = random();
  if (roll < 0.62) {
    const taken = Math.floor(capacity * (0.35 + random() * 0.6));
    return { availability: "Open", enrollment: `${taken}/${capacity}` };
  }
  if (roll < 0.82) {
    return { availability: "Closed", enrollment: `${capacity}/${capacity}` };
  }
  return { availability: "Waitlist", enrollment: `${capacity}/${capacity}` };
}

function sectionsFor(subject: string, catalogNum: string): DummySection[] {
  const code = `${subject} ${catalogNum}`;
  const random = seededRandom(`sections:${code}`);
  const graduate = Number.parseInt(catalogNum, 10) >= 500;
  const lectureCount = graduate ? 1 : 1 + Math.floor(random() * 3);
  const hasLabs = LAB_COURSES.has(code) || (!graduate && random() < 0.15);
  const sections: DummySection[] = [];
  for (let n = 1; n <= lectureCount; n++) {
    const section = `00${n}`;
    const capacity = graduate ? 30 : pick(random, [40, 60, 90, 120, 150]);
    const instructor = instructorForSection(subject, `${code}:${section}`);
    sections.push({
      section,
      component: "Lec",
      classNumber: String(10000 + (hashString(`${code}:${section}`) % 9000)),
      ...availability(random, capacity),
      dayTime: pick(random, LECTURE_SLOTS),
      location: pick(random, ROOMS),
      instructor: {
        name: instructor.instructor_name,
        unityId: instructor.unity_id,
      },
      ...(random() < 0.3
        ? { notes: "Students must also enroll in a linked lab or recitation." }
        : {}),
      ...(random() < 0.4
        ? {
            requisites: `Prerequisite: ${subject} ${Math.max(100, Number.parseInt(catalogNum, 10) - 100)} with a grade of C- or better.`,
          }
        : {}),
    });
    if (!hasLabs) continue;
    const labCount = 2 + Math.floor(random() * 3);
    for (let l = 0; l < labCount; l++) {
      const labSection = `20${n}${String.fromCharCode(65 + l)}`;
      const labInstructor = instructorForSection(
        subject,
        `${code}:${labSection}`,
      );
      sections.push({
        section: labSection,
        component: "Lab",
        classNumber: String(
          10000 + (hashString(`${code}:${labSection}`) % 9000),
        ),
        ...availability(random, 24),
        dayTime: LAB_SLOTS[(n + l) % LAB_SLOTS.length]!,
        location: pick(random, ROOMS),
        instructor: {
          name: labInstructor.instructor_name,
          unityId: labInstructor.unity_id,
        },
      });
    }
  }
  return sections;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function rowHtml(section: DummySection): string {
  const href = section.instructor.unityId
    ? ` href="https://directory.ncsu.edu/users/${section.instructor.unityId}"`
    : "";
  const popovers = [
    section.notes
      ? `<a data-toggle="popover" id="notes-${section.classNumber}" data-content="${escapeHtml(`<p>${section.notes}`)}">Notes</a>`
      : "",
    section.requisites
      ? `<a data-toggle="popover" id="reqs-${section.classNumber}" data-content="${escapeHtml(`<p>${section.requisites}</p>`)}">Reqs</a>`
      : "",
  ].join("");
  return [
    "<tr>",
    `<td>${section.section}</td>`,
    `<td>${section.component}</td>`,
    `<td>${section.classNumber}</td>`,
    `<td><span>${section.availability}</span> ${section.enrollment}</td>`,
    `<td>${section.dayTime}</td>`,
    `<td>${escapeHtml(section.location)}</td>`,
    `<td><a class="instructor-link"${href}>${escapeHtml(section.instructor.name)}</a></td>`,
    "<td>01/07/2027 - 04/23/2027</td>",
    "<td></td>",
    `<td>${popovers}</td>`,
    "</tr>",
  ].join("");
}

function courseHtml(code: string, title: string): string {
  const [subject, catalogNum] = code.split(" ") as [string, string];
  const random = seededRandom(`course:${code}`);
  const units = pick(random, ["3", "3", "3", "4", "1"]);
  return [
    '<div class="course">',
    `<h1>${code} <small>${escapeHtml(title)}</small><span class="units">Units: ${units}</span></h1>`,
    `<p>${escapeHtml(title)}: dummy catalog description for staging screenshots.</p>`,
    "<p></p>",
    '<table class="section-table"><tbody>',
    ...sectionsFor(subject, catalogNum).map(rowHtml),
    "</tbody></table>",
    "</div>",
  ].join("");
}

/** Catalog courses for a subject code ("CSC"), as `["CSC 316", title]`. */
function catalogCourses(subject: string): [string, string][] {
  const department = Object.entries(DEPT_COURSES).find(([name]) =>
    name.startsWith(`${subject} - `),
  )?.[1] as Record<string, { course_title: string }> | undefined;
  return Object.entries(department ?? {}).map(([code, course]) => [
    code.replace("-", " "),
    course.course_title,
  ]);
}

/**
 * Registrar search response for a `formCourseURL` body: one course when the
 * body asks for an exact course number, otherwise the whole subject.
 */
export function stagingRegistrarResponse(formData: string): string {
  const params = new URLSearchParams(formData);
  // The registrar takes the full label ("CSC - Computer Science").
  const subject = (params.get("subject") ?? "").split(" - ")[0]!.trim();
  const exact = params.get("course-inequality") === "=";
  const number = params.get("course-number") ?? "";
  const courses = catalogCourses(subject).filter(
    ([code]) =>
      !exact ||
      Number.parseInt(code.split(" ")[1]!, 10) === Number.parseInt(number, 10),
  );
  return JSON.stringify({
    html: courses.map(([code, title]) => courseHtml(code, title)).join(""),
  });
}
