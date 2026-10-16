# P1b report — re-run of P1 (one real codex single call through ccloop) after dcec51e

Who: Claude Opus 5.5 subagent of Orca session a852f96a, 2026-10-16 (human authorized P1 + re-runs in that session).
ccloop under test: `git clone --local` of worktree `ccloop-wt/every-agent-chain` at **dcec51e**
(`dcec51e497b86218f7ec56950e16a65541a08388`, verified with `/usr/bin/git log -1` on the worktree and on the clone,
`$P/tip.txt`) into `$P/ccloop`, `P=/private/tmp/p1b-X11F`; `node_modules` symlinked from `ccloop/node_modules`;
`npm run build` RC=0 (`$P/build.log`). Orca HEAD at observation: 1322d099. Worktree not touched; no repo edits, no commits
(this file is the only write in the Orca repo). Scripts `envelope.mjs` / `decode-check.mjs` copied from `/private/tmp/p1-pJnD`.

**codex invocations through ccloop: 1** (`codex exec` of `gpt-6-luna`, 2026-10-16T02:57:12Z). It exited RC=1 after
245 ms on a config load error, with **0 bytes of events** (no `thread.started`, no `turn.started`, no usage): no model
request was made, as far as any tool shows. Counted as the one authorized paid call. **No second call** — the failure is
deterministic and was reproduced and diagnosed at zero cost (below); a re-run of the same tip would fail identically.

**Result: FAIL** — ccloop refused nothing because codex never ran a turn: `codex-exit-error`
("Error loading config.toml: invalid transport in `mcp_servers.code-review`"), caused by dcec51e's MCP-off overrides.

## Environment

- node v22.13.1; real codex `/Users/biran/.nvm/versions/node/v22.13.1/bin/codex` (codex-cli 0.160.0), same ruling as P1
  (not the cmux shim). Env for ccloop: `CCLOOP_CACHE_DIR=$P/cache`, `TMPDIR=$P/tmp`, HOME = the person's HOME.
- Agents table `$P/agents/agents.json` (0600 in 0700 dir) = copy of P1's: `command [<real codex>]`, `version "0.160.0"`,
  `configDir null`, `timeoutMs 300000`, `killGraceMs 2000`, `sandbox read-only`, `budgetMode soft`.

## Commands and RCs

1. `control capabilities --agents agents/agents.json` → RC=2 `agents-table-invalid: table path is not absolute` (my
   mistake, unpaid); re-run with `$P/agents/agents.json` → RC=0 (`$P/caps.out`): `singleCallExecution "v1-soft"`,
   `contextWindowTokens 1000000`, configHash `e00ca413…397f` (same as P1).
   Catalog entry `$P/cache/811b06f8….json`: `codexMcpServers` = `code-review, codex_app, computer-use, cua_repl, figma,
   node_repl` (6); `codexFeatures` = apps, image_generation, multi_agent, plugins, shell_tool, skip_host_skill_discovery,
   unified_exec, view_image (`$P/mcp-names.txt`).
2. `node envelope.mjs $P/src <configHash> $P/envelope.json` → RC=0 (same envelope as P1: `{answer:string}` schema,
   maxOutputTokens 4096, the "capital of France" prompt).
3. `control accept` → RC=0, `execution-04f64603-…`. `control inspect` polled every 2 s → poll 2 `stopped`, `isolated:true`
   (`$P/inspect.log`).
4. `control collect` `{input, afterSeq:0}` → RC=0 (`$P/collect.out`): work event `cumulative null`; handoff 0; candidate
   `result "failed"`, `terminalOutcome "single-call-failed"`, `artifacts []`.
   Work evidence: `{"elapsedMs":245,"errorCode":"codex-exit-error","tokenUsage":null,"usageEvidence":null}`.
   Handoff record: `{"errorCode":"codex-exit-error","outcome":"failed","outputRef":null,…}`.
5. Call dir `$P/src/run/codex/1/single-call/call-wwe65D/`: `outcome.json` reason `exit-error`, code 1, observedTokens null;
   `stderr.log` (75 B): `Error loading config.toml: invalid transport` / ``in `mcp_servers.code-review` ``;
   `events.jsonl` 0 B; `final.json` empty.

## Confirmations

| item | result | evidence |
|---|---|---|
| decoded object returned (not refused) | **FAIL** — no object; codex exited before any turn | collect.out, handoff record |
| exactly one `turn.completed` | **FAIL** — 0 (events.jsonl empty) | events.jsonl 0 B |
| no item other than agent_message/reasoning/error | vacuous — no items at all; no error items to list | events.jsonl 0 B |
| every `-c` key accepted | **FAIL** — `mcp_servers.code-review.enabled=false` rejected ("invalid transport"); codex stops at the first bad server, so the other two names the isolated home does not define (codex_app, cua_repl) were not reached and were not tested one by one; the 3 defined names are accepted offline (diagnosis, B) | stderr.log, outcome.json |
| argv has `mcp_servers.<name>.enabled=false` per server | **PASS** for the 6 names in the catalog (all 6 present, bare names) — but 3 of the 6 are names the call's config does not define | outcome.json args |
| no MCP server started | **PASS (trivially)** — codex never got past config load; stderr has no MCP auth/start line; private codex-home listing right after the call (`$P/codex-home-after-call.txt`) has only `auth.json`, `config.toml`, `tmp/` — no `mcp-oauth-locks/` | see note below on a later lock file |
| tokens (tool-reported) | none — no `turn.completed.usage`; ccloop booked `tokenUsage null`, cumulative null (not 0) | work evidence |
| wall time | ccloop `elapsedMs` 245 (tool-reported); outer wall accept→terminal inspect 2919 ms (`$P/time.txt`, 2 s poll granularity) | |
| cost | not reported (no tool reported a monetary cost) | |

Note: the private codex-home later gained `mcp-oauth-locks/file-store.lock` (10:57) — created by my own offline
diagnostic `codex mcp list --json` runs (below), not by the ccloop call (the after-call listing preceded them).
`~/.codex/mcp-oauth-locks/` unchanged before/after (one lock file dated Jul 26; `$P/codex-home-before.txt`,
`$P/codex-home-after.txt`).

## Diagnosis (zero cost)

The catalog probe and the call see different codex homes:
- The probe (`readCodexCatalog`, `src/agents/codexCatalog.ts`) runs `codex mcp list --json` with `configDir null` ⇒ no
  `CODEX_HOME` override ⇒ the person's real `~/.codex`, where plugins under `~/.codex/plugins/cache/…` (e.g.
  `openai-bundled/unified-computer-use/…/.mcp.json`) contribute servers. It lists 6.
- The call runs with the isolated `HOME`/`CODEX_HOME` (`$P/cache/codex-home/6c50abdd…/`), which holds only the
  `auth.json`/`config.toml` symlinks (and also sends `features.plugins=false`). There, `codex mcp list --json` lists only
  the 3 servers defined in `config.toml` — `computer-use`, `figma`, `node_repl` (`$P/mcp-private.txt`; config.toml's
  top-level `[mcp_servers.<name>]` headers, read as header lines only: the same 3, `$P/config-mcp-headers.txt`).
- `-c mcp_servers.<unknown>.enabled=false` creates a server table with no transport ⇒ "invalid transport" (the fix's own
  comment already records this for unknown names).

Offline reproduction under the isolated home with `codex mcp list --json` (no model call; `$P/diag-mcp.txt`):
- A: all 6 `-c mcp_servers.<name>.enabled=false` → RC=1, `invalid transport in mcp_servers.code-review`.
- B: only the 3 config.toml names → RC=0, all three listed `enabled:false`.

So the per-server override mechanism works (B), but the name list must come from the same environment the call uses.
Options for the controller/human (not done — no repo edits): run the `mcp list` probe under the isolated
`HOME`/`CODEX_HOME` (and with the call's `-c features.plugins=false`), so it lists exactly what the call would load; and
make the cache key reflect that env. Until then, any installation with plugin-provided MCP servers fails every codex
single call deterministically.

## Credentials and private home

- `ls -l` + `shasum` of `~/.codex/auth.json` and `~/.codex/config.toml` before (`$P/creds-before.txt`) and after
  (`$P/creds-after.txt`): `diff` RC=0, 0 bytes (`$P/creds-diff.txt`). Contents never printed.
- Private `codex-home/auth.json -> /Users/biran/.codex/auth.json` and `config.toml -> /Users/biran/.codex/config.toml`
  still symlinks; no `*.displaced-*` / `.*.link` residue (`$P/displaced.txt` 0 B). Dirs 0700; `home/` empty;
  run cwd `$P/src/run/cwd` empty (0700).
- `pgrep -fl p1b-X11F` after: none (RC=1, `$P/pgrep-after.txt` 0 B).

## Left for the human

`$P = /private/tmp/p1b-X11F` (not deleted): `ccloop/` clone (node_modules is a symlink — remove the link first),
`agents/`, `cache/` (catalog entry + private codex-home with the two credential symlinks), `src/` (run evidence), `tmp/`,
logs (`build.log`, `caps.*`, `accept.*`, `inspect.*`, `collect.*`, `creds-*.txt`, `codex-home-*.txt`, `mcp-*.txt`,
`mcp-private.err`, `config-mcp-headers.txt`, `diag-mcp.txt`, `A.err`, `B.err`, `displaced.txt`, `pgrep-after.txt`,
`time.txt`, `tip.txt`, `clone.log`), scripts (`envelope.mjs`, `decode-check.mjs`).
