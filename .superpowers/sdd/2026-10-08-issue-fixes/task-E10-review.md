### Verdict: Needs fixes (1 Important, 3 Minor)

### Spec Compliance
- ✅ Order (spec §6.5): banner, graph, Work items, runs, BudgetEditor+AgentSelectionEditor, GitScheme (web/src/ControlGroupView.tsx:152-265); banner is with the alerts, before the graph (amendment 7), pinned by the order test.
- ✅ Verbs/paths: web/src/controlApi.ts ControlAction member and both `case`s; path test covers encoding.
- ✅ Locales en+zh for archivedRegion/archivedBanner/unarchive/archive (same keys, zh typed against en).
- ✅ Dispatch section wrapped in `{!archived && (<>...</>)}` with Archive group as last child (:314 on).
- ✅ Retry task / Retry run hidden on archived (run table :225 and TaskDetail via retryTaskOpen in web/src/runFacts.ts), pinned by a new test that first proves 2 retry buttons exist when not archived.
- ❌ Controller's binding requirement: "hide every other action control the server would refuse with group-archived; the only action left is Unarchive". Not met. The gate (src/control/commandLedger.ts:312) refuses every group-scoped verb except unarchive-group, yet an archived group still renders:
  - BudgetEditor (ControlGroupView.tsx:253): Estimate, Confirm, Set limit, "Use"/apply-suggestion buttons (BudgetEditor.tsx:382-488), plus the embedded GroupIntegrationConfirm.
  - AgentSelectionEditor (:257-262): save/clear overrides (AgentSelectionEditor.tsx:174-203).
  - GitScheme (:265): Retry integration, Resolve conflict (GitScheme.tsx:40,44), and its scheme control.
  - GroupIntegrationConfirm (:268).
  - TaskDetail label/loop editors (set-task-labels, set-task-loop), reached via the work-items table.
  The implementer disclosed this as a concern and cited the brief's narrower scope; the dispatch overrides the brief.

### Strengths
- Banner-before-graph and the order test include the banner in the chain (non-vacuous: banner removal turned banner+order red).
- retryTaskOpen centralizes the archived rule so TaskDetail follows without a second edit.
- Mutation evidence is named per new branch (wrapper, banner, retry hide, case, order), all seen red, done in a clone.
- Tests assert after the interaction; they do not read back their inputs.

### Issues
**Critical:** none.

**Important**
1. ControlGroupView.tsx:253-268 (+ TaskDetail editors): editing controls still shown on an archived group; each click yields a group-archived 409. Fix: do not render (or pass a `readOnly`/`archived` flag that omits the buttons of) BudgetEditor, AgentSelectionEditor, the GitScheme actions, GroupIntegrationConfirm and the TaskDetail label/loop editors when `archived`; read-only displays may stay. Add a test: archived view with an open task, assert zero buttons other than "Unarchive" and the work-item row toggles (query all buttons and compare names), plus a mutation that removes the new gating.

**Minor**
1. ControlGroupView.tsx:314-380: JSX inside `{!archived && (<>` left unindented; formatting noise in the file, accepted by the implementer only to shrink the diff. Acceptable but reindent when the Important fix touches it.
2. archiveGroup.test.tsx: the retry test never opens TaskDetail, so the retryTaskOpen change in runFacts.ts is not independently covered (the run-table check alone would pass if the runFacts edit were reverted). Add an open-task assertion.
3. The "no dispatch action" test lists four names only; it does not enumerate that Resume/continue/recovery-retry are gone (they are inside the same wrapper, so low risk).

### Assessment
Task quality: Needs fixes. The brief's content is implemented and evidenced, but the controller's binding "only Unarchive remains" requirement is not satisfied because the budget, agent, git/integration and task-detail editors remain actionable on an archived group.
