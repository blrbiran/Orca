# Quota-aware failover across agent installations

Who: Claude Code session `43913afc`, 2026-11-03. Human: 「额度感知的跨厂商切换 => 建议你看下 `sourceget find litellm magpie cc-switch` 对应的三个开源项目」. **Design only; the decisions in §6 are the human's.**

## 1. Why

The reason to install Orca on top of Claude Code, Codex or omp is to hand over more work than one person can babysit and let it run unattended, across the subscriptions they already pay for. Today one vendor's quota ending stops that: a codex call answers "You've hit your usage limit … try again at 16:12", the run fails (or retries into the same wall), and every task that would have gone to codex waits for a person to re-pick an agent. This session measured it: codex on this machine is out until 2026-11-04 16:12 while claude has room.

## 2. What the three projects do (read-only survey, file references in the session ledger)

- **magpie** (Go gateway, `internal/gateway/routing.go`): classifies each failure by status plus message (`usedUpWords`: `usage.?limit|hit your .*limit|limit.{0,24}resets|quota|额度…`; `quotaCodes`: `usage_limit_reached|RESOURCE_EXHAUSTED`). A 429 that names a time is quota; one per minute is a rate limit. It parses the reset time (Claude Code's `limit reached|<unix>`, ChatGPT `resets_at`/`resets_in_seconds`, `Retry-After`, written times) and records a **rest** `{why, until, by}` where `by` says where the time came from (vendor reset, window, Retry-After, default 15 min). Picks the next account with room; shows "back at 20:12 UTC+8". Most rests live in memory.
- **cc-switch** (Tauri, `src-tauri/src/proxy`): an ordered failover queue in SQLite (`providers.in_failover_queue`, `sort_index`), a circuit breaker, persisted `provider_health` (`consecutive_failures`, `last_error`), and a visible `provider-switched` event with `source: "failover"`.
- **LiteLLM**: router cooldowns (5 s default, failure-rate based) and ordered fallback groups; only `Retry-After`, no quota-text parsing.

What transfers: magpie's classifier and reset parsing; a persisted rest per installation; an ordered fallback list; a visible switch event. What does not: retrying one request mid-flight on another upstream (Orca's unit is a subprocess with side effects in a worktree); second-scale cooldowns and circuit breakers (Orca has few, long calls); rewriting the CLI's own login (magpie, cc-switch direct mode) -- Orca switches between installations, it does not edit `~/.codex` or `~/.claude`.

## 3. Shape

- **Detect (ccloop).** A new `failureCause: "quota-exhausted"` with `detail: { resetsAt: <ISO> | null, source: "vendor" | "retry-after" | "default" }`, from the agent's own error text and status, using magpie's rules (quota vs rate limit vs credit). Not retried inside the phase (the existing transient ladder retries `rate-limited` only). ccloop owns this: it reads the stream. Orca must first accept the new cause name (the panel shows unknown causes as `unknown`).
- **Remember (Orca).** A row per installation in the control store: `installation_rests(installation_id, why, until, source, last_error, at, by)`; survives restarts; cleared when `until` passes or a call on it succeeds. Default rest when no time is given: 15 minutes, then doubling, capped at 8 hours (D3).
- **Route (Orca, code only).** At dispatch -- never mid-run -- a work item whose selected installation is resting is offered to the next installation in the person's ordered fallback list that is not resting and fits the frozen selection's requirements (kind capabilities, context window, budget enforcement). The change is a recorded re-selection by code: an activity row, a decision-ledger entry (`agent-failover`, who: `orca-auto`, why, from, to), and the work item's frozen selection updated as `proposal-set-agent` would. A run that hit the wall itself ends as now (failed, cause named); its retry is the next dispatch and follows the same rule.
- **Nothing to switch to** ⇒ the work waits until the earliest `until`; a scheduler wake is set for then; the panel says "codex is out of quota until 16:12; no fallback configured" instead of a generic block.
- **Show.** The group and task views name each switch; the agents page shows each installation's rest and when it ends.

## 4. Single calls

Clarify, split and estimate calls follow the same routing (their agent is the estimator selection). A flow call uses the parent's frozen slot; flows follow too unless D5 says no.

## 5. Interactions

- `agentConfigHash` and frozen selections: a switch changes the item's selection exactly as a person's `proposal-set-agent` does; nothing else in the group changes.
- Budget: the item keeps its allocation (no re-estimate). An installation whose budget enforcement cannot honour a strict group is not a candidate.
- Multi-directory projects and saved-result recovery: unchanged; the switch happens before a new run starts.

## 6. Decisions for the human

- **D1. On by default?** (a) On whenever the person has more than one installation in the order. (b) Off until the person turns it on. ➡️ (a): the point is unattended work, and a person who has only one installation never sees it. An item a person pinned to an agent by hand is never switched (D2).
- **D2. A hand-picked agent.** (a) Never switched; it waits. (b) Switched, marked "originally chosen by you". ➡️ (a): a pin is a statement.
- **D3. Rest without a reset time.** 15 min, doubling, cap 8 h (magpie's default is 15 min; its cap is 8 days). ➡️ as written.
- **D4. Scope of a rest.** (a) Per installation, for every group (quota is the account's, not the group's). (b) Per group. ➡️ (a).
- **D5. Flows.** (a) Flow calls switch too. (b) They wait. ➡️ (a), same rule.
- **D6. Where the order lives.** (a) The agent preferences (one global order, per operator). (b) Per project. ➡️ (a) first; per project later if asked.

## 7. Order of work

1. ccloop: `quota-exhausted` with reset parsing, from real error samples (codex sample is reachable now on this machine; claude's needs an exhausted account) -- registered in Orca's cause list first.
2. Orca: rests table (schema bump, backup first), routing at dispatch, activity and ledger rows, panel text.
3. Paid acceptance: one real codex quota hit routed to claude (after the human's go-ahead).

## 8. Human rulings (session e2ad4802, 2026-11-05)

Recorded by Claude Code (Opus 5.5), session e2ad4802; §1–§7 above are kept verbatim.

- D1–D6: as recommended in §6 (human: 「其他同意」) -- on by default with more than one installation in the order; a hand-picked agent is never switched; rest without a reset time 15 min doubling to 8 h; a rest is per installation for every group; flow calls switch too; the order lives in the agent preferences.
- **Amendment to §3 Route** (human, replying to "the switch never happens mid-run": 「如果是provider额度用完，且有备用provider，可以改provider并重试。」): a run that itself ends with `failureCause: "quota-exhausted"` is not left for the next ordinary dispatch or the retry ladder. When a fallback installation that is not resting fits the item (and the item was not hand-picked, D2), Orca switches the item to it (the same recorded re-selection as §3) and starts a new run at once. The switch still happens between runs, never inside one: the failed run ends as now (its worktree and evidence kept as for any failed run) and the new run starts from the item's base. This immediate retry does not consume the retry ladder's attempt (the cause is the provider's, not the task's). With no fallback, §3 "Nothing to switch to" applies.

## Correction (session 3cfc2e73, 2026-11-06): no separate scheduler wake at the earliest `until` (batch FB)

Recorded by Claude Code (Opus 5.5), session 3cfc2e73, batch FB, on `feat/failover-ui` from main `e783beee`; the text above is kept verbatim.
§3 "Nothing to switch to ⇒ … a scheduler wake is set for then" is not built as a wake of its own. The panel's pump already
runs every `--control-wake-ms` (default 5 s, `src/panel/controlOptions.ts` `DEFAULT_CONTROL_WAKE_MS`; armed by
`src/panel/server.ts` `startPump`), and each pass runs `systemDebugPass` → `failoverPass`, which reads the rests at the
store's clock (`src/panel/controlAssembly.ts` pump). A rest that ends is therefore seen at most one interval later with no
other event; a timer at `until` would add a second path to the same pass and nothing a person could observe. Pinned by
`tests/control/quotaFailover.test.ts` "waits while the other installation rests, and switches back once its rest ends".
The panel text and the agents-page rest view (§3 "Show") are built as written (plan As built, addendum 2026-11-06).

## Correction (session 3cfc2e73, batch FA, 2026-11-06)

Recorded by Claude Code (Opus 5.5), implementation agent of session 3cfc2e73; the sections above are kept verbatim. Where
the code departs from §3 and D3 (details in `docs/superpowers/plans/2026-11-05-quota-failover.md`, addendum 2026-11-06):

- §3 Route is built for a task not started yet (no run), in the groups failoverPass serves (orchestrated, not a flow child,
  not archived, not stopped), before each start delivery. The re-selection is recorded on the work item
  (`agentSwitches`, reason `rest`, by `orca-auto`) with the confirmed snapshot re-issued, not as an activity row or a
  decision-ledger `agent-failover` entry.
- D3: a reset time the error text names is trusted at most 24 hours past the failure.
- Session 3cfc2e73 ruling: an authorized agent (not a run Orca dispatched) may switch a task's installation; its switch
  locks the task like a person's (D2) and names who made it; `orca task retry <g> <t> --agent auto` hands the choice back.
