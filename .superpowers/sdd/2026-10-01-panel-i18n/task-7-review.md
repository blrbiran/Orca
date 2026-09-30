# Task 7 review — the task control and recovery areas

Reviewer: task-reviewer subagent of session `e604b1ba` (controller), 2026-10-01. Range `4ff8d23..c9d30ab` (two commits: `c1b77d0` controller-ruled web `testTimeout`, `c9d30ab` the task). Read: reviewer-dispatch.md, task-7-brief.md, task-7-report.md, global.md, progress.md, spec §3.3/§3.5/§5, the review package in full (lines 1-1614, two passes because of size). Scratch clone `$SCRATCH/rev-t7` at `c9d30ab` (kept; `git status --porcelain` shows only the two `node_modules` symlinks, `rev-t7-status.txt`).

`SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`

## Spec Compliance

✅ Spec compliant.

- Every file in the brief's Files list has its hunk: `App.tsx:669` (brief said `:654`, the line moved; diff L36-38), `ControlGroupView.tsx`, `ControlPanel.tsx`, `EvidenceLink.tsx`, `RecoveryView.tsx`, `TaskDetail.tsx`, `WorkspaceModeSelector.tsx`, `locales/en.ts`, `locales/zh.ts`, `tests/controlI18n.test.tsx` (new).
- Boundaries kept: the ControlPanel refusal block (Task 10) is unchanged (diff L550-556); the `planText` chip (Task 3) unchanged (diff L190); `BudgetEditor` / `LoopPlanCard` / `AgentSelectionEditor` not touched (not in the stat).
- Locale values are the brief's, verbatim. Check: every non-blank line of the brief's four locale code blocks searched in the target file (`$SCRATCH/rev-t7-locale-cmp.txt`, rc=0): en families 28/28 present, en `control`+`recovery` 111/111, zh `control`+`recovery` 111/111, zh enums 18/18.
- Interfaces kept: `progressText(progress)`, `LabelChips`, `EvidenceList`, `EvidenceLink({ runId, label? })` signatures unchanged (diff L700, L719, L758, L576).
- **English byte-identity** — checked by reading each removed JSX line against the new en value and the JSX whitespace rules (a newline-only gap between two `{…}` is dropped; newline+indent inside text is one space):
  - stop line: old `…deadline {…} ·{" "}` + `{n} frozen run(s): …` → `" · {{n}} frozen run(s): {{runs}}"` ✓
  - handoff line: old `…deadline {deadlineAt}` ⏎ `{failure}` ` · evidence {…}` → `handoffLine` + failure expr + `handoffEvidence " · evidence {{ids}}"` ✓ (the implementer's three-line split is whitespace-neutral)
  - estimate: `… · {mode} profile{" "}` ⏎ `{profileId} {hash}` → `"… · {{mode}} profile {{profileId}} {{hash}}"` ✓
  - summary: `projection {seq} ·{" "}` ⏎ `{dispatch}` → `"… · {{dispatch}}"`, with `common.dispatchBlocked/dispatchLive` = `"dispatch blocked"/"dispatch live"` (en.ts:84) ✓
  - `noPort` and `noEstimator` multi-line texts collapse to one space at `start work` / `Restart it with` ✓
  - `attempt` `" · attempt {{attempt}} of claim {{claim}}"`, `labelsChanged … · now: ` (trailing space before `<LabelChips>`), `evidence.none " no evidence"`, `groupDone`/`groupBlockers` leading `" · "`, recovery `run`/`evidence` leading `" · "` ✓
  - import summary: `defaults?.estimateMode ?? "not configured"` → `enumText("budgetMode", …)`; en `budgetMode` maps `strict`/`soft` to themselves ✓
  - The implementer's own dump (`t7-en-base.html` vs `t7-en-new.html`, cmp rc=0) agrees; I did not re-run it.
- Spec §5 glossary: Start 开跑 (`group.start`), Pause 暂停 (`group.pause` 暂停派发, `stopMode.pause`), Handoff 交接 (`handoffStop`, `runPhase.handoff`, `stopMode.handoff`), estimate 估算, attempt 尝试, tokens `token` — all match.
- Spec §3.3 `progressText` (TaskDetail) keyed ✓; §3.5 families group state, stopMode, stopState, work status, run phase/state, request state, estimate state/mode, progress step, blocker scope all keyed as `Record`s over the unions (en.ts diff L973-1000); `data-*`/control values untouched.

⚠️ Cannot verify from diff: none beyond the behavior checks below.

## Behavior added this round on main (W1, W5, W6) — still works

- **W1 (refusal once a task started)** is server-side (`cf3d9c8`, `3aca3e2`: `src/control/webService.ts`, `tests/control/webMutations.test.ts`); this range touches no `src/` file. Its web surface is the ControlPanel refusal alert, unchanged (diff L550-556). `controlPanel.test.tsx` and `controlCommandRecovery.test.tsx` green (below).
- **W5 (one-click apply / `sendControlSequence`)** (`6a0917b`) wired `onCommands` through `ControlPanel` → `ControlGroupView` → `BudgetEditor`; both pass-throughs survive (diff L145, L532); `App.tsx` changed only at the `unavailable` line (diff L37-38), `sendControlSequence` (App.tsx:325, :688) untouched. `loopSuggestionApply` 6/6, `loopSuggestionDraft` 1/1, `loopBudgetRows` 4/4 green.
- **W6 (stale estimate)** lives in `BudgetEditor.tsx:94-144, :384` (not touched); the ControlGroupView estimate list only changed wording. `estimateStale` 2/2 green.
- Run: `(cd $SCRATCH/rev-t7/web && ../node_modules/.bin/vitest run tests/controlI18n.test.tsx tests/estimateStale.test.tsx tests/loopSuggestionApply.test.tsx tests/loopBudgetRows.test.tsx tests/loopSuggestionDraft.test.tsx tests/controlPanel.test.tsx tests/controlCommandRecovery.test.tsx) > $SCRATCH/rev-t7-focused.txt 2>&1` → rc=0, 7 files / 37 tests, read whole. Commit `c9d30ab`; `uptime` load 11.07.

## Strengths

- The implementer went past the brief's two tests with six branch tests that pin exact element text (`firstRow` cell-by-cell, `legend`, heading levels, `role="note"`, `li` texts), which closes the substring collisions the brief's own list has (`"派发"` is inside `"派发已阻断"`, `"恢复派发"` is spelled by 恢复 + 派发已阻断…) — the report names and fixes each (report "First-pass survivors").
- 140/142 per-site raw-English mutations red; the two survivors are correctly argued unobservable (`import.notConfigured` sits in an arm unreachable under `defaults !== null`, controlPanel.tsx diff L436; `progress.line` is the same template in both languages).
- fetch stubs restored in `finally` (test L1562-1564, L1587-1589) — better than Task 6's unrestored stub.
- The BLOCKED stop on `agentPreviewRefresh` was reported with measurements instead of editing the criterion; the ruling's config change is exactly what `c1b77d0` does.

## Reviewer mutations (clone `$SCRATCH/rev-t7`, criterion `tests/controlI18n.test.tsx`, each restored by `cat` + `cmp`, restore files 0 bytes)

| Name | Edit | rc | Red test (seen in `rev-t7-<name>.txt`) |
|---|---|---|---|
| RV1 | TaskDetail runs `enumText("runState", run.state)` → `run.state` | 1 | `… > shows a task's detail, its progress and its label draft in Chinese` (`r1 · 工作 · 已阻塞`) |
| RV2 | RecoveryView group-view list `t("recovery.run", …)` → `` ` · run ${…}` `` | 1 | first test (`运行 · g · 运行 r1 · code-1`) and `… > shows recovery blockers with their evidence …` |
| RV3 | WorkspaceModeSelector `cloneOption` → `worktreeOption` | 1 | first test (`私有克隆`) |
| RV4 | ControlGroupView runs table `enumText("runPhase", …)` → raw | 1 | `… > names every table column …` |
| RV5 | zh `stopState["handoff-complete"]` → `"handoff-complete"` | **0** | none — see Minor 1 |

(Pass/fail lines were extracted from the full output files into `rev-t7-RV<n>-sum.txt`; the full files are kept beside them.)

## Issues

### Critical (Must Fix)

None.

### Important (Should Fix)

None.

### Minor (Nice to Have)

1. **Enum values without a render in the criterion are unpinned (RV5 green).** Per-site mutations are all seen, but most enum values of the new families are never rendered under zh (e.g. `stopState.handoff-complete`, `runState.landed`, `requestState.latched`, `estimateState.input-too-large`). A mistyped or English-left zh value would pass. `Translation<typeof en>` guarantees the key exists, not that it is Chinese. Task 11's pseudo-locale / leftover-literal checks may cover it; if not, a table-driven check that every `zh.enums.<family>` value differs from its en value (or contains a CJK character where the glossary requires one) would close it cheaply. Not a contract breach — the contract asks for per-site.
2. **`labelSource` uses a dynamic `t()` with no fallback** (TaskDetail diff L833: `` t(`control.task.labelSource.${item.labelsProvenance ?? "plan"}`) ``). A wire value outside `"plan" | "operator"` (controlTypes.ts:94) would render the key path `control.task.labelSource.<x>`, where the old code showed the raw value; `enumText` (i18n.ts:89-92) falls back to the raw value. Low risk (typed union, server-owned), but inconsistent with every other enum site; `enumText`-style fallback or a `labelSource` family would match.
3. **The `c1b77d0` comment cites a measured value without its command and commit** (web/vite.config.ts, diff L1610: "left agentPreviewRefresh at 4968 ms before i18n"). CLAUDE.md Rule 14 asks every recorded measurement to carry the measuring command and the commit it was observed on; the report has both (`t7-base-check.txt`, BASE `4ff8d23`), so appending "(full `npm run check --workspace web` at 4ff8d23)" suffices. Also note for the ledger: the 15 s default applies to all 48 web files, so a hung web test now takes 15 s to fail — the ruling already names that cost.
4. **zh wording for the human's review** (not blocking; spec §5 hands wording to the human):
   - `runsTh.profile` is 配置 while `estimateLine` and `import.noEstimator` keep `profile` in Latin — two renderings of one term on one screen.
   - `th.pending` 待定 reads as "undecided"; the column holds a pending run id (e.g. 待启动的运行 / 挂起的运行).
   - `group.stop` renders "停止 暂停 已暂停 · …" — faithful to English `stop pause paused`, but reads as three verbs; e.g. 「停止方式 暂停 · 状态 已暂停」 would parse.
   - `group.heading` 版本 {{revision}} and `task.labelsFrom` 版本 {{version}} use one word for command revision and labels version; acceptable, noted for consistency.
5. **The brief's first test keeps two vacuous substrings** (`"派发"`, `"恢复派发"`, test L1409; plan-mandated, verbatim). They cannot fail on their own sites; the implementer's added tests (L1479, L1483) pin both sites exactly, so the sites are covered — the brief's lines are just dead weight.

Minor count: 5.

## Assessment

**Task quality:** Approved

**Reasoning:** Every brief replacement is present with byte-identical English (checked line by line and by the implementer's dump), the Chinese matches the brief and the spec §5 glossary, per-site coverage is real (140/142 plus four reviewer mutations red), and the W1/W5/W6 paths are untouched and their criteria green at `c9d30ab`. The remaining items are unpinned enum values, one fallback inconsistency, a comment's provenance, and wording for the human.
