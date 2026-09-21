# Panel Control Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use subagent-driven-development (recommended) or
> executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make a shipped `orca panel` process own the Web recoverable control plane — store, trusted
config, execution port, routes, recovery, wake pump, shutdown — under the defaults ruled in the spec,
and refuse port-dependent commands by name when no ccloop binary is configured.

**Architecture:** Everything above `src/panel/server.ts` stays as it is. A new assembly module turns
parsed options into the four objects the control plane needs (`ControlStore`,
`TrustedControlConfig`, `ExecutionProfileRouter`, `WebControlService`) and owns the process lifecycle;
`server.ts` keeps only "build, start, park". No control semantics move.

**Tech Stack:** TypeScript, Node.js 22 `node:sqlite`, Express 5, Zod 3, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-22-panel-control-assembly-design.md`

## Global Constraints

- CLAUDE.md Rule 17 is a hard gate: every criterion relocates the control root through
  `ORCA_CONTROL_DIR` into a temp dir. Nothing in this plan may create or read `~/.orca` for a real
  user, and no test may assert against it.
- No live model call. A task is not done because a real provider answered; the deterministic local
  port is the acceptance surface, and `verify:web-control:consumer` remains the only real-ccloop gate.
- Codex stays `phase-end + soft`; no step may present a soft adapter as strict, and the estimate mode
  is an operator argument, never an in-code default.
- No closed protocol schema changes. `control-port-unconfigured` is a new **error code**, registered in
  `src/control/errors.ts` the way existing codes are; adding a field to `ControlConfigV1` is out of
  scope (spec §3 leaves the display question to a human).
- Existing Panel criteria must stay green without setting `ORCA_CCLOOP_BIN`: mounting by default may
  not make today's green boots fail (spec §3's resolution of R1×R3).
- Do not edit any existing test assertion. New judgements are new `it()` blocks. Changing a criterion
  needs a human naming that test.
- Follow RED → verify RED → GREEN → verify focused GREEN → task suite. Verification and commit commands
  carry `PATH="/usr/local/bin:$PATH"` (the global homebrew node is broken); never `--no-verify`;
  unfiltered logs to a file, read back whole.
- 开门／合并／删分支或 worktree／push each need their own human authorization. This plan authorizes none
  of them.

## Review Focus

- Task 2 and Task 5 share one invariant: no path may reach `startClaim` without a port that either
  probes or throws the named refusal. A silent fallback to `legacyExecutionPort`
  (`src/control/service.ts:129`) is the failure this plan exists to prevent.
- Task 6 owns ordering: a connection accepted before `recoverControl` resolves can dispatch against
  unreconciled state.
- Task 7 owns the single-writer drain: a wake pass that slips a write past the closed gate, or a second
  shutdown identity for one epoch, is the crash-visible bug.

---

### Task 1: Options and path resolution, no HTTP yet

**Files:**
- Modify: `src/panel/server.ts` (`parsePanelArgs`, `:54-100`)
- Modify: `src/cli.ts` (usage string at `:46`)
- Create: `src/panel/controlOptions.ts`
- Create: `tests/panel/controlOptions.test.ts`

**Interfaces:**
- Consumes: `PanelOptions`, the `env` parameter convention of `src/corrections/paths.ts:13-17`.
- Produces: `resolveControlOptions(args, env, repos): { enabled: boolean; stateDir: string | null;
  wakeIntervalMs: number; estimatorProfileId: string | null; estimateMode: "strict" | "soft" | null;
  rejection: string | null }` — the single place that decides whether control mounts and where its
  state lives.

- [ ] Step 1: RED — `--no-control` yields `enabled: false`; without it, exactly one `--repo k=path`
  yields `stateDir = join(controlRoot(env), "k")` where `controlRoot` reads `ORCA_CONTROL_DIR` and
  falls back to `join(homedir(), ".orca", "control")`; a criterion that asserts the real home path was
  used must be un-writable, because the test always sets the variable.
- [ ] Step 2: RED — two `--repo` flags and no `--control-state-dir` ⇒ `rejection:
  "control-state-dir-required"`; one `--repo` plus `--control-state-dir` ⇒ that path wins verbatim.
- [ ] Step 3: RED — `--control-wake-ms` rejects `0`, `-1`, `1.5`, `abc`, and `""`; accepts `5000` and
  the default when absent. `--estimator-profile` / `--estimate-mode` are required when `enabled` and
  `repos.length === 1`, and their rejection codes are named (`control-estimator-profile-required`,
  `control-estimate-mode-required`).
- [ ] Step 4: GREEN focused, then `PATH="/usr/local/bin:$PATH" node node_modules/.bin/vitest run
  tests/panel > /tmp/orca-assembly/t1.log 2>&1` read back whole.

### Task 2: The named refusal port

**Files:**
- Create: `src/control/unconfiguredPort.ts`
- Modify: `src/control/errors.ts`
- Create: `tests/control/unconfiguredPort.test.ts`

**Interfaces:**
- Consumes: `ExecutionPort` (`src/control/executionPort.ts:13-22`), `ControlError` codes
  (`src/control/errors.ts`).
- Produces: `createUnconfiguredControlPort(): ExecutionPort` — every method rejects with
  `ControlError("control-port-unconfigured")`, including the optional
  `probeProfileCapabilities`, so `src/control/profiles.ts:150` cannot turn the absence into a
  different code by accident.

- [ ] Step 1: RED — registering `control-port-unconfigured` in the error table is observable: the
  client-facing severity lookup answers `internal`, and an unregistered code is not accepted.
- [ ] Step 2: RED — through the real `ExecutionProfileRouter` + `scheduleStart` path, a claim attempt
  against the unconfigured port yields `control-port-unconfigured` and **no run row, no wake row, no
  provider-start marker**; assert the row counts directly, not the error text alone.
- [ ] Step 3: GREEN focused.

### Task 3: Expose the probe on the ccloop port

**Files:**
- Modify: `src/control/ccloopPort.ts` (`:32-56`)
- Modify: `tests/control/ccloopPort.test.ts` (add only)

**Interfaces:**
- Consumes: `probeProfileCapabilities?(): Promise<ProfileCapabilityProbe>` (`executionPort.ts:15`),
  the same subprocess call shape `capabilities()` already uses.
- Produces: `port.probeProfileCapabilities` present on the returned literal, so
  `profiles.ts:67-69` (`ownPort`) keeps it and a Web claim can pass `:150`.

- [ ] Step 1: RED — a test that reads `typeof port.probeProfileCapabilities` is not enough (it can go
  green without the method being reachable through the router). Instead drive
  `createExecutionProfileRouter([...]).probe(profile)` with a ccloop port and assert the probe answer
  arrives from the port rather than becoming `control-capability-probe-failed`.
- [ ] Step 2: GREEN focused; re-run `tests/control/profiles.test.ts` unchanged.

### Task 4: Move the envelope translator into `src/`

**Files:**
- Create: `src/control/startEnvelope.ts`
- Modify: `tests/control/webCcloopSmoke.test.ts` (`:88-101`, delete its local copy and import)
- Create: `tests/control/startEnvelope.test.ts`

**Interfaces:**
- Consumes: `DispatchEnvelopeV1` (`src/control/webProtocol.ts:304`, `:1144`), `Claim`
  (`src/control/types.ts:8-11`, `:38-40`), `StartEnvelope` (`src/control/executionPort.ts:7`), the run
  body's `sourceDir`/`contractHash`/`inputCheckpoint`.
- Produces: `toStartEnvelope(envelope: DispatchEnvelopeV1, run: StartEnvelopeSource, sourceDir:
  string, contract: unknown): StartEnvelope` — the production consumer of the ledger's envelope.

- [ ] Step 1: RED — golden translation of a stored work-phase envelope and a handoff-phase envelope
  (claim identity, `contractHash = envelope.derivedContractHash`, `protocol: 1`), asserted field by
  field against the values the ledger wrote, not by round-tripping through the same function.
- [ ] Step 2: RED — an envelope whose `phase`/slot combination its `.strict()` schema would reject is
  refused before any port object is touched (assert the port's call count is zero).
- [ ] Step 3: GREEN, then prove the fixture cannot drift: `grep -n "StartEnvelope" tests/control/webCcloopSmoke.test.ts`
  must show only the import and call sites, no local construction.

### Task 5: Build the runtime and mount it

**Files:**
- Create: `src/panel/controlAssembly.ts`
- Modify: `src/panel/server.ts` (`:104-136`)
- Create: `tests/panel/controlMount.test.ts`

**Interfaces:**
- Consumes: `openControlStore({stateDir,recovery})` (`src/control/store.ts:45`),
  `createTrustedControlConfig(input, router)` (`src/panel/controlConfig.ts:119`),
  `createExecutionProfileRouter` (`src/control/profiles.ts:119`), `WebControlService`
  (`src/control/webService.ts:163`), `buildApi`'s optional `control` dep (`src/panel/api.ts:25-31`),
  `ControlReadApiDeps` (`src/panel/controlApi.ts:17-22`).
- Produces: `assembleControlRuntime(options, deps): Promise<{ store, config, service, close }>` —
  called only when Task 1's `resolveControlOptions` returned `enabled: true` and `rejection: null`;
  disabled mounting never reaches this function (`server.ts` passes no `control` dep), and a
  rejection surfaces as the parse-time `PanelRejection` Task 1 already defines. The
  `workItemId`/`planId` allow-list entries fed to `repositories`/`plans` come from the `--repo` pairs
  and a new `--plan <planId>=<repoId>=<path>` flag, never from a browser request.

- [ ] Step 1: RED — with control enabled and no `ORCA_CCLOOP_BIN`, a booted in-process Panel answers
  `GET /api/control/config` 200 with the token header, and `POST` start answers
  `control-port-unconfigured`; the same Panel answers 404 for `/api/control/config` under
  `--no-control` and creates no file under `ORCA_CONTROL_DIR`.
- [ ] Step 2: RED — the store files exist with mode bits a subset of `0700`/`0600`, asserted by
  `statSync` on the real paths the assembly chose (a `0o777` umask must not be able to make this green
  by accident: assert the requested mode is what `mkdirSync`/`openSync` was given, and that `umask`
  can only strip).
- [ ] Step 3: RED — an existing directory with a loose mode is not chmod'd (spec §4): pre-create
  `stateDir` at `0o755`, boot, assert the mode is still `0o755`.
- [ ] Step 4: GREEN focused, then the whole `tests/panel/` suite and `npm --workspace web run check`
  to prove existing Panel/Web criteria needed no new environment.

### Task 6: Recovery before listen, and the wake pump

**Files:**
- Modify: `src/panel/server.ts`, `src/panel/controlAssembly.ts`
- Create: `tests/panel/controlStartup.test.ts`

**Interfaces:**
- Consumes: `runControlPanelStartup({recover,listen})` (`src/panel/controlLifecycle.ts:181-184`),
  `recoverControl(store, port, wakes?)` (`src/control/recovery.ts:14`),
  `createWebWakeHandlers(deps)` (`src/control/webDispatch.ts:428`), `deliverSchedulerWakes`
  (`src/control/dispatch.ts:99`), `withAdmission` (`controlLifecycle.ts:81`).
- Produces: a pump with one in-flight pass at a time, `recover` completing before `listen`, and the
  timer owned by the process rather than by an HTTP request.

- [ ] Step 1: RED — ordering is observed, not assumed: record timestamps/order in a fake store whose
  `recover` resolves after an await, and assert the `listen` callback ran strictly after it; a
  criterion that only asserts "recover was called" would also pass when listen came first, so it is
  not the criterion.
- [ ] Step 2: RED — a start wake armed with its response dropped is delivered by the timer with **no
  further request**, and the second pump pass that races the first delivers nothing a second time
  (assert `scheduler_wakes.delivered` rows and the run count, not the log).
- [ ] Step 3: GREEN focused, then `tests/control/webDispatch.test.ts` and `tests/control/recovery.test.ts`
  unchanged.

### Task 7: Signals and one shutdown per epoch

**Files:**
- Modify: `src/panel/controlAssembly.ts`, `src/cli.ts` (`:347-361`)
- Create: `tests/panel/controlShutdown.test.ts`

**Interfaces:**
- Consumes: `applyPanelShutdown(deps)` (`src/panel/controlLifecycle.ts:150`),
  `shutdownCommandId(epoch)` (`:76-78`), the `AdmissionGate`, and the handler convention of
  `src/chain/run.ts:106-107`.
- Produces: SIGINT/SIGTERM → close gate → one shutdown command → stop timer → `server.close()`; and
  `src/cli.ts` parking on a promise the handler resolves.

- [ ] Step 1: RED — in a child process (real signal, not a call), one SIGTERM writes exactly one
  ledger row for `shutdownCommandId(epoch)` and the process exits 0; a second immediate SIGTERM must
  not produce a second identity.
- [ ] Step 2: RED — a claim admitted before the gate closed commits; a claim attempted after it is
  refused and creates no run row (assert both sides by row counts — this is the shape that survives an
  implementation that only reorders the log).
- [ ] Step 3: GREEN focused.

### Task 8: Whole-slice verification and record

- [ ] `PATH="/usr/local/bin:$PATH" npm test > /tmp/orca-assembly/full.log 2>&1` — read the tail whole; the
  expected shape is the pre-plan counts plus the new files, and any `skipped` line must be explained
  by a missing `/tmp` ccloop artifact, named in the report.
- [ ] `typecheck`, `build --workspace web`, `verify:panel`; `verify:web-control` and
  `:consumer` only with a present artifact, otherwise state "not run".
- [ ] Real boot smoke: launch `orca panel` against a temp `ORCA_CONTROL_DIR`, read
  `/api/control/config` with the token, and confirm a start command answers
  `control-port-unconfigured` — this is the first time the shipped binary, not a fixture, serves the
  plane.
- [ ] Append the round's ledger under `.superpowers/sdd/2026-09-22-panel-control-assembly/`
  (`progress.md`, `commands/`, `test-logs/`, unfiltered logs; `git add -f`), and add
  `§9.4:1467`'s re-reading to `docs/superpowers/specs/2026-09-19-web-recoverable-control-design.md`
  §11 only as an appended correction, never by editing §1–§10.
- [ ] Update spec §11.5's seam list with what this plan wired and what still has 0 callers
  (`acceptContextObservation` stays 0, with spec §8's reason).
