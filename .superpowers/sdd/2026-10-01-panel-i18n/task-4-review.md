# Task 4 review — bd6ccfc..4977c10

Reviewer subagent of session e604b1ba (controller session_01GCbsgLfqFPgpeG3gTbBkbh), 2026-10-01, reviewing commit `4977c10`
(`d812323` in the range touches only `.orca/checkpoints/` and is ignored). Inputs: task-4-brief.md, task-4-report.md,
review-bd6ccfc..4977c10.diff, spec §3.4/§6.10, global.md. Reviewer clone: `$SCRATCH/rev-t4` (kept, per P10), at 4977c10.

### Spec Compliance

- ✅ Spec compliant.
  - §3.4, server: `src/metrics/types.ts` adds `MetricsNoteCode` and `caveatCodes` / `knownBiasCode` / `reasonCode`.
    `src/metrics/compute.ts:128-133` pushes `unresolved-decisions` in the same branch as `UNRESOLVED_CAVEAT`, so the codes
    stay index for index with the sentences. `src/panel/coverage.ts` adds `caveatCode`. The sentences are unchanged, and
    the CLI text printer (`src/metrics/report.ts:45,55`) still prints them. I checked with `git grep`: it is the only
    other reader of these fields.
  - §3.4, panel: `web/src/MetricsView.tsx` `noteText` shows `metrics.note.<code>` when `i18n.exists`, otherwise the
    sentence. All five sentence sites go through it.
  - §6.10: `tests/metrics/noteCodes.test.ts` matches the brief verbatim. `web/tests/metricsNotes.test.tsx` matches the
    brief except for the one strengthening judged below.
  - Every file the brief lists has its hunk, including the H18 rewrites:
    - golden.json: exactly 4 insertions plus 2 trailing commas.
    - `webParity.test.ts`: both functions as named, each with the H18 comment line.
  - The web mirror fields are optional, each with the brief's comment.
  - `en.metrics` values are today's rendered English:
    - The headings and counts match the removed JSX (diff l.473-522).
    - The notes are pinned byte for byte to the server sentences by noteCodes (MT4-3).
    - The type is guarded by `satisfies Record<MetricsNoteCode | "reviewed-is-deliberate", string>`.
- ⚠️ Cannot verify from the diff: none. The web setup (`web/tests/setup.ts`) switches the language back to `en` after each
  test, so the metricsNotes English test does not inherit `zh` from the test before it (checked because the English test
  never sets the language itself).

### The strengthened `web/tests/metricsNotes.test.tsx` (the implementer's deviation)

**Justified, and within bounds.** The brief's `expect(text).toContain("纠正率")` cannot turn red, because the Chinese
`no-review-coverage` note contains "…规定纠正率绝不能单独解读". Two things confirm this:

- The rendered text in the implementer's `$SCRATCH/t4-MT4-6.txt` shows the string inside that note.
- `t4-MT4-8.txt` (read in full) shows the strengthened criterion red on the `h2` list (`'Correction rate'` vs `'纠正率'`).
  The report says the brief's version measured rc=0 under the same mutation.

The replacement asserts each thing where it is shown:

- the exact `h2` list;
- `correction-rate` equals `zh.metrics.unknownRate`;
- the three count testids equal literal Chinese strings, which also pins the `{{n}}` interpolation.

Everything else in the file is the brief's text. This is the Rule 9 remedy, the same shape as the controller's rulings
P3 and P4. It adds no production code.

### Strengths

- The server change is minimal and additive. There is one shape for the CLI and the panel (the F8 ruling), and the
  golden diff has only the four named insertions.
- The index-for-index invariant is built structurally, not asserted after the fact: the code is pushed in the same `if`
  as its sentence.
- `webParity`'s rewrite still checks both directions. `reportServerToWeb` is unchanged, so a code the server adds that
  the web union lacks is still a compile error. Only an absent optional field is normalised.
- The mutation work goes beyond the brief:
  - MT4-9 (the unresolved guard forced to `true`).
  - MT4-10..18: every `t` site seen red.
  - Every restore was checked with `cmp`.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)

1. **Two of the five `noteText` call sites cannot be seen by any criterion (Rule 9).** Plan-mandated in part: the brief's
   fixture and its mutation list both miss them. The report's "none are left unlisted" counts only the ten `t` sites, not
   the `noteText` sites. I measured both in `$SCRATCH/rev-t4`:
   - **MutA:** `web/src/MetricsView.tsx:503` changed from `{noteText(report.review_coverage.reason, report.review_coverage.reasonCode)}`
     to `{report.review_coverage.reason}`. Ran `(cd web && ../node_modules/.bin/vitest run tests/metricsNotes.test.tsx tests/metricsView.test.tsx)`:
     **rc=0, 7/7 green** (`$SCRATCH/rev4-mutA.txt`, read whole).
     - Why it stays green: the zh test's `toContain(zh.metrics.note["no-review-coverage"])` is also satisfied by the
       correction-rate caveat, which carries the same code.
     - Nothing asserts that `"the server's reason sentence"` is absent.
   - **MutB:** `MetricsView.tsx:491` changed from `{noteText(caveat, report.repair_rate.caveatCodes?.[index])}` to
     `{caveat}`. Same command: **rc=0, 7/7 green** (`$SCRATCH/rev4-mutB.txt`, read whole).
     - Why it stays green: the fixture's repair caveat has no code, so both paths render the sentence.
   - Restore: `git diff` plus `git diff --cached` came to 0 bytes (`$SCRATCH/rev4-restore.txt`).
   - No other test renders MetricsView (`git grep` for `MetricsView` / the testids finds only these two files), so the
     full web suite would not catch either mutation.
   - Effect: in production the server always sends `reasonCode` and `repair_rate.caveatCodes`. Either regression would
     leave that sentence in English under `zh` while every criterion stays green.
   - Fix: in the zh test, assert per testid:
     - `review-coverage-reason` text is `zh.metrics.note["no-review-coverage"]`.
     - `repair-rate-caveats` `li` texts equal `[zh.metrics.note["no-review-coverage"], "the server's repair sentence, no code"]`.
       For this, give the repair fixture `caveats: [<a sentence>, "the server's repair sentence, no code"]` and
       `caveatCodes: ["no-review-coverage"]`. That keeps a no-code case (the index past the end gives `undefined`) and
       also exercises the repair index.
     - Then see MutA and MutB red.

#### Minor (Nice to Have)

1. **Rule 14 evidence gap, self-disclosed.** After the strengthening, the MT4-5/6/7 re-runs were read only for their first
   8 lines. I read `t4-MT4-6.txt` in full: it is red for the stated reason. `t4-MT4-5.txt` and `t4-MT4-7.txt` exist
   (3.7K and 4.7K), but I did not read them in full.
2. **The web `PanelCoverage.caveatCode` type is the single literal `"reviewed-is-deliberate"`** (`web/src/types.ts`).
   A newer server's other code would be mistyped. Runtime is unaffected, because `noteText` takes a `string` and falls
   back to the sentence. This mirrors the server type exactly, as the brief asks, so it needs no action now.
3. **`key={caveat}`** (`MetricsView.tsx:480,491`) is keyed on the sentence, not the index or code. This predates the
   task and is unchanged. It is noted only because the index now matters to the render.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The server and resource changes are correct, minimal, and match spec §3.4. The strengthened web
criterion is justified. However, the review-coverage reason and repair-caveat translation sites both survive deletion
mutations with every criterion green (measured). Rule 9 requires them to be seen red, and this is a small fixture and
assertion fix.

## Re-review (fix round 1)

Re-reviewer subagent of session e604b1ba (controller session_01GCbsgLfqFPgpeG3gTbBkbh), 2026-10-01, fix range
`4977c10..8bbc437` (only `web/tests/metricsNotes.test.tsx`, +8/-1). Inputs: review-4977c10..8bbc437.diff,
task-4-report.md "Fix round 1", task-4-brief.md. Clone `$SCRATCH/rev-t4` synced to 8bbc437 by `cat` of the one changed
file; `git diff 8bbc437` came to 0 bytes (`$SCRATCH/rev4f-sync.txt`).

### Finding Verdicts

- **Important 1: the `noteText` sites for the review-coverage reason and the repair caveats cannot be seen** — ADDRESSED.
  - `web/tests/metricsNotes.test.tsx:62` asserts `review-coverage-reason` text `toBe(zh.metrics.note["no-review-coverage"])`.
  - `web/tests/metricsNotes.test.tsx:63-65` asserts the `repair-rate-caveats` `li` list equals
    `[zh…note["no-review-coverage"], "the server's repair sentence, no code"]`. The fixture (l.25) gives the first
    caveat a known code and leaves the second past the end of `caveatCodes`, so both the index lookup and the no-code
    fallback are exercised.
  - Measured, criterion `(cd web && ../node_modules/.bin/vitest run tests/metricsNotes.test.tsx tests/metricsView.test.tsx)`,
    every output read whole:
    - Green at 8bbc437: rc=0, 7/7 (`$SCRATCH/rev4f-green.txt`).
    - MutA (`MetricsView.tsx:62` `noteText(report.review_coverage.reason, …reasonCode)` -> `report.review_coverage.reason`):
      rc=1, red at `metricsNotes.test.tsx:62`, received `"the server's reason sentence"` (`$SCRATCH/rev4f-mutA.txt`).
    - MutB (`MetricsView.tsx:53` `noteText(caveat, report.repair_rate.caveatCodes?.[index])` -> `caveat`): rc=1, red at
      `metricsNotes.test.tsx:63`, received `"the server's repair sentence beside the known code"` (`$SCRATCH/rev4f-mutB.txt`).
    - Restore by `cat` from a copy; `git diff 8bbc437` plus `git diff --cached` came to 0 bytes (`$SCRATCH/rev4f-restore.txt`).
  - Both mutations were green (rc=0) before the fix (`$SCRATCH/rev4-mutA.txt`, `rev4-mutB.txt`), so each is now seen red.

### New Breakage in the Fix Diff

None. The fixture change adds a second repair caveat with a distinct sentence, so `key={caveat}` stays unique; the
English test is unaffected (green in `rev4f-green.txt`). No production code changed.

### Out-of-Scope Observations

None.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
