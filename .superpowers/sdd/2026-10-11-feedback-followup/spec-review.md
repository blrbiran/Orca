# Independent architecture review — feedback followup

Owner: Codex subagent `/root/spec_review`, 2026-10-11 Asia/Shanghai. Read-only review requested by controller; only this report written. Observed Orca commit `35199d533a101bdf4cccd1656d820c7c10db2d4d`; ccloop commit `8ebd1633cfd8929301eb7ff15f4a385e9adb649e`. Authority: task delegation, RTK.md, and each repository CLAUDE.md. No implementation or tests run, no production/user-data mutations, no subagents.

Verdict: **BLOCK pending append-only amendments below.** The features are feasible on the existing architecture. These findings require concrete controller rulings, not a new human approval round. Once the amendments resolve these points, planning may proceed; this verdict is not an implementation approval.

Evidence method: `rtk proxy git rev-parse HEAD` in each clone; `rtk proxy nl -ba docs/superpowers/specs/2026-10-11-{token-policy,saved-result-recovery,agent-preparation}-design.md` individually; targeted `rtk rg -n` searches; `rtk proxy python3` reading and numbering the cited code ranges. Line references below were read at the observed commits. Findings are design analysis, not test results.

## F1 — P1: Installation apply needs a durable cross-process transaction and receipt

Spec: agent-preparation-design.md:19–21.

The spec combines an Orca command ledger/revision with a ccloop-owned filesystem rename, but describes only a file-hash CAS and atomic rename. Those operations do not atomically commit together. A crash after ccloop renames the table but before Orca records its command result leaves a successful mutation that replay can misclassify as a stale preview. Concurrent ccloop CLI and panel applies can both read the same old hash before either renames, losing one accepted update. Re-probing also opens a substantial asynchronous interval between the hash read and rename.

Current code: Orca `src/control/commandLedger.ts:284–294` opens its SQLite transaction and checks prior command outcome; `:382–391` records the final result only at the end. ccloop `src/agents/table.ts:67–80` supplies a private file read, not a mutation lock or durable receipt. An SQLite rollback cannot reverse a completed rename in another process.

Required amendment: designate ccloop as the durable table-mutation authority. All shared CLI/control apply paths serialize through a private table-scoped lock; under that lock validate owner/path, preview binding, original bytes/hash and accepted identities, and revalidate after probes. Persist an operation intent keyed by command identity and exact request digest, with before/after hashes and approved change set, before replacement. Make replacement durable and publish an immutable terminal receipt. Crash recovery compares current table bytes with the recorded before/after hashes, completes only the same operation, and reports an explicit conflict for a third state. Orca reserves its intent/revision before dispatch and reconciles the same ccloop receipt before finalizing its command outcome; it must not resend as a new command. Define preview/intent/receipt location, permissions and cleanup ownership per Rule 17. Replaying a completed apply must return its receipt before treating the original base hash as stale. Include crash points before rename, after rename/before receipt, after receipt/before Orca commit, plus two simultaneous apply processes.

## F2 — P1: Saved-result eligibility must bind the current authoritative task, not merely lineage membership

Spec: saved-result-recovery-design.md:15, 21, 27–31.

The capsule strongly identifies its historical source, but admission only says “current run membership.” Membership in a task lineage is weaker than being that task’s current terminal source. A historical failed run can remain a lineage member after a later retry, graph revision, contract edit or successful delivery. Its intact old snapshot is not automatically authorized to satisfy the current task. The sentence rejecting “later attempts” in legacy eligibility covers original execution attempts; it does not state the current Orca task/run/version fence for every capsule.

Current code provides the necessary pattern: Orca `src/control/continuation.ts` `assertPredecessor` requires the exact work.currentRunId, terminal recoverable state, matching group/work/task identity and matching checkpoint. Legacy claimContinuation additionally compares graphVersion, targetVersion and configHash. The new recovery path must state which of those relationships it preserves or deliberately changes.

Required amendment: source must be the task’s current terminal failed run and its terminal attempt, with no newer pending/current run or accepted task result. Check group/work/task, graphVersion, targetVersion, frozen contract hash and original base authority against the current frozen task at admission and before spawn. Refuse changes with a typed unavailable reason. If a verifier Agent selection may differ, define that as an explicitly approved, newly frozen recovery-only selection while preserving source executor/config identity and original contract/base; do not infer permission to replace the source contract. Include latest-run replacement, changed target/contract, graph change, already-landed task and racing ordinary retry criteria. No cross-version recovery is needed for this feature.

## F3 — P1: Recovery mode and interrupted-verifier behavior must survive every restart path

Spec: saved-result-recovery-design.md:29–33.

“Skips plan/execute” and “once” are required, but crash guarantees currently only spell out the case after an already-recorded terminal result. The harder case is a crash after verification starts and before its result is durable. Ordinary ccloop resume discards the interrupted worktree and enters planning for a new attempt (`src/controller/resumeLoop.ts:388–407`). Merely adding a special initial entry point is therefore insufficient. It could repeat verifier usage or, through a generic restart path, invoke the executor the user explicitly chose to skip.

Required amendment: persist and hash recovery mode/source package identity in the sealed accepted input and every restart/recovery record; all start/resume/driver crash paths dispatch by that durable mode. Persist verification entry before commands/provider invocation. A crash with no verification-entry marker may continue the same recovery admission after ownership checks. After entry, reuse a complete validated durable verification result if available; otherwise reap/settle or hold unknown usage and park the run, without automatically repeating commands/verifier or falling into normal plan/execute. A new recovery attempt requires a fresh authorized command subject to ordinary usage/cap gates. Preserve source failure. Add crash cases immediately before entry, after command/provider spawn, after output persistence/before terminal state, and after terminal state. This resolves the ambiguity without promising exactly-once external execution across an unobservable crash.

## F4 — P2: Slot division must include every intended slot’s handoff reserve

Spec: token-policy-design.md:15–19.

The stated algorithm reserves one handoff and then divides remaining work headroom across free slots. This does not ensure that later slots can fund their own handoff. Example (illustrative arithmetic, not measured usage): headroom 22,000, two slots, handoff 10,000 per slot, useful work minimum 1,000. Reserving the first handoff and dividing the rest gives its work 6,000, committing 16,000 and leaving 6,000; the second task cannot claim. Both tasks could instead receive 10,000 handoff plus 1,000 work. Thus the claim that this keeps concurrent unlimited tasks possible is false at a meaningful boundary.

Required amendment: define the slot scope, eligible ready demand and deterministic ordering, and reserve the total required handoff for all slots intended to be funded before dividing work headroom (or divide total allowance first, then subtract each slot’s handoff). Reduce the funded slot count deterministically when the cap cannot fund all slots’ handoff plus useful minimum. Define “useful work” as an explicit admission predicate/minimum derived from the existing capability/request constraints, not an arbitrary new chunk. Reserve only actual claimed allowances; pending fairness calculations must not create fake usage or infinite commitments. Include unequal handoff needs, fewer ready tasks than concurrency, small explicit demand and concurrent groups sharing a cap. Existing `src/control/spendCaps.ts:45–57` correctly deducts actual active commitments; preserve that invariant.

## F5 — P2: Estimator partial overrides need an explicit per-field precedence rule

Spec: agent-preparation-design.md:7–11, 25.

The prose says both that estimator follows primary only with no explicit role override and that explicit operator/group overrides retain priority. Existing overrides are partial. An operator estimator override containing only a model, with no Agent field, already has an implicit Agent identity from the operator default. Inserting group primary before that layer can accidentally reinterpret an existing model under another installation; suppressing all group-primary inheritance whenever any field is overridden gives a different behavior. Both readings fit the current prose, and they can select different providers or block a formerly valid setup.

Current code: Orca `src/control/agentSelection.ts:73–89` specifies layer ordering and binds each layer’s model/context fields to its effective Agent. That binding must survive the feature.

Required amendment: publish the exact estimator layer order and a small decision table covering absent override, model-only override, Agent-only override, null masking and group primary switching to another Agent. Recommended conservative rule: resolve explicit estimator role layers using their established Agent binding; inherit primary values only for missing fields compatible with that same effective Agent, and use full group primary when no explicit role choice exists. Preserve existing role intent and never transfer model/context across installations. Name the new provenance source and clarify whether it changes only newly frozen hashes. Add criteria for each case; no human decision is required.

## Nonblocking clarification

Saved-result-recovery-design.md:7–9 and :27–31 should explicitly state that eligibility also requires exactly one valid normalized execution under the named supported deterministic normalizer. A newly generated format-failure capsule may still be unavailable if the same normalizer cannot recover it; complete filesystem evidence alone does not justify synthesizing required execution fields. Legacy envelope failures can qualify because the new normalizer accepts shapes rejected by the old adapter (`ccloop src/runtime/codex/codexAdapter.ts:43–58`). This clarification keeps the feature’s availability honest without weakening strict decoding.

## Remaining assessment

The bounded browser changes in feedback-followup-design.md are concrete and preserve authoritative state/command semantics. The nullable ceiling/finite usage distinction is sound, as are preserving legacy finite hashes and refusing unsupported peers. Recovery’s immutable source capsule and real verification requirement are appropriate; secure archive/materialization primitives already exist. Observation/apply separation and owner-only mutation are appropriate once F1 defines durability. No additional architectural decomposition or product deferral is requested. Append corrections to the committed specs; do not rewrite their historical text.
