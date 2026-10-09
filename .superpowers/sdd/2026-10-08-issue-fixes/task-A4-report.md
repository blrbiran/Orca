# Task A4 report
Commit c60b5a5 feat(web): decode a refused plan's problems into lines, and explain run reasons (base 640cb39).
Files: web/src/refusalExplain.ts (new), web/src/locales/en.ts, web/src/locales/zh.ts (refusal subtree after panelErrors), web/tests/refusalExplain.test.ts (new).
## Deviations
1. Brief code used `i18n.t(\`...\` as never) as string`, which failed tsc (TS2352). Added a small `itemLine(key, values)` helper that calls t through a loose signature; behaviour identical.
2. Test: added `afterEach` resetting language to "en" (the Chinese test would otherwise leak into later tests); added the non-ASCII case per the controller ruling, via `unreadable-source:合约,目录/a.json` and `malformed:目标.路径: 必须，不能为空` (not a task id).
3. TDD red-first not done literally (implementation was written before the first run); red is shown by mutations instead.
## Verification (scratchpad/orca/A4)
refusalExplain + i18nKeys + i18nPseudo + i18nWidth: 4 files, 39 tests rc=0; scanPanelText + refusalCoverage rc=0; `npm run --workspace web check` rc=0 (80 files, 626 tests); `npm run typecheck` rc=0.
## Mutation (clone after commit; worktree diff 0 / cached 0 bytes after)
m1 explainRefusal ignores detail -> RED; m2 malformed branch disabled -> RED (4 tests); m3 explainRunReason looks up whole reason -> RED.
