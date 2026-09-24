# Orca Web Recoverable Control Design

**Date:** 2026-09-19  
**Status:** Draft for approval  
**Scope:** The first Web surface over the already implemented Orca control foundation and the verified ccloop control/handoff protocol

## AI-agent execution summary

- Do not redo the completed control foundation, Codex tasks, common protocol, handoff, durable dispatch/delivery/deduplication (D3) work, or six SIGKILL boundary validations.
- Implement only this Web recoverable-control slice. Automatic decomposition, ccmem correction, and group-goal acceptance remain later increments.
- Treat the confirmed immutable execution snapshot—not the mutable imported source—as execution authority.
- Keep command CAS separate from UI projection invalidation, and commit handoff-stop intent plus all request/outbox identities atomically.
- Keep context occupancy, cumulative token use, active time, and wall-clock deadlines as separate quantities.
- Keep Codex labeled `phase-end + soft`; never present it as strict.
- Preserve all development trees and evidence. Do not merge, push, clean, or run a live model chain without the explicit human gate in Section 9.6.

## 1. Context and decision

The control foundation, Codex adapter work, common control protocol, handoff, D3, and their existing validation are complete. This design does not reopen or replace them. It adds the first operator-facing Web workflow on top of those capabilities.

The first Web release imports an existing scheduler plan, shows the task graph, creates a budget draft, obtains an accounted model estimate, lets a human edit and confirm the result, starts the group, and supports pause, handoff-stop, and continuation. It does not provide a full in-browser contract editor, automatic decomposition, ccmem correction, or group-goal acceptance; those remain later increments.

The implementation remains on the Orca development branch. It must not merge, push, delete worktrees, or clean retained evidence as part of this increment.

### 1.1 Intended readers and reading guide

This document is for the Orca/ccloop implementer and the operator who will approve the resulting control surface. Sections 3 and 4 define authority, persistence, and concurrency. Section 5 defines budget estimation and the immutable execution snapshot. Sections 6 and 7 define recoverable stop and restart behavior. Section 9 is the acceptance contract. Later implementation plans must cite these sections instead of weakening their invariants.

The design relies on these terms:

- **command revision:** the compare-and-swap version used only to serialize authority-changing commands;
- **projection sequence:** a monotonically increasing invalidation number for UI-visible state, including observations that do not change authority;
- **D3:** the already completed durable dispatch, delivery, and deduplication work recorded in the retained ccloop-control-handoff evidence tree;
- **execution snapshot:** the immutable normalized plan and derived task contracts that a confirmed group actually executes;
- **profile:** a trusted server-side mapping from a stable ID and work kind to an adapter, model policy, capability declaration, and execution configuration.

### 1.2 Comparative research

Local source inspection found the following relevant patterns:

- OpenClaw keeps dispatch in its long-running Gateway. Workboard change events carry an epoch and revision, and the browser rereads canonical state instead of projecting lifecycle changes locally. Its CLI fallback is data-only and cannot silently launch workers when the Gateway is unavailable.
- Hermes-Agent embeds its kanban dispatcher in the Gateway by default, with a machine-level singleton lock. Its dashboard receives database events and refetches the board. Hermes also offers a rough, explicitly model-backed token/complexity estimate, but that estimate is advisory and is not integrated with a shared group budget.

Representative inspected sources:

- OpenClaw `docs/plugins/workboard.md`, `extensions/workboard/src/dispatcher.ts`, `ui/src/lib/workboard/live-refresh.ts`, and `ui/src/app/gateway-store.ts`.
- Hermes-Agent `gateway/kanban_watchers.py`, `plugins/kanban/dashboard/plugin_api.py`, `apps/desktop/src/plugins/kanban/board.tsx`, `apps/desktop/src/plugins/kanban/drawer.tsx`, and `apps/desktop/src/plugins/kanban/api.ts`.

The comparison and current-code statements are pinned to these source baselines:

| Tree | Commit |
|---|---|
| Orca development tree | `38e86117851afe98afd0044a18b509025ac0586a` |
| ccloop development tree | `1760f74c5ec44276c1159eda8479cb967b29f46d` |
| OpenClaw | `6b27585471a7c0133fbdb7b43830f0366e0e417b` |
| Hermes-Agent | `b1ff8722a53ee223485ac9804945acf07ef5c601` |

The resulting Orca decision is to host `ControlService` in the Panel process for V1, keep the browser thin, and treat change notifications only as invalidations of canonical server state. A separate daemon remains a later deployment option, not a V1 prerequisite.

### 1.3 Accuracy boundary

- **Verified in source:** the current single-`ExecutionPort` Orca service, contract-loading scheduler bridge, ccloop consumer behavior, adapter capabilities, and the comparative OpenClaw/Hermes patterns above.
- **Retained executed evidence:** the control/handoff/D3 test and SIGKILL evidence named in Section 9.5.
- **Proposed here, not yet implemented:** the Web API, execution-profile router, immutable execution snapshots, projection sequences, estimator preflight, and atomic handoff-stop intent/outbox transaction.
- **Not claimed by this design document:** new runtime, browser, or live-model verification. Those belong to implementation acceptance.

## 2. Goals and non-goals

### 2.1 Goals

1. Import an allowlisted scheduler plan into one atomic control-group draft.
2. Show the normalized graph, contracts, budgets, runs, checkpoints, and recovery state from the canonical control store.
3. Provide an immediate, editable `complex-1m` budget draft.
4. Run model-based budget estimation through the same group-accounted ccloop execution path.
5. Require atomic human confirmation before ordinary task dispatch.
6. Preserve `commandId`, revision, ownership, budget, and evidence invariants across Web retries and process restarts.
7. Support pause-dispatch, default handoff-stop, and verified continuation.
8. Fail closed on recovery uncertainty, unknown usage, stale revisions, and unsupported strict enforcement.

### 2.2 Non-goals

- Full task-contract authoring in the browser.
- Automatic task decomposition.
- ccmem correction or group-goal acceptance.
- Multi-host control or shared remote SQLite.
- A standalone control daemon.
- Browser-supplied executable paths, repository paths, adapter configuration, or evidence roots.
- A user-facing immediate-kill control.
- Claiming that model estimates are hard provider-cost or token-enforcement bounds.
- Repeating the already completed six SIGKILL boundary validations unless this increment changes those boundaries.

## 3. Runtime topology and trust boundary

The V1 topology is:

```text
Browser
  -> Orca Panel HTTP API
    -> ControlService
      -> ControlStore / SQLite
      -> ExecutionProfileRouter
        -> trusted ccloop ExecutionPorts
```

`orca panel` is the sole control writer for its configured `stateDir`. Startup proceeds in this order:

1. Parse and validate trusted startup configuration.
2. Apply the existing bind and exposure guards.
3. Acquire the ControlStore single-writer lock, using the existing recovery rules.
4. Run control recovery before accepting HTTP traffic.
5. Construct the shared application service and API.
6. Begin listening.

If recovery leaves unresolved runs, the Panel may listen so the operator can inspect evidence and retry recovery, but `dispatchBlocked` remains true and no new work may be dispatched.

A second Panel targeting the same `stateDir` fails with `control-writer-active`. It does not start a second writer, auto-take over a live writer, or fall back to per-click CLI execution.

Closing or refreshing the browser has no effect on accepted executions. The browser is not a lifecycle owner.

### 3.1 Trusted startup configuration

The following values are fixed and validated at Panel startup:

- `stateDir`;
- ccloop executable or execution binding;
- adapter type and adapter configuration;
- allowlisted repositories, exposed to the browser as stable `repoId` values;
- allowlisted plans or plan roots, exposed as stable `planId` values;
- allowlisted model/estimator profiles;
- archive, export, and evidence roots;
- shutdown grace.

The browser may send stable IDs, group commands, and editable numeric policy values. It may not send an arbitrary executable, adapter definition, filesystem root, repository path, plan path, or evidence path.

V1 closes `WorkKind` to `"budget-estimate" | "task" | "handoff" | "goal-review"`. Each allowlisted execution profile declares:

```ts
type ExecutionProfile = {
  profileId: string;
  allowedWorkKinds: WorkKind[];
  adapter: "codex" | string;
  adapterConfigRef: string;
  modelPolicyRef: string;
  contextTokenizer?: { tokenizerId: string; tokenizerVersion: string };
  workMaxOutputTokens?: number;
  capabilities: {
    usageObservation: "realtime" | "phase-end" | "unavailable";
    budgetEnforcement: "bounded" | "soft" | "unavailable";
    contextObservation: "realtime" | "phase-end" | "unavailable";
    handoffControl: "durable" | "phase-end" | "unavailable";
    handoffExecution: "mechanical-in-run-v1" | "model-assisted-v1";
    contextWindowTokens?: number;
    requestBoundProof: null | {
      scheme: "adapter-request-bound-v1";
      version: string;
      workDimensions: ("tokens" | "activeMs" | "attempts" | "sessions")[];
      handoffDimensions: ("tokens" | "activeMs" | "attempts" | "sessions")[];
      evidenceKind: string;
    };
  };
  estimatorPreflight?: {
    instructionVersion: string;
    schemaVersion: "budget-estimate-v1";
    maxOutputTokens: number;
    framingTokenOverhead: number;
    tokenizer:
      | { kind: "exact"; tokenizerId: string; tokenizerVersion: string }
      | { kind: "utf8-upper-bound"; numerator: number; denominator: number; proofRef: string };
  };
};
```

`ControlService` uses a trusted `ExecutionProfileRouter`, keyed by work kind and an allowlisted profile ID, rather than forwarding browser configuration to a single generic port. Estimation, task work, handoff, and goal review may resolve to distinct profiles. The browser can choose only among stable IDs returned by `config`; it cannot modify the profile mapping or its capability declaration.

`profileHash` is SHA-256 over canonical JSON for this closed preimage:

```ts
type ExecutionProfileSnapshotV1 = {
  schema: "orca-execution-profile-snapshot-v1";
  profile: {
    profileId: string;
    allowedWorkKinds: WorkKind[]; // lexicographically sorted, duplicate-free
    adapter: string;
    adapterConfigRef: string;
    modelPolicyRef: string;
    contextTokenizer: null | { tokenizerId: string; tokenizerVersion: string };
    workMaxOutputTokens: number | null;
    capabilities: {
      usageObservation: "realtime" | "phase-end" | "unavailable";
      budgetEnforcement: "bounded" | "soft" | "unavailable";
      contextObservation: "realtime" | "phase-end" | "unavailable";
      handoffControl: "durable" | "phase-end" | "unavailable";
      handoffExecution: "mechanical-in-run-v1" | "model-assisted-v1";
      contextWindowTokens: number | null;
      requestBoundProof: null | {
        scheme: "adapter-request-bound-v1";
        version: string;
        workDimensions: (keyof Amount)[]; // lexicographically sorted, duplicate-free
        handoffDimensions: (keyof Amount)[]; // lexicographically sorted, duplicate-free
        evidenceKind: string;
      };
    };
    estimatorPreflight: null | {
      instructionVersion: string;
      schemaVersion: "budget-estimate-v1";
      maxOutputTokens: number;
      framingTokenOverhead: number;
      tokenizer:
        | { kind: "exact"; tokenizerId: string; tokenizerVersion: string }
        | { kind: "utf8-upper-bound"; numerator: number; denominator: number; proofRef: string };
    };
  };
  resolved: {
    adapterConfigContentHash: string;
    modelPolicyContentHash: string;
    proofDocumentContentHashes: string[]; // lexicographically sorted, duplicate-free
    adapterImplementationHash: string;
    adapterProtocolVersion: string;
    tokenizerArtifactHashes: Array<{ purpose: "context" | "estimator"; contentHash: string }>;
    secretValueHashes: Array<{ name: string; valueHash: string }>; // sorted by name
  };
};
```

Every `*ContentHash`, implementation hash, tokenizer content hash, proof-document hash, and secret `valueHash` is lower-case hex SHA-256 of the exact final bytes returned by the trusted resolver. `tokenizerArtifactHashes` is sorted by `purpose`, has no duplicate purpose, and contains an entry exactly when that purpose uses an exact tokenizer artifact. `secretValueHashes` contains every secret leaf transitively reached from adapter configuration or model policy; `name` is its canonical JSON Pointer from that resolution root. References resolve transitively at startup; cycles or duplicate secret names are invalid. Optional fields are encoded as the explicit `null` shown above, set-like arrays are sorted as stated before canonical JSON, unknown fields and duplicates are rejected, and other array order is preserved. Secret bytes and this internal snapshot are never returned; `config` returns the safe literal fields and resulting `profileHash`. Observed capability values, probe timestamps, and probe failures are excluded because they are dynamic observations checked separately. Any execution-affecting byte or implementation change behind a stable reference therefore produces a new hash; a probe result change alone does not.

`contextTokenizer` is required when declared `contextObservation` is `realtime` or `phase-end`, and forbidden when it is `unavailable`. It identifies the exact tokenizer used for context occupancy; its artifact bytes are bound by the `context` entry in `resolved.tokenizerArtifactHashes`. `workMaxOutputTokens` is a positive safe-integer trusted ceiling for one task-work provider response and is required exactly when `allowedWorkKinds` contains `task`; otherwise the snapshot encodes `null`. It is part of the profile hash. Estimator preflight uses its separately declared exact tokenizer or proved UTF-8 upper bound and never borrows either field.

Declared capability is an upper bound. At startup and before each claim, the service probes the adapter and intersects the result with the declaration; an observation failure produces `unavailable`, never an optimistic fallback. `config` returns the declaration, observed value, observation timestamp, profile hash, and any typed probe failure. Confirmation checks only that the selected contract schema and profile declaration can represent the requested grants. Real capability is checked at start and again before claim. A strict claim is eligible only when `budgetEnforcement` is observed as `bounded`, durable accept evidence is available, and the union of request-bound proof plus ControlStore pre-claim enforcement covers all four dimensions for both work and the selected handoff execution path.

Intersection is component-wise minimum in these closed orders: `unavailable < phase-end < realtime` for usage/context observation, `unavailable < soft < bounded` for budget enforcement, and `unavailable < phase-end < durable` for handoff control. `handoffExecution` remains the declared mode only when the probe reports support for that exact mode, otherwise it is unavailable. A context window is known only when both sides report a positive safe integer, using their minimum. Request-bound proof survives only when scheme, version, evidence kind, and normalized dimension sets exactly match declaration; otherwise it is `null`. Unknown probe fields never improve capability.

The V1 strict-proof algorithm is mechanical. A deliberately selected soft profile has `requestBoundProof: null`, emits no proof artifact, and may invoke the provider only through the visibly soft path after the ordinary durable provider-start marker; it never satisfies or advertises strict enforcement.

Strict coverage is fixed by this matrix:

| Phase/dimension | Required enforcing boundary |
|---|---|
| estimate/work tokens | phase artifact must include `tokens`; request maximum is the exact input-plus-output bound for estimate and provider request token maximum for work |
| estimate/work activeMs | derived/estimate contract plus ControlStore monotonic active-time deadline and verified process-group recovery |
| estimate/work attempts | derived/estimate contract plus ControlStore provider-attempt counter |
| estimate/work sessions | ControlStore run/session claim counter |
| mechanical handoff tokens/attempts/sessions | statically zero; provider invocation forbidden |
| mechanical handoff activeMs | ControlStore monotonic handoff timer plus verified process-group recovery |
| model-assisted handoff tokens | handoff phase artifact must include `tokens` when the grant is nonzero |
| model-assisted handoff activeMs | ControlStore monotonic handoff timer plus verified process-group recovery |
| model-assisted handoff attempts/sessions | handoff-phase ControlStore counters described below |

An artifact may additionally bind `activeMs`, `attempts`, or `sessions`, but the union must include the fixed boundary in every matrix row. For artifact purposes, attempt/session request maxima mean the number of provider attempts/sessions the adapter promises not to exceed in that phase. A missing matrix boundary makes the profile ineligible for strict mode.

The algorithm is:

1. ControlStore reserves one session inside the existing commitment before dispatch and will not create another run or continuation after the confirmed session count is exhausted.
2. The execution contract maps work tokens, active time, and attempts as specified in Section 4.4; estimator execution uses the estimate contract defined below.
3. Before each strict provider invocation, the adapter emits one immutable phase-specific evidence artifact of `evidenceKind` containing the run identity, execution-contract hash, actual request maxima, proof scheme/version, and the dimensions it bounds.
4. `ControlService` verifies each artifact against that phase's selected profile and dispatch envelope. An incomplete profile declaration blocks a strict estimator as `estimate-blocked-capability` and blocks strict task start as `control-capability-unsupported`. If an initial estimate/work claim was accepted but its artifact acknowledgement is lost, the adapter must not call the provider; the response loss is projected as an unknown start outcome and recovered mechanically. A model-assisted handoff has its own handoff artifact and uses the existing `outcome-unknown` handoff recovery state if that later acknowledgement is lost.
5. `mechanical-in-run-v1` statically prohibits a provider call during handoff, so its effective token/attempt/session bound is zero even when reserve is available; active time and the absolute deadline remain independent bounds. `model-assisted-v1` requires `handoff.tokens > 0`, `handoff.activeMs > 0`, `handoff.attempts >= 1`, and `handoff.sessions >= 1`; confirmation rejects a selected model-assisted profile that lacks those amounts with `handoff-grant-insufficient`. The default zero attempt/session handoff allocation therefore supports only mechanical handoff until the human edits it. Strict model-assisted handoff additionally requires the matrix proof coverage.

The run-specific artifact has one closed schema:

```ts
type RequestBoundProofArtifactV1 = {
  schema: "orca-request-bound-proof-v1";
  phase: "estimate" | "work" | "handoff";
  runId: string;
  generation: number;
  providerAttemptOrdinal: number;
  startEnvelopeHash: string;
  derivedContractHash: string;
  profileId: string;
  profileHash: string;
  proofScheme: "adapter-request-bound-v1";
  proofVersion: string;
  requestLimits: {
    tokens: number | null;
    activeMs: number | null;
    attempts: number | null;
    sessions: number | null;
  };
  boundedDimensions: (keyof Amount)[];
  evidenceKind: string;
  providerStartForbiddenUntilVerified: true;
};
```

It is canonical-JSON encoded and SHA-256 hashed using Section 4. `startEnvelopeHash` binds the exact phase-relevant fields and profile slots in `DispatchEnvelopeV1` below. For task and continuation work, `derivedContractHash` is the confirmed task contract hash. For a budget estimate it is the hash of the closed `EstimateExecutionContractV1` record below; that record is persisted before claim. The work artifact binds only the worker profile; a later model-assisted handoff artifact binds only the separately selected handoff profile. `mechanical-in-run-v1` emits no handoff provider artifact because provider invocation is statically forbidden.

Those referenced hashes use these closed preimages; fields shown as nullable are always encoded and unknown fields are rejected:

```ts
type ProfileBindingV1 = { profileId: string; profileHash: string };
type DispatchEnvelopeV1 = {
  schema: "orca-dispatch-envelope-v1";
  phase: "estimate" | "work" | "handoff";
  groupId: string;
  workItemId: string;
  runId: string;
  generation: number;
  claimIdentity: string;
  ownerTokenHash: string; // SHA-256 of exact owner-token UTF-8 bytes
  continuationIntentId: string | null;
  claimOrdinal: number | null;
  derivedContractHash: string;
  grants: { work: Amount; handoff: Amount };
  profiles: {
    estimator: ProfileBindingV1 | null;
    worker: ProfileBindingV1 | null;
    handoff: ProfileBindingV1 | null;
  };
};
type EstimateExecutionContractV1 = {
  schema: "orca-estimate-execution-contract-v1";
  requestHash: string;
  grant: Amount;
  profile: ProfileBindingV1;
  estimatorCapabilities: {
    contextWindowTokens: number;
    usageObservation: "realtime" | "phase-end" | "unavailable";
    budgetEnforcement: "bounded" | "soft" | "unavailable";
    contextObservation: "realtime" | "phase-end" | "unavailable";
  };
  instructionVersion: string;
  responseSchemaVersion: "budget-estimate-v1";
  tokenizer:
    | { kind: "exact"; tokenizerId: string; tokenizerVersion: string }
    | { kind: "utf8-upper-bound"; numerator: number; denominator: number; proofRef: string };
  framingTokenOverhead: number;
  maxOutputTokens: number;
};
```

`startEnvelopeHash` is the SHA-256 of canonical `DispatchEnvelopeV1`. Estimate encodes only `profiles.estimator`, puts its fixed grant in `grants.work`, and uses zero `grants.handoff`; work encodes `profiles.worker` plus the selected handoff binding and both confirmed task buckets; handoff encodes only `profiles.handoff` and those same immutable task buckets. All other profile slots are `null`. For handoff, `claimIdentity` is `<handoffRequestId>:attempt:<phaseAttemptOrdinal>` and `claimOrdinal` is that same `phaseAttemptOrdinal`; ordinary/continuation work uses its claim-attempt identity and claim ordinal; estimate uses its estimate claim identity and `null`. Only continuation work supplies `continuationIntentId`. `generation` and non-null ordinals are positive safe integers. `derivedContractHash` for estimate is the canonical hash of `EstimateExecutionContractV1`; for work/handoff it is the confirmed task contract hash. This exact slot mapping replaces any interpretation of “all profile hashes.”

Verification rejects unknown fields and requires the literal `schema`, `providerStartForbiddenUntilVerified`, phase/run/generation/provider-attempt ordinal/envelope/contract/profile/scheme/version, `evidenceKind`, and every other field to match. `boundedDimensions` is lexicographically sorted and duplicate-free before hashing and must equal the selected profile's sorted `workDimensions` for estimate/work or `handoffDimensions` for handoff. It must also contain the matrix-required proof dimensions. Each bounded dimension has a safe-integer `requestLimits` value and each unbounded dimension is exactly `null`; non-null values must be less than or equal to the corresponding phase grant. Estimate `tokens` must equal `requiredRequestTokens` from Section 5.4; work/handoff token maxima may be narrower than their grants. When present, `attempts` is exactly `1`; `sessions` is `1` only for an attempt that may open the phase's first session and otherwise `0`; `activeMs` is the adapter's exact monotonic timeout maximum for that provider invocation. A provider-start marker contains that attempt artifact hash. An artifact from another attempt, generation, profile, phase, or envelope is rejected as `request-bound-proof-invalid`.

An arbitrary evidence string, a model estimate, or a capability declaration by itself is not proof. Codex therefore remains `usageObservation: phase-end` plus `budgetEnforcement: soft` even though ccloop can encode contract limits; its `contextObservation` is independently declared and is not inferred from “phase-end.” The real ccloop consumer supplies durable handoff control. Because handoff-stop applies to every active run, every V1 execution profile must observe `handoffControl: durable` before claim; a phase-end or unavailable profile is shown but cannot start Web-controlled work.

The Control API uses the Panel's existing same-origin one-time token and Host protections. The default remains loopback-only. This design does not add an unauthenticated port or weaken the existing explicit remote-exposure warning.

### 3.2 Canonical state and refresh

The browser stores only presentation preferences and unsaved form drafts. The authoritative group, graph, budget, run, checkpoint, command, and recovery state comes from `ControlStore`.

V1 uses command-triggered refetch plus polling:

- refetch immediately after a command completes;
- while visible, poll the lightweight control summary every two seconds;
- refetch the selected full group when its projection sequence changes;
- perform a full refetch on visibility resume, network reconnect, epoch change, or detected sequence gap.

The store exposes two separate version families:

- `commandRevision` is per group and changes only when a command changes authority. It is the only value used by mutation CAS.
- `projectionSeq` is per group and changes on every committed UI-visible transition, including usage observations, checkpoint commits, continuation projections, and command effects.

A global monotonic `changeSeq` changes in the same transaction as every per-group `projectionSeq` update. The service also exposes a process `epoch` that changes on restart. Summary responses include `epoch`, global `changeSeq`, and each changed group's `projectionSeq`; full group responses include `commandRevision` and `projectionSeq`.

Observation-only writes never change `commandRevision`. This prevents background usage and checkpoint traffic from manufacturing command conflicts, while ensuring that the browser does not miss state changes that leave command authority untouched.

“UI-visible” means that the canonical serialized control summary or full-group response would change. Usage, run state, checkpoint state, evidence availability, typed failures, recovery blockers, and command effects therefore advance projection state. Internal retry timestamps, lease heartbeats, and outbox delivery attempts do not advance it unless their result changes a returned field.

The sequence rules are exact:

- successful import creates the group at `commandRevision: 1` and `projectionSeq: 1`; revision `0` means the group does not exist;
- one transaction increments a changed group's `commandRevision` at most once, and only if it changes command authority;
- one transaction increments each affected group's `projectionSeq` exactly once, regardless of how many rows for that group changed;
- one transaction that changes any projections increments global `changeSeq` exactly once; every affected group is associated with that resulting global sequence;
- usage, checkpoint, evidence, recovery, and delivery observations change projection state but not command authority;
- every capacity-dependent command rereads `used`, `reserved`, and unknown-usage state inside its write transaction, so a stable command revision never licenses a stale capacity calculation.

At every Panel process start, the service generates a new random UUID `epoch` after recovery and keeps it fixed for that process lifetime. It is not a persisted generation number. `GET /api/control/summary?sinceChangeSeq=N` returns groups changed after `N`; if `N` is absent, ahead of the server, or older than the retained invalidation journal, it returns `resetRequired: true` and a complete summary. `N`, when present, must be a decimal nonnegative JavaScript safe integer with no sign, fraction, exponent, whitespace, or leading zero other than the literal `0`; any other spelling returns `400 query-invalid`. This makes sequence-gap behavior deterministic.

On epoch mismatch, `resetRequired`, reconnect uncertainty, or a detected gap, the client discards its canonical config/group/summary caches while retaining only unsaved form drafts and uncertain command IDs. It then fetches `config`, a complete summary/group list, and the selected full group if that group is still present. A complete summary replaces the cache: a previously cached group absent from it is deleted locally. During an ordinary incremental response, each listed group whose `projectionSeq` differs from the cached value is refetched; unlisted groups remain unchanged.

The protocol deliberately matches a future invalidation stream. SSE or WebSocket may replace polling later without changing state ownership or mutation semantics.

## 4. Command and API semantics

Every mutation uses a command envelope:

```json
{
  "commandId": "uuid",
  "expectedRevision": 12,
  "payload": {}
}
```

On the wire, `expectedRevision` means the group's `commandRevision`. It never means `projectionSeq` or global `changeSeq`.

The browser creates one `commandId` per user intent. A timeout or lost response must be retried with the same ID. The rules are:

- same ID and same canonical raw request: return the persisted first result and effective payload;
- same ID and different canonical raw request: `409 command-id-conflict`;
- stale `expectedRevision` relative to `commandRevision`: `409 revision-conflict` with no side effect;
- after a revision conflict, refetch and ask the user to apply a new intent; never silently replay against a newer revision.

Validation order is stable: check an existing command ID and request identity first, then `expectedRevision`, then endpoint-specific versions such as `proposalVersion`, then domain validation. Thus a stale command and stale proposal returns `revision-conflict`; a current command revision with a stale proposal returns `proposal-version-conflict`.

Every use of “canonical JSON” in this document means RFC 8785 JSON Canonicalization Scheme bytes, with the additional protocol restriction that every JSON number is a JavaScript safe integer. Lone surrogates, duplicate object keys, non-finite values, fractional numbers, and negative-zero inputs are rejected before canonicalization. RFC 8785 fixes UTF-8 encoding, string escaping, UTF-16 code-unit property ordering, and decimal integer serialization; arrays preserve order unless a schema explicitly declares a sorted set. For a new command, deterministic schema defaults are expanded before hashing. Trusted configuration defaults that may change across restarts use a two-hash rule: the store persists both the canonical raw request, where omission remains observable, and the once-expanded effective payload. An existing `(groupId, commandId)` is looked up before re-reading current dynamic defaults; actor, endpoint verb/target, `expectedRevision`, and the incoming raw payload must equal the persisted raw request identity after only the explicit normalization in its payload schema, or it is `command-id-conflict`. If it matches, the persisted effective payload and result are replayed even when the current server default has changed. Server-generated values such as `acceptedAt` are created only during the first durable application and persisted in its result; Section 6.2 states the sole case where a derived deadline is also inserted into effective payload. The raw-request hash exists only for replay conflict detection.

Every protocol timestamp is exactly UTC `YYYY-MM-DDTHH:mm:ss.SSSZ`, years `0001` through `9999`, with three decimal digits and no leap second. Other RFC 3339-equivalent spellings or precisions are schema-invalid, so timestamp normalization is never implicit.

The command preimages use this exact schema:

```ts
type CommandVerbV1 =
  | "import-plan" | "proposal-edit" | "estimate" | "confirm" | "start"
  | "pause-dispatch" | "handoff-stop" | "resume-dispatch"
  | "resume-from-handoff" | "set-limit" | "continue-task" | "recovery-retry"
  | "shutdown";
type CommandTargetV1 =
  | { kind: "group"; groupId: string }
  | { kind: "task"; groupId: string; taskId: string }
  | { kind: "run"; groupId: string; runId: string }
  | { kind: "global"; epoch: string };
type AuthorityCommandV1 = {
  schema: "orca-authority-command-v1" | "orca-raw-command-v1";
  commandId: string;
  expectedRevision: number;
  actorId: string;
  verb: CommandVerbV1;
  target: CommandTargetV1;
  payload: object;
};
```

For browser commands `actorId` is the stable random Panel-operator principal persisted in `stateDir`, never the one-time token or process epoch. Group endpoints use the group target, per-task continue uses the task target including its path `taskId`, and run-scoped recovery uses the resolved run target; import uses its proposed group target. The internal shutdown command uses `actorId: "system:shutdown"`, `verb: "shutdown"`, `target: {kind:"global",epoch}`, `expectedRevision: 0`, and effective payload `{shutdownAcceptedAt,shutdownDeadlineAt}`. The authority hash sets the authority schema and effective payload; raw identity sets the raw schema and unexpanded schema-valid payload. Unknown fields are rejected, absent raw optionals stay absent, explicit `null` is never equivalent to omission unless the payload schema accepts it, strings are not Unicode-normalized, and RFC 3339 strings retain their exact schema-valid spelling.

Command hashes are lower-case hex SHA-256. `effectivePayloadHash` is SHA-256 of the RFC 8785 canonical bytes of the effective payload object alone. `authorityCommandHash` is SHA-256 of the canonical `AuthorityCommandV1` with `schema: "orca-authority-command-v1"` and that same effective payload. The raw replay key analogously hashes the canonical `AuthorityCommandV1` with `schema: "orca-raw-command-v1"` and the normalized-but-unexpanded raw payload. These three preimages are distinct and implementations must not substitute one for another.

After authentication, route resolution, and successful envelope/payload schema parsing, every application outcome—including revision, profile, capability, source-plan validation, domain, and recovery failures—is persisted in the command ledger before response, even when import has not created its group. Reuse of that command ID replays the outcome; correcting the cause is a new user intent with a new command ID. Authentication failures, unknown routes, malformed JSON/schema, and an infrastructure `5xx` before a durable command result are not command results and may be retried with the same ID. Command IDs are unique per `groupId` across verbs and routes, so a different actor, verb, target, revision, or raw payload conflicts.

Every schema-valid mutation acquires the shared admission permit before reading dynamic capability or entering domain validation and holds it until its command result commits or the attempt aborts. Shutdown closes that gate and waits for all such permits, including claim permits, before its global scan.

Uncertain commands are retained in browser `sessionStorage`. On reload the client first queries the command result instead of manufacturing a new command ID.

V1 retains command deduplication records and results for the lifetime of the group evidence; it does not age them out. An import failure is retained in the global ledger under its proposed group ID even though no group row exists, and the command-result lookup still resolves it. “Recent commands” in a group snapshot is only a bounded presentation list. Direct lookup by command ID remains available for every retained command.

### 4.1 V1 endpoints

```text
GET  /api/control/config
GET  /api/control/summary?sinceChangeSeq=N
GET  /api/control/groups
GET  /api/control/groups/:groupId
GET  /api/control/groups/:groupId/commands/:commandId

POST /api/control/groups/import-plan
POST /api/control/groups/:groupId/proposal/edit
POST /api/control/groups/:groupId/estimates
POST /api/control/groups/:groupId/confirm
POST /api/control/groups/:groupId/start
POST /api/control/groups/:groupId/pause-dispatch
POST /api/control/groups/:groupId/handoff-stop
POST /api/control/groups/:groupId/resume-dispatch
POST /api/control/groups/:groupId/resume-from-handoff
POST /api/control/groups/:groupId/set-limit
POST /api/control/groups/:groupId/tasks/:taskId/continue

GET  /api/control/recovery
POST /api/control/recovery/retry
GET  /api/control/runs/:runId/evidence
```

`config` returns only safe display data: stable repository, plan, and model-profile IDs plus declared and observed adapter capability. It also returns the trusted `defaultEstimatorProfileId`, its profile hash, and the server default `estimateMode` used when import fields are omitted. It does not return an executable command or a browser-writable path.

All read endpoints use closed V1 top-level schemas; nested arrays are lexicographically sorted by their first ID field unless another order is named:

```ts
type CapabilityViewV1 = {
  usageObservation: "realtime" | "phase-end" | "unavailable";
  budgetEnforcement: "bounded" | "soft" | "unavailable";
  contextObservation: "realtime" | "phase-end" | "unavailable";
  handoffControl: "durable" | "phase-end" | "unavailable";
  handoffExecution: "mechanical-in-run-v1" | "model-assisted-v1" | null;
  contextWindowTokens: number | null;
  requestBoundProof: null | { scheme: "adapter-request-bound-v1"; version: string; workDimensions: (keyof Amount)[]; handoffDimensions: (keyof Amount)[]; evidenceKind: string };
};
type ControlConfigV1 = {
  schema: "orca-control-config-v1"; epoch: string;
  repositories: Array<{ repoId: string; displayName: string }>;
  plans: Array<{ planId: string; repoId: string; displayName: string }>;
  profiles: Array<{ profileId: string; profileHash: string; allowedWorkKinds: WorkKind[]; contextTokenizer: null | { tokenizerId: string; tokenizerVersion: string }; workMaxOutputTokens: number | null; declared: CapabilityViewV1; observed: CapabilityViewV1; observedAt: string; probeFailureCode: string | null }>;
  defaults: { estimatorProfileId: string; estimatorProfileHash: string; estimateMode: "strict" | "soft" };
  errorCatalog: Array<{ code: string; status: number }>;
};
type GroupSummaryV1 = {
  groupId: string; state: "draft" | "ready" | "running" | "review" | "done" | "blocked";
  commandRevision: number; projectionSeq: number;
  stopMode: null | "pause" | "shutdown" | "handoff";
  stopState: null | "paused" | "handoff-pending" | "handoff-partial" | "handoff-unresolved" | "handoff-complete";
  claimBlocked: boolean; recoveryBlockerCount: number;
};
type ControlSummaryV1 = { schema: "orca-control-summary-v1"; epoch: string; changeSeq: number; resetRequired: boolean; dispatchBlocked: boolean; groups: GroupSummaryV1[] };
type FieldProvenanceV1 = { provenance: "complex-1m-default" | "model" | "human" | "system"; estimateId: string | null };
type AmountProvenanceV1 = { tokens: FieldProvenanceV1; activeMs: FieldProvenanceV1; attempts: FieldProvenanceV1; sessions: FieldProvenanceV1 };
type AllocationViewV1 = { ownerKind: "estimate" | "task" | "goal-review" | "reserve"; ownerId: string; bucket: "work" | "handoff" | "review" | "reserve"; state: "draft-encumbered" | "confirmed" | "active" | "held" | "continuing" | "terminal" | "unknown"; amount: Amount; fieldProvenance: AmountProvenanceV1 };
type WorkItemViewV1 = { taskId: string; status: "draft" | "ready" | "starting" | "start-unknown" | "active" | "held" | "continuing" | "completed" | "blocked"; dependencyTaskIds: string[]; targetVersion: string; configHash: string; originalContractHash: string; derivedContractHash: string | null; currentRunId: string | null; pendingRunId: string | null; lineageRunIds: string[] };
type RunViewV1 = { runId: string; taskId: string | null; estimateId: string | null; generation: number; state: "starting" | "unknown" | "attempt-unknown" | "attempt-proof-invalid" | "running" | "failed-before-provider" | "settled-recoverable" | "settled-restartable" | "settled-unrecoverable"; phase: "estimate" | "work" | "handoff"; claimOrdinal: number | null; providerAttemptOrdinal: number; profile: ProfileBindingV1; used: Amount; remaining: Amount; failureCode: string | null; evidenceIds: string[] };
type EstimateViewV1 = { estimateId: string; estimateVersion: number; state: "queued" | "running" | "start-unknown" | "ready" | "failed" | "interrupted" | "blocked-capability" | "input-too-large"; profile: ProfileBindingV1; mode: "strict" | "soft"; requestHash: string | null; outputHash: string | null; output: BudgetEstimateV1 | null; reasonCode: string | null };
type CheckpointViewV1 = { checkpointId: string; taskId: string; runId: string; state: "complete" | "partial" | "unknown"; snapshotHash: string | null; evidenceIds: string[] };
type HandoffRequestViewV1 = { requestId: string; runId: string; state: "request-pending" | "latched" | "collecting" | "settled-recoverable" | "settled-restartable" | "settled-unrecoverable" | "outcome-unknown"; deadlineAt: string; phaseAttemptOrdinal: number; failureCode: string | null; evidenceIds: string[] };
type GroupViewV1 = {
  schema: "orca-control-group-v1"; epoch: string; changeSeq: number; summary: GroupSummaryV1;
  graphVersion: number; plan: { repoId: string; planId: string; planHash: string; goal: string; successConditions: string[] };
  proposal: { state: "editable" | "confirmed"; proposalVersion: number; planHash: string; budgetMode: "strict" | "soft" | null; contextPolicy: { handoffAtContextTokens: number | null }; profiles: null | { estimator: ProfileBindingV1; worker: ProfileBindingV1; handoff: ProfileBindingV1; goalReview: ProfileBindingV1 }; executionSnapshotHash: string | null };
  ledger: { groupLimit: Amount; used: Amount; committedRemaining: Amount; explicitUnallocatedReserve: Amount; budgetDeficit: Amount; usageUnknown: boolean };
  allocations: AllocationViewV1[]; workItems: WorkItemViewV1[]; estimates: EstimateViewV1[]; runs: RunViewV1[]; checkpoints: CheckpointViewV1[]; handoffRequests: HandoffRequestViewV1[];
  stop: null | { mode: "pause" | "shutdown" | "handoff"; state: "paused" | "handoff-pending" | "handoff-partial" | "handoff-unresolved" | "handoff-complete"; frozenRunIds: string[]; acceptedAt: string | null; deadlineAt: string | null };
  recoveryBlockers: Array<{ scope: "global" | "group" | "run"; code: string; runId: string | null; evidenceIds: string[] }>;
  recentCommandIds: string[];
};
type RecoveryViewV1 = { schema: "orca-control-recovery-v1"; epoch: string; dispatchBlocked: boolean; blockers: Array<{ scope: "global" | "group" | "run"; groupId: string; runId: string | null; code: string; evidenceIds: string[] }> };
type EvidenceManifestV1 = { schema: "orca-run-evidence-v1"; runId: string; entries: Array<{ evidenceId: string; kind: string; sha256: string; byteLength: number; downloadUrl: string }> };
```

In `FieldProvenanceV1`, `estimateId` is non-null exactly when provenance is `model`; it is `null` for default, human, and system values. Allocation owner IDs are canonical: a task row uses its `taskId`, an estimate row its `estimateId`, the group goal-review row uses `<groupId>:goal-review`, and the explicit reserve row uses `<groupId>:reserve`. Estimate allocation/reserve rows use `system` provenance because they are platform accounting, while editable task and goal-review fields use only default/model/human. In a pre-confirmation group `proposal.profiles` and `executionSnapshotHash` are both `null`; after confirmation both are non-null and exactly match the archived execution snapshot.

`GET config`, summary, full group, recovery, and run evidence return the corresponding schema. `GET groups` returns a complete `ControlSummaryV1` with `resetRequired: true`; an incremental summary contains only changed groups as Section 3.2 defines. Unknown fields require a schema bump. The full group intentionally exposes references and hashes, not executable paths or raw retained evidence.

There is deliberately no immediate-kill route. A forged request to such a path receives the normal typed `404 route-not-found`; it cannot reach `ControlService` or an adapter.

The remaining mutation payloads, inside the common envelope, are normative:

```ts
type EmptyPayload = Record<string, never>; // start, pause-dispatch, resume-dispatch
type ImportPlanPayload = {
  groupId: string;
  repoId: string;
  planId: string;
  estimatorProfileId?: string;
  estimatorProfileHash?: string;
  estimateMode?: "strict" | "soft";
};
type HandoffStopPayload = { handoffDeadlineAt?: string }; // RFC 3339 UTC instant
type ResumeFromHandoffPayload = {
  selections: Array<{ taskId: string; predecessorRunId: string; checkpointId: string }>;
};
type ContinueTaskPayload = { predecessorRunId: string; checkpointId: string };
type RecoveryRetryPayload =
  | { scope: "run"; runId: string }
  | { scope: "group"; groupId: string };
```

Dynamic default expansion is exhaustive: import expands the estimator ID/hash and mode described below, and handoff-stop expands an omitted `handoffDeadlineAt` to the frozen deadline in Section 6.2. That derived deadline string is part of the effective `HandoffStopPayload` and authority hash; `acceptedAt` remains result metadata, not payload. For effective proposal edits, omitted `proposedGroupLimit` is encoded `null`, and non-model operations encode `estimateId: null`; all other payload fields are required or the payload is `EmptyPayload`. No other current-state value is silently inserted into an effective payload. Shutdown requests are internal system commands, not browser payloads.

For `import-plan`, omission of `estimatorProfileId` or `estimateMode` expands to the trusted values returned by `config` before command-payload hashing; the default mode is `strict`. Supplying `estimatorProfileId` requires the matching `estimatorProfileHash`; omitting the ID also omits the hash and expands both from the trusted default. A mismatch returns `profile-changed` before any group is created. Import uses the caller-supplied `groupId` as the command's group identity and requires `expectedRevision: 0`. The browser cannot infer a default from list order. `recovery/retry` is deliberately scoped to exactly one run or one group; run scope resolves the owning group before validating `expectedRevision`, and there is no V1 “retry all” mutation.

The full group snapshot includes:

- group state, command revision, projection sequence, graph version, and stop intent;
- plan provenance and content hash;
- work items, dependencies, target versions, and both original and derived contract hashes;
- budget defaults, estimates, human edits, used, reserved, and unknown usage;
- runs, checkpoints, handoff, continuation, and evidence references;
- adapter capability;
- recovery blockers;
- recent commands and typed failures.

All errors return a stable `code`, a displayable message, the current `commandRevision` where applicable, and evidence IDs where applicable. The browser must not parse prose to decide behavior.

Successful mutation status is fixed: import returns `201`; an eligible estimate, start, handoff-stop, either resume command, and per-task continue return `202` because durable background work follows; proposal edit, confirm, pause-dispatch, set-limit, recovery retry, and a terminal no-call estimate return `200`. A replay returns the persisted original status and body. Expected validation, conflict, capability, and recovery failures use the typed non-2xx error envelope, except the explicitly persisted terminal estimate results in Section 4.3.

The error body has exactly `{ "error": { "code": string, "message": string, "commandRevision": number|null, "evidenceIds": string[], "retryable": boolean } }`; unknown fields inside `error` or at the top level are rejected for V1. Clients branch only on `code`. `retryable` answers only whether replaying the same request and command ID may produce a new outcome: it is `false` for every durable command result because replay is immutable, and for malformed/authentication/authorization/not-found errors; it is `true` only for a non-durable `panel-draining`, transient synchronous dependency outage, or unexpected pre-result `500`. A `423` recovery lock is a durable command outcome and is therefore `false`; after recovery the operator sends a new intent with a new command ID. Status classes are fixed: malformed JSON/schema/unknown fields/non-finite values use `400`; authentication/authorization use `401`/`403`; unknown route or resource uses `404`; command, revision, proposal, profile, stop-mode, ownership, and identity conflicts use `409`; global recovery lock uses `423`; valid but unrepresentable/unsupported domain requests—including `control-capability-unsupported`, `execution-policy-unrepresentable`, `group-budget-unavailable`, and non-retryable recovery validation—use `422`; `panel-draining` and a transient synchronous dependency outage use `503`; unexpected internal failure uses `500`. Background codes such as `claim-capability-unavailable`, `request-bound-proof-invalid`, and `start-proof-outcome-unknown` are persisted run/group results rather than an HTTP response to the already completed start/resume command. All other typed codes must be assigned to one of these classes in the versioned server error catalog returned by `config`.

Every successful mutation body is this closed union; unused arrays are empty rather than omitted:

```ts
type CommandSuccessV1 = {
  schema: "orca-command-success-v1";
  commandId: string;
  actorId: string;
  verb: CommandVerbV1;
  target: CommandTargetV1;
  commandRevision: number | null;
  projectionSeq: number | null;
  effectivePayloadHash: string;
  authorityCommandHash: string;
  result:
    | { kind: "imported"; groupId: string; estimateId: string; estimateState: "queued" | "blocked-capability" | "input-too-large"; estimateReasonCode: string | null }
    | { kind: "proposal-edited"; proposalVersion: number }
    | { kind: "estimate-created"; estimateId: string; estimateVersion: number; estimateState: "queued" | "blocked-capability" | "input-too-large"; reasonCode: string | null; wakeId: string | null }
    | { kind: "confirmed"; executionSnapshotHash: string }
    | { kind: "scheduled"; operation: "start" | "resume-dispatch"; wakeId: string }
    | { kind: "paused"; stopMode: "pause" }
    | { kind: "handoff-stopped"; stopRevision: number; acceptedAt: string; handoffDeadlineAt: string; frozenRunIds: string[]; requestIds: string[] }
    | { kind: "resumed-from-handoff"; wakeId: string; pendingRuns: Array<{ taskId: string; continuationIntentId: string; pendingRunId: string; claimOrdinal: number }> }
    | { kind: "limit-set"; limit: Amount }
    | { kind: "task-continuing"; continuationIntentId: string; pendingRunId: string; claimOrdinal: number; wakeId: string }
    | { kind: "recovery-observed"; resolved: boolean; blockerCodes: string[]; evidenceIds: string[]; wakeIds: string[] }
    | { kind: "shutdown"; groups: Array<{ groupId: string; disposition: "created" | "strengthened-pause" | "preserved-pause" | "preserved-handoff" | "preserved-shutdown" | "blocked-inconsistent"; changed: boolean; commandRevision: number; projectionSeq: number; frozenRunIds: string[]; requestIds: string[]; blockerCode: string | null }> };
};
type CommandLookupV1 = {
  schema: "orca-command-lookup-v1";
  originalStatus: number;
  body: CommandSuccessV1 | { error: { code: string; message: string; commandRevision: number | null; evidenceIds: string[]; retryable: boolean } };
};
```

Mutation HTTP returns `CommandSuccessV1` directly with the status specified above. Browser-command successes always have non-null `commandRevision` and `projectionSeq`. The global shutdown success has both top-level values `null`; each sorted group entry carries its own post-transaction values, exact frozen set/request IDs, disposition, and blocker. `GET .../commands/:commandId` returns `200 CommandLookupV1` for a retained result, preserving the original status and parsed JSON value exactly inside the wrapper, and `404 command-result-not-found` otherwise. The separately retained original response bytes are evidence but are not embedded as an escaped byte string. Generated IDs, hashes, revision, projection, deadlines, and recovery wakes are therefore never inferred by the browser.

All scalar ID arrays are lexicographically sorted and duplicate-free. Object arrays are sorted by `groupId`, `taskId`, `estimateId`, `runId`, `checkpointId`, `requestId`, or `evidenceId` as applicable; allocations sort by `(ownerKind, ownerId, bucket)`, profile lists by `profileId`, recovery blockers by `(scope, groupId, runId-or-empty, code)`, and `pendingRuns` alone preserves request selection order. `RunViewV1.phase`, `profile`, and `providerAttemptOrdinal` describe the current nonterminal phase, or the most recently settled phase for a terminal run; immutable earlier phase profiles and ordinals remain in the evidence manifest. For a work run that enters handoff, these fields therefore change together from worker/work to handoff and never combine a handoff ordinal with the worker profile.

### 4.2 Atomic plan import

The browser does not sequence `createGroup` followed by many `putWork` calls. `import-plan` is one application command.

Before the transaction, the server resolves the allowlisted plan ID, reads and normalizes it, validates contracts and the graph, and prepares this closed record; unknown fields are rejected:

```ts
type ControlPlanV1 = {
  schema: "orca-control-plan-v1";
  repoId: string;
  planId: string;
  goal: string;
  successConditions: string[];
  tasks: Array<{
    taskId: string;
    dependencyTaskIds: string[];
    targetVersion: string;
    configHash: string;
    originalContractHash: string;
    originalContractCanonicalJson: string;
  }>;
};
```

The allowlisted source adapter must map its format into these exact fields before hashing. It rejects invalid UTF-8 and empty strings, preserves string code points without Unicode normalization, and performs no whitespace rewriting inside values. `successConditions` preserve source order and duplicates are rejected. `tasks` are sorted lexicographically by `taskId`; each `dependencyTaskIds` array is sorted lexicographically and duplicate-free. `originalContractCanonicalJson` is the exact UTF-8 text of the RFC 8785 canonical `orca-task-contract-v1` object accepted by the foundation validator, and `originalContractHash` is lower-case hex SHA-256 of those bytes. `configHash` is the validated lower-case hex SHA-256 supplied by the source plan for that task's execution configuration. `targetVersion` is the source plan's nonempty opaque version string and is not numerically coerced. The plan has no other implicit source fields. `planHash` is lower-case hex SHA-256 of the RFC 8785 canonical UTF-8 bytes of `ControlPlanV1`. Inside one SQLite transaction import writes:

- the group draft;
- every task work item and dependency;
- target and config hashes;
- the initial budget proposal;
- plan provenance;
- the canonical normalized plan and original task contracts as content-addressed ControlStore records;
- the automatic estimate work item or its terminal capability-blocked/input-too-large state.

The group is either fully imported or absent. Import uses `expectedRevision: 0` and a caller-provided stable `groupId`, so a response-lost retry can query or replay the same command safely.

The automatic estimate profile and mode come only from the fully defaulted `ImportPlanPayload`: explicit allowlisted values win, otherwise the trusted `config` defaults are frozen into the command and group snapshot. They are not inferred from the worker profile, browser state, or whatever profile is listed first. If capability or deterministic input preflight makes the initial attempt terminal without a call, the import transaction places its entire unused fixed grant into explicit reserve instead of an estimate commitment; the formula-defined group limit does not shrink. A successful import returns `201` with the created group and estimate identity.

All later estimation, confirmation, preflight, and execution read the ControlStore snapshot, not the mutable source path. An optional filesystem export under the server-owned `stateDir` is evidence only and is published by atomic rename after the database commit; it is not execution authority. The source location remains provenance only. A source edit has no effect on an imported group. V1 re-import always uses `import-plan` with a new caller-supplied `groupId`; it never mutates the snapshot of an existing group. Recovery verifies the canonical snapshot hash before dispatch and fails closed on a missing or mismatched record.

### 4.3 Proposal editing and re-estimation

The server owns the draft proposal and its monotonically increasing `proposalVersion`. `proposal/edit` accepts a base proposal version plus a sparse set of field operations. Each operation names a task/allocation/dimension field, supplies its replacement safe-integer value, and records one of these sources:

- `human`, for a directly entered value;
- `model`, with an immutable `estimateId`, for an explicitly applied model suggestion;
- `complex-1m-default`, for restoring the default value.

The endpoint payloads, inside the common command envelope, are:

```ts
type ProposalEditPayload = {
  baseProposalVersion: number;
  operations: Array<{
    target:
      | { scope: "task"; taskId: string; allocation: "work" | "handoff"; dimension: keyof Amount }
      | { scope: "goal-review"; dimension: keyof Amount };
    value: number;
    provenance: "complex-1m-default" | "model" | "human";
    estimateId?: string; // required only for model
  }>;
  proposedGroupLimit?: Amount;
};

type ReestimatePayload = {
  proposalVersion: number;
  estimatorProfileId: string;
  estimatorProfileHash: string;
  estimateMode: "strict" | "soft";
};

type ConfirmPayload = {
  planHash: string;
  proposalVersion: number;
  budgetMode: "strict" | "soft";
  profileIds: {
    estimator: string;
    worker: string;
    handoff: string;
    goalReview: string;
  };
  profileHashes: {
    estimator: string;
    worker: string;
    handoff: string;
    goalReview: string;
  };
  contextPolicy: { handoffAtContextTokens: number | null };
};

type SetLimitPayload = { limit: Amount };
```

`proposedGroupLimit` is the only draft operation that directly changes residual unallocated reserve. It edits the value that confirmation will commit and, while the group is draft, the current ceiling that may fund estimator work. For a command carrying both allocation operations and a new limit, the server first builds the complete candidate allocation set, then chooses the supplied or existing candidate limit, and finally derives reserve as `candidateLimit - used - candidateCommitments`; any negative component rejects the whole command. Thus allocation operations may indirectly consume or return reserve, but there is no separate reserve-target operation or operation-order ambiguity. `set-limit` is for an already confirmed or running group. A model suggestion that needs more capacity may be viewed without changing authority, but applying it must include a sufficient `proposedGroupLimit` increase in the same proposal command or fail `group-budget-unavailable`; the server never raises the limit implicitly.

One edit command validates and applies all operations atomically, increments `proposalVersion` once, records per-field provenance, and increments the group command revision once. Two operations naming the same `(scope, taskId/allocation, dimension)` are rejected as `duplicate-proposal-target`; operation order never supplies last-wins semantics. An empty operation list with omitted limit, or a candidate identical to the current proposal/limit, is `422 no-op-command`. Work grants require positive `tokens`, `activeMs`, `attempts`, and `sessions`; handoff and reserve dimensions may be zero. The edit rejects a stale proposal version or a field that does not belong to the imported task set. It is allowed while the group is `draft`, or while it is `ready` and no start command has committed. Editing `ready` atomically invalidates the prior derived snapshots and returns the group to `draft`. Once start commits and the group is `running`, grant editing is rejected with `grant-amendment-unsupported` even if no worker claim has yet been accepted; this prevents an already durable scheduler wake from observing changed authority.

Estimate completion never mutates the proposal. It only stores a new immutable `BudgetEstimate`, increments projection state, and makes suggestions available. Consequently an estimate that finishes after a human edit cannot overwrite that edit. Applying any suggestion is a later explicit `proposal/edit` command.

`estimates` is the explicit re-estimation command. It receives the current proposal version, an allowlisted estimator profile ID and exact profile hash, and explicit estimate mode. A stale hash returns `profile-changed` without creating an estimate version. If the selected mode/profile is eligible, the transaction checks free group capacity, reserves the fixed estimator grant, creates a versioned estimate work item plus durable wake, increments command revision, and returns `202`. If capability blocks the attempt, the same command records a versioned terminal `blocked-capability` estimate without reserving a grant or creating a wake and returns `200` with reason code `estimate-blocked-capability`. Deterministic preflight overflow is likewise a persisted terminal `input-too-large` estimate and a `200` command result with reason code `estimate-input-too-large`; neither terminal outcome is an HTTP error or model call. The endpoint is available only while the group is `draft` or pre-start `ready`; start commit closes re-estimation. A replay uses the same command ID and returns the same status/body without creating a duplicate run. Response loss is resolved through the command-result endpoint. The initial estimate created by import is estimate version 1; re-estimation starts at the next version.

For an eligible estimate, import and every re-estimation transaction write `scheduler-wake:<groupId>:estimate:<estimateId>` in the same transaction as the estimate work item. A capability-blocked estimate records its terminal blocked state and no wake. Recovery redelivers an undelivered wake, and the estimate claim identity is `estimate:<groupId>:<estimateId>`. A crash after import or re-estimation commit cannot lose an eligible automatic attempt or duplicate it.

### 4.4 Atomic confirmation and start

Confirmation materializes this closed authority record; unknown fields are rejected:

```ts
type ExecutionSnapshotV1 = {
  schema: "orca-execution-snapshot-v1";
  groupId: string;
  planHash: string;
  graphVersion: number;
  proposalVersion: number;
  groupLimit: Amount;
  budgetMode: "strict" | "soft";
  contextPolicy: { handoffAtContextTokens: number | null };
  profiles: {
    estimator: ProfileBindingV1;
    worker: ProfileBindingV1;
    handoff: ProfileBindingV1;
    goalReview: ProfileBindingV1;
  };
  allocations: Array<{
    ownerKind: "task" | "goal-review" | "reserve";
    ownerId: string;
    bucket: "work" | "handoff" | "review" | "reserve";
    amount: Amount;
    fieldProvenance: AmountProvenanceV1;
  }>;
  derivedContracts: Array<{ taskId: string; derivedContractHash: string }>;
};
```

`allocations` sort by `(ownerKind, ownerId, bucket)` and contain exactly two rows (`work`, `handoff`) for every task plus one goal-review and one explicit-reserve row. Task rows use `ownerId: taskId`; the goal-review row uses `ownerId: <groupId>:goal-review`; the reserve row uses `ownerId: <groupId>:reserve`. `derivedContracts` sort by `taskId` and contain every task exactly once. The record contains no timestamps or mutable estimate/run state. `executionSnapshotHash` is lower-case hex SHA-256 of the RFC 8785 canonical UTF-8 bytes of this `ExecutionSnapshotV1`. Confirmation writes the record, its hash, all referenced derived-contract records, and the command result atomically; the full-group read returns the same four profile bindings and hash.

`confirm` atomically records the plan and proposal versions, every task grant, group limit, review reserve, context policy, budget mode, selected profile IDs and profile hashes, nullable applied-estimate references, field provenance, and one immutable execution-contract snapshot per task. A proposal may be confirmed with no successful estimate; failed and capability-blocked estimate attempts remain historical evidence but are not applied references. For every estimate-sourced field, confirmation verifies that the referenced immutable estimate is `ready`, has the same canonical plan hash, contains that exact task/field suggestion, and still matches the proposal value; a later human/default edit removes that field's estimate reference. Confirmation rejects a stale plan, proposal, explicitly applied estimate, profile hash, or command revision. It rereads group usage, commitments, and unknown-usage state inside the transaction. Unknown usage blocks confirmation, and the proposed limit must satisfy the conservation ledger in Section 5.1.1. Confirmation never partially publishes a budget or derived contract.

The imported original contract remains immutable evidence. Confirmation derives the execution contract by copying its non-budget identity, success, target, and safety fields and replacing its executable budget policy with the confirmed grant after validated unit mapping. For ccloop V1 the mapping is:

| Confirmed value | Derived/enforced value |
|---|---|
| work `tokens` | contract `tokenBudget`, exactly |
| work `activeMs` | contract `totalRuntimeBudgetMs`, exactly |
| work `attempts` | contract `maxAttempts`, exactly |
| work `sessions` | ControlStore claim/session bound; ccloop V1 has no corresponding contract field |
| original `perAttemptTimeoutMs` | `min(original perAttemptTimeoutMs, confirmed work activeMs)` |
| original `partialOutcomeRecoveryWindowMs` | `min(original recovery window, confirmed handoff activeMs)` |
| handoff token/attempt/session amounts | separate ControlStore handoff grant and claim bounds |

The derivation input must pass the closed `orca-task-contract-v1` schema. Identity, goal/success, workspace/target, safety, verification, and escalation fields are copied by their schema-defined names. The seven `executionPolicy` fields are handled only by the table above plus unchanged fixed literals such as `autonomyLevel` and `worktreeRequired`; an unknown or nested budget-like field is rejected at import instead of being copied ambiguously. All amounts are nonnegative JavaScript safe integers, tokens are integer tokens, time is integer milliseconds, and derivation performs no unit conversion. Every sum, subtraction, multiplication, ceiling, revision/sequence/ordinal increment, and cumulative lineage total is evaluated with arbitrary-precision integer arithmetic and rejected as `numeric-overflow` before persistence if its result is outside the safe-integer range. Reserve percentage uses exact integer division `ceil(base*20/100)` in that arithmetic; overflow never wraps or rounds through binary floating point.

For every budget dimension understood by the consumer, the derived policy must not permit more consumption than the confirmed task or handoff grant. If the contract schema and ControlStore claim boundary cannot statically represent the grant, confirmation fails with `execution-policy-unrepresentable`; it never leaves a larger or unrelated policy in place. Adapter proof is intentionally not fabricated at confirmation: a strict proposal may be confirmed against a soft profile for planning and audit, but start remains blocked until the selected profile observes complete bounded proof. A zero handoff attempt/session grant means the existing accepted run may perform only the mechanical in-run handoff described in Section 3.1; it does not authorize a new model attempt or session.

Each result is persisted as `{ schema:"orca-derived-contract-record-v1", originalContractHash, proposalVersion, confirmedGrant:{work,handoff}, derivationVersion:"orca-derived-contract-v1", contractCanonicalJson }`, with no unknown fields. `contractCanonicalJson` is the exact RFC 8785 UTF-8 text of the derived `orca-task-contract-v1` accepted by the already completed foundation validator; it is never regenerated from the mutable source. The `derivedContractHash` is lower-case hex SHA-256 of the canonical wrapper record, so test vectors need only the archived contract string rather than an unstated object layout. The scheduler and ccloop consumer receive that immutable contract string plus wrapper hash. Orca still enforces the same grant independently at the group claim and settlement layers. Thus the browser editor changes real execution authority without modifying the imported source or allowing the inner contract and outer grant to diverge.

`start` is an application command, not a direct alias for clearing `stopped`. It verifies:

1. the draft is confirmed;
2. plan and graph versions still match;
3. adapter capability satisfies the selected budget mode;
4. recovery is not blocked;
5. no stop intent forbids dispatch;
6. every estimate attempt is terminal, so an estimator run cannot overlap ordinary task dispatch.

After the common command-ID and revision checks in Section 4, composite start failures use this deterministic domain precedence: `group-state-invalid`, `plan-version-conflict`, `recovery-blocked`, `stop-mode-conflict`, `estimate-in-flight`, `profile-changed`, `control-capability-unsupported`, then `group-budget-unavailable`. A caller therefore receives one stable code for the same canonical state instead of whichever validation happened to run first.

Before committing start, the service probes the confirmed worker and handoff profiles that V1 will claim. A terminal estimator is not reprobed, and the deferred goal-review profile does not gate this Web slice. A failed or degraded required probe returns `control-capability-unsupported` with no command revision, wake, run, or session change. The start transaction then increments command revision once and writes a durable scheduler-wake outbox record identified as `scheduler-wake:<groupId>:<startRevision>`, where `startRevision` is the post-commit command revision. The HTTP handler never calls an `ExecutionPort` directly. After commit, the background scheduler delivers the wake, performs transactional claims, and uses existing deterministic start-envelope identities. Lost HTTP responses replay the command result; lost wake delivery is retried from the outbox. A soft-only adapter used with strict mode, or a selected profile whose hash/capability changed since confirmation, returns `control-capability-unsupported` or `profile-changed` without dispatch; the server never silently downgrades the group.

Before probing, every claim acquires a tracked admission permit from the same gate used by shutdown and holds it through claim commit or abort. It then performs a fresh capability probe before its transactional claim. If capability is unavailable but the profile hash frozen by import or confirmation is unchanged, the service creates no run, provider call, or session reservation. An estimator becomes terminal `blocked-capability`, releases its unused estimate commitment to reserve, records reason `estimate-blocked-capability`, and leaves the group `draft`. An ordinary work item remains `ready`, or a registered continuation remains `continuing`, with its commitment unchanged; the scheduler records group-local `claimBlocked` reason `claim-capability-unavailable` while leaving the coarse group state and stop intent unchanged. Other groups remain dispatchable. `recovery/retry` with group scope may clear the ordinary/continuation blocker only after the same frozen profile hash again supplies the required capability. If that profile hash changed, retry reports `profile-changed`; V1 cannot amend the post-start snapshot and the group remains locally blocked. A terminal estimator attempt is not automatically retried; the human creates a new estimate command after capability is restored.

A synchronous invalid-proof blocker has a stronger clearance predicate than an ordinary capability probe. The applicable recovery retry—group scope after an initial estimate/work attempt settled its run, run scope for a later attempt in an active run or for handoff—creates challenge hash `SHA-256(canonical({schema:"orca-proof-path-challenge-v1",groupId,commandId,profileHash}))` and requires the adapter, without invoking a provider, to return exactly `{schema:"orca-proof-path-self-test-v1",profileId,profileHash,proofScheme,proofVersion,evidenceKind,challengeHash,passed:true,observedAt}` with no unknown fields. The service validates every field against the frozen profile and current retry. Only that fresh self-test clears `request-bound-proof-invalid`; a generic healthy/capability response does not. Failure leaves the blocker unchanged and `resolved: false`.

After the fresh probe, every claim transaction creates the run in `starting`, moves the existing unclaimed grant into the active-run commitment without changing its total, reserves one session for that run, initializes `providerAttemptOrdinal: 0`, and persists the deterministic dispatch envelope. A session means one run/model conversation, not each provider retry. Before every provider invocation in that run, an atomic phase-attempt transition increments the positive safe-integer provider-attempt ordinal and reserves one attempt from the same phase bucket. A provider-start marker for the first accepted attempt moves the single session reservation plus that attempt reservation to `used`; later accepted attempt markers move only their own attempt reservation. Tokens and active time enter `used` only through accepted cumulative usage observations. A proved no-start result returns that attempt reservation and also returns the session reservation only when no earlier provider-start marker exists for the run/phase. Unknown outcome holds the relevant reservations. For a strict attempt, its marker must bind the attempt-specific verified request-bound proof, and the adapter must durably write that proof before any marker or provider call.

Proof generation, verification, and acknowledgement time before a provider-start marker does not consume `activeMs`; it is still constrained by any absolute wall-clock deadline. Active-time accounting starts at the marker and follows the adapter's accepted monotonic execution observations. Thus a failed-before-provider attempt charges no Amount dimension without extending a handoff deadline.

Each ordinary logical task stores nonnegative safe-integer `claimOrdinal`, initially zero before any run. After the capability probe, its claim transaction increments that ordinal, allocates a new persisted run ID, and uses identity `task:<groupId>:<startRevision>:<taskId>:attempt:<claimOrdinal>`. A competing/replayed claim observes the stored identity and cannot allocate another run. If that run settles failed-before-provider, the task returns to `ready`; the exact settlement or recovery wake below permits a later claim to increment the ordinal and allocate a different run ID. Ordinal overflow fails closed as `identity-space-exhausted`. Estimate and continuation identities remain the specialized identities defined in Sections 4.3 and 6.3.

If an attempt proof is synchronously present but invalid, verification returns `request-bound-proof-invalid` and the adapter proves that this provider attempt did not start. On the first attempt, the run settles `failed-before-provider`, returns its attempt and session reservations, and creates no global recovery uncertainty. An estimator becomes terminal `failed` and releases its unused estimate commitment to reserve; an ordinary task returns to `ready` with its commitment intact; a continuation stays `continuing` with its inherited commitment and continuation intent intact. On a later attempt after an earlier provider marker, only the new attempt reservation returns; the run remains active but phase-paused in `attempt-proof-invalid`, and the already used session is unchanged. In both cases the owning group receives a local `claimBlocked` reason until the applicable recovery retry passes the exact proof-path self-test defined above under the unchanged profile hash. Clearing a later-attempt blocker resumes the same run and the next invocation increments its provider-attempt ordinal; it does not allocate a new run.

A synchronous first-attempt settlement with a valid no-start proof is durably re-armed in that same settlement transaction whenever the group has no stop intent. For an ordinary task the transaction returns it to `ready` and writes `scheduler-wake:<groupId>:no-start:<runId>:<providerAttemptOrdinal>`; the next claim increments the task claim ordinal and allocates a new run. For a continuation it retains the checkpoint-bearing predecessor, increments the continuation claim ordinal, allocates a different `pendingRunId`, and writes the same wake identity; the failed proof-only run remains historical. The wake is unique and redeliverable, and its transaction commits before the failed run is considered settled. An unrelated group/global recovery blocker does not suppress this wake: delivery remains pending and is not acknowledged while claim admission is blocked, then recovery redelivers that same outbox after the last blocker clears. An estimator is terminal and receives no retry wake. If a stop intent is present, no no-start wake is written; the corresponding resume transaction later writes its already specified wake after re-arming the task. When no-start is first established inside a `recovery/retry` transaction, that transaction suppresses the `no-start` identity and writes only Section 7's `scheduler-wake:<groupId>:recovery:<commandId>`; that wake follows the same pending-until-all-blockers-clear rule and the state transition is otherwise identical. Thus exactly one wake is committed for either path and a crash cannot strand ready work.

If proof acknowledgement is lost, Orca instead sets a global recovery blocker and forbids another provider invocation. For the first attempt it returns typed `start-proof-outcome-unknown`, projects the run as `unknown` and work item/estimate as `start-unknown`; ordinary task or continuation also changes the coarse group state to `blocked`, retaining `blockedFrom: "running"`, while an estimator group remains `draft`. For a later attempt it projects the run as `attempt-unknown`, retains the logical work as active, and changes an ordinary group's coarse state to `blocked` with the same `blockedFrom`; the estimator group remains `draft`. It consumes no unproven attempt/session, retains the last-known commitment, and installs no user-clearable stop intent.

The proof handshake uses three closed, canonical records with unknown fields rejected:

```ts
type ProofAcceptedRecordV1 = {
  schema: "orca-proof-accepted-v1";
  runId: string; generation: number; phase: "estimate" | "work" | "handoff";
  providerAttemptOrdinal: number;
  artifactHash: string; dispatchEnvelopeHash: string; acceptedAt: string;
};
type ProviderStartMarkerV1 = {
  schema: "orca-provider-start-v1";
  runId: string; generation: number; phase: "estimate" | "work" | "handoff";
  artifactHash: string | null; dispatchEnvelopeHash: string;
  providerAttemptOrdinal: number; startedAt: string;
};
type NoProviderStartProofV1 = {
  schema: "orca-no-provider-start-v1";
  runId: string; generation: number; phase: "estimate" | "work" | "handoff";
  providerAttemptOrdinal: number;
  artifactHash: string | null; dispatchEnvelopeHash: string;
  adapterExecutionId: string; providerInvoked: false;
  terminalObservationHash: string; stopProofHash: string; observedAt: string;
};
type AdapterTerminalObservationV1 = {
  schema: "orca-adapter-terminal-observation-v1";
  adapterExecutionId: string; runId: string; generation: number;
  phase: "estimate" | "work" | "handoff"; providerAttemptOrdinal: number;
  state: "exited-before-provider"; exitCode: number | null; signal: string | null;
  finalJournalHash: string; observedAt: string;
};
type AdapterStopProofV1 = {
  schema: "orca-adapter-stop-proof-v1";
  adapterExecutionId: string; runId: string; generation: number;
  phase: "estimate" | "work" | "handoff"; providerAttemptOrdinal: number;
  providerStartMarkerPresent: false; processGroupStopped: true;
  finalJournalHash: string; stoppedAt: string;
};
```

`terminalObservationHash` and `stopProofHash` are SHA-256 of the canonical records above. All ordinals are positive safe integers; timestamps use Section 4's canonical UTC form. A soft phase uses `artifactHash: null`. Strict proof-accepted/start records require the verified artifact hash; a strict no-start proof records the submitted artifact hash even when invalid, or `null` if no artifact was durably received. Referenced terminal/stop records must have the hashes and exact adapter execution/run/generation/phase/attempt/journal bindings shown above. Proof verification/acknowledgement is not itself provider acceptance. The store permits at most one canonical record of each evidence type per `(runId, generation, phase, providerAttemptOrdinal)`: a byte-identical repeat is idempotent, while a divergent second record is contradictory evidence. Recovery evaluates each tuple in this strict precedence order:

A strict proof-accepted delivery uses deterministic identity `proof-ack:<runId>:<generation>:<phase>:<providerAttemptOrdinal>:<artifactHash>` and is durably outboxed with `ProofAcceptedRecordV1`; redelivery never creates a second acceptance record.

| Durable evidence | Only permitted result |
|---|---|
| any contradictory valid records, including both a start marker and no-start proof | remain unknown and globally dispatch-blocked |
| matching valid provider-start marker and no contradiction | provider start is accepted; charge the reserved attempt/session exactly once, then project the run through its observed running/terminal lifecycle |
| no start marker plus matching valid no-start proof | settle failed-before-provider without charging attempt/session |
| valid phase artifact and proof-accepted record, no start/no-start record, and the original adapter execution can still consume acknowledgement | remain `start-unknown`, redeliver that acknowledgement under the same run identity, and wait |
| any other absence, process observation, or incomplete combination | remain unknown and globally dispatch-blocked |

Mere absence of a provider-start marker never proves that the provider did not start. On an accepted marker, recovery charges that attempt and, only for the first marker in the phase, its reserved session. A first-attempt estimator leaves `start-unknown` for the observed run state while the group remains `draft`; task/continuation becomes active and the group returns from `blocked` to `blockedFrom`. A later `attempt-unknown` returns to the same active run. On proved no-start for the first attempt, the run's persisted terminal state is exactly `failed-before-provider`: estimator becomes terminal `failed` and returns its unused commitment, ordinary task returns to `ready`, continuation returns to `continuing` with the same checkpoint-bearing predecessor, and the group returns to its prior coarse state. On proved no-start for a later attempt, only that attempt reservation returns; the existing run becomes active again and may make a higher-ordinal attempt if budget remains. Recovery never substitutes a proof-only failed run as `predecessorRunId`. Any unresolved tuple remains globally dispatch-blocked. This recovery changes projection state, not command revision.

### 4.5 Group-limit changes

`set-limit` changes only the group ceiling and explicit unallocated reserve; it never changes a task grant, derived contract, estimator grant, or review reserve. Draft groups edit `proposedGroupLimit` through `proposal/edit`; `set-limit` is allowed only while the coarse group state is `ready`, `running`, or `review`. The orthogonal stop intent does not change that eligibility. The transaction rereads usage, reservations, unknown state, and all outstanding confirmed allocations. Unknown usage blocks a decrease. A new limit below the same conservation requirement used by confirmation returns `group-budget-unavailable`; a value identical to the current limit returns `422 no-op-command` without revision change. An increase creates capacity but does not allocate it to a task; a task grant changes only through proposal editing followed by a new confirmation before start, or through a separately specified future amendment flow. V1 does not amend grants after start commits.

### 4.6 Orthogonal state machines

The existing coarse group lifecycle remains `draft | ready | running | review | done | blocked`. Import creates `draft`, confirmation creates `ready`, start creates `running`, and an unrecoverable required recovery item may create `blocked`. Existing foundation rules continue to own `review` and `done`; this Web increment does not redefine group-goal acceptance.

Proposal state, stop intent, estimate state, and per-run presentation state are orthogonal projections, not additional coarse group states. Pause or handoff-stop does not rewrite `running` into a new invented group status; it sets a durable stop intent. A pre-dispatch proposal edit returns `ready` to `draft`. Resume clears the appropriate stop intent but does not skip the existing coarse lifecycle transition checks.

## 5. Budget draft and model estimate

Budget amounts retain their existing independent dimensions:

```ts
type Amount = {
  tokens: number;
  activeMs: number;
  attempts: number;
  sessions: number;
};
```

Single-session context occupancy remains separate from cumulative group and task token consumption.

### 5.1 `complex-1m` defaults

Each imported task receives this editable draft:

| Allocation | tokens | activeMs | attempts | sessions |
|---|---:|---:|---:|---:|
| Work | 3,000,000 | 14,400,000 (4h) | 3 | 3 |
| Handoff reserve | 300,000 | 1,800,000 (30m) | 0 | 0 |

The group-level defaults are:

| Allocation | tokens | activeMs | attempts | sessions |
|---|---:|---:|---:|---:|
| Goal-review reserve | 1,000,000 | 3,600,000 (1h) | 1 | 1 |
| Initial automatic estimate | 250,000 | 900,000 (15m) | 1 | 1 |

Goal review is reserved but not dispatched by this Web increment. When ordinary work reaches the existing `review` state, that commitment remains held for the later group-goal acceptance increment; V1 does not release it or move the group to `done` on the operator's behalf.

Context policy binds only the selected **worker** profile; estimator, handoff, and goal-review windows never validate the worker threshold. Its defaults are:

- `contextWindowTokens`: read from the selected trusted worker profile;
- `handoffAtContextTokens`: 80 percent of that declared window; the trusted `complex-1m` profile explicitly declares `1,000,000`, producing `800,000`.

The handoff threshold is editable, must be a positive safe integer, and cannot exceed the worker profile's context window. It is `null` when that window is unknown.

There is no anonymous 1M fallback. A worker profile with no trusted context-window declaration has unknown capacity and requires a `null` threshold. With `contextObservation: unavailable`, the UI marks occupancy unavailable; with `phase-end`, the threshold is advisory and crossing discovered at a phase boundary creates only a warning. Realtime adapters emit this closed record before each provider invocation:

```ts
type ContextObservationV1 = {
  schema: "orca-context-observation-v1";
  runId: string;
  generation: number;
  workerSessionOrdinal: number;
  sequence: number;
  occupiedInputTokens: number;
  requestMaxOutputTokens: number;
  tokenizerId: string;
  tokenizerVersion: string;
  observedAt: string;
};
```

`occupiedInputTokens` is the exact token count, under the tokenizer ID/version frozen in the worker profile, of the complete next provider-request input: system/developer/user/assistant/tool content, tool schemas, and framing are included; cached or cache-eligible input is still counted; the next response allowance and prior generated tokens not present in that request are excluded. It is current occupancy, not cumulative usage and not a provider-billed-token value. `requestMaxOutputTokens` is the exact output maximum that will be sent on that imminent request, must be a positive safe integer no greater than the frozen profile's `workMaxOutputTokens`, and the provider call must use that exact value. V1 permits exactly one worker conversation per run, so `workerSessionOrdinal` is exactly `1`; provider retries stay in that session and do not open or charge a second one. Continuation creates a new run/session. `sequence` is a positive safe integer beginning at `1`, and the store accepts only the next sequence. A byte-identical duplicate is idempotent. A divergent duplicate, gap, wrong tokenizer/output binding, a session ordinal other than `1`, or an observation from a stale generation records `context-observation-invalid`; a gap/divergence is fail-closed because a missed observation might have crossed the threshold, while a stale generation is rejected without affecting the current generation.

Occupancy may decrease after compaction. Crossing means the first accepted observation is at or above the threshold, or the previous accepted observation was below it and the current one is at or above it. A run/generation has one permanent crossing latch: once latched, later drops cannot create another automatic request. A gap/divergence latches it immediately with reason `context-observation-gap`. Independently, before every provider call the adapter must prove `occupiedInputTokens + requestMaxOutputTokens <= contextWindowTokens`; threshold handoff does not waive this hard fit check.

For `realtime`, the adapter emits and Orca accepts this observation before reserving the next work attempt. On the first crossing, that atomic transaction creates desired identity `context-handoff-request:<runId>:<generation>:<handoffAtContextTokens>`, freezes request `acceptedAt` and the same `acceptedAt + 30 minutes` default deadline used by handoff-stop, and suppresses the imminent work invocation: no work attempt is reserved, no work provider-start marker is written, and no further work-phase provider invocation is allowed for that run. It then dispatches the frozen handoff profile without setting a group stop intent or freezing other runs. Section 6.2's single-open-request join rule applies if a human or shutdown handoff already exists. The source logical task becomes `held` only after recoverable handoff settlement; it may then use the already specified direct continue endpoint, while ordinary scheduling cannot claim it. Duplicate observations replay the same request or join identity. A failed/unknown automatic handoff follows Section 6 evidence states and never appears successful. Missing context metadata never becomes an optimistic capability.

For `phase-end`, the adapter emits the same `ContextObservationV1` exactly once after the terminal work observation, with `sequence: 1`; it serializes the retained conversation exactly as the input of a hypothetical next request and uses the frozen profile's `workMaxOutputTokens`. Orca applies the same tokenizer/binding validation but records only `context-threshold-advisory` when the value is at or above the threshold. It creates no handoff request, reserves no attempt, and does not affect recoverability. Further phase-end context observations for that run/generation are schema-invalid. `unavailable` emits no record.

The initial group limit is calculated component-wise as:

```text
estimate grant
+ goal-review reserve
+ sum(task work + task handoff)
+ 20% explicit unallocated reserve
```

The reserve calculation is exact and component-wise:

```text
base = estimate grant + goal-review reserve + sum(task work + task handoff)
unallocatedReserve[dimension] = ceil(base[dimension] * 20 / 100)
groupLimit = base + unallocatedReserve
```

The reserve is displayed separately and is not disguised as a task allocation. A group with five imported tasks therefore starts with a token limit of 21,300,000:

```text
250,000 + 1,000,000 + 5 * (3,000,000 + 300,000) = 17,750,000
17,750,000 * 1.20 = 21,300,000
```

No wall-clock deadline is set by default. The human may add one separately.

#### 5.1.1 Conservation ledger

While a group is draft, persisted proposal allocations are **capacity encumbrances**, not execution grants. They reserve group capacity so estimator re-runs cannot spend the task and goal-review budget, but the claim layer still rejects them. Unsaved browser values are only a preview; `proposal/edit` atomically replaces the affected encumbrances. Confirmation reclassifies the same task/goal-review encumbrances as executable commitments without adding them a second time.

Confirmation, `set-limit`, new estimate creation, claims, settlement, and continuation use the same component-wise admission calculation:

```text
requiredLimit = used + sum(committedRemaining) + explicitUnallocatedReserve
requiredLimit <= groupLimit
```

For a normal committed state, reserve is the actual residual capacity and equality holds. A proposal that edits reserve or limit must make them consistent before confirmation. Because a soft adapter can report known usage above the limit, the store also derives a nonnegative breach rather than inventing a negative reserve:

```text
explicitUnallocatedReserve = max(groupLimit - used - sum(committedRemaining), 0)
budgetDeficit = max(used + sum(committedRemaining) - groupLimit, 0)
```

`budgetDeficit` is zero for every admitted authority change. A later soft overrun may make it positive and blocks that group as described in Section 6.3.

Each logical allocation has exactly one commitment entry, so the sum cannot count both a grant and its reservation:

| Allocation state | `committedRemaining` |
|---|---|
| persisted draft task/handoff or goal-review proposal | full `draft-encumbered` amount; consumes capacity but is not claimable |
| confirmed but unclaimed task work/handoff, queued estimate, or remaining goal review | its full unconsumed allocation, with work and handoff kept as separate buckets |
| active run | each bucket's grant minus its settled known cumulative usage |
| recoverable, `held`, or `continuing` work | each predecessor bucket's grant minus settled cumulative usage; buckets are never pooled |
| terminal settled work or settled estimate | zero; its consumption is already in `used` |
| known settled soft overrun | zero after complete settlement; actual consumption remains in `used`, the logical work is blocked, and no continuation is created |
| unknown usage or a sequence gap | no numeric `requiredLimit` is asserted; the last-known unconsumed remainder stays reserved and every operation requiring capacity or continuation is blocked until recovery resolves actual usage |

Every transition is an atomic component-wise transfer:

- allocating new work moves the full grant from `explicitUnallocatedReserve` to one commitment;
- editing a persisted draft allocation moves only its component-wise delta between `draft-encumbered` and explicit reserve;
- confirmation reclassifies draft encumbrances as confirmed commitments with no capacity change;
- recording known usage moves the delta from that commitment to `used`;
- a recoverable settlement transfers the remaining work and handoff buckets to the held lineage commitment;
- terminal settlement moves any known unused remainder back to `explicitUnallocatedReserve`; a known overrun consumes reserve first and records any excess as `budgetDeficit`;
- continuation transfers the held remainder to the new run; it does not create a second allocation;
- re-estimation uses the same reserve-to-commitment transfer and fails if any reserve dimension is insufficient;
- `set-limit` changes reserve by exactly `newLimit - oldLimit` and rejects the command if any resulting reserve dimension would be negative.

Retries inside one run consume the same commitment rather than creating a second one. The stored `reserved` aggregate must equal the sum of currently held commitments; it is a derived consistency check, not an additional term in `requiredLimit`. With known usage, `used + commitments + explicitUnallocatedReserve == groupLimit + budgetDeficit`. Any unexplained mismatch is a recovery blocker.

### 5.2 Draft state model

Proposal authority and estimator progress are independent so a human edit can occur while an estimate is running:

```text
proposalState: editable | confirmed
proposalVersion: positive integer
hasHumanEdits: boolean, derived from field provenance

estimateState per estimateId:
  queued | running | start-unknown | ready | failed | interrupted | blocked-capability | input-too-large
```

Persisted state values omit the API-code prefix. The corresponding typed API/error codes are `estimate-blocked-capability` and `estimate-input-too-large`.

`queued`, `running`, and `start-unknown` are nonterminal. `ready`, `failed`, `interrupted`, `blocked-capability`, and `input-too-large` are terminal. Start requires every estimate attempt to be terminal; `start-unknown` additionally participates in the global recovery block described in Section 4.4.

Import creates proposal version 1 in `editable`. Every proposal edit creates the next version. Estimate completion changes only its own estimate state and projection sequence. Confirmation changes `proposalState` to `confirmed`; a permitted pre-dispatch edit invalidates that confirmation and returns it to `editable`.

The group remains `draft` until confirmation. While a group is draft, the claim layer—not merely the scheduler—rejects ordinary tasks, decomposition, reconciliation, memory, and goal review. Only an authorized `budget-estimate` work item may be claimed.

### 5.3 Accounted automatic estimate

`budget-estimate` becomes an explicit work kind. The imported draft registers one fixed-grant estimate item. After the import transaction commits, the service attempts to claim and execute it through the same ControlStore accounting path and the profile-routed ccloop execution protocol used by ordinary work. The estimator may resolve to a distinct trusted port. It has a group ID, work item ID, run ID, evidence, usage, and the 250,000-token/15-minute/one-attempt/one-session grant above.

There is no direct, unaccounted model call from Panel code.

The trusted estimator profile is distinct from a task worker profile and is selected through the server-side `ExecutionProfileRouter`. Under the default strict draft mode, the automatic estimate may run only if the profile declares a complete bounded proof scheme and the claim emits and verifies its request-bound artifact before provider invocation. If only a soft or proof-incomplete estimator is available, the state becomes `estimate-blocked-capability`; no model call occurs. A human may explicitly select soft mode and retry, but the product must not silently weaken strict mode merely to obtain an estimate.

This distinction resolves the current Codex limitation: Codex remains `usageObservation: phase-end` plus `budgetEnforcement: soft`, so it cannot satisfy a strict estimate or strict task start. A bounded estimator profile may still estimate a strict draft; later task start remains independently gated by the worker adapter capability.

Estimate failure or capability blocking does not prevent the human from confirming the static defaults or edited values.

### 5.4 Estimate schema and validation

Before a model call, the service builds this closed request:

```ts
type BudgetEstimateRequestV1 = {
  schema: "budget-estimate-request-v1";
  planHash: string;
  planSnapshotCanonicalJson: string;
  estimatorProfile: ProfileBindingV1;
  estimatorCapabilities: {
    contextWindowTokens: number;
    usageObservation: "realtime" | "phase-end" | "unavailable";
    budgetEnforcement: "bounded" | "soft" | "unavailable";
    contextObservation: "realtime" | "phase-end" | "unavailable";
  };
  responseSchemaVersion: "budget-estimate-v1";
  instructionVersion: string;
};
```

`planSnapshotCanonicalJson` is the exact UTF-8 decoding of the already archived canonical `orca-control-plan-v1` bytes, which contain the normalized goal, success conditions, task contracts, and dependency graph; re-serialization from mutable objects is forbidden. Its exact UTF-8 bytes must hash to `planHash`. Unknown fields are rejected. `requestHash` means lower-case hex SHA-256 of the RFC 8785 canonical bytes of `BudgetEstimateRequestV1`. Those exact request bytes and versions are passed to the adapter and recorded in run evidence; an adapter may not rebuild a semantically similar prompt behind the preflight boundary.

Estimator capabilities freeze at estimate creation, including the automatic estimate inside import. The service performs a fresh probe before that transaction and computes the effective values from the selected profile's trusted declaration and that observation: context window is the lesser non-null value (either null blocks the estimate); `usageObservation` and `contextObservation` use the weaker value under `unavailable < phase-end < realtime`; `budgetEnforcement` uses `unavailable < soft < bounded`. Those exact effective values enter `BudgetEstimateRequestV1`, its request hash, and `EstimateExecutionContractV1`. The later claim-time probe must have the same profile hash, a context window greater than or equal to the frozen value, and capabilities at least as strong as every frozen value. A weaker or smaller observation creates no provider attempt, marks the estimate `blocked-capability` with `estimate-capability-degraded`, releases its unused estimate commitment, and does not rebuild the request or request hash. A stronger observation still executes the frozen request. Thus runtime degradation cannot silently change preflight or attempt identity.

The trusted estimator profile supplies every preflight constant. The `complex-1m` estimator profile defaults `maxOutputTokens` to 64,000; the operator may change it only in trusted startup configuration. There is no browser override. Token accounting is:

```text
serializedInputTokens =
  exactTokenizer(canonicalRequestBytes)
  OR ceil(utf8ByteLength * numerator / denominator)

inputTokens = serializedInputTokens + framingTokenOverhead
requiredRequestTokens = inputTokens + maxOutputTokens
```

The upper-bound tokenizer option is legal only when the trusted profile pins its rational bound and a `proofRef`; there is no global bytes-per-token guess. Exact tokenizer ID/version, upper-bound parameters, instruction version, schema version, framing overhead, and maximum output are part of the attempt identity and evidence.

A profile without a trusted context window or estimator preflight block is `estimate-blocked-capability`. Otherwise the service rejects the attempt as `estimate-input-too-large` unless both of these exact inequalities hold:

```text
requiredRequestTokens <= contextWindowTokens
requiredRequestTokens <= estimateGrant.tokens
```

The adapter request sets its output maximum to `maxOutputTokens`. The estimate grant counts input, output, and declared framing overhead. Active time, attempt count, and session count are enforced by the ordinary claim/run boundary, not predicted by this size calculation. Soft mode still performs the same hard context-fit preflight, but the grant remains a visibly soft runtime control because the adapter lacks request-bound enforcement proof.

V1 does not silently truncate or summarize estimator input. It also does not split one estimate into hidden unaccounted calls. A later chunked estimator must model every chunk and reduction as separately granted, group-accounted work items. Re-estimation performs the same preflight and must fit existing free group capacity; it cannot raise the group limit automatically.

After this preflight, the estimator reads the complete archived normalized snapshot and returns this closed structured record:

```ts
type BudgetEstimateV1 = {
  schema: "budget-estimate-v1";
  planHash: string;
  tasks: Array<{
    taskId: string;
    complexity: "S" | "M" | "L" | "XL";
    confidence: "low" | "medium" | "high";
    work: Amount;
    handoff: Amount;
    rationale: string;
    assumptions: string[];
  }>;
  goalReviewReserve: Amount;
  groupRationale: string;
};
```

The task array is sorted lexicographically by `taskId`; assumptions preserve model order and must be nonempty, duplicate-free strings. `outputHash` is lower-case hex SHA-256 of the RFC 8785 canonical bytes of `BudgetEstimateV1`. A ready `EstimateViewV1` returns both that immutable value and hash, so a reloaded browser can display or apply every suggestion without reading raw evidence. Non-ready estimates return both fields as `null`.

For example:

```json
{
  "schema": "budget-estimate-v1",
  "planHash": "sha256",
  "tasks": [
    {
      "taskId": "task-id",
      "complexity": "S|M|L|XL",
      "confidence": "low|medium|high",
      "work": {
        "tokens": 4500000,
        "activeMs": 21600000,
        "attempts": 4,
        "sessions": 4
      },
      "handoff": {
        "tokens": 400000,
        "activeMs": 2400000,
        "attempts": 0,
        "sessions": 0
      },
      "rationale": "...",
      "assumptions": ["..."]
    }
  ],
  "goalReviewReserve": {
    "tokens": 1000000,
    "activeMs": 3600000,
    "attempts": 1,
    "sessions": 1
  },
  "groupRationale": "..."
}
```

The service validates that:

- `planHash` still matches;
- every imported task appears exactly once and no extra task appears;
- amounts contain safe non-negative integers;
- the estimate changes no contract, identity, dependency, target version, or config hash.

Invalid output rejects the entire estimate. The service does not partially apply a parseable subset.

### 5.5 Model advice never overwrites authority

Each estimate is stored as an immutable, versioned `BudgetEstimate`. It is separate from the editable proposal. Each UI field shows its current value, model suggestion, and provenance (`complex-1m-default`, `model`, or `human`).

The human may apply one field, one task, all suggestions, arbitrary valid values, or restore defaults. Human-edited fields are never overwritten when an in-flight estimate completes. A suggestion above the current group limit is shown with the required delta; only an explicit proposal edit carrying the corresponding limit change may reserve that capacity.

Confirmation, rather than estimator-output parsing, validates the selected context threshold against the frozen worker profile's declaration and context-observation capability.

The first eligible estimate runs automatically. Re-estimation is an explicit action that creates a new versioned work item and consumes a new accounted grant. Older estimates and their evidence are retained.

Model estimates are planning advice. They are never accepted as the request-bound proof required for strict enforcement and are never converted into an estimated dollar cost.

## 6. Pause, handoff-stop, and continuation

V1 exposes only pause-dispatch and handoff-stop. It does not expose immediate kill as a successful control operation.

Stop-command composition is closed. After same-command replay checks: `pause-dispatch` is accepted only with no stop intent; an existing pause returns `409 stop-already-active`, and shutdown/human handoff returns `409 stop-mode-conflict`. `handoff-stop` is accepted with no intent or may atomically strengthen a pause; an existing human handoff or unresolved/completed-but-uncleared shutdown returns `409 stop-already-active` or `stop-mode-conflict` respectively and never replaces deadlines/frozen sets. `resume-dispatch` clears only pause. `resume-from-handoff` clears only completed human/shutdown handoff. A new command ID never turns an existing stop into an implicit no-op; the original command ID alone replays.

### 6.1 Pause dispatch

`pause-dispatch` transactionally records `stopped: true` and a `mode: pause` stop intent. It prevents every new claim, including ordinary work, estimation, decomposition, and continuation. Already accepted runs continue. The UI shows the count and identity of active runs.

The stop intent survives browser reload and Panel restart. Only an explicit resume command clears it.

### 6.2 Handoff-stop

For stop/shutdown freezing, an **active run** is any claimed nonterminal run in `starting`, provider-attempt `unknown`/work-item `start-unknown`/`attempt-unknown`/`attempt-proof-invalid`, accepted/running, or handoff request-pending/latched/collecting/outcome-unknown state. A terminal `failed-before-provider` run is not active. Thus a start/attempt-unknown estimate or task is always included in the frozen set; its stop entry remains `outcome-unknown` until the Section 4.4 attempt truth table and ordinary stop/usage evidence both resolve. It can never make an empty frozen set vacuously complete.

There is at most one open handoff execution request per `(runId, generation)` across context, human, and shutdown origins. “Open” means `request-pending`, `latched`, `collecting`, or `outcome-unknown`. Creating a desired request while one is open atomically writes this closed record instead of another execution request/outbox:

```ts
type HandoffJoinV1 = {
  schema: "orca-handoff-join-v1";
  joinId: string;
  desiredRequestId: string;
  existingRequestId: string;
  runId: string;
  generation: number;
  origin: "context" | "human" | "shutdown";
  effectiveDeadlineAt: string;
  createdAt: string;
};
```

`joinId` is `handoff-join:<desiredRequestId>:<existingRequestId>`. The existing request remains the canonical execution/accounting/checkpoint identity; its effective deadline becomes the earlier of its current deadline and the desired deadline and is never extended. Its accepted profile, phase-attempt ordinal, reservations, evidence state, and provider session are unchanged. A byte-identical join replays; a different mapping for the same desired identity is a recovery blocker.

Therefore a human/shutdown stop that freezes a run with an open context handoff adopts that request's current state and creates no second model call, attempt/session reservation, or checkpoint producer. Its command result lists the canonical existing request ID, while recovery also verifies the deterministic join record for the desired stop identity. Conversely, a context crossing during an open human/shutdown request joins that request and creates no new outbox. A settled request is not open: a recoverably settled context handoff has already made the task `held` and is no longer an active run to freeze; any contradictory active/settled combination is a recovery blocker rather than permission to create a second request.

`handoff-stop` resolves and freezes the active run IDs, then commits all of the following in one ControlStore transaction:

- `stopped: true` and the typed group stop intent;
- the frozen active-run set and stop command revision;
- one deterministic desired handoff identity for every frozen run and either its new request/outbox or the deterministic join record to that run's existing open request;
- the persisted command result.

No externally visible stop latch may commit without its complete request/outbox-or-join set. `stopRevision` is the post-commit command revision. After commit, the HTTP request returns `202`; delivery and collection occur in the background. A response-lost replay of the same command returns the persisted result. Recovery verifies the intent against the frozen set. If all deterministic request data is present, it may reconstruct an outbox record left by an older schema; otherwise inconsistent intent/request/join state is a recovery blocker. It never treats the latch alone as a completed request.

The operator supplies an RFC 3339 UTC `handoffDeadlineAt` within the platform timestamp range or omits it. On the first successful command application, the server freezes `acceptedAt` at transaction commit and expands an omitted deadline to `acceptedAt + 30 minutes`; if that addition exceeds the maximum protocol instant, it saturates to `9999-12-31T23:59:59.999Z` and the monotonic duration is shortened to that representable difference. Both timestamps are persisted in the canonical command result, so replay does not recompute them. A supplied past deadline is valid and expires immediately. The process freezes a monotonic remaining duration `max(handoffDeadlineAt - acceptedAt, 0)` at commit, so later wall-clock rollback cannot extend a live process; restart compares the persisted absolute instant fail-closed against its current wall clock. Independently, each run retains its remaining handoff `activeMs` budget. These values use different clocks and are never substituted or compared as quantities. Handoff work must satisfy both limits and stops when either its absolute deadline is reached or its active-time budget is exhausted. A newly created request uses a deterministic identity:

```text
handoff-stop:<groupId>:<stopRevision>:<runId>
```

Per-run presentation states are:

```text
request-pending
latched
collecting
settled-recoverable
settled-restartable
settled-unrecoverable
outcome-unknown
```

For `model-assisted-v1`, delivery performs a fresh probe of the frozen handoff profile immediately before each handoff provider attempt; the earlier start/work probe is insufficient. Capability failure creates no attempt or reservation, leaves the deterministic request `request-pending` with typed reason `handoff-capability-unavailable`, and is retryable only by run-scoped recovery. A changed profile hash instead records `profile-changed`; V1 cannot amend it and the request becomes `settled-unrecoverable`. Each atomic attempt increments positive safe-integer `phaseAttemptOrdinal` (the artifact's `providerAttemptOrdinal`), reserves one attempt, and on the first attempt with no prior handoff provider marker also reserves one handoff session. It uses claim identity `<handoffRequestId>:attempt:<phaseAttemptOrdinal>` in `DispatchEnvelopeV1`. Proof verification precedes the marker/call. A matching first marker charges the attempt and session; later markers charge only their attempt. Handoff token/active-time observations then transfer from the handoff commitment to group used.

A synchronous invalid handoff proof returns its attempt reservation and any not-yet-charged handoff session, leaves the request `request-pending` with `request-bound-proof-invalid`, and requires the same proof-path self-test under run-scoped retry. Lost proof acknowledgement makes the request `outcome-unknown`; the attempt-specific Section 4.4 evidence records and precedence apply with `phase: "handoff"`. A proved no-start result returns the same reservations. If the absolute/active-time and remaining attempt/session grants still permit retry, successful run-scoped recovery writes `handoff-recovery:<handoffRequestId>:<commandId>` and requeues the same deterministic handoff request; the next atomic attempt increments the ordinal. A pre-attempt capability failure had not incremented it. Otherwise the request becomes `settled-unrecoverable`. Phase ordinal overflow also settles unrecoverable with `identity-space-exhausted`. `mechanical-in-run-v1` performs none of these provider attempt/session transitions and retains its statically zero provider authority.

Group stop state is derived by this precedence:

- `handoff-unresolved` if any frozen run is `outcome-unknown`;
- otherwise `handoff-pending` if any frozen run is pending, latched, or collecting;
- otherwise `handoff-partial` if any frozen run is settled-unrecoverable;
- otherwise `handoff-complete` when every frozen run is settled-recoverable or settled-restartable, including the vacuous case of an empty frozen set.

Within this Web slice, `budget-estimate` is the only auxiliary work kind that may be active. Goal review, automatic decomposition, reconciliation, and memory/correction are not dispatched here. An interrupted estimator is never continued from a task checkpoint: after complete stop proof and usage settlement it becomes `settled-restartable`, its estimate state becomes `interrupted`, and its known unused commitment returns to unallocated reserve. Unknown estimator usage remains unresolved. `resume-from-handoff` automatically validates these auxiliary dispositions; its task-selection array contains task runs only. After the stop clears, the human may create a new accounted estimate if the group is still draft or pre-start ready.

A run is recoverable only when the existing control invariants prove all of the following:

- matching execution/generation stop proof;
- settled work and handoff usage without sequence gaps;
- no unresolved handoff request ID;
- complete checkpoint and snapshot;
- verified hashes for all referenced evidence.

At either the absolute deadline or active-time boundary, ccloop may abort the active phase and recover the process group, including SIGKILL where its already verified boundary requires it. Orca retains all available mechanical evidence. Missing proof or usage leaves the run partial or unknown and its reserve held. The Web UI must not render that state as a successful handoff.

### 6.3 Resume and continuation

For a simple pause, `resume-dispatch` validates the group command revision and freshly probes the frozen worker/handoff profiles needed by pending tasks. Its single transaction clears only a `mode: pause` intent and writes durable `scheduler-wake:<groupId>:<resumeRevision>`, where `resumeRevision` is the post-commit command revision; response/wake loss replays or redelivers that identity. It rejects a handoff or shutdown intent with `stop-mode-conflict`; profile/capability failure makes no mutation. Claims probe again after wake.

After a human handoff-stop or a recovered shutdown stop, the resume dialog classifies tasks as completed, recoverable, unrecoverable, or unresolved. `resume-from-handoff` is available only when group stop state is `handoff-complete`; partial or unresolved groups remain stopped. The human selects recoverable unfinished tasks and sends one command with the current command revision and an array of `{ taskId, predecessorRunId, checkpointId }`. The server rejects duplicate task IDs and any selected identity that does not exactly match the canonical recoverable predecessor. The command then atomically:

1. validates every selected predecessor;
2. validates graph, target, contract, and config identities;
3. calculates inherited remaining grants;
4. checks group capacity;
5. registers all selected continuation claims;
6. marks unselected recoverable unfinished tasks as `held`, so neither they nor dependencies that require them can be claimed;
7. clears the stop intent.

The transaction is all-or-nothing. Its post-commit revision is `resumeRevision`. Before commit it probes the selected continuations' frozen worker/handoff profiles; failure returns the normal start capability/profile error with no mutation, and claim still probes again after wake. Each selected continuation intent is identified as `continuation:<groupId>:<resumeRevision>:<taskId>:<predecessorRunId>`, and the wake is `scheduler-wake:<groupId>:<resumeRevision>`. It also allocates and persists one new `pendingRunId` and `claimOrdinal: 1` per selection in the command result; that ID must differ from every lineage member and is stable across response/wake replay. The concrete claim-attempt identity is `<continuationIntentId>:attempt:<claimOrdinal>`. In the same transaction, each selected task's existing commitment row changes owner state from `held` to `continuing` without changing its work/handoff bucket values; no second row is created. Selected source work items move to `continuing` and unselected recoverable unfinished items remain `held`; the ordinary scheduler may claim neither state through its normal ready-work path. The transaction then clears the handoff stop intent. Wake delivery attempts registered continuations in request-array order, then ordinary ready work in the existing scheduler order. The first pre-claim failure installs the group-wide local blocker and stops further claims in that group; already accepted runs continue, but later continuations and ordinary work wait for group recovery. Held items and their unsatisfied dependents remain ineligible. Response loss replays the command result and creates no duplicate claims. If the frozen set was empty, an empty selection is valid and simply clears the completed stop.

A direct per-task `continue` endpoint is available only when the group is already dispatch-enabled. It first performs the same frozen worker/handoff profile probe as batch resume. Its post-commit revision is `continueRevision`; it atomically changes one `held` task to `continuing`, creates `continuation:<groupId>:<continueRevision>:<taskId>:<predecessorRunId>` with a new persisted `pendingRunId` and `claimOrdinal: 1`, writes `scheduler-wake:<groupId>:<continueRevision>`, transfers the held commitment, and performs the same predecessor checks. It cannot bypass a group stop intent, and claim probes again after wake.

A continuation grant is the predecessor grant minus its settled cumulative work and handoff usage. The subtraction is allowed only when usage is known and every cumulative dimension is less than or equal to the corresponding grant. If a soft run overruns any dimension, complete settlement records actual usage, terminates that allocation's commitment, returns any known unused values in the other dimensions to reserve, marks the logical task and coarse group `blocked`, sets group-local `stopped: true` with typed block reason `budget-overrun`, and creates no continuation or negative Amount. This known breach does not globally block unrelated groups, but V1 provides no command to clear it or amend the grant after dispatch. Historical group usage is not reset, and consumed handoff reserve is not restored. Continuation does not infer state from a mutable old work directory.

The original task work item is the logical scheduler node across all runs. It stores `currentRunId`, an ordered lineage of ControlStore-created run IDs, and at most one continuation `pendingRunId`; continuation does not create a second dependency node. Registering continuation leaves `currentRunId` and lineage pointing at the settled predecessor. After the fresh capability probe succeeds, the claim transaction consumes `pendingRunId`, creates that run under the current claim-attempt identity, appends it exactly once to lineage, and sets it as `currentRunId`. Capability failure before claim changes none of those fields, so retry reuses the unconsumed pending ID and ordinal. A failed-before-provider run remains historical in lineage, while settlement returns the logical item to `ready` or `continuing`. When recovery re-arms a continuing intent after such a settled run, it atomically increments `claimOrdinal`, allocates a different pending run ID, and writes a durable recovery wake; it never reuses the failed run or claim-attempt identity. Continuation ordinals are positive safe integers; overflow blocks as `identity-space-exhausted`. The final successful or terminal run remains `currentRunId`, so post-settlement evidence does not point backward to its predecessor. Usage from each run is added once to group `used` and to the task lineage total. On continuation settlement, one transaction:

- marks the logical task `completed`, returns known unused remainder to reserve, and reevaluates dependent readiness when the result succeeds;
- or records the new recoverable `currentRunId` and transfers its remaining commitment to `held` when another verified continuation is possible;
- or marks the logical task and its dependents `blocked`, returns known unused remainder after complete settlement, and retains evidence when it is terminal or unrecoverable.

Dependency checks always read logical task status, not an individual historical run. Settlement writes any newly eligible ready-work projection and scheduler wake in the same transaction, so restart cannot leave a completed predecessor with permanently stale dependents.

### 6.4 Panel shutdown

Closing the browser never initiates shutdown.

On a normal Panel termination signal, the service:

1. freezes `shutdownAcceptedAt` from the wall clock and a corresponding monotonic deadline, computes `shutdownDeadlineAt = shutdownAcceptedAt + configuredShutdownGrace` with the same maximum-instant saturation rule as Section 6.2, closes an in-memory admission gate shared by HTTP mutations and scheduler claims, and enters draining mode;
2. waits behind the single-writer barrier for every mutation/claim transaction admitted before the gate to commit or abort, then opens one ControlStore transaction identified by `shutdown:<epoch>` and scans every nonterminal group; no new writer can pass the gate before that transaction commits;
3. for every group with active runs—including a paused group—persists or strengthens its stop intent, freezes the active-run set, and writes each deterministic request/outbox or the Section 6.2 join to that run's existing open request; for a dispatch-enabled group with no active run, persists a shutdown stop intent so no claim can begin during drain;
4. records the closed `CommandSuccessV1` shutdown variant containing every scanned group and commits it with all group changes;
5. begins delivery of the committed `reason: shutdown` outbox records;
6. waits only until the already frozen `shutdownDeadlineAt`, whose default grace is two minutes;
7. closes HTTP and ControlStore.

The global ledger key and command ID are both `shutdown:<epoch>` and the command preimage is exactly the internal shutdown `AuthorityCommandV1` defined in Section 4. For a group whose authority changes, the transaction increments command revision once; that post-commit value is `shutdownRevision`. Per-run desired request identity is `shutdown:<groupId>:<shutdownRevision>:<runId>`. The shutdown result's group array is lexicographically sorted and records changed and unchanged dispositions, post-transaction revisions/projections, exact frozen run IDs, canonical execution request IDs after joins, and any blocker. A crash before the global transaction commits leaves no shutdown latch and ordinary startup recovery handles the abandoned processes. A crash after commit finds this complete cross-group result and redelivers only its existing outboxes; there is no between-groups partial shutdown state.

A group already under a stronger human handoff-stop is listed in the global shutdown result but is not mutated: its command revision, projection sequence, frozen set, deadline, and outboxes remain unchanged. An unresolved equal-strength shutdown intent is likewise preserved byte-for-byte and only its existing outboxes are redelivered; a new epoch never extends its deadline, replaces its frozen set, or creates new per-run identities. If the scan finds an active run outside either preserved frozen set, the global transaction still commits other groups and records `shutdown-frozen-set-inconsistent` as a global recovery blocker for the affected group; it does not alter that intent or invent a request. The affected command revision stays fixed, its projection advances once for the new blocker, and process exit/restart remains fail-closed. A ready group with no active run receives a shutdown intent with an empty frozen set, reaches `handoff-complete`, and after restart uses an empty `resume-from-handoff` followed by an explicit `start`. A paused group with no active run is also listed but remains an unchanged pause and later uses `resume-dispatch`; shutdown strengthens a pause only when an active run must be stopped.

Each newly created shutdown request uses exactly the frozen `shutdownDeadlineAt` and separately retains the run's remaining handoff active-time budget. Transaction and initial-delivery time consume the same configured grace; they do not restart its clock. Runtime waiting uses the frozen monotonic deadline, so a later wall-clock jump cannot extend it; the persisted RFC 3339 value is for cross-process recovery/display, where expiry is fail-closed if the wall clock has reached it. `configuredShutdownGrace` is a positive safe integer in milliseconds validated at startup; its default is `120000`. The grace is not presented as the task's full handoff allowance, and the two clocks are not converted into one another. Unfinished requests remain durable for next-start recovery. A second interrupt may exit immediately, but the terminal must warn that the next start may be recovery-blocked.

During draining, authenticated reads remain available until HTTP closes. Every newly arriving mutation returns `503 panel-draining` and every scheduler claim is refused before opening a transaction. The global shutdown result is stored only in the global command ledger; unchanged paused/human-handoff/equal-shutdown groups do not receive a per-group recent-command entry and therefore do not advance projection state.

Stop-intent strength is `pause < shutdown < human handoff-stop` for internal shutdown preservation and evidence display. Shutdown may strengthen a pause but never replaces an existing human handoff-stop; browser handoff may strengthen a pause but cannot replace an unresolved or uncleared shutdown. No replacement changes an existing frozen set, identity, or deadline.

### 6.5 UI language

The UI distinguishes:

- safely stopped and continuable;
- stopped with an incomplete checkpoint;
- execution stop outcome unknown;
- usage unsettled and reserve retained;
- recovery required and new dispatch blocked.

It must not collapse these states into a generic green `Stopped`, offer a force-success action, or show immediate process recovery as a complete handoff.

## 7. Recovery operations

`GET /api/control/recovery` shows each blocked run, missing evidence, unsettled usage, ccloop terminal observation, and typed reason. `POST /api/control/recovery/retry` takes the normative `RecoveryRetryPayload` inside the common command envelope and reruns only that run's or group's existing mechanical recovery and projection logic idempotently. Run scope is valid only for one retained run with recovery/start-or-attempt-proof uncertainty or a retryable model-assisted handoff blocker; it is the only scope that evaluates or redelivers phase acknowledgement for `start-unknown`/`attempt-unknown`/`outcome-unknown`. Group scope covers every group-local initial-claim capability/proof blocker plus consistency checks; it reports any global run blockers in that group but does not recursively retry them. Local blockers suppress every new claim in their group. Group retry evaluates all local blockers, then in one transaction either clears all of them and writes one recovery wake, or clears none and returns their individual reasons. Partial clearance is forbidden. `resolved: true` means no blocker remains in the requested run/group scope after that transaction; `false` means at least one remains. Unknown scope, mismatched ownership, or a run with no retryable condition returns a typed validation error rather than widening the scan. A later deliberate observation attempt uses a new command ID; reuse of the same ID after a lost response replays its earlier observation result.

Retry does not invoke a provider inline. A run-scoped retry may redeliver the already persisted attempt-specific proof-accepted acknowledgement to the original adapter execution; this is not a new claim and retains the original run identity. When it observes a matching provider-start marker, that attempt continues through the same run. When a later work attempt is proved no-start or its invalid-proof self-test clears, the transaction writes `attempt-recovery:<runId>:<generation>:<phase>:<commandId>` and resumes the same run; any next invocation uses a higher provider-attempt ordinal. Initial failed-before-provider or cleared pre-claim ordinary/continuation work instead re-arms with `scheduler-wake:<groupId>:recovery:<commandId>`. A pre-claim capability failure created no run; ordinary work remains ready for a fresh claim, while continuation reuses its unconsumed pending run ID and ordinal. A continuation run already created and settled failed-before-provider retains the original checkpoint-bearing `predecessorRunId`, increments claim ordinal, and allocates a new pending run ID. An ordinary task returns to its existing logical allocation and receives a fresh claim through the scheduler wake. Handoff run retries use Section 6.2's `handoff-recovery` identity. A terminal estimator is never re-armed automatically. These are projection/claim-mechanism changes, not new user execution authority, so they do not change `commandRevision`; command deduplication still makes every retry wake idempotent.

The operator may inspect or download evidence and correct external configuration before retrying. An inconsistent stop intent, frozen-run set, request, or outbox relation is itself a typed recovery blocker. V1 provides no "trust me" button to clear a run, synthesize usage, release reserve, or mark a checkpoint complete. Without stop proof, complete usage, and a valid checkpoint, the run remains blocked. Uncertain provider start, unknown usage, or cross-record inconsistency is a required global recovery item and keeps `dispatchBlocked` true. A pre-claim or initial-attempt `claimBlocked` condition blocks only its owning group and uses group-scoped retry. A later-attempt or handoff-local invalid-proof/capability condition also suppresses new claims in its group but is cleared through its exact run-scoped retry under the frozen profile hash.

The summary exposes global `dispatchBlocked`, typed blocker counts, and the affected group/run IDs, so a blocker in one group cannot appear as an unexplained failure in another. Recovery retry is observation/projection work: it does not change command revision unless a separate explicit authority-changing command is required.

## 8. Security and filesystem rules

1. All control routes inherit existing Panel token and Host checks.
2. Plan, repository, model, adapter, archive, and evidence targets resolve from trusted IDs.
3. The browser never sends an executable path or arbitrary filesystem path.
4. Reads and downloads use server-owned containment and regular-file checks.
5. API and browser records redact the one-time Panel token.
6. Tests and screenshots use fixtures and temporary state, not real user task data.
7. No successful Web action deletes retained worktrees, checkpoints, logs, or evidence.

## 9. Acceptance and evidence

This increment validates the Web layer over the existing control system. It does not reimplement the completed foundation or repeat completed live validations without a relevant change.

### 9.1 Required product scenarios

| Scenario | Required result |
|---|---|
| Import allowlisted plan | Atomic complete draft, graph, provenance, defaults, and immutable normalized snapshot |
| Import omits estimator choices | Trusted config defaults are expanded before hashing and frozen with the selected profile hash |
| Import response is lost, then server default changes | Same raw request and command ID replays the persisted effective defaults; it does not re-expand or conflict |
| Stable profile reference changes content | Closed profile snapshot hash changes; stale import/confirm/start is rejected |
| Source plan changes after import | Existing group remains bound to its canonical snapshot hash; adopting changes requires explicit re-import |
| Automatic estimate succeeds | Versioned, group-accounted advice with evidence |
| Estimate fails or lacks capability | Defaults remain editable and confirmable; no fabricated result |
| Estimate input exceeds its bound | No model call; typed `estimate-input-too-large`; no truncation or hidden calls |
| Invalid estimator output | Whole estimate rejected for hash/task/schema/integer/identity failure; no partial suggestions applied |
| Human edits during estimate | Advice does not overwrite human fields |
| Apply estimate fields | One proposal command records exact estimate ID, field provenance, and next proposal version |
| Re-estimation response loss | Same command resolves to one versioned, accounted estimate work item |
| Confirm | All grants, limits, mode, context policy, provenance, and derived execution-contract snapshots commit together |
| Contract policy cannot represent grant | Confirmation fails closed with `execution-policy-unrepresentable` |
| Codex plus strict | Planning confirmation may succeed; start rejects the observed soft capability |
| Codex plus explicitly selected soft | With the real ccloop durable-handoff consumer, start is allowed and visibly non-strict |
| Profile capability disappears before claim | No run/session/provider call; estimator terminates blocked or owning task group receives only a local claim blocker |
| Strict proof is synchronously invalid | Provider is not called; failed-before-provider settles without global uncertainty and group-scoped retry is required |
| Worker and handoff profiles differ | Each provider phase verifies its own profile-bound artifact; one profile can never stand in for the other |
| Soft profile invokes provider | No proof artifact is required or accepted as strict; durable start/usage remains visibly soft |
| Model-assisted handoff | Fresh handoff-profile probe, separate attempt/session reservation, phase proof, marker charge, and recovery all use the handoff bucket |
| Strict task proof acknowledgement is lost | Run/task becomes start-unknown, group/global recovery block, and no second claim occurs |
| Strict estimator proof acknowledgement is lost | Estimate becomes nonterminal start-unknown while group stays draft; recovery alone resolves it to running or failed |
| Unknown context window | No 1M fallback and no strict context-watermark claim |
| Pause dispatch | No new claims; accepted executions continue |
| Start wake delivery is lost | Durable scheduler wake retries; HTTP replay creates no duplicate claim |
| Handoff-stop | Stop intent, frozen run set, requests, outbox, and command result commit atomically |
| Handoff transaction crash | State is entirely absent or fully replayable; no latch-only state |
| Handoff time limits | Absolute deadline and active-time budget are displayed and enforced independently |
| Complete handoff | Continuation allowed only after proof, usage, and checkpoint validation |
| Estimator interrupted by stop | Settles restartable after proof/usage, releases unused commitment, and requires a new estimate command rather than task continuation |
| Partial or unknown handoff | Evidence retained, reserve held, continuation refused |
| Handoff-stop catches start uncertainty | `starting`/`start-unknown` run is frozen and prevents vacuous handoff completion |
| Batch continuation | One `resume-from-handoff` command validates all selections, atomically registers all claims, and clears the stop intent |
| Unselected recoverable task | Becomes `held`; normal scheduling cannot claim it; explicit per-task continue may release it later |
| Continuation | Resume bundle used and cumulative budget inherited; consumed handoff reserve is not restored |
| Continuation identity timing | Registration persists a new pending run ID; only claim moves it into lineage/currentRunId, and replay never duplicates it |
| Soft run exceeds any grant dimension | Typed `budget-overrun`; no negative remaining grant and no continuation |
| Limit conservation | Every allocation occupies exactly one commitment-ledger state; cached reservation mismatches block recovery |
| Re-estimate consumes reserve | Grant transfers atomically from explicit reserve and unused settlement returns to reserve |
| Browser reload or disconnect | Execution unaffected; canonical state reloaded |
| Background usage or checkpoint update | Projection sequence invalidates the UI without changing command revision |
| Concurrent tabs | One command commits; stale command receives revision conflict |
| Lost response | Same command ID resolves without duplicate effect |
| Panel restart | New epoch forces full reload; unresolved recovery blocks dispatch |
| Normal Panel exit | Shutdown requests persist; unfinished work is recovered later |
| Claim races normal Panel exit | Admission gate and writer barrier make the claim either visible in the frozen set or rejected before transaction |
| Paused group with active run exits | Global shutdown transaction strengthens the pause and writes complete requests |
| Existing unresolved shutdown exits again | Earlier deadline, frozen set, revision, and identities remain byte-for-byte unchanged |
| Non-allowlisted target | Server rejects it |
| Immediate-kill request | UI omits it; the route does not exist and forged requests receive typed `404 route-not-found` |

### 9.2 Test layers

Unit tests cover default arithmetic, component-wise reserve rounding, safe-integer boundaries, canonical JSON/hash vectors, context capability and threshold validation, exact estimator input formulas, execution-contract derivation and proof coverage, field provenance, proposal/estimate version races, dirty-field protection, stop/recovery truth tables, and epoch/command-revision/projection-sequence handling.

API integration tests use a real temporary SQLite ControlStore and cover authentication, allowlists, immutable import snapshots, proposal editing and re-estimation, confirmation plus derived-contract atomicity, command replay, same-ID/different-payload conflicts, command-revision CAS, projection invalidation, capability/proof gates, profile routing, estimate schema/input bounds/accounting, durable start wake, atomic stop intent/outbox state, independent handoff clocks, batch continuation rollback, unknown usage, retained reserve, global recovery blocking, and stable-ID path resolution.

Browser tests start a real Panel on an ephemeral port with a temporary state directory and deterministic test ExecutionPort. They cover import through confirmation, estimate success and failure, soft start, pause/resume, handoff/reload/continuation, lost responses, two-tab conflicts, restart epochs, and recovery-blocked presentation.

### 9.3 Fault injection

Fault injection covers only new seams:

- before and after import transaction commit;
- canonical snapshot missing or hash-mismatched during recovery;
- estimate claimed with unknown start outcome;
- estimator proof acknowledgement lost, then mechanically resolved both as accepted and as proved failed-before-provider;
- estimator request rejected before dispatch because its complete input exceeds the bound;
- proposal edit racing an in-flight estimate completion;
- re-estimation committed with response loss;
- confirmation committed with response loss;
- failure during derived-contract generation before confirmation commit;
- selected profile capability or hash changing between confirmation and start;
- execution-affecting content behind a stable profile reference changing while the observed capability stays the same;
- profile snapshot, dispatch envelope, estimate contract, command, and proof golden-hash vectors including null/set-order cases;
- selected capability disappearing after start/resume wake but before claim;
- synchronous invalid request-bound proof with proved no-provider-start;
- group recovery with two local blockers where only one self-test/capability has recovered;
- model-assisted handoff capability loss, invalid proof, acknowledgement loss, no-start proof, and retry deadline expiry;
- start committed with scheduler-wake delivery or acknowledgement loss;
- strict task claim with request-bound proof acknowledgement loss before provider-start certainty;
- immediately before and after the atomic handoff-stop transaction commit;
- handoff outbox delivery with lost acknowledgement;
- older-schema handoff intent with reconstructable and non-reconstructable outbox state;
- batch continuation validation failure after one candidate has been examined but before commit;
- resume-from-handoff committed with continuation wake delivery or acknowledgement loss;
- direct per-task continue committed with continuation wake delivery or acknowledgement loss;
- group-limit command racing usage settlement;
- global `changeSeq` and per-group `projectionSeq` update failure before commit;
- checkpoint archived before SQLite commit;
- failure before and after the global cross-group shutdown transaction commit;
- a claim/mutation already in flight when the shutdown admission gate closes;
- repeated shutdown while an equal-strength shutdown intent remains unresolved;
- polling that observes a change-sequence gap.

The existing low-level crash and SIGKILL criteria remain regression dependencies. They are not redesigned or fully rerun unless this increment changes them.

### 9.4 Mutation criteria

Tests must fail if an implementation mutation:

- removes command deduplication;
- accepts the same command ID with a different canonical raw request;
- re-expands a changed dynamic server default when replaying an identical omitted-field raw request;
- replays a stale command against a newer revision;
- uses a projection sequence as command CAS, fails to advance it for a UI-visible observation, or updates it separately from global `changeSeq`;
- treats unknown usage as zero;
- lets an estimate directly change group authority;
- partially applies an invalid estimate;
- calls the estimator after its complete request fails the deterministic size preflight;
- overwrites a human edit;
- creates duplicate estimate work after response loss;
- starts an unconfirmed draft;
- partially commits confirmation or derived contracts;
- executes an imported source contract instead of the confirmed derived snapshot;
- lets a source edit affect an imported group;
- permits a derived execution policy to exceed its confirmed grant;
- treats a soft adapter as strict;
- demands run-specific proof during confirmation instead of at claim, or calls a provider before verifying that proof;
- verifies work with the handoff profile, handoff with the worker profile, or accepts a cross-phase proof artifact;
- requires a request-bound proof for an explicitly soft phase or presents soft execution as strict;
- accepts an artifact missing a closed-schema literal, with unsorted/duplicate dimensions, or with an envelope/hash mismatch;
- creates a run or consumes a session when the pre-claim capability probe fails;
- partially clears group-local blockers or wakes the group while any such blocker still fails retry;
- treats a lost estimator proof acknowledgement as terminal or starts ordinary work while it remains `start-unknown`;
- treats a synchronously invalid proof as provider-start uncertainty when the adapter proves no call occurred;
- treats a missing context window as 1M or phase-end observation as realtime;
- commits a stop latch without the frozen run set and complete request/outbox identities;
- excludes `starting` or `start-unknown` runs from a handoff/shutdown frozen set;
- creates only some selected continuation claims or clears stop after a batch continuation failure;
- lets normal scheduling claim a `held` or `continuing` source item;
- changes `currentRunId` or lineage when registering continuation, reuses a predecessor/pending run ID, or appends the claimed run more than once;
- completes a continuation run without updating the logical source task, lineage commitment, and dependent readiness atomically;
- computes a negative continuation Amount after soft overrun;
- clears a stop while an auxiliary estimator disposition is unresolved;
- converts wall-clock grace into active-time budget or vice versa;
- marks a partial checkpoint recoverable;
- marks a run recoverable without verifying referenced evidence hashes;
- restores consumed handoff reserve or continues from a mutable old work directory;
- lets shutdown overwrite a stronger human handoff-stop intent;
- lets shutdown replace/extend an unresolved equal-strength shutdown intent or admit a claim after its writer barrier;
- skips a paused active run during the global shutdown transaction;
- counts one allocation in more than one conservation-ledger state;
- creates a new estimate commitment without transferring its grant from explicit reserve;
- lets recovery synthesize usage/checkpoints or release reserve without evidence;
- claims ordinary work while the group is draft or stopped;
- accepts a browser-supplied path or executable;
- reuses stale UI state after an epoch change;
- exposes immediate kill as successful recoverable stop.

### 9.5 Evidence layout

New evidence is retained under:

```text
.superpowers/sdd/2026-09-19-web-recoverable-control/
  design/
  acceptance-map.md
  commands/
  test-logs/
  browser/
  fault-injection/
  mutation/
  artifacts/
  final-report.md
```

The existing `.superpowers/sdd/2026-09-19-ccloop-control-handoff-d3/` tree remains untouched. New evidence includes unfiltered logs, browser screenshots, structured API records, fault-injection outcomes, and hashes. Tokens and real user task content are redacted.

### 9.6 Final verification boundary

Automated final verification includes:

- new unit, API, browser, fault-injection, and mutation tests;
- Orca typecheck and build;
- Orca full-suite regression;
- a real Panel flow with a deterministic local ExecutionPort;
- a real ccloop-consumer protocol smoke that does not invoke an external model.

A live model chain remains a separate human gate. Before it runs, the operator must see and approve the selected estimator and worker models, plan and task count, strict/soft mode, maximum token/time/attempt/session grants, exact command, and evidence destination. No live model call occurs merely because this design or its implementation tests pass.

## 10. Delivery order

After this design is approved, implementation planning should preserve the following order:

1. control-store command revisions, projection journal, command-result lifecycle, and atomic stop-intent/outbox primitives;
2. trusted Panel configuration, execution-profile/proof routing, and lifecycle-owned ControlService;
3. immutable plan/contract archival, canonical serializers, and derived execution-contract snapshots;
4. read APIs, summary invalidation protocol, and global recovery presentation;
5. import, defaults, proposal versioning/editing, exact estimator preflight, re-estimation, and confirmation APIs;
6. durable start wake, pause, handoff-stop, shutdown orchestration, resume, and batch/per-task continuation APIs;
7. thin Web state, budget editor, uncertain-command `sessionStorage`, and command-result recovery;
8. browser restart, epoch, sequence-gap, and recovery behavior;
9. acceptance, fault injection, mutation, evidence, and non-live ccloop smoke.

Automatic decomposition and ccmem correction begin only after this Web slice passes its acceptance boundary.

## 11. Corrections and amendments (appended 2026-09-22)

Sections 1–10 are the approved text as published and are not edited in place. This section records
what the acceptance and whole-branch review waves found to be wrong or under-specified in that text,
together with the human ruling that settles each. File and line references are as measured on the
tree on 2026-09-22; re-measure before acting on them.

### 11.1 Ruling — §6.3: `recoverable` means *continuable*, not *finished*

§6.3's canonical predecessor (`src/control/continuation.ts:140,145`) requires a run that is
`state === "settled-recoverable"`, `recoverable === true`, holding a checkpoint whose
`result === "partial"`. Sections 4/6 as published also let the commit path set `recoverable` **only
when `result === "complete"`**. The two halves contradict, so no production commit could ever
satisfy §6.3: web batch continuation was unreachable by construction, not merely unwired, and the
criteria that appeared to cover it passed because fixtures wrote the flag by hand
(`tests/control/webContinuation.test.ts`, `webContinuationAccounting.test.ts`,
`tests/panel/fixtures/controlPanel.ts`).

Ruling (human, 2026-09-22): the continuation side is right and `recoverable` was the wrong
encoding. It answers one question — *can this checkpoint be continued from* — which depends on the
snapshot and evidence being whole, not on whether the task reached its outcome. Whether the task
*finished* is a separate judgement:

- `src/control/checkpoints.ts:85-88` derives `continuable = settled && missing.length === 0 && !!snapshot`
  and `completed = continuable && result === "complete"`, and writes `work.status = "done"` only on
  `completed && accepted`. Completion therefore means exactly what it meant before: the two
  expressions conjunct back to `settled && complete && whole snapshot && accepted`.
- `repairAcceptedWork` (`src/control/checkpoints.ts:116-120`) returns unless the committed
  checkpoint's `result === "complete"` — acceptance completes a task, it does not finish an
  interrupted one.
- `exportResumeBundle` (`src/control/resumeBundle.ts:78-82`) requires a whole snapshot and no
  missing evidence, and no longer demands the predecessor's terminal outcome: a bundle exists to
  continue *from* a checkpoint.
- Cleanup (`src/control/cleanup.ts:11`) keeps its explicit `result === "complete"` guard, so
  widening `recoverable` did not widen what may be deleted.

What widened is one thing only: a settled run whose dirty snapshot arrived whole is now admissible
as a continuation source, which is what §6.3 asks for. Criteria:
`tests/control/checkpointRecoverability.test.ts` (6 tests, added — no existing criterion relaxed).

**Consequence for §9.4.** That list names a mutation "marks a partial checkpoint recoverable"
(line 1467). Under this ruling a `result: "partial"` checkpoint *is* recoverable, so the line is read
in its new vocabulary: the fault is calling a checkpoint continuable when it is not whole — not
settled, no snapshot, missing captured evidence, or an unresolved request. The mutation
`continuable = settled && c.missing.length === 0 && !!c.snapshot` → `continuable = settled` was run on
2026-09-22 and went red (`rc=1`) on
`refuses the bundle when the snapshot is gone, even though the run settled`, which asserts
`recoverable === false` before it asserts the refusal. The `missing` conjunct is asserted by
`does not call a checkpoint with missing evidence continuable`; that one has **not** been seen red
(the mutation run was not permitted on 2026-09-22), so it is an open verification item, not a
delivered gate.



**Residual, and it is a wiring gap rather than a predicate gap**: the chain
`commitCandidate → settleHandoffRequest → assertPredecessor` is now satisfiable by production code,
but `settleHandoffRequest` has no production caller (§11.5), so the shipped Panel still cannot
produce a §6.3 predecessor.

### 11.2 ERRATUM — the global shutdown command identity is hash-shaped

§6.4 says "The global ledger key and command ID are both `shutdown:<epoch>`" and the per-run request
identity is `shutdown:<groupId>:<shutdownRevision>:<runId>`. The second is an outbox key and is
implemented literally. The first cannot be: `idSchema` (`src/control/schema.ts:3`) is
`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` and rejects colons, so a spec-shaped command id would fail the
protocol's own parse. Implemented as
`shutdown-<sha256(epoch hex)>` (`src/panel/controlLifecycle.ts:76-78`).

Correction: read `shutdown:<epoch>` in that sentence as "the identity derived from the epoch", and
the implemented shape as authoritative. The properties the rule cares about — deterministic,
crash-replayable, one per epoch — hold under the hash.

### 11.3 ERRATUM — §6.2 `HandoffJoinV1.origin` literals

§6.2's record (`docs/.../2026-09-19-web-recoverable-control-design.md:1178`) types origin as
`"context" | "human" | "shutdown"`. Implemented, the stop path uses `"handoff" | "shutdown"`
(`src/control/stopIntent.ts:268,284`) and the context path writes `"context"`
(`src/control/contextControl.ts:108,123`). So `"human"` never appears on the wire; a human
`handoff-stop` is recorded as `origin: "handoff"`.

Second, sharper divergence: origin exists only on the join record and the outbox body. The canonical
request body (`src/control/stopIntent.ts:291-296`) carries none, so §6.2's claim that one open
request spans "context, human, and shutdown origins" is only reconstructible from the outbox row
plus the run's latch reason (`context-threshold-crossed`), not from the request the join points at.

Correction: the enum reads `"context" | "handoff" | "shutdown"`, and origin is a property of the
*desire* (outbox/join), not of the adopted request. No behavioural consequence was found; the label
and the record placement are the whole of it. Fixing either would move a wire value, so it is a
human call, not a cleanup.

### 11.4 Amendment — the evidence-bytes route was unspecified; it is now pinned

§4 defines `EvidenceManifestV1.entries[].downloadUrl` (line 515) and never specifies the route that
serves it, so as shipped the field 404ed. The route added under Task 10
(`src/panel/controlApi.ts:134-150`) resolves only hashes the store's own reference table accepts, and
answers with `content-type: application/octet-stream`, `x-content-type-options: nosniff`
(`:143`, added 2026-09-22 so a stored artifact cannot be reinterpreted by the browser),
`content-security-policy: default-src 'none'`, and
`content-disposition: attachment; filename="<sha256>"`.

Not closed, and it is a product decision: the route authenticates by the `x-orca-token` header only,
so following `downloadUrl` from a browser without the header is a 401. A short-lived capability or an
in-app viewer are both bigger changes than a header.

### 11.5 Status of the seams this slice shipped but did not wire

Measured 2026-09-22 by cross-file reference count under `src/` (0 = defined, never called outside its
own file): `beginHandoffAttempt`, `settleHandoffRequest`, `deliverHandoffStop`,
`createWebWakeHandlers`, `runControlPanelStartup`, `createTrustedControlConfig`, `applyPanelShutdown`,
`acceptContextObservation`. Wired: `applyHandoffStop`, `deliverSchedulerWakes`, `scheduleStart`,
`startClaim`, `openControlStore`. `createCcloopExecutionPort` does not expose
`probeProfileCapabilities` (the method is optional on `ExecutionPort`, and `profiles.ts:150` answers
`control-capability-probe-failed` when it is absent), and no production consumer translates the
ledger's `DispatchEnvelopeV1` (`schema: "orca-dispatch-envelope-v1"`, `src/control/webProtocol.ts:304`)
into the port's `StartEnvelope` (`src/control/executionPort.ts:7`) — ccloop calls its wire twin
`StartEnvelopeV1`. `webCcloopSmoke.test.ts:88-101` holds the only translator in the repository and
says so. The production mount policy for these seams is ruled in
`docs/superpowers/specs/2026-09-22-panel-control-assembly-design.md`.

## ERRATUM (G1 seam B, 2026-09-24)

Three statements above are superseded by `docs/superpowers/specs/2026-09-24-g1-seam-b-target-version-design.md`
(human ruling 2026-09-24: one targetVersion, a positive safe integer, from plan file to wire). The original text is kept verbatim.

- `WorkItemViewV1.targetVersion: string` (the `WorkItemViewV1` type in the read-model section) is now a positive safe integer.
- `ControlPlanV1.tasks[].targetVersion: string` (section 4.2) is now a positive safe integer.
- "`targetVersion` is the source plan's nonempty opaque version string and is not numerically coerced" (section 4.2) no longer holds:
  the source plan writes a positive safe integer, the import stores it unchanged in both the work-item column and body, and a
  string is refused as `malformed`.

## ERRATUM (execution driver, 2026-09-25)

The statements below are superseded by `docs/superpowers/specs/2026-09-25-execution-driver-design.md` for the runs the execution driver owns: Web runs claimed for work (they carry a `work:<groupId>:<runId>` claim row) on a panel whose execution port is configured. The original text above is kept verbatim.

- The background scheduler named at line 772 is the execution driver loop (`src/control/executionDriver.ts`). After a start wake is delivered it reserves the provider attempt, sends the frozen start envelope, collects, lands the result on `orca/<groupId>`, settles the run, and arms another start wake while ready work remains.
- The request-bound proof line 778 requires before a strict provider call is honoured in this slice only by refusal: a strict group's run is blocked with `strict-proof-unimplemented` before any provider attempt; soft groups are driven without a proof.
- Line 788 (a lost proof acknowledgement sets a global recovery blocker) is unchanged for the proof path (`recoverAttempt`). What no longer applies to driver-owned runs is startup recovery's rule that a run without a `start:<runId>` row blocks dispatch for every group: recovery leaves those runs to the driver, and a run the driver cannot advance is blocked on its own, with a named `blockedReason`, without setting `dispatchBlocked`.
