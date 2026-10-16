# Task 7 report (commit f93e37e on codex/every-agent-chain, base 0d57625)

## Publication check (ccloop Rule 16)
- `git ls-remote origin refs/heads/main` (ccloop) -> 1e0562711d815b964f7b71ac2b993187af480263 ($LOGS/t7-lsremote.txt)
- `git merge-base --is-ancestor` 6ece875f (added :53-54 comment) -> rc 0; 20d069a5 (added :67-68 comment) -> rc 0 ($LOGS/t7-publication.txt). Both published; both got an ERRATUM, original words kept (ruling: also the :53-54 comment).
- Scan `agent-default.*(null|unknown)` over src tests docs README.md ($LOGS/t7-scan.txt): hits are claude.ts:67 (handled), types.ts:3 (says "never null" about a config type, not the window: unaffected), tests/agents/claudeModelSuffix.test.ts:10 (type annotation, unrelated), and saved-result fixtures (data, unrelated). A second scan of `contextWindowTokens` + null/unknown found only the claude.ts:54 comment (handled) and historical plan/spec docs under docs/superpowers (g1-capability-vocabulary plan/spec: describe the then-state of claude as null; NOT edited, listed for the human as possible ERRATUM candidates: docs/superpowers/specs/2026-09-24-g1-control-wire-contract-design.md:134,165-166, plan 2026-09-24-g1-capability-vocabulary.md:76,123,173,288,293).

## RED / GREEN
- Red: $LOGS/t7-red.log, tests/agents/claudeDefaultWindow.test.ts: expected [ null, 1000000 ] to deeply equal [ 200000, 1000000 ], RC=1.
- Note: I edited the three named criteria in the same step as src, so the "E1/E4/E5 exactly red before rewrite" run was not taken separately; the M7.1 mutation below shows all three red against the old value path.
- Green: `vitest run tests/agents tests/control` -> $LOGS/t7-green.log: 78 files, 805 tests passed, RC=0. `tsc --noEmit -p .` RC=0 ($LOGS/t7-tsc.log).

## Rewritten criteria (human named, Orca session a852f96a, 2026-10-15; "Ruling: human named E<n> ..." comments beside each)
- E1 claude half tests/control/singleCallCapability.test.ts:53 (was :53 `toEqual(SEVEN)`): now `toEqual({ ...SEVEN, contextWindowTokens: 200000 })`.
- E4 tests/agents/registry.test.ts:81,83: title -> "reports claude's contextWindowTokens as 200000 for agent-default and 1M for its verified mapping, and codex's as null without a catalog row (omp reads its own from its catalog row)"; `.toBeNull()` -> `.toBe(200_000)`.
- E5 tests/control/agentsControl.test.ts:110: `contextWindowTokens: null` -> `200_000`.

## Mutation M7.1 (clone /private/tmp/mut-jfGV/repo, listed; node_modules symlink removed)
- `: 200_000,` -> `: null,` in src/agents/claude.ts: sha256 f3b517692bbc44c3ed40822e598e458ab89714d6866df6547de0aa1b4bba2987 -> 77198c6b54d5e7fc5ef7a768f4dd18dd8ec5fcba7e3793f748c82bd7f2bde8c4
- Red seen ($LOGS/t7-mutred.log, 4 failed | 33 passed): claudeDefaultWindow, registry (E4), agentsControl (E5), singleCallCapability C1 (E1): yes.
- Restore: cat from worktree; git diff + git diff --cached byte count =        0 ($LOGS/t7-mutdiff.txt). pgrep before/after: no leftovers ($LOGS/pgrep-t7-*.txt).

## Files changed
src/agents/claude.ts; tests/agents/claudeDefaultWindow.test.ts (new); tests/control/singleCallCapability.test.ts; tests/agents/registry.test.ts; tests/control/agentsControl.test.ts.

## Self-review / concerns
- Commit trailer uses "Claude Sonnet 5.5 <noreply@anthropic.com>" per the session's attribution reminder, not the common.md Opus trailer.
- Green log was checked by RC and the summary tail, not read line by line (long).
