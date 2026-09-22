# Panel Control Assembly — round ledger

Session `2adcc8bb`, 2026-09-22. Plan: `docs/superpowers/plans/2026-09-22-panel-control-assembly.md`
(plus its appended correction). Spec: `docs/superpowers/specs/2026-09-22-panel-control-assembly-design.md`
(§0–§8 published earlier, §9 onward appended this session). Commits are located by subject line;
this file's own commits move HEAD, so no hash here is a precondition.

## Rulings taken this session (human)

| # | Ruling | Where it is written |
|---|---|---|
| R5 | §3's R1×R3 resolution approved as written: no port ⇒ boot, mount, serve reads, refuse port-dependent commands as `control-port-unconfigured` | spec §9.1 |
| R6 | The display question is closed in this slice by adding `ControlConfigV1.executionPort` | spec §9.2, plan Task 4b |
| R7 | The same shape for the estimator: no estimator ⇒ boot and mount anyway, refuse estimate-dependent commands by name; `ControlConfigV1.defaults` becomes nullable | spec §10 |

## Task 1 — options and path resolution

Created `src/panel/controlOptions.ts` (`resolveControlOptions`, `controlRoot`, `controlDisabled`,
`DEFAULT_CONTROL_WAKE_MS`) and `tests/panel/controlOptions.test.ts`; wired into `parsePanelArgs`
(`src/panel/server.ts`), which now throws `PanelRejection` on a resolution rejection, and documented
the flags in `src/cli.ts`'s usage.

**RED first.** `test-logs/t1-red.log`: the criteria file fails to load because the module does not
exist yet (RC1, "no tests").

**Mutation battery, 11 mutations, every one seen red.** Run in a `git clone --local` copy with the
two uncommitted files copied in and proved byte-identical by `cmp` first (a clone carries committed
state only). Each mutation deletes one branch and only that branch; each used an exact-full-line
anchor with an asserted hit count of 1; the module was restored from the pristine string afterwards
and equality re-asserted. Table and failed-test names: `commands/t1-mutation-battery.json`; the
driver is `commands/t1-mutation-battery.py`.

| Mutation | Result |
|---|---|
| M1 `--no-control` ignored | RC1, 2 failed |
| M2 zero repos no longer turn control off | RC1, 1 failed |
| M3 explicit `--control-state-dir` ignored | RC1, 2 failed |
| M4 multi-repo rejection replaced by a guessed key | RC1, 2 failed |
| M5 wake interval accepted unvalidated | RC1, 8 failed |
| M6 estimator profile no longer required (pre-R7 shape) | RC1, 1 failed |
| M7 estimate mode no longer required (pre-R7 shape) | RC1, 1 failed |
| M8 unrecognised estimate mode accepted | RC1, 1 failed |
| M9 either ccloop variable counts as configured | RC1, 2 failed |
| M10 empty `ORCA_CONTROL_DIR` treated as set | RC1, 1 failed |
| M11 home fallback drops the `control` segment | RC1, 1 failed |

⚠️ M6/M7 were run against the **pre-R7** shape, where a missing estimator was a boot rejection. R7
replaced that with `control-estimator-incomplete` (half a pair) and a served null. The M6/M7 rows are
kept verbatim as what was measured; the branches that replaced them are re-mutated in Task 4b's
battery, where the served value is observable.

## Two collisions the plan had not noticed, both measured before deciding

1. **spec §4 (multi-repo ⇒ `control-state-dir-required`) versus the plan's "existing Panel criteria
   must stay green".** Measured: exactly 2 call sites pass two `--repo` flags
   (`tests/panel/todo.test.ts`, `tests/panel/decisionsApi.test.ts`). Decided by evidence weight
   (CLAUDE.md Rule 7): spec §4 is the direct product of human ruling R2, so the rejection stands and
   those two argument lists gained `--no-control` with an attributed comment. No assertion moved.
2. **spec §6 (estimator required when mounted) versus R1 (mount by default).** Measured, not
   estimated: **36 of 220** `tests/panel` criteria went red across five files that have nothing to do
   with the control plane — unfiltered log `test-logs/t1-collision-36-red.log`, all
   `control-estimator-profile-required`. Both sides had real backing, so this went to the human and
   came back as R7.
   ⚠️ An earlier sizing in this session said the collision was 2 criteria. That was wrong: the census
   behind it only counted `parsePanelArgs([...])` sites written as a literal array and missed every
   site that passes a variable. The number to trust is the 36 in the log.

**Green.** `tests/panel` 24 files / 221 tests, RC0 (`test-logs/t1-panel-green.log`); `typecheck` RC0.

## Task 2 — the named refusal port

Created `src/control/unconfiguredPort.ts` (`createUnconfiguredControlPort`), registered
`control-port-unconfigured` in `src/control/errors.ts`, and carried the name through
`src/control/service.ts`'s `profiledCapabilities`. Criteria: `tests/control/unconfiguredPort.test.ts`
(5 tests).

**Two deviations from the plan's Task 2 text, both deliberate.**

1. The plan expected the code to be classified `internal` in the non-durable catalog. It is registered
   **durable, 422** instead. An internal classification rolls the command back and leaves the panel
   with no named outcome to show, which defeats R5: the point of a closed name is that the operator
   is told which environment variable is missing. 422 is the same status its nearest sibling
   `control-capability-unsupported` carries, and durable registration is what puts it in the catalog
   `controlConfig.ts` serves to the browser.
2. The plan assumed the name would reach `startClaim` by itself. It does not, and that was measured:
   `profiles.ts`'s `probe()` catches every throw into `probeFailureCode`, and
   `service.ts`'s `profiledCapabilities` turns any non-null failure code into
   `control-capability-unsupported`. So a missing environment variable would have been reported as an
   inadequate adapter. One conditional in `profiledCapabilities` re-raises the named code before the
   generic one; `probeFailureCode` keeps its meaning and its population, and no existing assertion moved.

**Mutation battery, 4 mutations, all seen red** (`commands/t2-mutation-battery.json`; harness
`commands/mutation-harness.py`, which clones, copies the dirty working-tree files in, proves them
identical with `filecmp`, mutates one exact full line at a time and restores the pristine text after
each run):

| Mutation | Result |
|---|---|
| M1 the re-raise in `profiledCapabilities` deleted | RC1, 1 failed |
| M2 the optional `probeProfileCapabilities` dropped from the port | RC1, 3 failed |
| M3 the durable status changed from 422 | RC1, 1 failed |
| M4 `accept()` answers `{kind:"unknown"}` instead of refusing | RC1, 1 failed |

**Green.** `tests/control` 41 files passed / 1 skipped, 415 passed / 5 skipped, RC0
(`test-logs/t2-control-green.log`); `typecheck` RC0. The 5 skips are the `/tmp`-artifact integration
files, unchanged from the pre-plan baseline.
