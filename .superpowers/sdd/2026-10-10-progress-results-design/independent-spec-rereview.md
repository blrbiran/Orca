# Independent specification re-review

Owner: `/root/spec_review`, 2026-10-10 Asia/Shanghai.
Reviewed Orca commit: `94346257805da3daee78bb418332c6d933bdf5b8`, measured with `rtk proxy /usr/bin/git rev-parse HEAD` in the assigned worktree.
Scope: the original five findings, appended effective §8 of both specifications, and concrete amendment risks. The original report remains unchanged. No implementation/source edits, tests, provider calls, commits, subagents or runtime changes were performed. This re-review report is the deliverable.

## Verdict

**Ready for implementation planning. Open findings: 0 P0, 0 P1, 0 P2. Original findings addressed at specification level: 2 P1 and 3 P2. No new blocking contradiction found.**

This approves the amended design contracts, not implementation correctness, passing tests, installed feature availability or publication. Each specified boundary still needs the acceptance evidence required by the specs.

## Finding dispositions

| Original finding | Effective amendment | Disposition |
| --- | --- | --- |
| P2-1 — Independent decision/review freshness | Progress §8, lines 71–73 | Addressed. Todo refresh is independent of metrics and control changeSeq, initially and every 5000 ms only while Overview is active. Per-source freshness, late-response identity, auth/pane cleanup, external review changes, and unavailable badges are explicit. |
| P1-1 — Supplemental evidence re-enters core archive | Results §8.1, lines 83–91 | Addressed. Dedicated capture/evidence namespaces, explicit exclusion from normal/handoff/failed-cleanup/continuation archival, independently authorized evidence reads, bounded separation before core execution persistence, and cross-path failure-injection equivalence close the identified path. |
| P1-2 — Running results cannot travel through terminal handoff alone | Results §8.1, lines 83–85 and 91–93 | Addressed. Separate read-only task-results/evidence methods expose saved captures without candidate/stop/provider calls; current attempt and revision are explicit; admitted data triggers its own projection update. Ordinary execution does not depend on optional RPC success. Live-before-terminal acceptance is required. |
| P2-2 — Decorated-final scanner treats report content as another answer | Results §8.2, lines 95–99 | Addressed. Report subtrees are opaque for execute candidate discovery, bounded independently, and cannot fail valid core execution. Genuine extra answers and invalid core/whole JSON retain refusal. Fenced nested-key/depth and oversized-report criteria are named. |
| P2-3 — Immutable manifest/verifier lifecycle is undefined | Results §8.3, lines 101–107 | Addressed. One execute snapshot per attempt, immutable higher-revision verification successors, owner-fenced atomic index publication, actual verifier states, current-attempt/history separation, continuation identity and late-page/response rejection are explicit. |

References are to `docs/superpowers/specs/2026-10-10-progress-and-next-actions-design.md` and `docs/superpowers/specs/2026-10-10-task-results-design.md`. §8 line numbers were freshly read by `rtk proxy python3` using numbered `splitlines()` output. The original review was reread with `rtk proxy cat`.

## Consistency assessment

The precedence clauses are sufficiently clear. Results §8 supersedes the original handoff-field transport; there must be no taskResults field added to the core packet, Candidate, collect or capabilities shapes. The new optional methods supply the same functionality independently. Earlier strict-reader extension language is historical, not an additional simultaneous implementation requirement.

Progress §8 line 75 and Results §8.4 line 111 consistently resolve the shared detail default: completed work opens Results even when explanation is missing. Explicit navigation and a user's current region still take precedence; polls do not steal focus. Active and attention defaults remain compatible.

Report availability, actual execution/verifier outcome, and Git delivery remain separate. Monotonic result observations do not replace authoritative currentAttempt: a new attempt with no report cannot inherit the previous attempt's explanation. Saved execution-stage bytes remain that version even if verification or later reconciliation changes the workspace.

The original bounds and safe-path requirements remain applicable. Dedicated result evidence is authorized through accepted-envelope identity and run-index/manifest membership, not by possession of a hash. No new endpoint is a general filesystem reader. The new read methods do not write captures, and result GETs only read already-admitted state.

## Implementation obligations that must not be weakened

These are consequences of the effective contract, not additional blocking spec findings.

1. **Retention must precede destructive cleanup.** Results line 89 requires the typed result index and authorized closure to be retained before result workspace removal; line 91 lets core collection/usage/state transitions proceed without optional RPCs. These coexist by coordinating the deletion boundary separately. Existing source still removes workspaces in `src/control/executionDriver.ts:744` and `:765`; implementation must not race those deletions against a queued metadata job. Successful admission, or an explicitly recorded bounded acquisition failure, needs a defined cleanup outcome without turning report failure into execution failure or holding control budget settlement. Tests must exercise the race and failure path, not merely successful background reads.

2. **Optional jobs must preserve control responsiveness.** Per-run single-flight, global concurrency two, 1000-ms optional RPC timeout, ownership/admission fencing, and monotonic admitted pages must remain independent of core bookkeeping. Missing, invalid, unsupported, stale and unavailable result states must remain distinguishable. A shutdown or lost source can prevent retention; the product must state that limitation instead of claiming saved bytes exist.

3. **Metadata isolation does not promise success for invalid provider transport.** Results line 97 correctly preserves original refusal for invalid whole JSON or responses beyond existing transport bounds. It protects malformed report content inside an otherwise valid core object. Do not claim arbitrary truncated or oversized provider output always preserves a recoverable core. Packaged runner/schema linkage and real-provider compatibility remain unproven until separately tested; deterministic fake-adapter acceptance is not a real-provider claim.

4. **Opaque scanning must not weaken genuine ambiguity checks.** Skip report contents only in the execute-answer metadata role. Independent real answers and invalid execution envelopes retain existing refusal. The explicitly required paired positive/negative scanner cases are load-bearing.

5. **Unsupported detection is a compatibility diagnostic.** I inspected the pinned source with `rtk proxy /usr/bin/git show ab824d16004de2d3c1613a76ec0431520aa16cc9:src/control/command.ts`. Its `parseCommand` rejects unknown methods with `control-command-invalid`; `runControlCommand` returns that error on stderr. Thus the selected old-pin diagnostic is source-supported. Only the correctly formed optional operation's corresponding refusal should cache unsupported; malformed local invocation, transport/identity errors or corrupted data must not be quietly treated as absence. Changed executable identity must invalidate the cache as specified. This was source inspection, not a compatibility test run.

6. **Exclusions are narrow and explicit.** Excluding the two supplemental namespaces must not weaken core snapshots/handoff evidence or authorize arbitrary path exclusions. The new private namespaces, capture staging, controller fencing and temporary-root routing still require tests. Original core evidence failures remain real failures even though a separate result read is optional.

## Publication and scope remain unchanged

Results §8.4 expressly preserves §7. The fixed ab824d1 package/lock/default pin does not produce the new reports. Overview must work on that pin; missing/unsupported explanations are the honest default there. Paired feature-build evidence demonstrates local integration only. Later ccloop publication and Orca repin remain necessary for installed production of reports and require their separate integration authorization. Nothing in this re-review authorizes push, main merge, worktree deletion, production migration or service/runtime switching.

No historical report backfill, separate summary-model invocation or group narrative summarizer has been introduced. The two subprojects remain independently decomposable, sharing result/detail navigation conventions. Proceed to plans with the stated acceptance and final audit requirements intact.
