# Task 9 review — verify:panel (Rule 4 success criterion)

Base `d44f6bb`, Head `1a95e7d`. Diff read from
`.superpowers/sdd/2026-09-10-panel-e3/review-d44f6bb..1a95e7d.diff` (874 lines, full context). Files
changed: `package.json` (+2/-1), `scripts/verify-panel.ts` (new, 774 lines), `tests/panel/endToEnd.test.ts`
(new, 47 lines). Method: brief (`task-9-brief.md` §"Task 9" through the `verify` wiring) + binding
`task-9-controller-notes.md` rulings L1–L7, plus spec §7 and Global Constraints (plan lines 33-59).
Outside-diff checks made for named risks only: `tests/panel/reviewsStore.test.ts` (L1 claim),
`src/panel/{bindGuard,rejection,api}.ts`, `src/panel/{staticFiles,reviewsLock,listProjection}.ts`,
`src/corrections/store.ts`, `src/metrics/discover.ts`, `src/cli.ts` (import-target and control-flow
verification for finding (d)/(e)), and the full commit message via `/usr/bin/git log -1 --format=%B`.

## Named risks (a)–(h)

**(a) child-process env redirection + process-group teardown on every exit path.** Verified. Both
spawned children (`panelArgs` at scripts/verify-panel.ts:561-571, `secondArgs` at :754-764) share one
`env` object carrying `ORCA_CORRECTIONS_DIR: storeDir` (line 558). `killGroup` uses `process.kill(-pid,
"SIGKILL")` (process-group form, :354-361). `panelChild`'s teardown is registered in `cleanups` (:573-576)
immediately after spawn — before `ready` is awaited — so a thrown/rejected `ready` still tears it down.
`watchExit` attaches its `once("exit", ...)` listener exactly once, at spawn time, and is reused
everywhere (:373-377); the report documents a real bug (a second listener attached post-kill, which
never fires because `"exit"` fires once) that was found and fixed during this task's own repeatability
check — confirmed by the second-run residue census (ps/lsof/`$TMPDIR` all byte-identical before/after).
Verdict: solid, empirically confirmed.

**(b) only non-loopback address is 192.0.2.1 in step 11, unconfirmed; no `0.0.0.0`; bind never omitted.**
Both spawns pass `--bind` explicitly (127.0.0.1 for the panel under test, 192.0.2.1 for step 11); neither
omits it. `secondArgs` carries no confirmation flag. The literal `"0.0.0.0"` does appear once, but only
inside `tests/panel/endToEnd.test.ts:856` as a must-catch *input string* to `parseReadyLine` (a rejected
URL sample) — no network operation touches it. This satisfies the intent (the global constraint is about
never causing a real non-loopback bind) but is a literal string match on "0.0.0.0 appears nowhere" — see
⚠️ below.

**(c) all twelve steps present and match L5.** Verified step-by-step against L5's corrected text:
step 0 (pre-check, dist flat + `TOKEN_ANCHOR`, :535-550) → step 1 (`parseReadyLine` via `must`, :578) →
step 2 (bounded-absence `assertStaysAt`, per-decision, per-projectKey, :598-609) → step 3 (positive
`waitForExactly` for `opened==1`, then bounded-absence for `reviewed==0`, :613-629) → step 4 (bounded
"still only 1", :632-640) → step 5 (exact `reviewed==1` + coverage numerator + to-do list membership on
both A and B, :645-659) → step 6 (`.decisions/` snapshot: sorted names + sha256, plus `git rev-parse
HEAD` before/after, plus porcelain, :664-685) → step 7 (409/code/message-lacks-`--again`/`retry_field`,
:689-706) → step 8 (`recordCorrection` into the redirected store *after* the panel is up, then 409
`UNRESOLVED_PROJECT_KEYS`, :708-728) → step 9 (raw `node:http` traversal → 404, plus the positive control
`GET /` → 200 with token in body, :735-741) → step 10 (401 `TOKEN_REQUIRED`, :744-748) → step 11 (named
refusal + pid-scoped `lsof`, :750-781) → step 12 (`~/.orca` structural snapshot compare, exists/entries/
size/mtime, before main() starts through after the child exits, :787-791). All exact per-decision,
per-window semantics ruling L5 specifies are present; no step is missing or unassertive.

**(d) all named comparisons import, never retype.** Verified every one of `detailUrl`,
`TOKEN_REQUIRED`, `UNRESOLVED_PROJECT_KEYS`, `CORRECTION_ALREADY_RECORDED`, `EXTERNAL_BIND_NOT_CONFIRMED`
(the bind refusal code), `TOKEN_ANCHOR`, `REVIEWS_LOCK_TIMEOUT_MS` both against their import statements
(scripts/verify-panel.ts:77-90) and against their actual `export const` definitions in
`src/panel/{rejection,bindGuard,staticFiles,reviewsLock}.ts`, `src/metrics/discover.ts`,
`src/corrections/store.ts`, `src/panel/listProjection.ts` — all confirmed present and correctly named.
No retyped literal stands in for any of these.

**(e) FAIL prints, exit 1 after teardown; teardown failure surfaced, not swallowed.** Partially fails.
`exitCode` is set to 1 for any thrown error in the main try block (StepFailure or otherwise, :792-798),
and `return exitCode` happens after the `finally` block's teardown loop completes, so the exit-code side
is correct. But a teardown `cleanup()` throwing (e.g. `rm(root, {recursive:true,force:true})` on the
fixture repo or the store dir, :803-807) is caught and only `console.error`'d as a "teardown warning" —
it never sets `exitCode = 1`. If the main steps all pass but a cleanup step fails (leaving a temp
directory behind — exactly the residue category risk (a) exists to prevent), `npm run verify` still
exits 0. See Important #1.

**(f) endToEnd.test.ts must-catch/must-not-catch + value assertion.** Verified against L3 exactly:
must-not-catch (real shape with surrounding log lines, :838-844, with a value assertion
`expect(parsed.token).toBe(GOOD_TOKEN)` — not just shape); must-catch: no line (:846), missing `token=`
(:850), bad `url=` in three variants (:854-862), bad token in four variants (:864-871). All four
must-catch categories L3 names are present, plus the value assertion.

**(g) verify string equals L4 target exactly.** Byte-compared the diff's new string
(package.json:29) against the L4 target string in the controller notes — identical.

**(h) destructive `rm` calls guarded against empty/unexpected paths.** Both `rm()` targets (`root` and
`storeDir`) are always the direct return value of `await mkdtemp(...)`, captured in a closure and never
re-derived or re-assigned before use; `mkdtemp` either returns a fresh unique non-empty path or throws
(in which case the `cleanups.push` line is never reached, so no cleanup entry exists for a
directory that doesn't exist). This is a stronger guarantee than an explicit `"${VAR:?msg}"`-style guard
would add in a shell script, because there is no code path that reaches `rm()` with an unset/empty
variable. No defect.

## Spec compliance

✅ Spec compliant against brief §"Task 9" (Step 2/3) as amended by controller notes L1–L7:
- L1: verified independently (`tests/panel/reviewsStore.test.ts:64-71`) — the existing criterion does
  `chmod(dir, 0o755)` *before* `append()` and asserts it survives, so it is adequate; correctly left
  unmodified, matching the report's claim.
- L2: `scripts/verify-panel.ts` (not `.mjs`), `tsx` in the script entry, `detailUrl` and every named
  constant imported. Verified.
- L3: `tests/panel/endToEnd.test.ts` present with the required samples. Verified.
- L4: verify string byte-identical to target. Verified.
- L5: all twelve steps + step-0 pre-check present with the corrected semantics. Verified.
- L6: registered gap present in the commit message (`git log -1 --format=%B 1a95e7d`) verbatim. Verified.
- L7: not this task's obligation (controller writes the ledger row).

No Missing / Extra / Misunderstood found against brief+notes.

⚠️ Cannot independently verify without re-running: wall-clock timing (45s), the specific PASS/FAIL
output of the actual runs, and the repeat-run residue census — these are the implementer's reported
empirical evidence (Rule 14) and match the instructions' "do not re-run the suite" guidance; nothing in
the report's shape suggests truncation or fabrication (imports, control flow and constants all
cross-checked independently against source).

## Strengths

- Every one of the eight named risks maps to a specific, checkable line range — nothing is asserted
  by prose alone; e.g., step 9's positive control (:737-740) exists specifically because "delete the
  static route" would otherwise leave the traversal check green for the wrong reason, and the code
  comment names that exact trap.
- The bounded-absence-window pattern (`assertStaysAt`) is applied consistently and only where L5/R59
  calls for it (steps 2-4), while genuinely synchronous writes (step 5's `reviewed`, step 6's correction
  `reviewed`) are checked with a direct read — and this asymmetry is independently confirmed correct by
  reading `src/panel/api.ts:284-290`'s own comment ("awaited on purpose").
- Step 12's `~/.orca` handling is the structural before/after snapshot ruling R56 asks for, not a bare
  absence assertion — it will not punish a person who has run `orca correct` for real.
- The report documents a real, non-mutation bug found and fixed during its own repeatability check (a
  double `"exit"` listener causing an unbounded hang), including the specific Node semantics that made
  it silent — this is exactly the kind of self-report Rule 12 asks for.
- The mutation prediction table (11 mutations + R-9b) is specific about *which* step or file reddens and
  *why*, including honestly noting E-11 is caught by the unit test rather than the script itself, and E-9
  requires knowing the resulting exit code is 3 for the wrong reason before the guard's own code shows up.

## Issues

### Critical (Must Fix)
None found.

### Important (Should Fix)

1. **Teardown failures don't affect the exit code.** `scripts/verify-panel.ts:799-808` — a `cleanup()`
   throwing (e.g. a failed `rm` on `root` or `storeDir`) is caught and only logged as a "teardown
   warning"; `exitCode` is never touched in that branch. Since this script becomes part of `npm run
   verify` for every future agent specifically to catch residue (risk (a): "no path can leave a listener
   or a temp dir"), a teardown failure that leaves a temp directory behind should make the run fail, not
   merely print a warning that nothing downstream reads on a green run. Fix: track whether any
   `cleanupErr` occurred and OR it into `exitCode` (e.g. `exitCode ||= 1` on teardown failure), or use a
   distinct nonzero code so this can be triaged separately from a step failure.

### Minor (Nice to Have)

1. **Step 11's forced-kill path doesn't await confirmed exit before rejecting.** `runToExit`'s timeout
   branch (scripts/verify-panel.ts:461-471) calls `killGroup(child)` and rejects immediately, unlike
   `panelChild`'s teardown (:573-576) which explicitly awaits `panelExited` after `killGroup`. Low risk
   in practice (SIGKILL to a process group is reliable, and this path only executes when step 11 is
   already about to fail), but it is the one process-teardown path in the file that doesn't confirm the
   process is actually gone before moving on.
2. **The literal `"0.0.0.0"` does appear once**, as a must-catch input string in
   `tests/panel/endToEnd.test.ts:856` (never a bind). Global Constraint 6 says "变异列里不许出现
   `0.0.0.0`" (in the *mutation list*) and the controller notes' risk (b) says "`0.0.0.0` appears
   nowhere" more broadly — worth the controller confirming this reading (rejecting the string as an
   invalid URL, not spawning anything) is the intended exception, since it is a literal grep hit.
3. `scripts/verify-panel.ts` is 774 lines in one file (fixture/process helpers/12 steps all together).
   Not flagged as a defect — it's a self-contained, single-purpose verification script and the plan's own
   self-review anticipated "HTTP round-trip main bodies" being long — but a future maintainer would
   benefit from splitting fixture/process-plumbing helpers from the step bodies.
4. Step 0 (the pre-check) isn't one of the brief's numbered twelve; already flagged as a documented
   deviation in the report with a defensible reason (uniform one-PASS-line-per-checkpoint contract).

## Assessment

**Task quality:** Needs fixes (one Important item; otherwise Approved)

**Reasoning:** The implementation is thorough and unusually well cross-checked against its own binding
rulings — all twelve steps, all named imports, and the verify-string byte-match were independently
verified against source and pass. The one real gap is that this script's teardown discipline, which is
the explicit first-order safety concern for a script now wired into every future `npm run verify`, has an
exit-code hole: a failed cleanup is logged but not surfaced as a failing run, which is the type of
silent-degradation risk Rule 12 and this task's own risk-naming exist to prevent.
