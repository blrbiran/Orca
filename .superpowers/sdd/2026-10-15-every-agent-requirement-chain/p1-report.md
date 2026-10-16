# P1 report — one real codex single call through ccloop's codex single-call adapter

Who: Claude Opus 5.5 subagent of Orca session a852f96a, 2026-10-16 (human authorized P1 + re-runs in that session).
ccloop under test: `git clone --local` of worktree `ccloop-wt/every-agent-chain` at **efcd5b3** into `$P/ccloop`
(`P=/private/tmp/p1-pJnD`), `node_modules` symlinked from `ccloop/node_modules`, `npm run build` RC=0 (`$P/build.log`).
Orca HEAD at observation: 1322d099. The worktree was not touched. No repo edits, no commits.

**Paid calls made: 1** (one `codex exec` of `gpt-6-luna`, pid 28559, 2026-10-16T02:33:49Z). No second call — the
failure is deterministic and was diagnosed offline at zero cost (below).

**Result: FAIL** — codex did exactly one single call and answered `{"answer":"Paris"}`, but ccloop refused it as
`codex-single-call-not-single:tool` because codex emitted three `item.completed` rows of type `error` (configuration
warnings), which the decoder classifies as a tool item.

## Environment

- `which codex` → `/Users/biran/.cmuxterm/cmux-cli-shims/C1E064A2-4FEC-4404-A7A2-76C38B93D579/codex` (bash shim that
  execs `/Applications/cmux.app/Contents/Resources/bin/cmux-codex-wrapper`); `codex --version` → `codex-cli 0.160.0`.
- **Ruling (this run):** the agents table uses the real binary behind the shim,
  `/Users/biran/.nvm/versions/node/v22.13.1/bin/codex` (→ `@openai/codex/bin/codex.js`, `--version` = `codex-cli 0.160.0`),
  not the shim — the cmux wrapper may attach its own computer-use MCP server, which would contaminate the "tools off"
  check. Costs if wrong: P1 does not cover a cmux-shim installation.
- node v22.13.1. Env for every ccloop command: `CCLOOP_CACHE_DIR=$P/cache`, `TMPDIR=$P/tmp`, HOME = the person's HOME.
- Agents table `$P/agents/agents.json` (dir 0700, file 0600): one installation `codex`, command `[<real codex>]`,
  `version "0.160.0"` (first try with `"codex-cli 0.160.0"` → `agent-version-drift`, RC=2, unpaid), `configDir: null`,
  `timeoutMs 300000`, `killGraceMs 2000`, `sandbox read-only`, `budgetMode soft`.
- `control capabilities` (unpaid; probes `--version`/models/features into `$P/cache`) for `{agent:codex, model:gpt-6-luna}`
  RC=0: `singleCallExecution "v1-soft"`, `singleCallOutputCap null`, `contextWindowTokens 1000000`, configHash
  `e00ca413…397f` (`$P/caps.out`). Note: window 1000000 (presumably `model_context_window` in the linked config.toml wins,
  spec §6.1; not verified by reading values).

## Commands and RCs

1. Envelope `$P/envelope.json` built by `$P/envelope.mjs` = the tests' `singleCallEnvelope` shape with
   `SINGLE_CALL_SCHEMA` (`{answer: string}`, required, no extras), `maxOutputTokens 4096`, sourceDir `$P/src`, prompt
   (20 words): "Reply with a JSON object whose answer field is the capital city of France, written as one word, nothing else."
2. `node $P/ccloop/dist/cli.js control accept --agents $P/agents/agents.json < $P/envelope.json` → RC=0,
   `{"kind":"accepted","executionId":"execution-480d4e24-…"}` (default worker `dist/src/control/worker.js`).
3. `control inspect` polled every 2 s → after 7 polls `{"kind":"stopped","proof":{…,"isolated":true}}`.
4. `control collect` with `{input: envelope, afterSeq: 0}` → RC=0 (`$P/collect.out`): events `work` cumulative
   `{tokens 11605, activeMs 13229, attempts 1, sessions 1}`, `handoff` 0; candidate `result "failed"`,
   `terminalOutcome "single-call-failed"`, `artifacts []`.
5. Handoff record (evidence-5583fa…): `{"errorCode":"codex-single-call-not-single:tool","outcome":"failed","outputRef":null,…}`.

## Confirmations

| item | result | evidence |
|---|---|---|
| exactly one `turn.completed` | **PASS** (1) | `$P/src/run/codex/1/single-call/call-2owQxz/events.jsonl` |
| no item other than agent_message/reasoning | **FAIL** — 3 × `item.completed:error`, 1 × `agent_message`; no tool/command/mcp item | row counts: `{"thread.started":1,"item.completed:error":3,"turn.started":1,"item.completed:agent_message":1,"turn.completed":1}` |
| codex accepted every `-c` key (no "Unknown feature flag") | **PASS** — exit code 0; `grep -c "Unknown feature flag"` = 0 in events.jsonl and stderr.log (`$P/unknown-flag.txt`) | `outcome.json` args: 5 ISO keys + `features.plugins=false` + apps, image_generation, multi_agent, shell_tool, skip_host_skill_discovery=true, unified_exec, view_image |
| decoded object | codex final = `{"answer":"Paris"}`; **ccloop decoded nothing** (refused) | `final.json`; offline re-decode below |
| ccloop booked usage | 11605 tokens (= 11590 + 15), not 0 | collect events |

The three `error` items (verbatim messages, no credentials in them):
- ×2: "Codex is ignoring 1 unrecognized configuration setting … user (`…/codex-home/config.toml`): `features.rmcp_client` is ignored."
  — comes from the person's linked `~/.codex/config.toml`.
- ×1: "Under-development features enabled: skip_host_skill_discovery. … To suppress this warning, set
  `suppress_unstable_features_warning = true` …" — caused by the adapter's own `-c features.skip_host_skill_discovery=true`.

## Token numbers (tool-reported, `turn.completed.usage`)

`input_tokens 11590`, `cached_input_tokens 0`, `cache_write_input_tokens 0`, `output_tokens 15`,
`reasoning_output_tokens 0`. ccloop total 11605.

Framing overhead: **not derivable** — no provider tokenizer count of the prompt is available from any tool here; not
estimated (Rule 14). Observation only: 11590 is far above spec §2.5's ~1.5k residue for the rendered input items; §2.5
notes `prompt-input` does not show tool definitions or MCP tools, so the difference is not attributed here.

Cost: **not reported** (no tool reported a monetary cost).

Wall time: ccloop `activeMs` 13229 (tool-reported). Outer wall from before `accept` to the terminal `inspect` =
15028 ms (`Date.now()` stamps in `$P/time.txt`; 2 s poll granularity).

## Diagnosis (zero cost)

`src/runtime/codex/codexSingleCall.ts` `decodeCodexSingleCall`, line 124 of the file at efcd5b3:
`if (row.type.startsWith("item.") && record(row.item) && row.item.type !== "agent_message" && row.item.type !== "reasoning") tool = true;`
— an `error` item counts as a tool (already listed in progress.md, Task 8 minor deferred: "`error` item reported as
not-single:tool"). Offline check `$P/decode-check.mjs` against the built decoder (`$P/decode-check.out`, RC=0):
- as recorded → `THROW codex-single-call-not-single:tool observedTokens=11605`
- same events with the 3 `error` rows removed → `OK {"output":{"answer":"Paris"},"tokenUsage":11605,…,"modelUsage":[{"model":"gpt-6-luna","input":11590,"output":15,"cacheRead":0,"cacheWrite":0}]}`

A re-run would reproduce the same items (both warnings are deterministic from config), so no second paid call was made.
Options for the controller/human (not done here — no repo edits): (a) treat `item.completed` of type `error` as a
non-tool diagnostic (logged, not fatal) while keeping every other non-message item fatal; (b) additionally send
`-c suppress_unstable_features_warning=true`; the `features.rmcp_client` warning comes from the person's config and
cannot be removed by a `-c` key, so (a) is needed regardless.

## Second finding — MCP servers from the linked config.toml are started

`~/.codex/config.toml` has 4 `[mcp_servers…` sections (counted with `grep -c '^\[mcp_servers'`; values not read). The
adapter sends no override for them. The call's stderr.log (370 bytes) is one line:
`ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(… mcp.figma.com …)`,
and the private codex-home gained `mcp-oauth-locks/`. So codex launched the linked MCP servers inside the single call;
their tools were presumably offered to the model (the model used none). Spec §6.1 says: if the linked config.toml
re-introduces injected content (MCP servers), the plan adds the matching `-c` override — this needs that step
(e.g. disabling each listed MCP server, or an MCP-off key if codex 0.160.0 has one; not verified). Possibly also part of
the 11590 input tokens (not attributed).

## Credentials and private home

- `ls -l` + `shasum` of `~/.codex/auth.json` and `~/.codex/config.toml` before (`$P/creds-before.txt`) and after
  (`$P/creds-after.txt`): `diff` RC=0, 0 bytes (`$P/creds-diff.txt`). Unchanged size, mtime and sha1. Contents never printed.
- Private dir `$P/cache/codex-home/6c50abdd…ec74c/` (`$P/codex-home-ls.txt`): hash dir, `home`, `codex-home` all
  `drwx------`; `home` empty; `codex-home/auth.json -> /Users/biran/.codex/auth.json` and
  `config.toml -> /Users/biran/.codex/config.toml` **still symlinks**; no `*.displaced-*` file and no `.<uuid>.link`
  residue (`$P/displaced.txt` empty). codex wrote its own state there (models_cache.json 399519 B, state_5.sqlite-wal
  ~1.99 MB, goals/queue/logs/memories sqlite, installation_id, skills/, tmp/, shell_snapshots/, mcp-oauth-locks/, mode 0644/0755 —
  codex's own modes). Did codex write through the auth link? The target's sha1 and mtime are unchanged ⇒ no.
- Run cwd `$P/src/run/cwd` is empty (0700).
- pgrep after (`$P/pgrep-after.txt`): no process mentions `$P`; the listed codex/fake-codex processes belong to other
  sessions (`/private/tmp/ccg-cEhq`, `/private/tmp/cl-Rwsa`, VS Code, cmux) — not touched.

## Left for the human

`$P = /private/tmp/p1-pJnD` (not deleted): `ccloop/` clone (node_modules is a symlink — remove the link first),
`agents/`, `cache/` (catalog entry + private codex-home with the two credential symlinks), `src/` (run evidence),
`tmp/`, logs (`build.log`, `caps.*`, `accept.*`, `inspect.*`, `collect.*`, `creds-*.txt`, `codex-home-ls.txt`,
`decode-check.*`, `unknown-flag.txt`, `pgrep-after.txt`, `time.txt`), scripts (`envelope.mjs`, `decode-check.mjs`).
