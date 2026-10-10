# Results5 continuation preflight

Owner: `/root/results5_preflight`, Codex follow-up run, 2026-10-11 Asia/Shanghai. Read-only inspection of the original feature tree; only this new report is written. Observed old HEAD `10ed031a14ed452f6fa1cf2dfca0f984e2d49a5b`; destination HEAD `35199d533a101bdf4cccd1656d820c7c10db2d4d`. No tests, source changes, mutation, commits, or subagents were performed here.

## Acceptance boundary

Results1–4 are accepted predecessors. The previous progress ledger ends with Results4 complete and Results5 dispatch at `10ed031`; it contains no Results5 completion or review. Results5 remains uncommitted WIP and must receive its own continuation checks and independent review. Do not redo the producer, collector, storage or read-model implementation.

Accepted Task4 product `fef429e`, tested `1a508dd` and byte-equal audit `10ed031`; accepted ccloop producer `adbc9a9`. The old brief names the feature CLI `/private/tmp/orca-results-ccloop-20261010/dist/cli.js`. Default package pin stays `ab824d1`; local feature acceptance does not publish/repin the installed producer. Previous browser, final formal default-pin, leak and whole-branch gates remained later controller work.

Read RTK.md and CLAUDE.md. Subsequent shell reads used `rtk`; historical `.superpowers/sdd` and published specs were not edited. Effective task-results design §8 supersedes the old handoff-field text: independent read-only RPC channel, immutable execution snapshots and higher verifier observations, independent current-attempt authority, strict actual started/not-run facts. UI must consume the accepted DTO rather than infer verifier truth from Agent claims or missing observations.

## Safe transfer inventory

Transfer only the following existing Results5 changes into the destination, preserving the original source tree. `git show HEAD:<file>` byte comparison between the two HEADs returned True for all eight tracked files below and `web/src/controlTypes.ts`, so applying the focused tracked web patch is appropriate against this destination baseline.

Tracked modifications:

- `web/src/App.tsx`
- `web/src/ControlGroupView.tsx`
- `web/src/ControlPanel.tsx`
- `web/src/GroupDetailRegions.tsx`
- `web/src/TaskDetail.tsx`
- `web/src/controlApi.ts`
- `web/src/locales/en.ts`
- `web/src/locales/zh.ts`

New files:

- `web/src/GroupResults.tsx`
- `web/src/ResultOutput.tsx`
- `web/src/SafeMarkdown.tsx`
- `web/src/TaskResults.tsx`
- `web/src/resultApi.ts`
- `web/src/useResultsRead.ts`
- `web/tests/fixtures/results.ts`
- `web/tests/groupResults.test.tsx`
- `web/tests/resultOutput.test.tsx`
- `web/tests/taskResults.test.tsx`

Exclude old dirty `docs/superpowers/specs/2026-10-10-task-results-design.md`, `.superpowers/sdd/2026-10-10-progress-results-design/plan-self-review.md`, `node_modules`, and all historical docs/reports/evidence from a blanket WIP copy. Preserve historical result5 raw artifacts in place or copy them into a separately owned new evidence namespace with provenance; they are not source files. No `resultsApp.test.tsx`, README/operator documentation or Results5 report/review was present in the inspected WIP.

## API and implementation inspection

WIP route paths and DTO field names match destination main: run/group GETs and `/api/control/runs/:runId/results/outputs/:outputId`, download `?download=1`; `currentAttempt`, `executionId`, `snapshotRevision` and byte lengths permit null exactly as consumed. No immediate TypeScript/API field mismatch was found. Accepted DTO correctly permits a safe binary or too-large preview to retain a saved download URL; the current tests only exercise null-download variants for those statuses and must not impose a blanket prohibition on saved downloads.

Already implemented: current-versus-history display, independently labelled execution/verification/Agent statements, group coverage/review/delivery, minimal inert text-node Markdown, active Results polling with epoch/scope/changeSeq identity, AbortSignal forwarding, output preview/download, and roving region-tab keys. Existing evidence navigation remains in place. The region keyboard change addresses the previously recorded Progress4 Minor naturally within the touched composition.

Remaining implementation/criterion risks to resolve in the destination:

1. `resultsApp.test.tsx` is absent. Existing tests render `ControlGroupView`; the test named hidden App section does not render the App. Cover actual App section switches, account/project scope/logout, mounted local drafts, task open/close, refresh, focus ownership, and zero POST/model/command reads. Existing taskResults tests primarily exercise the group surface; open a task and prove the separate `TaskResults` request/identity path.
2. Exact saved download bytes/attachment workflow are not tested. Cover the real download URL, bytes, encoded run/output IDs, refusal/auth behavior and no foreign attempt/output authority. `ResultOutput.download` reconstructs the route rather than consuming `downloadUrl` and names the file with output ID; decide/document the intended behavior against existing server attachment metadata.
3. `ResultOutput` has no direct `onLoginRequired` subscription, while the polling hook does. Its async guard checks active/identity/sequence only. Confirm that auth revoke clears/aborts preview/download immediately through real App ownership, including a held blob/read response before App scope rerender. Retained content can also remain displayed after an output-preview error; explicitly test identity/refusal behavior.
4. Cover monotonic capture revisions within one polling owner, same-index current ordinal growth, newer source facts with missing capture, null current attempt, foreign generation/execution, changed run owner, retry/continuation/predecessor history, and lower late result replies. Group admission checks nested group/task/epoch and capture revision but not nested changeSeq or generation/execution against the current core projection. Task admission checks run/task/group/epoch/changeSeq/capture but not generation/execution. Treat these as review targets, not established backend authority failures.
5. Test hidden-poll cancellation with controlled clocks across multiple intervals, and output responses after hide, scope switch and owner removal. Existing late-response fixture reuses one held response as a group DTO; it does not directly prove each run/output stale branch.
6. README/operator skill navigation, immutable-source meanings and old-pin/publication/repin boundary remain undone. Add no export pipeline, dependencies, summarizer, backfill or UI skin.
7. Locale key parity has only the focused recorded run below. Full Web/type/build/root affected entry/refusal/parity, pseudo/locales, required clone mutants, current source provenance, independent Results5 review and authentic browser flow/geometry remain unproved for the continuation.

## Existing RED/GREEN evidence

Raw artifacts remain under `/private/tmp/orca-progress-results-20261010/result5-*`; source metadata names old HEAD `10ed031` plus working patch and explicit untracked files. These are prior evidence, not a fresh destination test run.

- `result5-tdd-red`: command `npm exec --workspace web -- vitest run tests/taskResults.test.tsx --maxWorkers=2 --no-cache`, RC1; log shows absent current-result region failures before implementation. Initial stale-owner criterion already passed without implementation, so its original RED is not proof of that branch.
- `result5-tdd-red-outputs`: command `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/groupResults.test.tsx tests/resultOutput.test.tsx --maxWorkers=2 --no-cache`, RC1; missing preview/group surface criteria were observed. Combined raw RED log output was truncated by the tool in this preflight; this report does not certify a complete historical raw-log audit.
- `result5-focused-green`: RC1, log reports 12 failed/31 passed. Failures include ambiguous duplicate preview controls/current-history content and a duplicate `Saved work` query, then corrected by scoping queries to current result. Preserve these failures as historical fixture evidence.
- `result5-focused-green2`: command `env DEBUG_PRINT_LIMIT=0 npm exec --workspace web -- vitest run tests/taskResults.test.tsx tests/groupResults.test.tsx tests/resultOutput.test.tsx tests/detailRegions.test.tsx tests/i18nKeys.test.ts --maxWorkers=2 --no-cache`, observed RC0, complete log read in a separate call: 5 files/47 passed, duration 3.25 s. Source JSON records 17203 working source-diff bytes, cached 0, and the ten untracked files listed above. This is focused prior GREEN only, not Task5 acceptance, full Web proof or a reviewed freeze.

Inspection commands: `rtk git status --short`, `rtk git diff -- web`, `rtk git rev-parse HEAD` in both trees; `rtk proxy cat` of WIP components/tests, task-5 brief, effective spec and named evidence; `rtk proxy rg` on destination DTO/routes and prior ledger; `rtk proxy python3` comparing clean HEAD bytes. No code/tests were changed and no suite was rerun.
