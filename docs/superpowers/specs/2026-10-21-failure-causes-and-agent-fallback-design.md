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
