import descriptions from "../../generated/catalogs/course-search/courseDescriptions.json";
import { DEPT_COURSES } from "../../generated/catalogs/course-search/departmentCourses.typed";

export const normalizeSearchText = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface SearchCourse {
  subject: string;
  code: string;
  title: string;
  id: string;
  catalogNum: string;
  description: string;
  label: string;
  normalizedCode: string;
  normalizedTitle: string;
  normalizedDescription: string;
  subjectWords: string[];
  titleTokens: string[];
  descriptionTokens: string[];
  paddedTitle: string;
}

const descriptionRecords: Record<string, { description: string }> =
  descriptions.courses;
let courseSearchIndex: SearchCourse[] | undefined;

const buildCourseSearchIndex = (): SearchCourse[] =>
  Object.entries(DEPT_COURSES).flatMap(([subject, courses]) =>
    Object.entries(courses).map(([code, course]) => {
      const description = descriptionRecords[code]?.description ?? "";
      const normalizedTitle = normalizeSearchText(course.course_title);
      const normalizedDescription = normalizeSearchText(description);
      return {
        subject,
        code,
        title: course.course_title,
        id: course.course_id,
        catalogNum: code.match(/\d+[A-Za-z]?$/)?.[0] ?? "",
        description,
        label: `${code} ${course.course_title}`,
        normalizedCode: normalizeSearchText(code).replaceAll(" ", ""),
        normalizedTitle,
        normalizedDescription,
        subjectWords: normalizeSearchText(subject).split(" "),
        titleTokens: normalizedTitle.split(" "),
        descriptionTokens: normalizedDescription.split(" "),
        paddedTitle: ` ${normalizedTitle} `,
      };
    }),
  );

export const getCourseSearchIndex = () =>
  (courseSearchIndex ??= buildCourseSearchIndex());

export function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  if (i === Math.min(a.length, b.length)) return true;
  if (a.length === b.length) {
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] &&
        a[i + 1] === b[i] &&
        a.slice(i + 2) === b.slice(i + 2))
    );
  }
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

const topicAliases: Record<string, string> = {
  os: "operating systems",
  ai: "artificial intelligence",
  ml: "machine learning",
};
const subjectAliases: Record<string, string> = { cs: "csc", math: "ma" };

export function findCourses(query: string, courses = getCourseSearchIndex()) {
  const normalized = normalizeSearchText(query);
  const text = topicAliases[normalized] ?? normalized;
  if (!text) return [];
  const words = text.split(" ");
  const code = text.replaceAll(" ", "");
  const numericCode = /^\d+$/.test(code);
  const paddedText = ` ${text} `;
  const numbered = text.match(/^([a-z][a-z ]*?)?\s*(\d+[a-z]?)$/);
  if (numbered) {
    const subjectText = numbered[1]?.trim() ?? "";
    const subjectQuery = subjectAliases[subjectText] ?? subjectText;
    const number = numbered[2];
    const subjectWords = subjectQuery.split(" ").filter(Boolean);
    return courses
      .filter(
        (course) =>
          course.catalogNum.toLowerCase().startsWith(number) &&
          (!subjectQuery ||
            course.subjectWords[0] === subjectQuery ||
            subjectWords.every((word) =>
              course.subjectWords
                .slice(1)
                .some((subjectWord) => subjectWord.startsWith(word)),
            )),
      )
      .map((course) => ({
        course,
        rank:
          course.normalizedCode === code
            ? 0
            : course.catalogNum.toLowerCase() === number
              ? 1
              : 2,
      }))
      .sort(
        (a, b) => a.rank - b.rank || a.course.code.localeCompare(b.course.code),
      )
      .slice(0, 20);
  }
  const ranked = courses.map((course) => {
    let rank = 99;
    if (course.normalizedCode === code) rank = 0;
    else if (
      course.normalizedCode.startsWith(code) ||
      (numericCode && course.catalogNum.startsWith(code))
    )
      rank = 1;
    else if (course.normalizedTitle === text) rank = 1.5;
    else if (course.paddedTitle.includes(paddedText)) rank = 2;
    else if (
      words.every((word) =>
        course.titleTokens.some((token) => token.startsWith(word)),
      )
    )
      rank = 3;
    else if (
      words.every((word) =>
        course.descriptionTokens.some((token) => token.startsWith(word)),
      )
    )
      rank = 4;
    return { course, rank };
  });
  const exact = ranked.filter((match) => match.rank < 99);
  const matches = exact.length
    ? exact
    : ranked.filter(({ course }) =>
        words.every(
          (word) =>
            course.titleTokens.some((token) => token.startsWith(word)) ||
            (/^[a-z]{5,}$/.test(word) &&
              course.titleTokens.some((titleWord) =>
                withinOneEdit(word, titleWord),
              )),
        ),
      );
  return matches
    .sort(
      (a, b) => a.rank - b.rank || a.course.code.localeCompare(b.course.code),
    )
    .slice(0, 20);
}

export function descriptionExcerpt(course: SearchCourse, query: string) {
  const words = normalizeSearchText(query).split(" ");
  const position = course.description.toLowerCase().indexOf(words[0]);
  const offset = Math.max(0, position - 45);
  const start = offset ? course.description.lastIndexOf(" ", offset) + 1 : 0;
  return `${start ? "…" : ""}${course.description.slice(start, start + 160)}${course.description.length > start + 160 ? "…" : ""}`;
}
