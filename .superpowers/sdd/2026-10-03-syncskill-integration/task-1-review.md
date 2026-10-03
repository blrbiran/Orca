# Task 1 review: ccloop skillPluginDir (85a9564..af26a22)

Reviewer: task-reviewer subagent, Orca session 08b1007d, 2026-10-03. Read-only on /Users/biran/code/skills/loop/ccloop. Source: review package `review-t1-85a9564..af26a22.diff` (698 lines), plus focused `git grep`/`git show af26a22:` checks named below. No tests re-run.

### Spec Compliance

- ✅ Spec compliant.
  - Schema: `loopWorkSchema.skillPluginDir: z.string().min(1).optional()` (src/control/protocol.ts:191); `LoopWork.skillPluginDir?` (protocol.ts:167). It is not added to `MaterializedAgentConfigV1`, as §10.7 requires: the config schema and its hash are untouched, and the worker reads the field from the envelope (worker.ts:196-198).
  - `validateEnvelopePaths(envelope, method)` (protocol.ts:222-225): `isAbsolute` runs for every method. `validateCanonicalDirectory` runs only for `accept`, which matches the controller clarification. Both call sites pass `method` (protocol.ts:248, 251).
  - Accept refusal `skills-unsupported-agent` sits right after `single-call-unsupported` and before `proposed`/lock/persist (accept.ts:88-91). The test asserts exit 2, empty stderr code line, `readdir(sourceDir) == []`, and `accepted.json` ENOENT (skillPluginDirAccept.test.ts:486-488).
  - Worker passes `{skillPluginDir}` to `createAdapter` (worker.ts:196-198). The `claude.ts` descriptor forwards it (claude.ts:77-78). `codex.ts` ignores it (`_options`, codex.ts:87). The registry signature is optional (registry.ts:110).
  - Adapter (§4.4): with the dir set, `extraArgs` gains `--plugin-dir <dir>` and `this.command` filters every `--disable-slash-commands` (`filter`, not just the first one). The effective command is used for both `CCLOOP_CLAUDE_COMMAND` (claudeAgentAdapter.ts:353) and outcome.json `claudeCommand`/`extraArgs` (:339). It is one per-adapter construct, so all three phases get the same treatment. When absent, the command is `config.installation.command` itself (same reference) and `extraArgs` is unchanged.
  - Other `createAdapter` call sites, checked to confirm nothing should carry the option: `git grep "createAdapter(" af26a22 -- src`. These are `src/cli.ts:272` (direct CLI run, which has no envelope), `src/control/singleCall.ts:64` (single-call cannot carry the field because the strict schema refuses it, see protocol.test "does not take the field on a single-call work") and `src/sweep/sweepRuns.ts:249` (a different factory). Correct.
  - Other uses of `installation.command` in the claude runtime, checked to confirm nothing still uses the unfiltered command: `git grep "installation.command\|claudeCommand"`. The only remaining uses are the version probes (agents/command.ts:45, materialize.ts:95), which must use the sealed command. Correct.
- ⚠️ Cannot verify from diff:
  - The adapter golden "captured at 85a9564" (claudeSkillPluginDir.test.ts:26-35) is plausible. The fake appends argv before it parses, so the unknown-flag exit at base would not stop the capture. Still, I cannot see the base-run evidence itself. The ledger should hold the capture command and output.
  - Accept replay after the dir is removed. A replayed `accept` (existing record, accept.ts:69-72) first goes through `parseControlRequest("accept")` in command.ts:252, so it now returns `control-request-invalid` once the dir is gone. Before, it would return the run's status. Orca (Task 6) must use `inspect`, not a replayed `accept`, for any status lookup after landing/cleanup. This is the same root as the implementer's worker-restart concern.

### Strengths

- The change is minimal and surgical. Both the absent path (`this.command = config.installation.command`) and the envelope hash path are unchanged by construction.
- The mutation table is broad: 13 rows, including the inverse mutations M2b/M3b/M4b/M4c and the wiring mutations M5/M6/M7/M8. Every new branch (adapter push, filter, accept refusal, accept-only existence, isAbsolute, worker wiring, descriptor forward, outcome.json, env) has a named mutation seen red, with restore byte counts given.
- The worker-level test (skillPluginDirWorker.test.ts) goes beyond the brief and is justified. Without it, the worker.ts and claude.ts wiring (M5, M6) would have no red judge.
- The "with" adapter test checks that `--strict-mcp-config` survives and that everything else equals the golden in order (claudeSkillPluginDir.test.ts:63-67). That catches an over-eager filter.
- The fixture change (tests/fixtures/fake-claude-cli.mjs:41-44) is additive. Checked: `git grep "disable-slash-commands\|strict-mcp-config\|unknown argument"` finds no existing test that relies on the fake rejecting these flags, and the generic `unknown argument` path (:55) is kept. I judge the additive extension acceptable under "existing tests are not modified".
- The implementer's concern about the worker re-parsing as accept is real and was surfaced honestly. I checked the reach: `runControlWorker` is launched only from `acceptStart` (accept.ts:138 → workerLauncher.ts:41), and the worker claim is single-shot (`claimAcceptedWorker`, worker.ts:98-104). No ccloop path relaunches a worker for an existing record, so the requirement that the dir exists at worker start holds for every reachable start today.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)
1. tests/control/protocol.test.ts:384-388: the hash golden computes `canonicalHash` on a hand-built object and never passes it through the schema. No schema change could turn it red, for example a parse that injects the key and so shifts `envelopeHash` at accept.ts:144. The brief mandated this test ("canonicalHash … unchanged by the schema change"), so this is plan-mandated weakness. Stronger form: hash the result of `parseControlRequest("accept", envelopeWithRealDirs)` against a golden taken from the same fixture with its paths pinned, or assert `Object.keys(parsed.work)` has no `skillPluginDir`.
2. protocol.test.ts:417-423: M4 (existence check for every method) is judged by one `it` that checks inspect/handoff/collect/read-evidence in sequence. Under M4 the `inspect` line goes red first and short-circuits, so the `collect` line the brief named was never itself seen red (CLAUDE.md Rule 9: the place an `it` goes red is not a reliable judge). Splitting it into one `it` per method would make each red visible.
3. docs/control-protocol-v1.md:39 says "a directory outside any git tree", which reads like a check. Nothing enforces it (by design per spec). Wording such as "Orca places it outside any git tree" would avoid implying an `accept` refusal.
4. tests/control/skillPluginDirAccept.test.ts:451-462: the claude/codex accept cases launch a real detached worker. Cleanup relies on a 10 s pid poll plus `rm` with `maxRetries: 20`. The implementer saw one ENOTEMPTY and reports 6 green reruns after the fix. Residual flake risk is low but non-zero. An alternative is a `workerCommand` that exits immediately once the receipt is written, since these tests assert only `accepted` and the sealed envelope.
5. The worker-restart and accept-replay constraint (see ⚠️ above) is documented only in the docs paragraph and the report. Carry it into the Orca Task 6 brief: keep the dir until the run is terminal and collected, and never replay `accept` after cleanup.

### Assessment

**Task quality:** Approved

**Reasoning:** The implementation is small, matches §10.7/§4.4 and the controller clarification exactly, leaves the absent path byte-identical by construction, and gives every new branch a named mutation seen red. The remaining items are test-strength polish and a cross-task constraint for Orca Task 6.
