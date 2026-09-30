# Task 9 review — the agents area and the retry notice

Reviewer: task-reviewer subagent of session `e604b1ba` (Claude Opus 5.5), 2026-10-01. Range reviewed: `f1ec75b..5cb8ce4`
(package `review-f1ec75b..5cb8ce4.diff`, read whole). Brief `task-9-brief.md`, report `task-9-report.md`. Carried items: preflight P4, P2.
Mutation and probe work only in `$SCRATCH/rev-t9` (a `git clone --local` at 5cb8ce4) plus its worktree `$SCRATCH/rev-t9-base` (at f1ec75b).
Both are kept. `$SCRATCH` = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`.

## Spec Compliance

✅ Spec compliant.

- Every site in the brief's Step 3 has its hunk, in all 8 listed files:
  - `AgentFields.tsx:11`: `contextLabel` translates at call time and keeps its signature.
  - `AgentFields.tsx:148,157,160,166,172`: the mask label, the three labels and both `inherit` options.
  - `AgentSelectionEditor.tsx`: `SelectionCells` ×3, `FailedCell`, `region` ×4, the frozen title, both `thead`s and own layer,
    `notRecorded` ×2, `agentSlot` reconcile ×2, reread, title ×2, cannotRead, resolving, proposalTitle, stale, unresolved,
    group legend/set/clear, estimator note, task legend/set/clear.
  - `AgentSettings.tsx`: all 11 sites.
  - `App.tsx:115-122`: `RetryState` and `retryNotice` exported, body shape kept.
  - `en.ts` and `zh.ts`: the `agents` area plus `enums.agentSlot` / `enums.selectionSource`.
  - `i18nWidth.test.ts`: the 2 prefixes, the 2 buttons and the guard at 97.
- **English byte-identity, measured against the base rendering.** In the clone, `web/tests/revDump.test.tsx` renders the same 8
  English views at base (worktree f1ec75b) and at head, then writes each `container.innerHTML`:
  - `AgentSettings`, with and without installations;
  - the editable editor, with a mask checked, the retry notice and task-plan layers;
  - the editable editor with a stale preview;
  - the confirmed editor, with reconcile recorded and with it not recorded;
  - the read-failure view;
  - the resolving view.

  The fixtures cover all 12 `selectionSource` values, all 3 slots, both failure kinds, all 3 mask labels, both `inherit` forms
  and both `contextLabel` forms. Result: `cmp rev-t9-dump-base.html rev-t9-dump-head.html` gave rc=0. Both files are 17783 bytes,
  and I read the head dump whole. The three `retryNotice` English strings are pinned by the new third test
  (`agentsI18n.test.tsx:162-166`) and equal the base template literals (`App.tsx` base lines 443-445 in the diff).
- **Chinese against spec §5.** The glossary terms that apply here are used as §5 gives them:
  - "estimate" is 估算 (`agentSlot.estimator`, 估算槽, 重新估算).
  - "tokens" is `token` (`contextTokens`).
  - "Confirm" is 确认 (`frozenTitle`, `cannotRead`, `unresolved`, `staleResolution`).

  "Plan" here is the plan descriptor layer, not a loop plan, so 计划 (not 做法) is right. It is consistent with the existing
  `zh.ts:91-144` uses (导入计划, `labelSource.plan`). Every `zh` value equals the brief's text; I checked each line of
  `zh.ts:602-673` against brief lines 177-230.
- **P4 (carried)**: met. MT9-3 is asserted by the exact `legend` list and the exact fieldset `aria-label` list
  (`agentsI18n.test.tsx:111-112`). I read `$SCRATCH/t9-MT9-3.txt` whole: rc=1, red at line 111 with
  `组 worker/组 estimator/组 reconcile` against `组 执行/组 估算/组 协调`. The brief's own `toContain("组 执行")` stays too, and
  alone it could not go red.
- **P2 (carried)**: met. The fixture model is `gpt-5x` (`agentsI18n.test.tsx:27`), and the expected string is
  `忽略计划里的模型（gpt-5x）`.
- **Deviations** (report §Deviations 1-5): all are justified by P2, P11, P4 or the contract's per-site criterion. Deviation 4 (the
  `agents` block sits after `loopPlan`) has no effect on lookup or parity.
- ⚠️ Cannot verify from the diff alone: none that block. The controller may want to confirm that `App.tsx:698`, the only
  `retryNotice` call site, re-renders on a language change. It does, because App holds `useTranslation` since Task 2, but that is
  outside this diff.

## Strengths

- Every translated site is pinned by its own element's exact text (h3, `section` `aria-label`, `thead th`, legends, fieldset
  names, buttons, the labels' own text nodes, first options, row cells, `p[role]`). So a single site falling back to English
  goes red on its own line instead of hiding behind a substring. P4 is solved in general, not just for MT9-3.
- The fixture additions (task `b` unavailable, a stale preview, a plan `contextWindow`) reach sites that the brief's fixture
  never rendered (`agents.unavailable`, `staleResolution`, the `contextWindow` mask label).
- Mutation evidence is thorough: 70 mutations, and I verified each against `t9-mutations.json`:
  - every one has rc=1, restore rc=0 and a 0-byte restore file;
  - every output file contains an assertion failure and no load or type error (`$SCRATCH/rev-t9-scan.txt`), so none went red
    for the wrong reason.
- The report states the three sites it could not observe (`label.agent`, `th.agent`, `field.agent`, where the English and
  Chinese values are equal) instead of claiming them.

## Issues

### Critical
None.

### Important
None.

### Minor (4)

1. `zh.ts:613,608` (`from`, `ignorePlan`): Chinese and Latin text are joined with no space in some keys but spaced in others.
   - Unspaced: 来自agent 描述符, 忽略计划里的agent（codex）.
   - Spaced: 设置组 执行 的 agent, 默认 agent.

   The brief mandates the text, so this is not an implementer defect. Flag it for the human's `zh.ts` review (spec §5, first line).
2. `zh.ts:668` `agentSlot.worker` 执行 is the same word as `enums.runPhase.execute` 执行 (`zh.ts:374`). A worker slot and an
   execute phase read the same in Chinese. The brief mandates it; flag it for the same review.
3. `agentsI18n.test.tsx`: 9 of the 12 `selectionSource` Chinese values are never rendered in Chinese by a criterion. A wrong
   word there would stay green. Only the key set is enforced, by parity. This is polish ("coverage could be broader").
4. English byte-identity for the agents DOM is pinned only by the pre-existing English agent tests and by this review's one-off
   dump. The new third test pins only `retryNotice`. This is acceptable, because the dump measured identity, but no permanent
   criterion carries it.

## Assessment

**Task quality:** Approved

**Reasoning:** The English rendering is byte-identical to base across a fixture that covers every changed site (measured with `cmp`),
the Chinese matches the brief and spec §5, and every observable site has a named deletion mutation seen red on an assertion. The
remaining items are wording choices for the human's `zh.ts` review and optional coverage.

## Evidence files (all in `$SCRATCH`)

`rev-t9-clone.txt`, `rev-t9-wt.txt` (clone, base worktree), `rev-t9-dump.test.tsx` (probe), `rev-t9-run-base.txt` / `rev-t9-run-head.txt`
(rc=0 each), `rev-t9-dump-base.html` / `rev-t9-dump-head.html`, `rev-t9-cmp.txt` (empty, rc=0), `rev-t9-scan.txt` (mutation-output scan).
