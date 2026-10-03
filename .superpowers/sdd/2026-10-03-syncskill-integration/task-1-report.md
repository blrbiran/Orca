# Task 1 report: ccloop skillPluginDir (claude --plugin-dir, codex refused)

Implementer: orca-dev subagent (session 08b1007d), repo /Users/biran/code/skills/loop/ccloop, branch main, base 85a9564.
Commits (local, not pushed):
- 5f58806 feat(control): carry a skill plugin dir on the loop work and load it into claude (Orca syncskill integration)
- af26a22 test(control): retry the temp-dir removal in the skillPluginDir accept test (a claude worker may still be sealing)

## Implemented
- `src/control/protocol.ts`: `loopWorkSchema.skillPluginDir: z.string().min(1).optional()`; `LoopWork.skillPluginDir?`; `validateEnvelopePaths(envelope, method)`: if the field is present, `isAbsolute` for every method, `validateCanonicalDirectory` only when `method === "accept"`. `parseControlRequest` passes `method` at both call sites.
- `src/control/accept.ts`: loop work with the field and `config.kind !== "claude"` throws `ControlProtocolError("skills-unsupported-agent")` right after the single-call refusal, before anything is persisted.
- `src/control/worker.ts`: builds `adapterOptions` from the envelope and passes it to `createAdapter`.
- `src/agents/registry.ts` (signature `createAdapter(config, options?)`), `claude.ts` (forwards options), `codex.ts` (`_options`, ignored).
- `src/runtime/claude/claudeAgentAdapter.ts`: constructor `options = {}`; `extraArgs` gets `--plugin-dir <dir>` after `--model`; `this.command` is the installation command minus `--disable-slash-commands` when the dir is set; used for `claudeCommand` in outcome.json and `CCLOOP_CLAUDE_COMMAND`.
- `docs/control-protocol-v1.md`: one paragraph documenting the field, the accept-only existence check and `skills-unsupported-agent` (exit 2).
- Error-code registration: `git grep single-call-unsupported` shows only accept.ts, singleCall.ts and one test. ccloop has NO central enumeration of control error codes and no per-code CLI exit mapping (`ControlProtocolError(code: string)`, every ControlProtocolError is exit 2, stderr `<code>\n`; proven by the new codex test which asserts `{code:2, stdout:"", stderr:"skills-unsupported-agent\n"}`). The only Orca-facing doc listing codes is an example list in docs/control-protocol-v1.md, which got the paragraph above. README has no code table.

## Tests (all new, additive)
- `tests/runtime/claude/claudeSkillPluginDir.test.ts` (6): per phase plan/execute/verify, argv without the field equals a golden (captured by running the fake-claude path at base 85a9564 BEFORE the change; only the --json-schema value differs per phase), outcome.json extraArgs/claudeCommand unchanged; with the field, argv has `--plugin-dir <dir>`, no `--disable-slash-commands`, `--strict-mcp-config` kept, everything else equals the golden in order; outcome.json claudeCommand/extraArgs match.
- `tests/control/protocol.test.ts` (+5 appended in a new describe): canonical hash golden `032325fb451b1403ba45b211630306a2c8c961e707d872f48989c9893b71bf80` (fixed-path loop envelope, computed at 85a9564 before the schema change); existing canonical dir parses and keeps the field; relative path refused for accept/inspect/handoff/collect/read-evidence; non-existent and symlinked dir refused for accept only, parses for the other four; single-call work refuses the field (strict schema).
- `tests/control/skillPluginDirAccept.test.ts` (3): codex + field -> exit 2 `skills-unsupported-agent`, `sourceDir` empty (readdir `[]`, `control/accepted.json` ENOENT); claude + field -> accepted and sealed envelope contains the field; codex without field -> still accepted.
- `tests/control/skillPluginDirWorker.test.ts` (2): real `runControlWorker` loop with fake claude: all three claude calls carry `--plugin-dir <dir>` and no `--disable-slash-commands`; without the field the installation flag stays and no `--plugin-dir`.
- Results: the four new files together: 30 tests passed (in clone; also 6x repeated for Accept+Worker files, rc 0 each).

## TDD evidence
- RED before implementation (`vitest run tests/runtime/claude/claudeSkillPluginDir.test.ts`, main tree, HEAD adapter): `Tests: 3 failed` with `expected [ '--strict-mcp-config', …(11) ] to include '--plugin-dir'` for plan/execute/verify; the 3 "without" golden tests passed (they pin pre-change behavior).
- RED protocol (`vitest run tests/control/protocol.test.ts`, before implementation): `19 tests | 3 failed` (canonical-dir parse keeps field, accept-only existence, + the hash test while its golden was the placeholder; hash then pinned to the measured value). The relative-path and single-call tests pass already at base because the strict schema refuses an unknown key; they become meaningful guards after the change (see M4b).
- Accept/worker tests were written after the implementation; their redness is shown by mutations M3, M3b, M5, M6, M9 below.
- GREEN: after implementation, protocol + accept + adapter files: `Tests 28 passed (28)`; then worker file added: 30 passed.

## Mutation table (clone /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/08b1007d-4dc6-44c3-9772-c05f71d2ae7c/scratchpad/t1-mut, committed 5f58806, `npm run build` done; each mutation applied with a python exact-replace, tests = the 4 new/edited files; restore = `git checkout -- .`)
Every row: after restore `git diff` = 0 bytes and `git diff --cached` = 0 bytes (bytes `wc -c`). "mut diff" is the byte count of `git diff` while mutated.

| id | mutation | tests that went red (seen) | mut diff |
|---|---|---|---|
| M1 | drop the `--plugin-dir` push (M-brief M1) | 3 adapter "with skillPluginDir" (plan/execute/verify) + worker "loads the plugin" | 851 |
| M2 | filter `--disable-slash-commands` unconditionally (M-brief M2) | 3 adapter "without ... golden" + worker "without the field" | 923 |
| M2b | never filter the flag | 3 adapter "with ..." + worker "loads the plugin" | 871 |
| M3 | remove the accept refusal (condition -> `false`) (M-brief M3) | accept "refuses a codex run" | 662 |
| M3b | refusal drops the `skillPluginDir !== undefined` guard | accept "still admits a codex run that names none" | 681 |
| M4 | validate existence for every method (M-brief M4) | protocol "requires an existing canonical directory for accept only" (inspect/handoff/collect/read-evidence with a removed dir) | 818 |
| M4b | drop the `isAbsolute` check | protocol "refuses a relative path for every method" | 791 |
| M4c | drop the accept-only canonical check | protocol "requires an existing ... for accept only" | 761 |
| M5 | worker passes `undefined` instead of the options | worker "loads the plugin" | 778 |
| M6 | claude descriptor does not forward options | worker "loads the plugin" | 377 |
| M7 | outcome.json `claudeCommand` uses installation.command | 3 adapter "with ..." | 870 |
| M8 | `CCLOOP_CLAUDE_COMMAND` uses installation.command | adapter 3 "with ..." + worker "loads the plugin" (+2 accept tests failed in the shared-output rerun for ENOTEMPTY cleanup, see concerns) | 758 |
| M9 | remove the schema field | protocol parse+accept-only, accept codex refusal, worker "loads the plugin" | 673 |

Note: the first mutation batch's M7/M8 output files were interleaved with an unrelated earlier run, so M7 and M8 were re-run cleanly as R7/R8 (rc 1, results as in the table). Mutations ran on 5f58806; af26a22 only changed the temp-dir removal in one test file.

## Gate (fresh clone t1-gate at af26a22; HOME/XDG_* redirected to scratchpad dirs, TMPDIR=/private/tmp/cl-nODs, ECC_GATEGUARD=off DISABLE_OMC=1)
- `npm run build` rc 0.
- `./node_modules/.bin/vitest run --reporter=json --outputFile=<gate.json>`: rc 1 (expected, the one known red); totals from the json: 1140 tests, 1139 passed, 1 failed, 0 pending, 307 suites; wall 58.2 s (`time`).
- `node scripts/check-known-reds.mjs <gate.json>` rc 0: `known reds in roster: 9; failed: 1; known quiet execution proof > does not treat leader exit as group quiet and proves only after the full tree is gone; unexpected: 0`.
- `node scripts/check-tmp-leak.mjs` rc 0: `0 entries left in /private/tmp/cl-nODs/cl-MpoXGK`.
- `npm run typecheck` rc 0.
- uptime before: `16:21 up 31 days, 20:02, 46 users, load averages: 12.38 9.35 6.10`; after: `16:22 ... load averages: 36.78 17.49 9.40` (heavily loaded host; no load-induced timeouts occurred, so no per-file reruns were needed).

## Existing tests modified
None modified. One existing support file extended additively: `tests/fixtures/fake-claude-cli.mjs` now accepts `--disable-slash-commands` and `--strict-mcp-config` (flags) and `--plugin-dir <value>`; without this the fake exits 2 on the installation's real flags. `tests/runtime/claude/fakeClaudeCli.test.ts` (which pins "unknown argument --continue") still passes. `tests/control/protocol.test.ts` only had a describe appended.

## Decisions
1. `validateEnvelopePaths` receives `method` (per controller). Consequence found by test: `runControlWorker` re-parses its sealed envelope with `parseControlRequest("accept", ...)` (worker.ts ~L109), so the worker also requires the dir to exist at worker start. That holds for a live run (Orca creates the dir before accept and removes it after landing).
2. Hash golden uses a fixed-path envelope (the shared fixture has random tmp paths).
3. The adapter golden captures the argv slice the fake sees (command prefix excluded), with the prompt replaced by `<prompt>`; installation command in the test includes `--strict-mcp-config --disable-slash-commands` so a conditional filter is observable.
4. No new central error-code registry created (none exists; Rule 2).
5. Added a worker-level test (not in the brief) because the `worker.ts` wiring and the `claude.ts` forward are new branches that no other test covers (M5, M6).

## Concerns
- ENOTEMPTY flake: in the accept test the claude worker is detached and may still be writing under `source/control` when afterEach removes the dir; saw it once (under M7 rerun) as `ENOTEMPTY ... source/control`. Fixed in af26a22 with `rm` `maxRetries: 20, retryDelay: 100`; 6 consecutive reruns of the Accept+Worker files were green under load average ~11. Residual risk is low but non-zero.
- Worker restart after the dir is removed (e.g. a crash-resume relaunch after workspace deletion) would fail `control-request-invalid` at worker start; not reachable while the run is live. Orca Task 6 should keep the dir until the run is terminal and collected.
- `skillPluginDir` is not canonicalized by symlink-free realpath for non-accept methods (only isAbsolute), as the brief specifies.

## Files changed (vs 85a9564)
docs/control-protocol-v1.md, src/agents/{claude,codex,registry}.ts, src/control/{accept,protocol,worker}.ts, src/runtime/claude/claudeAgentAdapter.ts, tests/fixtures/fake-claude-cli.mjs, tests/control/protocol.test.ts (appended), new: tests/control/skillPluginDirAccept.test.ts, tests/control/skillPluginDirWorker.test.ts, tests/runtime/claude/claudeSkillPluginDir.test.ts.
