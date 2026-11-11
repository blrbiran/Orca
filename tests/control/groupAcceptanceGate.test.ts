/**
 * Tester follow-up E §5 (#241): the gate the done pass, the integration pass and a dependent's prerequisite read
 * (groupAcceptanceRecord.ts acceptanceSatisfied), on raw rows (it reads the DB only). A recorded acceptance answers by its
 * result; with none recorded, only a group that needs none by definition (at most one landed task, a multi-directory or a
 * folder group) is accepted -- a group with two landings waits for the acceptance pass.
 */
import { describe, expect, it } from "vitest";
import { markGroupsDone } from "../../src/control/groupDone.js";
import { prerequisiteDone } from "../../src/control/groupEdges.js";
import { acceptanceSatisfied } from "../../src/control/groupAcceptanceRecord.js";
import { groupComplete } from "../../src/control/integrationPass.js";
import type { ControlStore } from "../../src/control/store.js";
import { openTestStore } from "./fixtures/store.js";

const SHA = "b".repeat(40);

/** A keep-delivery review group (done once its tasks are, before §5) with `landed` tasks landed, each by its own run. */
function group(store: ControlStore, landed: number, body: Record<string, unknown> = {}): void {
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',1,1,?)").run(JSON.stringify({ groupId: "g", planHash: "p".repeat(64), status: "review", stopped: false, ...body }));
  for (let index = 0; index < 2; index += 1) {
    store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES ('g',?,1,?)")
      .run(`t${index}`, JSON.stringify({ workItemId: `t${index}`, taskId: `t${index}`, kind: "task", status: "done", dependsOn: [] }));
    if (index < landed) store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,'g',?,1,0,?)")
      .run(`run-${index}`, `t${index}`, JSON.stringify({ runId: `run-${index}`, groupId: "g", taskId: `t${index}`, state: "settled", drive: { landedCommit: SHA } }));
  }
}
const status = (store: ControlStore) => (JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { status: string }).status;
const record = (result: string) => ({ acceptance: { tip: SHA, result, commands: [], at: 1 } });

describe("the acceptance gate on done (tester follow-up E §5)", () => {
  it("a group with two landed tasks and no acceptance recorded is not done, nor a done prerequisite", async () => {
    const h = await openTestStore(); try {
      group(h.store, 2);
      expect(prerequisiteDone(h.store, "g")).toBe(false);
      expect(h.store.transaction(() => markGroupsDone(h.store))).toEqual([]);
      expect(status(h.store)).toBe("review");
    } finally { await h.dispose(); }
  });

  it("one landed task needs no acceptance: done with nothing recorded", async () => {
    const h = await openTestStore(); try {
      group(h.store, 1);
      expect(h.store.transaction(() => markGroupsDone(h.store))).toEqual(["g"]);
    } finally { await h.dispose(); }
  });

  it("a multi-directory or folder group with two landings needs no record (its acceptance is not-run)", async () => {
    for (const body of [{ multiDir: { project: "p", dirs: [], landing: { state: "landed" } } }, { dirWorkspace: { dir: "/nowhere", vaultId: "e".repeat(64) } }]) {
      const h = await openTestStore(); try {
        group(h.store, 2, body);
        // The multi landing / placement clauses decide done; the acceptance gate does not hold either back.
        expect(acceptanceSatisfied(h.store, "g", body)).toBe(true);
      } finally { await h.dispose(); }
    }
  });

  // §5: a complete group is not delivered (trigger group, a PR marked ready, a multi landing) before it is accepted.
  it("groupComplete, which gates delivery, answers false for a failed or missing acceptance and true for a passed one", async () => {
    for (const [extra, complete] of [[{}, false], [record("failed"), false], [record("passed"), true]] as const) {
      const h = await openTestStore(); try {
        group(h.store, 2, extra);
        expect(groupComplete(h.store, "g"), JSON.stringify(extra)).toBe(complete);
      } finally { await h.dispose(); }
    }
  });

  it.each([["failed", false], ["passed", true], ["waived", true], ["not-needed", true], ["not-run", true]] as const)(
    "a recorded %s acceptance lets the group be done: %s", async (result, done) => {
      const h = await openTestStore(); try {
        group(h.store, 2, record(result));
        expect(prerequisiteDone(h.store, "g")).toBe(done);
        expect(h.store.transaction(() => markGroupsDone(h.store))).toEqual(done ? ["g"] : []);
      } finally { await h.dispose(); }
    });
});
