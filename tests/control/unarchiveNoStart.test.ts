// Tester #370, plan 2026-11-18 tester batch D, Task V3. Human ruling 2026-11-18 (「unarchive 一个 ready 组时，不应该自动开跑」):
// unarchiving a ready group whose Web start was queued must not start it -- the queued start is dropped in the unarchive's
// own transaction and the receipt names `orca group start`. And an archived group reads `archived (was <state>)`, listed
// last, instead of `running · archived`.
import { describe, expect, it } from "vitest";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";
import { cli, useFakePanels } from "../commands/fixtures/fakePanel.js";
import { world } from "../commands/fixtures/world.js";
import { driverHarness } from "./fixtures/driverHarness.js";

useFakePanels();

describe("unarchiving a group never starts it (#370)", { timeout: 60_000 }, () => {
  it("a ready group with a queued start: the wake is dropped by unarchive, the next driver pass claims nothing, the receipt says start it", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const service = new WebControlService(t.h.deps);
      expect(await service.start(t.h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      const startWakes = () => t.h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind='start'").all();
      expect(startWakes()).toHaveLength(1);
      service.archiveGroup(t.h.command("archive-group", {}));
      // While archived, recovery list does not show it as a start waiting to be delivered: unarchive drops it.
      expect(readControlRecovery(t.h.store, "e").deferredWakes ?? []).toEqual([]);
      const result = service.unarchiveGroup(t.h.command("unarchive-group", {}));
      // mutation: drop the wake deletion in applyUnarchiveGroup -> red here (and the claim below)
      expect(result).toMatchObject({ result: { kind: "unarchived", groupId: "g", startDropped: true } });
      expect(startWakes()).toEqual([]);
      const driver = t.driver();
      await driver.round();
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id='g' AND work_item_id='a'").get()!.n).toBe(0);
      expect(await deliverScheduledStart(t.dispatch, "g")).toEqual({ kind: "idle" });
      // A person's start works as for any ready group.
      expect(await service.start(t.h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
      expect((await deliverScheduledStart(t.dispatch, "g")).kind).toBe("claimed");
    } finally { await t.h.dispose(); }
  });

  it("an archived group with no queued start: unarchive says nothing was dropped", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const service = new WebControlService(t.h.deps);
      service.archiveGroup(t.h.command("archive-group", {}));
      const result = service.unarchiveGroup(t.h.command("unarchive-group", {}));
      expect(result).toMatchObject({ result: { kind: "unarchived", groupId: "g" } });
      expect((result as { result: Record<string, unknown> }).result).not.toHaveProperty("startDropped");
    } finally { await t.h.dispose(); }
  });

  it("the unarchive receipt names orca group start when the queued start was dropped", async () => {
    const answer = (result: unknown) => ({ status: 200, body: { schema: "orca-command-success-v1", commandId: "c", actorId: "human", verb: "unarchive-group",
      target: { kind: "group", groupId: "g-alpha" }, commandRevision: 6, projectionSeq: 6, effectivePayloadHash: "h", authorityCommandHash: "h", result } });
    const w = await world({}, { "POST groups/g-alpha/unarchive": answer({ kind: "unarchived", groupId: "g-alpha", startDropped: true }) });
    const out = await cli(["group", "unarchive", "g-alpha"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop the receipt's startDropped branch -> the generic key/value text, red
    expect(out.stdout).toBe("unarchived g-alpha; its queued start was dropped -- start it with: orca group start g-alpha\n");
  });

  it("group list: an archived group reads archived (was <state>) and is listed last", async () => {
    const w = await world({}, {
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", epoch: "e", changeSeq: 9, resetRequired: true, groups: [
        { groupId: "g-old", repoId: "repo-1", state: "running", commandRevision: 4, goal: "old", archived: true, counts: { running: 0, blocked: 0, done: 1, idle: 1, waiting: 0 }, completion: { done: 1, total: 2 } },
        { groupId: "g-new", repoId: "repo-1", state: "ready", commandRevision: 2, goal: "new", archived: false },
      ] } },
    });
    const out = await cli(["group", "list"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: print the old `<state> · archived` -> red
    expect(out.stdout).toBe("g-new  repo-1  ready  rev 2  new\ng-old  repo-1  archived (was running)  done 1/2  rev 4  old\n");
  });
});
