# Task 5 fix round 1 — re-review

Fix base: 6650aab. Head: 3b8bd46. Diff: `.superpowers/sdd/2026-09-10-panel-e3/review-6650aab..3b8bd46.diff` (1 file,
+3/-0, `tests/panel/metricsApi.test.ts`).

## Finding Verdicts

1. **G11 required "answers a broken gate..." to assert status 409, `body.code === UNRESOLVED_PROJECT_KEYS`, and
   `"report" in body === false`; only the first and third were implemented, and the omission wasn't listed in the
   report's Deviations section.** — ADDRESSED.
   - `tests/panel/metricsApi.test.ts:189` adds `expect(body.code).toBe(UNRESOLVED_PROJECT_KEYS);`, placed after the
     request (`const res = await get(started, "/api/metrics");` at line 184, `res.status` checked at 185) and
     before the pre-existing `expect("report" in body).toBe(false);` at line 194 — it executes, is not after an
     early return, and is not before the request that would make it vacuous.
   - The asserted symbol is the imported constant, not a retyped literal: `tests/panel/metricsApi.test.ts:11`
     `import { UNRESOLVED_PROJECT_KEYS } from "../../src/metrics/discover.js";`, and the source of truth is
     `src/metrics/discover.ts:8` `export const UNRESOLVED_PROJECT_KEYS = "unresolved-project-keys";` — the test
     imports rather than retypes the string, so a rename in the source cannot silently desync from the test.
   - The sibling criterion ("re-runs repository discovery and E2's gate on EVERY request") already asserts the same
     constant at `tests/panel/metricsApi.test.ts:151`, confirming the new line matches the established pattern
     rather than inventing a new one.
   - The report's own Deviations gap is closed: `task-5-report.md`'s new "Fix round 1" section (lines 364-410)
     quotes the finding verbatim, admits the original criterion covered only 2 of G11's 3 checks and that the gap
     was not listed in the Deviations section, and states this plainly rather than folding it into other prose —
     the Rule 12 silent-drop this finding cited is now surfaced, not just the code gap.
   - Re-run evidence in the report (lines 390-397): `tests/panel/metricsApi.test.ts (12 tests)` all passing,
     `RC=0`, after the added assertion — consistent with the assertion executing without breaking the existing
     12-test count (was already 12 before this one-line addition inside an existing `it`).

## New Breakage in the Fix Diff

None. The diff is a 3-line addition (one assertion plus a two-line comment) inside an existing `it` block in
`tests/panel/metricsApi.test.ts`; it touches no source file (`src/panel/**` untouched by this commit per
`review-6650aab..3b8bd46.diff`'s stat: 1 file, 3 insertions, 0 deletions) and adds no new control flow, mock, or
fixture that could introduce a false-green or a leaked resource.

## Out-of-Scope Observations

None — the fix diff is narrowly the one added line plus its comment; nothing else in this commit range invites
comment.

## Verdict

**Fix round 1:** All findings addressed, no new Critical/Important breakage.
