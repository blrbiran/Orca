# From state to next action

Read this when opening a requirement, importing a plan, or deciding what to do after a group stops progressing. Commands report accepted requests; only a later read establishes that work finished. Use `--json` when making automated decisions, and inspect `body.error.code` on refusal. See [troubleshooting](troubleshooting.md) for transport errors and [command help](../SKILL.md) for permissions.

## Start with an idea

1. `orca project list`, then `orca requirement open --idea "…" --agent <installation>` if no estimator preference is selected. Check `orca agent list` first; `--agent` is optional when a working preference exists.
2. `orca requirement show <g>`; answer questions with `requirement answer`, request another round with `requirement continue` if needed, then use `requirement consensus`. Inspect the proposed split before `requirement accept`.
3. Check each task's `targetPaths` (or `writes[].targetPaths`) against its `checks`: can this task repair a failed check using files it may write? A documentation-only task cannot repair an already failing repository test in unrelated source. A green repository test may be kept as a guard. If the split is wrong, use `requirement feedback` to request a correction before accepting.
4. `orca proposal show <g>` and `orca group show <g>` expose agents and budgets. `orca group estimate <g>` is optional; if used, wait for a ready answer, then `orca group apply-estimate <g> --dry-run` and `orca group apply-estimate <g>`. An estimate alone does not change grants. The default may be unlimited; read that explicitly before confirming. An agent may lower the group token ceiling with `orca group cap <g> --tokens <n>` when an editable proposal exists; raising or removing it needs the person.
5. `orca group confirm <g>` starts when a slot is free; `--hold` confirms without starting. Poll `orca group brief <g>` every 30–60 seconds after start, then read `group show` and the relevant run for details. `done` means no new estimate or confirm is needed.

## Start with an existing plan

`orca project register-plan <path>` if the plan is not yet registered, then `orca group import <plan>`. Inspect `orca proposal show <g>` and set missing agents through `orca proposal set-agent` before confirmation. The estimate, cap, confirmation and polling steps above apply. Folder and multi-directory projects do not take plan import; start with a requirement there.

## State → read → next

| Observed state | Read | Next action |
|---|---|---|
| `clarifying` | `orca requirement show <g>` | Answer, continue, revise or approve consensus according to the current round; inspect the split before accept. |
| `draft` | `orca proposal show <g>` and `orca group show <g>` | Resolve agent selection, inspect grants and checks; optionally estimate then apply; confirm only after reviewing the displayed defaults. |
| `ready` | `orca group brief <g>` | A non-held group starts when a slot is free; a held group needs `orca group start <g>`. Respect dependency and slot blockers. |
| `running` or `review` | `orca group brief <g>`; for a problem, `orca run show <r>` | Wait for progress, or use the recorded reason and run evidence to choose a remedy. A review group's justified/restored verdict can be complete even when its underlying task shows `empty-result`. |
| `blocked` or a failed run | `orca group show <g>`, `orca run show <r>`, `orca run eligibility <r>` and `orca recovery list` | Follow the typed reason below. Do not automatically retry a `blocked_waiting_human` run or accept an empty result. |
| `done` or `archived` | `orca group show <g>` | Inspect results or the linked criteria-review group; do not re-estimate or reconfirm completed work. Unarchive only when the person wants the group back. |

## Error or reason → evidence → action

| Error or reason | Inspect | Action |
|---|---|---|
| `agent-selection-rejected` / `estimator:agent-unselected` | `orca agent list`, `orca agent preferences` | For a new requirement choose `--agent <installation>` (with exactly one installation and no defaultAgent, `requirement open` picks it); for an imported draft use `orca proposal set-agent`. A missing capability needs a capable installation, not a blind retry. |
| `estimate-blocked-capability` or an estimate not ready | `orca group show <g>`, estimator reason and `orca agent models <installation>` | Correct the selected agent/capability or ask a person; do not repeatedly estimate the same blocked version. The optional unestimated default remains visible if confirmed without an estimate. |
| `empty-result` | `orca run show <r>`, `orca run results <r>`, and the group's criteria-review verdict | A justified/restored judge is already represented as done. For ordinary work the attempt changed no file, so nothing landed; it cannot be retried or accepted in this group (`task retry` refuses a finished run, `task accept-attempt` an empty one). If no change was needed, set the task's `verification.commandChecksDecideGoal` (or the loop plan's input) in the plan and run it in a new group (`orca group import`); if a change was needed, say in the task what to change and run it in a new group. Do not mark work completed merely because the run exited. |
| `blocked_waiting_human` / observed path misses | `orca run show <r> --group <g>` | Read [observed-path retry](observed-path-retry.md). Only typed Git-observed misses can justify `orca task retry <g> <t> --allow-observed-paths`; otherwise ask the person. |
| `exhausted` / saved result | `orca run eligibility <r>` and `orca run show <r>` | An eligible completion source may be verified using the authorized saved-result path and fresh funds. A historical run without a capsule or an OMP malformed final is not made recoverable by an attempt ref alone. |
| `terminalRuns` in `orca recovery list` | Its `next` step, usage and stop proof | If it says `settle-usage`, settle unknown usage first: `orca task settle-usage <g> <t> --acknowledge charge-remaining-grant` (or `release-known-zero` when proved, or `charge-observed-floor` to book only ccloop's observed floor as approximate usage when the remainder is finite and a floor is known) needs no person token; `release-unmetered` is the person's. If it says `close-run`, `orca group close-run <g> --run <r>` closes accounting; it does not accept the work. Then retry or archive as allowed. |
| `blockedRuns` in `orca recovery list` | Its `blockedAt`, `reason` and `orca run show <r>` | A run blocked where it is not a ccloop failure (before any provider call at A1/A2, or at a later step): run its `next`, `orca recovery retry --run <r>`, which puts it back at that step. A continuation whose stopped run has no complete checkpoint starts afresh there. |
| `revision-conflict` or uncertain `request` | `orca group show <g>` or `orca command show <id> --group <g>` | Re-read and decide again for a revision conflict. For an uncertain command, resend only its saved request with `orca command retry --request -`; do not invent a fresh command id. |

For any other code, use [error codes](error-codes.md) and [troubleshooting](troubleshooting.md). A dispatched Orca run may be refused actions available to an ordinary CLI operator; report the refusal rather than bypassing it.
