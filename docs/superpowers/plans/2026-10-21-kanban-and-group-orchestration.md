# Kanban board and automatic group orchestration — implementation plan

- **Spec:** `docs/superpowers/specs/2026-10-20-kanban-and-group-orchestration-design.md` (§9a overrides earlier sections).
- **Author:** Track C implementer, Orca session `9ec98639` (2026-10-21). Ledger: `.superpowers/sdd/2026-10-21-session-9ec98639/progress.md`.
- **Human rulings for this round:** "这次批准改写所有必要的判据"; "这一轮先不做需要brainstorm的工作"; "这一轮执行过程中如果有问题，先按你的建议执行".
  Builder choices the spec leaves open are decided here and recorded in the spec's §11 (as-built).
- **Rules:** Rule 5 (every scheduling rule is code), Rule 9 (red first, a named mutation per new branch, mutations only in a
  `git clone --local` copy), Rule 18 (`npm test` only). Each slice lands on `main` with `--ff-only` when green.

## Shared storage (one schema step, 14 → 15, landed with S1)

New STRICT tables, all `IF NOT EXISTS` (the reason `schema5To6` gives):
- `flagged_decisions(decision_id PK, group_id → groups, run_id, source, state ∈ {flagged, ratified}, body)` — S1.
- `group_orchestration(group_id PK → groups, body)` — S2: `{ mode: run|hold, confirmRevision, autoStartedRevision|null,
  refusal: {code, at, count}|null }`; S5 ladder counters live in the same body.
- `group_edges(from_group → groups, to_group → groups, created_by, created_at, PK(from,to))` — S3; `from` must land before `to` starts.
- `orchestration_settings(singleton=1, revision, body)` — S2/S6: `{ maxRunningGroups: 3, integrationCheck: {...} }`.

One step instead of one per slice: every pin of the schema version moves once (criteria rewrite, ruling above).

## S1 — flagged state on landed decisions (land first; protect-acceptance-criteria builds on it)

1. Migration 14→15 (all four tables), `schemaVersion = "15"`; update the version pins (criteria rewrite).
2. `src/control/flaggedDecisions.ts`: `flagDecision(store, {decisionId, groupId, runId, source, reason, evidence, by, at})`
   (idempotent: a second flag of the same id keeps the first), `listFlaggedDecisions(store, groupId)`,
   `ratifyFlaggedDecision(...)` (flagged → ratified, records who/when).
3. Group decisions view: each landed decision carries `flag: {state, source, reason, evidence} | null`; the view gains
   `flaggedCount` (state `flagged` only, and not corrected). A flagged decision with a correction naming its id reads
   `corrected` (derived from the corrections store at read time, nothing written — "disagree → correction, no revert").
4. Command `ratify-flagged-decision` (group target, payload `{decisionId}`, human-only), route
   `POST /api/control/groups/:groupId/decisions/ratify`, service method, web action.
5. Web: a flagged decision shows a red "flagged" badge with the reason, "Ratify" and the existing 纠正 button; the group's
   needs-you count includes `flaggedCount` as attention (shown, not blocking).
Tests: flag idempotence, ratify state + refusals (not found / already ratified ⇒ no-op-command), view mapping incl.
corrected derivation, humanOnly table, web render/click. Mutations: drop the idempotence guard; count ratified as flagged;
skip the corrected derivation.

## S2 — start on confirm, running-group cap

1. `confirm` payload gains optional `hold: true` (absent adds no bytes, like `integrationHash`); confirm's transaction
   writes `group_orchestration {mode: run|hold, confirmRevision}`. Groups confirmed before this have no row ⇒ never
   auto-started (no surprise starts on upgrade).
2. `src/control/orchestrator.ts` `orchestrateOnce(deps, now)`, called by the panel pump before wake delivery: eligible =
   row mode `run`, `autoStartedRevision === null`, group `ready`, not executionPending, no stop intent, not archived,
   prerequisites done (S3), running groups < cap. Eligible groups are started in confirm order by a synthesized `start`
   command (actor `orca-auto`, commandId `orca-auto-start:<group>:<confirmRevision>:<try>`) through `scheduleStart`.
   Success ⇒ `autoStartedRevision`. Refusal ⇒ `refusal {code, at, count}` and backoff `min(30 s · 2^(count-1), 10 min)`;
   `count ≥ 5` ⇒ the summary's `orchestration.state = "refused"` (needs-you for that group only).
3. A person's own `start` also sets `autoStartedRevision` (it was started), so nothing starts it twice.
4. Cap: `orchestration_settings.maxRunningGroups` (default 3), command `set-orchestration-settings` (global target,
   human-only), panel Global Settings field. Running = executionPending or state running/review. Debug groups
   (correction debug mark) are admitted first in the order (builder's call: "admitted first", simpler than a second count).
5. Summary field `orchestration: {mode, state: waiting-slot|waiting-prerequisite|refused|held|started|none, waitingFor?, refusal?}`.
Tests: each eligibility predicate red-first; cap; backoff; hold; person start marks started.

## S3 — group edges (person only, v1)

1. Commands `add-group-edge` / `remove-group-edge` (repository target ⇒ one revision for the repo's graph; payload
   `{from, to}`), human-only; cycle refused `group-edge-cycle` by code (DFS); self-edge refused; both groups same repo.
2. Prerequisite done (§9a.1): delivery `local` ⇒ the prerequisite's integration state is `integrated`; otherwise the
   prerequisite's tasks are all done (its `orca/<g>` branch holds the work) and the dependent's branch is created from
   `orca/<prerequisite>` (stacked) — in `ensureWorkBranch` when the group has an incoming edge and is not yet branched.
3. Blocked group holds back only explicit dependents, transitively: eligibility checks every ancestor is done; a
   dependent shows `waiting-prerequisite` with `waitingFor`.
4. Edges are recorded in the ledger as decisions by the person (Rule 13) — command ledger row is the record.

## S4 — board tab and group graph

1. `web/src/groupCategory.ts` gains `boardColumn(summary)`: clarifying · awaiting-confirmation · queued · running ·
   needs-you · done · archived (correction of §4's "reuse": the five list categories stay for the list view).
2. `web/src/BoardView.tsx` (new tab): columns, cards (goal, repo, progress, stop state, debug badge, waiting-for /
   waiting-slot / may-conflict, needs-you reason, budget used/limit, pending decisions, first failure cause).
   Drags: pause ⇄ resume, done → archived ⇄ unarchive; each exactly one existing command; refusal snaps back + text.
3. Summary gains `budget {used, limit}`, `pendingDecisionCount` (major pending + flagged), `firstFailureCause`.
4. Group graph view: groups as nodes, person edges editable (add/remove), reusing `dependencyLayout.ts`.

## S5 — escalation ladder (levels 2 and 3; level 1 deferred to the ccloop spec landing)

1. When a task's run ends `exhausted`/`failed` (not cancelled), and the task's ladder counter < 2 extra runs: open a
   debug task **inside the original group** (§9a.4) whose goal is "why can't task X pass", reusing the debug-group input
   assembly; the failed task gains a dependency on it; system-generated ⇒ estimate/confirm/start without a click (§9a.3).
   After it lands, the original task reruns once automatically (part of level 2).
2. Still failing ⇒ level 3: the task is needs-you; only explicit dependents wait.
3. Level 1 seam: `ladderLevels()` returns `[2, 3]` until a ccloop pin with the last-failure feed is detected.
4. Inter-group integration conflicts (§9a.2): the driver dispatches the existing resolve path automatically; the
   resolution is recorded as a flagged major decision (S1); `resolve-integration-conflict` stays available to a person.
   Reconcile at landing reports a flagged major decision (§3.5).

## S6 — whole review, integration check layer

1. Per-project setting `integrationCheck: {enabled, command|null}` (repository settings); global defaults.
2. Trigger (code): ≥2 groups landed (integrated) since the last check AND (no group running or ≥6 h since the last check).
3. Runs the per-project command, or every landed group's required checks, on the merged target in a scratch worktree
   (as `debugRepro.ts` runs commands). Red ⇒ open a debug group directly (§7a.3 of the protect spec), system-started.
4. Model review layer: deferred if time does not allow (recorded in §11).

## Verification

Each slice: `npm test` (background, log to file, read back whole) after rebase on `main`; per-slice mutation list in the
ledger; load flakes per `docs/handoff/known-load-flakes.md` re-run singly before being called regressions.
