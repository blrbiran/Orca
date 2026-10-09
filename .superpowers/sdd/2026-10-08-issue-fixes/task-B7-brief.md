### Task B7: `command` rows for group-targeted commands

**Files:**
- Modify `src/control/commandLedger.ts` imports (add `import { appendActivity } from "./activity.js";`) and after line
  359 (`if (projectionGroups.length > 0) recordProjectionChange(store, projectionGroups);`).
- Test: extend `tests/control/activity.test.ts`.

**Interfaces:** Consumes `appendActivity`. Row: `kind "command"`, `taskId` = target's task (task target), `runId` =
target's run (run target), body `{ verb, actor }` (`actor` = the raw command's `actorId`).

- [ ] **Step 1: Write the failing test** — add imports to `tests/control/activity.test.ts`:

```ts
import { applyWebCommand, type WebCommandContext } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import type { EffectiveAuthorityCommandV1, RawAuthorityCommandV1 } from "../../src/control/webProtocol.js";
```

and append:

```ts
/** As schema8.test.ts: a handoff-stop on g1 whose apply only answers (or refuses with a durable domain error). */
function handoffStop(store: ControlStore, commandId: string, expectedRevision: number, refuse = false) {
  const command: RawAuthorityCommandV1 = { schema: "orca-raw-command-v1", commandId, expectedRevision, actorId: "panel-operator", verb: "handoff-stop", target: { kind: "group", groupId: "g1" }, payload: {} };
  return applyWebCommand(store, {
    rawCommand: command,
    expand: () => ({ ...command, schema: "orca-authority-command-v1", payload: { handoffDeadlineAt: "2026-09-20T10:00:00.000Z" } }) as EffectiveAuthorityCommandV1,
    apply: (context: WebCommandContext) => {
      if (refuse) throw new ControlError("stop-already-active");
      return { status: 202, body: {
        schema: "orca-command-success-v1", commandId, actorId: command.actorId, verb: command.verb, target: command.target,
        commandRevision: context.nextCommandRevision, projectionSeq: context.nextProjectionSeq,
        effectivePayloadHash: context.effectivePayloadHash, authorityCommandHash: context.authorityCommandHash,
        result: { kind: "handoff-stopped", stopRevision: context.nextCommandRevision, acceptedAt: "2026-09-20T10:00:00.000Z", handoffDeadlineAt: "2026-09-20T10:00:00.000Z", frozenRunIds: [], requestIds: [] },
      } } as never;
    },
  });
}

describe("command rows (issue-fixes spec §5.2)", () => {
  it("an accepted group command writes one row; its replay, a stale one and a refused one write none", async () => {
    let clock = 100;
    const h = await openTestStore({ now: () => clock }); try {
      seedGroup(h.store, "g1");
      clock = 200;
      const first = handoffStop(h.store, "c1", 1);
      const rows = () => readGroupActivity(h.store, "g1", 10).map((entry) => [entry.kind, entry.at, entry.taskId, entry.runId, entry.body]);
      expect(rows()).toEqual([["command", 200, null, null, { verb: "handoff-stop", actor: "panel-operator" }]]);
      // The row did not move the group past the projectionSeq the success body promised (assertFinalVersions).
      expect(projectionSeq(h.store, "g1")).toBe((first.body as { projectionSeq: number }).projectionSeq);
      clock = 300;
      expect(handoffStop(h.store, "c1", 1)).toEqual(first);
      expect(handoffStop(h.store, "c-stale", 1).status).toBe(409);
      expect(handoffStop(h.store, "c-refused", 2, true).status).toBe(409);
      expect(rows()).toHaveLength(1);
    } finally { await h.dispose(); }
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/activity.test.ts > $SCRATCH/B7.txt 2>&1; echo rc=$?`.
  Expected: rows `[]`.

- [ ] **Step 3: Implement** — after line 359:

```ts
    if (projectionGroups.length > 0) recordProjectionChange(store, projectionGroups);
    // Issue-fixes spec §5.2: a group-targeted command first accepted writes its `command` row (a replay returned above,
    // a refusal is not `succeeded`). appendActivity, not recordActivity: the success body already names its
    // projectionSeq (assertFinalVersions below), and every group-scoped command recorded that change just above.
    if (succeeded && commandScope.groupId !== null) {
      const target = rawCommand.target;
      appendActivity(store, {
        groupId: commandScope.groupId, taskId: target.kind === "task" ? target.taskId : null, runId: target.kind === "run" ? target.runId : null,
        kind: "command", body: { verb: rawCommand.verb, actor: rawCommand.actorId },
      });
    }
```

- [ ] **Step 4: Run, expect PASS** — `./node_modules/.bin/vitest run tests/control/activity.test.ts tests/control/commandLedger.test.ts tests/control/schema8.test.ts tests/control/webMutations.test.ts > $SCRATCH/B7.txt 2>&1; echo rc=$?` (rc=0); then `npm test > $SCRATCH/B7-all.txt 2>&1; echo rc=$?` (every group command now inserts a row; read the file whole); `npm run typecheck`.

- [ ] **Step 5: Mutation** — (a) delete the block → red: "an accepted group command writes one row…". (b) drop
  `succeeded && ` → red: same test (the refused command writes a row; length 2).

- [ ] **Step 6: Commit**

```
git -C /Users/biran/code/skills/loop/Orca-issues add src/control/commandLedger.ts tests/control/activity.test.ts
git -C /Users/biran/code/skills/loop/Orca-issues commit -m "feat(control): record a command row for every accepted group command

Issue-fixes spec §5.2: applyWebCommand writes {verb, actor} for a group-scoped success in the
command's transaction, after its own projection change; replays and refusals write nothing.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

