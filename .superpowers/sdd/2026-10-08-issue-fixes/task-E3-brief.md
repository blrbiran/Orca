### Task E3: archive-group and unarchive-group (spec §6.3, except the refusal of other verbs)

**Files:**
- Modify: `src/control/errors.ts` — 409 block (lines 37-88): after `"agent-selection-changed": 409,` (line 37) and after
  `"group-already-exists": 409,` (line 48)
- Modify: `src/control/webProtocol.ts` — `commandVerbSchema` (lines 592-623), raw variants (lines 854-887), effective
  variants (lines 889-937), result union (after line 1453 `integration-resolution-started`)
- Create: `src/control/archiveGroup.ts`
- Modify: `src/control/webService.ts` — imports (line 24), methods (after `retryIntegration`, lines 582-585)
- Modify: `src/panel/controlApi.ts` — `controlCommandRoutes` (after line 378, the `integration/resolve` route), the
  verb switch (after line 454, `case "resolve-integration-conflict"`)
- Modify: `src/panel/humanOnly.ts` — `VERB_ACCESS` (lines 9-42)
- Modify: `web/src/controlTypes.ts` — `CommandSuccessV1` verb union and result union (lines 438-472)
- Modify: `web/src/locales/en.ts` `enErrors`, `web/src/locales/zh.ts` `zhErrors` (Part A's tables; alphabetical position)
- Modify: `tests/panel/permissions.test.ts` (one assertion), `tests/panel/controlApi.test.ts` (one `it`)
- Test: `tests/control/archiveGroup.test.ts` (new)

**Interfaces:**
- Consumes: E2 `archivedMarkOf`; Part B `recordActivity`, `store.now()`; `pendingRequirementCall`
  (`src/control/requirementCalls.ts:42`); `readGroupIntegration` (`src/control/integrationScheme.ts:187`);
  `applyWebCommand`.
- Produces: `applyArchiveGroup(deps: { store: ControlStore }, command: ArchiveGroupCommand): CommandSuccessV1 | CommandErrorBodyV1`,
  `applyUnarchiveGroup(...)` likewise; `WebControlService.archiveGroup(command)`, `.unarchiveGroup(command)`; the five
  durable codes.

Guard order (each refusal reachable on its own, so each test goes red when its guard is deleted): a call in flight
(estimate `running`/`start-unknown` -- the states `scheduleStart`'s `estimate-in-flight` uses -- then a clarifying group's
pending requirement call), a `handoff`/`shutdown` stop intent not `handoff-complete`, an integration `resolving`, then an
active run. The stop guard precedes the run guard because a settling handoff always has an active run.

- [ ] **Step 1: Write the failing test** — `tests/control/archiveGroup.test.ts` (this task's part; E4 and E5 append
  describes to the same file):

```ts
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { isGroupArchived } from "../../src/control/archivedMark.js";
import { lookupCommandResult, updateRevision } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { insertClarifyingGroup, newRound, writeRound } from "../../src/control/requirementRecords.js";
import { groupStopState } from "../../src/control/stopIntent.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import { clarifyingInput } from "./fixtures/requirement.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import type { WebFixtureTask } from "./fixtures/web.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const body = (h: H, id = "g") => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
const writeBody = (h: H, value: Record<string, unknown>) => h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(value));
const revisionOf = (h: H, id = "g") => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(id)!.revision);
const dispatch = (h: H) => ({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate });
const lastSeq = (h: H) => Number(h.store.db.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM activity").get()!.n);

/** A confirmed group "g": ready, no run, its import estimate still queued (queued is not in flight). */
async function confirmed(tasks: readonly WebFixtureTask[] = [{ taskId: "a" }]) {
  const h = await webFixture(profileSnapshot(), tasks);
  const service = new WebControlService(h.deps);
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  return { h, service };
}

async function claimed(h: H, service: WebControlService): Promise<string> {
  await service.start(h.command("start", {}));
  const outcome = await deliverScheduledStart(dispatch(h), "g");
  if (outcome.kind !== "claimed") throw new Error(JSON.stringify(outcome));
  return outcome.runId;
}

describe("archive-group and unarchive-group (issue-fixes spec §6.3)", () => {
  it("archives an idle group: the body says when and by whom, the summary says archived, and an archived row is written", async () => {
    const { h, service } = await confirmed();
    try {
      const before = Date.now(), seq = lastSeq(h);
      const result = service.archiveGroup(h.command("archive-group", {}));
      if ("error" in result || result.result.kind !== "archived") throw new Error(JSON.stringify(result));
      expect(result.result.groupId).toBe("g");
      expect(body(h).archived).toEqual({ at: result.result.at, actor: "human" });
      expect(result.result.at).toBeGreaterThanOrEqual(before);
      expect(result.result.at).toBeLessThanOrEqual(Date.now());
      expect(readGroupSummary(h.store, "g").archived).toBe(true);
      expect(readGroupActivity(h.store, "g", 50).filter((entry) => entry.seq > seq).map((entry) => entry.kind)).toContain("archived");
    } finally { await h.dispose(); }
  });

  it("unarchive removes the mark and writes an unarchived row; unarchiving a group that is not archived is a no-op refusal", async () => {
    const { h, service } = await confirmed();
    try {
      service.archiveGroup(h.command("archive-group", {}));
      const seq = lastSeq(h);
      const result = service.unarchiveGroup(h.command("unarchive-group", {}));
      if ("error" in result || result.result.kind !== "unarchived") throw new Error(JSON.stringify(result));
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
      expect(readGroupSummary(h.store, "g").archived).toBe(false);
      expect(readGroupActivity(h.store, "g", 50).filter((entry) => entry.seq > seq).map((entry) => entry.kind)).toContain("unarchived");
      expect(service.unarchiveGroup(h.command("unarchive-group", {}))).toMatchObject({ error: { code: "no-op-command" } });
    } finally { await h.dispose(); }
  });

  it("archives under a pause with no active run, and under a handoff stop that is complete", async () => {
    const paused = await confirmed();
    try {
      await paused.service.pauseDispatch(paused.h.command("pause-dispatch", {}));
      expect(paused.service.archiveGroup(paused.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
    } finally { await paused.h.dispose(); }
    const handedOff = await confirmed();
    try {
      await handedOff.service.handoffStop(handedOff.h.command("handoff-stop", {}));
      expect(groupStopState(handedOff.h.store, "g")).toBe("handoff-complete");
      expect(handedOff.service.archiveGroup(handedOff.h.command("archive-group", {}))).toMatchObject({ result: { kind: "archived" } });
    } finally { await handedOff.h.dispose(); }
  });

  it("refuses while a run is active: archive-run-active", async () => {
    const { h, service } = await confirmed();
    try {
      await claimed(h, service);
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-run-active" } });
      expect(Object.hasOwn(body(h), "archived")).toBe(false);
    } finally { await h.dispose(); }
  });

  it("refuses while a handoff stop is still settling: archive-stop-pending (ahead of the run it waits for)", async () => {
    const { h, service } = await confirmed();
    try {
      await claimed(h, service);
      await service.handoffStop(h.command("handoff-stop", {}));
      expect(groupStopState(h.store, "g")).not.toBe("handoff-complete");
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-stop-pending" } });
    } finally { await h.dispose(); }
  });

  it("refuses while an agent resolves the integration: archive-integration-resolving", async () => {
    const { h, service } = await confirmed();
    try {
      const scheme = { delivery: "local", trigger: "task", method: "merge", target: "main" } as const;
      writeBody(h, { ...body(h), integration: { ...newGroupIntegration(scheme)!, frozen: true, state: "resolving" } });
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-integration-resolving" } });
    } finally { await h.dispose(); }
  });

  it("refuses while an estimate is in flight: archive-call-in-flight", async () => {
    const { h, service } = await confirmed();
    try {
      h.store.db.prepare("UPDATE estimates SET state='running' WHERE group_id='g'").run();
      expect(service.archiveGroup(h.command("archive-group", {}))).toMatchObject({ error: { code: "archive-call-in-flight", message: "archive-call-in-flight:estimate" } });
    } finally { await h.dispose(); }
  });

  it("refuses while a requirement call is waiting: archive-call-in-flight", async () => {
    const { h, service } = await confirmed();
    try {
      h.store.transaction(() => {
        insertClarifyingGroup(h.store, clarifyingInput("r"));
        updateRevision(h.store, "r", 1);
        h.store.db.prepare("UPDATE groups SET projection_seq=1 WHERE id='r'").run();
        writeRound(h.store, "r", newRound(1));
      });
      const command = h.rawCommand("archive-r", revisionOf(h, "r"), "archive-group", { kind: "group", groupId: "r" }, {}) as never;
      expect(service.archiveGroup(command)).toMatchObject({ error: { code: "archive-call-in-flight", message: "archive-call-in-flight:requirement" } });
      expect(lookupCommandResult(h.store, "r", "archive-r")!.body).toMatchObject({ error: { code: "archive-call-in-flight" } });
    } finally { await h.dispose(); }
  });

  it("blocks by name on an archive mark that does not parse", async () => {
    const { h } = await confirmed();
    try {
      writeBody(h, { ...body(h), archived: "yes" });
      expect(() => isGroupArchived(h.store, "g")).toThrow(ControlError);
      expect(() => isGroupArchived(h.store, "g")).toThrow(/group-archived-invalid/);
    } finally { await h.dispose(); }
  });
});
```

  Add to `tests/panel/permissions.test.ts`, inside "lets an owner do human-only actions…", after the `for (const p of
  [member, agent])` loop:

```ts
    // Issue-fixes spec §6.3: archiving and unarchiving are open to every principal (access `any`).
    for (const p of [owner, member, agent]) for (const verb of ["archive-group", "unarchive-group"] as const) expect(permissionRefusal(p, verb, {})).toBe(null);
```

  Add to `tests/panel/controlApi.test.ts` a new `it` inside the first `describe` (after its first `it`):

```ts
  it("archives and unarchives a group over HTTP, and the summary follows (issue-fixes spec §6.3)", async () => {
    const paths = await h.workspace();
    const panel = await h.boot("epoch-archive", paths);
    const imported = await command(panel, "/api/control/groups/import-plan", { commandId: "archive-import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
    expect(imported.status).toBe(201);
    const archived = await command(panel, `/api/control/groups/${GROUP}/archive`, { commandId: "archive-1", expectedRevision: await revision(panel), payload: {} });
    expect(archived.status).toBe(200);
    expect(commandSuccessSchema.parse(archived.body)).toMatchObject({ verb: "archive-group", result: { kind: "archived", groupId: GROUP } });
    const summary = controlSummarySchema.parse(await json(await get(panel, "/api/control/summary")));
    expect(summary.groups.find((group) => group.groupId === GROUP)?.archived).toBe(true);
    const unarchived = await command(panel, `/api/control/groups/${GROUP}/unarchive`, { commandId: "unarchive-1", expectedRevision: await revision(panel), payload: {} });
    expect(commandSuccessSchema.parse(unarchived.body)).toMatchObject({ verb: "unarchive-group", result: { kind: "unarchived" } });
  });
```

  (`revision(panel, groupId = GROUP)` is the async harness helper at `tests/panel/fixtures/controlPanel.ts:239`, already
  imported by the file.)

- [ ] **Step 2: Run it, expect FAIL** —
  `./node_modules/.bin/vitest run tests/control/archiveGroup.test.ts tests/panel/permissions.test.ts tests/panel/controlApi.test.ts > <S>/e3.txt 2>&1; echo rc=$?`
  → `rc=1`: `service.archiveGroup is not a function`; the raw schema refuses verb `archive-group`; route 404.

- [ ] **Step 3: Implement.**

  (a) `src/control/errors.ts`: after `"agent-selection-changed": 409,` add

```ts
  // Issue-fixes spec §6.3: archive is refused while the group still has work in motion; each guard has its own code. The
  // detail of archive-stop-pending is `<mode>:<state>`, of archive-call-in-flight `estimate` or `requirement`.
  "archive-call-in-flight": 409,
  "archive-integration-resolving": 409,
  "archive-run-active": 409,
  "archive-stop-pending": 409,
```

  and after `"group-already-exists": 409,` add

```ts
  // Issue-fixes spec §6.3: an archived group refuses every group-targeted command but unarchive-group.
  "group-archived": 409,
```

  (b) `src/control/webProtocol.ts`: in `commandVerbSchema` after `"resolve-integration-conflict",` add
  `  "archive-group",` and `  "unarchive-group",`. In `rawAuthorityCommandVariants` after the
  `verb: z.literal("resolve-integration-conflict")` line add:

```ts
  // Issue-fixes spec §6.3: archive and unarchive, group target, empty payload.
  z.object({ ...rawCommandFields, verb: z.literal("archive-group"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
  z.object({ ...rawCommandFields, verb: z.literal("unarchive-group"), target: groupCommandTargetSchema, payload: emptyPayloadSchema }).strict(),
```

  and the same two lines with `effectiveCommandFields` in `effectiveAuthorityCommandVariants` after its
  `resolve-integration-conflict` line. In `commandResultSchema` after
  `z.object({ kind: z.literal("integration-resolution-started"), groupId: idSchema }).strict(),` add:

```ts
  // Issue-fixes spec §6.3: `at` is the archive mark's time (ms since the epoch).
  z.object({ kind: z.literal("archived"), groupId: idSchema, at: safeInteger }).strict(),
  z.object({ kind: z.literal("unarchived"), groupId: idSchema }).strict(),
```

  (c) Create `src/control/archiveGroup.ts`:

```ts
import { recordActivity } from "./activity.js";
import { archivedMarkOf } from "./archivedMark.js";
import { applyWebCommand, type WebCommandContext } from "./commandLedger.js";
import { ControlError } from "./errors.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { pendingRequirementCall } from "./requirementCalls.js";
import type { ControlStore } from "./store.js";
import type { CommandErrorBodyV1, CommandSuccessV1, RawAuthorityCommandV1 } from "./webProtocol.js";

/** Issue-fixes spec §6.3 (ruling H4): a group is archived, never deleted; it keeps every record and takes no new work. */
export type ArchiveGroupCommand = Extract<RawAuthorityCommandV1, { verb: "archive-group" }>;
export type UnarchiveGroupCommand = Extract<RawAuthorityCommandV1, { verb: "unarchive-group" }>;

function success(context: WebCommandContext, result: CommandSuccessV1["result"]): { status: number; body: CommandSuccessV1 } {
  return { status: 200, body: {
    schema: "orca-command-success-v1", commandId: context.rawCommand.commandId, actorId: context.rawCommand.actorId,
    verb: context.rawCommand.verb, target: context.rawCommand.target, commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
    effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash, result,
  } };
}

function groupBody(store: ControlStore, groupId: string): Record<string, unknown> {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("group-not-found");
  return JSON.parse(String(row.body)) as Record<string, unknown>;
}

/**
 * Spec §6.3: archive is refused while work is in motion, each case by its own code. Order matters for reachability: a
 * running estimate or a pending requirement call also has (or will have) an active run, and a settling handoff always
 * has one, so those are named before the plain active-run guard. A `pause` intent with no active run does not refuse.
 */
function refuseArchive(store: ControlStore, groupId: string, group: Record<string, unknown>): void {
  for (const row of store.db.prepare("SELECT state FROM estimates WHERE group_id=?").all(groupId)) {
    if (["running", "start-unknown"].includes(String(row.state))) throw new ControlError("archive-call-in-flight", "estimate");
  }
  if (group.status === "clarifying" && pendingRequirementCall(store, groupId) !== null) throw new ControlError("archive-call-in-flight", "requirement");
  const stop = store.db.prepare("SELECT mode,body FROM stop_intents WHERE group_id=?").get(groupId);
  if (stop !== undefined && String(stop.mode) !== "pause") {
    const state = (JSON.parse(String(stop.body)) as { state?: unknown }).state;
    if (state !== "handoff-complete") throw new ControlError("archive-stop-pending", `${String(stop.mode)}:${String(state)}`);
  }
  if (readGroupIntegration(group)?.state === "resolving") throw new ControlError("archive-integration-resolving");
  if (store.db.prepare("SELECT id FROM runs WHERE group_id=? AND active=1").get(groupId)) throw new ControlError("archive-run-active");
}

/** Spec §6.3: marks the body `archived: { at, actor }` and writes an `archived` activity row in the same transaction. */
export function applyArchiveGroup(deps: { store: ControlStore }, command: ArchiveGroupCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const group = groupBody(deps.store, groupId);
      refuseArchive(deps.store, groupId, group);
      const at = deps.store.now();
      group.archived = { at, actor: context.rawCommand.actorId };
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      recordActivity(deps.store, { groupId, kind: "archived", body: {} });
      return success(context, { kind: "archived", groupId, at });
    },
  }).body;
}

/** Spec §6.3: removes the mark (refused no-op-command when there is none) and writes an `unarchived` activity row. */
export function applyUnarchiveGroup(deps: { store: ControlStore }, command: UnarchiveGroupCommand): CommandSuccessV1 | CommandErrorBodyV1 {
  return applyWebCommand<CommandSuccessV1 | CommandErrorBodyV1>(deps.store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1" }),
    apply: (context) => {
      const groupId = command.target.groupId;
      const group = groupBody(deps.store, groupId);
      if (archivedMarkOf(group) === null) throw new ControlError("no-op-command");
      delete group.archived;
      deps.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
      recordActivity(deps.store, { groupId, kind: "unarchived", body: {} });
      return success(context, { kind: "unarchived", groupId });
    },
  }).body;
}
```

  (d) `src/control/webService.ts`: after line 24 (`import { applyResolveIntegrationConflict, ... } from "./integrationCommands.js";`) add
  `import { applyArchiveGroup, applyUnarchiveGroup, type ArchiveGroupCommand, type UnarchiveGroupCommand } from "./archiveGroup.js";`
  and after the `retryIntegration(...) { ... }` method (ends `return this.mutate(() => applyRetryIntegration(...)) as WebCommandResult;\n  }`) add:

```ts
  /** Issue-fixes spec §6.3: archive a group (it keeps every record and takes no new work) / take it back. */
  archiveGroup(command: ArchiveGroupCommand): WebCommandResult {
    return this.mutate(() => applyArchiveGroup({ store: this.store }, command)) as WebCommandResult;
  }
  unarchiveGroup(command: UnarchiveGroupCommand): WebCommandResult {
    return this.mutate(() => applyUnarchiveGroup({ store: this.store }, command)) as WebCommandResult;
  }
```

  (e) `src/panel/controlApi.ts`: after
  `{ path: "/api/control/groups/:groupId/integration/resolve", verb: "resolve-integration-conflict", target: fromParams },` add

```ts
    // Issue-fixes spec §6.3: archive and unarchive; the ledger key is the group's.
    { path: "/api/control/groups/:groupId/archive", verb: "archive-group", target: fromParams },
    { path: "/api/control/groups/:groupId/unarchive", verb: "unarchive-group", target: fromParams },
```

  and in the switch after `case "resolve-integration-conflict": await service.resolveIntegrationConflict(command); break;` add

```ts
          case "archive-group": service.archiveGroup(command); break;
          case "unarchive-group": service.unarchiveGroup(command); break;
```

  (f) `src/panel/humanOnly.ts`: after `"resolve-integration-conflict": "human-only",` add

```ts
  // Issue-fixes spec §6.3: archiving hides and freezes a group but deletes nothing; any principal may do it and undo it.
  "archive-group": "any",
  "unarchive-group": "any",
```

  (g) `web/src/controlTypes.ts` `CommandSuccessV1`: append `| "archive-group" | "unarchive-group"` to the `verb` union
  (after `"resolve-integration-conflict"`), and after `| { kind: "integration-resolution-started"; groupId: string }` add

```ts
    | { kind: "archived"; groupId: string; at: number }
    | { kind: "unarchived"; groupId: string }
```

  (h) Locales (Part A's tables, keep alphabetical order). `enErrors`:

```ts
  "archive-call-in-flight": "A model call for this group is still running ({{detail}}). Archive it once the call has finished.",
  "archive-integration-resolving": "An agent is resolving this group's integration conflict. Archive it once that has finished.",
  "archive-run-active": "This group still has an active run. Wait for it to finish, or stop it with Handoff stop, then archive.",
  "archive-stop-pending": "A stop is still settling ({{detail}}). Archive the group once it reaches handoff-complete.",
  "group-archived": "This group is archived: it keeps every record but takes no new work. Unarchive it to change or run it.",
```

  `zhErrors`:

```ts
  "archive-call-in-flight": "这个组还有一次模型调用在进行（{{detail}}）。等调用结束后再归档。",
  "archive-integration-resolving": "agent 正在解决这个组的集成冲突。等它结束后再归档。",
  "archive-run-active": "这个组还有正在进行的运行。等它结束，或先用“交接停止”停下，再归档。",
  "archive-stop-pending": "停止还没有完成（{{detail}}）。等它到达交接完成后再归档。",
  "group-archived": "这个组已归档：记录都保留，但不再接新工作。要修改或运行它，先取消归档。",
```

- [ ] **Step 4: Run, expect PASS** — the Step 2 command → `rc=0`. Then
  `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts tests/panel/humanOnly.test.ts tests/panel/webParity.test.ts > <S>/e3-wide.txt 2>&1; echo rc=$?` → `rc=0`;
  `npm run typecheck > <S>/e3-tc.txt 2>&1; echo rc=$?` → `rc=0`. (`tests/entry/skill.test.ts` is red now -- two routes
  without rows -- and goes green in E6.)

- [ ] **Step 5: Mutation** (clone): delete, one at a time, each guard line of `refuseArchive`: the estimate loop → "an
  estimate is in flight" red; the requirement line → "a requirement call is waiting" red; the stop block → "a handoff stop
  is still settling" red (it then answers `archive-run-active`); replace `state !== "handoff-complete"` with `true` →
  "under a handoff stop that is complete" red; the integration line → its test red; the run line → "a run is active" red.
  Delete `recordActivity(... "archived" ...)` → the first test red. Delete the `no-op-command` throw → the unarchive test
  red. In `archivedMarkOf` replace the `throw` with `return null` → "blocks by name" red.

- [ ] **Step 6: Commit** —
  `git -C <wt> add src/control/errors.ts src/control/webProtocol.ts src/control/archiveGroup.ts src/control/webService.ts src/panel/controlApi.ts src/panel/humanOnly.ts web/src/controlTypes.ts web/src/locales/en.ts web/src/locales/zh.ts tests/control/archiveGroup.test.ts tests/panel/permissions.test.ts tests/panel/controlApi.test.ts`
  message `feat(control): archive and unarchive a group, refused while its work is in motion` (body `Issue-fixes spec 6.3.` + Co-Authored-By).

