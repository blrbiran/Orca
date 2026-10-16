# P1c report — re-run of P1 (one real codex single call through ccloop) after 34a14a3

Who: Claude Opus 5.5 subagent of Orca session a852f96a, 2026-10-16 (human authorized P1 + re-runs in that session).
ccloop under test: `git clone --local` of worktree `ccloop-wt/every-agent-chain` at **34a14a3**
(`34a14a38461729632c80c4bd03c1d3f13259fdcf`, verified with `/usr/bin/git log -1` on the worktree and on the clone,
`$P/tip.txt`) into `$P/ccloop`, `P=/private/tmp/p1c-Ne9o`; `node_modules` symlinked from `ccloop/node_modules`;
`npm run build` RC=0 (`$P/build.log`). Orca HEAD at observation: 1322d099. Worktree not touched; no repo edits, no
commits (this file is the only write in the Orca repo). Scripts `envelope.mjs` / `decode-check.mjs` copied from
`/private/tmp/p1-pJnD`; agents table copied from `/private/tmp/p1b-X11F` (real codex
`/Users/biran/.nvm/versions/node/v22.13.1/bin/codex`, codex-cli 0.160.0, `configDir null`, `version "0.160.0"`,
sandbox read-only, budgetMode soft, timeoutMs 300000). Env: `CCLOOP_CACHE_DIR=$P/cache` (fresh, cold), `TMPDIR=$P/tmp`.

**Paid calls made: 1** (`codex exec` of `gpt-6-luna`, accept at 2026-10-16T03:18:54.647Z). No second call.

**Result: PASS** — ccloop returned the decoded object `{"answer":"Paris"}`, `terminalOutcome "single-call-complete"`.

## Commands and RCs

1. `control capabilities --agents $P/agents/agents.json` → RC=0 (`$P/caps.out`): `singleCallExecution "v1-soft"`,
   `contextWindowTokens 1000000`, configHash `e00ca413…397f` (same as P1/P1b). Catalog `$P/cache/811b06f8….json`:
   `codexMcpServers` = `computer-use, figma, node_repl` (3; `$P/mcp-names.txt`) — the probe now runs under the isolated
   codex-home (it created `cache/codex-home/6c50abdd…/` with the two credential symlinks, `$P/codex-home-after-caps.txt`).
2. `node envelope.mjs $P/src <configHash> $P/envelope.json` → RC=0 (same envelope as P1).
3. `control accept` → RC=0, `execution-c9210ab1-…`; `control inspect` every 2 s → poll 4 `stopped`, `isolated:true`
   (`$P/inspect.log`).
4. `control collect {input, afterSeq:0}` → RC=0 (`$P/collect.out`): work cumulative `{tokens 10826, activeMs 5491,
   attempts 1, sessions 1}`, byModel `{gpt-6-luna, input 10811, output 15, cacheRead 0, cacheWrite 0}`; handoff 0;
   candidate `result "complete"`, `terminalOutcome "single-call-complete"`, one artifact.
   Artifact `evidence-6a4c…` = `{"answer":"Paris"}`. Handoff record: `outcome "complete"`, `errorCode null`, outputRef = that artifact.
5. Call dir `$P/src/run/codex/1/single-call/call-3oR4ko/`: `outcome.json` reason `completed`, code 0; `stderr.log` 0 B;
   `final.json` `{"answer":"Paris"}`.

## Confirmations

| item | result | evidence |
|---|---|---|
| ccloop returns the decoded object | **PASS** `{"answer":"Paris"}` | collect.out, evidence-6a4c…bin |
| exactly one `turn.completed` | **PASS** (1) | `$P/row-counts.txt`: `{"thread.started":1,"item.completed:error":3,"turn.started":1,"item.completed:agent_message":1,"turn.completed":1}` |
| items only agent_message/reasoning/error | **PASS** — 1 agent_message, 3 error, no other item type | events.jsonl |
| every `-c` key accepted | **PASS** — exit 0; `Unknown feature flag` 0, `invalid transport` 0 in events and stderr | `$P/grep-checks.txt` |
| argv `mcp_servers.<name>.enabled=false` names == isolated config's servers | **PASS** — argv: computer-use, figma, node_repl; `~/.codex/config.toml` top-level `[mcp_servers.<name>]` headers (header lines only): figma, node_repl, computer-use | outcome.json args, `$P/config-mcp-headers.txt` |
| no MCP server started | **PASS** — stderr.log 0 B (P1 had the figma `AuthRequired` rmcp line); `figma`/`AuthRequired`/`rmcp::`/`MCP` 0 hits in events and stderr | `$P/grep-checks.txt` |
| private auth.json/config.toml still symlinks; no `*.displaced-*` | **PASS** | `$P/codex-home-after-call.txt`, `$P/displaced.txt` 0 B |

Error item messages (verbatim gist, no credentials):
- ×2: "Codex is ignoring 1 unrecognized configuration setting … user (`…/codex-home/config.toml`): `features.rmcp_client` is ignored." (from the person's config.toml)
- ×1: "Under-development features enabled: skip_host_skill_discovery … set `suppress_unstable_features_warning = true` …" (from the adapter's own `-c`)

Note on `mcp-oauth-locks/`: the private codex-home has `mcp-oauth-locks/file-store.lock` with mtime 11:18:20 local,
i.e. created by the capabilities probe's `codex mcp list` (caps.out written 11:18:25), before the call (11:18:54)
(`$P/lock-stat.txt`). It is a lock file, not evidence of a server start.

## Tokens (tool-reported, `turn.completed.usage`)

`input_tokens 10811`, `cached_input_tokens 0`, `cache_write_input_tokens 0`, `output_tokens 15`,
`reasoning_output_tokens 0`. ccloop booked `tokenUsage 10826` (= 10811 + 15; `usageEvidence` selected
`input_tokens`/`output_tokens`), cumulative work tokens 10826.

Comparison, tool-reported only: P1 (efcd5b3, before the MCP/plugins overrides) `input_tokens 11590`; P1c (34a14a3)
`input_tokens 10811`. Difference 779. Not attributed to any component and framing not estimated (Rule 14).
(`outcome.json` `observedTokens` is null; the booked number comes from the work evidence.)

## Wall time / cost

ccloop `activeMs`/`elapsedMs` 5491 (tool-reported). Outer wall accept→terminal inspect 7547 ms (`$P/time.txt`,
`Date.now()` stamps, 2 s poll granularity). Cost: not reported (no tool reported a monetary cost).

## Credentials and ~/.codex

- `ls -l` + `shasum` of `~/.codex/auth.json` and `~/.codex/config.toml` before/after (`$P/creds-before.txt`,
  `$P/creds-after.txt`): `diff` RC=0, 0 bytes (`$P/creds-diff.txt`). Contents never printed.
- `ls -la ~/.codex/mcp-oauth-locks` before/after: `diff` RC=0, 0 bytes (`$P/locks-diff.txt`; one lock file dated Jul 26).
- Private dirs `drwx------`; `home/` empty; run cwd `$P/src/run/cwd` empty (0700). codex wrote its own state in the
  private codex-home (models_cache.json, sqlite files, `skills/.system/…`, shell_snapshots/, tmp/) as in P1.
- `pgrep -fl p1c-Ne9o` after: none (RC=1, `$P/pgrep-after.txt` 0 B).

## Left for the human

`$P = /private/tmp/p1c-Ne9o` (not deleted): `ccloop/` clone (node_modules is a symlink — remove the link first),
`agents/`, `cache/` (catalog + private codex-home with the two credential symlinks), `src/` (run evidence), `tmp/`,
logs (`build.log`, `caps.*`, `accept.*`, `inspect.*`, `collect.*`, `creds-*.txt`, `locks-*.txt`, `codex-home-*.txt`,
`mcp-names.txt`, `config-mcp-headers.txt`, `grep-checks.txt`, `row-counts.txt`, `lock-stat.txt`, `displaced.txt`,
`pgrep-after.txt`, `time.txt`, `tip.txt`, `clone.log`, `src-files.txt`), scripts (`envelope.mjs`, `decode-check.mjs`).
