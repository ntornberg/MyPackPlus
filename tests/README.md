# Smoke tests

## Staging smoke tests

These tests use deterministic fixture data and never contact MyPack:

```bash
npm run test:smoke
```

They run against desktop and mobile Chrome. Use
`npm run test:smoke:headed` when debugging locally.

Staging mounts the real planner drawer; only `chrome.*` and network calls are
faked (`src/staging/stagingEnvironment.ts`). For manual personal-planning
checks, open `planner-staging.html?personal` on the local development server.
This uses the sanitized TST audit and approved-choice fixtures. Add
`&unavailable` to verify that a failed choice list leaves the audit rows
visible. The fixture includes separate elective groups, repeated topics,
approved exceptions, overlapping eligibility, and courses without sections.

## Storage upgrade test

```bash
npx playwright install chromium
npm run build
node tests/storage-upgrade.mjs
```

This upgrades an older-version storage fixture to the built extension in a
disposable Chromium profile under `test-results/`. It checks automatic refresh
across three tabs and two origins, actual IndexedDB cleanup, preservation of
unrelated website data, and repeat-update behavior. MyPack pages are simulated;
this does not verify authenticated searches or cart operations.

## Authenticated extension smoke test

The authenticated test builds the unpacked extension and opens a dedicated,
git-ignored Chrome profile:

```bash
npm run test:smoke:auth
```

Complete OAuth/MFA when Chrome asks, then navigate to the MyPack planner page.
The session is reused from `.auth/mypack-smoke-profile` until it expires.

The live test is intentionally read-only: it verifies extension injection,
opens and closes the planner, switches tabs, and toggles the theme. It never
adds a course to the cart or submits enrollment.

Optional environment variables:

- `MYPACK_PORTAL_URL`: initial supported MyPack URL to open.
- `MYPACK_AUTH_PROFILE`: alternate persistent Chrome profile directory.
- `MYPACK_AUTH_WAIT_MS`: login wait in milliseconds; defaults to five minutes.

Never commit `.auth`, browser profiles, cookies, OAuth tokens, screenshots
containing student data, or captured authenticated network traffic.
