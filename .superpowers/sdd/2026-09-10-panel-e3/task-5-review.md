# Task 5 review — metrics endpoint, panel review coverage, static route wiring, skip gate

Reviewed diff `def1204..6650aab` (commits `153daec`, `6650aab`) against `task-5-brief.md`,
`task-5-controller-notes.md` (G1–G13, binding), `task-5-report.md`, `CLAUDE.md` (Rules 9/12/14/17),
and spec `2026-09-09-panel-design.md` §2.2, 3, 4.1, 4.2, 5. Diff read once from the review package;
no repo files edited, no subagents spawned, no tests or mutations re-run.

## Spec Compliance

❌ Issues found — one binding-ruling requirement (G11) was not implemented, and the deviation was
not disclosed in the report. Everything else checked against the brief and G1–G13 is compliant. See
Important #1 below for the one Missing item; everything else in this section is a confirmed ✅.

Verified compliant, with evidence:
- **G1** (wire server now): `src/panel/server.ts` diff — `loadStaticFiles` and `buildApi` calls
  replace the two placeholder comments, in the order the ruling specifies (after token+reviews load,
  before `listen()`).
- **G2** (`TOKEN_REQUIRED` imported, not redeclared): `src/panel/api.ts:27` (diff) —
  `import { PanelRejection, TOKEN_REQUIRED } from "./rejection.js";`. No redeclaration.
- **G3** (one clock, whole-report deep-equal): `PanelOptions.now?: () => Date` added
  (`src/panel/server.ts`); `currentMetrics` reads it (`src/panel/api.ts:59-67`); the pass-through
  test (`tests/panel/metricsApi.test.ts`, "passes E2's report through field for field") builds its
  own `collect()` call with the same fixed clock and does `expect(body.report).toEqual(expectedReport)`
  — the whole report, no field stripped.
- **G4** (HTTP-level traversal criteria, raw path, positive control): the static-serving describe
  block uses `rawGet` built on `node:http`'s `request()` with a raw string `path`, never `fetch`. The
  7 required spellings are all present (`/../../etc/passwd`, `/..%2f..%2fetc%2fpasswd`, `/%2e%2e/`,
  `/./index.js`, `/subdir/index.js`, `/linked.txt`, `/nope.js`), each asserted 404, plus a positive
  control (`/index.js` → 200) in the same criterion.
- **G5** (P-2 reddens two criteria): both criteria exist and are correctly independent (Task 3's
  existing test, unmodified here, plus this task's new one) — consistent with the report's analysis.
- **G6** (never resolve to real `~/.orca`): every `createPanelServer`/`parsePanelArgs` call site in
  `tests/panel/metricsApi.test.ts` passes `{ ORCA_CORRECTIONS_DIR: dir }` explicitly. No call site
  uses an empty env.
- **G7** (P-2-safe bind criterion): "binds the literal 127.0.0.1 by default" goes through
  `parsePanelArgs(...)`, never a hand-built options object — confirmed in the diff. `0.0.0.0` does
  not appear anywhere in the diff.
- **G8** (servers closed in `finally`): every `it` that calls `createPanelServer` wraps `close()` in
  a `finally`, confirmed for all 7 server-starting tests in the diff.
- **G9** (skip gate is a criterion, self-scan without exemption, comment-stripping, must-catch/
  must-not-catch): `tests/panel/noSkips.test.ts` implements `stripComments` (strips `//` and `/* */`,
  passes string contents through unchanged), a `SKIP_PATTERN` regex with `\b` boundaries, and scans
  its own file via `fileURLToPath(import.meta.url)` with no exclusion. I independently traced the
  regex against the file's own raw source (the `DOT`-concatenation trick in `mustCatch`, the
  `"x" + "it("`-style splits, and the `SKIP_PATTERN` regex literal's own text) and confirmed no
  contiguous match exists anywhere in the file's bytes — the self-non-match is real, not merely
  asserted.
- **G10** (five coverage branches, no hard-coded tier table): all five required branches are present
  in `tests/panel/metricsApi.test.ts`'s "panel review coverage" describe block — (a) dedup on
  `reviewed` twice, (b) many `opened` add zero, (c) low-tier `reviewed` adds zero and isn't in the
  denominator, (d) `rate` null at zero denominator, (e) mismatched `projectKey` with same
  `decisionId` adds zero. `isHighTier` is read directly, not hard-coded.
- **G11** (gate criteria assertions) — partially implemented, see Important #1.
- **G12** (`src/metrics/**` untouched): confirmed directly from the diff's file list — only
  `src/panel/*` and `tests/panel/*` are touched.
- **G13** (error handler last, comment naming Tasks 6/7): `src/panel/api.ts` — the four-arg handler
  is the last statement in `buildApi`, preceded by the comment "Express matches by registration
  order. Tasks 6/7 add routes to this function -- always ABOVE this error handler...".

⚠️ Cannot fully verify from this diff alone: whether `loadStaticFiles` (Task 4, unchanged) actually
excludes the `linked.txt` symlink from its in-memory Map at load time, vs. the traversal test's 404
for `/linked.txt` being explained purely by the exact-key-match design. Either way the *security*
property holds (Map.get on an exact key never touches the filesystem or joins a path), so this is a
behavioral note, not a spec-compliance risk — flagging per the reviewer process's "verify only a
concrete named risk" rule rather than broadening into Task 4's code.

## Strengths

- The G4 raw-path evidence is real, not asserted: the positive/negative pair in one criterion
  (`/./index.js` → 404, `/index.js` → 200) is exactly the kind of proof that distinguishes "the raw
  spelling really reached the server" from "some client-side normalization already fixed it."
- The G9 self-scan is a genuinely clever, verifiable construction — I checked it by hand rather than
  trusting the report, and it holds up under actual regex-vs-raw-bytes reasoning, including the edge
  case of the `SKIP_PATTERN` regex literal's own source text.
- Fix round 0 (the NUL-byte incident) was handled with real discipline: byte-level confirmation before
  touching anything, a scan of every file the task touched (not just the broken one), a fresh commit
  rather than an amend, and an honest, non-hand-wavy explanation of why `git diff` against the
  already-binary parent commit still reports "Binary files differ" (it does, correctly, and the
  report doesn't paper over that).
- `computePanelCoverage` is pure (no fs, no clock), matches the brief's interface exactly, and the
  `keyOf` join is documented with the actual reason (decision ids repeat across clones/forks) rather
  than an unexplained implementation detail.
- Every server-starting test threads `ORCA_CORRECTIONS_DIR` explicitly; none relies on ambient
  `process.env`, which is the correct posture for Rule 17.

## Issues

### Critical (Must Fix)

None found.

### Important (Should Fix)

1. **Missing assertion mandated by G11, undisclosed as a deviation** —
   `tests/panel/metricsApi.test.ts`, "answers a broken gate with a first-class error, never with
   partial data" (diff lines ~435–473; the assertions are at diff lines 457–464). Controller ruling
   G11 states this criterion must assert three things: status 409, `body.code === UNRESOLVED_PROJECT_KEYS`
   (imported constant), and `"report" in body === false`. The implemented test asserts only the first
   and third:
   ```
   expect(res.status).toBe(409);
   const body = (await res.json()) as Record<string, unknown>;
   expect("report" in body).toBe(false);
   ```
   The `body.code` check is absent. Functionally this doesn't weaken mutation coverage — the sibling
   test ("re-runs...EVERY request") already asserts `body.code === UNRESOLVED_PROJECT_KEYS` and, per
   the implementer's own E-1 mutation analysis, this test still correctly reds via the status
   assertion under every mutation discussed. But it is a specific, binding, named requirement that
   was not met, and the report's "Deviations from the brief, with reasons" section (which lists five
   other deviations from the brief, each justified) does not mention this one — so it was dropped
   silently rather than surfaced, which is what Rule 12 (fail loud) is for. Fix: add
   `expect((body as { code: string }).code).toBe(UNRESOLVED_PROJECT_KEYS);` to this test (the
   constant is already imported in the file for the sibling test).

### Minor (Nice to Have)

1. `src/panel/api.ts`, `currentMetrics` — `now: () => (opts.now ?? (() => new Date()))().toISOString()`
   is harder to read than it needs to be. `(opts.now?.() ?? new Date()).toISOString()` expresses the
   same "use the injected clock if present, else wall clock" logic more directly.
2. `src/panel/api.ts`, the trailing error handler's 500 branch — `res.status(500).json({ code:
   "panel-internal-error", message: String(err) })`. `String(err)` on an arbitrary caught value can
   surface more than intended (e.g. `"Error: <message>\n    at ..."` is avoided since `String()` on
   an `Error` only yields `name: message`, but a non-`Error` throw could stringify to something
   unhelpful or unexpectedly verbose). Low risk given the panel is loopback-by-default and
   token-gated, but `err instanceof Error ? err.message : String(err)` would be tighter and is a
   common convention elsewhere in this codebase's error handling style.

## Assessment

**Task quality:** Needs fixes (one line, trivial).

**Reasoning:** The implementation is careful, well-evidenced, and the harder correctness properties
(G4's raw-path proof, G9's self-scan, G6/G7/G8's safety-under-mutation reasoning) hold up under
independent re-derivation, not just report-trusting. The one Important finding is narrow — a single
missing assertion in one test, already redundantly covered by mutation-detection elsewhere — but it
is a binding, explicitly-worded controller requirement that was silently dropped rather than flagged,
which is exactly the failure mode Rule 12 exists to catch. Add the one assertion and this task is
approved.
