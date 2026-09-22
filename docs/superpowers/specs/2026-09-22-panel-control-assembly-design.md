# Panel Control Assembly Design

**Date:** 2026-09-22
**Status:** Draft for approval
**Scope:** Wiring the already-shipped Web recoverable control plane into the production `orca panel`
process. No control semantics change here; this document only decides what a real process must
construct, with what defaults, and what it must refuse.

## 0. Why this slice exists

`2026-09-19-web-recoverable-control` delivered the control plane and proved it on a Panel booted by a
test fixture. The production Panel never builds it:

- `src/panel/server.ts:129` calls `buildApi(app, { opts, token, reviews, statics })` — the optional
  `control` key (`src/panel/api.ts:25-31`) is never supplied, so `orca panel` serves zero
  `/api/control` routes;
- `openControlStore` (`src/control/store.ts:45`) has **0 callers in `src/`** — no production process
  ever opens a control store.

Measured 2026-09-22 by cross-file reference scan of `src/` (log: `/tmp/seam-census-0922.txt`).
Seams with **0 production callers**: `createTrustedControlConfig`, `runControlPanelStartup`,
`applyPanelShutdown`, `createWebWakeHandlers`, `beginHandoffAttempt`, `settleHandoffRequest`,
`deliverHandoffStop`, `acceptContextObservation`, `openControlStore`. Seams already called from
production code: `applyHandoffStop` (`webService.ts:367`), `scheduleStart` (`webService.ts:358`),
`deliverSchedulerWakes` (`recovery.ts:53`), `startClaim` (`service.ts:128,129,173`).

So the outstanding question was never "more tests" but "what may a shipped binary default to". The
answers below are human rulings, recorded in §1.

## 1. Rulings taken (human, 2026-09-22)

| # | Ruling |
|---|---|
| R1 | The control plane mounts **by default** on `orca panel`; `--no-control` turns it off. |
| R2 | Control state defaults to **`~/.orca/control/<repoKey>`**. |
| R3 | The ccloop execution port requires **`ORCA_CCLOOP_BIN` + adapter config**; there is no fallback to the legacy scheduler runner. |
| R4 | The **Panel process owns** recovery before `listen` and an in-process periodic wake pump. |

## 2. Non-goals

- No new control semantics, no new protocol fields, no change to any closed schema.
- No live model call is authorized by this slice. Nothing here may cause a provider invocation
  during boot, recovery, or the wake pump.
- No real user data. Every criterion relocates every path it touches (CLAUDE.md Rule 17).
- Not wired here, and named so in §8: automatic context handoff (`acceptContextObservation`), because
  Orca has no producer for the observation it consumes.

## 3. Mount policy (R1)

`parsePanelArgs` (`src/panel/server.ts:54`) gains `--no-control` (`args.includes(...)`, the
`--i-know-this-is-exposed` convention at `:94`). Absent ⇒ mount the full plane: reads and mutations.
Present ⇒ pass no `control` dep, which is byte-for-byte today's behaviour
(`src/panel/controlApi.ts:74` mounts mutations only when `service` is present).

R1 + R3 collide in one place, and the resolution is a design decision rather than a ruling, so it is
stated here for approval: **a Panel with no configured execution port boots, mounts the plane, serves
reads, and refuses port-dependent commands.** Reasons:

- making boot hard-fail would turn every existing Panel criterion into a fixture that must set two
  environment variables, and would hide the recovery state a restarted Panel is exactly there to show;
- the read plane is the crash-visible surface (`recoveryView`, evidence manifests). Refusing it when a
  run died mid-flight is backwards.

The refusal is a closed, named error, not a hang and not a fallback:
`control-port-unconfigured`, raised by an unconfigured port whose
`probeProfileCapabilities`/`capabilities`/`accept` all throw it, so the existing path
(`profiles.ts:150` → `startClaim`) fails closed at the same point a real probe failure does. The
alternative — refuse to boot at all — is rejected but recorded: if a human prefers it, this is the
line to change, and it changes §7's boot criteria.

Open, not decided here: the Panel cannot currently *display* "no port configured" — `ControlConfigV1`
is a closed schema and adding a field is a protocol change. Until someone rules that, the state is
visible as one stderr line at boot plus the named error on the first command.

## 4. State directory and filesystem (R2, Rule 17)

Default `~/.orca/control/<repoKey>`, where `<repoKey>` is the single `--repo key=path` project key
(`src/panel/server.ts:71-82`).

- The root relocates through **`ORCA_CONTROL_DIR`**, read at parse time from the `env` parameter of
  `parsePanelArgs` — the `ORCA_CORRECTIONS_DIR` convention
  (`src/corrections/paths.ts:13-17`, `env` as a parse argument, empty string treated as unset).
  `~` is not expanded by the code and must not be: paths are used as given.
- More than one `--repo` has no `<repoKey>` to name, so the default is undefined: the panel rejects
  with `control-state-dir-required` unless `--control-state-dir <path>` names one. One store per
  Panel process stays true (`buildApi` takes a single `control` dep), even though
  `TrustedControlConfigInput.repositories` is a list.
- Modes: `openControlStore` already passes `0o700` for directories (`src/control/paths.ts:11`) and
  `0o600` for `control.sqlite` and `service-lock/owner.json` (`src/control/store.ts:76,91`), and
  `umask` can only remove bits from those requests — so nothing new is needed, and an existing
  directory's mode is left alone. This slice adds no file outside that store.
- `archiveRoot` / `exportRoot` / `evidenceRoot` (`src/panel/controlConfig.ts:24-37`) default to
  `<stateDir>/archive`, `<stateDir>/export`, `<stateDir>/evidence`; all three are under the relocated
  root, so a criterion can point them at a temp dir with the one variable.
- `executablePath` is `process.execPath`; `adapterConfigPath` is `ORCA_CCLOOP_ADAPTER_CONFIG`;
  `epoch` is the Panel's existing per-process token epoch.

## 5. Execution port (R3)

`ORCA_CCLOOP_BIN` (the binary) and `ORCA_CCLOOP_ADAPTER_CONFIG` both must be set, and the value must
satisfy the same checks the tests already apply. Nothing in `src/` reads either name today (measured:
only `tests/scheduler/sandbox.ts:95`, `tests/control/webCcloopSmoke.test.ts:32`,
`tests/control/ccloopProtocol.integration.test.ts:19-20`), so this slice introduces the production
read. Missing either one selects the unconfigured port of §3 — it does not fall back to
`TaskScheduler`/`legacyExecutionPort` (`src/control/service.ts:129`), which has no ledger authority
and no handoff protocol.

Two pieces of the port are not there yet and must be built, not wired:

1. `createCcloopExecutionPort` (`src/control/ccloopPort.ts:32`) returns a literal with
   `capabilities/accept/inspect/requestHandoff/collect/readEvidence` only, while
   `ExecutionPort.probeProfileCapabilities` is optional (`src/control/executionPort.ts:15`) and the
   router needs it (`profiles.ts:67-69,150`). Exposing it on the ccloop port is a prerequisite for any
   Web claim: without it every Web dispatch is `control-capability-probe-failed`.
2. The ledger stores `DispatchEnvelopeV1` (`src/control/webProtocol.ts:304`, schema literal
   `orca-dispatch-envelope-v1`), and the port accepts `StartEnvelope`
   (`src/control/executionPort.ts:7`). The only translation between them in the repository is
   `tests/control/webCcloopSmoke.test.ts:88-101`. It must move into `src/` as a named module; a test
   fixture is not allowed to be the production consumer of the ledger.

## 6. Process ownership (R4)

**Recovery before listen.** `runControlPanelStartup({ recover, listen })`
(`src/panel/controlLifecycle.ts:181-184`) is already exactly this ordering primitive; `recover` is
`recoverControl(store, port, wakes)` (`src/control/recovery.ts:14`), and `listen` is
`src/panel/server.ts:134-136`. No connection may be accepted before recovery resolves, so a restart
cannot dispatch against a store whose run state it has not yet reconciled.

**Wake pump.** `createWebWakeHandlers(deps)` (`src/control/webDispatch.ts:428`) plus
`deliverSchedulerWakes` (`src/control/dispatch.ts:99`) is the pair with no production holder. Owned by
the Panel process:

- fires once immediately after recovery, on every accepted command that can arm a wake, and on a
  timer (`--control-wake-ms`, default `5000`, validated as a positive safe integer the way `--port` is
  at `:84-88`);
- one pump at a time: a re-entrant call while one is in flight is a no-op, because the delivery
  already drains the table and a second concurrent pass would race the single-writer gate;
- every pass goes through the admission gate (`withAdmission`, `:81`), so the pump cannot slip a write
  past a draining shutdown.

**Shutdown.** No `SIGINT`/`SIGTERM` handler exists in `src/panel/` or `src/cli.ts` today (measured);
the panel parks at `src/cli.ts:361`. Copy the in-repo convention from `src/chain/run.ts:106-107`
(`process.on("SIGINT"|"SIGTERM", onSignal)`), and on signal: close the admission gate, run
`applyPanelShutdown` once (`controlLifecycle.ts:150`, one `shutdown-<sha256(epoch)>` ledger identity
per epoch — see the spec §11.2 erratum), stop the timer, then close the server. A second signal exits
without waiting, and the terminal must warn that the next start may be recovery-blocked, which is
what spec §6.4 already requires of shutdown.

**Estimator defaults.** `TrustedControlConfigInput` needs `defaultEstimatorProfileId` and
`defaultEstimateMode`; both must come from an operator-visible choice, not from a silent default in
code. V1: `--estimator-profile` and `--estimate-mode strict|soft`, both required when control is
mounted, because a guessed estimate mode is exactly the "treats a soft adapter as strict" failure.
Codex stays `phase-end + soft` and nothing here may advertise it as strict.

## 7. Acceptance

Each line is a command with a 0/non-zero answer, written RED first, and none of them may touch a real
`~/.orca` — the root is always `ORCA_CONTROL_DIR` into a temp dir.

1. `orca panel` with no `ORCA_CCLOOP_BIN`: process boots; `GET /api/control/config` answers 200 with
   the token; a start command answers the closed error `control-port-unconfigured`; and a criterion
   that asserts the boot *failed* must itself be red.
2. `--no-control`: `GET /api/control/config` is 404 and no store file is created under
   `ORCA_CONTROL_DIR`.
3. Default path: with exactly one `--repo k=…`, the store appears at `$ORCA_CONTROL_DIR/k/control.sqlite`
   with mode bits a subset of `0600`, its directory a subset of `0700`; with two `--repo` flags and no
   `--control-state-dir`, boot rejects with `control-state-dir-required`.
4. Recovery ordering: a store seeded with an open run blocks dispatch until `recover` resolves; the
   listen promise is observed to resolve strictly after it.
5. Wake pump: a start wake armed with its HTTP response dropped is delivered by the timer with no
   further request, creating no second claim; a re-entrant pump pass delivers nothing twice.
6. Shutdown: `SIGTERM` produces exactly one shutdown command identity for the epoch, is replay-safe
   against a second signal, and an in-flight claim either committed before the gate or is refused —
   never admitted after it.
7. Envelope translation: the moved-in translator is the same function the smoke test now imports, so
   the fixture cannot drift from production; a stored envelope that the translator rejects is refused
   before any port call.
8. Regression boundary: `npm test`, `typecheck`, `verify:panel` and a fresh `verify:web-control`
   (the last needs a `/tmp` ccloop artifact; if it is absent, say so rather than quoting an old run).

## 8. Explicitly not wired

`acceptContextObservation` (`src/control/contextControl.ts:44`) takes `policy: ContextPolicy`
(`{ handoffAtContextTokens }`, `:7`) and `profile: FrozenProfile` from its **caller**, and the
production source of the policy exists — the confirmed proposal carries `contextPolicy`
(`src/control/webService.ts:128`, `src/control/executionSnapshot.ts:37`). The missing half is the
observation itself: `ContextObservationV1` (`src/control/webProtocol.ts:302`) has no producer
anywhere in `src/` — nothing in the port's `collect` events yields one. So automatic context handoff
needs a ccloop-side emit first, and this slice must not invent a substitute source. It is recorded
here and in the ccloop handoff, and remains unbuilt.

---

## 9. Second round of rulings (human, 2026-09-22, session `2adcc8bb`)

**§0–§8 above are unchanged.** This section records two rulings taken after that text was published,
and one design consequence discovered while sizing them. Where §3 and this section disagree about
scope, this section is later and wins; where they agree, §3's text stands.

### 9.1 R5 — §3's resolution is approved as written

The R1×R3 collision is resolved the way §3 proposed: **a Panel with no configured execution port
boots, mounts the plane, serves reads, and refuses port-dependent commands by the closed name
`control-port-unconfigured`.** The rejected alternative (hard-fail at boot) stays rejected, and §3's
reasons stand as the reasons. Nothing in §3 changes; this is the approval it was waiting for.

### 9.2 R6 — the display question is closed, in this slice, by a protocol field

§3 left open that a Panel "cannot currently *display* 'no port configured'" and parked it for a human.
The ruling is to **add the field now**, in this slice:

```
ControlConfigV1 += executionPort: "configured" | "unconfigured"     // required, closed enum
```

This overrides the plan's global constraint "No closed protocol schema changes" for this one field.
The plan's correction section records that; it is not a licence for any other schema change.

**Blast radius, measured 2026-09-22 (not estimated).** A cross-file scan of `src/`, `tests/`,
`web/src/` and `web/tests/` for `ControlConfigV1|controlConfigSchema` gives exactly four kinds of site:

- `src/control/webProtocol.ts:723` — the zod schema, and `:1168` its inferred type;
- `web/src/controlTypes.ts:21` — the hand-written mirror. `tests/panel/webParity.test.ts:114-115`
  asserts both directions of assignability, so omitting either side fails typecheck rather than
  drifting silently. That parity test is the reason this field cannot be half-added;
- `src/panel/controlConfig.ts:178` — the single production construction of the view;
- four web fixtures (`web/tests/controlPanel.test.tsx:14`, `controlCommandRecovery.test.tsx:31`,
  `evidenceLink.test.tsx:29`, and `tests/panel/` parse sites). Adding a required field makes these
  fixtures fail to typecheck until the field is supplied. **Supplying a field to a fixture object is
  not editing an assertion**, and the "do not edit existing test assertions" constraint is untouched.

**This is not a cross-repo change.** A scan of the whole ccloop repository (excluding `node_modules`
and `.git`) for `ControlConfig` returns one file, `reference/oh-my-openagent/.../command-config-handler.test.ts`,
which is vendored third-party material unrelated to this protocol. `ControlConfigV1` is the Orca
Panel ↔ Orca Web contract; the Orca ↔ ccloop contract is the execution port
(`capabilities/accept/inspect/handoff/collect/read-evidence`), and **no ccloop consumer needs
checking for this field**. An earlier sizing of R6 said the opposite; that was wrong, and the measured
answer is this paragraph.

### 9.3 Why a top-level field and not `profiles[].probeFailureCode`

`controlConfigSchema` already carries `profiles[].probeFailureCode: string | null`, and
`ExecutionProfileRouter.probe` (`src/control/profiles.ts:147-165`) catches any throw and records a
code there. So once §3's unconfigured port is mounted, every profile would carry a probe failure code
and a reader could infer "no port" from it. **That inference is refused**, because the two facts are
different sizes: `probeFailureCode` is *per profile, this probe, this moment*; "no execution port is
configured" is *per process, for the life of the epoch*. Letting one stand in for the other is exactly
the blended-pattern failure CLAUDE.md Rule 7 forbids.

Therefore: the new field is the **only** authority on whether a port is configured, and
`probeFailureCode` keeps its present meaning **unchanged** — no code reads it to answer the port
question, and this slice alters neither its type nor its population.

### 9.4 Consequence found while sizing: `adapterConfigPath` cannot stay unconditionally required

`TrustedControlConfigInput.adapterConfigPath` is `z.string().min(1)` (`src/panel/controlConfig.ts:48`),
and §4 sources it from `ORCA_CCLOOP_ADAPTER_CONFIG`. Under R5 that variable may legitimately be
absent, so a Panel that is *allowed* to boot could not build its trusted config. This is an
implementation decision, reversible, and taken here rather than silently in code (CLAUDE.md Rule 1,
rung 2):

> `adapterConfigPath` becomes `string | null`, and the input schema gains a cross-field refinement:
> `executionPort === "configured"` **requires** a non-null `adapterConfigPath`, and
> `executionPort === "unconfigured"` **requires** it to be null.

This is strictly tighter than today's shape, not looser: the two fields can no longer disagree, and a
configured port with no adapter config — representable today — becomes unrepresentable. The field pair
is the invariant, not either field alone.

### 9.5 What §7's acceptance gains

§7's list is unchanged and still binding. Three lines are added to it:

9. `GET /api/control/config` answers `executionPort: "unconfigured"` when neither
   `ORCA_CCLOOP_BIN` nor `ORCA_CCLOOP_ADAPTER_CONFIG` is set, and `"configured"` when both are; the
   criterion asserts the served JSON, not the input object it was built from.
10. A `TrustedControlConfigInput` with `executionPort: "configured"` and a null `adapterConfigPath`
    is refused by the schema, and so is the converse — asserted as two separate refusals, because one
    refusal passing does not show the other exists.
11. The Web panel renders the unconfigured state visibly, and a criterion that reads
    `probeFailureCode` instead of the new field must be red, so the §9.3 separation is observed rather
    than merely written down.
