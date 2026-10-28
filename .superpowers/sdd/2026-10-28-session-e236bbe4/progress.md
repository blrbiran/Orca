# Session e236bbe4 (2026-10-28) — progress ledger

Controller: Claude Opus 5.5, session e236bbe4. History in this file is append-only (CLAUDE.md Rule 13).

## Human rulings (verbatim, this session)

- Scope: 「你已经定了的（按这个顺序做） => 同意」 — import cycle, m5, component redo; 「我建议这轮顺带做的 => 其他都同意」
  (real-browser shots of every page incl. "待测试的功能" walk, #49 title, `ompPhase` flake registration).
- Criteria: 「这一个session允许改必要的判据」, then 「这次批准改写所有必要的判据。这一轮允许必要的付费真跑。」
- UI: 「我相信你的判断，风格要统一。你直接按你的判断改。改完之后我统一看。」 References: primer-css, radix-ui-themes,
  shadcn-ui-ui, ant-design, carbon, spectrum-css (archived), mantine (`sourceget find …`, read-only), skills
  `/Users/biran/code/skills/UI/impeccable`, `/Users/biran/code/skills/UI/taste-skill`.
- Themes: 「可以多加几个主题让我可选（主题下拉框中可以选，默认随浏览器切换的还是默认 light 和 dark主题），新的主题中动基调」.
  Default light/dark identity unchanged.
- #64/#65 look: 「做完上面的组件重做之后，我统一看吧」.
- Flow-call settlement: 「可以之后再看，这一轮先不做」; 「「无限 token 模式」是指 soft-limit 那个。就是我们当前 group / task
  运行时默认不通过token 限制运行的模式。」
- Import cycle: 「同意修」. m5: 「同意按你的建议走。ccloop 的代码和必要判据都可以改。」
- Tester issue file: not edited (「不改，测试者会改」).
- Process: problems → follow the controller's recommendation, report at the end; blocked-on-human items go to handoff.

## Log

- Import cycle (m4): worktree `/private/tmp/orca-e236bbe4/wt-cycle`, branch `fix/import-cycle`, commit `refactor(control):
  move the estimate settlement out of webService to break the import cycle`. Three blocks moved byte-identical (python
  substring check against `git show main:src/control/webService.ts`: 3/3 True); webService re-exports the public names;
  17 imports that only the moved code used dropped. New criterion `tests/control/singleCallImportCycle.test.ts` (walks
  value imports from singleCallPurposes.ts). Mutation in `git clone --local` (`/private/tmp/orca-e236bbe4/mut-cycle`):
  import back from webService.js ⇒ red on `expected true to be false` (log `/private/tmp/orca-e236bbe4/cycle-mut.log`).
- m5 finding: spec §4 C2 already says the bound is present "only when the outcome is not `complete`" — aborted is in
  scope; the code review (`/private/tmp/orca-3cd8fb02/review62code/REVIEW.md` m5) read it as failed-only. Behaviour kept;
  only criteria were missing (ccloop W10, Orca aborted-record case).
- UI component redo + themes delegated to an implementer subagent (worktree `/private/tmp/orca-e236bbe4/wt-ui`, branch
  `ui/components-themes`). Gate lock: `mkdir /private/tmp/orca-e236bbe4/gate.lock` (one test gate at a time).
- Cycle gate (branch tip `b36b828b`, ORCA_CCLOOP_BIN = ccloop-e25381f build): web build 0; `npm test` selected 511 root
  files: 510 passed, 1 failed (`tests/flow/startForm.test.ts` "answers the templates…", `TypeError: fetch failed` —
  registered load flake), 4587 tests passed / 35 skipped (8 files, listed in log); startForm alone 3/3 (9/9 each).
  Logs `/private/tmp/orca-e236bbe4/cycle-npmtest.log`, `cycle-startForm-{1,2,3}.log`. Merged --ff-only; installed
  (build + web build + `orca panel restart`, 7777 → 200).
- m5: ccloop W10 (`tests/control/singleCall.test.ts`), commit `test(control): an aborted single call keeps the adapter's
  lower bound in its record (Orca review m5)`; worktree without `dist/` first gave 5 false reds (ccloop handoff trap),
  after `npm run build` 9/9; mutation (drop `usageLowerBound = usageLowerBoundOf(error)` from the aborted branch) in
  `/private/tmp/orca-e236bbe4/mut-ccloop` ⇒ W10 red only (1 failed / 8 passed); typecheck 0; ff into ccloop main
  (local, push is the human's). Orca: criterion + spec §11 correction, commit `test(control): an aborted single call
  keeps ccloop's lower bound on the blocked run (#62, review m5)`; alone 25/25; mutation (driver keeps the bound only
  for `failed`) in `/private/tmp/orca-e236bbe4/mut-m5` ⇒ new case red only (1 failed / 24 passed); gate after rebase:
  `npm test` selected 1 root file, 25/25, rc 0. Merged --ff-only (test + spec only, no install needed).
- UI (implementer subagent, branch `ui/components-themes`): commits `feat(web): redo the panel's component layer on one
  scale`, `feat(web): add six selectable candidate themes` (frost, contrast, navy, ember, dusk, terminal; system/light/
  dark unchanged except two new dark tokens `--accent-hover`, `--shadow-pop`), `feat(web): title the board card's open
  control with where it leads (tester #49)`, `test(web): count the six candidate themes among the enum values`. New
  criteria `web/tests/themes.test.ts` (54, per-theme contrast/token/order/scheme loop), board #49 describe; rewritten
  `web/tests/i18nPseudo.test.tsx:366-367` (195 → 201 enum values, Ruling line). Mutations M1–M11 red, restore 0/0
  (`/private/tmp/orca-e236bbe4/ui/mut.log`). Shots `/private/tmp/orca-e236bbe4/ui/shots/{before,after}/` (68 before,
  116 after; 390px overflow 0 after; before: group detail overflowed 392px). The subagent ran one 16-file vitest outside
  the gate lock (green). Its `~/.orca` diff (control.sqlite grew, control.sock recreated 09:59) = the controller's
  `orca panel restart` for the cycle install, not the subagent.
- Controller review of the UI branch: impeccable detector (`skill/scripts/impeccable detect --json web/src`, local
  binary `~/.impeccable/bin/0.1.14`) reported one finding, `side-tab` at the task detail's 3px accent left border
  (tester #21, on main before this round). Rule 7: #21 asked for separation, not a stripe; impeccable bans the stripe ⇒
  replaced by a lifted card (`--bg-elevated`, `--border-strong` edge, `--shadow-pop`); rewrote
  `web/tests/detailRegions.test.tsx` #21 criterion (Ruling line); detector after `[]`; mutation (stripe back) red on
  that case only (1/21). Shot review found the group header link flush against "Save plan to library" ⇒ spacing rule
  counts an inline link; new `styles.test.ts` case; mutation red (1/16). Not changed (registered): the next-step strip
  (`requirement-next`, a bare `<p data-tone>`) has no padding/radius; notices keep `--warn-subtle` in every theme by
  design. Gate after rebase: `npm test` 171 files (4 root 38/38, 167 web 1594/1594), 0 skipped, rc 0; root
  `scanPanelText` + `noteCodes` 7/7; web build 0. Merged --ff-only, installed (build + web build + panel restart,
  7777 → 200; `web/dist/index.css` carries the themes).
- QA walk (subagent, main `db48d006`, isolated panel :7797, fake-codex table, zero paid runs; notes
  `/private/tmp/orca-e236bbe4/qa/NOTES.md`, shots `qa/shots/`): #76 revise works; #95 works; #96 works except the
  document lead (front matter + `# slug`) renders as one `<p>` with a literal "#" (`web/src/RequirementsPanel.tsx:294`);
  flow board card / start dialog / run page pause-resume / settings + locks work (work steps not run: template needs
  GitHub skills + md2wechat; brief clarify failed on the fake's shape); checks: schedules add/toggle work, model review
  "Run now" with local delivery works; findings + dismiss NOT tested (needs two landed groups + a findings run).
  Findings: (a) refusal alerts for `control-argument-invalid` never show the server's detail (`web/src/RefusalNotice.tsx:22`);
  (b) flow-setting-locked names `effects.cost`, lock checkboxes show `allowedSkillSources`, `budgets.tokensPerRun`
  (`web/src/FlowSettings.tsx:141`); (c) requirement document numbers rounds by stored number ("Round 3/4", "Consensus
  round: 4") while the panel says "Round 1, revised" / "Round 2" (`src/control/requirementDocument.ts:58`) — a design
  choice, left for the human; (d) "Run now" right after a project-setting save got `revision-conflict` worded about
  "this group"; (e) after a panel restart the driver spent minutes in `captureSnapshot → archiveFile` archiving a failed
  run's full-clone workspace; SIGTERM did not stop that panel in 80 s. Its `~/.orca` mtime diff at 10:31 = the
  controller's panel restart for the UI install. (a)(b)(lead) delegated to an implementer (branch `fix/qa-small`);
  (c)(d)(e) registered.
- QA fixes (implementer subagent, branch `fix/qa-small`): `fix(web): an invalid-argument refusal shows the server's
  detail` (the entry text carries `{{detail}}`; Settings › Checks renders through `Refusal.tsx`, not RefusalNotice;
  controller check: every `ControlError("control-argument-invalid", …)` in `src/` passes a detail, and `refusalDetail`
  falls back to the message), `fix(web): flow lock checkboxes and lock refusals name the field in words`, `fix(web):
  the requirement document's lead shows its title as a heading`. Rewritten criteria (Ruling lines):
  `web/tests/flowSettings.test.tsx` "sets the global locks…" (checkbox found by "Token pool per run"),
  `web/tests/requirementsReadability.test.tsx` #77 (no literal "# markdown-export"; an h6 instead). Mutations m1, m2a,
  m2b, m3 red on own cases (`/private/tmp/orca-e236bbe4/qa-fix/m*.log`). Gate: `npm test` 169 files (4 root 38/38, 165
  web 1579/1579), 0 skipped; root scan + noteCodes 7/7; web build 0. Merged --ff-only, installed (panel restart, 200).
  Note: the lead title is an h6 under h5 section headings (RequirementMarkdown maps every heading to h6) — registered.
