# Quota failover — plan and as built

Who: Claude Code (Opus 5.5), Orca session e2ad4802, 2026-11-05. Spec: `docs/superpowers/specs/2026-11-03-quota-failover-design.md`
(§8 records the human's rulings: D1–D6 as recommended, and the amendment 「如果是provider额度用完，且有备用provider，可以改provider并重试。」).
Branch `feat/quota-failover`. The human was away and asked for the work to be done and reported at the end; the deviations
below are the controller's calls under 「这一轮执行过程中如果有问题，先按你的建议执行」 and are listed for review.

## What was built

1. **Detection: no ccloop change.** ccloop already classifies a usage-limit error as `failureCause: "quota"`
   (`src/runtime/failureCause.ts`, codex rows `ve hit your usage limit` / `Quota exceeded…`, claude `billing_error` and the
   usage-limit phrases) and carries the CLI's own error text in `detail` (≤512 B). Orca reads the reset time from it.
   Deviation from spec §3/§7 step 1 (a new `quota-exhausted` cause with a structured reset): not needed for v1, and it
   avoids a ccloop contract change and a repin.
2. **Rests** (`src/control/quotaRest.ts`, D3, D4): derived from stored runs, no table (deviation from spec §3 "a row per
   installation"; nothing to keep in step, no schema bump). Per installation, the quota failures since its last
   succeeded run: until = the vendor reset parsed from `detail` (`try again at Oct 22nd, 2026 2:13 PM`, `try again at 16:12`,
   local time) else last failure + 15 min × 2^(n−1), capped at 8 h.
3. **Switch and retry** (`src/control/agentSwitch.ts`, `retryTask.ts`): `retry-task` takes an optional `agent`
   (installation id). ccloop resolves it before the transaction (`WebControlService.retryTaskOnAgent`); inside the retry,
   after every eligibility check, the work item takes the new six frozen fields, the switch is appended to
   `work.agentSwitches` (`{afterRunId, previous, by, at, reason}`), and the confirmed execution snapshot
   is re-issued with only that task's agent entry replaced (older snapshots kept). Provenance `failover` (orca-auto) or
   `task` (a person). A task with skills is refused (`agent-switch-skills`), the same installation `agent-unchanged`, a
   saved-result no-dispatch retry `agent-switch-saved-result`. The history is cleared where the frozen selection is
   cleared (reopen) or re-frozen (confirm).
4. **I1 with switches**: `runAgentAgrees(work, run)` replaces strict run-vs-work equality in the retry, the retry grant
   and the group view. Each run is stamped at claim with the task's switch count (`agentEpoch`, omitted at 0 so a
   never-switched task's runs keep their bytes; added to the view's strict persisted-run schema); a run of epoch k below
   the number of switches carries switch k's `previous`, a current-epoch run the work item's selection.
   Saved-result recovery stays strict (a run from before a switch cannot be recovered that way).
5. **The pass** (`WebControlService.failoverPass`, inside `systemDebugPass`, before the quota wait): orchestrated,
   not stopped, not archived, not a flow child; current run failed with `quota`; agent provenance in
   `SWITCHABLE_AGENT_SOURCES` (`operator`, `operator-agent`, `descriptor`, `failover` — D2 leaves `task`, `group`,
   `task-plan`, `group-plan` alone). Target: first of `failoverOrder ?? listAgents()` that is another installation, is
   listed and is not resting; a target ccloop cannot resolve now is skipped for this pass without booking anything and the
   next one tried; the group revision is read after the resolution. One command per failed run
   (`orca-auto-failover-<task>-<run>`; a run with that command row is skipped, so an answer is final and never resent at
   a later revision); errors are caught per candidate. Outside the ladder (`quota` is ladder-exempt). Nothing to switch
   to ⇒ unchanged (the quota wait if set, else the person).
6. **Order** (D1, D6): orchestration settings `failoverOrder` (`orca orchestration set --failover-order <i>…`,
   `--failover-off` = empty). Deviation from D6 (a) "the agent preferences": those are per operator and orca-auto has
   none (`errors.ts` auto-confirm-selections-unresolved); one global order in the orchestration settings keeps the
   ruling's intent (one order, not per project).
7. CLI: `orca task retry <g> <t> --agent <installation>`.

## Criteria and mutations

`tests/control/quotaFailover.test.ts` (12 cases). Mutations, each in a `git clone --local` copy, 0 dirty files after:
M1 runAgentAgrees ignores switches · M2 plan-named agent switchable · M3 order setting ignored · M4 rests ignored ·
M5 current installation not excluded · M6 snapshot not re-issued · M7 no doubling · M8 success does not end a rest ·
M9 PM not applied · M10 time-only reset never rolls to tomorrow · M11 switch skipped · M12 agent-unchanged dropped ·
M13 a person's switch marked failover · M14 any cause switches · M15 no epoch stamp · M16 an answered run resent ·
M17 stop at the first unresolvable target · M1b an epoch past the history accepted — all red (rerun after the review
fixes). M5, M12, M14, M17 survived first and got their own criteria; M18 (a skills precheck) could not be shown red and
the precheck was removed (applyAgentSwitch's own refusal is booked instead).

Defects found on the way: ordering switches by the id-sorted `lineageRunIds`, then by claim ordinal (a continuation
resets it to 1; independent review Important 1) — fixed by the epoch stamp; the pass resending an answered run at a later
revision (`command-id-conflict` thrown out of `systemDebugPass`) and booking transient resolution failures (Important 2);
a stale history surviving re-confirm (Important 3). A first criterion asserted a view field that does not exist and could
never be red (typecheck caught it).

## Review

Independent review (ecc:code-reviewer, read-only) of the first version: Important 1–3 above, fixed. Minors left as found:
`retry-task` is `any` actor (humanOnly.ts), so an agent token can pick the installation and stamp provenance `task`
(locks the task against failover) — for the human; the rest scan reads every quota/succeeded run each pass with a
candidate; a concurrent success on the same installation after the quota failure ends its rest early; a vendor-named
reset has no cap.

## Not built (registered)

- Dispatch-time routing of a not-yet-started task whose installation rests (spec §3 Route): a task is switched only after
  its own run hit the wall.
- Single calls (clarify/split/estimate, spec §4) and flow calls (D5) do not fail over yet.
- No scheduler wake at the earliest `until`, no panel text ("codex is out of quota until …"), no agents-page rest view.
- A `recovery-blocked` refusal is not booked by the command ledger, so such a failover is re-attempted every pass
  (resolution and the refusal again; no switch happens).
- Reset-time shapes other than the two codex ones fall back to the default rest; claude's reset text is not parsed.
- Paid acceptance (spec §7 step 3, a real codex quota hit routed to claude) not run: it needs an exhausted account.

## As built — addendum 2026-11-06 (session 3cfc2e73, batch FB, branch `feat/failover-ui` from main `e783beee`)

Who: Claude Code (Opus 5.5). Closes three items of "Not built (registered)" above; the rest of that list stands.

- **Wake at rest expiry: not built as a timer (by decision).** The pump already runs `systemDebugPass` every
  `--control-wake-ms` (default 5 s), and `failoverPass` reads the rests at the store's clock, so a candidate whose targets
  all rested is switched on the first pass after a rest ends without any other event (existing criterion "waits while the
  other installation rests, and switches back once its rest ends"). Spec correction appended (§ "no separate scheduler wake").
  Still open: a quota-failed task whose only installation is its own is not retried on it when its rest ends (unless the
  person set a quota wait) — retry routing, left to the failover-dispatch batch.
- **Panel text.** The run view carries `quotaRest {installation, until, source}` when the run is its task's current run,
  is terminally failed with cause `quota` (a switch retries the task and settles the run, so a switched run has none), and
  its installation rests (`installationRests` at the store's clock). The run reason (group task table, run list, task page)
  says "codex is out of quota until <time>." for a vendor-named reset, "codex is resting, retry around <time>." for the
  default rest (en/zh).
- **Agents page rest view.** `GET /api/control/agents` adds `rests [{installation, until, since, source, detail}]` for the
  listed installations resting now (omitted when none rests, so the old shape is unchanged); `InstallationRest` gains
  `since` (the streak's first quota failure) and `detail` (the CLI's text of the last). The agents page lists them under
  "Quota rests", read-only.
- **D7 web display** (not part of the failover plan, same batch): the run reason renders the run diagnosis's
  `formatFailureWork` — each attempt ref, its commit, files and diff stat, refused issues, and "see it: git diff <base> <ref>".

## Addendum 2026-11-06 — batch FA (session 3cfc2e73, branch `feat/failover-dispatch` on `e783beee`)

Who: Claude Code (Opus 5.5), implementation agent of Orca session 3cfc2e73. The sections above are kept as written; this
one adds what was built after them and corrects one line of "Not built". Human rulings (session 3cfc2e73): the failover
deviations above 「同意」; retry-task agent permission 「想要增加被授权的 agent 的能力，可以不止是人才允许。」 then, on the
proposal (authorized agents may switch; an agent's switch locks like a person's and names who switched; a person unlocks
with `--agent auto`), 「同意按你的建议走」.

Built:

1. **`retry-task --agent auto`** (`4f518165`). `agent: "auto"` in the payload (no new field; an installation named `auto`
   can no longer be named there) hands the choice back to orca-auto: the task's installation resting and not set to wait
   ⇒ the first `failoverTargets` entry ccloop resolves now; else a locked task (provenance `task`, `group`, `*-plan`) stays
   on its installation with provenance `failover`; a task already switchable and not resting is retried as it is. Recorded
   as a switch with reason `auto`. Found on the way: the switch record's `by` was `command.actorId`, which the control
   routes set to the panel operator for every principal, so an agent's switch and a person's read the same; `by` is now
   the routed principal (`agent:<client>`, `user:<id>`), else the actor. A run Orca dispatched is refused `retry-task`
   with `agent` (`control-dispatched-run-refused`); before this nothing refused it (the review minor above said any
   principal could). The agent's switch keeps provenance `task`, so it locks as a person's does (D2).
2. **Dispatch-time routing** (`774879ec`, criteria `a852c806`), spec §3 Route for the task not started yet: before every
   start delivery (`createWebWakeHandlers`), `WebControlService.routeBeforeClaim` looks at the task the delivery would
   claim; no current run and an empty lineage, its installation resting and not set to wait, provenance switchable, group
   as failoverPass's (`isFailoverGroup`) ⇒ switched as orca-auto to the first resolvable failover target in one
   transaction that re-reads the task, re-issues the confirmed snapshot and records the switch (reason `rest`,
   `afterRunId` null). No ledger command and no activity row (a new activity kind is a `web/` change, left to batch FB).
   A task that has run stays failoverPass's.
3. **Correction to "Not built"**: "A `recovery-blocked` refusal is not booked by the command ledger, so such a failover is
   re-attempted every pass" is wrong for the refusal the retry itself gives. Measured on `a852c806` in a clone before any
   change: a failover whose work item disagrees with its run is answered `recovery-blocked:retry-identity`, booked 423
   under `orca-auto-failover-<task>-<run>` (`recovery-blocked` is in `errors.ts` `durableCommandErrorStatuses`), and the
   next pass leaves the run. Nothing built; a criterion pins it (`5f2c6179`). Only an error thrown before the ledger (e.g.
   `panel-draining` from the admission gate) is not booked, and that one is meant to be tried again.
4. **Claude's reset time and a cap** (`388d212d`): `Claude AI usage limit reached|<unix seconds>` is read (evidence: magpie
   `internal/gateway/routing.go` `resetsWords`; ccloop's fixture `tests/runtime/failureCause.test.ts`); **no real claude
   sample on this machine**. Every named reset is trusted at most `REST_VENDOR_CAP_MS` = 24 h past the failure (review
   minor "a vendor-named reset has no cap").

Criteria (`tests/control/quotaFailover.test.ts`, 22 cases, 10 new) and mutations, each in a `git clone --local` copy,
`git diff` and `git diff --cached` 0 bytes after every restore: A1 auto may not keep the installation · A2 `by` is the
actorId · A3 auto never takes a target · A4 unlock keeps the provenance · A5 auto always unlocks · A6 no dispatched-run
refusal · A7 auto payload refused as unresolved · A8 reason `auto` dropped · R1 the wake handler skips the route · R2 a
plan pin routed · R3 rests ignored · R4 quota wait ignored · R5 a task that has run routed (survived first: the
transaction's re-read covered it; criterion "ccloop is asked nothing" added) · R5b the re-read's not-started check dropped
· R6 any group · R7 the switch not applied · R8 reason `quota` · R9 the re-read always bails · B1 `recovery-blocked` out of
the durable outcomes (first tried on the `errors.ts` code list at the bottom, which is not the one booking reads: survived)
· B2 an answered run not skipped · C1 claude's shape not parsed · C2 seconds read as ms · C3 eleven digits accepted · C4 no
vendor cap — all red.

Still not built: routing a retried task (one with a run) on a resting installation before its claim (failoverPass handles
it after its own quota failure); single calls and flow calls (D5); the panel text, the agents-page rest view and the
scheduler wake at the earliest `until` (batch FB); paid acceptance.
