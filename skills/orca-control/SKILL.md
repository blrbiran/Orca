---
name: orca-control
description: Use when operating Orca from an agent — reading task groups, opening requirements, answering clarifications, confirming or starting work, retrying failed tasks — through the `orca <domain> <action>` CLI (or the `orca` MCP tool) against a running panel.
version: 0.1.0
---

# Operating Orca

Orca runs plans of tasks with coding agents and records every choice in a decision ledger. A **group** is a task plan
with its budget and history; a **task** is one planned unit of work; a **run** is one attempt at a task; a
**requirement** is a group while an idea is clarified and split into tasks. A **panel** (a local service) owns all of
it; you talk to it with `orca <domain> <action> [ids] [--flags]` (in this checkout: `node_modules/.bin/tsx src/cli.ts`),
or with the MCP tool `orca`, whose `args` are the same words. `orca help [<domain> [<action>]]` prints any command.

## Core rules

1. **Never start, stop or restart the panel or its service** (`orca panel …`, `orca user …`): a person does that. If
   `orca status` says the panel is not answering, report it and stop.
2. **Read state, not command acceptance.** A 2xx answer means the panel booked the command, not that the work is done.
   Read the group again and act on what it shows.
3. **Long work is polled.** Runs take minutes to hours: after `group start` or `task continue`, run `orca group show <g>`
   every 30–60 s. A confirmed group starts on its own when a slot is free; `group start` is only for `confirm --hold`.
4. **Pins are filled for you.** Each write reads the current revision, hashes and versions itself, in the same
   invocation, and sends them. When your action rests on something you read *earlier* (not just now), pass
   `--if-revision <n>` with the revision from that read: a stale one answers `revision-conflict`, and then you read
   again and decide again — never just bump the number. `proposal replace` always needs `--if-revision`.
5. **Keep the command id.** With `--json` every write prints `commandId`. If the answer carries `request` the outcome is
   uncertain (timeout, dropped connection, `retryable: true`): save that JSON and run `orca command retry --request -`
   with it on stdin. It looks the id up first and resends the exact bytes only on a confirmed miss. Never re-run the
   command with a new id.
6. **Some actions are a person's.** Commands marked *person token* (budget limits, spend caps, applying an agent
   update, settling unknown usage, sending work somewhere new) are refused with `control-person-token-required`. Do not
   look for a way around it: ask the person (they run `orca login` and the command with `--as-person`). A run Orca
   dispatched is refused those and more (`control-dispatched-run-refused`).
7. **Parse `--json`.** One line: `{schema:"orca-cli-response-v1", status, commandId?, body, request?}`. Exit 0 = 2xx,
   1 = refused here before sending, 2 = the panel refused (`body.error.code` names why), 3 = crash.

## I want to …

| I want to … | Run | Reference |
|---|---|---|
| see whether Orca is up and healthy | `orca status` (then `orca doctor`) | references/basics.md |
| see the projects, groups and their state | `orca project list`, `orca group list`, `orca group show <g>` | references/project.md, group.md |
| turn an idea into a task plan | `orca requirement open --idea "…"`, then `requirement show / answer / consensus / accept` | references/requirement.md |
| get one more clarification round, or set the class | `orca requirement continue <g>`, `orca requirement classify <g> …` | references/requirement.md |
| import a plan file as a group | `orca project register-plan <path>`, then `orca group import <plan>` | references/project.md, group.md |
| review or edit the proposal (budgets, agents, tasks) | `orca proposal show <g>`, `proposal set-budget / set-agent / replace` | references/proposal.md |
| get budgets estimated, then confirm | `orca group estimate <g>`, `orca group confirm <g> [--hold]` | references/group.md |
| start, pause, resume or stop a group | `orca group start / pause / resume / stop-handoff / resume-handoff <g>` | references/group.md |
| find out why a run failed | `orca run show <r>`, `run activity`, `run evidence`, `run eligibility` | references/run.md |
| retry or continue a task | `orca task retry <g> <t>`, `orca task continue <g> <t>` | references/task.md |
| change a task's loop or labels | `orca task set-loop <g> <t> --file …`, `orca task set-labels …` | references/task.md |
| make one group wait for another | `orca group depend <g> --on <other>` | references/group.md |
| decide a pending or flagged decision | `orca decision list <g>`, `decision approve / reject / ratify <g> <id>` | references/decision.md |
| record, close or withdraw a correction | `orca correction record / close / withdraw / debug` | references/correction.md |
| see agents and models; set preferences | `orca agent list`, `orca agent models <i>`, `orca agent set-preferences` | references/agent.md |
| see spend | `orca usage show` | references/usage.md |
| see or change how many groups run at once | `orca orchestration show / set` | references/orchestration.md |
| see what blocks dispatch, or retry recovery | `orca recovery list`, `orca recovery retry` | references/recovery.md |
| look up what happened to a command id | `orca command show <id> --group <g>` | references/command.md |
| check a plan or a ledger without the panel | `orca plan preview <path>`, `orca decision validate <path>` | references/plan.md, decision.md |
| understand an error code or an exit code | — | references/error-codes.md, output-and-exit-codes.md |
| fix something that went wrong | — | references/troubleshooting.md |
| do something no command covers | `orca control get` or `orca control send` (raw) | references/escape-hatch.md |

Ids: a full id or a unique prefix; projects also by name or path (default: the registered repository holding cwd,
`--project` to choose). An ambiguous prefix is refused with the candidates listed.

## Before a write

- Read what you are about to change (`group show`, `proposal show`, `requirement show`) and decide from that read.
- A confirm binds the plan, profiles and agent selections exactly as shown now; read `proposal show` first.
- A failed run: report the recorded phase, typed cause, raw code and run/attempt ids from `run show` /
  `run activity`; never infer token exhaustion from a decode error, and never claim a provider completed because a
  command was accepted.

## Escape hatch

`orca control get <path>` / `orca control send <route> …` (hidden from `orca help`) talk to the socket directly and
fill nothing for you. Use them only for what no command covers; the route table and their rules are in
references/escape-hatch.md.
