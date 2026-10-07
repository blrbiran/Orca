# Part B B-gate (ccloop orca/usage-by-model)

Head: bb96485 (worktree clean at start). Base e5ad09a. Env: ECC_GATEGUARD=off DISABLE_OMC=1. Raw outputs: `$SCRATCH/gate/` (partB/gate).

| command | rc | counts | load |
|---|---|---|---|
| npm run typecheck | 0 | - | - |
| npm run build | 0 | - | - |
| npm run verify:control (no env) | 1 | refused: needs ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE (not a code failure) | - |
| npm run verify:control (ORCA_CCLOOP_BIN=this dist/cli.js, ORCA_AGENTS_TABLE=gate/agents-table.json, a scratch table naming only tests/fixtures/fake-codex.mjs and fake-claude-cli.mjs) | 0 | 51 files / 490 tests passed | - |
| vitest run (json) | 0 | 1211 total, 1211 passed, 0 failed, 0 pending; 325 suites, 0 failed | before `17:52 load 6.54 10.10 12.46`, after `17:53 load 27.39 15.84 14.48` |
| check-known-reds.mjs | 0 | roster 6, failed 0, unexpected 0 | - |

No red outside the known-red list; no re-run needed.

## Add-only
`git diff --stat e5ad09a..HEAD -- tests`: 4 files, 533 insertions, 0 deletions (usageByModel, workerByModel, claudeModelUsage, codexModelUsage tests). name-status: 11 M under src/ and scripts/, 4 A under tests/, no D, no M under tests/.

```
M scripts/claude-phase-runner.mjs
M scripts/claude-stream.mjs
M src/control/command.ts
M src/control/singleCall.ts
M src/control/usage.ts
M src/control/worker.ts
M src/controller/runLoop.ts
M src/runtime/claude/claudeAgentAdapter.ts
M src/runtime/codex/codexAdapter.ts
M src/runtime/codex/protocol.ts
M src/runtime/types.ts
A tests/control/usageByModel.test.ts
A tests/control/workerByModel.test.ts
A tests/runtime/claude/claudeModelUsage.test.ts
A tests/runtime/codex/codexModelUsage.test.ts
```

## Mutation (c), B3
Clone --local at bb96485, npm ci. Deleted `if (model.length < 1 || model.length > 200) return null;` in codexModelUsage (src/runtime/codex/protocol.ts line 114). Ran tests/runtime/codex/codexModelUsage.test.ts: rc=1, 1 failed / 3 passed. RED: `codexModelUsage > is null without a completion, and for a model name the schema would refuse`, assertion `expected [ { model: '', input: 1, ... } ] to be null` at codexModelUsage.test.ts:28. Restored via git checkout; `git diff | wc -c` = 0, `git diff --cached | wc -c` = 0; clone removed with /bin/rm -rf.

## Commits e5ad09a..HEAD
```
bb96485 feat(codex): report usage for the run's model
917d65e fix(claude): take the per-model breakdown only from claude's envelope
ddfdf9f feat(claude): report usage per model from claude's modelUsage
2f053d6 feat(control): carry a per-model breakdown on usage events
```
