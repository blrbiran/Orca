import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";

// Tester #171: a start-family wake the drainer keeps deferring was invisible -- the panel only suppressed its own
// "ready to start" suggestion, and nothing named the wake, its group or why it never delivered. The recovery read now
// says so, deriving the same three deferral conditions the drainer uses. Age is not available: scheduler_wakes has no
// timestamp column, and inventing one needs a migration.
async function storeWith(sql: string[]): Promise<{ store: Awaited<ReturnType<typeof openControlStore>>; dispose: () => Promise<void> }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-wakes-")));
  const store = await openControlStore({ stateDir: join(root, "state") });
  for (const statement of sql) store.db.prepare(statement).run();
  return { store, dispose: async () => { store.close(); } };
}
const wake = (id: string, groupId: string, kind: string): string =>
  `INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES ('${id}','${groupId}','${kind}','{}',0)`;
const group = (id: string, body: string): string => `INSERT INTO groups(id,revision,graph_version,body) VALUES ('${id}',1,1,'${body}')`;

describe("the recovery read names a start wake that never delivers (#171)", () => {
  it("reports a group-blocked wake, and says the blocker is what defers it", async () => {
    const { store, dispose } = await storeWith([
      group("g-blocked", JSON.stringify({ groupId: "g-blocked" })),
      "INSERT INTO recovery_blockers(id,group_id,run_id,scope,code,body) VALUES ('b1','g-blocked',NULL,'group','claim-blocked','{\"evidenceIds\":[]}')",
      wake("w1", "g-blocked", "start"),
    ]);
    try {
      const view = readControlRecovery(store, "epoch-test");
      expect(view.deferredWakes).toEqual([{ groupId: "g-blocked", kind: "start", reason: "group-blocker" }]);
    } finally { await dispose(); }
  }, 20000);

  it("reports a global dispatch block and an archived group, and leaves a delivered wake out", async () => {
    const { store, dispose } = await storeWith([group("g-archived", JSON.stringify({ groupId: "g-archived", archived: { at: 1_760_000_000_000, actor: "person" } })), wake("w2", "g-archived", "resume"), wake("w3", "g-archived", "start")]);
    try {
      store.dispatchBlocked = true;
      expect(readControlRecovery(store, "epoch-test").deferredWakes).toEqual([{ groupId: "g-archived", kind: "resume", reason: "dispatch-blocked" }, { groupId: "g-archived", kind: "start", reason: "dispatch-blocked" }]);
      store.dispatchBlocked = false;
      expect(readControlRecovery(store, "epoch-test").deferredWakes).toEqual([{ groupId: "g-archived", kind: "resume", reason: "group-archived" }, { groupId: "g-archived", kind: "start", reason: "group-archived" }]);
      store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE id='w3'").run();
      expect(readControlRecovery(store, "epoch-test").deferredWakes!.map((row) => row.kind)).toEqual(["resume"]);
    } finally { await dispose(); }
  }, 20000);

  it("says nothing when every start-family wake was delivered", async () => {
    const { store, dispose } = await storeWith([group("g-clear", JSON.stringify({ groupId: "g-clear" }))]);
    try {
      expect(readControlRecovery(store, "epoch-test")).not.toHaveProperty("deferredWakes");
    } finally { await dispose(); }
  }, 20000);
});
