# Failure-cause vocabulary, transient retries and agent fallback — design

- **Author:** controller of Orca session `308b874c` (2026-10-21), from a brainstorming conversation with the human.
- **Status:** design; not yet planned. Spans ccloop (classification, in-run retries) and Orca (consumption, fallback,
  notification). The ccloop part needs its own ccloop spec mirroring §3–§4 (ccloop's rules, Orca Rule 16).
- **Inspiration:** multica `server/pkg/taskfailure/failure.go`, `internal/service/task.go:5260-5340`
  (ideas only — source-available license).
- **Related:** kanban/orchestration spec §6 (escalation ladder); activity-watchdog decision (ledger: idle stop ⇒ `stalled`).

## 1. Intent
Today a run's failure reaches Orca as a free-form `failureCode`/`blockedReason` string and a person presses Retry.
Transient provider trouble (rate limits, 5xx, network blips, a stalled process) should be retried automatically;
problems that won't fix themselves (auth, quota) should switch to another agent when one is configured, and the person
should be told — without stopping other work (goal.md §1.4).

Human (this session): on quota exhausted or auth failure with an alternate agent configured — "切备选agent，但是需要通知人。并且加一个选项：额度用尽不切备选agent".

## 2. Goals / non-goals / anti-goals
**Goals:** one typed failure-cause vocabulary produced by ccloop; automatic bounded retries for transient causes inside
ccloop; Orca shows each cause with a "what to do next" line; Orca switches to the role's alternate agent on auth/quota
failures and notifies the person; an option to wait for quota instead of switching.
**Non-goals:** classifying task-quality failures with a model; retries across providers inside ccloop.
**Anti-goals:** an automatic retry that spends money on a cause that cannot succeed (auth/quota); a retry loop without a
cap; matching on provider wording so loosely that misclassification is common (prefer "unknown" over a wrong class).

## 3. Vocabulary (ccloop produces, Orca consumes)
`auth` (401/invalid credentials) · `quota` (402/insufficient credits/plan limit) · `rate-limited` (429) ·
`provider-5xx` · `network` (connection reset, DNS, TLS, timeout before first byte) · `context-overflow` ·
`stalled` (activity watchdog) · `executable-missing` · `required-check-failed` · `verifier-rejected` ·
`budget-exhausted` · `unknown`.
- Classification is code over observed signals (exit status, stream error events, HTTP status where the CLI reports it,
  known message patterns per agent kind), with must-match and must-not-match sample sets per pattern (Rule 9).
- The cause is a field next to today's codes (wire-compatible; Orca's strict parsers get one optional field — ccloop
  dependency list must be updated, Orca Rule 16).

## 4. Transient retries (inside ccloop)
- `rate-limited`, `provider-5xx`, `network`, `stalled`: retried automatically, **at most 3 times per phase**, with
  backoff (30 s, 60 s, 120 s — reuses the existing codex 429 backoff shape), within the phase deadline. Usage of failed
  tries is booked as today.
- These retries do **not** count toward the escalation ladder's 2 extra runs (kanban spec §6); the ladder handles
  "the task itself didn't get done".
- `auth`, `quota`, `executable-missing`, `context-overflow`: never retried by ccloop; the run ends with that cause.

## 5. Orca: next-step text, fallback, notification
- Each cause has a one-line "what to do next" (en + zh) shown on the card, Results and Troubleshooting.
- **Fallback:** on `auth` or `quota`, if the agents table/profile names an **alternate agent for that role**, Orca
  re-dispatches the task on the alternate (reusing the ladder's re-dispatch mechanics, not counted as a ladder level)
  and posts a **notification** (a non-blocking attention item: "<agent> <cause>; switched to <alternate>").
- **Option "on quota exhausted, wait instead of switching"** (per installation, default off): the agent's queued work
  pauses until the quota reset time the agent reported (if any) or a fixed re-probe interval; other groups continue; the
  person is notified once.
- `auth` always switches when an alternate exists (waiting does not fix credentials). No alternate configured ⇒ needs-you
  for that task only.
- How "alternate agent for a role" is configured is shared with kanban spec §9 (left to the builder there); one place.

## 6. Left to the builder
Pattern lists per agent kind; where the option and alternates live; re-probe interval default (controller suggests 30 min);
the notification surface (reuse attention items).

## 7. Open
Whether `context-overflow` should trigger an automatic re-dispatch with a larger window (needs #70's declared windows).

## 8. As-built, Orca side (session 9ec98639, 2026-10-21; controller's calls, reversible)

What landed (ccloop side: ccloop specs `2026-10-21-failure-causes-and-transient-retries-design.md` and
`2026-10-21-activity-watchdog-design.md`, ccloop main `e43f2a3`):

1. **Wire (§3).** Orca's strict collect parse accepts ccloop's optional top-level `failureCause {cause, phase, retries,
   detail}` (`src/control/ccloopPort.ts`; schema `runFailureCauseSchema` in `src/control/schema.ts`). `cause` is a bounded
   string, not a closed enum: a cause a newer ccloop adds reads as itself and the panel words it as `unknown` (adding a cause
   is no wire break; renaming or removing one is). `detail` is kept to 512 units. The port also maps the terminal's last
   `recentFailures` entry onto the report as `lastFailure` (ccloop priorFailures spec §3). The driver stores both on the
   drive record when a run blocks at C (`failureCause`, `lastFailure`, optional fields). Landed ahead of the repin (they are
   optional, so the 71d650c pin still parses); the repin itself waits for the human to push ccloop.
2. **Next step (§5).** Each cause has a label and a one-line next step, en and zh (`web/src/locales/*.ts`
   `control.failureCause`), shown by `RunReason` before the diagnosis wherever a run's reason is shown (group view work
   table, run list, results, task detail), with "after N automatic retries" when ccloop retried. The board card's first
   failure prefers the typed cause and words it; any other string (an Orca reason, an unknown cause) stays as written.
3. **The ladder leaves environment causes to the person.** `auth`, `quota` and `executable-missing` are not escalated
   (`LADDER_EXEMPT_CAUSES`, `src/control/systemDebug.ts`): a debug run cannot fix credentials, quota or a missing program and
   would fail the same way at the same cost. Such a task stays blocked — needs-you for that task only (kanban spec §3.4).
   The ladder's facts now include the cause and the last rejection.
4. **Quota wait (§5 option).** Lives in the orchestration settings (`set-orchestration-settings` gains optional
   `quotaWait: string[]`, installation ids, stored sorted and unique; omitted keeps the stored list). Default: empty, i.e.
   off for every installation. For an orchestrated group's task whose current run ended with cause `quota` on a listed
   installation, Orca sends `retry-task` as `orca-auto` once the run's last activity is ≥ 30 min old
   (`QUOTA_REPROBE_MS`); command id `orca-auto-quota-retry-<task>-<run>`, so each failed run is retried at most once and a
   repeated quota failure waits again. The retry is the re-probe (ccloop reports no reset time today). API only — no panel
   control yet (as the criteria-review switch).
5. **Not built: switching to an alternate agent (§5 "Fallback").** Deferred, with the reason: an agent switch after
   confirmation changes the frozen selection, and the confirmed execution snapshot is the authority for it (agent selection
   spec §6.4 step 4, §12 I3 — `readConfirmedTaskExecution` refuses a work item whose frozen agent differs from the
   snapshot's; retry-task and saved-result recovery compare the run's and the work item's frozen agent). Doing it needs an
   **agent amendment** record (hashed, like loop task amendments in `src/control/taskAmendments.ts`, read through the
   snapshot check), a re-resolution of the alternate through ccloop (new configHash, timeoutMs, capabilities — and an
   estimate made for the old window may no longer fit), and the "alternate agent for a role" configuration (none exists).
   That is a design round, outside this session's ruling ("先不做需要brainstorm的工作"). Until then an auth/quota failure is
   needs-you (or a quota wait); the person fixes the agent (log in, add credits) and retries the task.
6. **Notification.** No separate attention item: a blocked task is already needs-you, and its run reason now carries the
   cause and next step. A one-time "<agent> <cause>; switched to <alternate>" notice belongs with item 5.
