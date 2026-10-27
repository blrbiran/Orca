---
name: orca-control
description: Use when operating Orca from an agent — reading task groups, opening requirements, answering clarifications, confirming or starting work, retrying failed tasks, running or steering flows and schedules — through the `orca <domain> <action>` CLI (or the `orca` MCP tool) against a running panel.
version: 0.1.0
---

# Operating Orca

Orca runs plans of tasks with coding agents and records every choice in a decision ledger. A **group** is a task plan
with its budget and history; a **task** is one planned unit of work; a **run** is one attempt at a task; a
**requirement** is a group while an idea is clarified and split into tasks; a **flow** is a fixed sequence of steps
(some model calls, some effects outside Orca) run on a folder. A **panel** (a local service) owns all of it; you talk
to it with `orca <domain> <action> [ids] [--flags]` (in this checkout: `node_modules/.bin/tsx src/cli.ts`), or with the
MCP tool `orca`, whose `args` are the same words (`dev` is refused there). `orca help [<domain> [<action>]]` prints
any command; `orca version` should equal this skill's version.

## Projects

- A **repository project** lands finished work on `orca/<groupId>`; its integration scheme decides what follows, and
  the default `keep` merges and pushes nothing.
- A **folder project** (`kind: "dir"`) takes requirements and flows only: plan import, debug opens and an integration
  scheme are refused, and finished work is written into the folder file by file.
- A **multi-directory project** takes requirements only: plan import, flows, debug opens, continuation and saved-result
  recovery are refused; each member lands by its frozen delivery, never `push-branch` or `github-pr`.

## Core rules

1. **Never start, stop or restart the panel or its service.** `orca panel install|uninstall|start|stop|restart|status|logs` are the human's (`status` and `logs` only read it; the others change the running service). Never run them; ask the human.
   `orca user …` is a person's too. If `orca status` says the panel is not answering, report it and stop.
2. **Read state, not command acceptance.** A 2xx answer means the panel booked the command, not that the work is done.
   Read the group (or the flow run) again and act on what it shows.
3. **Long work is polled.** Runs take minutes to hours: after `group start`, `task continue`, `flow start` or
   `flow rerun`, run `orca group show <g>` / `orca flow show <r>` every 30–60 s. A confirmed group starts on its own
   when a slot is free; `group start` is only for `confirm --hold`.
4. **Pins are filled for you.** Each write reads the current revision, hashes and versions itself, in the same
   invocation, and sends them. When your action rests on something you read *earlier* (not just now), pass
   `--if-revision <n>` with the revision from that read: a stale one answers `revision-conflict`, and then you read
   again and decide again — never just bump the number. `proposal replace` always needs `--if-revision`.
5. **Keep the command id.** With `--json` every write prints `commandId`. If the answer carries `request` the outcome is
   uncertain (timeout, dropped connection, `retryable: true`): save that JSON and run `orca command retry --request -`
   with it on stdin. It looks the id up first and resends the exact bytes only on a confirmed miss. Never re-run the
   command with a new id.
6. **Some actions are a person's.** Group limits, spend caps and the usage calendar, applying an agent update,
   settling unknown usage, where a project's or group's work is carried, folder and multi-directory landing answers,
   check and flow settings and their locks, re-running or answering a flow, its effects and its pool, plan-library and
   schedule writes, orchestration limits, group dependencies and corrections are refused
   (`control-person-token-required`). Do not look for a way around it: ask the person (they run `orca login` and the
   command with `--as-person`). A run Orca dispatched is refused even some open verbs (`control-dispatched-run-refused`,
   e.g. `flow start`).
7. **Parse `--json`.** One line: `{schema:"orca-cli-response-v1", status, commandId?, body, request?}`. Exit 0 = 2xx,
   1 = refused here before sending, 2 = the panel refused (`body.error.code` names why), 3 = crash.

## I want to …

| I want to … | Run | Reference |
|---|---|---|
| see whether Orca is up and healthy | `orca status` (then `orca doctor`) | references/basics.md |
| see the projects, groups and their state | `orca project list`, `orca project show`, `orca group list`, `orca group show <g>` | references/project.md, group.md |
| turn an idea into a task plan | `orca requirement open --idea "…"`, then `requirement show / answer / consensus / accept` | references/requirement.md |
| get one more clarification round, revise a round or a draft, or set the class | `orca requirement continue / revise / feedback / classify <g> …` | references/requirement.md |
| import a plan file as a group | `orca project register-plan <path>`, then `orca group import <plan>` | references/project.md, group.md |
| review or edit the proposal (budgets, agents, tasks) | `orca proposal show <g>`, `proposal set-budget / set-agent / replace` | references/proposal.md |
| get budgets estimated, then confirm | `orca group estimate <g>`, `orca group confirm <g> [--hold]` | references/group.md |
| start, pause, resume, stop or archive a group | `orca group start / pause / resume / stop-handoff / resume-handoff / archive / unarchive <g>` | references/group.md |
| set a group's limit or where its work goes | `orca group set-limit`, `orca group set-integration`, `retry-integration`, `resolve-integration` | references/group.md |
| answer a stopped folder placement or multi landing | `orca group folder-change <g> --take-folder / --recheck / --withhold`, `orca group multi-land <g> --retry-rest / --mark-resolved` | references/group.md |
| make one group wait for another | `orca group depend <g> --on <other>`, `orca group undepend …` | references/group.md |
| find out why a run failed, or whether its result can be verified | `orca run show <r>`, `run activity`, `run evidence`, `run results`, `run eligibility` | references/run.md |
| retry, continue, verify a saved result or settle unknown usage | `orca task retry / continue / verify-saved-result / settle-usage <g> <t>` | references/task.md |
| change a task's loop or labels | `orca task set-loop <g> <t> --file …`, `orca task set-labels …` | references/task.md |
| decide a pending or flagged decision | `orca decision list <g>`, `decision approve / reject / ratify <g> <id>` | references/decision.md |
| record, close or withdraw a correction | `orca correction record / close / withdraw / debug` | references/correction.md |
| see agents and models; set preferences; apply an update | `orca agent list`, `orca agent models <i>`, `agent set-preferences`, `agent apply-update --accept` | references/agent.md |
| see spend; set a cap or the calendar | `orca usage show`, `orca usage set-cap / clear-cap / set-calendar` | references/usage.md |
| see or change how many groups run at once | `orca orchestration show / set` | references/orchestration.md |
| see what blocks dispatch, or retry recovery | `orca recovery list`, `orca recovery retry` | references/recovery.md |
| change the project's workspace, default delivery or criteria review | `orca project set-workspace-mode`, `project set-integration`, `project set-criteria-review` | references/project.md |
| see, set, schedule, lock or run a check | `orca check show / findings / set / schedule / lock / run / resume` | references/check.md |
| start a flow on a folder, or watch one | `orca flow settings show`, `orca flow start <template> --dir <dir>`, `flow list`, `flow show <r>`, `flow journal <r>` | references/flow.md |
| steer a flow run or its steps | `orca flow feedback / edit / plan / rerun / discard-plan / rewind / revise / params / pause / resume / stop / retry / repin` | references/flow.md |
| skip, defer, fill, include or accept a step; answer an ask; effects; pool | `orca flow skip / defer / fill / include / accept / answer`, `flow effect confirm / enact / discard`, `flow pool raise` | references/flow.md |
| keep, import, export or archive a plan in the library | `orca plan list / show / save / import / export / archive` | references/plan.md |
| schedule a flow or a pinned plan version | `orca schedule list / show / fires / add flow / add group / edit / enable / disable / remove / resume`, `orca group schedule <g>` | references/schedule.md |
| look up what happened to a command id | `orca command show <id> --group <g>`, `command retry --request` | references/command.md |
| check a plan or a ledger without the panel | `orca plan preview <path>`, `orca decision validate / metrics / compact-reviews` | references/plan.md, decision.md |
| understand an error code or an exit code | — | references/error-codes.md, output-and-exit-codes.md |
| fix something that went wrong | — | references/troubleshooting.md |
| do something no command covers | `orca control get` or `orca control send` (raw) | references/escape-hatch.md |

Ids: a full id or a unique prefix; projects also by name or path (default: the registered repository holding cwd,
`--project` to choose). An ambiguous prefix is refused with the candidates listed.

## Before a write

- Read what you are about to change (`group show`, `proposal show`, `requirement show`, `flow show`) and decide from
  that read.
- A confirm binds the plan, profiles and agent selections exactly as shown now; read `proposal show` first.
- A failed run: report the recorded phase, typed cause, raw code and run/attempt ids from `run show` /
  `run activity`; never infer token exhaustion from a decode error, and never claim a provider completed because a
  command was accepted.
- Verifying a saved result skips execution, but validation and verification may still spend model usage. A flow's
  `plan`, `rerun` and `include` spend too.
- A schedule fires on its own: a fired group either confirms itself (no token limit, no delivery scheme) or waits for
  the person, and a fired flow waits before any external or irreversible step.

## Escape hatch

`orca control get <path>` / `orca control send <route> …` (hidden from `orca help`) talk to the socket directly and
fill nothing for you. Use them only for what no command covers; the route table and their rules are in
references/escape-hatch.md.
