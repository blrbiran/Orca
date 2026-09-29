import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { ccloopWorlds, noBlocked, raw, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Loop plans spec §6 criterion 10 against the real ccloop build (ORCA_CCLOOP_BIN) and its scripted fake codex: a loop
 * task changed after confirmation passes A2, ccloop receives the newly expanded contract and the run settles and lands,
 * while the other task's snapshot entries and everything else in the snapshot stay byte-identical.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-loop-e2e-", epochPrefix: "epoch-loop-e2e-" });
afterAll(removeRoots);
const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const snapshotOf = (runtime: ControlRuntime): any => JSON.parse(readCanonicalRecord(runtime.store, readBudgetProposal(runtime.store, "g").executionSnapshotHash!));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const without = (snapshot: any, taskId: string) => ({
  ...snapshot,
  derivedContracts: snapshot.derivedContracts.filter((entry: { taskId: string }) => entry.taskId !== taskId),
  allocations: snapshot.allocations.filter((row: { ownerKind: string; ownerId: string }) => !(row.ownerKind === "task" && row.ownerId === taskId)),
});
// A loop plan's allowlist is its targetPaths (spec §3), and ccloop's fake codex reports `answer.txt` as changed on every
// execute whatever it writes (tests/fixtures/fake-codex.mjs), so the allowlist names it too, or ccloop stops the attempt
// at `allowlist miss: answer.txt` (measured: b7/dbg.json.root). Tasks a and b therefore share answer.txt in their write
// sets on purpose (final review Minor 8 / B7): it is the fake codex's, not a real overlap between the two tasks.
const loopFor = (goal: string, path: string) => ({ plan: "standard", goal, successCondition: `${path} holds the scripted text`, targetPaths: [path, "answer.txt"], checks: ["true"] });

describe("a loop task changed after confirmation, against real ccloop (spec §6 criterion 10)", { timeout: 420_000 }, () => {
  relocateHome("orca-loop-e2e-home-");
  // Gated at run time, never with describe.skipIf (tests/setup/scopeTmpdir.ts ERRATUM 2026-09-29).
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });

  it("runs the newly expanded contract to settle, and leaves the rest of the snapshot byte-identical", async () => {
    const w = await world([
      { taskId: "a", targetPaths: ["shared.txt"], loop: loopFor("write shared.txt", "shared.txt") },
      { taskId: "b", targetPaths: ["b.txt"], loop: loopFor("write b.txt", "b.txt") },
    ], { a: { files: { "shared.txt": "A\n" } }, b: { files: { "b.txt": "B\n" } } });
    const runtime = await w.boot();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let before: any = null;
      await startGroup(runtime, w.repoId, 0, async () => {
        before = snapshotOf(runtime);
        const plan = readControlGroup(runtime.store, runtime.epoch, "g").workItems.find((entry) => entry.taskId === "a")!.loopPlan!;
        const work = readBudgetProposal(runtime.store, "g").allocations.find((row) => row.ownerKind === "task" && row.ownerId === "a" && row.bucket === "work")!.amount;
        const changed = runtime.service.setTaskLoop(raw(runtime, "loop-a", "set-task-loop", {
          baseLoopVersion: plan.loopVersion, plan: "standard", inputs: { ...plan.inputs, goal: "write shared.txt, changed after confirmation" },
          // Rulings P4: a budget raise, so a full rebuild of the snapshot (reserve row from the live proposal) is caught below.
          work: { tokens: work.tokens + 500_000, activeMs: work.activeMs, attempts: work.attempts },
        }, { kind: "task", groupId: "g", taskId: "a" }));
        expect(changed).toMatchObject({ result: { kind: "task-loop-set", taskId: "a", loopVersion: 1 } });
      });
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return ["a", "b"].every((id) => workStatus(runtime, id) === "done") && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 360_000, "both tasks to settle");
      const runA = workRuns(runtime).find((run) => run.task === "a")!;
      const envelope = JSON.parse(readCanonicalRecord(runtime.store, runA.body.drive.envelopeHash));
      expect(envelope.work.contract.objective.goal).toBe("write shared.txt, changed after confirmation");
      expect(w.show("shared.txt")).toBe("A");
      expect(w.show("b.txt")).toBe("B");
      const after = snapshotOf(runtime);
      expect(after.proposalVersion).toBe(before.proposalVersion);
      expect(canonicalBytes(without(after, "a")).equals(canonicalBytes(without(before, "a")))).toBe(true);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
