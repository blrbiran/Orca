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
