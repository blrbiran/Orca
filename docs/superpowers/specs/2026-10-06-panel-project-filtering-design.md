# Panel project filtering and all-projects view — design

Owner: Codex session `01a10aca`; date: 2026-10-06 Asia/Shanghai.
Status: written design for human review; no implementation yet.
Source observation: default Orca main, subject `build(deps): pin published ccloop Codex skill support`.
This is a follow-up to `2026-10-04-panel-project-switcher-design.md` §6. Its historical text remains unchanged.

## 1. Intent and agreed scope

The human approved this sequence: project filtering, N2 agent entry, then isolated real integrations and known-red diagnosis. The human explicitly requested an all-projects view and approved continuing the written design.

Success: choosing a project shows only its control groups and Decisions; choosing All projects shows the combined lists with repository identity. Looking at all projects never creates a multi-repository operation. Running tasks continue when the browser changes its view. Global recovery and uncertain command evidence stay visible.

This round includes Task control, Decisions and the requirement list that shares control groups. New requirement and import forms need an explicit concrete target in all-projects mode. Chains and Memory continue operating on a concrete project, with that project named; Metrics stays global. No N2, scheduler, agent, ccloop or ccmem behavior change, no user-data migration or panel restart.

## 2. Observed gaps and approaches

`ControlPanel` renders all `summary.groups`, although its import form already takes a chosen repoId. `GroupSummaryV1` has no repository field. Decisions has an independent repository filter. Requirements also lists all requirement-bearing summaries. App retains open group/decision/requirement selections across project changes. The shared control reducer merges incremental summaries and must continue receiving the whole control projection.

Three approaches:

1. Recommended: add authoritative repoId to each group summary, then filter render projections in the browser. Keep server polling, recovery and command semantics global. This fits the current full/incremental summary model and avoids requests for every unopened group.
2. Fetch every group's detail to discover its repository. This multiplies requests and cannot cover clarifying groups using the normal group endpoint; that endpoint intentionally refuses them.
3. Add repository-scoped summary endpoints/cursors. This changes projection/reset semantics and can conceal cross-project blockers; unnecessary for a presentation filter.

Choose approach 1. Repository filters are UI scopes, not authorization boundaries; the panel still has access to its trusted registered repositories.

## 3. State and sidebar

Keep the existing concrete `project` selection and `orca.project` storage key. Add an independent view mode, `project | all`, stored at `orca.projectView`. Missing, invalid or inaccessible storage defaults to project mode. Storage failures never prevent rendering. All is a mode, not a magic projectKey or repoId; real project keys cannot collide with it.

The existing sidebar selector offers All projects when two or more projects are listed. Selecting a concrete entry updates the existing concrete project, persists it, and sets project mode. Selecting All projects changes only view mode; it retains the concrete project for sections that require one. Changes from existing per-section project controls choose a concrete project and return to project mode. With one project, no all-projects option is shown; a stored all mode becomes project mode. With none, both scoped lists are empty and create/import is disabled. A failed project-list read leaves scope unresolved and shows a loading/unavailable note rather than briefly displaying another project's rows.

No duplicate All projects option is added to Decisions. Its repository dropdown becomes the same selector/view of this global scope, built from registered projects rather than only projects currently having decision rows. Kind and decision-scope filters remain independent and survive project switches. New view mode is viewer state, not a server field, and is not synchronized across tabs beyond reload.

## 4. Authoritative group identity and compatibility

Add required `repoId: idSchema` to `groupSummarySchema` and the matching web type. Production `readGroupSummary` always emits it:

- Non-clarifying group: use the validated archived plan's `plan.repoId`.
- Clarifying group: use `readRequirementGroup(...).requirement.repoId`.
- A requirement-bearing group after acceptance must agree with its archived plan; disagreement blocks the read with reason `group-summary:repository-mismatch`, never a guessed repository.

The shared schema applies to summary reads and nested summary objects in group and requirement views. The same group must have the same repository in all representations. Its identity survives draft/ready/running/done, clarification acceptance, pause and resume; filtering does not rewrite persistence.

Retain existing `orca-control-*-v1` schema labels: this is a field extension shipped with the bundled client/server. Strict older clients may reject new summaries; the deployment is the matching Orca client/server pair, not a mixed-version compatibility promise. Missing repository identity is rejected by the new wire schema rather than inferred from group names, display labels, cached details or current project. Existing synthetic fixtures need only their genuine repository field added; assertions and behavioral meanings are retained. Missing-identity negative fixtures remain negative. The implementation plan must enumerate affected fixtures before editing and report any unrelated criterion failure rather than weakening it.

## 5. Render projections and selection lifecycle

Poll and merge complete/incremental summaries exactly as today. Apply display scope after the reducer: all mode includes every known group; project mode includes only summaries whose repoId equals the server-provided `controlRepoId`. A concrete project with null controlRepoId shows no control groups and the existing not-under-control note. Requirements uses the same scope before selecting requirement-bearing rows. Global group cache is kept; switching projects must not manufacture resetRequired or refetchRequired, clear drafts, or stop the wake pump.

All-projects group/requirement rows show repository display name via the trusted projects join. If a group's repository is no longer listed in config, use the explicit repoId as fallback, never another project's display name. Opening an existing group's operations acts on that group's own canonical plan/repository. Workspace setting shown in its detail must be for that repository, not the last concrete project's workspace. Avoid stale workspace replies replacing a newer group's/project's state.

Changing view mode or concrete project closes group, requirement and decision detail selections. Preserve cached bodies and control drafts keyed by their existing group/task keys. Reopening the same group exposes its existing draft; do not clear unsent text. Selection-dependent reads/previews must not reopen an old group's detail after switching. Decision arrivals are rejected using the existing wanted-key mechanism; clear decision outcome/correction detail with its selection. Already-sent commands continue reconciliation and their outcome is not discarded.

Decisions rows are first restricted by selected project (or all), then by kind/scope. Its count is shown/total within the selected repository scope; all mode uses the combined total. Same decision id in two repositories remains distinguished by `(projectKey,id)`. Changing kind/scope retains the existing hidden-by-filter detail behavior; changing repository/view mode closes details. A project with no rows shows the normal empty-review state, not data from another project.

## 6. Concrete-target forms and draft preservation

In project mode the import/new-requirement target is the selected project's trusted controlRepoId, as today. In all mode each creation/import form shows a concrete repository selector with an unselected placeholder and disables submission until the person chooses a valid target. No auto-selection of repositories[0] or silent reuse of last project. Choices are form-local and do not leave all mode. Import plans are restricted to that target; no matching plan disables import. A null/not-held repository cannot be selected as a control target.

Entering all mode resets the form's target confirmation, not its unsent contents. A target change must not carry an unsent requirement into another project silently: retain draft content keyed by concrete target, and show a fresh/previous draft for the newly selected target. Re-entering a known target restores its text. Repository-specific selected plan is restored only while it remains in that repository's allowed plans. Other global settings stay global. No new server write or filesystem draft store is added.

Chains/Memory show their existing concrete repository selector and name in all mode; they do not aggregate into a new cross-project action. Metrics remains explicitly global.

## 7. Global recovery and command uncertainty

Filtering lists must not filter epoch/dispatchBlocked/reset/refetch indicators, recovery blockers or unresolved command IDs. Show all uncertain commands, including commands in another project, with commandId/groupId and repository name when known. Unknown ownership stays explicit and visible.

RecoveryView continues using the complete recovery response. A selected group's recovery controls use only that group's view; do not pass another project's cached group as context. Global recovery actions retain their existing server contract. Changing scope never cancels/retries a command automatically or treats a hidden run as completed.

## 8. Errors and race boundaries

- Projects unavailable: no ambiguous scoped content/actions; global recovery remains visible. Retry follows current project refresh behavior.
- Stored concrete project removed: use existing first-listed fallback, close incompatible details, revalidate targets and drafts. All mode remains all while at least two projects exist.
- No control registration for chosen project: empty scoped groups/requirements and disabled creation, Decisions may still exist.
- Stale detail/workspace/preview responses: can populate canonical cache only where existing rules allow; cannot change the current selected identity or attach another repository's workspace to it.
- Refusals/errors from issued commands remain visible across scope changes.

## 9. Verification and mutation criteria

All runs in isolated clones, short real TMPDIR, temporary HOME and four XDG roots; no real ~/.orca, paid model, real ccmem/syncskill, panel restart or push.

| Criterion | Required observation | Named deletion/change that must fail |
|---|---|---|
| server summary ownership | plan and clarifying repoId, complete/incremental and nested views agree | omit repoId; replace it with first repository; misroute clarifying identity |
| protocol boundary | missing/invalid repoId refused | remove required repoId schema check |
| two-project lists | project A/B only their groups, requirements and decisions; all shows both with names | remove each filter or all branch; join name using selected project |
| switch lifecycle | old detail closes; late response stays closed; per-group drafts survive | remove each selection reset/arrival guard; clear drafts on switch |
| decision identity/count | duplicate ids in A/B handled separately; empty A stays empty; local counts | compare id only; count global rows under project scope |
| explicit creation targets | all mode cannot submit before choice; payload/plan belong to chosen repo | fallback to first/last repo; omit plan restriction |
| requirement drafts | change target restores its own draft and never copies another's | reuse one unkeyed draft across targets |
| group workspace | all-mode B detail uses B workspace despite last concrete A; late A reply ignored | use current concrete workspace or remove arrival guard |
| global visibility | hidden-project blocker/unknown command remains visible | scope recovery or selected-only waiting list |
| persistence/fallback | both modes survive reload, invalid storage safe, one/zero projects safe | drop mode storage read/try-catch/one-project normalization |
| poll stability | incremental update to B while viewing A stays cached, switching/all shows latest without reset loop | filter reducer inputs or trigger reset on scope change |

Proposed executable gates (new criterion file names):
- `rtk proxy npm test -- tests/panel/projectGroupScope.test.ts tests/control/webProtocol.test.ts`
- `rtk proxy npm run check --workspace web` (its existing script runs TypeScript and the full web Vitest suite).
- Focused web command from the `web` directory: `rtk proxy ../node_modules/.bin/vitest run tests/projectFiltering.test.tsx tests/projectSwitcher.test.tsx tests/projectRegistry.test.tsx tests/controlPollSettles.test.tsx tests/decisionsView.test.tsx tests/decisionDetail.test.tsx`.
- `rtk proxy npm run typecheck`, `rtk proxy npm run --ws check`, `rtk proxy npm run build --workspace web`, `rtk proxy npm run verify:control`, `rtk proxy npm run verify:panel`.
- Final isolated Orca full suite and named deletion mutations against clean independent baselines. Record every failure/skip and compare restored raw diff/cached diff bytes to zero.

No verification result is claimed by this design; new criterion files are to be created during implementation.

## 10. Risks and review decisions

Required summary identity causes structural fixture work; strict client/server coupling is deliberate. Keeping global cache/recovery avoids hidden running work, but means filtering is presentation only. All mode retains a concrete project for Memory/Chains, so visible project labels and explicit creation targets are necessary. Closing details on scope changes costs reopening a row, chosen to avoid accidental cross-project edits. Per-target requirement draft preservation is in-memory only, matching the browser's existing draft lifetime.

Review decisions: confirm the separate view/target state; global selector and shared Decisions control; required repoId on summaries; explicit blank-target creation forms in all mode; selection resets with draft preservation; requirement list follows scope; global recovery and Metrics remain visible. These implement the agreed all-projects requirement without adding multi-repository execution.

Next gate: human reviews this written spec, then implementation planning begins. No product code or test criteria have been modified.


## 11. Review corrections — 2026-10-06, session 01a10aca

Owner: Codex session `01a10aca`; human requested fixing the three spec review findings. Original §§1–10 are preserved byte-for-byte from subject `docs(spec): design project filtering and all-projects view`. This section takes precedence where §5's selection/draft/arrival text, §7's recovery text, and §9's criteria were incomplete. No product implementation or runtime validation is implied.

### R1 — Recovery revision belongs to the blocker target

Source finding: `web/src/RecoveryView.tsx` currently takes one selected group's commandRevision and reuses it for every global blocker. Keeping this behavior is prohibited by this correction; keeping the existing server command contract does not mean keeping that client wiring.

For every actionable blocker, bind a target tuple `(epoch, groupId, repoId, runId-or-null)` independently of the open detail and viewing scope. Obtain expectedRevision from the validated current global summary entry whose groupId equals that target groupId. This summary covers both ordinary and clarifying groups, so a clarifying blocker never requires the normal group-view endpoint that refuses it. Repository identity is the target summary's repoId, not the concrete project's current repoId. The recovery payload's group/run identity remains the blocker identity from the server's recovery view. An empty/global groupId, missing summary, mismatched epoch, pending complete refetch or unresolved target ownership disables the retry button; display the blocker and a re-read affordance instead. Re-reading only refreshes evidence and cannot issue a recovery command automatically.

Build the action at click time from that target's current summary and the still-listed blocker; do not capture a revision from an unrelated selected detail. If the blocker disappeared or its group identity is no longer resolvable, issue no command. If the server's revision advanced after the read, retain the ordinary revision refusal and re-read; never substitute another group's revision or automatically replay the retry. Changing project/view mode affects neither ownership nor command reconciliation. Unknown or not-listed repository names use the explicit target identity as their label.

Acceptance: select A at revision 3 while a global B blocker has revision 9; retry B sends group B and expectedRevision 9. Repeat with a clarifying B and a run-scoped B blocker. A target lacking a valid summary or an epoch changing during refresh must remain visible but non-actionable. A vanished blocker cannot be retried from its old rendered button. Named mutations: use selected-group revision; fall back to first summary; omit target/epoch/refetch checks; allow a vanished blocker; route a clarifying target through the normal group view. Each must fail a focused criterion.

### R2 — Detail drafts outlive detail selection

Source finding: requirement `RoundForm` answer choices and glossary/ADR decisions, and `DraftReview` feedback, live in component-local useState. Clearing selectedRequirement unmounts the detail; existing control.drafts does not own these fields. Thus preserving only control.drafts is insufficient for §5's unsent-text promise.

Retain editable drafts in App-owned in-memory state (or an equivalent owner that stays mounted across detail closure), with structured identity keys:

- New requirement: concrete repoId; retain idea, token limit, content language and chosen agent together. An unconfirmed all-mode target cannot receive another repository's draft. Choosing the original target restores its draft as §6 requires.
- Requirement answer: `(repoId, groupId, requirementId, roundNo)`; retain per-question recommended/custom choice and custom text, plus glossary/ADR accept/reject selections keyed by their entry IDs.
- Split feedback: `(repoId, groupId, requirementId, draftNo)`; retain feedback text.
- Other editable requirement-detail inputs, including raised token limit, are group-owned; do not reset typed values on detail closure. Confirmation-dialog visibility is transient and is not a draft.
- Decision correction: `(projectKey, decisionId)`; retain kind, because and chose_instead outside the currently mounted uncontrolled form. This is covered by the same unsent-work promise when decision details close.

Existing task/control drafts retain their current identities. Scope or selection changes never clear these stores. Selecting another owner restores only that owner's draft or its defaults; it never copies the previous owner's values. Reload persistence is not added: draft lifetime is the current App instance.

Retained drafts are not server facts. On reopening, check the current server identity and editable state before offering submission: a changed round/draft number or an already answered/accepted round cannot reuse the old draft as the new round's input. Only current question/entry IDs can appear in a payload. Old drafts may remain dormant in memory; do not silently migrate them. Successful submission may clear only the submitted identity's unchanged draft snapshot; text edited after submission started must not be cleared by its eventual success. Failure preserves the original draft. Scope changes do not cancel the issued request or reset its ownership.

Acceptance: type custom answers and glossary/ADR choices for A, type split feedback and a decision correction, switch A → B → A and verify each value survives with its original owner. B must show its own/default content. Advance A's round/draft while closed and verify the retained old draft is not submitted against the new identity. Resolve A's submission after editing a newer draft and verify newer text survives. Named mutations: leave any affected draft solely in the unmounted detail; key by roundNo/draftNo/id without owner; reuse previous owner's inputs; drop current-editable-state/entry checks; unconditionally clear on delayed success. Each must fail.

### R3 — Decision command outcomes and retries retain request ownership

Source finding: App's wanted-key guard currently protects decision GET arrivals only. Its POST `send` applies success/refusal unconditionally; the retry closure reads current lastCorrection. Neither is sufficient when A's request finishes after B is opened.

Before sending Agree or Correct, capture an immutable request record: client request identity, `(projectKey, decisionId)` owner, verb, and an independent copy of the exact submitted payload. Client request identity is only a browser correlation token; it is not a new server idempotency field or a guarantee about retry execution. Track pending and completed results by that request identity in App-owned memory, independent of selected detail.

Every POST completion updates only its original request record, including success, server refusal or transport error. It may update the current detail's inline outcome only when both the selected decision owner matches and the request is the current active submission for that owner. A later request for the same owner cannot be overwritten by an earlier request completing last. Switching scope clears the visible detail selection/outcome, not the request records. GET arrival checks remain in place and are not used as a substitute for these POST checks.

Show pending/results belonging to a hidden or no-longer-selected owner in a global, owner-labeled decision-operation notice outside the detail slot; it remains visible across section and project changes. It names project and decision plus status, so an old refusal never appears as an error from B. Success can refresh home/todo without changing the selected scope or reopening A. Visible old results may be explicitly dismissed; switching scope does not dismiss them. This is bounded browser state, not a durable operation history or a new server API.

A server-permitted Record another retry is attached to the exact refused request record. Its handler copies that request's stored correction payload, sets `again: true`, and sends a new request record with the same owner; it never reads B's current lastCorrection or current form. Agree/transport errors do not acquire a correction retry affordance merely because another request was a correction. Follow the existing API's refusal rules; no automatic POST replay or invented idempotency is introduced. A retry of a hidden owner's correction must display that owner beside its button, and stale handlers cannot change the target payload.

Acceptance: submit A's correction, switch/open B, then resolve A with success and refusal in separate cases; B's inline outcome stays untouched and the global notice names A. If B also submits a correction, retry A uses A's exact saved payload with again true. Issue two requests for the same owner and complete them in reverse order; the latest inline outcome stays the latest request's. Switching scope with no selected decision still retains attributable pending/results. Named mutations: unconditional setOutcome on POST return; guard owner but not request identity; retry current lastCorrection; remove old-owner global notice; discard records on scope change. Each must fail.

### Review disposition and executable verification additions

All three findings are addressed by the normative constraints R1–R3; this is a design correction, not a claim that the existing code is fixed. Supplement §9 with `web/tests/projectScopeRecovery.test.tsx`, `web/tests/projectScopeDrafts.test.tsx` and `web/tests/projectScopeDecisionRequests.test.tsx`. From the web directory, run:

`rtk proxy ../node_modules/.bin/vitest run tests/projectScopeRecovery.test.tsx tests/projectScopeDrafts.test.tsx tests/projectScopeDecisionRequests.test.tsx`

The implementation creates these criteria, observes each named mutation fail in an independent clone after a green baseline, restores raw diff/cached diff to zero bytes, and includes them in the existing full web/control/Orca gates. They use controllable fake responses only; no real user roots or paid model calls. The implementation plan must include the draft owner store, target-summary recovery wiring, request-result ownership and global notice placement explicitly rather than treating selection clearing alone as completion.

Status after correction: written spec ready for human review; implementation planning still waits for written-spec approval. No product code, tests, cross-repository interface or server command wire field changed in this correction.

## 12. Plan and implementation decisions — 2026-10-06, session 32306496

Plan-time decisions (verbatim from the plan's global constraints; ledger `.superpowers/sdd/2026-10-06-panel-project-filtering/progress.md`):

- **P1 — unresolved scope.** Before `/api/projects` has answered, or after it failed, control groups and
  requirements are not listed; a note says the project list is unavailable; import/new-requirement are disabled;
  recovery, uncertain commands and alerts stay visible (spec §3, §8). Existing App-rendering tests that list
  groups or requirements never served `/api/projects`; they get a one-project route (allowed edit (b)) whose
  `controlRepoId` is the file's own first configured repository. Assertions unchanged.
- **P2 — Decisions under unresolved scope.** Decision rows name their own project and Agree/Correct act on the
  row's own `projectKey`, so they are not ambiguous: with no project list the Decisions pane shows every row
  and keeps today's repository filter. With a project list it uses the global scope (spec §3/§5).
  This keeps `appSelection`/`decisionsI18n` (rows of unregistered keys) untouched.
- **P3 — workspace in All projects.** The panel-level workspace-mode selector is shown only in project mode, for
  the selected project's repository. In all mode it is hidden; an open group's detail always gets the workspace of
  its own `plan.repoId` (spec §5), read into a per-repository map.
- **P4 — uncertain commands.** The panel's "outcome unknown" line lists every unresolved command (all groups, all
  projects) with its repository label; the open group's detail still receives only its own (spec §7).
- **P5 — repository label.** `repoLabel(repoId)` = the registered project whose `controlRepoId` equals it
  (its display name), else the config repository's `displayName`, else the raw `repoId`. Never the selected
  project's name.

Implementation-time rulings that changed product behaviour or an existing criterion (ledger `Ruling:` lines):

- **Criterion F rewritten (Task 4).** `web/tests/projectSwitcher.test.tsx` "F" (switcher spec D2: import into the first repository when `/api/projects` fails) is rewritten as a whole, not weakened: with `/api/projects` failing there is no Import button, the project-list-unavailable note is shown in the Import region, no import is POSTed and there is no Project combobox. This follows §3/§8 and P1; the newer approved spec supersedes D2's fallback for scoped actions.
- **R1 epoch-change reducer (Task 7).** `reduceRecovery` on an epoch change keeps the purge (groups and canonical voided, `refetchRequired` true) but stores the arriving recovery view, so blockers stay visible and non-actionable until the complete refetch lands (§11 R1).
- **R2 unowned adoption and target reset (Task 8).** Inputs are enabled with no all-mode target; unowned text is adopted on an explicit target choice and dropped on any explicit target choice, never resurfacing later; a target no longer held is reset (form-local) and submission stays disabled until a valid target is chosen (§6, §8).
- **R3 notice excludes only the inline record (Task 9).** The global notice excludes only the record shown inline, not the whole owner, so an open owner's older non-active refusal stays visible (§8 visibility); eviction never drops a pending record; settled records go oldest first within the order dismissed, recorded, refused (an unseen refusal is the last to lose).
- **Decisions under unresolved scope (P2).** With no project list the Decisions pane keeps every row and today's repository filter; with a list it uses the global scope.
- **Workspace P3 hiding.** The panel-level workspace selector is shown only in project mode; an open group's detail reads the workspace of its own `plan.repoId`.

Sections 1–11 are unchanged by this appendix (checked with `git diff`: appended lines only).
