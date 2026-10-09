## Part E — Categories, summary, archive, list and graph (spec §6)

> **Controller amendment (2026-10-08, binding).** E5 also makes `claimEstimate` and the `requirement-export` wake skip an
> archived group (spec §6.3 "refuses new work"), each with a test that queues the work, archives, delivers, and asserts
> nothing is claimed. Where this part assumed names from Parts B/D, use the names those parts produced (Part B:
> `activityEntrySchema`, `runActivitySchema`, `RunActivityV1`, `fetchRunActivity`; Part D: run view `outcome` and
> `stopReason`, `WebControlService.retryTask`).

Part E runs after Parts A, B, C and D. Every line range below was measured at the commit whose subject is
`docs(spec): revise the issue-fixes design after independent review` (before A–D land); A–D move some of them, so each
step also names the anchor text to find. `<wt>` is `/Users/biran/code/skills/loop/Orca-issues`, `<S>` the executor's
scratchpad. Server tests: `cd <wt> && ./node_modules/.bin/vitest run <file> > <S>/<name>.txt 2>&1; echo rc=$?`. Web
tests: `cd <wt>/web && ../node_modules/.bin/vitest run <file> > <S>/<name>.txt 2>&1; echo rc=$?` (if the root binary
refuses the web config, `npm run check --workspace web` and read the whole file). Every output file is read whole.

### Interfaces consumed from earlier parts (names fixed by the controller's brief)

- Part B: `src/control/activity.ts` `recordActivity(store, row)`, `readGroupActivity(store, groupId, limit)`,
  `latestGroupActivityAt(store, groupId)`, kinds `"archived"`/`"unarchived"`; `ControlStore.now()`; run view fields
  `startedAt`, `lastActivityAt` (web `RunViewV1.startedAt?: number | null`, `lastActivityAt?: number | null`); the
  route `GET /api/control/runs/:runId/activity` answering the web type `RunActivityViewV1`
  (`{ schema; runId; entries: ActivityEntryV1[] }`, entries newest first, `ActivityEntryV1 = { seq; groupId; taskId;
  runId; at; kind; body }`) exported from `web/src/controlTypes.ts`. If Part B named the web type differently, E11 uses
  Part B's name; E11 adds the browser fetch `fetchRunActivity` unless Part B already added one of that name.
- Part A: `enErrors` in `web/src/locales/en.ts`, `zhErrors` in `web/src/locales/zh.ts`, placeholder `{{detail}}`,
  `web/src/refusalExplain.ts` `explainRunReason(reason)`; the extended `tests/panel/refusalCoverage.test.ts` (both
  locales cover every durable code).
- Part C: the group view's stop banner and `handoffActive` covering `shutdown`.
- Part D: verb `retry-task` (group target, payload `{ taskId }`) served by `WebControlService.retryTask(command)`, run
  state `settled-failed`; one more mutation route (so `tests/entry/skill.test.ts` counts 30 routes after D).

### Interfaces produced by this part

- `src/control/workItemCategory.ts`: `WORK_ITEM_CATEGORIES`, `type WorkItemCategory`, `workItemCategory(input)`.
- `src/control/archivedMark.ts`: `archivedMarkSchema`, `archivedMarkOf(body)`, `isGroupArchived(store, groupId)`.
- `src/control/archiveGroup.ts`: `applyArchiveGroup`, `applyUnarchiveGroup`, `ArchiveGroupCommand`,
  `UnarchiveGroupCommand`.
- Verbs `archive-group`, `unarchive-group` (access `any`, routes `POST /api/control/groups/:groupId/archive` and
  `/unarchive`), results `{ kind: "archived", groupId, at }` and `{ kind: "unarchived", groupId }`.
- Durable codes (all 409): `group-archived`, `archive-run-active`, `archive-stop-pending`,
  `archive-integration-resolving`, `archive-call-in-flight`.
- Summary fields `goal?`, `branch?`, `counts?`, `updatedAt?`, `archived?`; work item view `category?`.
- `web/src/groupCategory.ts`: `groupCategory`, `needsAttention`, `matchesGroupFilter`, `GROUP_FILTERS`,
  `GROUP_FILTER_KEY`, `readGroupFilter`, `writeGroupFilter`, `groupFilterStorage`.
- `web/src/GroupList.tsx`, `web/src/clock.ts` (`useClock`), `DependencyGraph` exports `nodeLines`, `runNumber`.

### The single gate for "every group-targeted command" (spec §6.3)

`applyWebCommand` (`src/control/commandLedger.ts:278-371`) is the only function that books a group-scoped command
outcome after the revision check: `persistCommandOutcome` is module-private and its only other caller is
`preflightWebCommand`, which books nothing but `revision-conflict`; the one other `INSERT INTO commands`
(`src/control/commands.ts:34`, the legacy `applyCommand`) is not reachable from a Web or socket route. Every route handler
in `registerControlMutationRoutes` then reads the answer back with `lookupCommandResult` and fails
(`control-command-result-invalid`) if no row was booked. So a verb that changes anything -- `retry-task` included, and any
verb added later -- reaches `applyWebCommand`, and a refusal placed there, after the identity/revision checks and before
`expand`/`apply`, refuses it before any of its own preparation-time failures (the `expand: () => { throw error }` paths
of estimate, requirement-open and import) can surface. Task E4 puts the gate there and pins it with a test that walks
every group-targeted verb of `commandVerbSchema`, so a new verb without an entry fails the test.

### Rewritten existing tests (each required by the spec section named)

| Test (file) | Current assertion | Replacement | Spec |
|---|---|---|---|
| `web/tests/dependencyGraph.test.tsx` "draws nothing for a group without dependencies, where the table already says all there is" | `expect(screen.queryByRole("figure", { name: "Dependency graph" })).toBeNull();` | renamed "draws every task even when no task depends on another"; asserts the figure, two node buttons and zero `path[data-edge]` | §6.5 "renders whenever the group has work items, with or without dependency edges" |
| `web/tests/dependencyGraph.test.tsx` "draws one button per task with its status, and an arrow per dependency" | input `workItem({ taskId: "b", status: "blocked", dependencyTaskIds: ["a"] })`, `expect(...getAttribute("class")).toBe("dep-node dep-blocked")` | input gains `category: "blocked"` (and `category: "done"` for `a`); the class assertion is unchanged | §6.1, §6.5: the node class comes from the server's category, never from the status |
| `web/tests/taskLabels.test.tsx` "lists the manifest's entries and downloads one with the session alone" | `expect(requests).toEqual([{ url: "/api/control/runs/run-a/evidence", ... }, { url: ".../evidence/ev-2", ... }])` | the mock answers `/api/control/runs/run-a/activity` with an empty activity view and the expected list starts with `{ url: "/api/control/runs/run-a/activity", headers: undefined }` | §6.5 "the task detail shows the current run's recent activity (run activity route)" |
| `tests/entry/skill.test.ts` "lists exactly the panel's mutation routes, so the table cannot drift", "names the verb of every route as the panel does", "gives every route a payload example that its raw payload schema accepts" | `expect(routes.size).toBe(30)`, `expect(verbs.size).toBe(30)`, `expect(rows.length).toBe(30)` (29 before Part D) | `32` each | §6.3 two new routes |

No other existing assertion changes: the group card keeps today's row text as its first line and as its accessible name
(E8), so `projectFiltering`, `controlI18n`, `taskLabels` "shows each group's done/total", the `/^g · running/` clicks and
`requirements.test.tsx`'s link text stay green.

---

