# Final whole-branch review: every agent runs the requirement chain

Reviewer: final-review subagent of Orca session a852f96a (Claude Opus 5.5), 2026-10-16 Asia/Shanghai. Read-only (only
this file was written). No tests run, no subagents.
Ranges: ccloop `1e05627..d9cb32c` (worktree `ccloop-wt/every-agent-chain`, HEAD d9cb32c739542c6a), Orca
`1322d099..e2bfdc0e` (worktree `Orca-wt/every-agent-chain`, HEAD e2bfdc0e81d0f68e). Inputs: spec, plan (spec issues,
Global Constraints, P-5, Tasks 15-16), ledger `progress.md`, `p1/p1b/p1c/p2-report.md`, `task-9-gate3-report.md`.
Method: superpowers 6.4.1 `code-reviewer.md`. Passes: (1) ccloop `src` diff whole (1370 lines); (2) Orca `src`, `web/src`,
setup and fixture diff whole (827 lines); (3) the rewritten criteria (E1-E6, the human-named ompSingleCall one, the
blanket-naming ones) and the new spec §1 criteria files; (4) targeted reads of callers (`control/singleCall.ts`,
`ccloopPort.ts` error mapping, `estimator.ts`, `refusalCoverage.test.ts`, `ccloopDefaultE2E.test.ts`, README).
Line numbers below are from the two worktrees at the HEADs above.

## Verdict

**Not ready to merge as it stands; ready after H1 + repin + Task 16 with the Important items below closed or explicitly
ruled by the human.** No Critical finding: the code paths are sound, fail closed, and the rewritten criteria are not
loosened. The Important items are mostly unfinished Task 16 obligations (spec registration, README, gate evidence) and
three human decisions on the codex isolation that the branch leaves open (credential rotation, tools still on, framing).

## Critical

None.

## Important

**I1. The codex private homes are not registered in the spec (Orca Rule 17).**
`ccloop src/agents/codexIsolation.ts:77-95` registers `<cache dir>/codex-home/<sha256>/{home,codex-home}` (credential
symlinks plus codex's own runtime state, written on every codex catalog miss and every codex single call) and the
`mkdtemp(<tmpdir>/ccloop-codex-mcp-*)` fallback, but only in a code comment. The Orca spec has no appended section
for it (the ledger's "Task 8 carry -> Task 16" is still open; the Orca branch diff touches no `docs/`). Rule 17 requires
a named registration in the spec (path, trigger, residue). Failure scenario: the merged repos write credential links
and ~2.4 MB of codex state under `~/.cache/ccloop` with no spec entry; the next reader of §4.2 thinks the cache holds
only catalog JSON. Fix (Task 16): append a named correction section to the spec (original text untouched) with both
writers, the residue, and the other open errata the ledger defers there: version/detection probes that stay live
(Task 4 ruling), the §2.5 table re-rendered with `features.plugins=false` and per-name `mcp_servers.<n>.enabled=false`
(P1/P1b/P1c), and the omp `config.yaml`/`PI_CONFIG_DIR` keys not stamped.

**I2. README says codex cannot clarify, split or estimate, which becomes false on merge.**
`Orca README.md:129-131`, `:381-385`, `:579` ("need a bounded single call, which only `claude` provides; `codex` ... do
not provide it"; troubleshooting "Codex or OMP cannot clarify or estimate"). After this branch a codex installation does
all three in soft estimate mode. The plan's Task 16 wording scan (`codex ... (bounded|capped)`) cannot catch these lines
(the word order differs, and they are stale rather than wrong-worded). Fix: rewrite the three passages: codex runs the
chain in `--estimate-mode soft` only; its single call cannot cap output; any overrun is booked and shown on the run.
Follow the wording rule: never "bounded"/"capped" for codex.

**I3. Refresh-token rotation through the auth.json symlink is unverified.**
`codexIsolation.ts:52-68` replaces a regular file found where a link belongs by moving it aside
(`<name>.displaced-<ms>`), then re-links to the installation's file. Suppose codex 0.160 saves a refreshed token by
temp-file + rename inside the private CODEX_HOME. Then the new refresh token lives only in the private dir. The real
`~/.codex/auth.json` keeps the rotated-out token, which the provider may invalidate, and the person's interactive codex
is logged out. On the next call ccloop displaces the fresh file and re-links to the stale one, so single calls start
failing too. P1c only proves nothing was written during a 5 s call that did not refresh. A related unhandled case:
keyring credential storage (`cli_auth_credentials_store`) keyed by the CODEX_HOME path would find no login in the
private home. That fails closed, but every codex single call is then refused as an auth error. Fix: before merge,
establish (zero-cost: codex source or docs for 0.160's auth save) whether the save writes in place or by rename. If by
rename, a displaced `auth.json` newer than its target must refuse loudly and tell the human, never silently re-link.
Either way, record it as a residual in the spec section of I1.

**I4. "Tools off" covers only spec §2.4's list; the other on-by-default tool flags are still an open question.**
`ccloop src/agents/codexCatalog.ts:10` turns off `apps, image_generation, multi_agent, plugins, shell_tool,
unified_exec, view_image` (plus `skip_host_skill_discovery`). Task 0 (ledger line 25) listed tool-like flags that are
stable and on outside that list: `browser_use*`, `computer_use`, `in_app_browser`, `sleep_tool`, `tool_suggest`,
`skill_search`, `goals`, `hooks`. Web search is not listed as a feature at all. The ledger marked them "for the human,
not acted on" and no later line closes them. The decoder fails closed, so correctness holds (`codexSingleCall.ts`
decoder: any non-agent_message/reasoning/error item ⇒ `not-single:tool`). But a web or browser tool can run during the
call: the requirement text can go to a search, the call's tokens are spent and booked, and the requirement retry does
not key on `not-single`. The linked `config.toml` can also carry `notify`/hooks that run the person's programs on every
call. Fix: the human rules on it. The cheap code path is to add those names to the same features-list filter (unknown
flags are already dropped) and `-c web_search="disabled"` if 0.160 honours it (zero-cost check with
`codex debug prompt-input`/`features list`). Otherwise register it as a residual in the I1 section.

**I5. The codex framing overhead (spec §6.1 "Framing") is not closed.**
The spec says the residue "is measured per codex version and is the codex profile's `framingTokenOverhead`". P1c's
tool-reported `input_tokens` is 10811 for a one-line prompt. Spec §2.5 assumed about 1.5k tokens from bytes, and the
remainder is most likely codex's base instructions, which `prompt-input` does not show. `framingTokenOverhead` is per
profile, not per kind (plan issue 12). A live profile sized for claude or omp therefore under-reserves codex calls by
about 9k tokens each, and `input-too-large` trips late. Fix: hand the P1c number to the human with the
decision (`~/.orca/profile.json` is human-owned, spec §8.3). Record it in the handoff and the I1 section. No code
change.

**I6. Spec criterion 8 is not yet evidenced.**
The ccloop gate run 3 had `check-known-reds` RC 1: 2 unexpected reds. Both are pre-existing n=1 candidates on ccloop
main (ccloop handoff:48,59), each 3/3 green alone, and were ruled "passed". The Orca full gate (Task 16) has not run.
Four Orca criteria skip silently without `ORCA_CCLOOP_BIN`: `codexRequirementOpen.test.ts:10` (criterion 4),
`ccloopModels.test.ts:30`, and `webCcloopSmoke.test.ts` E6 and v1-soft. Under Rule 12 a skipped criterion is not a pass.
Fix: run the Task 16 gate against the build of the pushed sha. Prove those four files passed and were not skipped
(JSON reporter, as ruled). The human decides whether the two ccloop flakes go on the roster.

## Minor

- **M1** `Orca web/src/locales/en.ts:1370`, `zh.ts:1306`: the `codex-single-call-unavailable` text says "feature list
  could not be read". ccloop also emits this code for "no MCP server list" and for an MCP name that `-c` cannot
  address (`ccloop src/runtime/codex/codexAdapter.ts:163,168`). An operator with a dotted MCP name is told the wrong
  cause; only `{{detail}}` is right. Fix: kind-neutral text ("Codex's tools or MCP servers could not be turned off …").
- **M2** `codex-single-call-home-invalid` (`codexIsolation.ts:31`) has no en/zh entry and is not in
  `tests/panel/refusalCoverage.test.ts`. It falls back to the generic text. Add it.
- **M3** An existing but unwritable cache root (RF2 shape: EACCES/EROFS) has no fallback in `codexSingleCallHome`.
  `codexIsolation.ts:99` falls back to a per-run dir only for a null root. Every codex single call then fails with a raw
  EACCES (not `neverStarted`, booked null). Every codex catalog read also misses and re-probes 4 processes, because the
  isolated MCP list fails and the entry is not written. Fix: on EACCES/EROFS/ENOTDIR use the per-run fallback.
- **M4** `ccloop src/agents/agentCatalog.ts:65`: an installation whose isolated `mcp list` keeps failing never gets an
  entry, so every read pays version + `debug models` + `features list` + `mcp list`. The web re-reads models on every
  agents read (`App.tsx:580`), which is the probe-frequency problem R4 targets. Consider caching rows and features with
  `codexMcpServers: null` for the lifetime and letting only the single call re-list.
- **M5** Reverse merge-order hazard. After H1, an Orca `main` (old enum `["v1"]`) whose `ORCA_CCLOOP_BIN` points at a
  new ccloop build refuses every codex resolution as `control-response-invalid`, which breaks codex loop work too.
  The npm pin protects the live panel. Say in the handoff: keep `ORCA_CCLOOP_BIN` off post-H1 builds until H2.
- **M6** `ccloop codexCatalog.ts:95`: `env.CODEX_HOME || …` has no `isAbsolute` check, while `effectiveCodexHome` and
  `configFilesOf` treat a relative value as unset. A relative CODEX_HOME reads a cwd-relative `config.toml` for the
  window. Align the three.
- **M7** `Orca src/panel/controlViews.ts:831-846`: one `SELECT` per run per group read, and every `single-call`-phase run
  is assumed to belong to a requirement group (`readRequirementGroup` throws otherwise). That holds today (purposes are
  only estimate/clarify/split) but is coupling a new purpose would trip over. A comment or a purpose check would do.
- **M8** There is no Orca end-to-end test that runs a codex single call to completion through the real ccloop build:
  criterion 4 only opens the requirement. R1's "every kind runs the chain" for codex rests on P1c (ccloop-level) plus
  kind-neutral Orca code. Acceptable under spec §1; worth one fake-codex clarify-to-collect scenario later.

## Cross-repo and cross-task checks (passed)

- **`ccloop-models-v1` ↔ Orca:** ccloop `modelsSchema` (`src/control/command.ts`) and Orca `agentModelsSchema`
  (`ccloopPort.ts:50-51`) agree field by field: strict, model ≤ 200 characters, positive safe windows, enum
  `v1|v1-soft`, `observedAt` datetime or null. The installation echo is checked (`ccloopPort.ts:236`).
- **Resolution `"v1-soft"`:** emitted by `codex.ts:327-328` only when a catalog row is found. Accepted by Orca's enum
  (`ccloopPort.ts:48`, `agentSelection.ts:36`). Strict/soft split in `estimatorCompatibility.ts:16-18`; every caller
  passes the mode (`estimator.ts:93`, `requirementCommands.ts:92`, `webService.ts:525`). No other repo (ccmem,
  syncskill) parses the field.
- **Error codes:** `agent-catalog-unavailable`, `codex-single-call-not-single`, `codex-single-call-unavailable` have
  en/zh entries and refusal coverage. Exceptions are M1 and M2. omp keeps `omp-model-catalog-*` (plan issue 1).
  Catalog failures reach Orca as `ccloop-failed:<code>: <detail>` (exit 1 path, `ccloopPort.ts:111,160`); RF5 keeps
  `agent-installation-missing`.
- **R6 end to end:** omp and codex single calls compute one deadline. The re-check probes and the spawn share it
  (`ompSingleCall.ts`, `codexAdapter.ts`). `control`/`accept` resolutions share one 30 s deadline, under Orca's 60 s
  port timeout. Abort kills the probe's process group (`catalogProbe.ts`, `versionProbe.ts`). The isolated MCP probe
  gets the same deadline and signal.
- **Cache + private homes + MCP isolation:** the MCP list is read under exactly the call's isolation (fix round 3), and
  its names are cached in the same key, which stamps `config.toml`. Private dirs are lstat-checked (not a symlink, owned
  by this user). Links are re-checked per call. A regular file found where a link belongs is moved aside, never deleted.
  Exceptions are I3, M3, M4.
- **Rule 17 in criteria:** ccloop `tests/setup/relocateCatalogCache.ts` and Orca `tests/setup/relocateCcloopCache.ts`
  set `CCLOOP_CACHE_DIR` and an empty `CODEX_HOME` per file. ccloop's spawned CLI with an explicit env uses a relocated
  HOME (`agentCatalog.test.ts:110`). Orca `ccloopDefaultE2E` relocates HOME/XDG. Gate 3 and P2 recorded
  `~/.cache/ccloop` absent before and after, and `~/.orca` unchanged. P1-P1c: `~/.codex` credentials diff 0 bytes. One
  read-only real `codex mcp list` (fix round 3) was already surfaced. Remaining gap: I1.
- **Spec §1 criteria → files:** 1 `tests/agents/agentCatalog.test.ts` (capabilities and accept, omp and codex,
  spawn counts); 2 `tests/agents/catalogProbe.test.ts` and `tests/runtime/omp/ompSingleCall.test.ts` (cold re-check
  1000 ms); 3 `tests/agents/codexResolution.test.ts`, `tests/agents/claudeDefaultWindow.test.ts`,
  `tests/control/singleCallCapability.test.ts`; 4 Orca `tests/control/codexRequirementOpen.test.ts`;
  5 `tests/control/singleCallOutputBound.test.ts`; 6 `web/tests/agentModelsDatalist.test.tsx` and
  `agentModelsApp.test.tsx`; 7 `tests/control/declaredNullWindow.test.ts`; 8 gate (I6).
- **Rewritten criteria:** E1-E5 (ccloop) and E6 (Orca) change only the named expectation, to an exact literal. E3 keeps
  the refusal for an unlisted model and adds C3b. The human-named `ompSingleCall` "stops the call at the request's time
  limit" now warms the cache and adds the assertion that the call was spawned (stricter), plus the new cold-deadline
  criterion. The blanket-naming edits (`agentCatalog.test.ts:42` `[2,5]`, `catalogProbe.test.ts:146-151`) are in files
  new on this branch, stay exact `toEqual`, and are not loosened. ERRATUM texts are appended, never in place.
- **Wording rule:** no `web/src` string calls a codex single call bounded or capped. The overrun line is kind-neutral
  (ruling S3). README is stale (I2).
- **Merge order (spec §8.2):** the Orca branch is runtime-safe on the old pin 71053e3. Old ccloop never sends
  `"v1-soft"`, and Orca's enum is a superset. But: (a) every agents read sends `control models`, which old ccloop
  refuses, so every omp/codex model box shows "model list unavailable" and spawns a failing ccloop process per
  installation; (b) the branch's own real-ccloop criteria (E6 272000, v1-soft, criterion 4, `ccloopModels`) hold only
  against the new build. Main would carry criteria its pin cannot satisfy. (c) R7 takes effect on merge, independent
  of the pin: under the live null-declaring profile, omp and claude-1M imports start real estimate calls where they
  were `blocked-capability`, as spec §6.3 intends. The human should expect spending to begin at H2. Conclusion: land
  the branch together with the repin, as planned. Nothing makes an early merge dangerous, only incomplete and noisy.

## Deferred-minor triage (ledger `minor (deferred)` lines)

| # | Ledger item | Fix before merge? | Why |
|---|---|---|---|
| 1 | T1 fakeCatalogFixtures pid only `> 0` | no | Fixture self-test; the count criteria do not depend on it |
| 2 | T1 no `features list` case under `<marker>.catalog.json` | no | Fixture coverage; behaviour is pinned by catalogProbe tests |
| 3 | T1 sleep check wall time only | no | Fixture; deadline criteria measure the kill elsewhere |
| 4 | T2 omp `config.yaml` / `PI_CONFIG_DIR` not stamped | no (doc yes) | Bounded by the 30-min lifetime; state it in the I1 spec section |
| 5 | T2 readCatalogEntry no row validation | no | Done: `wellFormed` in agentCatalog.ts |
| 6 | T2 title "not … the clock" never varies clock | no | Title only |
| 7 | T2 PI_PROFILE/OMP_PROFILE env not modelled | no | ccloop always passes `--profile` |
| 8 | T3 runProbe settles on `close`; an escaped descendant holding pipes outlives the deadline | no | Pre-existing shape; worth a handoff line, since it is a candidate for the tester's unexplained omp hang (spec §10) |
| 9 | T3 descendants after exit 0 not reaped | no | Pre-existing |
| 10 | T3 codex deadline test lacks "process gone"; omp pid-file timing | no | Test robustness |
| 11 | T4 `env` option affects cache dir/key only | no | No production caller passes `env` |
| 12 | T4 ompPhase.test.ts teardown race | no | Pre-existing load flake |
| 13 | T4 cold re-check bound 7500 ms (~1 s margin) | no | Flake risk only; register |
| 14 | T5 one odd row makes the whole models answer control-response-invalid | no | Fails closed; the drop-down falls back to free text |
| 15 | T5 stale parseCommand comment | no | Comment |
| 16 | T6 one-iteration loop, stale comment, `=>` | no | Cosmetic |
| 17 | T7 historical ccloop spec/plan text says claude window null | no (handoff) | ERRATUM candidates in ccloop docs; not runtime |
| 18 | T7 stale comment above E4; mixed literals | no | Cosmetic |
| 19 | T8 `error` item reported as not-single:tool | no | Superseded by fix round 2 (error items allowed) |
| 20 | T8 key uses `command[0]` only | no | Same-CODEX_HOME installations share one private home; codex already shares its home across sessions |
| 21 | T8 fallback root mkdir no chmod | no | `privateDir` sets 0700 on create in the current code |
| 22 | T8 spent deadline spawns for 1 ms | no | Matches omp; harmless |
| 23 | T8 same-user TOCTOU lstat → ensureLink | no | Worst case is a displaced (kept) file; same-user attacker out of scope |
| 24 | T8 pre-existing world-writable `codex-home` left alone | no | Created 0700 by ccloop; existing modes are the person's (Rule 17) |
| 25 | T8 concurrent displace race ⇒ raw ENOENT books null | no | Rare; fold into the M3 fallback work |
| 26 | T8 C8.8 bound 7500 ms | no | Flake risk only |
| 27 | T8 non-homeInvalid home errors lack neverStarted | no | Books null, not 0; fold into M3 |
| 28 | T8 dotted MCP names cannot run a codex single call | no | Refused loudly; but fix the text (M1) |
| 29 | T8 stderr tail carries mcp-list stderr; `suppress_unstable_features_warning` unsent; §2.5 table not re-rendered | **yes (doc only)** for the §2.5 re-render | Spec §6.1 requires re-rendering §2.5 when an override is added: a correction section in Task 16 (I1). The other two are no. |
| 30 | T8 readIsolatedMcpServers uses process.env; refusal drops reason | no | No caller passes env; reason is in the worker log |
| 31 | T10 setup-file line has no failing criterion | no | Recorded by cache-dir listing; Rule 17 gap is small |
| 32 | T10 ~13 timeout load flakes to register | no (handoff) | Register in known-load-flakes.md |
| 33 | T11 degradation path has no v1-soft test; default "strict" | no | Callers pass `estimate.mode` (`webService.ts:525`). A v1-soft degradation test is cheap and recommended. |
| 34 | T12 run-estimate-contract refusal tested via one cause; language not distinguishable at 12,345 | no | Coverage nicety |
| 35 | T13 `GET ?refresh=1` without CSRF | no | SameSite=Strict cookie; owner-only |
| 36 | T13 strict `ccloop-models-v1` couples Orca to the literal | no (handoff) | Intended refuse-rather-than-print |
| 37 | T13 real-ccloop criterion skips silently without `ORCA_CCLOOP_BIN` | **yes (gate evidence)** | Criterion 4 and the models/v1-soft criteria must be shown passed, not skipped, in the Task 16 gate (I6) |
| 38 | T14 non-ccloop-failed refusals show no detail | no | Cosmetic |
| 39 | T14 fetchAgentModels has no timeout | no | The server's 60 s port timeout bounds it |

## Declined to judge

- Model quality of real omp estimates (P2 run C `estimate-output-invalid`): model behaviour, not transport; outside spec.
- Whether `model_context_window = 1000000` in the person's `config.toml` should win over the catalog's 272000 (P1c):
  spec §6.1 rules that it wins; not re-litigated.
- Codex phase adapter carrying the person's skills/AGENTS.md: spec §10 registers it as out of scope.
- The `cmux` shim vs nvm codex path difference between Task 0 and P1: environment, not code.
- Performance of the per-run usage query beyond M7: no measurement available (Rule 14).
- Correctness of codex 0.160.0 behaviour claims (feature names, `mcp list --json` shape) beyond what P1-P1c recorded:
  not re-measured (read-only, no paid calls).
