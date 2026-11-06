import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ccloopWorlds, raw, realBinary } from "../control/fixtures/ccloopWorld.js";

/**
 * Issue #126 (tester round, triage A): `recordUsage` queues a `group-handoff` projection row on every usage event, a
 * requirement call's and a blocked run's included, but only a task settle (executionDriver), the scheduler bridge or a
 * restart (recovery) drained them. A group with no settling task kept a stale or missing exports/…/handoff.md. The
 * panel's pump now drains pending rows each pass. Real assembly and store; nothing is started.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-pump-projection-", epochPrefix: "epoch-pump-projection-" });
afterAll(removeRoots);

describe.skipIf(!realBinary)("the panel's pump delivers pending projections (#126)", { timeout: 120_000 }, () => {
  relocateHome("orca-pump-projection-home-");

  it("a group-handoff row queued after recovery is delivered by the next pump, with no task settle", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["a.txt"] }], { a: { files: { "a.txt": "A\n" } } });
    const runtime = await w.boot(); try {
      const imported = await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId: w.repoId, planId: "plan" }));
      expect(imported).toMatchObject({ result: { kind: "imported" } });
      // The row a usage event writes (usage.ts recordUsage), for the group's current revision and budget version.
      const group = JSON.parse(String(runtime.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { revision: number; budgetVersion: number };
      const id = `group-handoff:g:budget:${group.revision}:${group.budgetVersion}`;
      runtime.store.db.prepare("DELETE FROM outbox WHERE kind='group-handoff'").run();
      runtime.store.db.prepare("INSERT INTO outbox VALUES (?, 'group-handoff', ?, 0)").run(id, JSON.stringify({ groupId: "g", revision: group.revision, budgetVersion: group.budgetVersion }));
      const handoff = join(runtime.store.stateDir, "exports", "groups", "g", "handoff.md");
      const before = existsSync(handoff) ? readFileSync(handoff, "utf8") : null;
      await runtime.pump();
      // mutation: drop the publishPending step from the pump -> delivered stays 0, red
      expect(runtime.store.db.prepare("SELECT delivered FROM outbox WHERE id=?").get(id)).toEqual({ delivered: 1 });
      // The positive observation: the projection was written by this pass (not merely marked delivered).
      expect(existsSync(handoff)).toBe(true);
      expect(readFileSync(handoff, "utf8")).not.toBe(before);
    } finally { await w.teardown(); }
  });
});
