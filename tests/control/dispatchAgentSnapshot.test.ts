import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { driverHarness } from "./fixtures/driverHarness.js";

// Orca backlog #13(c) (2026-09-29; agent selection spec §12 m-4, Orca handoff §9.0c): a work run dispatches the
// selection the confirmed snapshot froze for its task -- the claim ccloop receives is built from the run row
// (startEnvelope.ts frozenClaim), so a row that moved away from the snapshot would dispatch an unconfirmed agent or
// config. Only a damaged store gets there; it is blocked by name at A2, before any workspace or accept.
describe("A2 dispatches only the confirmed selection (backlog #13(c))", () => {
  it.each([
    { field: "configHash", tamper: (body: Record<string, unknown>) => { body.configHash = "f".repeat(64); } },
    { field: "agent", tamper: (body: Record<string, unknown>) => { body.agent = { ...(body.agent as Record<string, unknown>), model: "not-the-confirmed-model" }; } },
  ])("blocks a run whose $field no longer matches the snapshot, before any workspace or accept", async ({ tamper }) => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const body = t.body(runId);
      tamper(body);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
      await t.until(t.driver(), () => ["blocked", "accepted", "collected", "landed", "settled"].includes(t.body(runId).state));
      expect(t.body(runId)).toMatchObject({ state: "blocked", drive: { blockedAt: "A2", blockedReason: "agent-unfrozen", prepared: false } });
      expect(existsSync(t.body(runId).drive.workspacePath)).toBe(false);
      expect(t.fake.calls.accept).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });
});
