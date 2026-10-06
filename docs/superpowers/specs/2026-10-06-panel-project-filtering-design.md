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
