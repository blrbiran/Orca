# Issue Fixes (2026-10-08) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the root causes behind issues 1, 3, 7, 8, 10, 15 and 16 of the 2026-10-08 local deployment: explained
refusals, a shutdown that no longer strands idle groups, retrying failed tasks, wall-clock activity, and a group list and
graph that show what is happening.

**Architecture:** Server changes in `src/control` (plan import, shutdown, recovery, a new `activity` table at schema 9,
`retry-task`, archive) and `src/panel` (views, routes), surfaced through `src/control/webProtocol.ts` to the React panel
in `web/src`. Each part is independently testable; later parts consume the interfaces fixed in "Shared interfaces".

**Tech Stack:** TypeScript, Node, SQLite (better-sqlite3 via the control store), zod, Express, React, vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-issue-fixes-design.md` (and, for issue 15, ccloop's
`docs/superpowers/specs/2026-10-08-codex-phase-output-hardening-design.md` with its own plan in the ccloop repo).

Plan authorship: Orca session `e34dc963` (controller) with one plan-writing subagent per part; parts are in
`docs/superpowers/plans/2026-10-08-issue-fixes/part-{A..F}.md`. Progress ledger:
`.superpowers/sdd/2026-10-08-issue-fixes/progress.md` (force-added).

## Order

| Part | Spec | Content | Depends on |
|---|---|---|---|
| A | §2 | refusal explanations, plan issue lists, per-group refusals, docs | — |
| B | §5 | store clock, run times, `activity` table, schema 9, views and route | — |
| C | §3 | shutdown `unchanged-idle`, recovery healing, resume dialog and stop banner, errata | B |
| D | §4 | ccloop stop reason, `retry-task`, `settled-failed`, `run-terminal-failed`, erratum | A, B |
| E | §6 | categories, summary fields, archive, group cards and filters, graph | A, B, D |
| F | §7, §9 | ccloop re-pin (after the human pushes ccloop), final gate, review, ledger, handoff | A–E |

Execute strictly in this order, task by task inside each part.

## Global Constraints

- Control store schema version becomes `"9"`; the migration is one-way (spec H5).
- `targetVersion` stays required; no default (spec H1).
- Plan-rejection items are separated by `\n` (spec §2.2(b)).
- Activity retention: newest `500` rows per group; group view shows newest `50`; run route returns newest `200` (spec §5.2).
- "No progress" hint threshold: `10` minutes since the current run's `lastActivityAt` (spec §6.5).
- Bounded `stopReason`: first `500` UTF-16 units (spec §4.2(1)).
- New error codes and HTTP statuses: `task-not-retryable` 409, `run-terminal-failed` 409, `group-archived` 409,
  `archive-run-active` 409, `archive-stop-pending` 409, `archive-integration-resolving` 409, `archive-call-in-flight` 409; existing
  `group-reserve-insufficient` reused with `<dimension>:<shortfall>` detail.
- New verbs: `retry-task`, `archive-group`, `unarchive-group`, all access `any`.
- Code, comments, tests, ledger: English. Chinese only in `web/src/locales/zh.ts` and `docs/handoff/**`.
- No criterion writes to the real `~/.orca` (Rule 17); mutations only in a `git clone --local` copy under the session
  scratchpad (Rule 15); verification output redirected to a file and read whole (Rule 14).
- `git add` explicit paths only (`node_modules` and `web/node_modules` are untracked symlinks in the worktree).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

Inputs the spec implies that per-part tests could miss; each has a test assigned below.

1. **A store already stranded by an older Orca** (v8, empty-frozen-set shutdown rows, runs without `startedAt`):
   after upgrade the first start must migrate, heal, and the views must render "—" times. Test: Part C adds a criterion
   that builds a v8 store with such a row and a pre-v9 run, opens it through the normal store open, runs recovery, reads
   the group view, and presses `start`.
2. **Retrying the same task more than once** (run 3) and running out of reserve on the second retry. Test: Part D adds
   a criterion with two consecutive failures and retries, asserting run number 3 and an exact
   `group-reserve-insufficient` detail when the reserve is short.
3. **A plan with many problems, and task ids or zod messages with non-ASCII text or commas.** Test: Part A's
   five-problem criterion uses a task id with a non-ASCII character and a zod message containing a comma; the web decode
   test feeds the same detail.
4. **A wake or continuation queued before archiving.** Test: Part E adds a criterion that queues a start wake and a
   continuation wake, archives the group, then delivers both wakes and asserts no claim is made.
5. **English viewer with a code that has no entry, and dark theme colours.** Test: Part A asserts the English fallback
   shows the server message beside the code; Part E asserts every category colour token is defined for both themes.

## Shared interfaces

Fixed before the parts were written; every part uses these names. Copied from the controller's brief:

- `src/control/activity.ts`: `ActivityKind`, `ActivityRow`, `recordActivity(store, row)`, `ActivityEntry`,
  `readGroupActivity(store, groupId, limit)`, `readRunActivity(store, runId, limit)`,
  `latestGroupActivityAt(store, groupId)`; `ControlStore.now()`; run body `startedAt?`, `endedAt?`.
- `web/src/locales/en.ts` `enErrors`; `zhErrors`; placeholders `{{message}}`, `{{status}}`, `{{detail}}`;
  `web/src/refusalExplain.ts`: `explainRefusal(refusal)`, `explainRunReason(reason)`.
- Drive record `stopReason?`; run view `stopReason`; run state `"settled-failed"`; verb `"retry-task"` with payload
  `{ taskId }`, result kind `"task-retried"`.
- Verbs `"archive-group"`, `"unarchive-group"`; `src/control/workItemCategory.ts`: `WorkItemCategory`,
  `workItemCategory({ status, currentRunBlocked, dependenciesDone })`.

## Parts

- [Part A — Refusals](2026-10-08-issue-fixes/part-A.md)
- [Part B — Activity record and run times](2026-10-08-issue-fixes/part-B.md)
- [Part C — Shutdown stop-intent lifecycle](2026-10-08-issue-fixes/part-C.md)
- [Part D — Failure reason and retry-task](2026-10-08-issue-fixes/part-D.md)
- [Part E — Categories, summary, archive, list and graph](2026-10-08-issue-fixes/part-E.md)
- [Part F — Re-pin, final gate and closing](2026-10-08-issue-fixes/part-F.md)
