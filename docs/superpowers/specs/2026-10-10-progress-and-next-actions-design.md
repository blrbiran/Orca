# Project progress and next actions

Owner: Codex controller, 2026-10-10 Asia/Shanghai. Human approved the conversational direction and explicitly authorized completing specifications, independent review, plans and subagent-driven implementation in this session, with questions/rulings reserved for the final audit. This replaces intermediate human review stops for this round; it does not authorize publication, production-data migration or service switching.

## 1. Intent and scope

On opening Orca a person should see what is progressing, what needs their intervention, and where to take the next action. Add an independent Overview as the default for an empty or unrecognized section hash. Preserve recognized deep links and the current section on reload. Layout B is binding: progress is primary; human work is alongside on wide screens and follows progress on narrow screens.

The human queue includes exceptions and explicit human steps: clarify answers, review split, review/confirm budget, ready-to-start, review decisions, recovery, stopped work and unresolved command outcomes. Normal running, model drafting, queued estimation, dependency waiting and automatic goal review are progress, not owed human work.

No automatic confirmation, start, retry, budget settlement, notification-history system, cross-group scheduler, wizard, UI skin replacement, cost estimation or historical performance rerun. Existing command semantics, authorization, frozen selections and evidence boundaries remain authoritative. Results/report generation is a separate specification, linked below.

## 2. Overview projection

Add `GET /api/control/overview` and matching strict server/browser DTO `orca-control-overview-v1`. It is read-only and has `epoch`, `changeSeq`, `groups`, `steps`, `issues`; archived groups are excluded. A group exposes its existing identity, goal, authoritative plan-task completion/counts, requirement progress if present and actual group state. It does not label all completed plan tasks as a completed group: `review` remains goal review, `done` is separate from Git delivery.

Steps are factual navigation hints, never command authorization. Each step has stable key, group/repo/task/run identity when known, kind, reason code, destination and optional `ownerRequired` explanation. Kinds: `requirement-answer`, `requirement-review`, `requirement-attention`, `budget-review`, `start-review`, `task-attention`, `stop-review`, `recovery-review`, `integration-review`. Destination is a discriminated union of requirement, group region/task/run, or global recovery. No `ControlAction`, command id, payload or executable URL is returned.

Use current stored proposal, requirement, work/run, wake, integration and blocker facts, not the selected browser detail cache. Share existing request-local `GroupReadSnapshot` decoding; do not issue one read per task or run, capability probes or full detail HTTP fetches for every group. Groups are read coherently with projection revision; no asynchronous gap may combine different source epochs. Bounded additive reads per group are acceptable, whole-page constant SQL counts are not claimed. A malformed owned group yields an explicit issue and does not hide healthy groups or become zero tasks.

### 2.1 Exact human-work rules

- Clarifying current round `awaiting-answers` produces an answer step even if `openQuestions` is zero. Current split `awaiting-review` produces a review step. Accepted historical draft never produces split review. Requirement budget/usage/blocked-run/export-conflict states produce requirement attention; accepted export problems still go to Requirements, accepted budget/start work goes to Tasks.
- Editable proposal produces budget review only when no estimate is queued/running/start-unknown. Label it preparation/review, not “Confirm is enabled”: agent preview, valid drafts, owner integration approval and server revision must still be checked in detail.
- Ready-to-start is a review step only for a confirmed/frozen ready group with an actually claimable idle task, no active/start-unknown/held/continuing execution, no pending start/resume/continuation wake, no stop/recovery/claim/unknown-usage obstruction, and accepted requirement export done. Existing server graph/profile/proof checks may still refuse after navigation. A started group that remains `ready` is not automatically a human start item.
- Blocked or failed tasks, unknown execution/usage, held continuation requiring a person, stop/pause requiring a person, integration conflicts/approval and recovery blockers retain their actual reasons and owner. A handoff still settling is a visible observation step, not a promise that recovery is ready. Ordinary dependency waiting is excluded.
- Deduplicate the same recovery source `(scope,groupId,runId,code)` while preserving distinct reasons. Do not collapse multiple failed tasks to an unrelated group warning. Stable keys prevent row churn. Exceptions precede preparation steps; same-priority steps sort by stable identity, not invented urgency.

## 3. Browser composition and navigation

Overview derives scoped progress and queue from the overview projection plus unfiltered `home.todo` and client uncertainty/recovery facts. Decision identity is `(projectKey,id)`; ordinary decisions list filters must not suppress owed decisions. No information or reasoning is marked opened/reviewed merely by rendering Overview. Global safety blockers remain visible in any scope. Unknown owner/registry mappings remain honestly labelled; do not guess a project or display “none” while the source is unavailable/stale.

Project scope is the existing global scope. All-project rows name their project and navigate to the owning detail without borrowing another project's revision or drafts. A navigation target is revalidated against current sources; removed/archived/stale owners trigger reread or a clear unavailable message. All-project scope may remain All. Navigating from a concrete project must deliberately select the target context and then open the correct detail after scope-close effects; late responses cannot reopen the prior owner.

Overview only navigates. Requirement entry opens that exact requirement and requested region. Group entry opens the exact group and, where applicable, task/run with focus on budget/dispatch/recovery/integration. Decision entry opens the exact composite identity. Unknown import/command outcome links to its existing control lookup/recovery region. Navigation submits zero POST and does not regenerate command intents.

Hash sections become `overview`, existing sections, `global-settings`, `project-settings`. A valid hash stays intact across mount/reload. App continues to own state, data refresh, drafts, identity checks and all mutation callbacks. Pure views never take over command submission. Poll overview only while its pane is active, using the existing changeSeq freshness strategy; no persistent full-group/result fetch loop.

## 4. Settings and detail hierarchy

Two distinct settings entries are binding. Global settings compose theme/language, account/password/user-management and existing panel-wide Agent defaults. These defaults are the shared panel operator's actual scope, not falsely described as per logged-in user. Existing AuthGate account operations retain their authentication/permission behavior. Project settings compose workspace mode and default integration for an explicit concrete repository. All projects/unresolved scope requires choosing a concrete target; never save into an implicit prior project. Project picker remains visible; importing a plan remains an operation in Tasks and Overview.

Group-specific budget, frozen Agent/skill selections and actual integration stay in detail. Defaults do not rewrite already-confirmed groups. Do not remove a currently valid action simply because the group belongs to a broad visual state. Server/current eligibility and existing UI guards decide controls; archived groups remain read-only except unarchive.

Detail presents goal, current state and a next-action explanation first. Then use focused regions rather than one uninterrupted page: progress/dependencies, startup/budget/Agent preparation, problem/recovery handling, results (separate spec), runs/evidence and technical details. Draft opens preparation; ordinary active opens progress; an attention target opens its relevant problem/action; `review` says goal review; completed opens results when available. Navigation from progress can explicitly open progress; navigation from a queue overrides the default to focus the owed action. Keep selected tab/region stable during normal polls; an arriving state update must not steal focus or discard drafts.

No ready/start inference from broad states alone. Task completion, goal acceptance, explanation availability and Git delivery are independent visible facts. Inputs retain integer units, exact-value access and existing budget confirmation flow.

## 5. Failure, authorization and accessibility

Keep source-unavailable/stale/epoch-reset/command-outcome-unknown distinct from an empty queue. Refetch failure retains visibly stale previous data or an unavailable state, never a fabricated zero. Member viewers can see relevant owner-required work with the explanation and destination; they do not gain controls or API permissions. Reuse existing permission table, CSRF and principal/operator semantics.

Both English and Chinese, placeholder parity and pseudo-locale layout are required. Keyboard navigation, labelled buttons, live updates and focus after detail arrival must work. Progress precedes queue in DOM and mobile layout. No viewport overflow on desktop, 390px and short-height screens; existing authenticated-shell frame and internal scrolling are retained. This round will use the supported browser HTTP surface for actual geometry rather than equate CSS/jsdom tests with visual acceptance.

## 6. Acceptance

Independent tests exercise every human-step rule, current proposal/wake identity, ready-with-active exclusion, zero-question answers, accepted requirement ownership, archived/stale/malformed data, project filtering, owner/member visibility, decision composite identity and uncertainty without extra command POST. App criteria prove owner GET plus requested focus/region, old-epoch/late-response behavior, hash preservation and settings target ownership. Read-counter criteria prove no per-task/per-run SQL expansion and no capability/model calls.

Full Web/typecheck/build and root integration gates, panel after web build, pin/default criteria and temporary-root leakage checks run on the final tree. Root tests use the fixed `ab824d1` clone build and fake integration agents, with HOME/XDG/TMPDIR/CCMEM_DATA_ROOT redirected and CCMEM_CONFIG_PATH absent. Existing skipped real launchd, legacy ledger downgrades and named failure evidence remain explicit. No paid provider, real database migration or production service action.

For every added load-bearing branch, demonstrate an independent deletion mutation fails its intended business criterion in a clone, restore exact source and verify working/cached diff bytes are zero. Review is task-scoped plus one whole-branch review; fixes are re-reviewed. Source-test expectation changes required by these new human choices are recorded by exact name and reason, not turned into flake waivers.

## 7. Work and release boundary

Implement on `codex/progress-results-20261010` in the managed Orca worktree. Keep main and production runtime intact. Updated handoffs use topics/paths rather than requiring a current HEAD. Sister handoffs replace the existing Orca rolling section; executive summary is chat-only and at most ten lines. Human authorized autonomous design/implementation rulings and final audit; publication/merge/deletion of this new work is a separate final integration decision.

Related spec: `2026-10-10-task-results-design.md`. The results producer may need a new ccloop build, but the Overview feature itself must work on the current pin.

## 8. Independent-review rulings (controller, 2026-10-10)

This section supersedes conflicting earlier freshness/default-region wording. Source review is `.superpowers/sdd/2026-10-10-progress-results-design/independent-spec-review.md`.

P2-1: decision todo has independent freshness. Fetch unfiltered todo independently of metrics while Overview is active, initially and every 5000 ms; control overview retains its control/changeSeq polling. Track loading/available/stale/unavailable separately. Latest-request tokens and auth/epoch/scope identity prevent older replies replacing newer source state. An external decision/review change with unchanged control changeSeq must appear by the next successful todo refresh. Metrics failure must not discard successful todo/control reads; the shell and Overview render with explicit source issues even when metrics are unavailable. Do not display zero owed decisions or a zero badge for an unavailable source. Non-overview metrics views retain explicit metrics failure handling. Active-only timers are cleaned up on auth/unmount/pane change; no decision detail reads or opened/reviewed writes accompany todo refresh.

Shared detail default: completed work opens the Results region even when explanation is missing, so the missing state is visible. A user's current region remains stable through polling; explicit navigation targets override the default.
