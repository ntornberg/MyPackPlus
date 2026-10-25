import { load } from "cheerio";
import { writeFile, rename } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { DEPT_COURSES } from "../src/generated/catalogs/course-search/departmentCourses.typed.ts";

const indexUrl = "https://catalog.ncsu.edu/course-descriptions/";
export const normalizeCode = (code) =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function parseDescriptions(html, source) {
  const $ = load(html);
  const records = {};
  $(".courseblock").each((_, block) => {
    const heading = $(block).find(".detail-coursecode").text();
    const description = $(block)
      .find("p.courseblockextra")
      .not(".noindent")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    // Cross-listed courses share the same description.
    const codes = heading.match(/^[A-Z]+(?:\s*\/\s*[A-Z]+)*\s*\d+[A-Z]?/i)?.[0];
    if (!codes || !description) return;
    const number = codes.match(/\d+[A-Z]?$/i)[0];
    for (const subject of codes.replace(/\d+[A-Z]?$/i, "").split("/")) {
      records[normalizeCode(subject + number)] = { description, source };
    }
  });
  if (!$(".courseblock .detail-coursecode").length)
    throw new Error(`Course structure missing: ${source}`);
  return records;
}

export async function collectDescriptions(fetchPage, catalog = DEPT_COURSES) {
  const $ = load(await fetchPage(indexUrl));
  const urls = [
    ...new Set(
      $("a[href]")
        .map((_, a) => new URL($(a).attr("href"), indexUrl).href)
        .get(),
    ),
  ]
    .filter((url) =>
      /^https:\/\/catalog\.ncsu\.edu\/course-descriptions\/[a-z]+\/$/.test(url),
    )
    .sort();
  if (!urls.length) throw new Error("Catalog subject links missing");
  const pages = new Array(urls.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, urls.length) }, async () => {
      while (next < urls.length) {
        const i = next++;
        pages[i] = parseDescriptions(await fetchPage(urls[i]), urls[i]);
      }
    }),
  );
  const descriptions = Object.assign({}, ...pages);
  const courses = {};
  const unmatched = [];
  for (const department of Object.values(catalog)) {
    for (const code of Object.keys(department)) {
      const record = descriptions[normalizeCode(code)];
      // Only the description ships in the bundle; `source` stays top-level.
      if (record) courses[code] = { description: record.description };
      else unmatched.push(code);
    }
  }
  if (!Object.keys(courses).length)
    throw new Error("No catalog courses matched");
  return {
    retrievedAt: new Date().toISOString(),
    source: indexUrl,
    courses,
    unmatched,
  };
}

export async function generateDescriptions(output, fetchPage) {
  const result = await collectDescriptions(fetchPage);
  // Publish only a complete collection; failed fetches leave the previous file intact.
  const temporary = new URL(output.href + ".tmp");
  await writeFile(temporary, JSON.stringify(result, null, 2) + "\n");
  await rename(temporary, output);
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const output = new URL(
    "../src/generated/catalogs/course-search/courseDescriptions.json",
    import.meta.url,
  );
  const result = await generateDescriptions(output, async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    return response.text();
  });
  console.log(
    `Collected ${Object.keys(result.courses).length} descriptions; ${result.unmatched.length} unmatched courses.`,
  );
  console.log(`Unmatched: ${result.unmatched.join(", ")}`);
}
