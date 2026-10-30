# Changelog

## 4.0.0 — October 29, 2026

### Planner and schedule
- New Schedule tab: enrolled and carted classes side by side, section swaps, alternative sections, and instructor lookup.
- Calendar preview shows credit hours, online classes, and native MyPack calendar metadata, with correct unit counts for carted and enrolled courses.
- Refreshed planner shell: slide-out drawer focus handling, sliding toggle groups, smoother popovers and tooltips, and clearer loading progress.

### Cart
- Add, swap, and remove sections from the planner, including linked labs and recitations, with in-cart badges and confirmation before removal.
- Swaps keep waitlist, grading, and credit choices; unsafe lab changes are refused instead of guessed.
- Cart changes are pinned to the class's term, delete the exact cart row, and are coordinated across open tabs so stale refreshes can't undo them.
- Lab pairing uses MyPack's own class-search results, so every valid lecture and lab combination keeps its exact add-to-cart payload.

### Degree planning
- Degree-audit requirements show progress metrics and integrate with approved-course choices.
- Approved-course choices load progressively, unmet requirements first; failed lists can be retried on their own.
- GEP search selects the first category you still need after an audit sync.
- Personal planning view with requirement choices and recovery from failed lists.

### Search
- Course search runs on a bundled, validated NC State catalog with improved ranking, code aliases, and special-topic and lab section grouping.
- MyPack offerings integration for accurate section data, with prefetching and caching per subject.

### Grades and ratings
- Grade history adds class average, standard deviation, and S/U grading.
- Faster, consolidated grade and professor lookups.

### Reliability
- Safer extension updates with storage migration, background processing, and user notifications.
- New "Clear cache & reset" button as a last-resort recovery option.
- Staging environment and smoke tests that mount the real planner with dummy data.

## 3.8.13 — July 5, 2026
- New UI and caching fixes. See the [v3.8.13 release](https://github.com/ntornberg/MyPackExt/releases/tag/v3.8.13).

## 3.8.4 — June 20, 2026
- See the [v3.8.4 release](https://github.com/ntornberg/MyPackExt/releases/tag/v3.8.4).
