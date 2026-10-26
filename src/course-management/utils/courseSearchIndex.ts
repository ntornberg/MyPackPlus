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

interface RankedCourse {
  course: SearchCourse;
  rank: number;
  /** Tie-breakers within a rank, compared in order; lower is better. */
  keys: number[];
}

// Description matches need every word within a short window, so words
// scattered across a long description don't count as a match.
const MAX_DESCRIPTION_SPAN = 8;

function descriptionSpan(tokens: string[], words: string[]) {
  let best = Infinity;
  tokens.forEach((token, start) => {
    if (!words.some((word) => token.startsWith(word))) return;
    const remaining = new Set(words);
    const stop = Math.min(tokens.length, start + MAX_DESCRIPTION_SPAN);
    for (let end = start; end < stop; end++) {
      for (const word of remaining)
        if (tokens[end].startsWith(word)) remaining.delete(word);
      if (!remaining.size) {
        best = Math.min(best, end - start + 1);
        return;
      }
    }
  });
  return best;
}

const courseLevel = (course: SearchCourse) =>
  Number.parseInt(course.catalogNum, 10) >= 500 ? 1 : 0;

// Titles that start with the query, undergraduate level, then shorter titles.
const titleKeys = (course: SearchCourse, words: string[]) => [
  course.titleTokens[0]?.startsWith(words[0]) ? 0 : 1,
  courseLevel(course),
  course.titleTokens.length,
];

function rankText(text: string, courses: SearchCourse[]): RankedCourse[] {
  const words = text.split(" ");
  const code = text.replaceAll(" ", "");
  const numericCode = /^\d+$/.test(code);
  const paddedText = ` ${text} `;
  const ranked = courses.flatMap((course): RankedCourse[] => {
    if (course.normalizedCode === code) return [{ course, rank: 0, keys: [] }];
    if (
      course.normalizedCode.startsWith(code) ||
      (numericCode && course.catalogNum.startsWith(code))
    )
      return [{ course, rank: 1, keys: [] }];
    let rank: number | undefined;
    if (course.normalizedTitle === text) rank = 1.5;
    else if (course.paddedTitle.includes(paddedText)) rank = 2;
    else if (
      words.every((word) =>
        course.titleTokens.some((token) => token.startsWith(word)),
      )
    )
      rank = 3;
    if (rank !== undefined)
      return [{ course, rank, keys: titleKeys(course, words) }];
    if (
      !words.every((word) =>
        course.descriptionTokens.some((token) => token.startsWith(word)),
      )
    )
      return [];
    const span = descriptionSpan(course.descriptionTokens, words);
    return span <= MAX_DESCRIPTION_SPAN
      ? [
          {
            course,
            rank: 4,
            keys: [span, courseLevel(course), course.titleTokens.length],
          },
        ]
      : [];
  });
  if (ranked.length) return ranked;
  return courses
    .filter((course) =>
      words.every(
        (word) =>
          course.titleTokens.some((token) => token.startsWith(word)) ||
          (/^[a-z]{5,}$/.test(word) &&
            course.titleTokens.some((titleWord) =>
              withinOneEdit(word, titleWord),
            )),
      ),
    )
    .map((course) => ({ course, rank: 99, keys: titleKeys(course, words) }));
}

// A leading subject code ("csc algorithms") or full subject name
// ("chemistry organic") scopes the rest of the query to that subject.
function subjectScope(text: string, courses: SearchCourse[]) {
  const [first, ...rest] = text.split(" ");
  if (!rest.length) return undefined;
  const subject = subjectAliases[first] ?? first;
  const byCode = courses.filter((course) => course.subjectWords[0] === subject);
  if (byCode.length) return { rest: rest.join(" "), courses: byCode };
  let name = "";
  for (const course of courses) {
    const courseName = course.subjectWords.slice(1).join(" ");
    if (courseName.length > name.length && text.startsWith(`${courseName} `))
      name = courseName;
  }
  if (!name) return undefined;
  return {
    rest: text.slice(name.length + 1),
    courses: courses.filter(
      (course) => course.subjectWords.slice(1).join(" ") === name,
    ),
  };
}

const compareKeys = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

export function findCourses(query: string, courses = getCourseSearchIndex()) {
  const normalized = normalizeSearchText(query);
  const text = topicAliases[normalized] ?? normalized;
  if (!text) return [];
  const code = text.replaceAll(" ", "");
  const numbered = text.match(/^([a-z][a-z ]*?)?\s*(\d+[a-z]?)$/);
  if (numbered) {
    const subjectText = numbered[1]?.trim() ?? "";
    const subjectQuery = subjectAliases[subjectText] ?? subjectText;
    const number = numbered[2];
    const subjectWords = subjectQuery.split(" ").filter(Boolean);
    // An exact subject code ("ch") means that subject only; subject-name
    // matches ("chem" -> Chemistry) are a fallback, first-word matches first.
    const isSubjectCode = courses.some(
      (course) => course.subjectWords[0] === subjectQuery,
    );
    const subjectTier = (course: SearchCourse) => {
      if (!subjectQuery || course.subjectWords[0] === subjectQuery) return 0;
      if (isSubjectCode) return undefined;
      const nameWords = course.subjectWords.slice(1);
      if (
        !subjectWords.every((word) =>
          nameWords.some((subjectWord) => subjectWord.startsWith(word)),
        )
      )
        return undefined;
      return nameWords[0]?.startsWith(subjectWords[0]) ? 1 : 2;
    };
    return courses
      .flatMap((course) => {
        if (!course.catalogNum.toLowerCase().startsWith(number)) return [];
        const tier = subjectTier(course);
        if (tier === undefined) return [];
        const rank =
          course.normalizedCode === code
            ? 0
            : course.catalogNum.toLowerCase() === number
              ? 1
              : 2;
        return [{ course, rank, tier }];
      })
      .sort(
        (a, b) =>
          a.tier - b.tier ||
          a.rank - b.rank ||
          a.course.code.localeCompare(b.course.code),
      )
      .slice(0, 20)
      .map(({ course, rank }) => ({ course, rank }));
  }
  const best = new Map<string, RankedCourse & { scoped: number }>();
  const add = (matches: RankedCourse[], scoped: number) => {
    for (const match of matches) {
      const current = best.get(match.course.code);
      if (
        !current ||
        match.rank < current.rank ||
        (match.rank === current.rank && scoped < current.scoped)
      )
        best.set(match.course.code, { ...match, scoped });
    }
  };
  const scope = subjectScope(text, courses);
  if (scope) {
    const rest = topicAliases[scope.rest] ?? scope.rest;
    add(
      rankText(rest, scope.courses).filter((match) => match.rank < 99),
      0,
    );
  }
  add(rankText(text, courses), 1);
  return [...best.values()]
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.scoped - b.scoped ||
        compareKeys(a.keys, b.keys) ||
        a.course.code.localeCompare(b.course.code),
    )
    .slice(0, 20)
    .map(({ course, rank }) => ({ course, rank }));
}

export function descriptionExcerpt(course: SearchCourse, query: string) {
  const words = normalizeSearchText(query).split(" ");
  const position = course.description.toLowerCase().indexOf(words[0]);
  const offset = Math.max(0, position - 45);
  const start = offset ? course.description.lastIndexOf(" ", offset) + 1 : 0;
  return `${start ? "…" : ""}${course.description.slice(start, start + 160)}${course.description.length > start + 160 ? "…" : ""}`;
}
