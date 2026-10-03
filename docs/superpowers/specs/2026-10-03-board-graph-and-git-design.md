# Board: dependency graph and git scheme (goal.md §3.4 remainder)

Owner: Orca controller session `6a4dd7f3`, 2026-10-03. Human pick (this session): "接下来先做「看板剩下的部分」".
Scope source: goal.md §3.4 and §9.1 row "中期 6": G4 completion and the needs-attention dot are done (labels and progress
spec 2026-09-28); what is left is **the dependency graph is not drawn** and **the git scheme is not shown**.
Every decision below is reversible (a panel view and an optional wire field); per CLAUDE.md Rule 1 the controller made
them and reports them, nothing here waits on the human.

## 1. What changes

| # | Piece | Where |
|---|---|---|
| B1 | A drawn dependency graph of the group's tasks, above the work item table | web only |
| B2 | Each run carries the git facts its drive record already holds: workspace mode, base commit, landed commit | server view + web mirror |
| B3 | A "Git" section in the group view: work branch, the runs' workspaces and landings, merge into main and push shown as waiting on a person | web |
| B4 | The loop plan card's fixed git line follows the repository's workspace mode instead of always saying "worktree" | web |

## 2. Decisions

- **D1 — the graph is computed on the client from data the view already carries.** `workItems[].dependencyTaskIds`
  is the dependency relation the server validated (`graph.ts`); no new server read. Layout is code (Rule 5): a task's
  layer is the length of the longest dependency path to it; inside a layer tasks are ordered by `taskId`. A dependency
  naming a task not in the view is drawn nowhere and counted in a visible note, never silently dropped (Rule 12). A cycle
  (the server refuses one; the client still must not hang) is broken by ignoring the edge that closes it, and the note
  says so.
- **D2 — the graph is SVG with one focusable button per task.** Activating a node opens the same task detail the table's
  task button opens (one `openTask` state). Node style follows the work item status class (completed, blocked, active
  kinds, the rest); the status word is in the node's text, so color is never the only carrier. The graph shows every
  task regardless of the label filter: the filter is a table filter, and a graph with holes misstates dependencies.
- **D3 — write-set conflicts are not drawn.** The control plane's view has no write-set field; adding one is a server
  change with no consumer asking for it yet. Registered in §5.
- **D4 — git facts come from the drive record, not from git.** `runs[].git = { workspaceMode, base, landedCommit } | null`
  (null for a run without a drive record, such as a requirement call). The projection runs no git command, so a read
  never touches the person's repository and the view stays a pure function of the store. Optional on the wire like the
  labels fields; the server always sends it.
- **D5 — merge into main and push are displayed as "waiting on a person", never as queued** (goal.md §3.4, CLAUDE.md
  Rule 15). The panel has no button for either and says so.
- **D6 — the work branch name is `orca/<groupId>`** (`workBranchRef`, execution driver spec §5.1); each landing is one
  first-parent commit on it whose second parent is the run's attempt (`findLanding`). The section states both as facts
  of the driver.
- **D7 — the loop plan card's git line** takes the repository's workspace mode the page already reads
  (`RepositoryWorkspaceV1`): worktree keeps today's text, clone gets its own, and a page that has not read the setting
  yet says so. A caller that passes no mode at all (older criteria) keeps today's text, which is the repository default.
  This amends loop plans spec D1's "fixed value" for this one line; recorded there as a correction section.

## 3. Wire change

`src/control/webProtocol.ts` `runViewSchema` gains

```ts
git: z.object({ workspaceMode: workspaceModeSchema, base: commitSchema.nullable(), landedCommit: commitSchema.nullable() }).strict().nullable().optional()
```

mirrored in `web/src/controlTypes.ts` (`webParity.test.ts` checks both ways). Built in `src/panel/controlViews.ts`
`runViews` from `run.drive`.

## 4. Criteria (each a command that exits 0 / non-0)

| # | Criterion | Command |
|---|---|---|
| C1 | layering: longest path, ties by id, missing dependency counted, cycle broken and counted | `npx vitest run web/tests/dependencyGraph.test.tsx` (web workspace) |
| C2 | the graph renders one button per task and opens the task detail | same file |
| C3 | a run's drive record reaches the view as `git`; a run without one gives `null` | `npx vitest run tests/panel/runGitView.test.ts` |
| C4 | the Git section shows the work branch, each run's mode and landing, and merge/push as waiting on a person | `web/tests/gitScheme.test.tsx` |
| C5 | the loop plan card's git line follows the mode | `web/tests/gitScheme.test.tsx` |
| C6 | Chinese and English keys stay in parity | `web/tests/i18nKeys.test.ts` |
| C7 | the whole gate | `npm run verify` segments, in a `git clone --local` copy |

Every new branch gets a named mutation seen red in the clone (Rule 9); recorded in the ledger
`.superpowers/sdd/2026-10-03-board-graph-and-git/progress.md`.

## 5. Registered, not in this design

- Write-set conflict edges in the graph (D3).
- Whether `orca/<groupId>` has been merged into main or pushed: needs a git read in the projection or a separate
  endpoint; today the panel only says it waits on a person.
- Elapsed time per run (goal.md §3.4 "耗时"): `progress.lastTransitionAt` is shown in the task detail; a duration needs a
  start timestamp the run view does not carry.
