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

## Task 4b — the two fields R6 and R7 ask for, end to end

`ControlConfigV1` gains `executionPort: "configured" | "unconfigured"` (required) and its `defaults`
becomes nullable, on both sides of the parity boundary. `TrustedControlConfigInput` gains
`executionPort` and makes `adapterConfigPath` and the estimator pair nullable, with two cross-field
refinements so neither pair can disagree. The Web renders both states. New criteria:
`tests/panel/controlConfigPort.test.ts` (8) and `web/tests/controlPortBanner.test.tsx` (6).

**Fixtures touched, assertions not.** The typechecker named every construction site, and each gained
`executionPort: "configured" as const` with an attributed comment: `tests/panel/controlConfig.test.ts`
(4), `tests/panel/controlReadApi.test.ts`, `tests/panel/fixtures/controlPanel.ts`,
`tests/control/planImport.test.ts`, and the three `web/tests/*` config fixtures. No assertion moved.

**The Web could no longer form two commands, which is the point.** With `defaults: null` there is no
estimator profile to name in an import and no mode to fall back on in a confirm. Rather than sending
an empty id or a guessed mode, `ControlPanel`'s import form and `BudgetEditor`'s confirm button are
refused with a note naming the missing flags. Guessing the mode is exactly the fault spec §6 named.

**Mutation battery, 6, all red** (`commands/t4b-mutation-battery.json`):

| Mutation | Result |
|---|---|
| M1 the field is not copied into the served view (served as a constant) | RC1, 1 failed |
| M2 the port answer derived from `probeFailureCode` instead | RC1, 1 failed |
| M3 the port/adapter-config refinement dropped | RC1, 2 failed |
| M4 the estimator pair refinement dropped | RC1, 1 failed |
| M5 an estimator named but absent silently accepted | RC1, 1 failed |
| M6 the field added to the server schema only | `typecheck` RC2, and the output names `webParity` |

M6 is the plan's Step 3 and is judged by `typecheck`, not by vitest, because `tests/panel/webParity.test.ts`
is a type-level criterion. **It had never been seen to fail before**; it has now, and the failure names
the parity test, so the guard against a half-added protocol field is a guard rather than a claim.

**Green.** `tests/panel/controlConfigPort.test.ts` 8 tests RC0 (`test-logs/t4b-panel-green.log`);
`npm --prefix web run check` RC0 = 14 files / 70 tests (`test-logs/t4b-web-green.log`); root `typecheck` RC0.

## Task 5 — the shipped panel builds and mounts the plane

Created `src/panel/controlAssembly.ts` (`assembleControlRuntime`) and mounted it from
`src/panel/server.ts`; `tests/panel/controlMount.test.ts` (12 tests) is the first set of criteria in
this repository about the **shipped process** serving `/api/control`, rather than a fixture.

### 🔴 A Rule 17 breach this task caused, and how it was closed

Mounting by default made `createPanelServer` open a control store, and the default root is a real
home directory. The existing `tests/panel` criteria do not relocate `ORCA_CONTROL_DIR`, because
nothing used to need it. Running the suite therefore **created `~/.orca/control/{proj, known,
github.com/biran/orca}` in the operator's real home** — the exact outcome Rule 17 names as
unacceptable. Measured, not inferred: `test-logs/t5-rule17-breach-33-red.log`, and the directory was
listed afterwards.

This is recorded rather than quietly fixed because the fix has two halves and only one of them is code:

1. **Mechanical guard, added:** `tests/setup/relocateUserData.ts`, wired as vitest `setupFiles`, gives
   every test file its own temp `ORCA_CONTROL_DIR`. Remembering the variable in each criterion is not
   a guard — it was measured failing — so forgetting it now lands in a temp directory instead.
2. **`scripts/verify-panel.ts` relocates too**, in `spawnOrcaCli`, so a new step cannot forget.
   **Its own step 12–14 guard caught this**: "~/.orca is unchanged by the whole run" failed with a
   byte-level diff of what had appeared. That guard had never fired before; it has now, and it works.

⚠️ **The artifact this created in the real home has NOT been removed.** Deleting under a home
directory needs the operator's word, and the attempt to move it aside was refused by the harness's
own destructive-action guard. `~/.orca/control/` currently holds the stores this session created:
`proj/`, `known/`, `github.com/biran/orca/`, plus the post-fix `proj-e73c023a/`, `known-7117fff2/`,
`github.com-biran-orca-26b561d6/`. Before this session, the Orca handoff recorded `~/.orca` as not
existing. It is the operator's call.

### Three things that had to be built, not wired

- **No production source of execution profile snapshots existed at all.** The fixture used a
  constant, and a snapshot pins content hashes of an adapter config, a model policy and proof
  documents; deriving those here would freeze an identity nothing was frozen against. Added
  `--profile <path>`, which loads and parses a snapshot the operator names. **Zero profiles is a
  served state**, consistent with R5 and R7: the panel serves every read and can start nothing.
- **A project key is neither a path component nor an id.** This repository's keys are normalised
  remote URLs (`github.com/biran/orca`), and joining one onto a root makes nested directories — that
  is why `~/.orca/control/github.com/biran/orca` appeared above — while `repoId` is an `idSchema`.
  `controlRepoKey()` encodes it once for both uses: a readable slug plus eight hex of a sha256 of
  the original, because sanitising alone maps `a/b` and `a-b` to one store.
- **A control store is a single writer.** A second `orca panel` on the same repository cannot have
  it, and must not. But refusing to boot the second panel would take the read-only decision viewer
  away for no gain, so a contended store means the panel boots without the plane and says so on
  stderr. **This is a decision, not a ruling** — reversible, and it changes what running `orca panel`
  twice does, which before this slice simply worked because there was no store to contend for.

Paths are `realpathSync`'d before they reach the trusted config, because `/tmp` is a symlink on this
platform and `checkedPath` refuses a path that traverses one.

**Green.** `tests/panel` 26 files / 245 tests RC0 (`test-logs/t5-panel-green.log`); `verify:panel`
RC0, `PASS 0`–`PASS 14` (`test-logs/t5-verify-panel.log`), whose step 12 now reads
"~/.orca is unchanged (present before and after)" — present, because of the artifact above;
`typecheck` RC0.

## Task 6 — recovery before listen, and a wake pump the process owns

`src/panel/server.ts` now goes through `runControlPanelStartup({ recover, listen })`, and `listen`
is the call that opens the socket rather than a promise created earlier — the ordering is real, not
described. `ControlRuntime` gained `recover()`, `pump()`, `startPump()` and a `close()` that stops the
timer. Criteria: `tests/panel/controlStartup.test.ts` (7 tests).

The pump: one pass in flight, a re-entrant call returns **the same promise** rather than starting a
second (asserted by identity, because "both resolved" would pass either way); every pass goes through
`withAdmission`, so it cannot slip a write past a draining shutdown; the timer is `unref`'d, because
the pump is something the process does while alive, never a reason to stay alive. `startPump` answers
whether it armed — idempotence that cannot be observed cannot be judged, and a second timer would
double every delivery for the life of the process.

**Mutation battery, 5, all red** (`commands/t6-mutation-battery.json`): listen no longer waits for
recovery (RC1, 2 failed); a re-entrant pump starts a second pass (1); the in-flight handle never
cleared (1); a second timer can be armed (1); `close` no longer stops the timer (1).

### A pre-existing store race, handled here and reported rather than fixed

`src/control/store.ts` creates `service-lock/owner.json` with `openSync(..., "wx")` and writes it
immediately afterwards. A second process reading it in between sees zero bytes and `JSON.parse`
throws a plain `SyntaxError`. Nothing used to contend for a control store, so nothing hit it.
Handled in `controlAssembly.ts` (the panel boots without the plane and names the file it could not
read) rather than fixed in `store.ts`, per CLAUDE.md Rule 3. **It is a real defect in the store's
locking and it is still there.**

### 🔴 Two criteria are RED at the end of this task, for a real reason

`tests/control/webCcloopSmoke.test.ts` — "carries the ledger's claim identity byte-for-byte and is
durably accepted once" and "latches the stop under the ledger's identity" — fail with
`start-envelope-conflict:run:targetVersion`. Measured, three files:

| Where | Type of `targetVersion` |
|---|---|
| `src/control/webProtocol.ts` (the ledger / Web protocol) | `nonemptyString` — real rows hold `"v1"` |
| `src/control/schema.ts` (`startEnvelopeSchema`) | `safeInteger` |
| `src/control/types.ts` (`Identity`) | `number` |

`toStartEnvelope` sits exactly on that seam. The copy that used to live in the test did
`Number(run.targetVersion)`, which is `NaN` for `"v1"`, and `JSON.stringify` writes `NaN` as `null` —
so **the criterion that says it carries the ledger's identity byte-for-byte has been shipping `null`
in this field**, and its `expect(wire.stdin).toBe(JSON.stringify(start))` passed because both sides
were `null`. Task 4's parsing turned that into a refusal.

There is no meaning-preserving translation between a string and a safe integer, so refusing is the
correct behaviour and the criteria cannot pass until the disagreement is resolved. **Resolving it
means changing one of two closed schemas and the change reaches ccloop, so it is not this slice's to
take.** Left red and named here rather than skipped, coerced, or hidden.

## Task 7 — signals, and one shutdown identity per epoch

`ControlRuntime.shutdown()` closes the gate through `applyPanelShutdown`, stops the pump timer first,
and latches so a second call is observably a no-op rather than a second ledger identity discovered as
a conflict. `src/panel/server.ts` registers `SIGINT`/`SIGTERM` on the convention `src/chain/run.ts`
already uses, and a second signal exits without draining after saying the next start may be recovery
blocked. Criteria: `tests/panel/controlShutdown.test.ts` (6 tests), including a **real signal to a
real child process**, which is the only thing that judges the handler itself.

"Exactly one" is judged by counting rows in `commands` for `shutdownCommandId(epoch)`, not by the
return value and not by the log: an implementation that only reordered its logging would pass those
and fail this. The racing case and the sequential case are separate judgements, because a latch that
guards only concurrent calls passes one and fails the other.

**Mutation battery, 5, all red** (`commands/t7-mutation-battery.json`): the latch removed (RC1, 2
failed); the latch reduced to concurrency-only (1); shutdown no longer stopping the timer (2); the
`SIGTERM` handler never registered (1); the signal not shutting the plane down (1).

### ⚠️ The first run of this battery was worthless, and is recorded as such

Its clone baseline was **red** (`rc=1`), so every "mutation failed" line in it proved nothing — a red
baseline fails under every mutation. The cause: `web/dist` is gitignored, a clone therefore has none,
and the child-process criterion spawns the real CLI, which refuses by name without it. Two fixes, both
kept:

1. `commands/mutation-harness.py` now links `web/dist` and `web/node_modules` into every clone, and
   **every battery from here on records its baseline return code** — a battery that does not state a
   green baseline is not evidence.
2. The criterion now carries the child's stderr into its failure message. It previously said
   "exited 1 before ready", which names nothing; the diagnosis above took a round trip that a one-line
   message would have saved.
