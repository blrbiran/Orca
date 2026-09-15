# Task 7 — independent mutation verification report

Repo `/Users/biran/code/skills/loop/Orca`. Commit under test: `dc8461b` (BASE `248f03a`). Read `CLAUDE.md` Rules 9,
14, 15, 17; `task-7-mutations-brief.md`; `task-6-mutations-brief.md`'s Hard rules (applied verbatim); the
implementer's `task-7-report.md` (criterion names/files/predictions) and `task-7-controller-notes.md` (rulings and
the controller's own predictions). No subagents were used. No edits were made in the main tree — every mutation was
applied to a fresh `git clone --local` of the commit under test, run, and torn down with `/bin/rm -rf` before the
next one.

Test names use the implementer's abbreviations (task-7-report.md): T1 = unknown-kind refusal, T2 = empty
`chose_instead` refusal, T3 = records-and-does-NOT-close-the-loop, T4 = second-correction-own-message, T5 =
records-another-on-purpose, T6 = GOLDEN_ID, T7 = does-NOT-write-reviewed-when-refused, T8 =
writes-reviewed-when-lands-and-agreed, T9 = failed-reviewed-write-reaches-person (POST /api/reviews), T10 =
tells-person-correction-landed-even-when-reviewed-mark-failed, T11 = 404-for-unlisted-decision.

## Setup / baseline

Main tree before: `git status --porcelain -z` = 90 bytes (` M .superpowers/sdd/2026-09-10-panel-e3/progress.md`,
`?? .decisions/orca-dev-5d5c8055.jsonl` — the controller's own files, per the brief's carve-out). HEAD =
`dc8461bafb41a9bfeccccceeaa8f5e2e876f6a6c`. `ls ~/.orca` → "No such file or directory".

Baseline clone (unmutated, checked out at `dc8461b`, `node_modules` and `web/node_modules` symlinked): `vitest run
tests/panel` → **9 test files passed (9), 67 tests passed (67), RC=0** (`tests/panel/correctApi.test.ts` alone: 11
tests, all green — matches the implementer's report). No process named `src/cli.ts`/`tsx` present after that
wasn't present before; no new TCP listener; no "Unhandled" block; `tests/panel/**` in the clone `cmp`-identical to
the main tree; `ls ~/.orca` absent before and after. Clone removed with `/bin/rm -rf`.

Every mutation below repeats this shape: fresh clone at `dc8461b`, `shasum -a 256` before/after `src/panel/api.ts`
(all differ — no broken run), anchor script asserts the anchor text occurs exactly the stated number of times
(exits non-zero otherwise; all mutations reported `ANCHOR_OK`), byte-scan after the edit (all show `bad_bytes=0`),
`vitest run tests/panel` with output read whole from a file (`RUN` line confirmed pointing into the clone every
time), process/listener census before and after, `ls ~/.orca` before and after, `cmp` of every file under
`tests/panel/` in the clone against the main tree (all `CMP_OK=true`), then `/bin/rm -rf` of `$(dirname "$C")`.
Across all 12 runs (11 mutations + one repeat of K-7 for reproducibility, see below): **zero** leaked `tsx`/
`src/cli.ts` processes, **zero** new node/vitest TCP listeners, **zero** "Unhandled" blocks, `~/.orca` absent every
single time (24 readings).

---

### C-5 — close the loop into the fixture repo after `recordNewCorrection`

Anchor: import line (1 occurrence) + the line after the `recordNewCorrection` try/catch's `next(err); return; }`
and before the `// ruling J6` comment (1 occurrence). Hash before
`3d2656af6a...` → after `c36e342234a...` (differ). Byte scan: `bad_bytes=0 total_bytes=17268`. Diff: adds
`node:fs/promises`/`node:path`/`node:child_process`/`node:util` imports and, on the success path only, finds
`observations.repos.find(r => r.projectKey === projectKey)` (the SAME discovery object the request already
computed — never `process.cwd()`), appends a JSON line to `<repo>/.decisions/mutation-c5-overturned.jsonl`, then
`git add -A && git commit`.

**Safety.** Printed `MUTATION_C5_TARGET_REPO=` before every git-touching call; six prints, all of the shape
`/var/folders/.../T/orca-target-XXXXXX/repo` (i.e. `mkdtemp(join(tmpdir(), "orca-target-"))` from
`tests/corrections/harness.ts`, confirmed by reading that file) — never `/Users/biran/code/skills/loop/Orca` or a
path inside it. The mutation script also throws if the discovered path contains `/code/skills/loop/Orca`; that
guard never fired. After the run: main repo `HEAD` before/after both
`dc8461bafb41a9bfeccccceeaa8f5e2e876f6a6c` (unchanged); main repo porcelain before/after both 90 bytes, identical
content (unchanged).

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 1 failed | 66 passed (67)`, RC=1. Only failure: **"records
and does NOT close the loop" (T3)**, at `tests/panel/correctApi.test.ts:191`:
`expect(await git(repo.path, ["rev-parse", "HEAD"])).toBe(beforeHead)` — expected
`13d2f162f4ef0b5a678175584a77108b73b82e88`, received `06c68dfc315fa88b5399b84936549d078a2216a7`.

**matched** — both the controller's and the implementer's prediction ("red in T3 and only T3").

---

### C-13 — bypass `recordNewCorrection`: `{ id: deriveCorrectionId(row), ...row }` stored via `recordCorrection`

Anchor: import line (1) + the `let stored: Correction; try { stored = await recordNewCorrection(...) } catch (err) {`
block (1). Hash before `3d2656af6a...` → after `9a495198cdb...`. Byte scan: `bad_bytes=0 total_bytes=15623`.

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 3 failed | 64 passed (67)`, RC=1. Failures:
- **T1** ("answers a row the seam would refuse...") — `correctApi.test.ts:111`: `expect(res.status).toBe(400)` —
  expected `400`, received `500`.
- **T2** ("refuses an empty optional field...") — `correctApi.test.ts:144`: same shape, expected `400`, received
  `500`.
- **T7** ("does NOT write `reviewed` when the correction was refused") — `correctApi.test.ts:285`:
  `expect(res.status).toBe(400)` — expected `400`, received `500`.

**differs from both predictions** (controller: "red in T1 and T2 — two"; implementer: "red in T1 and T2, and only
those two"). Three questions:
1. No short-circuit: T7's very first assertion is the one that fails (line 285), same as T1/T2.
2. **Who else walks the changed line, missed by both predictions**: T7's own setup POSTs `validBody({ kind:
   "bogus" })` — the SAME invalid-kind row T1 sends — as the way it produces "the correction was refused" to then
   check no `reviewed` row followed. The bypass's uncaught `correctionSchema.parse` (bare, not `.safeParse`) throws
   an uncoded `ZodError` for ANY invalid row reaching it, regardless of which criterion sent it. T7 sends an
   invalid row for its own unrelated reason (setting up the refused-correction precondition), so it inherits the
   same 500 T1 gets. The implementer's own prediction text enumerated "valid rows (T4, T5, T6, T8, T10)" as
   unaffected but never checked whether any OTHER criterion besides T1/T2 also sends an invalid row — T7 does, and
   that is exactly the gap.
3. The literal `400` in T7's assertion comes from the same place it does in T1: `record.ts`'s
   `CorrectRejection(CORRECTION_ROW_INVALID, ...)`, translated to 400 by the handler's catch — a translation the
   bypass skips entirely for any invalid row, T7's own included.

Corrected finding: **C-13 reddens T1, T2, and T7 — three, not two.**

---

### K-7 — correction row built with `() => new Date()` instead of the panel clock

Anchor: the single `const row = correctionRowFrom(input, panelClock(deps.opts));` line (1 occurrence). Hash before
`3d2656af6a...` → after `9d9086e78c1...`. Byte scan: `bad_bytes=0 total_bytes=15466`.

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 2 failed | 65 passed (67)`, RC=1. Failures:
- **T8** ("writes `reviewed` when the correction lands, and when the person clicks agreed") —
  `correctApi.test.ts:338`: `expect(res2.status).toBe(200)` — expected `200`, received `409` (the SECOND half of
  T8, `POST /api/reviews` for decision B).
- **T6** (GOLDEN_ID) — `correctApi.test.ts:526`: expected `c_ed266d26d170dd27`, received (varies by run —
  `c_72d37fafc5ba1c65` on the first run, `c_fc76a75d7be6b49d` on a verbatim repeat — see below).

Re-ran the identical mutation on a fresh clone (`K7b`) to check this was not a fluke: **same two criteria failed
both times**, at the same line/assertion. Not flaky.

**differs from both predictions** (controller: "red in golden-id criterion; also in the reviewed-row criterion
only if that criterion asserts the CORRECTION's `at`"; implementer: "red in T6 and only T6"). Investigated with a
diagnostic script (reproducing T8's exact scenario, response bodies printed in full — not part of the criterion
files, run in a throwaway clone and discarded): the SECOND POST's actual body was
`{"code":"future-rows-without-as-of","message":"1 row(s) are dated after now (2026-09-10T00:00:00.000Z)... c_636c8e7e3166f355 ..."}`.
Three questions:
1. No short-circuit in T8: `rowsA` (the first half, decision A's `reviewed` row) passes; the break is at line 338,
   the second half.
2. **Who else walks the changed line, and why the controller's stated mechanism was the wrong one even though its
   verdict (T8 reddens) was right**: under K-7 the correction row's `at` is a REAL wall-clock timestamp (today,
   2026-09-16, per the environment) while T8 pins the panel's own clock (`opts.now`) to the fixed
   `2026-09-10T00:00:00.000Z`. Every `/api/*` route re-runs `currentMetrics(deps.opts)` → `collect()` →
   `computeMetrics`, which refuses (E2's integrity gate, `future-rows-without-as-of`) when a stored row's `at` is
   after the panel's own "now". The FIRST correction (decision A) lands with this future-dated row; the gate does
   not fire on that same request because `POST /api/corrections` never re-runs `currentMetrics` after storing. The
   SECOND request in the same test, `POST /api/reviews` for the UNRELATED decision B, does call `currentMetrics`
   again — and that call now sees the poisoned store and refuses with 409, exactly matching the code's own comment
   in `api.ts` about a stale/incorrect row silently disabling the gate "for everyone." T6 does not exercise this,
   because it only ever makes the one POST and never triggers a second `currentMetrics` call in the same process.
   The controller's own guessed mechanism ("if that criterion asserts the CORRECTION's `at`") is not what happens —
   `rowsA`'s assertion on the reviewed row's `at` (not the correction's) passes fine, since `nowIso`/panelClock for
   the `reviewed` append is untouched by K-7.
3. T6's literal `GOLDEN_ID` is unreachable once `at` is wall-clock (confirmed, as both parties predicted). T8's
   literal `200` comes from the test's own expectation that a membership-only, gate-passing request succeeds; the
   received `409`/`future-rows-without-as-of` comes from `computeMetrics`'s integrity check, reached via the SAME
   `currentMetrics` call every route makes.

Corrected finding: **K-7 reddens T6 and T8 — two — but T8 breaks through gate poisoning of an unrelated decision's
`/api/reviews` call, not through any assertion on the correction row's own fields.** This is date-dependent (it
only manifests because "now," 2026-09-16, is after T8's fixed `2026-09-10`); worth flagging since it means K-7's
blast radius is real but incidental to wall-clock drift rather than a property that would hold on every date.

---

### E-7 — `chose_instead: ""` normalised to absent

Anchor: the single spread line (1). Hash before `3d2656af6a...` → after `d03d3aebf03d...`. Byte scan: `bad_bytes=0
total_bytes=15518`.

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 1 failed | 66 passed (67)`, RC=1. Only failure: **T2** —
`correctApi.test.ts:144`: `expect(res.status).toBe(400)` — expected `400`, received `200`.

**matched** — both predictions ("red in T2 and only T2").

---

### C-14 — already-recorded branch answers `err.message` as `message`

Anchor: the 409 `res.status(409).json({...})` block inside the `CORRECTION_ALREADY_RECORDED` branch (1). Hash
before `3d2656af6a...` → after `72dfed0cad1...`. Byte scan: `bad_bytes=0 total_bytes=15252`.

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 1 failed | 66 passed (67)`, RC=1. Only failure: **T4** —
`correctApi.test.ts:229`: `expect(body.message).not.toContain("--again")` — received message contained it:
`"tester has already corrected orca-dev-1/1 in proj: correction c_8c948223c5df90ef (recorded ...). Pass --again to
record another one on purpose."`

**matched** — both predictions ("red in T4 and only T4").

---

### M-7 — both POST handlers skip the membership check

Two anchors (corrections handler's membership block including its trailing `// ruling J2` comment; reviews
handler's membership block including its trailing `const result = await deps.reviews.append({` line), each
asserted exactly once — this mutation genuinely touches two call sites, so two separate exactly-once anchors were
used rather than one anchor matched twice. Hash before `3d2656af6a...` → after `34186159b33...`. Byte scan:
`bad_bytes=0 total_bytes=15131`.

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 1 failed | 66 passed (67)`, RC=1. Only failure: **T11**
("answers 404 for a decision the panel does not list...") — `correctApi.test.ts:451`:
`expect(corrRes.status).toBe(404)` — expected `404`, received `200`.

**matched** — both predictions ("red in T11 and only T11").

---

### V-1 — `POST /api/corrections` does not append `reviewed`

Anchor: the whole `// ruling J6 ... reviewed ...` try/catch block through `res.json({ correction: stored });` (1).
Hash before `3d2656af6a...` → after `b63e378ba07...`. Byte scan: `bad_bytes=0 total_bytes=14456`.

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 2 failed | 65 passed (67)`, RC=1. Failures:
- **T8** — `correctApi.test.ts:334`: `expect(rowsA).toHaveLength(1)` — expected length `1`, received `0`.
- **T10** — `correctApi.test.ts:411`: `expect(res.status).toBe(409)` — expected `409`, received `200`.

**matched** — the implementer's corrected prediction ("red in T8 and T10"), and the controller's own ("writes
-reviewed criterion... and the reviews-lock-held corrections criterion... — two").

---

### V-2 — `POST /api/reviews` appends `action: "opened"` instead of `"reviewed"`

Anchor: `const result = await deps.reviews.append({...action: "reviewed"...})` (unique to the reviews handler) (1).
Hash before `3d2656af6a...` → after `9a66f5b9858...`. Byte scan: `bad_bytes=0 total_bytes=15469`.

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 1 failed | 66 passed (67)`, RC=1. Only failure: **T8** —
`correctApi.test.ts:346`: `expect(rowsB).toHaveLength(1)` — expected `1`, received `0`.

**matched** — both predictions ("red in T8 and only T8").

---

### V-3 — `POST /api/reviews` catches the append failure and answers 200

Anchor: the reviews-handler append call plus its trailing `res.json({ result });` (1). Hash before
`3d2656af6a...` → after `b555a54f826...`. Byte scan: `bad_bytes=0 total_bytes=15628`.

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 1 failed | 66 passed (67)`, RC=1. Only failure: **T9** —
`correctApi.test.ts:376`: `expect(res.status).toBe(409)` — expected `409`, received `200`.

**matched** — both predictions ("red in T9 and only T9").

---

### V-4 — `POST /api/corrections` catches the reviewed-append failure, answers 200 with the stored row

Anchor: the corrections handler's `catch (err) { ... res.status(409)... }` block for the `reviewed` append,
through `res.json({ correction: stored });` (1). Hash before `3d2656af6a...` → after `d9a1e325e38...`. Byte scan:
`bad_bytes=0 total_bytes=15064`.

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 1 failed | 66 passed (67)`, RC=1. Only failure: **T10** —
`correctApi.test.ts:411`: `expect(res.status).toBe(409)` — expected `409`, received `200`.

**matched** — both predictions ("red in T10 and only T10").

---

### V-5 — `POST /api/corrections` appends `reviewed` BEFORE calling `recordNewCorrection`

Anchor: the whole handler body from `const row = correctionRowFrom(...)` through the final
`res.json({ correction: stored });` (1) — reordered so the `reviewed` append happens first, unconditionally,
outside any try/catch, before `recordNewCorrection` is even attempted. Hash before `3d2656af6a...` → after
`f7ec2db9d98...`. Byte scan: `bad_bytes=0 total_bytes=14448`.

**Result:** `Test Files 1 failed | 8 passed (9)`, `Tests 2 failed | 65 passed (67)`, RC=1. Failures:
- **T7** — `correctApi.test.ts:295`: `expect(reviewed).toHaveLength(0)` — expected `0`, received `1`.
- **T10** — `correctApi.test.ts:414`: `expect(body.correction?.id).toEqual(expect.any(String))` — expected a
  string, received `undefined` (and, consistent with the reordering, `readCorrections` would be 0, not 1, since
  the append — held under T10's reviews lock — throws before `recordNewCorrection` is ever called).

**differs from the implementer's own prediction** ("red in T7 and only T7"), **matches the controller's**
("...the does-NOT-write-reviewed-when-refused criterion and the correction-landed-but-mark-failed criterion (the
append fails first, nothing is recorded) — two"). Three questions:
1. No short-circuit: T7's and T10's failures are each at their first relevant assertion.
2. The implementer's reasoning ("for the success-path tests, reordering two awaited calls that both succeed
   produces the same final state, so they are unaffected") implicitly assumed the `reviewed` append always
   succeeds — true for T4/T5/T6/T8/T11, but **not for T10**, which deliberately holds the reviews lock so the
   append FAILS. Reordering means that failure now happens BEFORE, not after, `recordNewCorrection`, and with no
   try/catch around it in this mutation, the exception propagates straight to `next(err)` (409 via the shared
   handler) with the correction never recorded at all — a materially different outcome than V-4's "correction
   recorded, reviewed-mark failure reported alongside it."
3. T7's literal `0` comes from its own filter query; T10's `expect.any(String)` on `body.correction?.id` comes
   from the corrections handler's own success-shape response, which under V-5 is never reached because the
   reviews-lock rejection surfaces through the generic error handler (`{code, message}`, no `correction` field)
   instead.

Confirms: **V-5 reddens T7 and T10 — two**, as the controller predicted; the implementer's report undercounted
this one.

---

## Summary table

| id | RC | failing (measured) | vs. controller | vs. implementer |
|---|---|---|---|---|
| C-5 | 1 | T3 (1) | matched | matched |
| C-13 | 1 | T1, T2, T7 (3) | differs (controller said 2) | differs (implementer said 2) |
| K-7 | 1 | T6, T8 (2) | differs (right count, wrong mechanism for T8) | differs (implementer said 1) |
| E-7 | 1 | T2 (1) | matched | matched |
| C-14 | 1 | T4 (1) | matched | matched |
| M-7 | 1 | T11 (1) | matched | matched |
| V-1 | 1 | T8, T10 (2) | matched | matched |
| V-2 | 1 | T8 (1) | matched | matched |
| V-3 | 1 | T9 (1) | matched | matched |
| V-4 | 1 | T10 (1) | matched | matched |
| V-5 | 1 | T7, T10 (2) | matched | differs (implementer said 1) |

No fully-green mutation was observed among these 11 — every mutation reddened at least one criterion, so there is
no "green mutation is a finding" case to report here (unlike Task 6's L-3).

## Final checks

- Main-tree `git status --porcelain -z`: **90 bytes before, 90 bytes after**, identical content (
  ` M .superpowers/sdd/2026-09-10-panel-e3/progress.md`, `?? .decisions/orca-dev-5d5c8055.jsonl` — controller's own
  files, per the brief's carve-out; nothing under `src/`, `tests/`, `web/` appeared at any point).
- Main-tree `HEAD`: **`dc8461bafb41a9bfeccccceeaa8f5e2e876f6a6c` before and after** — unchanged (checked
  specifically around C-5, the only mutation that touches a real `git commit`, and again at the very end).
- `ls ~/.orca`: absent on all 24 readings (before/after each of the 12 runs).
- No leaked `tsx`/`src/cli.ts` process, no new node/vitest TCP listener, no "Unhandled" block, on any of the 12
  runs.
- Every mutation's `cmp` of the clone's `tests/panel/**` against the main tree: `CMP_OK=true` (no mutation leaked
  into a criterion file).
- All 11 mutations produced a changed `src/panel/api.ts` hash (no broken runs) and `bad_bytes=0` on every
  byte-scan.
- No clone directories were left behind (`/bin/rm -rf` after every run; verified empty glob at the end).
