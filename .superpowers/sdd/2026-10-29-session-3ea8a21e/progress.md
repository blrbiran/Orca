# Session 3ea8a21e (2026-10-29) — follow-ups of the tester feedback round

Controller: Claude Opus 5.5, session 3ea8a21e. Observed on main after `feat(control): orca task settle-usage works with a
person token -- schema 20 -> 21 records the token's account`.

## Human rulings (verbatim)
- Themes: 「霜白，深色，浅色，蔷薇，紫夜，暮色，余烬。这几个配色还行，其他可以删掉。」
- Reversible calls: 「没特别说明的部分都同意」; native select: 「是不是可以换成 Radix Select 看下效果」; 「terminal 主题不好看」.
- Tester data: 「我去问问，不一定能拿到」. Schema change for settle-usage: 「同意」. Push: 「都已push」.
- 「同意按这个顺序做。这次批准改写所有必要的判据。这一轮允许必要的付费真跑。」(no paid run was needed)
- 「这一次临时允许把所有事情做完后并且写好handoff提交之后，把 ccmem，ccloop，Orca 三个仓库都push 到 origin main」

## Line 1 — themes (merged, installed)
- Commit `feat(web): keep the seven themes the human picked; drop ink, contrast, navy, lagoon and terminal`.
- Gate: `ORCA_CCLOOP_BIN=/private/tmp/orca-3cd8fb02/ccloop-e25381f/dist/cli.js CCLOOP_CACHE_DIR=/private/tmp/orca-s29/cc npm test`
  in the worktree: 172 files selected (4 root, 168 web); root 4/4 files 38 tests, web 168/168 files 1591 tests; 0 skipped; RC 0.
- Mutation (clone /private/tmp/orca-s29/mut1): readTheme returns the stored value unchecked -> red on
  "reads a stored choice of a dropped theme as system" (1 failed | 51 passed).
- Criteria changed (Ruling lines in the files): web/tests/themes.test.ts (list; dropped-id fallback replaces "keeps every
  id"; nav-count chip; high-contrast describe removed), web/tests/i18nPseudo.test.tsx 205 -> 200.

## Line 3 — settle-usage over the socket (merged, installed)
- Spec docs/superpowers/specs/2026-10-29-socket-usage-settlement-design.md; recovery CLI spec §5 appended.
- Gate: same command, 571 root files selected; 541 passed, 30 failed all `panel-dist-missing` (113 of 115 failing tests
  name it; the other two are its consequences) because the worktree had no web/dist; after `npm run build --workspace web`
  the 30 files re-run alone: 30 passed, 262 tests, RC 0. 35 skipped in 8 env-gated files (agentUpdatePaired 3,
  ccloopDefaultE2E 3, ccloopProtocol.integration 3, driverSkillsReal 1, savedResultRecovery.paired 20,
  savedResultRetryAuthorization.paired 3, correctionExport 1, realSmoke 1).
- Mutations (clone /private/tmp/orca-s29/mut2, log /private/tmp/orca-s29/mut2.log), each red, each restored with
  `git diff` 0 bytes and `git diff --cached` 0 bytes: M1 reader socket branch removed; M2 ledgerPersonFor returns null;
  M3 service Web-only; M4 the "20" path skips migrate20To21.
- Install: `sqlite3 ~/.orca/control/panel/control.sqlite ".backup ..."` -> ~/.orca/backups/pre-schema21-20261029-135742/
  (integrity ok, schemaVersion 20, 61 commands rows); `npm run build`, `npm run build --workspace web`,
  `launchctl kickstart -k gui/$(id -u)/dev.orca.panel`; after: schemaVersion 21, `count(person_principal)` 0 of 62, HTTP 200.

## Line 2 — Radix Select trial (branch ui/radix-select-trial, not merged)
- Commits `feat(web): trial -- Radix Select for the theme and language pickers ...`, `test(web): the language switch
  criterion picks from the Radix select by keyboard (trial)`.
- Web suite on the branch (`cd web && vitest run`): 183 files; 3 i18nSwitch reds before the criterion rewrite, then
  i18nSwitch + settingsScopes 16/16. No mutation run (trial).
- Screenshots /private/tmp/orca-s29/shots/ (4 themes x 1280/390 x closed/open); scrollWidth equals viewport, no pageerror.

## Incident
- `npm ci` in the trial worktree ran while its node_modules was still a symlink to the main repo's (the `unlink` was in a
  command the Tier 0 gate refused whole, so it never ran). npm emptied the main repo's node_modules through the link.
  Recovered: main `npm ci` (package-lock byte-identical to the worktree's, `cmp` 0; ccloop resolves to e25381f),
  panel restarted, HTTP 200, `git status` clean.
