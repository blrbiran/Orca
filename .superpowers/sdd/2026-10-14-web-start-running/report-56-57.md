# #56+#57 implementer report (hand-back saved by controller, session 02f047f6)
Commit 9480ffcb fix(web): offer retry, settlement and saved-result verify where the problem shows.
- Retry: Runs-table cell extracted as RunRetry (ControlGroupView.tsx:51-75), logic moved as-is (archived ? null : hasFailureOutcome ? (retryRunOpen ? retry-task : null) : blocked&&blockedReason ? recovery-retry : null); retryRunOpen unchanged (runFacts.ts:42).
- Settle: UsageSettlement gains optional `compact` (omits unknown/contact-owner/refusal paragraphs and receipt to avoid triplicated text); gate unchanged.
- Verify: TaskDetail inline predicate → savedResultSourceRunId(view,item) (runFacts.ts:66), wrapped in SavedResultEntry (TaskDetail.tsx:294); disabled rule and key kept.
- New sites via remedies(run) (ControlGroupView.tsx:170-179) in work-item status cell and Problems row; Verify only for the task's current run.
- Raw code + friendly text already true via RunReason; pinned.
- TDD: web/tests/remediesInRows.test.tsx 9 tests; RED 5 positives failed (w5657-red.log); GREEN 9/9.
- 13 mutations in /private/tmp/osc/mut/w5657 each red at a named line (M1..M10, gates forced true/false per site, remedies removed, RunReason removed); restore cmp-identical, --cached 0 B.
- Gates: root typecheck RC0; web tsc RC0; web build RC0; root scanPanelText+metrics 68/68; web full 1089/1089 (final run).
- Unregistered load flakes (each 3/3 green alone): reviewApp "records one review for a second 'a'…" (also red at baseline), controlCommandRecovery "drops the id when the lookup returns the command's retained result", loopPlanDraft "keeps the draft through a refusal…", projectSwitcher "C: the Requirements, Chains and Memory selects…".
- Concerns: extra eligibility GET per failed current run per new site (hidden panes mounted); TaskDetail retry gate lacks hasFailureOutcome vs Runs table (left).

## Fix round 1 (hand-back saved by controller)
Commit 5095d367 fix(web): read saved-result eligibility only from the shown row, and say why settle is absent.
- remedies(run, active): work row active = props.active!==false && region==="progress" (:348); Problems row region==="problem" (:390); SavedResultEntry renders nothing when active===false (TaskDetail.tsx:299); TaskDetail passes no flag (unchanged).
- Compact UsageSettlement with no button shows one line while active: refusal text, else contact-owner (UsageSettlement.tsx:42); full mode output unchanged (gate/refusal hoisted into `offered`/`refusal`).
- 3 new tests (remediesInRows 12 total): Runs region ⇒ 0 eligibility reads, Problems ⇒ 1 (:189); member compact (:201); refused compact (:210). RED RC1, GREEN 12/12.
- Mutations (clone, restore cmp-identical): R1 drop active gate → :189; R1b active={true} → :189; R2 drop compact line → :201,:210; R2b show when inactive → existing settleUnknownUsage.test.tsx :34,:40,:149 (multiple elements).
- Gates: web tsc RC0, web build RC0, root typecheck RC0, root scan+metrics 68/68, focused 72/72, full web 1091/1092 (reviewApp flake, 3/3 alone).
