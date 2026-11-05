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
