# Task E10 report
Commit a089391 feat(web): put the graph first, and archive or unarchive a group from its view.
Implemented per brief, plus: archived-banner-before-graph (amendment 7); on an archived group the Retry task / Retry run buttons
(run table, and TaskDetail via retryTaskOpen in web/src/runFacts.ts) and the whole dispatch section (Start, Pause, Handoff stop,
Resume, continue, recovery retry, Archive) are hidden; only Unarchive remains. Pinned by the test "offers no retry on an archived group".
Order: banner, graph (E9 line unchanged), Work items, runs, BudgetEditor+AgentSelectionEditor, GitScheme.
Tests: RED 5/5 before (e10-red.txt); GREEN 5/5; npm run typecheck rc=0; web check 87 files / 687 tests rc=0.
Mutations (clone, all seen red): wrapper removed -> dispatch test; banner removed -> banner+order tests; retry hide removed -> retry test;
case "archive-group" removed -> path test and tsc TS2366; BudgetEditor above banner -> order test. Worktree staged diff 0 bytes after commit.
Concerns: BudgetEditor, AgentSelectionEditor, GitScheme, integration confirm, TaskDetail editors (labels/loop) still render their
buttons on an archived group; the server refuses them with group-archived. Brief and ledger scoped hiding to dispatch/retry. Indentation
inside the {!archived && (<> fragment was left unshifted to keep the diff small.

## Fix round 1 (commit 58825bc, fix(web): offer nothing but Unarchive on an archived group)
Ruling applied: on an archived group only Unarchive remains. One `archived` flag from ControlGroupView (derived once from
summary.archived) is threaded as an optional `archived` prop to BudgetEditor, AgentSelectionEditor, GitScheme (IntegrationState),
GroupIntegrationConfirm, TaskDetail and LoopPlanCard. Hidden: Use / Apply row / Apply all / Set limit / Save proposal / Re-estimate /
Confirm budget, the embedded integration form (via the `editable` gate), Re-read and every agent Set/Clear, Retry integration and
Resolve with an agent, the standalone integration form, label editors (Remove, Add system/custom, Save, Discard, Restore), the loop
plan Change form, and Retry task in the task detail. Budget inputs become read-only. Read-only displays stay. retryTaskOpen
(runFacts.ts) still carries the archived rule, and TaskDetail also checks `archived` (two layers, mutated together).
Minors: reindented the dispatch fragment; "no action" tests assert by role (every enabled button outside graph/row toggles/evidence
reads must be exactly "Unarchive", and no writable textbox or combobox); new TaskDetail-on-archived test, plus a full-editor fixture
test (editable proposal, ready estimate, agents + preview, conflict integration, loop-plan task, draft edit) whose baseline proves
16 button kinds exist before archiving.
Results: archiveGroup 9/9; typecheck rc=0; web check 87 files / 691 tests rc=0 (before commit).
Mutations (clone made after the commit, outputs m2-*.txt in the scratchpad), each seen RED: budget Use (loop), Use (field), Apply row,
Apply all, Set limit, Save (wrapper+editable), Re-estimate, Confirm, editable gate (integration form inside budget), agent Re-read,
agent group slots, agent task cell, Git actions, standalone integration form, TaskDetail label block, Remove button, Retry task
(TaskDetail+runFacts), LoopPlanCard, and the four ControlGroupView prop pass-throughs (task, budget, git, agent). Worktree: no
unstaged web diff, 0 staged bytes after commit. Note: Save and Retry task are each guarded twice (disabled state / retryTaskOpen), so
those mutations remove both layers.
Concern: AgentSelectionEditor on an archived unconfirmed group still shows the resolved-slot table (read-only).
