# Generated Catalog Data

This folder contains generated/static catalog data used by planner search:

- `course-search/departmentCourses.typed.ts`
- `course-search/courseDescriptions.json`
- `gep-search/gepCourses.typed.ts`
- `major-plan-search/majorPlans.ts`
- `major-plan-search/minorPlans.ts`
- `subjectSearchValues.ts`
- `termIds.ts`

These files are intentionally separated from feature code because they are large
reference datasets, not hand-authored UI or domain logic.

Regeneration source and commands should be documented here when the catalog
refresh process is automated. Until then, keep edits focused and review changes
as generated-data updates rather than feature refactors.

## Course descriptions

Run `node scripts/collect-course-descriptions.mjs` with Node 24 or later to
collect descriptions from https://catalog.ncsu.edu/course-descriptions/.
The collector discovers subject links, fetches at most four pages concurrently,
and joins normalized course codes to the existing department catalog. It never
changes course IDs or titles. Cross-listed descriptions are assigned to each code.

The generated file records retrieval time, source URLs, and unmatched codes.
Unmatched courses remain searchable by code and title. A failed fetch or invalid
page structure aborts publication and preserves the previous dataset. The initial
collection matched 7,222 of 7,677 entries; missing descriptions include placeholders
and courses absent from the current public catalog. The snapshot does not establish
whether a course is offered in the selected term; section lookup does that.

Run `node --test scripts/collect-course-descriptions.check.mjs` to check collection
and failure handling. The description snapshot ships with the extension; typing
does not contact the catalog or an AI service.

Numbered queries recognize subject names and prefixes (for example `chem 101`
and `comp sci 246`) and only match course numbers, not numbers mentioned in
descriptions. Topic queries search titles first, then descriptions.

For the real Course Search component with synthetic section responses, open
`/planner-staging.html?course-search` using the staging dev server. Interaction
coverage is in `tests/smoke/course-search.smoke.ts`.
# Static course search shortcuts

Course search uses locally bundled catalog text, with no embedding model or inference service. Exact course codes and subject/number queries take priority. Explicit shortcuts expand `OS` to `operating systems`, `AI` to `artificial intelligence`, `ML` to `machine learning`, `cs 246` to `CSC-246`, and `math 241` to `MA-241`. Complete titles rank ahead of longer title phrases, followed by title-word prefixes and description-word prefixes. Every query word is required; long title words retain the existing one-edit typo fallback.

