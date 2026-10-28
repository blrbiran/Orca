# Tester feedback round (2026-10-28) — progress ledger

Controller: Claude Opus 5.5 (this session follows e236bbe4; Orca main at `cc94a063` when opened). History in this file is
append-only (CLAUDE.md Rule 13).

Inputs: `/Users/biran/code/skills/orca/orca_archived_files/` (issue-20261023.md #70–#109, plus ten analysis docs), read
together by the controller, not split across agents (human's instruction).

## Human rulings (verbatim)

- On the e236bbe4 controller rulings (#21 card lift, m5 criteria only, refusal copy): 「同意」.
- Themes: 「先暂时保留，但是实际都不太满意。你结合后续的一些文档再加更多的主题（测试者提供了一些其他思路），我再做选择。」
- Round numbering: 「你的建议是什么？为什么？」 → after the recommendation (chain position, one numbering across document,
  ids and validator): 「同意你的建议」.
- Plan §三 (P0 stuck states + recovery CLI, P0 #107 split prompt, P1 #105 copy, P1 #106 layout, P1 split token
  measurement, P2 filtered UI, themes): 「其他同意」.
- Tailwind: 「我倾向于做，感觉应该会用收益，你有不同意见的话我们可以再讨论。如果有必要，我们也可以引入其他必要的库，也可以再讨论。」
- #69/#70 project pickers: 「先持保留意见，先不改」.
- #79 navigation: 「可以先收进 更多 里」 (chains, memory, metrics).
- #108 non-Phase-1 proposals: 「你可以列出来给我看。」
- Real data: 「可以用真实库的副本测试，但是本机没有测试者的数据。你如果想自己跑出数据也可以。」
- Hermes source: 「`sourceget find hermes-agent` 可以拿到源码路径，授权你访问。」 → `/Users/biran/code/skills/agent/hermes-agent`.
- Deferred: flow-call unknown-usage settlement 「先延后」; `/private/tmp/orca-e236bbe4/` kept 「可以先留着」.

## Findings verified against main `cc94a063` (controller, read-only)

- #89 "manual refresh only" is false: the panel polls every 2 s (`web/src/App.tsx:191`, `:1018`).
- #107 holds: the split instruction states neither the `investigate` single-exact-path rule nor the trace id format
  (`src/control/requirementSplit.ts:38,40`).
- #106 holds: the requirements nav button is not `.group-card`, so it gets no right padding (`web/src/styles.css:450-452`).
- #99 suspicious: conditions 1 (draft only) and 9 (one attempt per proposal version) in `src/control/autoConfirm.ts`
  should prevent repeats; hypothesis to test: the booked refusal row rolls back with the throwing apply.
- #104's state (inactive + blocked + not closed) is reachable by the tester's manual `UPDATE runs SET active=0` (#102).
- #102's 423 was, per the tester's own final note, the `requirement_drafts` state column / body mismatch they wrote.
- Split prompt: "You have no tools"; order is instruction → document → overview → earlier-drafts (stable first), overview
  capped at 120 KiB list + 48 KiB docs. The tester's 280–297 k tokens per draft therefore cannot be the prompt alone —
  unmeasured; ccloop's codex/omp totals include cache reads (`ccloop src/runtime/codex/protocol.ts:211-213`).
- Open question for the token measurement: every fence carries a per-call nonce (`requirementSplit.ts:330`); if it changes
  between drafts, the shared prefix with the provider's cache ends after the instruction text.

## Log
