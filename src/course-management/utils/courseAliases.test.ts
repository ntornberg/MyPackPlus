import { describe, expect, it } from "vitest";

import aliasConfig from "./courseAliases.json";
import {
  findCourses,
  getCourseSearchIndex,
  normalizeSearchText,
  subjectAliases,
} from "./courseSearchIndex";

const { exceptions, allowTitleOverlap, aliases } = aliasConfig as {
  exceptions: Record<string, string>;
  allowTitleOverlap: string[];
  aliases: Record<string, string | string[]>;
};
const index = getCourseSearchIndex();
const courseCodes = new Set(index.map((course) => course.code));
const subjectCodes = new Set(index.map((course) => course.subjectWords[0]));
// An alias names one course, or several in the order to show them.
const entries = Object.entries(aliases).map(
  ([alias, codes]) => [alias, [codes].flat()] as const,
);

const numeralWords: Record<string, string> = {
  i: "1",
  ii: "2",
  iii: "3",
  one: "1",
  two: "2",
  three: "3",
};
// "calc ii", "calc2" and "calculus two" style variants share one form.
const canonicalNumerals = (alias: string) =>
  alias
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(" ")
    .map((word) => numeralWords[word] ?? word)
    .join(" ");

describe("course aliases", () => {
  it("stores every alias in normalized search form", () => {
    const unnormalized = entries
      .filter(([alias]) => normalizeSearchText(alias) !== alias)
      .map(([alias]) => alias);
    expect(unnormalized).toEqual([]);
  });

  it("points every alias at a real course", () => {
    const dangling = entries.flatMap(([alias, codes]) =>
      codes
        .filter((code) => !courseCodes.has(code))
        .map((code) => `${alias} -> ${code}`),
    );
    expect(dangling).toEqual([]);
  });

  it("lists each course once per alias", () => {
    const repeated = entries
      .filter(
        ([, codes]) => !codes.length || new Set(codes).size < codes.length,
      )
      .map(([alias]) => alias);
    expect(repeated).toEqual([]);
  });

  it("does not shadow a subject code unless the exception is listed", () => {
    const shadowing = entries
      .filter(([alias]) => subjectCodes.has(alias.split(" ")[0]))
      .filter(([alias]) => !exceptions[alias.split(" ")[0]])
      .map(([alias]) => alias);
    expect(shadowing).toEqual([]);
  });

  it("does not claim a phrase that names other courses' titles", () => {
    const overlapping = entries
      .filter(([alias]) => !allowTitleOverlap.includes(alias))
      .filter(([alias, codes]) =>
        index.some(
          (course) =>
            !codes.includes(course.code) &&
            course.paddedTitle.includes(` ${alias} `),
        ),
      )
      .map(([alias]) => alias);
    expect(overlapping).toEqual([]);
  });

  // Aliases are for slang search can't resolve. When search improves enough
  // to put an alias's first course on top by itself, delete the alias.
  it("only keeps aliases search does not already resolve", () => {
    const redundant = entries
      .filter(
        ([alias, codes]) => findCourses(alias)[0]?.course.code === codes[0],
      )
      .map(([alias]) => alias);
    expect(redundant).toEqual([]);
  });

  it("only allows title overlaps that are still aliases", () => {
    expect(allowTitleOverlap.filter((alias) => !aliases[alias])).toEqual([]);
  });

  it("maps numeral variants of an alias to the same courses", () => {
    const codesByForm = new Map<string, Set<string>>();
    for (const [alias, codes] of entries) {
      const form = canonicalNumerals(alias);
      codesByForm.set(
        form,
        (codesByForm.get(form) ?? new Set()).add(codes.join(" > ")),
      );
    }
    const conflicts = [...codesByForm]
      .filter(([, codes]) => codes.size > 1)
      .map(([form, codes]) => `${form}: ${[...codes].join(", ")}`);
    expect(conflicts).toEqual([]);
  });

  it("matches the subject aliases search already uses", () => {
    for (const [word, subject] of Object.entries(exceptions))
      expect(subjectAliases[word]).toBe(subject.toLowerCase());
    const shadowingSubjectAliases = Object.keys(subjectAliases).filter((word) =>
      subjectCodes.has(word),
    );
    expect(shadowingSubjectAliases.sort()).toEqual(
      Object.keys(exceptions).sort(),
    );
  });

  it.each(Object.entries(exceptions))(
    "allows %s to shadow subject %s on purpose",
    (word, subject) => {
      expect(subjectCodes.has(subject.toLowerCase())).toBe(true);
      const affected = entries.filter(
        ([alias]) => alias.split(" ")[0] === word,
      );
      expect(affected.length).toBeGreaterThan(0);
      for (const [, codes] of affected)
        for (const code of codes) expect(code.split("-")[0]).toBe(subject);
    },
  );
});
