# Task 3 independent SPEC + QUALITY review

Reviewed ccloop `8ebd1633cfd8929301eb7ff15f4a385e9adb649e..91c0a7559b50a35f34a70a33f300e62ee0693dd3`, the exact 21 changed files, token-policy design including amendments, Task 3 brief, global constraints, latest producer rulings, implementation report and evidence. Source/index/HEAD remained read-only; original source status remained only `?? node_modules`. All 21 final-file SHA256 values match the evidence manifest, including `validation/v1/lib/scenarios.ts`.

**SPEC: ❌ Not fully compliant. QUALITY: Needs fixes.**

- ✅ Nullable ceilings are distinct from finite usage; zero/finite non-token limits and unknown-usage resume refusal are implemented. Actual v4 grants narrow runtime limits without replacing accepted contract authority.
- ✅ Independent feature negotiation advertises only tokenPolicy. V3 finite parsing/hash and explicit terminal/candidate projection remain, and the named unsupported-version criterion rewrite and positive-only bounded validation guard follow the recorded authorization.
- ✅ Saved phase references require manifest hash validation and handoff closure membership. Complete execute reuse excludes partial execution; plan renewal rechecks retry eligibility and restores failure history. Local observations exclude replayed phases.
- ❌ Renewal does not bind the work-item identity and does not enforce complete inherited usage. These are explicit Task 3 producer rulings, not deferred Task 4 integration work.
- ⚠️ Existing suite success does not establish these two omitted refusal paths; the focused review regressions below fail on the submitted implementation.

## Findings

**Critical:** None found within the requested scope.

**Important I1 — Bind renewal to the same work item.** `src/control/materialize.ts:206–208` compares predecessor run, group, task, graph, target and frozen hash, but omits `identity.workItemId === envelope.claim.workItemId`. A hash-verified saved checkpoint for one work item is accepted by another work item when the remaining authority values match. The immediate worker caller consumes the returned continuation and skips already-paid phases, with no additional work-item check. Add the missing comparison and a named foreign-work-item refusal test. This is required by the producer ruling's source group/work/task/run identity binding. Clone-only reproduction changes only the new envelope's `claim.workItemId`; the promise resolves at `nextPhase: verify` instead of refusing.

**Important I2 — Validate tokens and activeMs across the saved lineage.** `src/control/materialize.ts:223–224` checks only attempts and sessions. Neither `tokens` nor `activeMs` is compared with the source policy's inherited usage or the source run's usage. A renewal can therefore report zero inherited tokens/time even when its hash-verified source packet already records 1,000 inherited units; it is admitted and receives the saved completed phases. The worker forwards this understated policy unchanged, and `runLoop.ts:1311` uses its token total to decide whether an authored ceiling still permits renewal. The task explicitly requires current inherited Amount to cover saved lineage plus local source consumption. Bind finite source-run usage evidence into the handoff and validate all dimensions against source inherited plus source local usage without recharging replayed phases. Add regressions for both rollback below prior inherited usage and omission of local source consumption, including overshoot. The focused tests independently demonstrate accepted rollback for tokens and activeMs.

**Minor:** None raised.

## Evidence and scope

Inspected the actual new tests and the immediate worker, handoff, materialization, controller, stop-decision and usage call paths for the named risks. Existing `allowanceEvidence.test.ts` exercises a foreign run ID and inherited attempt/session reset, but has no foreign work-item or token/time-lineage refusal assertion. Existing continuation tests demonstrate phase reuse and retry-history preservation, not full lineage validation.

Existing final full/native/typecheck logs were read and audited against their recorded hashes and successful return codes. The per-test full-suite JSON confirms 1,412 passed, 0 failed, 0 pending; native evidence records 658 passed with no skips. The 21-file hash manifest verifies the submitted files, including the validation renderer outside the generic runner source digest. No full suite or mutation suite was rerun during review.

Only the specific uncovered renewal concerns were tested, in `/private/tmp/ccloop-task3-review-20261011`, a local clone at the submitted HEAD. Added three review-only refusal assertions to the existing allowance fixture test; production source was unchanged. Command: `python3 /private/tmp/orca-followup-run.py /private/tmp/ccloop-task3-review-20261011 task3-review-lineage npm test -- tests/control/allowanceEvidence.test.ts -t review: --maxWorkers=1 --minWorkers=1`. Isolated HOME/XDG/TMPDIR/data roots were provided by the required runner. RC 1: all three targeted assertions failed because promises resolved; nine existing tests were deliberately excluded by the name filter. The complete log was read: `/private/tmp/orca-followup-runs/task3-review-lineage/output.log`; metadata: `/private/tmp/orca-followup-runs/task3-review-lineage/result.json`. Xcode cache/event-stream diagnostics did not prevent fixture execution; failures are assertion failures with returned continuation objects.

Re-review the two scoped fixes and their evidence before Task 3 closure. Do not waive the required producer renewal checks as consumer-only responsibility.
