# Codex live usage and a turn-boundary ceiling stop

Status: proposed (2026-11-14, Orca session 3ffce7ec). Supersedes the ruling "codex: prompt only" (#297) **only for
loop phases**, and only if the human approves reopening it; see §7.

## 1. Intent

Tester issues #297, #225 (codex half), #285 and #195 share one root cause: a codex loop phase runs with `--ephemeral`,
so nothing observes its token use until `turn.completed` at the end of the phase (or not at all). The consequences seen
in dogfooding:

- #297: a group hard cap of 60M was used to 95.5M; one execute used 62,998,085 against a 10M pause line.
- #285: a running codex run shows no token figure, only "producing output".
- #195: nothing feeds `handoffAtContextTokens`; context occupancy is unknown during a codex phase.

The goal is: (a) Orca can show codex's running usage; (b) a loop phase stops at a turn boundary when its observed usage
crosses the ceiling or the pause line, the same way claude and omp already stop; (c) the same reading can feed a context
observation later. Exact stop-anywhere behaviour is **not** a goal: codex is stopped between turns only (as
`usagePause.ts` already documents for claude/omp vs codex).

## 2. What was measured (zero-cost, this session)

Probe: codex-cli 0.167.0 with an isolated `HOME`/`CODEX_HOME` and a local fake Responses endpoint; three model turns,
one shell command between each.

- With `--ephemeral`: no session file anywhere under `CODEX_HOME`.
- Without it: codex writes `CODEX_HOME/sessions/<Y>/<M>/<D>/rollout-<ts>-<thread_id>.jsonl`, appending one
  `event_msg`/`token_count` payload after each completed model response, **before the next request is sent**. The payload
  carries `total_token_usage` (input/cached/cache_write/output/reasoning/total), `last_token_usage` and
  `model_context_window`. The `thread_id` is also the first item on stdout (`thread.started`), so the file to read is
  `rollout-*-<thread_id>.jsonl`.
- 8 concurrent `codex exec` processes sharing one private `CODEX_HOME`: all exit 0, eight distinct thread ids and
  eight distinct rollout files, and each file's `token_count` totals equal that run's own `turn.completed` usage.
- Without `--ephemeral` codex also creates `thread_history_1.sqlite*` and `thread-writer-locks/` in the private
  `CODEX_HOME` (shared by concurrent runs), and the rollout files persist after the phase ends.

## 3. Constraints that decide the shape

1. **Session files persist and contain the full conversation.** ccloop's own rule is that a dispatched run must not be
   recorded as the person's session; the private `CODEX_HOME` is not the person's `~/.codex`, but the files would still
   outlive the run under `<cache>/codex-home/<sha256>/`. A design that leaves them there is a data-retention change.
2. **The private pair is shared per installation** (codex phase isolation spec §3.3). Reading "the newest rollout" is
   therefore wrong under concurrency; the reader must match the run's own `thread_id` from `turn.started`.
3. **`--ephemeral` is not optional per phase today.** It is in the default argv of `runCodexPhase.ts` and
   `codexSingleCall.ts`. The single call does not need this feature (it has its own output cap); changing it would alter
   single-call bytes, which Orca pins.
4. **Turn boundary, not mid-request.** The stop is checked between requests (after a `token_count` is written and before
   the next one), matching the existing "codex after the whole phase" note in `usagePause.ts`.
5. **No new authority on the Orca side.** The ceiling decision stays in ccloop (it already stops claude/omp on
   `live-ceiling`); Orca only reads what ccloop reports.

## 4. Proposed design (ccloop)

- Drop `--ephemeral` **for loop phases only** (`runCodexPhase.ts`), keeping the private `HOME`/`CODEX_HOME` isolation
  (so the person's `~/.codex` is untouched, as today). The single call keeps it.
- From `thread.started`, take `thread_id`, and while the phase runs, tail
  `<private CODEX_HOME>/sessions/**/rollout-*-<thread_id>.jsonl`, taking the last `token_count`. Publish it into the
  existing usage-event shape used for live observations (`usage.jsonl` / `run/usage.jsonl`; exact file chosen in the
  plan, following the claude/omp observation path) so Orca's run view (#285) and a future `contextObservation`
  (#195) get a number.
- Check the live ceiling and the pause line at each observed `token_count`; when crossed, terminate the codex process
  between turns, recording `exhausted` with `liveCeilingStop.observedTokens` as claude/omp do. Turn boundaries only.
- **Retention:** on phase end, delete the phase's own rollout file (matched by `thread_id`) and the codex-side history
  rows it wrote if codex offers a supported way; do not delete the shared SQLite files. If deletion of the history row
  is not supported, record that as a known residue in the spec's As-built section rather than inventing a file format.
  A phase killed by the ceiling keeps its rollout until the normal cleanup path runs.
- Post-run, the phase's own saved-result and accounting paths are unchanged: `turn.completed` remains the authoritative
  figure when present; the rollout only supplies "so far" readings and the stop decision.

## 5. Proposed design (Orca)

- No contract change: the run view and live usage already render ccloop's usage events. `agentKind` on usage rows is
  already nullable (schema 24).
- A separate, smaller change listed only as a dependency: feed a `contextObservation` from the same reading when
  `model_context_window` and `last_token_usage` are available (turns #195 from "design" into a follow-up).

## 6. Costs and risks

- More files written per codex phase (rollout + SQLite rows). Cleanup is part of the work, not a follow-up.
- A plan/execute/verify phase can still overshoot by one turn's usage; that is strictly better than a whole phase but
  must be stated, not implied. Orca must not claim a hard cap.
- Skill, MCP, hook and trust behaviour is unchanged: the isolated `CODEX_HOME` and `-c` overrides stay.
- Repin: this is a ccloop change, so Orca's pin moves once the human pushes it.

## 7. For the human

The ruling "codex: prompt only" (#297) was made when the only known route was considered impractical. The probe shows
the route works, but it is a data-retention and cross-repository change. Approving §4 reopens that ruling for loop phases
only; declining leaves codex as it is (prompt-only), and #285's codex half stays "no live number".
