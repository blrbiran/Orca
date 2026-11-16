# Current draft and delivery-first results design

Status: feedback UI design, 2026-11-16; issues #324 and #319.

## User problem

A person reviewing a requirement sees obsolete split drafts before the actionable one. In a group's Results region, long lists of task and run evidence push Git delivery and its next action below the first screen. The objective is quicker scanning while keeping every historical artifact accessible.

## #324: split drafts

Display a sorted copy of `view.drafts` by descending `draftNo`; leave the server's order, draft hash and approval identity unchanged. The newest draft starts expanded, earlier drafts start closed behind native `<details>` summaries naming number, state and task count when output exists. An accepted older draft stays identifiable by its state. Expanding any historical draft restores its existing task table, layers, hints, feedback and evidence; one draft remains expanded. Do not invent a generation time: `DraftViewV1` does not carry one. An open details element must not unexpectedly close merely because the view polls with the same draft.

## #319: group Results

Move the existing integration/Git section to the beginning of Results so its work branch, target, status and retry/resolve controls are immediately visible. `GitScheme` keeps its human-readable scheme and status above a per-run commit table: when three or more task runs exist, hide that table behind a labeled disclosure; one or two runs keep their current presentation. Keep detailed run IDs and commit ids available within the disclosure, without fabricating a workspace path or a diff link not supplied by the API.

`GroupResults` keeps the group goal, coverage, review and delivery facts. For multiple tasks, show a short status and availability for each; open the first, blocked tasks, and any task with a failed saved verification by default; fold other completed tasks' saved-run evidence. A single task remains open so existing direct-result use is not disrupted. The history run buttons on the group page may be folded when several runs exist, but must remain keyboard-accessible and reachable from Results/Runs. Preserve review and failure warnings outside disclosures. No new request, server field or delivery promise is introduced: a group-trigger `local` scheme does not mean `main` has already advanced while tasks are running.

## Acceptance

Two or more split drafts show latest first with older drafts closed and inspectable; a single draft is open. Git/integration appears before the group result detail, and blocked integration's action remains visible. A group with multiple tasks and runs is compact without losing prior evidence. Existing themes, type scale, data tones, language parity and one-primary-button rule in `web/DESIGN.md` remain in force. Verify accessible disclosure names, expansion, command behavior, Web typecheck/build and Orca's daily affected-test gate. No real panel deployment is part of this design.
