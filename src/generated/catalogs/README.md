# Generated catalog data

Course search uses course-search/catalog.json as its canonical bundled snapshot. catalog.ts supplies typed access; departmentCourses.typed.ts and subjectSearchValues.ts are derived compatibility views. Other GEP, degree-plan, and term datasets remain separate. major-plan-search/requirementSources.json lists the official catalog pages behind each major requirement set. Registrar course IDs are already bundled in the catalog.

## Refresh and release

- Run npm run catalog:refresh to collect every subject page from https://catalog.ncsu.edu/course-descriptions/.
- Review the local, git-ignored outputs/catalog-refresh-report.json and the generated diff. The collector updates codes, titles, descriptions and subjects, preserves exact-code legacy IDs, and retains historical entries. No IDs are inferred from titles or renumbering.
- Run npm run catalog:check and npm run test:catalog for offline validation.
- Run npm run catalog:verify-live to verify against a fresh complete collection without changing the bundle. Production builds and packaging require this check.
- Run npm run build for normal offline development builds.

Collection uses four concurrent requests, three attempts per page, and 30-second timeouts. It validates every heading and title, rejects conflicting primary listings, and publishes the single artifact by rename only after validation. A disappeared subject page blocks refresh pending source investigation. Sources, hashes, edition and retrieval time remain in the artifact; they are never included in search text. Metadata comparisons ignore retrieval timestamps and page hashes.

The catalog lists courses, not term offerings. Missing registration IDs do not block discovery, public sections, or previews. Newly discovered courses require exact MyPack cart payloads before cart actions become available. Existing IDs remain explicitly legacy metadata. Historical entries display “Not in current catalog” and stay searchable. Wildcard historical placeholders cannot be submitted as exact course searches.

Search stays local and deterministic, including code aliases and title/description ranking. The refresh has no remote runtime service or AI dependency. Special-topic section-title search is not included.

## Verification

Use /planner-staging.html?course-search for the actual Course Search component with synthetic section responses. Smoke checks live in tests/smoke/course-search.smoke.ts. Keep raw catalog downloads and audit evidence in the git-ignored outputs/ folder, outside extension bundles and the repository. An authenticated read-only check can validate MyPack payload retrieval; actual cart changes require a separate intentional verification action.
