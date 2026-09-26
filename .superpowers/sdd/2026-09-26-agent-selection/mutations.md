# Mutation battery results (append-only)

## T6 — `ccloop run --agents <table> --agent-selection <file>` (ccloop `src/cli.ts`)

Implemented on ccloop `main`, commit `5955e27` (`feat(cli): run with an agents table and a frozen
selection`), base `6439eb2`. All mutations run in `git clone --local` copy
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/impl/mut-t6`
(node_modules symlinked from the main tree), only `tests/cli/agentsRun.test.ts` run per mutation,
reverted with `git checkout -- src` after each (post-revert `git diff --stat` byte count 0 every
time). Logs: `scratchpad/W2/mut-T6M*.log`.

- MUTATION: T6M1 (deleted `if (resolution.configHash !== file.data.configHash) { throw … }` block in `runWithAgents`) -> red: only `refuses a selection file whose configHash differs, before anything runs` (11/12 pass)
- MUTATION: T6M2 (deleted `if (values.has("--adapter") || values.has("--adapter-config")) { throw … }` block in `parseArgs`) -> red: both `refuses ["run",...,"--adapter","codex"]` and `refuses ["run",...,"--adapter-config","a"]` (10/12 pass)
- MUTATION: T6M3 (`resolveAgent(table, file.data.selection)` changed to pass `{ probeVersion: async () => table.installations[file.data.selection.agent]!.version }`) -> red: only `refuses an installation whose --version no longer matches the table, before anything runs` (11/12 pass)
- MUTATION: T6M4 (deleted `if (command !== "run") { throw … }` block in `parseArgs`) -> red: both `refuses ["resume",...]` and `refuses ["sweep",...]` (10/12 pass). Widened from the brief's "only resume" because this implementation added a sweep row to the same `it.each` table (plan-review P23 m6: sweep must also refuse `--agents`); deleting the one shared `command !== "run"` check now visibly protects both commands.
- MUTATION: T6M5 (deleted `if (!file.success) throw …` line; downstream `file.data.selection`/`file.data.configHash` reads changed to `(raw as any).selection`/`(raw as any).configHash`) -> red: only `refuses a malformed selection file by name` (11/12 pass) — the malformed selection (extra field) now clears validation and reaches `resolveAgent` successfully, but its `configHash` ("0".repeat(64), from the test fixture) still doesn't match the materialized one, so the run is refused for `control-config-hash-mismatch` instead of `agent-selection-file-invalid`; the named test still goes red on the wrong message, which is the mutation's target.
- MUTATION: T6M6 (`if (!agentsRunDir || !agentsContractPath || !agentsTablePath || !agentSelectionPath)` narrowed to `if (!agentsRunDir || !agentsContractPath)`) -> red: both `refuses ["run","--contract","c","--run-dir","r","--agents","t"]` and `refuses ["run","--contract","c","--run-dir","r","--agent-selection","s"]` (10/12 pass) — exactly the two rows that were already green at RED time (today's `missing required flags` message was coincidentally the same before this task's code existed).
- MUTATION: T6M7 (deleted `if (config.kind === "codex") console.error(...)` line in `runWithAgents`) -> red: only `runs a codex installation the same way, with codex's soft-budget notice` (11/12 pass)

All seven mutations match the plan's "red (and only that)" expectation, adjusted where noted for
the added sweep test row.

## T6 fix round 1 — malformed-JSON criterion for the selection-file `try/catch`

Review finding (Important): `src/cli.ts`'s selection-file `try { raw = JSON.parse(...) } catch {
throw new AgentError("agent-selection-file-invalid", ...) }` block (`runWithAgents`, ~:284-288 at
commit `5955e27`) had no criterion and no mutation — every existing `agentsRun` test wrote
syntactically valid JSON, so the `catch` branch never actually ran. Fixed by commit `988f82b`
(`test(cli): cover a selection file that isn't valid JSON`), adding one criterion to
`tests/cli/agentsRun.test.ts`: writes genuinely malformed JSON (`'{"selection":'`, truncated, not
parseable) to the selection file and asserts exit code 1 and `stderr.startsWith("agent-selection-file-invalid")`.
GREEN before the mutation: `tests/cli/agentsRun.test.ts` 13/13, full `tests/cli` 56/56 (the
try/catch already worked; only the criterion was missing).

Mutation run in a fresh `git clone --local` copy (literal path, cloned from ccloop `main` at
`988f82b` so the clone includes the new criterion) at
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/impl/mut-t6-fix1`
(`node_modules` symlinked). Only `tests/cli/agentsRun.test.ts` run. Reverted with
`git -C <literal clone path> checkout -- src`, confirmed by `git diff --stat` (0 bytes) and
`git status --porcelain` (only the untracked `node_modules` symlink remains). Log:
`scratchpad/W2/mut-T6M8.log`.

- MUTATION: T6M8 (deleted the `try { raw = JSON.parse(...) } catch (error) { throw new AgentError("agent-selection-file-invalid", ...) }` wrapper in `runWithAgents`, letting `JSON.parse`'s `SyntaxError` propagate uncaught to `main`'s generic catch) -> red: only `refuses a selection file that isn't valid JSON` (12/13 pass) — exit code is still 1 either way (main's generic catch also returns 1), but stderr becomes the raw `SyntaxError` message instead of starting with `agent-selection-file-invalid`, so only the code-name assertion fails.

## Aggregated mutation records from every implementer report (controller, session `ab5a693c`, 2026-09-26)

> Copied verbatim from each report (python line scan). Lines containing `MUTATION:`; for reports that recorded mutations only as table rows (T8, T12) the table rows are copied instead. The T6 entries above are the T6 implementer's own and stay as written. Fix-round mutations recorded only in wave/fix reviews are not repeated here; see those files. The T17 mutation-battery seat re-runs these on the final tree and records the results in a later section.

### T1 (35)

- MUTATION: M1 model may start with - -> `tests/agents/registry.test.ts` RED (rc=1)
- MUTATION: M2 model may carry whitespace/control -> `tests/agents/registry.test.ts` RED (rc=1)
- MUTATION: M3 model length unbounded -> `tests/agents/registry.test.ts` RED (rc=1)
- MUTATION: M3b empty model allowed -> `tests/agents/registry.test.ts` RED (rc=1)
- MUTATION: M4 context option unchecked -> `tests/agents/registry.test.ts` RED (rc=1)
- MUTATION: M5 claude reports requested window always -> `tests/agents/registry.test.ts` RED (rc=1)
- MUTATION: M6 claude 1M never reported -> `tests/agents/registry.test.ts`, `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M7 [1m] suffix dropped -> `tests/agents/registry.test.ts` RED (rc=1)
- MUTATION: M8 codex configDir not passed -> `tests/runtime/codex/extraEnv.test.ts` RED (rc=1)
- MUTATION: M9 extraEnv not spread -> `tests/runtime/codex/extraEnv.test.ts` RED (rc=1)
- MUTATION: M10 adapter drops extraEnv -> `tests/runtime/codex/extraEnv.test.ts` RED (rc=1)
- MUTATION: M11 installation not strict -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M12 installation id unchecked -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M13 no O_NOFOLLOW -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M14 non-regular file allowed -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M15 file mode/owner unchecked -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M16 parent unchecked -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M17 owner check dropped -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M18 writability check dropped -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M19 realpath check dropped -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M20 shape check: symlink allowed -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M21 shape check: directory allowed -> `tests/agents/table.test.ts` RED (rc=1)
- MUTATION: M22 probe ignores exit code -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M23 probe output unbounded -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M24 probe never times out -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M25 probe omits own args -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M26 no version drift check -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M27 inherited property as installation -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M28 selection not validated -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M29 defaults not filled (model) -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M30 hash over whole table -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M31 readback kind mismatch allowed -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M32 unselected falls to missing -> `tests/agents/materialize.test.ts` RED (rc=1)
- MUTATION: M33 message is the bare code -> `tests/agents/registry.test.ts` RED (rc=1)
- MUTATION: M34 message is the detail only -> `tests/agents/registry.test.ts` RED (rc=1)

### T2 (16)

- MUTATION: D1 removed realpath-dedup guard -> `detect.test.ts` red (duplicate candidates appear)
- MUTATION: D2 scanned PATH before search-dirs -> red (`source`/`isPathDefault` ordering wrong)
- MUTATION: D3 stopped recording the PATH default -> red (`isPathDefault` never true)
- MUTATION: D4 dropped the `isAbsolute` guard -> red (relative PATH entries get searched)
- MUTATION: D5 dropped the world-writable check -> red (open dir's candidate reappears)
- MUTATION: D6 dropped the `X_OK` check -> red (non-executable file listed as a candidate)
- MUTATION: D7 draft no longer prefers the PATH default -> red (draft picks by list order, not by PATH)
- MUTATION: D8 draft falls back to `listed[0]` instead of the first runnable -> red (non-runnable candidate drafted)
- MUTATION: D9 dropped `draftInstallationExtras` spread -> red (codex draft missing `sandbox`/`budgetMode`)
- MUTATION: D10 `validate` ignores drift (`observed === ...` -> `true`) -> `command.test.ts` red (drifted install reported `ok:true`)
- MUTATION: D11 `validate` always exits 0 -> red (drift case still expects rc 1)
- MUTATION: D12 `detect` ignores `--home` -> red (candidate rooted at the flag's home missing)
- MUTATION: D13 accepts any unknown detect flag -> red (`agents-command-invalid` cases stop refusing)
- MUTATION: D14 CLI stops routing `agents` -> red (`main(["agents", ...])` no longer returns the command's code)
- MUTATION: D15 stderr drops the AgentError detail -> red (exact stderr string assertion fails)
- MUTATION: D16 inserted a stray `writeFile(...".detect-marker"...)` into the `detect` branch's success path -> `command.test.ts > agents detect/validate write nothing under a redirected HOME or the XDG roots` red (`expected ['.detect-marker'] to deeply equal []`); proves the P23 m7 zero-writes criterion is not vacuous.

### T3 (19)

- MUTATION: M3 删 `await context.onProcessRegistered?.(registration);`（`claudeAgentAdapter.ts`）-> RED `claudeAgentAdapter.test.ts`：「registers the runner's process group…」+「writes nothing to the runner until…」两条且仅两条（`$S/mut-M3.log`）
- MUTATION: M4 把 `if (!done && …) await writeRequest();` 挪到 `onProcessRegistered` 调用之前（`claudeAgentAdapter.ts`）-> RED 仅「writes nothing to the runner until…」（`$S/mut-M4.log`）
- MUTATION: M5 `kill()` 里 `process.kill(-child.pid, signal)` 改 `process.kill(child.pid, signal)`（`claudeAgentAdapter.ts`）-> RED 仅「kills the runner's grandchild within killGraceMs…」（`$S/mut-M5.log`）
- MUTATION: M1m（改跑 `src/agents/claude.ts` 的 `claudeModelArgument`，P19）三元表达式改为恒返回 `selection.model` -> RED 恰两条，分属两文件：`registry.test.ts`「spells 1M for the claude CLI…」+ `claudeAgentAdapter.test.ts`「selects the 1M context window…」（`$S/mut-M1m.log`）
- MUTATION: Mctx（本席按 P19 重构后的等价变异）删构造函数里 `assertContextOption(claudeDescriptor.contextOptions, config.selection);` -> RED 仅「refuses at construction a context window…」（`$S/mut-Mctx.log`）
- MUTATION: MconfigDir 删 `if (installation.configDir !== null) env.CLAUDE_CONFIG_DIR = installation.configDir;` -> RED 仅「sets CLAUDE_CONFIG_DIR only when…」（`$S/mut-MconfigDir.log`）
- MUTATION: R1 `execFile` 首参 `claudeCommand[0]` 改回 `"claude"` 并删 `...claudeCommand.slice(1),`（`claude-phase-runner.mjs`）-> RED 仅「runs the named argv tuple…」（`$S/mut-R1.log`）
- MUTATION: R2 删 `...extraArgs,`（同上）-> RED 仅「runs the named argv tuple…」（`$S/mut-R2.log`）
- MUTATION: R3 删 `readArgvEnv` 里的 `if (!Array.isArray(value) || …) { throw … }` 整块（同上）-> RED 恰 4 条：`[]`、`[""]`、`"--model x"`、`["--model", 1]`（`claude --flag` 仍被 JSON.parse 那支拦下，照绿，与 brief 预期一致）（`$S/mut-R3.log`）
- MUTATION: R4 `readArgvEnv("CCLOOP_CLAUDE_EXTRA_ARGS", [], false)` 默认值改 `["--model", "x"]`（同上）-> RED 仅「runs `claude` from PATH with its original arguments…」（RED 阶段就绿的那条，`$S/mut-R4.log`）
- MUTATION: F1 删 `appendFileSync(marker+".argv",…)`（`fake-codex.mjs`）-> RED 仅「appends one JSON array line per call…」（`$S/mut-F1.log`）
- MUTATION: F2 删 `if(process.argv.at(-1)==="--version"…)` 整行（同上）-> RED 仅「answers --version and writes nothing」（`$S/mut-F2.log`）
- MUTATION: FC1 删 `appendFileSync(\`${marker}.argv\`, …)`（`fake-claude-cli.mjs`）-> RED 仅「appends one JSON argv line per call…」（`$S/mut-FC1.log`）
- MUTATION: FC2 `if (args.length === 1 && args[0] === "--version")` 改 `if (false)`（同上）-> RED 仅「answers --version and writes nothing」（`$S/mut-FC2.log`）
- MUTATION: E1（改跑 T1 的 `extraEnv.test.ts`，P3）`env:{...process.env,...extraEnv}` 改回 `env:process.env`（`runCodexPhase.ts`）-> RED 两条全红（该文件仅有 2 条 it，均依赖 extraEnv 生效）（`$S/mut-E1.log`）
- MUTATION: E2 `, this.extraEnv);` 改 `);`（`codexAdapter.ts`）-> RED 仅「sets CODEX_HOME from the installation's configDir through the descriptor's adapter」（`$S/mut-E2.log`）
- MUTATION: E3 `env:{...process.env,...extraEnv}` 改 `env:{...process.env,...extraEnv,CODEX_HOME:"/wrong"}`（`runCodexPhase.ts`）-> RED 两条全红（`$S/mut-E3.log`）
- MUTATION: Mbudget（本席新增，§0.2 P23 m6）`const timeout = Math.min(installation.timeoutMs, context.state.budgetSnapshot.timeRemainingMs);` 改 `const timeout = installation.timeoutMs;`（`claudeAgentAdapter.ts`）-> RED 仅「caps the timeout by the remaining runtime budget…」（`$S/mut-Mbudget.log`）
**结果**：`- MUTATION: P2-restore-throw createAdapter 改回 throw new AgentError("agent-adapter-unavailable", "claude") -> RED tests/agents/registry.test.ts > agent descriptors > builds a ClaudeAgentAdapter from the claude descriptor（且仅这一条，$S/mut-P2-restore-throw.log）`

### T4 (9)

- `MUTATION: P1 every settled phase counts` — `runLoop.ts` 把 `completedWithResult` 恒设 `true` -> RED（`01.log`）
- `MUTATION: P2 usage-only settlement counts` — 去掉 `!usageOnly` 判定 -> RED（`02.log`）
- `MUTATION: P3 error path not marked usage-only` — `:1838` 附近错误路径不再传 `true` -> RED（`03.log`）
- `MUTATION: P4 no zero-registration gate` — 删掉 `stopProof.ts` 里新加的闸判断整行 -> RED（`04.log`）
- `MUTATION: P5 unreadable count ignored` — 闸把 `completed === null` 短路掉，只看 `completed > 0` -> RED（`05.log`）
- `MUTATION: P6 worker does not count` — `worker.ts` 删掉 `recordCompletedPhase` 调用 -> RED（`06.log`）
- `MUTATION: P7 absent count is unknown` — ENOENT 也当不可读（返回 `null`）而非 `0` -> RED（`07.log`）
- `MUTATION: P8 bad count restarts at 0` — 删掉 `current === null` 时抛错，让坏计数被当 `null`→count 从 -1 静默重置 -> RED（`08.log`）
- `MUTATION: P9 any completed phase blocks proof` — 闸忽略 `second.length === 0`，只要 `completed > 0` 就永久拒证明（连正常有注册的情况也拒）-> RED（`09.log`）

### T5 (21)

- MUTATION: M1 protocol.ts 放行 `version === 1` -> control protocol v1 > names unsupported protocol versions separately from invalid requests
- MUTATION: M2 protocol.ts capabilities 的 `agent` 改 `.optional()` -> control protocol v1 > names unsupported protocol versions separately from invalid requests
- MUTATION: M3 protocol.ts claim 的 `agent` 改 `.optional()` -> control protocol v1 > requires a full agent selection on the claim and at most a partial one on capabilities
- MUTATION: M4 command.ts 删 `argv[1] !== "--agents"` 条件 -> control over the installation table (agent selection) > refuses the retired --adapter forms for every control method
- MUTATION: M5 command.ts 退出码不再认 `AgentError` -> control command boundary > rejects a relative agents table before dispatch；control over the installation table (agent selection) > names a missing installation, a drifted CLI version, and an unsafe table with exit 2 and the code first
- MUTATION: M6 command.ts 删 `agent === null` 的表级视图分支 -> control command boundary > routes the real CLI through control before legacy parsing and emits one JSON value
- MUTATION: M7 command.ts 带选择的 capabilities 改答表级视图 -> control over the installation table (agent selection) > answers capabilities for a selection with descriptor defaults filled, given fields echoed, and the materialized config's hash
- MUTATION: M8 command.ts `assertAgentsTablePath` 换成 `readAgentsTable`（所有方法读表） -> control over the installation table (agent selection) > reads the table only for capabilities and accept: a table broken after accept blocks neither inspect nor collect
- MUTATION: M9 accept.ts 删 configHash 核对的 if 块 -> durable control acceptance > rejects a claim config hash mismatch before creating a worker；accept under the installation table (agent selection) > refuses a claim whose selection changed after its configHash was taken, before any worker
- MUTATION: M10 accept.ts 封存 `claim.agent` 而非物化配置 -> durable control acceptance > seals the materialized agent config so later table drift has no effect；accept under the installation table (agent selection) > seals the materialized agent config whose canonical hash the claim carries
- MUTATION: M11 accept.ts 给 `resolveAgent` 注入回显表内版本的假探针（删掉真探测） -> accept under the installation table (agent selection) > refuses a CLI whose --version drifted from the table, before anything is persisted
- MUTATION: M12 worker.ts `getDescriptor(config.kind)` → `getDescriptor("codex")`（改后 build） -> control through the built CLI with a claude installation (agent selection) > carries the claimed selection to the claude CLI's argv and still proves the run stopped
- MUTATION: M13 worker.ts 删 `parseMaterializedAgentConfig`（直接 cast） -> worker adapter from the sealed config (agent selection) > refuses a sealed config whose schema or kind does not hold, before any phase
- MUTATION: M15 verify-control-protocol.mjs `every` → `some`（`ORCA_CCLOOP_BIN=/nonexistent`、mixed.json） -> 「RC≠0 且输出含拒收句」判据红：变异下跑了 build、以 `ENOENT … '/nonexistent'` 退出，无拒收句（`$S/mut-M15.log`；对照 `$S/mut-M15-base.log` 有拒收句）
- MUTATION: M16 worker.ts 删传给 `runLoop` 的整段 `onProcessRegistered`（改后 build） -> claude process registration through the control worker (agent selection) > registers the claude phase's process group in processes.json, and that record proves nothing while the group lives；连带 claudeEndToEnd 那条（collection timeout：计数闸下拿不到 stopProof）
- MUTATION: MI1 claude-phase-runner.mjs `env: claudeEnv()` → `env: process.env` -> claude phase runner command and extra arguments (Orca agent selection) > does not hand CCLOOP_CLAUDE_COMMAND or CCLOOP_CLAUDE_EXTRA_ARGS on to the claude it runs
- MUTATION: MI2 handoff.ts 只扫 `["codex"]` -> mechanical handoff packet > retains the claude adapter's per-call evidence in the raw logs, as it retains codex's
- MUTATION: F1 table.ts 删 `assertAgentsTablePath` 里 lstat 的 ENOENT 返回 -> checking only the table path's shape > accepts a path with nothing at it, but still refuses a dangling symlink；control over the installation table (agent selection) > keeps inspect and collect working after the table is deleted, while capabilities still refuses it
- MUTATION: F2 table.ts 让后面的 realpath 段也放行 ENOENT（悬空软链会被放行） -> checking only the table path's shape > accepts a path with nothing at it, but still refuses a dangling symlink
- MUTATION: F3 worker.ts 不再把非 JSON 映射成 `agent-config-invalid` -> worker adapter from the sealed config (agent selection) > refuses a sealed config whose schema or kind does not hold, or that is not JSON, before any phase
- MUTATION: F4 verify-control-protocol.mjs 守卫改回 `command.some(/fake-…\.mjs$/)` -> 记录的检查红：诱饵表不再打拒收句（0 处），跑了 build 后以 `ENOENT … lstat '/nonexistent'` 退出（`$S/mutfix1-F4.log`；还原后 diff／cached 均 0 字节）

### T6 (8)

- MUTATION: T6M1 (deleted `if (resolution.configHash !== file.data.configHash) { throw … }` in `runWithAgents`) -> red: only `refuses a selection file whose configHash differs, before anything runs` (11/12)
- MUTATION: T6M2 (deleted `if (values.has("--adapter") || values.has("--adapter-config")) { throw … }` in `parseArgs`) -> red: both `--adapter`/`--adapter-config` mutual-exclusivity rows (10/12)
- MUTATION: T6M3 (`resolveAgent(table, file.data.selection)` changed to pass a `probeVersion` stub that echoes the table's own declared version) -> red: only `refuses an installation whose --version no longer matches the table, before anything runs` (11/12)
- MUTATION: T6M4 (deleted `if (command !== "run") { throw … }` in `parseArgs`) -> red: both `refuses ["resume",…]` **and** `refuses ["sweep",…]` (10/12) — see Adaptations below; the brief predicted only the resume row because it did not yet have a sweep row in the test.
- MUTATION: T6M5 (deleted `if (!file.success) throw …`; `file.data.selection`/`file.data.configHash` reads changed to `(raw as any).selection`/`(raw as any).configHash`) -> red: only `refuses a malformed selection file by name` (11/12) — the malformed selection (extra field) now clears validation and reaches `resolveAgent` successfully, so the refusal happens one step later, on the (also-wrong) `configHash`, and the assertion on the code name is what goes red.
- MUTATION: T6M6 (`if (!agentsRunDir || !agentsContractPath || !agentsTablePath || !agentSelectionPath)` narrowed to `if (!agentsRunDir || !agentsContractPath)`) -> red: both `missing required flags` refusal rows that were already green at RED time (10/12)
- MUTATION: T6M7 (deleted `if (config.kind === "codex") console.error(...)` in `runWithAgents`) -> red: only `runs a codex installation the same way, with codex's soft-budget notice` (11/12)
  `- MUTATION: T6M8 (deleted the try/catch wrapper around JSON.parse in runWithAgents, letting SyntaxError propagate uncaught) -> red: only refuses a selection file that isn't valid JSON (12/13)`.

### T7 (40)

- MUTATION: M7-1 ccloopPort resolveAgent 删回显核对 -> refuses a resolution that does not echo a field the request gave (spec M5)
- MUTATION: M7-2 listAgents 请求 `{agent:null}` 改 `{}` -> lists the installations by asking capabilities with agent null（＋ protocol-2、TEMPORARY 两条；P15 替身拒 `{}`）
- MUTATION: M7-3 named() 不再按原名重抛 -> rethrows ccloop's named refusals of a selection or table under their own names, and any other exit as a peer exit
- MUTATION: M7-4 temporaryProbeSelection 返回 `{}` -> TEMPORARY (plan T11 deletes it): a probe given no selection asks about the table's first installation…
- MUTATION: M7-5 router.probe 忽略 selection -> probes exactly the selection it is asked about (agent selection spec §6.4)
- MUTATION: M7-6 ownership 删 agent 比对 -> refuses an envelope whose claim names a selection other than the run's frozen one, before anything is sent
- MUTATION: M7-7 startClaim 闸门问 `resolveAgent({})` -> asks the capability gate about the claim's own frozen selection, at start and at a re-send
- MUTATION: M7-8 startEnvelope run 行 schema 删 agent -> copies the claim from the run row…；drops the run row's own extra columns…；refuses a run row with no frozen selection…
- MUTATION: M7-9 settleIfPastGrace 删按 killGraceMs 判断 -> does not call a request outcome-unknown before the killGraceMs ccloop answers for the run's selection has passed
- MUTATION: M7-10 handoffGraceMsOf 去掉非负安全整数检查 -> is the agent's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable
- MUTATION: M7-11 选择文件去 `mode: 0o600` -> spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600…
- MUTATION: M7-12 driverLanding 改回 `--adapter` 形态 -> RC1: a separate run resolves the conflict…；spawns the reconciliation as ccloop run --agents…
- MUTATION: M7-13 controlOptions 把 ORCA_CCLOOP_ADAPTER_CONFIG 也算 -> needs both variables, not either one
- MUTATION: M7-14 webDispatch run 构造不拷 agent -> RC1…；spawns the reconciliation as ccloop run --agents…
- MUTATION: M7-15 unconfiguredPort resolveAgent 抛普通 Error -> refuses every method it has…；refuses a second time exactly as it refused the first…；refuses by the port's own name and writes no run…
- MUTATION: M7-16 runTask 删「--agents 且 exit 1 ⇒ AgentsRunRefused」 -> blocks a reconciliation ccloop run --agents refuses (exit 1) under the code its stderr starts with, and does not spawn it again
- MUTATION: M7-17 agentsRunRefusalCode 恒返回 null -> 同上
- MUTATION: M7-18 stepR 不认 AgentsRunRefused（恒 reconcile-spawn） -> 同上
- MUTATION: M7-19 errors.ts 删 `agent-version-drift: 422` -> records the agent selection refusal agent-version-drift durably at 422
- MUTATION: M7-20 删 `agents-table-invalid: 422` -> records the agent selection refusal agents-table-invalid durably at 422
- MUTATION: M7-21 删 `agent-installation-missing: 422` -> records the agent selection refusal agent-installation-missing durably at 422
- MUTATION: M7-22 删 `agent-context-unsupported: 422` -> records the agent selection refusal agent-context-unsupported durably at 422
- MUTATION: F1-1 删 `src/control/service.ts` `||observed.handoffControl!=="durable"` -> profiled service execution > rejects stale, missing, and unavailable profiles before claim state or provider invocation；> freshly rejects stale, missing, and unavailable profiles at start without invoking a provider；> freshly validates the persisted profile before reconciling an unknown start（三条都红；修前 HEAD 下此变异 12/12 绿）
- MUTATION: F1-2 claimLegacy 问 `{}` -> legacy dispatch asks about, and freezes, the selection it dispatches (agent selection spec §6.4) > claims a work item after asking about exactly its frozen selection, and the claim and run carry it
- MUTATION: F1-3 budget.ts claimWork 拷 agent 时改 model -> 同上（＋ reconciles a conflicted task …）
- MUTATION: F1-4 workAgents 只返回第一条 -> … > probes each distinct task selection once at the group gates (run and the controlled round's preflight)
- MUTATION: F1-5 service.run 的循环问 `{}` -> 同上
- MUTATION: F1-6 schedulerBridge preflight 的 legacy 分支问 `{}` -> 同上
- MUTATION: F1-7 parentAgent 返回 `{}` -> … > reconciles a conflicted task after asking about its selection, and the reconciliation's work item and run carry it
- MUTATION: F1-8 reconcile 预备 work item 的 agent 改 model -> 同上
- MUTATION: F1-9 requestHandoff legacy 分支问 `{}` -> … > requests a handoff after asking about the handed-off run's selection, not the handoff item's
- MUTATION: F1-10 continueTask legacy 分支问 `{}` -> … > continues a task after asking about its predecessor's selection, and the continuation run carries it
- MUTATION: F1-11 continuation.ts 拷 agent 时改 model -> 同上
- MUTATION: F1-12 reconcileStartForRun 传 `{}` -> profiled service execution > re-probes the run's own frozen selection before reconciling an unknown start
- MUTATION: F1-13 stopIntent `probe(profile, run.agent)` → `probe(profile)` -> model-assisted handoff attempts > probes the handed-off run's own frozen selection before a model-assisted attempt
- MUTATION: F1-14 去掉消息里的 stderr 首行 -> reconciling a conflict (spec §5.3) > blocks an exit 1 whose stderr names no code as a spawn failure carrying the stderr head, not as a refusal
- MUTATION: F1-15 stepR 不再区分无码（恒 reconcile-refused） -> 同上
- MUTATION: F2-1 `service.ts` requestHandoff 的 `profiledCapabilities(groupId,binding,run.agent)` → `{}` -> profiled service execution > probes the handoff profile with the handed-off run's frozen selection on the profiled handoff path
- MUTATION: F2-2 continueTask 的 `profiledCapabilities(groupId,binding,predecessor.agent)` → `{}` -> profiled service execution > probes both profiles with the predecessor's frozen selection on the profiled continuation path
- MUTATION: F2-3 continueTask 的 `profiledCapabilities(groupId,handoffBinding,predecessor.agent)` → `{}` -> 同上

### T8 (7)

| T8-M1（spec §9 判据 7 点名） | `resolveSelection` 内层循环条件 `if (effective[index] === agent && candidate !== undefined)` → `if (candidate !== undefined)` | 「switching agent drops the model another agent was given…」、「(b) the context window follows…」 | rc=1，两条按名单红（收到 `claude-opus-5-5` / `contextWindow:1000000` 而非期望值），日志 `t8-mut-1.log` |
| T8-M2 | 内层循环改为从低到高（`for (let index = 0; index < layers.length; index += 1)`） | 「(d) a group-level value always beats…」 | rc=1，该条红（`model` 收到 `operator-estimator` 而非 `group-estimator`），日志 `t8-mut-2.log` |
| T8-M3 | 删 `if (value === undefined && own?.[field] !== undefined) {…}` 整行 | 「switching agent drops…」、「(d)…」第三组断言 | rc=1，两条按名单红（`model` 字段缺失），日志 `t8-mut-3.log` |
| T8-M4 | 删 `if (running === undefined) throw new ControlError("agent-unselected");` | 「(e) no layer naming an agent…」 | rc=1，该条红（期望抛错，实际不抛），日志 `t8-mut-4.log` |
| T8-M5 | `descriptorProvenance` 里删 `if (requested !== resolved[field]) throw …` | 「refuses an answer that did not echo…」 | rc=1，该条红（期望抛错，实际不抛），日志 `t8-mut-5.log` |
| T8-M6 | `selectionsHash` 里 `bound[key] = slot`（把 provenance、limits 也算进去） | 「covers only partial, selection and configHash…」 | rc=1，该条红（哈希随 `provenance`／`timeoutMs`／`killGraceMs` 变化），日志 `t8-mut-6.log` |
| T8-M7 | `own` 改成 `perAgent[agent]`（去掉 `Object.hasOwn`） | 「reads per-agent defaults only as own keys…」 | rc=1，该条红（原型上的 `inherited.model = "leaked"` 漏进 `partial`），日志 `t8-mut-7.log` |

### T9 (7)

- MUTATION: T9-M1 deleted the `operatorId !== null` branch in `settingRevision` (commandLedger.ts) -> red: "sets under the operator's own revision..." and "advances by the preference revision..." (3 failing, `control-command-result-invalid`) — `scratchpad/impl/mut-t9-m1.log`, rc=1.
- MUTATION: T9-M2 removed `|| target.operatorId !== context.rawCommand.actorId` in `applySetAgentPreferences` -> red: "lets an actor set only its own preferences..." (1 failing, the cross-operator write now succeeds) — `scratchpad/impl/mut-t9-m2.log`, rc=1.
- MUTATION: T9-M3 deleted the `else if (fromVersion === "4")` branch in `migrateSchema` -> red: "migrates a version 4 store by adding the preferences table" (`control-schema-unsupported`) — `scratchpad/impl/mut-t9-m3.log`, rc=1.
- MUTATION: T9-M4 removed `&& version !== "4"` from `store.ts:86` -> red: same migration test (`control-schema-unsupported` from the acceptable-version gate this time) — `scratchpad/impl/mut-t9-m4.log`, rc=1.
- MUTATION: T9-M5 removed `.strict()` from `setAgentPreferencesPayloadSchema` -> red: "carries the revision only on the envelope..." (payload with a stray `expectedRevision` now parses) — `scratchpad/impl/mut-t9-m5.log`, rc=1.
- MUTATION: T9-M6 deleted the `no-op-command` guard line in `applySetAgentPreferences` -> red: "replays a repeated command id and refuses setting the document it already holds" (re-setting the same document now succeeds and bumps the revision) — `scratchpad/impl/mut-t9-m6.log`, rc=1.
- MUTATION: T9-M7 removed `|| value.verb === "set-agent-preferences"` from `projectionless` in `commandSuccessSchema`'s superRefine -> red: "sets under the operator's own revision..." and downstream tests (3 failing, result now judged `control-command-result-invalid` since `projectionSeq: null` no longer matches the schema's expectation for this verb) — `scratchpad/impl/mut-t9-m7.log`, rc=1.

### T10 (22)

- MUTATION: T10-M1 删事务内「操作者层 partial 变了 ⇒ plan-version-conflict」 -> refuses an import whose operator layers changed after the estimator slot was resolved
- MUTATION: T10-M2 估算 run 的 `configHash` 改回 `estimate.profile.profileHash` -> gives the estimate run the frozen estimator configHash and selection, never the profile hash (spec §12 C5)；shows an estimate run only while it carries its estimate's frozen selection
- MUTATION: T10-M3（R7 版）`prepareEstimatorSlot` 在 probe 前经 `trustedConfig.resolveTarget` 读源 -> planImport.test.ts > immutable plan import > rechecks revision after a successful in-flight probe before source I/O（受保护判据）
- MUTATION: T10-M4 `rejectedEstimatorRequest` 理由改为常量 `estimate-blocked-capability` -> still imports when no operator layer names an agent …；degrades the estimate with ccloop's own refusal code
- MUTATION: T10-M5 `proposalSetAgent` 不调 `reopenProposal`（只存盘、版本不推进） -> replaces a group or task layer, advances the proposal version …；clears a layer with null …；re-estimates with the group's estimator layer …
- MUTATION: T10-M6 组层 `null` 改为写 `{}` 而非删除 -> clears a layer with null, and refuses a stale base, an unknown task and a no-op
- MUTATION: T10-M7 `createEstimate` 的组层改传 `{}` -> re-estimates with the group's estimator layer as it is now, set from the panel (spec §6.4, R7)
- MUTATION: T10-M8 删 `controlViews` 的 `run-estimate-agent` 核对 -> shows an estimate run only while it carries its estimate's frozen selection (spec §12 C5)
- MUTATION: T10-M9 `estimatorSlotFor` 不再把 `descriptorProvenance` 的拒绝折成 outcome -> refuses to freeze an answer that does not echo what was asked (spec §4.6 M5)
- MUTATION: T10-M10a plan 文件 schema 加 `estimatorAgent` -> refuses a plan that names an estimator selection, in the file and in the normalized plan (R7)
- MUTATION: T10-M10b `controlPlanSchema` 加 `estimatorAgent` -> 同上
- MUTATION: T10-M11 删 `readEstimateRecord` 对「选择被拒」估算的接受 -> still imports when no operator layer names an agent …；reads a selection-refused estimate only when it froze neither a slot nor a request；re-estimates with the group's estimator layer …
- MUTATION: T10-M11b 该接受去掉 `estimatorSlot === null` 条件 -> reads a selection-refused estimate only when it froze neither a slot nor a request
- MUTATION: T10-M11c 该接受去掉 `request === null` 条件 -> 同上
- MUTATION: T10-M12 `claimEstimate` 的 probe 改回无选择 -> gives the estimate run the frozen estimator configHash and selection …
- MUTATION: T10-M13 组 `agentOverrides` 写 `{}` 而非 plan 层 -> resolves operator default < per-agent < operator estimator …；clears a layer with null …
- MUTATION: T10-M14 work item `agentOverride` 写 `null` 而非 plan 任务层 -> 同上两条
- MUTATION: T10-M15 router 的 `resolution` 恒为 null -> 8 条（冻结、echo、run、read、reestimate、opaque 各条）
- MUTATION: T10-M16 删任务层 no-op 检查 -> clears a layer with null, and refuses a stale base, an unknown task and a no-op
- MUTATION: T10-M17 估算记录不写 `estimatorSlot`（写 null） -> resolves operator default …；gives the estimate run …；reads a selection-refused estimate …；shows an estimate run …
- MUTATION: T10-M18 `normalizeControlPlan` 丢 plan 顶层 `agent` -> refuses a plan that names an estimator selection …（归档 plan 带层）；resolves operator default …
- MUTATION: T10-M19 删 `claimEstimate` 的 `estimator-slot-missing` 守卫 -> never claims an estimate that froze no estimator selection (spec §12 C5)

### T11 (31)

- MUTATION: T11-M1 confirm 删 `payload.selectionsHash !== resolution.selectionsHash ||` -> refuses a confirmation whose previewed selectionsHash no longer matches (preferences changed after the preview)
- MUTATION: T11-M2 confirm 删「层与事务外解析时相同」复核 -> re-checks the layers inside the transaction: a change while ccloop answers is refused even with a fresh hash
- MUTATION: T11-M3 `frozenTaskSelections` 换成读操作者当前默认 agent -> probes and claims with the frozen selection even after the operator switches default agent；blocks the whole group's start when any one task's frozen selection probes degraded (W5-M12)
- MUTATION: T11-M4 `createStartingRun` 删 `agent: frozen.agent,` -> probes and claims with the frozen selection …；shows a run only while it carries its work item's frozen selection byte for byte (spec §3 I1)
- MUTATION: T11-M5 `readConfirmedTaskExecution` 删 work item 与快照冻结字段的比较 -> treats the snapshot as authority: a frozen field edited after confirmation is refused by execution and the read model
- MUTATION: T11-M6 `workViews` 删 `work-item-agent` 核对 -> 同上
- MUTATION: T11-M7 profile schema 字面量改为 `z.enum([v1, v2])` -> refuses a v1 snapshot and any adapter identity field
- MUTATION: T11-M8 `handoffGraceMsOf` 忽略 `killGraceMs` -> judges a handoff's grace by the run's frozen killGraceMs plus the fixed extra；assemblyHandoffGrace > is the agent's killGraceMs plus the fixed extra …；driverHandoff > nothing arrives … > turns the request outcome-unknown past deadline + grace …；driverHandoff > the grace is the run's own agent killGraceMs … > does not call a request outcome-unknown before …
- MUTATION: T11-M9 `resolveGroupSelections` 去掉按 partial 去重 -> resolves every task's worker slot and the group's reconcile slot, sorted by key, asking ccloop once per distinct partial
- MUTATION: T11-M10 confirm 删「有被拒槽 ⇒ agent-selection-rejected」 -> rejects the whole confirmation when any slot fails, naming the task and ccloop's code, and freezes nothing
- MUTATION: T11-M11 router `probe` 的 observed 换成声明值（不用应答、不求交） -> intersects the declared capabilities with the answer for the probed selection, per selection；blocks the whole group's start … (W5-M12)
- MUTATION: T11-M12 `planTaskSchema` 恢复 `configHash` 可选键 -> refuses a plan task that still carries configHash
- MUTATION: T11-M13 `reopenProposal` 不清 work item 冻结字段 -> drops every frozen selection when a confirmed proposal is reopened
- MUTATION: T11-M14 闸门只探测第一个冻结选择 -> blocks the whole group's start when any one task's frozen selection probes degraded (W5-M12)
- MUTATION: T11-M15 `validateExecutionSnapshot` 删 `reconcileSlot` 核对 -> treats the snapshot as authority for the group's reconcile slot too
- MUTATION: T11-M16 `readConfirmedReconcileSlot` 删与组记录的比较 -> 同上
- MUTATION: T11-M17（P11）`BudgetEditor` 删 `|| !props.selectionsHash` -> web/tests/confirmSelection.test.tsx > … > does not send a confirmation when no selectionsHash was previewed
- MUTATION: T11-M18 confirm 的 `agentCapabilities` 不与 worker 声明求交 -> freezes each task's capabilities as the worker profile's declaration intersected with ccloop's answer for that task
- MUTATION: T11-M19 `groupSelectionPartials` 固定读 `"human"` 的偏好 -> reads the layers of the operator it is asked for (W6-16)
- MUTATION: T11-M20 `runViews` 删 run／work 冻结字段逐字节比较 -> shows a run only while it carries its work item's frozen selection byte for byte (spec §3 I1)
- MUTATION: T11-M21 `operatorDefaultSelection` 恒返回 `{}` -> asks the panel operator's worker default, and {} when no operator has chosen an agent
- MUTATION: T11-M22 `prepareExecutionSnapshot` 删任务集核对 -> executionSnapshot.test.ts > refuses frozen selections whose task set is not the plan's
- MUTATION: T11-M23 快照 schema 删 `agent-task-set-mismatch` -> webProtocol.test.ts > validates a complete, canonically ordered execution snapshot
- MUTATION: T11-M24 confirm 删 `Object.assign(work, frozen)` -> 5 条（freezes ccloop's answer onto every work item …；freezes each task's capabilities …；probes and claims …；shows a run only while …；blocks the whole group's start …）
- MUTATION: T11-M25 confirm 不写组 `reconcileSlot` -> freezes ccloop's answer onto every work item …；treats the snapshot as authority: a frozen field edited …；shows a run only while …
- MUTATION: T11-M26 导入写 `configHash` 非 null -> shows a draft work item with no configHash and no selection；另 3 条确认判据（读模型／冻结前置）
- MUTATION: T11-M27 stopIntent 探测改 `{}` -> stopIntent.test.ts > model-assisted handoff attempts > probes the handed-off run's own frozen selection before a model-assisted attempt
- MUTATION: T11-F1 `createStartingRun` 的 `agent` 换成操作者当前默认 agent -> sends ccloop the frozen selection in the claim even after the operator switches default agent
- MUTATION: T11-F2 删 `resolveGroupSelections` 的 transient 重抛（原复审所指 :338） -> does not record a transient port failure as a refused slot: nothing is durable and a retry confirms
- MUTATION: T11-F3 删 `control-port-unconfigured` 重抛 -> refuses a confirmation on an unconfigured port by the port's own name
- MUTATION: T11-F4 confirm 复核两侧都只比 partial（对称去掉 provenance） -> re-checks where each field came from, not only the partial, inside the transaction

### T12 (3)

| M12-1 | `driverLanding.ts`：选择文件改回 `{ selection: run.agent, configHash: run.configHash }` | `tests/control/driverReconcile.test.ts` | `env -u ORCA_CCLOOP_BIN vitest run … > mut-M12-1.log` | `… spawns the reconciliation as ccloop run --agents <table> --agent-selection <file>, the file 0600 and holding the group's frozen reconcile selection with its configHash (agent selection spec §4.9, §6.1)` | 红（rc=1，该判据点名 FAIL；见 `.../t12/mut-M12-1.log`） |
| M12-2 | `driverLanding.ts`：删掉 `reconcileSlot === null` 的 block 行 | `tests/control/driverReconcile.test.ts` | 同上 → `mut-M12-2.log` | `… blocks a conflict whose group has no frozen reconcile selection, before any reconciliation run (agent selection spec §6.1)` | 红（rc=1，该判据点名 FAIL；见 `.../t12/mut-M12-2.log`） |
| M12-3 | `src/scheduler/ccloopRunner.ts` 旧分支：`agentArgs = ["--adapter", options.adapter, "--adapter-config", options.adapterConfig]` 改成 `agentArgs = ["--agents", options.adapterConfig]` | `tests/scheduler/scenarios/S1.test.ts`（真 ccloop build，`ORCA_CCLOOP_BIN=.../ccloop-t12/dist/cli.js`） | `mut-S1-baseline.log`（未变异，rc=0）→ `mut-M12-3.log`（变异后，rc=1） | `S1: two tasks with disjoint write sets share a layer, both land, and the round exits 0` | 红（`expected 2 to be +0`，即 legacy `orca run` 不再 exit 0；见 `.../t12/mut-M12-3.log`） |

### T13 (14)

- MUTATION: M13-1 `ensureDirectory` drop `chmod(path, AGENTS_DIR_MODE)` -> red: "gives the modes explicitly,
- MUTATION: M13-2 `writeTemp` drop `handle.chmod(AGENTS_FILE_MODE)` -> red: same criterion (mode 0400 instead
- MUTATION: M13-3 `removeStaleTemps` drop the naming-pattern filter -> red: 3 criteria ("never overwrites an
- MUTATION: M13-4 `removeStaleTemps` drop the `isFile()` guard -> red: "removes a temporary file... nothing
- MUTATION: M13-5 `link(temp, table)` -> `rename(temp, table)`, `unlink(temp)` left in place -> red: 6 criteria
- MUTATION: M13-6 existence check `if (!(await exists(table)))` -> `if (true)` alone (link untouched) -> GREEN,
- MUTATION: M13-7 `init` skips the `removeStaleTemps` call -> red: "removes a temporary file an earlier init
- MUTATION: M13-8 `settings` drops the relative-path refusal -> red: "refuses a relative table path...".
- MUTATION: M13-9 `show` ignores `validate`'s exit code (`failed = false`) -> red: "exits 1 and names the
- MUTATION: M13-10 `paths.ts` ignores `ORCA_AGENTS_TABLE` (ran only after the three P1 criteria/guards were in
- MUTATION: M13-56 both M13-6's existence-check removal and M13-5's link->rename together -> red: 9 criteria
- MUTATION: stray-write-under-xdg — inserted `await writeFile(join(w.xdgCache, "stray-cache-file"), "oops")`
- MUTATION: M13-P1a — replaced `const home = env.HOME;` with `const home = "/some/other/dir";` (the
- MUTATION: M13-P1b — deleted the refusal check (`paths.ts:19-21`, the `if (home === undefined || ...) throw

### T14 (26)

- MUTATION: T14-M1 GET agents 答 `installations: []` -> agentSelectionApi > serves the installation table view from the port, sorted by id, and only with the panel token
- MUTATION: T14-M2 删 GET agents 的 `.sort(...)` -> 同上（schema 排序检查抛）
- MUTATION: T14-M3 set-agent-preferences 台账键 `@operator:` → `@repository:` -> reads the operator's preferences at revision 0, … refuses a stale revision by name（及其余 5 条经 setPreferences 的判据）
- MUTATION: T14-M4 预览伪造 `selectionsHash: "0"*64` -> previews every task's worker slot … a confirm carrying that selectionsHash is accepted；freezes onto the work item …；refuses a confirm whose selectionsHash …
- MUTATION: T14-M5 删 schema 的 `rejected !== (selectionsHash === null)` 行 -> the preview schema refuses a selectionsHash beside a rejected slot, and a slot key that does not name its task
- MUTATION: T14-M6 删 schema 的 slot-key-mismatch 行 -> 同上
- MUTATION: T14-M7 删 `proposal/agent` 路由项 -> a proposal-set-agent on one task moves proposalVersion, …
- MUTATION: T14-M8 web `AgentSelectionPreviewV1.selectionsHash` 改 `string` -> 根 tsc rc=2 TS2322（webParity 编译期半边）
- MUTATION: T14-M8b web `SetAgentPreferencesPayloadV1` 加回 `expectedRevision` -> 根 tsc rc=2 TS2741（P5 形状被编译期钉住）
- MUTATION: T14-M9 `server.ts` 删 `, port: control.port` -> controlMount > answers the agents view from the assembled port, which with no port configured refuses by name（仅此 1 条红）。首跑因副本缺 `web/dist` 整文件红（`panel-dist-missing`，非变异所致），补 dist 后基线 14/14 绿，重跑只红这一条。
- MUTATION: T14-M10 GET preferences 恒答 revision 0／空 -> reads the operator's preferences at revision 0 …；refuses a confirm whose selectionsHash …
- MUTATION: T14-M11 删 switch 的 `set-agent-preferences` 分支 -> 6 条经偏好命令的判据
- MUTATION: T14-M12 预览用 `"human"` 而非面板操作者 -> 5 条（预览、冻结、拒绝、proposal-set-agent、changed）
- MUTATION: T14-M13（T11 遗留项的对照）confirm 把 reconcile 槽的答复冻进任务 -> freezes onto the work item and the reconcile slot exactly what the preview fetched before the confirm showed（仅此 1 条红）
- MUTATION: T14-M14 confirm 把任务槽冻进 reconcile -> 同上（仅此 1 条红）
- MUTATION: F1-M1 删 `slot-task-mismatch` 行 -> the preview schema refuses a worker slot with no task, and slots that are not sorted and unique by key
- MUTATION: F1-M2 删 `requireSortedUnique(value.slots…)` -> 同上
- MUTATION: F1-M3 preview 模式也抛出（`if (mode === "confirm") throw` → `throw`）-> previews a slot whose installation fails transiently as unavailable …
- MUTATION: F1-M3b confirm 模式也记 `unavailable`（删掉那行 throw）-> 同上（confirm 断言：得到 409，不是 500）
- MUTATION: F1-M4 `readSelectionPreview` 传 `"confirm"` -> 同上
- MUTATION: F1-M5 `stepR` 改回读组记录的 `reconcileSlot` -> driverReconcile > blocks a conflict whose group record's reconcile selection no longer matches the confirmed snapshot …（按 `-t` 只跑这一条）
- MUTATION: F1-M6 `proposalSetAgent` 改回 `groupAgentOverridesSchema.parse` -> refuses a proposal-set-agent and a re-estimate over a damaged group overrides document …
- MUTATION: F1-M7 `createEstimate` 改回 `.parse` -> 同上（红在 estimate 那一条断言：`expected 'control-non-json-payload' to be 'recovery-blocked'`；第一跑因锚点命中 2 次没执行，加长锚点后重跑）
- MUTATION: F1-M8 组视图 `agents.reconcile` 恒为 null -> shows no reconcile selection on a draft group's view, and after the confirm exactly the one its preview showed
- MUTATION: F1-M9 web `SlotOutcomeV1` 删 `unavailable` 这一支 -> 根目录 tsc rc=2，TS2322（preview 平价）
- MUTATION: F1-M10 web `GroupViewV1.agents` 的 reconcile 改成不可为 null -> 根目录 tsc rc=2，TS2322（组视图平价）

### T15 (49)

- MUTATION: T15-M1 context 的 `<select>` 换成 `<input>` -> agentSettings > offers each agent's context as a dropdown …（另外 editor > offers each layer's context … 也红）
- MUTATION: T15-M2 选项取 `agents.installations[0]` -> 同上两条
- MUTATION: T15-M3 `contextWindow = parsed`（不再丢弃 agent 不支持的档位）-> agentSettings > leaves a field unset when its box is emptied, and drops a context …
- MUTATION: T15-M4 `textOrUndefined` 改成恒返回原文 -> agentSettings 第 3、4、5 条；editor > sends proposal-set-agent …
- MUTATION: T15-M5 onSave 的 revision 改成 0 -> agentSettings > sends the preferences the drafts describe, under the revision …（另外第 5 条也红）
- MUTATION: T15-M6 删掉失败格的 `role="alert"` 与红色 -> editor > shows a slot ccloop refused in red …；> shows a slot ccloop could not answer for now in red …
- MUTATION: T15-M6b 失败格文案恒为 "rejected" -> editor > … could not answer for now …, worded as unavailable …；App > re-reads a preview in which a slot was unavailable for now …
- MUTATION: T15-M7 删掉 payload 里的 `selectionsHash: shownSelectionsHash,` -> editor > confirms with the selectionsHash of the resolution on screen；confirmSelection > sends the previewed selectionsHash with the confirmation
- MUTATION: T15-M7b 去掉 Confirm 的 `disabled` -> editor > does not confirm on a resolution made for another proposal version …；> refused in red …；> unavailable …
- MUTATION: T15-M7c 删掉 `submitConfirm` 里 guard 的 `|| shownSelectionsHash === null` -> vitest 仍绿（按钮已 disabled），**web tsc rc=2**，TS2322 出在 `BudgetEditor.tsx(150)`（`string | null` 不能赋给 payload）。结论：这个 guard 由类型层钉住。
- MUTATION: T15-M8 `selectionsHashFor` 去掉 proposalVersion 比较 -> editor > does not confirm on a resolution made for another proposal version …
- MUTATION: T15-M9 task 的 Clear 发 `{}` -> editor > clears a task's own layer with a null partial …
- MUTATION: T15-M10 让确认后的分支永远进不去 -> editor > shows a confirmed group's frozen selection …
- MUTATION: T15-M10b 确认后的 reconcile 恒为 null -> 同上
- MUTATION: T15-M11 路径改成 `/proposal/edit` -> editor > routes proposal-set-agent to the group's proposal/agent path
- MUTATION: T15-M12 删掉 model 的 `<small>from …</small>` -> editor > shows each task's resolved agent … ；> shows a confirmed group's frozen selection …
- MUTATION: T15-M13 previewKey 去掉偏好 revision -> App > saves the defaults as { preferences } …, re-reads the open group's preview …。brief 预言这一条「不红」；这里把 App 判据加强到能判别它，所以它现在有独占判据。
- MUTATION: T15-M14 `inheritedAgentFor` 的 task 分支不看组 worker -> editor > offers each layer's context over the agent that layer inherits …
- MUTATION: T15-M15 estimator 分支改读组 worker（即 brief 原来的错误）-> 同上
- MUTATION: T15-M16 reconcile 分支不看组 worker -> 同上
- MUTATION: T15-M17 reconcile 分支不看 operator-reconcile -> 同上
- MUTATION: T15-M18 `draftOf` 改成恒等（清空时发 ""）-> agentSettings > clears a saved model and the default agent through the panel's own draft store
- MUTATION: T15-M19 `draftText` 不再把哨兵映射成 "" -> 同上
- MUTATION: T15-M20 删掉 `agent-selection-changed` 触发的重读 -> App > re-reads the preview once after a confirm refused with agent-selection-changed …
- MUTATION: T15-M21 删掉预览失败后的重读 -> App > re-reads the preview after a read that did not conclude …
- MUTATION: T15-M22 删掉 `unavailable` 槽触发的重读 -> App > re-reads a preview in which a slot was unavailable for now …
- MUTATION: T15-M23 previewKey 去掉 nonce -> App 的 I-3 三条
- MUTATION: T15-M24 `rereadPreview` 不丢弃旧预览 -> App > re-reads the preview once after … agent-selection-changed …（新预览到达之前按钮必须是 disabled）
- MUTATION: T15-M25 偏好 payload 带回 `expectedRevision` -> App > saves the defaults as { preferences } …
- MUTATION: T15-M26 保存后不回读偏好 -> 同上
- MUTATION: T15-M27 ControlPanel 传 `preview={null}` -> App 的 4 条
- MUTATION: T15-M28 ControlPanel 传 `agentPreferences={null}` -> App > saves the defaults …（组 worker 的 context 下拉就没有 1000000 了）
- MUTATION: T15-M29 ControlPanel 不渲染 AgentSettings -> 同上
- MUTATION: F1T15-M1 恢复 `unavailable` 槽的自动轮询 -> does not re-read a preview in which a slot was unavailable for now until the operator asks …
- MUTATION: F1T15-M2 Re-read 按钮点了什么也不做 -> (a)、(b)、(b′)、(c) 四条
- MUTATION: F1T15-M3 App 不向下传 `onRereadPreview`（按钮不出现）-> 同上四条
- MUTATION: F1T15-M4 删掉成功分支的序号守卫 -> keeps the newer preview when the answer to an older read arrives after it
- MUTATION: F1T15-M5 删掉失败分支的序号守卫 -> ignores a failure that answers an older read after a newer read concluded
- MUTATION: F1T15-M6 删掉重试上限（`if (previewRetried.current) return;`）-> retries a preview read that did not conclude exactly once …
- MUTATION: F1T15-M7 失败后完全不自动重试 -> re-reads the preview after a read that did not conclude …；retries … exactly once …
- MUTATION: F1T15-M8 成功后不复位重试标记 -> retries … exactly once …（第 4 次失败没有被重试）
- MUTATION: W4T15-M1 `rereadPreview` 不再重读安装表 -> retries a failed installation table read once, then re-reads it and the preview when the operator presses Re-read
- MUTATION: W4T15-M2 删掉安装表读取的自动重试 -> 同上
- MUTATION: W4T15-M3 自动重试不设上限（重试时仍传 `retryOnce=true`）-> 同上
- MUTATION: W4T15-M4 删掉编辑器的失败分支（回到「Resolving…」）-> 上面那条，以及 says why on an unconfigured port …
- MUTATION: W4T15-M5 挂载 effect 改回只在 configured 时读 -> says why on an unconfigured port …
- MUTATION: W4T15-M6 删掉 `|| refusal.code === "agent-selection-rejected"` -> drops the preview a confirm was refused on as agent-selection-rejected …
- MUTATION: W4T15-M7 端口未配置时也自动重试 -> says why on an unconfigured port …（`/agents` 读了 2 次）
- MUTATION: W4T15-M8 ControlPanel 不向下传 `agentsFailure` -> 前两条

### T16 (9)

- MUTATION: T16-M1 `controlAssembly.ts` 的 `input.wrapPort ? input.wrapPort(chosen) : chosen` → `chosen`（sha c264f8cc…→550068ff…） -> F1 红：`expected 0 to be greater than 0`（gates.length），rc=1。与预言一致。
- MUTATION: T16-M2（M2a）`webDispatch.ts` `frozenTaskSelections` 改为按**当前**操作者偏好（`readAgentPreferences(store,"human")`＋`resolveSelection(slotLayers("worker",…))`）重解析（490afb82…→bc6635e6…） -> F1 红：start 被拒 `control-capability-unsupported`（`-poisoned` 被 ccloop 拒 ⇒ 闸门 degraded），rc=1。与预言一致（落在 scheduleStart／唤醒投递这一处，二者共用该函数）。
- MUTATION: T16-M2b（额外）`dispatch.ts` `startClaim` 的闸门改为当前偏好（05abe99e…→70e694a6…） -> **F1 绿**，rc=0。实测结论：`startClaim` 是 legacy／profiled service 路径，驱动环（web driver）不走它，故 F1 不覆盖它——这是判据的边界，不是空绿；该路径由 T7／T11 各自判据负责。记实测，不改判据迁就。
- MUTATION: T16-M3 `driverLanding.ts` 解冲突选择文件 `{selection: reconcileSlot.selection, configHash: reconcileSlot.configHash}` → 该 run 自己的 `agent`／`configHash`（e9f5adc2…→2515906c…） -> M1 红：codex tally `{gpt-6-sol:5}`（缺 `gpt-6-reconcile`），rc=1。与预言一致。
- MUTATION: T16-M4（按 brief 原位）`continuation.ts` claim 的 `agent:work.agent` → 当前偏好重解析（83eea571…→92d3744f…） -> **CH、CC 绿**，rc=0。实测结论：`continuation.ts` 的 claim 也是 legacy service 路径；驱动环的续跑 run 行在 `webDispatch.ts` 的 run 构造（`agent: frozen.agent`）里造。改跑 M4w。
- MUTATION: T16-M4w `webDispatch.ts` run 构造在 `continuation` 存在时 `agent` 改为当前偏好重解析（490afb82…→d9acba1c…） -> CH 红、CC 红：`blocked: a=accept-refused:2:control-config-hash-mismatch`，rc=1。**前提是本 Task 第二笔提交**：brief 原版 CH／CC 在确认后从不改偏好，重解析得到同一个 CLAUDE ⇒ 这条变异必绿（brief 预言的红不可能出现）；故在 CH（停后、resume 前）与 CC（停后、空 resume 前）各加一次 `setPreferences(POISONED)`（同 agent 另一 model）。
- MUTATION: T16-M5（ccloop）`src/agents/claude.ts` `claudeModelArgument` 去掉 `[1m]`（3d6b49cf…→b778b8b3…，副本内重 build RC=0，`ORCA_CCLOOP_BIN` 临时指向副本） -> M1 红：claude tally `{claude-opus-5-5:5}`，rc=1。与预言一致。
- MUTATION: T16-M6（ccloop）`tests/fixtures/fake-claude-cli.mjs` 删追加 `.argv` 那一行（bc5c73e1…→6c6b83c3…，副本先干净重 build） -> M1、F1、CH、CC、C3 **全红**（各自 argv 断言收到空），rc=1。证明各条 argv 断言读的是真 argv。
- MUTATION: T16-M7 `ccloopWorld.ts` plan 任务行删 `...(task.agent === undefined ? {} : { agent: task.agent })`（10630eb2…→90ac52c9…） -> M1 红：`frozen["task:b"].selection` 为 claude 而非 codex（从存储读回的冻结值），rc=1。与预言一致。

### wave2-fix (6)

- MUTATION: W2F-C1 删除 `materialize.ts` 的 `if (observed === null) { throw … }` 分支（回落到 drift）-> 红 4 条：`resolving a selection against the table > fails an installation whose version it cannot observe without naming a refusal`、`control over the installation table (agent selection) > answers an unobservable CLI version with exit 1, not a named refusal`、`accept over an unobservable CLI version (Orca wave-2 review I-3) > fails without a code and without persisting anything`、`ccloop run --agents --agent-selection … > fails an unobservable --version with a non-code message, before anything runs`（`impl/ccloop-w2mut`，`$O/ccloop-mut-W2F1.txt`，4 failed | 37 passed）。
- MUTATION: W2F-M1 把 ENOENT 放行改回 `throw invalid()`（恢复构造期存在性检查）-> 红 `production ccloop execution port > builds on an absolute agents table path with nothing at it, and still refuses a path of the wrong shape` 与 `the ccloop port over a deleted agents table (real ccloop) > still inspects and collects an accepted run, and capabilities is refused as agents-table-invalid`（`$O/orca-mut-W2F-M1.txt`，2 failed）。
- MUTATION: W2F-M2 删 `if(!isAbsolute(path))throw invalid();` -> 红 `builds on an absolute agents table path …`（`ccloopPort.test.ts:138`，相对路径不再被拒；`$O/orca-mut-W2F-M2.txt`）。
- MUTATION: W2F-M3 删 `||realpathSync(path)!==path` -> 红 `builds on an absolute agents table path …`（`:143`，经软链目录到达的文件不再被拒；`$O/orca-mut-W2F-M3.txt`）。
- MUTATION: W2F-M4 删 `&& line !== CODEX_BUDGET_NOTICE` -> 红 `reconciling a conflict (spec §5.3) > blocks a non-refusal exit 1 printed after codex's budget notice under the failure's own line, not the notice`；同跑的 `stderr names no code` 仍绿（`$O/orca-mut-W2F-M4.txt`）。
- MUTATION: W2F-M5 从集合删 `"agent-unselected"` -> 红 `production ccloop execution port > rethrows ccloop's agent-unselected refusal under its own name`（`$O/orca-mut-W2F-M5.txt`）。

Total records copied: 322

## T17 mutation battery on the final tree (controller session `ab5a693c`, 2026-09-26)

Two seats re-ran every record above on the final trees (ccloop main at the commit whose subject is `docs(handoff): roll the Orca section: T1-T6 of agent selection landed here`; Orca main at the commit whose subject is `docs(sdd): record the agent selection gates and judge`), one `git clone --local` per repo, sha256 before/after for every mutation, restore diffs 0 bytes. Per-mutation tables with full 64-hex sha256, red sets and log paths: `battery-ccloop-report.md`, `battery-orca-report.md` (same directory).

- ccloop: 109 mutations, all red as predicted; 0 target gone; 0 without an exclusive criterion. T6M3 now reddens two criteria (the wave-2 fix added one over the same `resolveAgent` call).
- Orca: 213 listed + 1 extra. 207 red as predicted; 1 red on a different set (T11-M4); 3 green, all predicted green (M13-6 equivalent mutation; T16-M2b and T16-M4 on legacy paths the production code never reaches, per the wave 5 review); 2 target gone (M7-4, T15-M22 — both deliberately removed by later tasks); 0 predicted-red-but-green. 17 anchors were stale and re-anchored to the equivalent branch on the final tree (listed in the Orca report).
- Branches with no exclusive criterion now: `dispatch.ts` `startClaim` gate and `continuation.ts` claim under live-preference change (legacy, unreachable in production; registered in spec §13.3); M13-6 (equivalent).
