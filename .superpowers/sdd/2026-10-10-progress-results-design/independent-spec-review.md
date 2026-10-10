# Independent specification review

Owner: `/root/spec_review`, 2026-10-10 Asia/Shanghai.
Observed sources: Orca `b1839be215150e3697d723af0bf0c61fba045209`; ccloop `a4c882ec19fa41695955be5f125dee4c4f3f73b9`.
Scope: independent source inspection of the two specifications. No implementation, test runs, provider calls, commits, runtime switching or publication. This report is the only persistent deliverable. Findings are source-based design analysis, not empirically reproduced failures.

## Verdict

**Changes required: 2 P1, 3 P2, no P0.**

Progress/next-actions is substantially implementable but needs an independent decision freshness contract. Task results needs transport/isolation decisions before decomposition, plus decoder and manifest lifecycle acceptance rules. Resolve autonomously under the human's authorization and append the rulings; no intermediate human approval is required. Push, main integration and runtime switching remain outside this authorization.

References below are repository-relative; ccloop references have a `ccloop:` prefix. Line numbers were freshly inspected using `rtk proxy rg -n` or `rtk proxy python3` numbered source reads. Commit identities were measured with `rtk proxy /usr/bin/git rev-parse HEAD` in each assigned worktree. No earlier reconnaissance report was treated as authority.

## A. Progress and next actions

### P2-1 — Specify independent freshness for decision/review sources

Spec: `docs/superpowers/specs/2026-10-10-progress-and-next-actions-design.md:31`, `:37`, `:51`, `:57`.
Source: `web/src/App.tsx:775-786`; `src/panel/api.ts:215-219`; `src/control/projectionJournal.ts:23-45`.

Overview combines the control projection with `home.todo`, but only defines polling via control `changeSeq`. Today `loadHome` reads todo and metrics together on mount and explicit local refreshes. The todo endpoint reads external decision observations and reviews, not the control projection journal. A decision arriving from another process or review in another browser can therefore leave the queue indefinitely stale despite successful control polling. A metrics failure also discards a successfully fetched todo response because they share `Promise.all`.

Recommendation: refresh todo independently while Overview is active, track its own freshness/error state, and sequence late replies across scope/auth changes. Do not tie it to control revisions or metrics success. Add criteria where todo changes without a control revision, and where metrics and todo fail independently without fabricating an empty queue. No new push system or full detail fetch is necessary.

Other A constraints are sufficiently explicit: default Overview/hash preservation; progress-first layout; navigation-only exceptions and human steps; composite decision identity; unknown outcomes; exact requirement/ready exclusions; global versus concrete-project settings; permission-preserving member visibility; scope-close races; no focus stealing. `GroupReadSnapshot` (`src/panel/groupReadSnapshot.ts:32`) supports bounded request-local reads. The existing tally is lenient (`src/panel/controlViews.ts:321-335`), so explicit malformed-data issues must be implemented rather than assumed to exist.

## B. Task results

### P1-1 — Generic archive reintroduces optional evidence into critical checkpoints

Spec: `docs/superpowers/specs/2026-10-10-task-results-design.md:23-31`, `:37-41`.
Source: `src/control/archive.ts:129-156`, `:159-177`; `src/control/executionDriver.ts:695-713`; `src/control/driverHandoff.ts:313-326`; `ccloop:src/control/evidence.ts:22-36`.

Excluding supplemental refs from ccloop candidate artifacts, packet artifacts and rawLogs does not isolate them from all existing admission paths. ccloop evidence lives under `sourceDir/control/evidence`. Orca archiveRun recursively captures the entire source except the result repo, then returns captured refs as archive.artifacts. Both normal and handoff settlement add those refs and archive.missing to acceptance-critical checkpoints. An unreadable supplemental file can throw; changed/special content can add missing entries and degrade recoverability. Catching only the result importer cannot meet the promised isolation.

Recommendation: use an explicit supplemental namespace excluded from core archive and continuation evidence closure, with independent result retention/indexing. Also account for raw taskResult embedded in core execution.json/runner finals: bound diagnostic retention and avoid new report-only persistence errors becoming core failures. Acceptance must inject supplemental failures through stepE and handoff settlement and preserve outcome, usage, checkpoint missing list and continuation eligibility, while genuine core handoff/snapshot damage still refuses.

### P1-2 — Handoff-only transport cannot expose saved results during ordinary running work

Spec: `docs/superpowers/specs/2026-10-10-task-results-design.md:7`, `:23-29`, `:37`, `:46`, `:57`.
Source: `ccloop:src/control/worker.ts:268-304`; `ccloop:src/control/handoff.ts:287-299`; `ccloop:src/control/collect.ts:74-88`; `src/control/executionDriver.ts:480-519`.

The only specified transport is inside the hashed handoff packet. The producer creates it at onRunSettledBeforeLeaseRelease; building a packet for nonterminal work without a handoff request is refused. Normal collect has no candidate before that boundary. Thus an execute report saved while verification runs, or an older failed attempt retained while a retry runs, has no declared route to Orca. Scanning arbitrary files is rightly forbidden. Terminal-only availability does not meet the human's saved-running-partial requirement.

Recommendation: define a separately labelled live result collection/read operation with accepted-envelope authority and immutable manifests, independent of terminal/candidate semantics. Never manufacture a handoff candidate or stop request to expose progress. Specify old-pin unsupported/missing behavior. Acceptance should pause fake execution after execute and during a later attempt, collect with no stop request, and prove saved results are visible with exact identities before a terminal packet exists.

### P2-2 — Raw optional reports must be opaque to decorated-final candidate discovery

Spec: `docs/superpowers/specs/2026-10-10-task-results-design.md:15`, `:19`, `:65`.
Source: `ccloop:src/runtime/codex/protocol.ts:133-141`, `:161-211`.

Accepting taskResult as unknown in the execution schema alone does not cover existing decorated-final support. Candidate discovery recursively walks every object and considers any node owning `result` another execute answer. An otherwise valid single fenced execute envelope whose invalid taskResult contains `{ "result": 0 }` becomes ambiguous. Deep invalid report content can also exhaust the scanner bounds. These errors occur before execute decoding and can change execution outcome solely because optional metadata is malformed.

Recommendation: explicitly make optional report contents opaque within an established execute envelope during candidate discovery, then validate them independently with bounds. Preserve genuine multiple-answer/core-invalid refusal. Add fenced/decorated cases with answer-like keys and excessive depth, alongside whole-JSON malformed/oversized cases. Define bounded diagnostic retention above the 65536-byte report limit; do not require arbitrary oversized raw payload persistence into critical evidence. These are deterministic adapter-path checks, not a real-provider support claim.

### P2-3 — Define immutable manifest evolution and per-attempt verifier authority

Spec: `docs/superpowers/specs/2026-10-10-task-results-design.md:25`, `:33`, `:37`, `:46`, `:55-59`.
Source: `ccloop:src/controller/runLoop.ts:1538-1550`, `:1681-1687`; `ccloop:src/control/handoff.ts:308-322`; `src/control/executionDriver.ts:501-517`.

Manifest is immutable and attempt-indexed, with optional verification ref, while outputs are captured at execute stage. Verification arrives later; existing handoff retention includes phase files only for the current attempt. The spec leaves undefined how verifier arrival updates an immutable record, how an index selects the latest stage without late-response regression, and what proves older attempts' actual verification. A successful run does not prove every earlier attempt passed. Live results make this lifecycle decision unavoidable.

Recommendation: define append-only execute captures plus separately controller-bound verification evidence, or immutable successor manifests with explicit monotonic stage/revision. Distinguish not-run/in-progress/passed/failed/unavailable verifier evidence from report availability and run terminal state. Select the current attempt against authoritative progress, retain older entries only as history, and prevent out-of-order collection rollback. Criteria should cover execute-visible-before-verify, reject then retry success, handoff before verify, damaged verifier evidence, and delayed older responses.

## Assessment of controller's proposed correction

During review the controller proposed a separate optional read-only ccloop control results operation/ExecutionPort method, called from the existing collection lifecycle, with accepted-envelope-bound manifest refs. Proposed storage is dedicated `sourceDir/control/task-result-evidence` and `run/task-result-captures`, both explicitly excluded from acceptance-critical archiveRun capture; independently caught result metadata/evidence reading leaves core readEvidence unchanged. Old-pin unknown-operation responses become unsupported/missing diagnostics.

This is a feasible resolution direction for P1-1 and P1-2 and avoids changing strict candidate/collection wire shapes. It does not yet resolve them until written into the spec with these boundaries:

- The read operation must validate accepted envelope/source/generation ownership and only expose refs reachable through the corresponding validated manifest; the dedicated evidence reader must not become arbitrary filesystem/hash access.
- Produce/persist result captures at execute and verifier boundaries while the attempt workspace is alive, under the same run lease/owner fencing as other writes. Read live capture indexes atomically; reads create no files. A live request without a candidate must be supported.
- Separate metadata failure from core collection/usage/terminal handling. Do not let optional reads block usage booking or execution transitions behind repeated timeouts or unbounded retries. Define unsupported caching/invalidation against binary identity so the old pin is not needlessly probed every round and a changed build can be rediscovered.
- Exclude both dedicated namespaces from normal and handoff core archival, including continuation bundles. Retain/index eligible results before cleanup; a crash or result-capture failure leaves explicit diagnostics without changing the real outcome. Preserve existing core snapshot evidence rules.
- Identify the producer directories, responsible writer, private modes, temporary-root routing and failure residuals; this is a repository-external write surface under Orca CLAUDE.md Rule 17. Dedicated evidence requires its own bounded read method, not merely the core reader with a new path argument.
- Record result-index changes through an appropriate projection invalidation mechanism, even when no new usage event exists. The result read/UI must distinguish absent report, unsupported old producer, unavailable capture, stale snapshot and unknown execution outcome.
- Define immutable capture/verification lifecycle and decoder isolation from P2-2/P2-3; the separate endpoint does not itself solve these.

These are recommendations for the amendment, not implemented or tested capabilities.

## Shared detail surfaces and release boundary

There is a small default-region inconsistency: Progress `:45` opens Results for completed work “when available”; Results `:59` defaults completed task/group to Results. Resolve in the same amendment. Recommend always opening the result surface, including explicit missing explanation under the old pin. This is an editorial clarification, not an additional severity finding.

Authority/path requirements are otherwise sound: Agent claims are attributed separately from verifier/control/Git delivery; identity binds group/work/task/run/generation/graph/target/attempt; hash alone is not output authority; no-follow containment and inert bounded previews are explicit. These requirements are not claims that existing source implements them.

The release clauses are clear and should survive unchanged: Progress `:59-67` and Results `:69-75` require Overview compatibility with fixed ab824d1, keep package/lock/default pin unchanged, distinguish a local paired feature build from installed report production, and require later ccloop publication plus Orca repin to ship report production. No historical backfill, separate summarizer, production migration or runtime switch is included.

## Follow-through

Append rulings resolving the five findings and independently re-review those contracts before implementation decomposition. Keep progress/results as separate subprojects sharing detail navigation conventions. No tests were run or rerun, and no passing-test assertion is made.
