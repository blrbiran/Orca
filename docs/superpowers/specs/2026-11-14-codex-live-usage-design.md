# Codex live usage and a turn-boundary ceiling stop

Status: revised proposal (2026-11-14, Orca session 20ff3baa). Supersedes the ruling "codex: prompt only" (#297) **only
for loop phases**, and only after the human approves reopening it; see §8.

## 1. Intent

Tester issues #297, #225 (codex half), #285 and #195 share one root cause: a codex loop phase runs with `--ephemeral`,
so nothing observes its token use until `turn.completed` at the end of the phase (or not at all). The consequences seen
in dogfooding:

- #297: a group hard cap of 60M was used to 95.5M; one execute used 62,998,085 against a 10M pause line.
- #285: a running codex run shows no token figure, only "producing output".
- #195: nothing feeds `handoffAtContextTokens`; context occupancy is unknown during a codex phase.

The goal is: (a) Orca can show codex's running usage; (b) a loop phase stops after an observed response when its usage
crosses the ceiling or the pause line; (c) the same reading can feed a context observation later. Codex is stopped
between observed responses only. This is **not** a hard cap: a request already on the wire when the stop is decided
still runs, and exact "before the next request" ordering is not promised.

## 2. What was measured

The original 2026-11-14 free probe (session 3ffce7ec, codex-cli 0.167.0, isolated `HOME`/`CODEX_HOME`, local fake
Responses endpoint) established the direction: with `--ephemeral` no session file appears; without it, codex writes
`CODEX_HOME/sessions/<Y>/<M>/<D>/rollout-<ts>-<thread_id>.jsonl` and appends one `event_msg`/`token_count` payload after
each completed model response.

This session's independent control (same version, private HOME/CODEX_HOME, private fake Responses endpoint; scripts under
`.superpowers/sdd/2026-11-14-codex-ephemeral-probe/`):

- **With `--ephemeral`**: no `sessions/` tree. The private home still received state databases, an `installation_id`, the
  system skills tree, and a plugin clone; these are not session transcripts.
- **Without `--ephemeral`**: the rollout appeared, and the required `token_count` had `total_token_usage`
  (input 120, cached 20, cache_write 0, output 5, reasoning 1, total 125), `last_token_usage` and
  `model_context_window: 258400`. The same run wrote `thread_history_1.sqlite*`, `logs_2.sqlite*`, `state_5.sqlite*`,
  `queue_1.sqlite*`, `memories_1.sqlite*`, `goals_1.sqlite*` and `thread-writer-locks/`.
- **A failed call persisted the conversation without any model response**: with the endpoint unavailable, the rollout
  still held 34,352 bytes of base instructions and user prompt (`session_meta`, `event_msg`, `response_item`,
  `world_state`, `turn_context`, …), then a retry sequence and `turn.failed`. Persistence starts at thread creation, not
  at the first completed response.
- The rollout's `token_count` fields match the stdout `turn.completed` fields for the same response (one call, both
  sources: input 120, cached 20, cache_write 0, output 5, reasoning 1).

Installed `codex exec --help` documents `--ephemeral` as "Run without persisting session files to disk"; 0.167.0 exposes
no CLI verb to delete a thread. Upstream source at `/Users/biran/code/skills/agent/codex/codex-rs` (revision c1c07853,
2026-11-06, not the installed binary) contains a state-layer `delete_threads_strict` that removes logs, queue, memory,
goals, dynamic tools, spawn edges, receipts and the thread row; that is internal API, not a supported exec command, and
its presence does not establish that 0.167.0's on-disk layout or migration state match.

## 3. Side effects of dropping `--ephemeral` (verified or source-read)

1. **Session content remains on disk after a normal phase.** Integration probes share one private `CODEX_HOME` per
   installation (ccloop codex phase isolation §3.3; legacy/test adapters can use the ambient HOME). ccloop cleanup
   currently removes worktree skill links, not session state. Rollouts contain the full prompt, base instructions and
   assistant messages.
2. **A crashed, aborted or failed phase also leaves a rollout.** The failed-call probe proves persistence precedes any
   answer. SIGTERM/SIGKILL cleanup in `runCodexPhase` closes evidence files but does not remove codex session state; crash
   resume reaps processes and worktrees, not Codex homes.
3. **Concurrency requires exact thread matching.** Several concurrent phases share the private home; the file to read is
   `rollout-*-<thread_id>.jsonl` where `thread_id` came from this run's `thread.started`. "Newest rollout" can read
   another run's usage or conversation.
4. **Saved-result recovery rejects a changed argv.** `savedResultRecovery.ts` reconstructs the old expected argv
   including `--ephemeral` and compares immutable outcome args. Dropping the flag without a versioned matcher makes new
   results fail `saved-result-config-mismatch`; old archived results must still validate.
5. **Live readings are not durable observations yet.** `onObservedUsage` already exists for claude/omp and aborts through
   the controller, but codex's stream fold never calls it. Durable `control/usage.json` rows are written at phase settle,
   not per observation. Feeding the callback is necessary but not sufficient for Orca's run view; a provisional channel
   must be separate from authoritative `turn.completed` accounting to avoid double booking.
6. **The stop is not coordinated with codex.** The abort path SIGTERMs the process group. The filesystem may show a
   `token_count` after the next request has already begun, so the honest claim is "stop after an observed response", not
   "never start another request past the ceiling". Tools can produce several model requests inside one exec turn.
7. **Capability text becomes stale.** Codex declares `usageObservation: "phase-end"`, `budgetEnforcement: "soft"`,
   `contextObservation: "unavailable"`. Any change must update the descriptor and Orca's explanatory copy, and must not
   claim a hard cap or a complete context observation.

## 4. Proposed design (ccloop)

- Drop `--ephemeral` for loop phases only (`runCodexPhase.ts`); leave the single call's own argv untouched (it supplies
  its own args and already has an output cap). Keep the private HOME/CODEX_HOME isolation.
- From `thread.started`, take `thread_id`; tail only that phase's `rollout-*-<thread_id>.jsonl`, parse complete lines and
  use the last `token_count`. Publish a provisional live reading on the existing observation callback; do not write it as
  a settled usage row.
- Check the live ceiling and pause line at each observation; when crossed, stop through the existing abort path and record
  `exhausted`/`liveCeilingStop` as claude and omp do. State the one-request overshoot explicitly.
- Final accounting stays `turn.completed` when present. A missing or unreadable rollout must keep usage unknown, never
  book zero; a stale rollout from another thread must never be read.
- **Retention, as a condition of this change:** on phase end, remove that phase's rollout file by exact thread id (and
  only files this phase created), and remove what can be removed safely without touching the shared SQLite files or
  other runs' rows. Because 0.167.0 exposes no supported thread deletion, either (a) find and verify a supported
  deletion path before implementation, or (b) record the residual history rows as a known data-retention cost and
  obtain the human's acceptance. Deleting the whole private CODEX_HOME, the shared SQLite files, or sessions by age is
  forbidden; a crash before cleanup leaves the phase's content, which the cleanup sweep for that run must be able to
  find later.
- Keep the existing `--ephemeral` argv accepted for old evidence: version the saved-result argv matcher so both old and
  new results validate, and do not change what old capsules mean.

## 5. Proposed design (Orca)

- No contract change: the run view and live usage render ccloop's usage events. `agentKind` on usage rows is already
  nullable (schema 24). A provisional live number needs its own display meaning (observed so far, not settled), so Orca
  must not show it as booked spend.
- Update the codex note and `usagePause.ts` wording to "stops after an observed response, may pass the cap by the request
  already in flight". Do not claim a hard cap.
- A separate follow-up may map `model_context_window` plus last-turn usage into `contextObservation`; it is not part of
  this change and must pass the existing capability gate.
- Explain the retained-session consequence in the agent installation/run UI where a person would look for it.

## 6. What must be verified before implementation is called done

- Same fake-endpoint controls: with the flag removed, a clean phase, a failed phase, an aborted phase and a
  ceiling-stopped phase each leave no other run's file readable and no unaccounted content after the phase's own cleanup.
- Eight concurrent phases sharing one private home get distinct threads and each reads only its own totals.
- Saved-result recovery validates both an old (`--ephemeral`) archived result and a new result.
- A tool-using multi-request turn shows the first observation before the next request in the rollout ordering, or the
  spec records the measured gap; no design text promises a guarantee the observation cannot give.

## 7. Costs and risks

- More files and SQLite rows per codex loop phase; retention is part of the work, not a follow-up.
- One-request overshoot remains, and no observation may arrive before a long first response.
- Repin: this is a ccloop change, so Orca's pin moves once the human pushes it.

## 8. For the human

The 2026-11-13 ruling "codex: prompt only" (#297) was made before the observation route was measured. The route works,
but it retains session content and crosses the ccloop/orca boundary. Approving §4 reopens the ruling for loop phases
only. The retention choice in §4 is the point that needs a decision: supported deletion if it can be verified, or
documented residual history rows as an accepted cost. Declining leaves codex prompt-only, and #285's codex half stays
"no live number".
