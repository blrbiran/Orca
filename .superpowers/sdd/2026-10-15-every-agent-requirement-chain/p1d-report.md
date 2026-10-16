# P1d report: re-run of P1 on the final ccloop tip 15d3494

Who: Claude subagent of Orca session a852f96a, 2026-10-16 (human authorized P1 and re-runs). Orca HEAD 390b0530 at start.
ccloop: fresh `git clone --local` of worktree ccloop-wt/every-agent-chain into `P=/private/tmp/p1d-U4Zc/ccloop`; tip `15d34942f10dab62c30e0b2135fbfd30475a3bbd` (/usr/bin/git log -1 on worktree and clone, `$P/tip.txt`); node_modules symlink; `npm run build` RC 0.
Agents table copied from P1c (real codex 0.160.0 at /Users/biran/.nvm/versions/node/v22.13.1/bin/codex, configDir null, gpt-6-luna, read-only, soft). CCLOOP_CACHE_DIR=$P/cache (cold), TMPDIR=$P/tmp. No repo edits or commits; this file is the only write in the Orca repo.

**Paid calls: 1** (codex exec gpt-6-luna). One earlier `control accept` attempt exited 1 with control-command-invalid (I omitted `--agents`) before anything started; `src/` was empty, so it made no paid call. No second call.

**Result: PASS.** ccloop returned `{"answer":"Paris"}`, terminalOutcome `single-call-complete`, candidate result `complete`.

## Confirmations
| item | result | evidence |
|---|---|---|
| decoded object returned | PASS | final.json and the candidate artifact; collect RC 0 |
| exactly one turn.completed | PASS | events: thread.started 1, turn.started 1, turn.completed 1, agent_message 1, error 4 |
| items only agent_message/reasoning/error | PASS | 1 agent_message, 4 error, no other type |
| codex accepted every -c key in exec | PASS | exit 0, reason completed; "Unknown feature flag" 0 and "invalid transport" 0 in events and stderr (`grep-checks.txt`) |
| no MCP server started | PASS | stderr.log 0 B; figma, AuthRequired, rmcp::, MCP: 0 hits in events and stderr |
| no notify/hook program ran | PASS (stderr-based) | stderr.log 0 B; no "notify"/"hook" text in events. Stdout/stderr of a notify program, if any, would not necessarily show in either; the evidence is absence only |
| private auth.json/config.toml still symlinks; no *.displaced-* | PASS | both still symlinks to ~/.codex; 0 displaced files under cache and src |

The 29 `-c` values in argv (outcome.json args): include_permissions_instructions=false, include_apps_instructions=false, include_collaboration_mode_instructions=false, include_environment_context=false, project_doc_max_bytes=0, features.plugins=false, notify=[], features.{apps, browser_use, browser_use_external, code_mode_host, computer_use, goals, hooks, image_generation, in_app_browser, multi_agent, realtime_conversation, remote_plugin, shell_tool, skill_search, sleep_tool, tool_suggest, unified_exec, view_image}=false, features.skip_host_skill_discovery=true, mcp_servers.{computer-use, figma, node_repl}.enabled=false.

Error items (4; none credential-bearing):
- x2 "Codex is ignoring 1 unrecognized configuration setting ... `features.rmcp_client` is ignored" (person's config.toml; same as P1c).
- x1 "Under-development features enabled: skip_host_skill_discovery ..." (adapter's own -c; same as P1c).
- x1 NEW: "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` ..." This is a direct consequence of `features.code_mode_host=false` (new in 15d3494). It is a warning item, not a failure; the decoder tolerated it.

## Tokens (tool-reported, turn.completed.usage)
input_tokens 10109, cached_input_tokens 0, cache_write_input_tokens 0, output_tokens 15, reasoning_output_tokens 0.
ccloop booked tokens 10124 (= 10109 + 15), byModel gpt-6-luna input 10109 / output 15 / cacheRead 0 / cacheWrite 0. attempts 1, sessions 1.
Versus P1c input_tokens 10811: 702 fewer (P1 was 11590). Not attributed to a component (Rule 14).

## Wall time / cost
ccloop activeMs 10502 (tool-reported; P1c was 5491). Outer wall accept to terminal inspect 11606 ms (`time.txt`, Date.now stamps, 2 s polling). Cost: not reported by any tool.

## Credentials and ~/.codex
ls -l + shasum of ~/.codex/auth.json and config.toml before/after: identical (cmp RC 0, `cb.txt` vs `ca.txt`; the raw before/after files carry shell-trace lines because xtrace was on; contents never printed). `ls -la ~/.codex/mcp-oauth-locks` before/after: diff RC 0. No process matching p1d-U4Zc left (pgrep RC 1).
The private codex-home has its own empty-or-lock `mcp-oauth-locks/` dir created at probe time (capabilities, before the call), same as P1c; not evidence of a server start.

## Left for the human
`/private/tmp/p1d-U4Zc` not deleted (ccloop clone with node_modules symlink, agents, cache with the private codex-home, src run evidence, tmp, logs, scripts).
