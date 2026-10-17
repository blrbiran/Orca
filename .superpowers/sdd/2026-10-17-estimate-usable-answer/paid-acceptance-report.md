# Paid acceptance -- estimate usable answer, instruction v2 (spec §6 "Paid")

Who: Orca session d0843ec0 (controller, no subagents). When: 2026-10-17, 09:51-10:08 local.
Human authorization: "这一轮都同意付费验收" (session 4de777f4), relayed at the start of d0843ec0 with the scope fixed to
three items, not to be widened: omp alias `--repeat 5`, codex gpt-6-luna once, claude 1M once. No run was repeated.
Code under test: `git clone --local` of `Orca-wt/round-20261017` at `aff94b70` (`docs(handoff): hand off at T2 with the
paid acceptance and the post-fix gate next`; the last code commit below it is `fix(control): keep model text in estimate
codes canonical so the settlement never throws`), node_modules symlinked to the worktree's. Harness:
`scripts/live-driver-acceptance.ts` of that clone, unmodified. ccloop: `/private/tmp/ccb6-qswQ/ccloop/dist/cli.js` at
`02cbacc` (the pin).

## Isolation (Rule 17)

- Root `P=/private/tmp/est-sLx8` (0700; short path for the control socket). omp: wrapper `$P/iso.sh <cache> <cmd>` sets
  private `HOME`, `XDG_{CONFIG,CACHE,DATA,STATE}_HOME`, `TMPDIR`, `PI_CODING_AGENT_DIR=$P/omp-config` (= `--omp-config-dir`,
  copies of `~/.omp/agent/{config.yml,models.yaml}`, 0600; **holds credentials, left for the human to delete**) and
  `CCLOOP_CACHE_DIR=$P/cache-omp`.
- codex and claude: historical HOME behaviour of the harness (real HOME; claude via the installation's isolation flags);
  `CCLOOP_CACHE_DIR` unset, so the harness puts ccloop's cache (and codex's private home) under `--output/ccloop-cache`.
- Real dirs, before and after all three runs: `ls -laR` + `shasum -a 256` of every file + every symlink target of
  `~/.orca` and `~/.cache/ccloop` (`$P/logs/home-{before,after}.txt`, diff `$P/logs/home.diff`, 114 bytes). The only
  difference is the mtime of `..` (the home directory itself). `~/.cache/ccloop` exists before (the Task 7 incident's
  8 paths) and is unchanged. `~/.codex/{auth.json,config.toml}` size, mtime and sha256: `cmp` 0.

## Commands

```
cd $P/orca; CB=/private/tmp/ccb6-qswQ/ccloop/dist/cli.js; COMMON="--scenario estimate --estimate-only --instruction-version 2"
omp:    $P/iso.sh $P/cache-omp ./node_modules/.bin/tsx scripts/live-driver-acceptance.ts --ccloop-bin $CB --output $P/run-omp --omp /Users/biran/.bun/bin/omp --model local-litellm/ep-20261012204110-nvhqw --omp-config-dir $P/omp-config $COMMON --repeat 5
codex:  ./node_modules/.bin/tsx scripts/live-driver-acceptance.ts --ccloop-bin $CB --output $P/run-codex --codex /Users/biran/.nvm/versions/node/v22.13.1/bin/codex --model gpt-6-luna $COMMON
claude: ./node_modules/.bin/tsx scripts/live-driver-acceptance.ts --ccloop-bin $CB --output $P/run-claude --claude /Users/biran/.nvm/versions/node/v22.13.1/bin/claude --model claude-opus-5-5 --context-window 1000000 $COMMON
```
Outputs: `$P/logs/{omp,codex,claude}.{out,err,exit,start,end}`, `$P/run-*/summary.json`.

## Results

| run | exit | wall | tally (firstCallReady / readyAfterRepair / readyAfterRetry / failed) | checks |
|---|---|---|---|---|
| omp x5 | 0 | 63 s | **4 / 0 / 1 / 0** | all 13 true |
| codex gpt-6-luna x1 | 1 | 907 s | 0 / 0 / 0 / **1** | false: estimatesSettled, estimateReady, estimateUsageBooked, notTimedOut |
| claude 1M x1 | 0 | 12 s | **1 / 0 / 0 / 0** | all 10 true |

- omp repeat 1: first call `failed` `estimate-output-invalid`, problems `["field-invalid:groupRationale"]`; the automatic
  retry (origin `auto-retry`) came back `ready`. Repeats 2-5: `ready` on the first call. Every ready answer has repairs
  `["answer-v2-converted"]` only (the v2 keyed shape, spec §4 step 1: not a defect, counted as firstCallReady). No
  duplicate-task answers in 6 calls (the v1 shape had 3 of 4 on this alias).
- claude: `ready` on the first call, repairs `["answer-v2-converted"]`, tools off.
- **codex: not a usable-answer result -- the account is out of quota.** The call reached codex (one turn started) and
  codex answered `turn.failed`: "You've hit your usage limit ... try again at Oct 22nd, 2026 2:13 PM" (events.jsonl of
  `run-codex/control/live-247610f4.runs/run-e976c0b5-…/run/codex/1/single-call/call-PhNWIm/`), ccloop `exit-error` code 1,
  `observedTokens` null, usage `cumulative: null`. Orca blocked the run `estimate-usage-unknown:codex-exit-error` and the
  estimate stayed `running` -- the established handling of an aborted call with no observed usage (spec
  `2026-09-27-single-call-estimate-design.md` item 4), so no retry was due and the harness waited out its 900 s deadline.
  The transport side (29 `-c` keys accepted, 3 `error` items treated as diagnostics, MCP off) matched P1d. Not re-run: the
  quota is exhausted until 2026-10-22 and a re-run is outside the authorized scope.

## Tokens (tool-reported only)

| call | input | output | cache write | total booked (= ccloop usage) |
|---|---|---|---|---|
| omp r1 (failed) | 2349 | 726 | 0 | 3075 |
| omp r1 retry | 2375 | 596 | 0 | 2971 |
| omp r2 | 2351 | 526 | 0 | 2877 |
| omp r3 | 2348 | 533 | 0 | 2881 |
| omp r4 | 2348 | 707 | 0 | 3055 |
| omp r5 | 2351 | 644 | 0 | 2995 |
| **omp sum (6 calls)** | 14122 | 3732 | 0 | **17854** |
| codex | -- | -- | -- | null (no usage reported; codex failed before model work) |
| claude-opus-5-5[1m] | 2 | 537 | 5815 | **6354** |

Dollars: claude's own `total_cost_usd` 0.057268 (`run-claude/claude-raw/001792202651687-25369.json`). omp's LiteLLM
alias reports no price. codex reported no usage. No other dollar figure is available.

## Left for the human

`$P` is kept: `$P/omp-config` holds credential copies, `$P/home/.omp` omp's private state, and
`$P/run-codex/ccloop-cache/codex-home/…` symlinks to `~/.codex/{auth.json,config.toml}`.
