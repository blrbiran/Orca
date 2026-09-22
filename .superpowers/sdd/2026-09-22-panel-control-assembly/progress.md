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

## Task 3 — the profile probe on the ccloop port

`createCcloopExecutionPort` now returns `probeProfileCapabilities`. Criteria added (only added) to
`tests/control/ccloopPort.test.ts`: the probe answer arrives through a real
`createExecutionProfileRouter(...).probe()` with `probeFailureCode` null; the translated view is
asserted field by field; and the resulting intersection is asserted to be capability-refused.

### 🔴 A finding that changes what this task buys, measured not assumed

The plan's premise was that exposing the probe unblocks Web dispatch ("without it every Web dispatch
is `control-capability-probe-failed`"). It does not, and the reason is on ccloop's side:

> ccloop's `control capabilities` returns exactly seven fields (`ccloop src/control/command.ts`, the
> `method === "capabilities"` arm, read this session): `protocol`, `durableAccept`,
> `ownershipIsolation`, `evidenceRetention`, `usageObservation: "phase-end"`,
> `budgetEnforcement: "soft"`, `requestBoundEvidence: null`. **None of them covers
> `contextObservation`, `handoffControl`, `handoffExecution`, `contextWindowTokens` or a
> `requestBoundProof` descriptor**, which is five of the seven fields a `CapabilityViewV1` needs.

`ExecutionPort`'s own contract says absence is capability-unavailable and is "never inferred", and
Orca is not allowed to invent a substitute for a peer's observation. So the probe reports what ccloop
states and `unavailable`/`null` for the rest. The effect is that a Web claim through the real ccloop
port now fails with **`control-capability-unsupported`** (`profiledCapabilities` requires
`handoffControl === "durable"`) instead of `control-capability-probe-failed`.

That is a better answer — it names the peer's limitation instead of blaming a probe that never
ran — but it is **not** a working dispatch path. **Web dispatch to real ccloop stays blocked until
ccloop's `control capabilities` grows the V1 profile-probe fields.** This is a second ccloop-side gap
alongside `ContextObservationV1`, and it is recorded in both handoffs. Nothing on the Orca side may
paper over it; the criterion named "therefore fails a claim closed on capabilities" exists so that a
later reader cannot mistake the closed failure for a regression.

**Mutation battery, 3 mutations, all red** (`commands/t3-mutation-battery.json`): the probe method
removed (RC1, 3 failed); `handoffControl` asserted as `durable` rather than reported absent (RC1, 2
failed); the `unsupported → unavailable` mapping replaced by a constant (RC1, 1 failed).

**Green.** `ccloopPort` + `profiles` 2 files / 16 tests RC0 (`test-logs/t3-green.log`); `typecheck` RC0.

## Task 4 — the envelope translator moved into `src/`

Created `src/control/startEnvelope.ts` (`toStartEnvelope`) and `tests/control/startEnvelope.test.ts`
(9 tests). `tests/control/webCcloopSmoke.test.ts`'s local copy is deleted; what remains there is a
four-line adapter to the production function's signature, so the fixture cannot drift from what a
real dispatch sends.

**Three checks the moved function gained, each because the test copy silently lacked them.** They
are not gold-plating; each is a way a dispatch could be charged to the wrong claim:
`String(run.groupId)` turned a missing run field into the four characters `"undefined"` and sent it,
nothing re-parsed the stored envelope, and nothing checked that the envelope and the run named the
same run and generation. All three refuse with `start-envelope-conflict` and a detail naming which
(`schema:` / `run:` / `identity:`), and the assembled result is parsed against the repository's own
`startEnvelopeSchema` before it is returned.

**Deviation from the plan's Task 4 Step 3.** The plan asked that `StartEnvelope` appear in the smoke
test only as an import and call sites. One hand-built literal remains (the `inspect`-absent case for
`run-web-smoke`), and it stays: there is no ledger row for that run, so there is no
`DispatchEnvelopeV1` to translate and the literal is the subject of the criterion rather than a
second translator. The ledger path goes through `toStartEnvelope`.

**Mutation battery, 5 mutations, all red** (`commands/t4-mutation-battery.json`): contract hash
recomputed instead of taken from the ledger (RC1, 3 failed); the identity check deleted (RC1, 2);
generation dropped from it (RC1, 1); the stored envelope trusted without re-parsing (RC1, 1); the run
row coerced instead of parsed (RC1, 1).

**Green.** `startEnvelope` 9 tests RC0 (`test-logs/t4-green.log`); `typecheck` RC0. The smoke test
itself is one of the 5 environment-gated skips and was not executed this session.
