import type {
  RatingState,
  V2CoursesData,
  V2GradeRequest,
  V2Instructor,
  V2SearchData,
  V2UpcomingData,
  V2UpcomingSection,
} from "../../types/api";

import { hashString, pick, seededRandom } from "./random";

/**
 * Fictional instructors for staging screenshots. Names are invented; never
 * swap in real faculty, since staging screenshots end up in public listings.
 */
const ROSTER: { name: string; subjects: string[] }[] = [
  { name: "Okafor, Amara", subjects: ["CSC", "ECE"] },
  { name: "Lindqvist, Henrik", subjects: ["CSC"] },
  { name: "Reyes, Marisol", subjects: ["CSC", "ST"] },
  { name: "Whitfield, Graham", subjects: ["CSC"] },
  { name: "Nakamura, Rei", subjects: ["MA"] },
  { name: "Delacroix, Simone", subjects: ["MA", "ST"] },
  { name: "Brennan, Colm", subjects: ["MA"] },
  { name: "Adeyemi, Tobi", subjects: ["PY"] },
  { name: "Halvorsen, Ingrid", subjects: ["PY", "MAE"] },
  { name: "Castellano, Rafael", subjects: ["CH"] },
  { name: "Moreau, Elodie", subjects: ["CH", "BIO"] },
  { name: "Thornbury, Wes", subjects: ["BIO"] },
  { name: "Patel, Anika", subjects: ["BIO", "PSY"] },
  { name: "Galloway, June", subjects: ["ENG", "COM"] },
  { name: "Ferreira, Lucas", subjects: ["ENG", "HI"] },
  { name: "Ashworth, Pearl", subjects: ["HI", "PS"] },
  { name: "Kowalczyk, Marek", subjects: ["EC", "ST"] },
  { name: "Osei, Kwame", subjects: ["EC", "SOC"] },
  { name: "Sorensen, Dagny", subjects: ["PSY"] },
  { name: "Quinlan, Maeve", subjects: ["SOC", "ANT"] },
  { name: "Vasquez, Ines", subjects: ["PHI", "REL"] },
  { name: "Hargrove, Silas", subjects: ["ECE", "MAE"] },
  { name: "Ivanova, Tatiana", subjects: ["ECE"] },
  { name: "Beaumont, Clara", subjects: ["MUS", "ARS", "ADN"] },
];

function unityIdFor(name: string): string {
  const [last, first] = name.split(",").map((part) => part.trim());
  return `${first![0]}${last}`.toLowerCase().slice(0, 8);
}

/** Mostly rated, with a few of each empty state so those UIs show up too. */
function ratingStateFor(index: number): RatingState {
  if (index % 7 === 4) return "no_reviews";
  if (index % 11 === 9) return "unmatched";
  return "rated";
}

function buildInstructor(
  entry: (typeof ROSTER)[number],
  index: number,
): V2Instructor {
  const random = seededRandom(`instructor:${entry.name}`);
  const unityId = unityIdFor(entry.name);
  const ratingState = ratingStateFor(index);
  const [last, first] = entry.name.split(",").map((part) => part.trim());
  const rated = ratingState === "rated";
  const avgRating = rated ? Math.round((2.8 + random() * 2.1) * 10) / 10 : null;
  const numRatings = rated ? 6 + Math.floor(random() * 180) : null;
  const profileId = 9_000_000 + (hashString(entry.name) % 900_000);
  return {
    instructor_id: unityId,
    unity_id: unityId,
    instructor_name: entry.name,
    names: [entry.name],
    subjects: entry.subjects,
    has_gradient_grades: true,
    historical_courses: entry.subjects.flatMap((subject) => [
      `${subject} ${200 + Math.floor(random() * 3) * 10}`,
      `${subject} ${300 + Math.floor(random() * 5) * 10}`,
    ]),
    historical_sections: 8 + Math.floor(random() * 60),
    last_grade_year: 2026,
    rmp: rated
      ? {
          rating_state: "rated",
          avg_rating: avgRating,
          avg_difficulty: Math.round((2 + random() * 2.4) * 10) / 10,
          num_ratings: numRatings,
          would_take_again_pct: Math.round(45 + random() * 50),
          would_take_again_scope: "primary_profile_only",
          ratings_aggregation: "weighted_unique_profile_averages",
          rmp_name: `${first} ${last}`,
          rmp_department: "Staging Department",
          rmp_school: "North Carolina State University",
          is_other_school: false,
          primary_profile_id: profileId,
          profiles: [
            {
              profile_id: profileId,
              rmp_url: `https://www.ratemyprofessors.com/professor/${profileId}`,
              school: "North Carolina State University",
              department: "Staging Department",
              avg_rating: avgRating,
              num_ratings: numRatings,
              is_primary: true,
            },
          ],
        }
      : { rating_state: ratingState },
  };
}

export const stagingInstructors: V2Instructor[] = ROSTER.map(buildInstructor);

const byUnityId = new Map(stagingInstructors.map((i) => [i.unity_id!, i]));
// MyPack writes "Last,First"; the roster spaces it as "Last, First".
const nameKey = (name: string) =>
  name.replace(/\s*,\s*/, ",").trim().toLowerCase();
const byName = new Map(
  stagingInstructors.map((i) => [nameKey(i.instructor_name), i]),
);

/** Instructor teaching a given section: someone from the subject when possible. */
export function instructorForSection(
  subject: string,
  seed: string,
): V2Instructor {
  const pool = stagingInstructors.filter((i) => i.subjects.includes(subject));
  const candidates = pool.length > 0 ? pool : stagingInstructors;
  return candidates[hashString(seed) % candidates.length]!;
}

function findInstructor(request: V2GradeRequest): V2Instructor | undefined {
  return (
    (request.unity_id ? byUnityId.get(request.unity_id) : undefined) ??
    (request.instructor_name
      ? byName.get(nameKey(request.instructor_name))
      : undefined)
  );
}

/** `grades-v2-batch` / `grades-v2-course` response. */
export function stagingGrades(requests: V2GradeRequest[]): V2CoursesData {
  const instructors: Record<string, V2Instructor> = {};
  const results = requests.map((request) => {
    const instructor = findInstructor(request);
    if (!instructor) {
      return { request, instructor_id: null, ambiguous: false, grade: null };
    }
    instructors[instructor.instructor_id] = instructor;
    const random = seededRandom(
      `grade:${request.course}:${instructor.instructor_name}`,
    );
    // Roughly one course in eight has no history with this instructor.
    if (random() < 0.12) {
      return {
        request,
        instructor_id: instructor.instructor_id,
        ambiguous: false,
        grade: null,
      };
    }
    // Special-topics courses (x97, e.g. CSC 297) are graded Sat/Unsat.
    if (/97$/.test(request.course.trim())) {
      const u = Math.round(random() * 40) / 10;
      const w = Math.round(random() * 40) / 10;
      return {
        request,
        instructor_id: instructor.instructor_id,
        ambiguous: false,
        grade: {
          unique_hash: String(
            hashString(`${request.course}:${instructor.instructor_name}`),
          ),
          subject: request.course.split(" ")[0] ?? null,
          course_name: request.course,
          instructor_name: instructor.instructor_name,
          a_average: 0,
          b_average: 0,
          c_average: 0,
          d_average: 0,
          f_average: 0,
          class_avg_min: null,
          class_avg_max: null,
          link_status: "linked",
          section_count: 2 + Math.floor(random() * 6),
          has_letter_grades: false,
          s_average: Math.round((100 - u - w) * 10) / 10,
          u_average: u,
          w_average: w,
          terms: ["Fall '24", "Spring '25", "Fall '25", "Spring '26"],
        },
      };
    }
    const a = 25 + random() * 45;
    const b = (100 - a) * (0.45 + random() * 0.25);
    const c = (100 - a - b) * (0.5 + random() * 0.3);
    const d = (100 - a - b - c) * 0.55;
    const f = 100 - a - b - c - d;
    // Same bucket scores as v2_get_courses: floors, ceilings and midpoints.
    const shares = [a, b, c, d, f].map((p) => p / 100);
    const dot = (scores: number[]) =>
      shares.reduce((sum, p, i) => sum + p * scores[i]!, 0);
    const mean = dot([95, 85, 75, 65, 30]);
    const stddev = Math.sqrt(
      Math.max(
        0,
        dot([95 ** 2, 85 ** 2, 75 ** 2, 65 ** 2, 30 ** 2]) - mean ** 2,
      ),
    );
    return {
      request,
      instructor_id: instructor.instructor_id,
      ambiguous: false,
      grade: {
        unique_hash: String(
          hashString(`${request.course}:${instructor.instructor_name}`),
        ),
        subject: request.course.split(" ")[0] ?? null,
        course_name: request.course,
        instructor_name: instructor.instructor_name,
        a_average: Math.round(a * 10) / 10,
        b_average: Math.round(b * 10) / 10,
        c_average: Math.round(c * 10) / 10,
        d_average: Math.round(d * 10) / 10,
        f_average: Math.round(f * 10) / 10,
        class_avg_min: Math.round(dot([90, 80, 70, 60, 0]) * 100) / 100,
        class_avg_max: Math.round(dot([100, 90, 80, 70, 60]) * 100) / 100,
        class_avg: Math.round(mean * 100) / 100,
        class_avg_stddev: Math.round(stddev * 10) / 10,
        link_status: "linked",
        section_count: 2 + Math.floor(random() * 14),
        has_letter_grades: true,
        terms: ["Fall '24", "Spring '25", "Fall '25", "Spring '26"],
      },
    };
  });
  return { results, instructors };
}

/** `instructors-v2-search` response. */
export function stagingInstructorSearch(
  query: string,
  limit = 20,
): V2SearchData {
  const q = query.trim().toLowerCase();
  return {
    instructors: stagingInstructors
      .filter(
        (i) =>
          i.instructor_name.toLowerCase().includes(q) ||
          i.unity_id?.includes(q) ||
          i.subjects.some((subject) => subject.toLowerCase() === q),
      )
      .slice(0, limit),
  };
}

function upcomingSection(
  instructor: V2Instructor,
  subject: string,
  course: string,
  section: string,
  term: string,
): V2UpcomingSection {
  const random = seededRandom(`upcoming:${subject}${course}:${section}`);
  return {
    section_id: `${term}-${subject}-${course}-${section}`,
    term,
    subject,
    course,
    section,
    component: "LEC",
    class_number: String(
      10000 + (hashString(subject + course + section) % 9000),
    ),
    availability: pick(random, ["Open", "Open", "Closed", "Waitlist"]),
    instructor_ids: [instructor.instructor_id],
    listed_instructors: [
      { name: instructor.instructor_name, unityId: instructor.unity_id },
    ],
    unassigned: false,
    collected_at: "2026-10-20T12:00:00Z",
  };
}

/** `instructors-v2-upcoming` response, by instructor or by course. */
export function stagingUpcoming(
  query:
    | { instructor_ids: string[]; term?: string }
    | { subject: string; course: string; term?: string },
): V2UpcomingData {
  const term = query.term ?? "2271";
  const instructors: Record<string, V2Instructor> = {};
  const sections: V2UpcomingSection[] = [];
  if ("instructor_ids" in query) {
    for (const id of query.instructor_ids) {
      const instructor = byUnityId.get(id);
      if (!instructor) continue;
      instructors[id] = instructor;
      instructor.historical_courses.slice(0, 3).forEach((code, index) => {
        const [subject, course] = code.split(" ");
        sections.push(
          upcomingSection(
            instructor,
            subject!,
            course!,
            `00${index + 1}`,
            term,
          ),
        );
      });
    }
  } else {
    for (const section of ["001", "002"]) {
      const instructor = instructorForSection(
        query.subject,
        `${query.subject} ${query.course}:${section}`,
      );
      instructors[instructor.instructor_id] = instructor;
      sections.push(
        upcomingSection(instructor, query.subject, query.course, section, term),
      );
    }
  }
  return { sections, instructors };
}
