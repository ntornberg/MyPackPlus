import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { load } from "cheerio";

export const INDEX_URL = "https://catalog.ncsu.edu/course-descriptions/";
const OUTPUT = new URL(
  "../src/generated/catalogs/course-search/catalog.json",
  import.meta.url,
);
const clean = (value) => value.replace(/\s+/g, " ").trim();
const stable = (value) => JSON.stringify(value);

export function parseCodes(heading) {
  const text = clean(heading).toUpperCase();
  const tokens = text.split("/").map(clean);
  const codes = [];
  let pending = [];
  for (const token of tokens) {
    const match = token.match(/^([A-Z]+)\s*(\d+[A-Z]?)$/);
    if (match) {
      for (const subject of [...pending, match[1]])
        codes.push(`${subject}-${match[2]}`);
      pending = [];
    } else if (/^[A-Z]+$/.test(token)) pending.push(token);
    else throw new Error(`Unparseable course heading: ${heading}`);
  }
  if (pending.length || !codes.length)
    throw new Error(`Incomplete course heading: ${heading}`);
  return [...new Set(codes)];
}

export function parsePage(html, source) {
  const $ = load(html);
  const records = [];
  $(".courseblock").each((_, block) => {
    const codes = parseCodes($(block).find(".detail-coursecode").text());
    const title = clean($(block).find(".detail-title").text());
    if (!title) throw new Error(`Missing title: ${source} ${codes[0]}`);
    const description = clean(
      $(block).find("p.courseblockextra").not(".noindent").first().text(),
    );
    for (const code of codes)
      records.push({
        code,
        title,
        description,
        source,
        primary: code === codes[0],
      });
  });
  if (!records.length) throw new Error(`No courses: ${source}`);
  return records;
}

export function revisionOf(courses, subjects) {
  return createHash("sha256")
    .update(stable({ courses, subjects }))
    .digest("hex");
}

export function validateCatalog(catalog) {
  if (
    catalog.schemaVersion !== 1 ||
    !catalog.courses?.length ||
    !catalog.subjects
  )
    throw new Error("Invalid catalog schema");
  const codes = new Set();
  for (const c of catalog.courses) {
    const validCode = c.currentCatalog
      ? /^[A-Z]+-\d+[A-Z]?$/.test(c.code)
      : /^[A-Z]+-[\d*A-Z]+$/.test(c.code);
    if (
      !validCode ||
      c.code !== `${c.subject}-${c.catalogNum}` ||
      codes.has(c.code)
    )
      throw new Error(`Invalid/duplicate code: ${c.code}`);
    codes.add(c.code);
    if (
      !catalog.subjects[c.subject] ||
      !c.title ||
      typeof c.description !== "string" ||
      typeof c.currentCatalog !== "boolean"
    )
      throw new Error(`Invalid metadata: ${c.code}`);
    if (
      c.registrarId !== undefined &&
      (!/^\d+$/.test(c.registrarId) ||
        !["legacy", "registrar-directory"].includes(c.idProvenance))
    )
      throw new Error(`Invalid ID: ${c.code}`);
    if (
      c.idProvenance === "registrar-directory" &&
      (c.idSource !==
        "https://webappprd.acs.ncsu.edu/php/coursecat/directory_search.php" ||
        !Number.isFinite(Date.parse(c.idVerifiedAt)))
    )
      throw new Error(`Missing ID provenance: ${c.code}`);
    if (c.currentCatalog && !c.source?.startsWith(INDEX_URL))
      throw new Error(`Missing provenance: ${c.code}`);
  }
  if (
    !catalog.pages?.length ||
    new Set(catalog.pages.map((p) => p.url)).size !== catalog.pages.length
  )
    throw new Error("Invalid source coverage");
  if (catalog.revision !== revisionOf(catalog.courses, catalog.subjects))
    throw new Error("Catalog revision mismatch");
}

export async function collectCatalog(fetchPage, previous) {
  const $ = load(await fetchPage(INDEX_URL));
  const edition = $("body")
    .text()
    .match(/University Catalog\s+(\d{4}-\d{4})/)?.[1];
  if (!edition) throw new Error("Catalog edition missing");
  const links = new Map();
  $("a[href]").each((_, a) => {
    const url = new URL($(a).attr("href"), INDEX_URL).href;
    const label = clean($(a).text());
    if (
      /^https:\/\/catalog\.ncsu\.edu\/course-descriptions\/[a-z]+\/$/.test(
        url,
      ) &&
      /\([A-Z]+\)$/.test(label)
    )
      links.set(url, label);
  });
  if (!links.size) throw new Error("Subject links missing");
  const urls = [...links.keys()].sort();
  const subjects = { ...previous.subjects };
  for (const label of links.values()) {
    const match = label.match(/^(.*?)\s*\(([A-Z]+)\)$/);
    subjects[match[2]] = match[1].replace(/[\u200b\u200c\u200d\u00ad]/g, "");
  }
  const results = new Array(urls.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, urls.length) }, async () => {
      while (next < urls.length) {
        const i = next++;
        const html = await fetchPage(urls[i]);
        results[i] = {
          records: parsePage(html, urls[i]),
          page: {
            url: urls[i],
            sha256: createHash("sha256").update(html).digest("hex"),
          },
        };
      }
    }),
  );
  const records = new Map();
  for (const { records: rows } of results)
    for (const row of rows) {
      const old = records.get(row.code);
      if (
        old?.primary &&
        row.primary &&
        (old.title !== row.title || old.description !== row.description)
      )
        throw new Error(`Conflicting primary listings: ${row.code}`);
      if (!old || (!old.primary && row.primary)) records.set(row.code, row);
    }
  const previousByCode = new Map(previous.courses.map((c) => [c.code, c]));
  const courses = [...records.values()].map((r) => {
    const [subject, catalogNum] = r.code.split("-");
    if (!subjects[subject]) throw new Error(`Unknown subject: ${subject}`);
    const prior = previousByCode.get(r.code);
    return {
      code: r.code,
      subject,
      catalogNum,
      title: r.title,
      description: r.description,
      currentCatalog: true,
      source: r.source,
      ...(prior?.registrarId
        ? {
            registrarId: prior.registrarId,
            idProvenance: prior.idProvenance,
            ...(prior.idSource
              ? { idSource: prior.idSource, idVerifiedAt: prior.idVerifiedAt }
              : {}),
          }
        : {}),
    };
  });
  for (const old of previous.courses)
    if (!records.has(old.code)) courses.push({ ...old, currentCatalog: false });
  courses.sort((a, b) => a.code.localeCompare(b.code));
  const sortedSubjects = Object.fromEntries(
    Object.entries(subjects).sort(([a], [b]) => a.localeCompare(b)),
  );
  const catalog = {
    schemaVersion: 1,
    edition,
    retrievedAt: new Date().toISOString(),
    revision: revisionOf(courses, sortedSubjects),
    subjects: sortedSubjects,
    pages: results.map((r) => r.page),
    courses,
  };
  validateCatalog(catalog);
  return catalog;
}

export function diffCatalog(previous, current) {
  const old = new Map(previous.courses.map((c) => [c.code, c]));
  return {
    added: current.courses.filter((c) => !old.has(c.code)).map((c) => c.code),
    changed: current.courses
      .filter((c) => old.has(c.code) && stable(old.get(c.code)) !== stable(c))
      .map((c) => c.code),
    absentFromCurrent: current.courses
      .filter((c) => !c.currentCatalog)
      .map((c) => c.code),
    subjectsChanged: stable(previous.subjects) !== stable(current.subjects),
    currentCourses: current.courses.filter((c) => c.currentCatalog).length,
  };
}

export async function publishCatalog(catalog, output = OUTPUT) {
  validateCatalog(catalog);
  const temporary = new URL(output.href + ".tmp");
  await writeFile(temporary, JSON.stringify(catalog, null, 2) + "\n");
  await rename(temporary, output);
}

async function fetchPage(url) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
      return await r.text();
    } catch (e) {
      error = e;
    }
  }
  throw error;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const command = process.argv[2];
  if (!["refresh", "check", "verify-live"].includes(command))
    throw new Error("Use refresh, check, or verify-live");
  const previous = JSON.parse(await readFile(OUTPUT, "utf8"));
  validateCatalog(previous);
  if (command === "check")
    console.log(
      `Catalog valid: ${previous.courses.length} codes, revision ${previous.revision.slice(0, 12)}`,
    );
  else {
    const current = await collectCatalog(fetchPage, previous);
    const diff = diffCatalog(previous, current);
    const disappeared = previous.pages
      .filter((p) => !current.pages.some((n) => n.url === p.url))
      .map((p) => p.url);
    if (disappeared.length)
      throw new Error(
        `Subject pages disappeared; inspect upstream before accepting: ${disappeared.join(", ")}`,
      );
    await mkdir(new URL("../outputs/", import.meta.url), { recursive: true });
    await writeFile(
      new URL("../outputs/catalog-refresh-report.json", import.meta.url),
      JSON.stringify({ retrievedAt: current.retrievedAt, ...diff }, null, 2) +
        "\n",
    );
    console.log(JSON.stringify(diff, null, 2));
    if (command === "refresh") await publishCatalog(current);
    else if (
      diff.added.length ||
      diff.changed.length ||
      diff.subjectsChanged ||
      previous.edition !== current.edition
    )
      throw new Error(
        "Catalog differs from the live source. Run npm run catalog:refresh and review the report.",
      );
  }
}
