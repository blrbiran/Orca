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
- Correction (same session, controller): the fence nonce is `input.overview.hash.slice(0, 16)`
  (`src/control/requirementSplit.ts:325`, `requirementClarify.ts:220`) -- stable across drafts of one requirement at one
  commit, so it does not break the provider's prefix cache. Step 3 of the agreed token plan ("fix the nonce") is void;
  the prompt prefix is already cache-stable. The 280-297 k tokens per draft stay unexplained until measured.
- Human 2026-10-28: token plan 「同意先这样做，看下效果」 (#107 → measure → [nonce void] → repair-mode retry → explicit
  exploration notes only if still needed). Radix first, Tailwind v4 with CSS variables as the only theme source, spec
  first, after P0: 「同意你的建议，如果 Tailwind 有收益，我倾向于直接全量迁移。Tailwind 迁移部分，你可以打个样，并给我prompt，我去拿一个便宜的 agent 做，你再复核，或者你直接起一个便宜模型的subagent做完，你再复核。」
  Context: 「这个session暂时不要考虑context大小。先把该定的定好，我们再做handoff。」
- Human 2026-10-28, on the controller's six open points (verbatim):
  1. 「同意用 codex gpt-6-luna 跑一个中等需求」 -- one paid clarify+split run to measure per-call token make-up.
  2. 「同意你的建议。允许改必要的判据」 -- Tailwind v4 (`@tailwindcss/vite`, CSS variables via `@theme` the only theme
     source): controller samples one page (Settings) and writes the migration rules; then a sonnet subagent migrates in
     file batches, controller reviews each; acceptance = before/after shots at 390/1280 px in three themes, impeccable
     detector empty, `npm test`, zero horizontal overflow; criteria that read `styles.css` may be rewritten (Ruling line
     + own mutation each). Order: Radix (menus, dialogs, selects) first, then Tailwind; both after P0.
  3. 「(b) 把两三种字体（woff2）打进 web 包」 -- bundle Inter and JetBrains Mono woff2.
  4. 「同意你的建议，之前的主题都不好看，你可以都整体再优化一遍」 -- 4-6 new themes varying palette, typography, radius and
     density (Hermes presets, Linear-style violet as references); existing candidate themes may be reworked too.
  5. 「同意你的建议」 -- recovery CLI exposes only existing invariant-keeping commands; no force-archive, no
     reset-dispatch, no raw-store edits.
  6. 「同意你的建议」 -- split retry in revision mode (earlier draft + hand-back reasons, fix only what is named); handed-back
     and person-feedback drafts treated alike; split instruction version bump, calls already started keep their version.
