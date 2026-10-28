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

## Session a9f9d6de (2026-10-28, controller Claude Opus 5.5; opened on main `2893841f`)
- Human 2026-10-28 (verbatim): 「这个session中，尽量将这些要做的task都完整做完…付费量 token（codex gpt-6-luna，一个中等需求，跑澄清＋拆分） => 同意跑…
  尽量在这个session里并行都做掉…#105、#106、P2 的界面小项 => 同意你的建议。这次批准改写所有必要的判据。这一轮允许必要的付费真跑。…遇到卡住必须等人的
  事情，请继续做不必等人的部分…先按你的建议执行。执行完在最后阶段报给我审核。」
- Lines: P0 (controller, worktree `.worktrees/p0-recovery`, branch `fix/p0-recovery`); split prompt v3 + #105 + round
  numbering + revision-mode retry (subagent, `.worktrees/split-v3`, `feat/split-prompt-v3`); UI Radix + Tailwind stage
  C1 (subagent, `.worktrees/ui`, `ui/radix-tailwind`, own `npm ci`). Gates serialized by
  `/private/tmp/orca-a9f9d6de/gate.sh` (mkdir lock; sets ORCA_CCLOOP_BIN to the e25381f clone build and a scratch
  CCLOOP_CACHE_DIR).
- `~/.orca` file hashes before (excluding `panel/` trees): `/private/tmp/orca-a9f9d6de/../claude-501/...scratchpad/orca-home-before.sha`
  (326 files). Real control DB copy (read-only `.backup`) at `/private/tmp/orca-a9f9d6de/realcopy/`: no active run, no
  blocked or unknown-usage run, no waiting draft, no stop intent; one undelivered `estimate-claim` outbox row.
- P0 findings (commit `fix(control): archive a requirement whose next call is parked, and settle unknown usage with an
  owner's person token (tester #100, #103)`; spec `docs/superpowers/specs/2026-10-28-recovery-cli-design.md`):
  #98 not a defect (Retry works; the parked draft waits for the closed call's charge); #99 not reproduced (C22 pins
  that a booked refusal stops the next pass; the rollback hypothesis is false; needs the tester's commands rows);
  #100 defect fixed (archive interrupts a parked/held call); #101 designed path; #102 not a defect (recovery recomputes
  dispatchBlocked; the 423 was the tester's draft-row edit); #103 both settlements accept an owner's person token,
  `orca recovery retry --acknowledge charge-remaining-grant`; #104 unreachable by code (every active=0 writer also
  terminalises). Mutations M1–M9 red on their own criteria, 0-byte restore (`/private/tmp/orca-a9f9d6de/p0-mutations.log`).
- Correction (same session): the `~/.orca` hash file path above is garbled; it is `/private/tmp/orca-a9f9d6de/orca-home-before.sha`.
- Paid token measurement (human 「同意跑」, this session). Command: `tsx scripts/live-split-token-measure.ts --ccloop-bin
  /private/tmp/orca-3cd8fb02/ccloop-e25381f/dist/cli.js --output /private/tmp/orca-a9f9d6de/measure-run-1 --codex
  /Users/biran/.nvm/versions/node/v22.13.1/bin/codex --model gpt-6-luna --max-rounds 2` in a clone at
  `407f7ad1` (split instruction v3, #107; the script is scratch-only at `/private/tmp/orca-a9f9d6de/measure-src/`).
  Medium idea (textkit CLI with three commands, module tests, CLI child-process tests, README). Result: 2 rounds →
  consensus → draft 1 awaiting review on the first try; 3 calls, each ONE turn, no tool items (8 `error` items each =
  codex config/feature warnings). Per call as codex printed `turn.completed.usage` (input / cached / output / reasoning):
  round-1 12713/0/970/428; round-2 13042/0/1108/750; draft-1 12624/0/1878/1314. Orca booked 13683 / 14150 / 14502;
  group used 42335 tokens. codex reports no USD. `~/.orca` unchanged; `~/.codex/config.toml` sha256 unchanged.
  summary.json sha256 64ebadfb…; raw per-call files copied under `measure-run-1/raw/`.
  ⇒ On codex a split call is ~12.6 k input of which ccloop's framework is ~10–11.5 k (ccloop handoff); the tester's
  280–297 k per draft is NOT reproduced by Orca's single call at this repo size. Candidates needing the tester's data:
  a very large overview (capped at 120 KiB list + 48 KiB docs, still far below 280 k), an agent that took many turns
  (omp/claude exploring despite "You have no tools"), or a figure that sums retries. Ask the tester for the split
  run's `<control>.runs/<run>/run/<kind>/1/single-call/call-*/events.jsonl`. Explicit "exploration notes" (token plan
  step 5) not needed on this evidence; revision-mode retry (step 4) proceeds as ruled.
- Split line (subagent, then controller): on main by `--ff-only` — subjects `feat(requirement): split instruction
  version 3 states the loop-plan and trace rules (#107)`, `feat(estimator): tell a listed model with no context window
  from an unlisted one (#105)` (new reason `context-unreported`, en/zh), `feat(requirement): number rounds by chain
  position in ids and the document`, `feat(requirement): split retries revise the latest draft, fixing only what is
  named`, then controller review fixes `fix(requirement): depend only on the chain's own questions; revise the latest
  draft with tasks (review I1, I2)` and design-note corrections (`docs/superpowers/specs/2026-10-28-split-prompt-v3-design.md`
  §6). Independent review: 0 Critical, 2 Important (both fixed, mutations red, 0-byte restore), 5 Minor (registered §6).
  Gate `/private/tmp/orca-a9f9d6de/split-gate3.log` on the fix tip: 734 files (568 root, 166 web) all passed; root
  5017 passed / 35 skipped (same 8 files as every gate), web 1580 passed. Subagent mutation log
  `/private/tmp/orca-a9f9d6de/split-v3/mutations.log`. Rewritten criteria (Ruling lines): multiDirOverview v3 heads and
  byte pin, requirementSplit version regex, harness heads, declaredNullWindow `context-unreported`, splitPromptV3 I2 case.
- P0 review: 1 Critical (socket `settle-unknown-usage` marker refused by its own validator) — fixed by keeping that
  settlement Web-only (spec §4 correction), M10 red; two empty criteria replaced by `pendingRequirementCall === null`.
- Open for the human: panel shows hand-back reasons as bare codes (meanings reach the model only); `orca task
  settle-usage` over the socket needs the command ledger to record the person token's account (schema change).
- UI stage C1 (subagent, branch `ui/radix-tailwind`, rebased on main after the split line): Tailwind v4.3.3 +
  `@tailwindcss/vite`, Radix dropdown-menu 2.2.1 + dialog 1.3.1, @fontsource Inter / JetBrains Mono 5.3.0 (exact pins);
  layers theme→legacy→utilities, no preflight yet; Settings migrated; `web/TAILWIND-MIGRATION.md` (rules + batch plan).
  Deviation for the human: native `<select>`s kept (not Radix Select) — reasons in the migration doc §3; reversible.
  Detector: two new `overused-font` findings (Inter) — contradicts nothing the human ruled (Inter was ruled), kept.
  Gate4 web 180/180 files; root 1 red = registered load flake `taskResultCollector` (solo 30/30).
- Batches dispatched in parallel (sonnet, brief `/private/tmp/orca-a9f9d6de/ui/BATCH-BRIEF.md`): b1 shell + #79 "More",
  b2 decisions, b3 tasks + #74 (verify first), b4a requirements + #106 #76 #83/#86 + #107 panel meanings, b4b
  board/flows/overview + #73/#90, b5 metrics/memory. Controller exception: `.detail-region-tabs` and `.led` left to the
  final pass. Themes line (opus, `ui/themes`) in parallel: rework candidates, 4–6 new themes.
- UI line closed (controller session a9f9d6de, 2026-10-29). Each batch reviewed (diff, gate log, mutation log,
  detector, screenshots under `/private/tmp/orca-a9f9d6de/ui/<batch>/`), merged `--no-ff` into `ui/radix-tailwind`
  with hand-resolved conflicts (rule: a rule deleted on either side stays deleted; added tokens/strings kept from both),
  then the final pass, then main `--ff-only` to subject `docs(web): DESIGN.md and the migration notes name where the
  shared classes and the tabs live after the final pass`.
  - b1 shell + #79 (More group), b2 decisions, b3 tasks + #74 (was NOT satisfied: transcript now follows the newest rows,
    "Follow latest" button), b4a requirements + #106 #76 #83/#86 + #107 panel meanings, b4b board/overview + #73/#90
    (done/total + relative time on Board cards), b5 metrics/memory/usage. Themes: 10 candidates (rose, ink, violet,
    lagoon new; frost, navy, ember, terminal reworked; contrast, dusk kept) differing in palette, font, radii and density;
    no id dropped; light/dark/system byte-identical.
  - Controller mutations not run by agents, run here: b3 C (no onScroll) and D (Follow latest no-op) red; b4a G rerun
    (the agent's run had all 3 files fail to load, not evidence) red. All restores 0/0 bytes.
  - Controller fixes on the integration branch: (1) `@custom-variant narrow (@media a, b);` compiled its max-height
    half to a broken selector (12 build warnings; a short wide screen kept the desktop shell) → block form, criterion is a
    real `tailwindcss` compile in `web/tests/tailwind.test.ts`, b1's string pin rewritten (Ruling line); mutations F3, F4
    red. (2) #54 allowed-drop outline never painted (`.section-pane section[aria-label]` out-ranked it; found by b4b) →
    utilities on `boardColumnBox`; F1, F2 red. (3) `web/tests/controlCommandRecovery.test.tsx` read sessionStorage right
    after the text, racing App's write effect (`App.tsx` writeUncertainCommands) — failed in 4 full web runs, 5/5 solo;
    three reads now `waitFor` like the file's other cases (Ruling line); F5 (no write) 7 tests red.
  - Final pass (opus): preflight ON (`@layer theme, base, utilities`; preflight then styles.css in `base`; the sheet
    restores the defaults the look needs with `revert`), shared classes are `@utility` blocks, `.detail-region-tabs` →
    `tabButtonRow`/`tabButton`, `.btn`/`.btn-danger` deleted (unused; DESIGN.md says so); 20 mutations red; screenshots
    light/dark/navy/frost/terminal × 390/1280 × 15 views: only self-moving data and terminal-theme tabs 4 px shorter
    (they now follow that theme's density, like the Settings tabs). Theme blocks NOT moved to themes.css (skipped, risk).
  - Gates (`/private/tmp/orca-a9f9d6de/gate.sh`): integration tip `ui/integ-gate1.log` 865 files (682 root, 183 web),
    web 183/183, root 1 red `agentUpgradeE2E` (until-timeout at load 29.5; solo 3/3); final tip `ui/final/gate1.log` 865
    files, web 183/183 (1777 tests), root 1 red `startForm` (solo 9/9). Skipped every run: the same 37 tests in 10 files.
    Build: 0 CSS warnings. Detector: only the two Inter `overused-font` lines in `fonts.css`.
  - Load flakes seen this round (solo green each): startForm (also 3/4 red on the base branch alone under load),
    criteriaBaseRun (git index.lock), progressE2E, dispatchedRunMarkerE2E, multiDirCollect, agentUpgradeE2E,
    correctionCoarseDebug (HUNG 22+ min at 0% CPU on a `git hash-object -w` child in two gates; killed; solo 3/3 in ~19 s).
  - Installed: `npm install` in main (54 packages added; package-lock.json diff 0 bytes), `npm run build`, web build,
    `launchctl kickstart -k gui/<uid>/dev.orca.panel` → new pid, 7777 answers 200, err log only the usual lines.
    `~/.orca` (non-panel trees, 326 files) `shasum -c` all OK against `orca-home-before.sha`.
  - Worktrees removed (no force), branches `-d` (all merged). `git ls-remote`: Orca origin main is the split-line
    corrections commit (pushed by the human during the session); ccloop / ccmem origin = local main. ccloop unchanged ⇒
    no repin, no ccloop push.
