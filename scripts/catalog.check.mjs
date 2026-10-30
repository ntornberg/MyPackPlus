import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectCatalog,
  parseCodes,
  parsePage,
  publishCatalog,
  validateCatalog,
  diffCatalog,
} from "./catalog.mjs";

const block = (
  heading,
  title = "Special Topics",
  description = "A description",
) =>
  `<div class="courseblock"><span class="detail-coursecode">${heading}</span><span class="detail-title">${title}</span><p class="courseblockextra">${description}</p><p class="courseblockextra noindent">Prerequisite: 100</p></div>`;
const index =
  'University Catalog 2026-2027 <a href="/course-descriptions/csc/">Computer Science (CSC)</a><a href="/course-descriptions/ece/">Electrical Engineering (ECE)</a>';
const old = {
  subjects: { CSC: "Computer Science" },
  courses: [
    {
      code: "CSC-495",
      subject: "CSC",
      catalogNum: "495",
      title: "Old Topics",
      description: "Old description",
      currentCatalog: true,
      registrarId: "004481",
      idProvenance: "legacy",
    },
  ],
};
const fetcher = async (url) =>
  url.endsWith("/csc/")
    ? block("CSC 491")
    : url.endsWith("/ece/")
      ? block("ECE 525/CSC 525/ECE 425/CSC 425")
      : index;

test("expands shared and explicit cross-list numbers and suffixes", () => {
  assert.deepEqual(parseCodes("CSC / ECE 500"), ["CSC-500", "ECE-500"]);
  assert.deepEqual(parseCodes("ECE 525/CSC 525/ECE 425/CSC 425"), [
    "ECE-525",
    "CSC-525",
    "ECE-425",
    "CSC-425",
  ]);
  assert.deepEqual(parseCodes("BMME 217L"), ["BMME-217L"]);
  for (const invalid of ["CSC / ECE", "CSC 491 unexpected", "CSC 4**", ""])
    assert.throws(() => parseCodes(invalid));
});
test("missing descriptions are valid, missing titles and changed markup are not", () => {
  assert.equal(
    parsePage(block("CSC 491", "Topics", ""), "source")[0].description,
    "",
  );
  assert.throws(() => parsePage(block("CSC 491", ""), "source"));
  assert.throws(() => parsePage("<h1>Login</h1>", "source"));
});
test("discovers subjects and courses, keeps legacy IDs on exact codes only, retains historical entries", async () => {
  const result = await collectCatalog(fetcher, old);
  validateCatalog(result);
  assert.equal(result.courses.length, 6);
  assert.equal(result.subjects.ECE, "Electrical Engineering");
  assert.equal(
    result.courses.find((c) => c.code === "CSC-491").registrarId,
    undefined,
  );
  assert.equal(
    result.courses.find((c) => c.code === "CSC-495").registrarId,
    "004481",
  );
  assert.equal(
    result.courses.find((c) => c.code === "CSC-495").currentCatalog,
    false,
  );
  assert.equal(diffCatalog(old, result).added.length, 5);
  const repeated = await collectCatalog(fetcher, result);
  assert.equal(repeated.revision, result.revision);
  assert.deepEqual(diffCatalog(result, repeated).changed, []);
});
test("primary listings override cross-list metadata and conflicting primary listings fail", async () => {
  const result = await collectCatalog(
    async (url) =>
      url.endsWith("/csc/")
        ? block("CSC 525", "Primary")
        : url.endsWith("/ece/")
          ? block("ECE 525/CSC 525", "Crosslisted")
          : index,
    old,
  );
  assert.equal(
    result.courses.find((c) => c.code === "CSC-525").title,
    "Primary",
  );
  await assert.rejects(
    collectCatalog(
      async (url) =>
        url.endsWith("/csc/")
          ? block("CSC 525", "Primary")
          : url.endsWith("/ece/")
            ? block("CSC 525", "Conflict")
            : index,
      old,
    ),
    /Conflicting/,
  );
});
test("failed refresh and invalid output leave the published artifact intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "catalog-test-"));
  const output = pathToFileURL(join(directory, "catalog.json"));
  try {
    await writeFile(output, "previous");
    await assert.rejects(async () =>
      publishCatalog(
        await collectCatalog(async () => {
          throw new Error("503");
        }, old),
        output,
      ),
    );
    assert.equal(await readFile(output, "utf8"), "previous");
    const good = await collectCatalog(fetcher, old);
    await assert.rejects(
      publishCatalog(
        { ...good, courses: [...good.courses, good.courses[0]] },
        output,
      ),
    );
    assert.equal(await readFile(output, "utf8"), "previous");
    await publishCatalog(good, output);
    assert.equal(
      JSON.parse(await readFile(output, "utf8")).revision,
      good.revision,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preserves verified registrar ID provenance across catalog refreshes", async () => {
  const first = await collectCatalog(fetcher, old);
  const course = first.courses.find((c) => c.code === "CSC-491");
  Object.assign(course, {
    registrarId: "004481",
    idProvenance: "registrar-directory",
    idSource:
      "https://webappprd.acs.ncsu.edu/php/coursecat/directory_search.php",
    idVerifiedAt: "2026-10-29T12:00:00Z",
  });
  const refreshed = await collectCatalog(fetcher, first);
  assert.equal(
    refreshed.courses.find((c) => c.code === "CSC-491").idProvenance,
    "registrar-directory",
  );
  assert.equal(
    refreshed.courses.find((c) => c.code === "CSC-491").idSource,
    course.idSource,
  );
  validateCatalog(refreshed);
});
