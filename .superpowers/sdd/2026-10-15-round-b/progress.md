# Round 2026-10-15 b -- repin 71053e3, final-review minors, every-agent spec

Session `ec9ce319` (Claude Opus 5.5), 2026-10-15, branch `codex/round-20261015b` (worktree
`/Users/biran/code/skills/orca/Orca-wt/round-20261015b`), cut from main at `c331aac1`.

## Human rulings (in chat, this session)

- Ruling: final-review minors of round `026d10e3` -- fix m2 (driver log lines keep ccloop's whole stderr) and m6
  (cap-exceeded wording on the estimate line); do not fix m5 (`recoveryRetry` probe outside the admission gate) and m7
  (plan card for a stopped-without-intent group). Agent's recommendation, accepted by the human.
- Ruling: m5 is a Rule 7 conflict between two existing patterns, not a defect: `createEstimate` probes inside the gate,
  `setIntegrationScheme` keeps slow external checks outside it ("a drain never waits on a git child",
  `src/control/webService.ts:625`). `recoveryRetry` follows the latter; its apply enters the gate and refuses
  `panel-draining`. Flagged here, code unchanged.
- Ruling: m7 needs a `stopped` flag in the summary view (protocol change) for a gap the server already refuses; left.
- Ruling: ccmem `core.hooksPath` (stale `/Users/biran/code/skills/ccmem/.git/hooks`) unset, so git uses the default
  `.git/hooks` (only `.sample` files); not reset to a new absolute path, so a later move cannot break it again.
- Ruling: the paid real OMP estimate rerun is approved (one call); not run in this session.
- Ruling: spec rulings R1-R9 are recorded in `docs/superpowers/specs/2026-10-15-every-agent-requirement-chain-design.md`.

## Commits

- `chore(deps): repin ccloop to 71053e3 so attempt commits skip the target's hooks` -- `scripts/pin-ccloop.mjs`
  checks: default-resolution E2E 12/12, typecheck, `npm ci` reproduces the lock.
- `fix(control): keep ccloop's whole stderr on the driver's log lines` (m2).
- `fix(web): word the omp cap refusal for an estimate as well as a requirement` (m6). Rewrites the two pinned literals
  `EN_CAP`/`ZH_CAP` in `web/tests/ccloopCodes.test.tsx` -- covered by the m6 ruling (the text is the fix).
- Two spec commits (`docs(spec): every agent runs the requirement chain …`, `docs(spec): fold the spec review …`).

## m2 / m6 evidence

- m2 criterion (`tests/control/driverRoundIsolation.test.ts`, "logs ccloop's whole stderr…") seen red before the fix:
  the logged line ended in the cut's `…`, `END-OF-STACK` absent.
- Mutations in `/private/tmp/o15/mut` (clone of `fix(web): word the omp cap refusal…`), runner `/private/tmp/o15/mut.py`
  (exits 2 on a mutation that does not apply; sha256 before/after; restore checked); after the battery `git diff` and
  `git diff --cached` were 0 bytes:
  - M1 record-failure log line back to `describeError` -- RED. M5 `logError` body never takes the peer branch -- RED.
  - M2 settled-run log line, M3 no-drive log line, M4 round-failed log line back to `describeError` -- green: these
    three call sites have no criterion (reachable only through hard-to-build paths); the shared `logError` is pinned
    by M1/M5. Registered as a gap, no weak criterion written.
  - M6 en text back, M7 zh text back -- RED.
- Targeted runs: root 12/12 (`driverRoundIsolation`, `scanPanelText`, `refusalCoverage`), web 13/13 (`ccloopCodes`),
  typecheck 0.

## Gate (clone `/private/tmp/o15/orca` at the repin commit; `ORCA_CCLOOP_BIN` = build clone of ccloop `71053e3`;
## fake codex `integration` table; private HOME/XDG/CCMEM_DATA_ROOT; logs `/private/tmp/o15/logs/`)

- First pass: typecheck, build, ledger, CLAUDE.md, hooksPath, scheduler 0 (27 s), web build, pin, panel, `--ws check`,
  tmpleak 0 (0 entries left). Full test, `verify:control`, `verify:chain` red -- the gate script ran tests before
  `web build`, so a fresh clone had no `web/dist` and ~50 panel tests failed `panel-dist-missing` (handoff §6.7 trap;
  controller's error). Not counted.
- Rerun with `web/dist` present: full 3816/3865, 33 skipped, 16 red = 14 timeouts (5 s / 30 s) in `gateCheck`,
  `driverRecovery`, `integrationKeep`, `retryTask`, `schedulerBridge`, `settleUnknownUsage` + `taskResultPaired` x2
  (fixed environment red). `verify:control` 1958/1991, 3 red (`taskResultPaired` x2, one `settleUnknownUsage`
  timeout). Load 11-17. Per-file isolation: see the section appended below when it finishes.
- The m2/m6 commits were not in the gated clone; they ran their targeted files only.

## Measured for the spec (zero-cost; commands in the spec §2)

omp startup and proxy probe, probe count per operation (static trace by an Explore subagent, read back and spot-checked
against `materialize.ts`, `ompSingleCall.ts`, `profiles.ts`), claude binary model table, codex catalog and
`debug prompt-input` renders. Scratch scripts in the session scratchpad (lost at session end; results only here and in
the spec).

## Real OMP estimate rerun (paid; human: "同意", then "只要估算后面终止" with a stop-after-estimate switch if such runs recur)

- Ruling: estimate-only runs will recur (spec §9 codex acceptance, model swaps) ⇒ added `--estimate-only` to
  `scripts/live-driver-acceptance.ts` (commit `test(acceptance): stop the estimate scenario after the estimate with
  --estimate-only`). Fake runs: `--fake-omp --scenario estimate --estimate-only` exit 0, checks all true, fake call
  list exactly `single-call`; the full `--fake-omp --scenario estimate` still exit 0 (166 = 166 tokens).
- Real run 2026-10-15 ~22:39 local: omp 18.10.1, model alias `local-litellm/ep-20261012204110-nvhqw` (LiteLLM on
  `localhost:4000`, `/health/liveliness` 200), ccloop build clone `71053e3` (`/private/tmp/o15/ccloop`), isolation root
  `/private/tmp/omp15-sUh0` (0700; holds copies of `~/.omp/agent/{config.yml,models.yaml}` -- credentials, delete
  after use). Exit 1: every check true except `estimateReady`; estimate `failed`, `estimate-output-invalid`; one
  assistant message, tools off, overlay present, 3170 tokens booked = ccloop usage.
- The model's answer (events.jsonl) lists task `a` twice; the copy and `groupRationale` are the literal
  `"placeholder"`. Same shape as Task 13 (n=2 now). Neither the instruction (`src/control/estimatePrompt.ts`) nor the
  response schema in the system prompt contains "placeholder", `minItems` or a two-entry template ⇒ recorded as this
  model alias's answer quality. Options for the human (not done): another model; or an instruction v2 that states the
  plan's exact task count (a new `instructionVersion`, design work).

## Gate, final (appended after the per-file reruns)

- `verify:chain` rerun: chain 213/213; its second full run 3830/3865, only `taskResultPaired` x2. tmpleak 0.
- Each timed-out file alone, 3 runs each, same env (`/private/tmp/o15/iso.sh`, load 5-34): `gateCheck` 19/19,
  `driverRecovery` 8/8, `integrationKeep` 1/1, `retryTask` 15/15, `schedulerBridge` 9/9, `settleUnknownUsage` 36/36,
  all 3/3 ⇒ the 14 + 1 timeouts are load flakes of already-registered files. No other red.

## Plan

- `docs(plan): every agent runs the requirement chain -- ccloop cache, model lists, codex soft single call` written by one
  subagent seat (17 tasks; 16 spec issues at its top; existing criteria E1-E6 to name to the human). Controller
  spot-checked: the commit holds only the plan; anchors E1 (`singleCallCapability.test.ts:16`), E4
  (`registry.test.ts:81,83`), C58a/b (`ompCatalogDiagnostics.test.ts:34,41`) and Orca `PORT_TIMEOUT_MS = 60_000` match.
  No second review seat.
