import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectDescriptions,
  generateDescriptions,
  parseDescriptions,
} from "./collect-course-descriptions.mjs";

const html =
  '<div class="courseblock"><span class="detail-coursecode">CSC / ECE 500</span><p class="courseblockextra">Process scheduling and memory.</p><p class="courseblockextra noindent">Prerequisite: 300</p></div>';
test("parses cross-listings without including prerequisite metadata", () => {
  const records = parseDescriptions(html, "source");
  assert.equal(records.CSC500.description, "Process scheduling and memory.");
  assert.deepEqual(records.CSC500, records.ECE500);
  assert.throws(() => parseDescriptions("<h1>Changed markup</h1>", "source"));
});
test("matches existing codes and reports missing descriptions", async () => {
  const result = await collectDescriptions(
    async (url) =>
      url.endsWith("/csc/")
        ? html
        : '<a href="/course-descriptions/csc/">CSC</a>',
    { CSC: { "CSC-500": {}, "CSC-999": {} } },
  );
  assert.equal(
    result.courses["CSC-500"].source,
    "https://catalog.ncsu.edu/course-descriptions/csc/",
  );
  assert.deepEqual(result.unmatched, ["CSC-999"]);
});
test("a failed collection preserves the previous output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "course-descriptions-"));
  try {
    const output = pathToFileURL(join(directory, "descriptions.json"));
    await writeFile(output, "previous");
    await assert.rejects(
      generateDescriptions(output, async () => {
        throw new Error("HTTP 503");
      }),
    );
    assert.equal(await readFile(output, "utf8"), "previous");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
