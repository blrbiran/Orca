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
    const { store, dispose } = await storeWith([group("g-archived", JSON.stringify({ groupId: "g-archived", archived: { at: 1_760_000_000_000, actor: "person" } })), wake("w2", "g-archived", "resume"), wake("w3", "g-archived", "start"), wake("w4", "g-archived", "no-start")]);
    try {
      // Ruling (2026-11-18 tester batch D review): #370 -- an archived group's queued start, or its no-start re-arm, does not
      // start it on unarchive (the unarchive pauses the group), so neither is listed as a start waiting on the archive (under
      // either reason); its resume wake still is.
      // mutation: skip only `start` for an archived group -> the no-start row is listed, red here
      // Ruling (2026-11-18 tester batch D review 2): the resume wake's row now also says it waits on the unarchive and a
      // person's resume (`waitsOn`), since the unarchive pauses the group.
      // mutation: drop `waitsOn` from the archived resume row -> red here
      store.dispatchBlocked = true;
      expect(readControlRecovery(store, "epoch-test").deferredWakes).toEqual([{ groupId: "g-archived", kind: "resume", reason: "dispatch-blocked", waitsOn: "unarchive-then-resume" }]);
      store.dispatchBlocked = false;
      expect(readControlRecovery(store, "epoch-test").deferredWakes).toEqual([{ groupId: "g-archived", kind: "resume", reason: "group-archived", waitsOn: "unarchive-then-resume" }]);
      store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE id='w2'").run();
      expect(readControlRecovery(store, "epoch-test")).not.toHaveProperty("deferredWakes");
    } finally { await dispose(); }
  }, 20000);

  // #355 review (minor 6): a closed group (the mark's closed kind, on a done group) is unclosed, not unarchived, before its
  // queued resume can deliver -- the row says so.
  it("says a closed group's resume wake waits on its unclose and a resume", async () => {
    const { store, dispose } = await storeWith([group("g-closed", JSON.stringify({ groupId: "g-closed", status: "done", archived: { at: 1_760_000_000_000, actor: "person", kind: "closed" } })), wake("w5", "g-closed", "resume")]);
    try {
      // mutation: waitsOn names unarchive-then-resume for both kinds -> red here
      expect(readControlRecovery(store, "epoch-test").deferredWakes).toEqual([{ groupId: "g-closed", kind: "resume", reason: "group-archived", waitsOn: "unclose-then-resume" }]);
    } finally { await dispose(); }
  }, 20000);

  it("names a group stopped at a spend cap and the command that raises it (tester follow-up K)", async () => {
    // Only the Overview read the spend-cap block, so `recovery list` said nothing while the group waited for a top-up.
    const block = JSON.stringify({ code: "spend-cap-reached", scope: "repo:r1", period: "week", capTokens: 500000, grantTokens: 120000, claim: "start" });
    const { store, dispose } = await storeWith([group("g-capped", JSON.stringify({ groupId: "g-capped" })), `INSERT INTO spend_cap_blocks(group_id,body) VALUES ('g-capped','${block}')`]);
    try {
      expect(readControlRecovery(store, "epoch-test").capBlocked).toEqual([{ groupId: "g-capped", scope: "repo:r1", period: "week", capTokens: 500000, grantTokens: 120000,
        next: "orca usage set-cap --scope repo:r1 --period week --tokens <more than 500000>" }]);
      store.db.prepare("DELETE FROM spend_cap_blocks").run();
      expect(readControlRecovery(store, "epoch-test")).not.toHaveProperty("capBlocked");
    } finally { await dispose(); }
  }, 20000);

  it("says nothing when every start-family wake was delivered", async () => {
    const { store, dispose } = await storeWith([group("g-clear", JSON.stringify({ groupId: "g-clear" }))]);
    try {
      expect(readControlRecovery(store, "epoch-test")).not.toHaveProperty("deferredWakes");
    } finally { await dispose(); }
  }, 20000);
});
