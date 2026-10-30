# MyPack Plus

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Built with React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6.svg)](https://www.typescriptlang.org/)

MyPack Plus is a browser extension for NC State students using MyPack Portal. It brings course search, section comparison, grade history, professor ratings, schedule previews, live availability checks, and cart helpers directly into the registration workflow.

Visit [mypackplus.me](https://mypackplus.me) for the project site.

The extension is independent and is not affiliated with, endorsed by, or sponsored by NC State University.

## What's New in 4.0

- **Schedule tab** — see enrolled and carted classes together, swap sections, and find alternative sections or instructors without leaving the planner.
- **Cart management** — add, swap, and remove sections (including linked labs and recitations) directly from the planner, with waitlist, grading, and credit choices preserved.
- **Degree progress** — degree-audit requirements show progress metrics, approved-course choices load progressively, and GEP search jumps to your first unmet category.
- **Calendar** — credit hours, online classes, and native MyPack calendar metadata in the schedule preview.
- **Grades** — class averages, standard deviation, and S/U grading in grade history.
- **Reliability** — safer extension updates, cross-tab cart coordination, and a "Clear cache & reset" button for recovery.

See [CHANGELOG.md](CHANGELOG.md) for the full list.

## Features

- Search by term, subject, course number, GEP requirement, major, minor, plan, and concentration.
- Compare sections with meeting times, locations, instructors, notes, prerequisites, seats, availability, grades, and professor ratings.
- Preview selected sections alongside enrolled and carted classes, including schedule-conflict context.
- Handle linked lectures, labs, and recitations as complete registration combinations.
- Add, swap, and remove compatible combinations in the MyPack cart, including lab changes.
- Plan from a dedicated Schedule tab with section alternatives and instructor lookup.
- Track degree-audit and GEP progress, with approved-course choices for each requirement.
- Use light and dark mode, local caching, and batched lookups for faster repeat searches.

## How It Works

MyPack Plus runs as a Manifest V3 browser extension.

- A content script adds the planning interface to supported MyPack Portal pages.
- A background service worker handles extension-level requests.
- Local browser storage and IndexedDB cache course and section data for faster repeat sessions.
- Grade distributions are loaded directly from WolfTech Gradient (gradient.ncsu.edu) with the student's own NC State session and summarized in the browser.
- A hosted Supabase backend provides instructor and professor-rating data through Edge Functions. Backend source and database migrations are maintained separately and are not part of this repository.
- Registrar availability lookups are batched and proxied to reduce repeated manual requests.

## Tech Stack

- React 19, TypeScript, Vite, and Chrome Extension Manifest V3.
- Tailwind CSS v4 and shadcn-style UI primitives.
- MUI X Charts for grade-distribution charts.
- Supabase Edge Functions and Cloudflare/registrar lookup infrastructure.

## Project Layout

- `src/extension` contains the content script and background service worker.
- `src/ui-system/components` contains shared planner UI, workbench components, and reusable controls.
- `src/course-management` contains section search, registrar data, cart actions, and result rendering.
- `src/degree-planning` contains plan/GEP data and injected grade/professor cards.
- `src/staging` mounts the real planner outside MyPack with dummy data, for visual checks, screenshots, and smoke tests.

## Development

Install dependencies:

```bash
npm install
```

Run the Vite dev server:

```bash
npm run dev
```

Run the planner staging app (the real planner with dummy data, with screenshot presets such as `?tab=gep_search&theme=dark`):

```bash
npm run dev:planner-staging
```

Run project checks:

```bash
npm run type-check
npm run lint
npm test -- --run
npm run test:smoke
```

Build the extension:

```bash
npm run build:prod
```

The production build outputs extension assets to `dist/` and packages them as `dist.zip`.

## Privacy And Data

MyPack Plus reads supported MyPack Portal pages, requests course and availability data needed for planning features, and stores cached course data locally to improve performance. Students should verify official course availability, enrollment requirements, and registration decisions through NC State's official systems before enrolling.

## Notes

- The main planner UI renders inside a shadow-root overlay so host MyPack styles do not leak into the extension.
- Injected grade/professor cards use their own small stylesheet because they render inside MyPack rows and, in one case, a separate shadow root.
- Some inline styles remain intentionally for dynamic geometry and data-driven color values, such as calendar event placement and fractional star fills.

## Contributing

Issues and pull requests are welcome. Keep changes focused, include a short explanation of their user-facing impact, and run the relevant checks before opening a PR.

## License

MyPack Plus is released under the [MIT License](LICENSE).
