# Session 663fb68e, 2026-11-01

Who: Claude Code (Opus 5.5). Scratch: `/private/tmp/orca-663fb68e/` (lost with the machine's /tmp cleanup).

## Human rulings (verbatim)
- Q1 a (one row of filters), Q2 a (fix the two label residuals), Q3 a (flow settlement: design only): 「Q1 a / Q2 a / Q3 a」. Q1's text included authority to rewrite the criteria it needs.
- 「这次批准改写所有必要的判据。这一轮允许必要的付费真跑。」「如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」
- The usage excerpt: `orca_archived_files/run-3e770d4e-usage-excerpt.json`. Pushes before this session: done by the human.

## Remote check at start
`git ls-remote origin refs/heads/main` equalled local main: Orca 21c08f7f, ccloop 629214e, ccmem 20a281d.

## Work 1: requirement filters and label fixes (merged --ff-only, installed)
Commits: `feat(web): one row of filters ...`, `fix(web): a refused label stays in the field ...`, `test(web): an open archived requirement stays out ...`.

Criteria rewritten (each with a Ruling line, reason Q1 a): `web/tests/requirementsFinished.test.tsx` (whole file, 8 tests), `feedbackRequirements.test.tsx:50`, `followupApp.test.tsx:99`, `requirementsApp.test.tsx:193`. Two existing label criteria in `taskLabels.test.tsx` went red on my first implementation (awaiting a sync handler); the implementation changed, not the criteria.

Red seen before implementing: 6 filter, 1 old criterion, 2 label (`red.log`).

Mutations, clone only (`mutate.log`, `m3.log`; baseline 26 green):
M1 active lists everything: 3 red. M2 selected dropped: 1. M3 archived selected kept: 0 at first, so a criterion was added, then 1. M4 archived as finished: 2. M5 empty part drops button: 2. M6 wrong empty note: 1. M7 aria-pressed false: 2. M8 clear whatever the answer: 1. M9 never clear: 1. M10 no in-flight guard: 1. M11 guard never released: 3. M12 guard in add: 0, redundant with change()'s, so the guard was removed.

Gate (`npm test` at the last commit, `npm-test.log`, ORCA_CCLOOP_BIN = clone of ccloop 026c571): typecheck no errors; 176 files selected (4 root, 172 web); 38 and 1629 passed; 0 skipped; RC 0.

Browser (`shot.py`, built bundle, fake API, zh and en at 1280 and 390): one row except en at 390 (two rows); no overflow; no pageerror. Screenshots `/private/tmp/orca-663fb68e/shots/`.

Install: `npm run build` RC 0, web build RC 0, `launchctl kickstart -k gui/501/dev.orca.panel`. 7777 `/index.js`: 200, 1159606 B, same as `web/dist/index.js`, and contains "Which requirements to list". Schema unchanged. Worktree removed, branch deleted with -d.

## Work 2: the 250k input
Findings and tables: `docs/superpowers/specs/2026-11-01-overview-token-cost-findings.md`.
Paid: claude haiku five calls, tool-reported total $0.16007721. Codex: two attempts refused before answering (usage limit until 2026-11-04 16:12), no usage reported. Isolation: Codex via a temp CODEX_HOME (no hooks, no config), `~/.codex/config.toml` sha256 unchanged 10513ff6...; claude with `--setting-sources ""`, no tools, no session file, auto memory off, and no new directory under `~/.claude/projects` for the scratch cwd.
Store reads: a copy of the backup `~/.orca/backups/pre-schema21-20261029-135742/control.sqlite`, never the live store.

## Work 3: design only
`docs/superpowers/specs/2026-11-01-flow-call-unknown-usage-settlement-design.md`. Found in design: `syncWebBudget` is a no-op for a flow parent; a settled call's pool return would otherwise give the draw back.

## Decided for the human (for review)
1. Three filters, no "All": no combined view. As approved in Q1.
2. All three buttons stay with count 0.
3. New empty note when other filters hold rows.
4. An open finished requirement stays listed under any filter; an open archived one only under Archived.
5. While a label change is unanswered, further changes are ignored, with no visible busy state; the field keeps the text.
6. Overview caps not changed: changes what models see and needs a quality comparison.
7. Flow settlement not implemented.

## Left
See handoff §4.2 and §8.
