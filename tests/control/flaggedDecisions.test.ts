import { describe, expect, it } from "vitest";
import { flagDecision, listFlaggedDecisions, readFlaggedDecision } from "../../src/control/flaggedDecisions.js";
import { WebControlService } from "../../src/control/webService.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

// Kanban spec 2026-10-20 §9a (controller's call): a landed decision Orca flags for a person. Every assertion reads the
// store or the service's answer, after the call under test.
type H = Awaited<ReturnType<typeof webFixture>>;
const flag = (h: H, decisionId: string, reason = "reconcile merged both sides", groupId = "g") => h.store.transaction(() => flagDecision(h.store, {
  decisionId, groupId, runId: null, source: "reconcile", reason, evidence: ["merged a.ts"], by: "orca-auto", at: "2026-10-21T00:00:00.000Z",
}));
const failure = (result: unknown) => (result as { error?: { code: string } }).error?.code ?? null;

describe("flagged decisions (kanban spec §9a)", () => {
  it("flags a decision once: a second flag of the same id keeps the first row and says it wrote nothing", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      expect(flag(h, "r1/agent-0", "first")).toBe(true);
      // mutation: ON CONFLICT DO UPDATE (or no guard) -> the reason becomes "second", red
      expect(flag(h, "r1/agent-0", "second")).toBe(false);
      expect(listFlaggedDecisions(h.store, "g").map((row) => [row.decisionId, row.state, row.reason, row.flaggedBy])).toEqual([["r1/agent-0", "flagged", "first", "orca-auto"]]);
    } finally { await h.dispose(); }
  });

  it("refuses a source that is not a kebab-case name", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      expect(() => h.store.transaction(() => flagDecision(h.store, { decisionId: "x", groupId: "g", runId: null, source: "Reconcile!", reason: "r", evidence: [], by: "orca-auto", at: "t" }))).toThrow();
      expect(readFlaggedDecision(h.store, "x")).toBeNull();
    } finally { await h.dispose(); }
  });

  it("ratify clears the flag and records who; a second ratify is a no-op command; the flag stays ratified when flagged again", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      flag(h, "r1/agent-0");
      const first = service.ratifyFlaggedDecision(h.command("ratify-flagged-decision", { decisionId: "r1/agent-0" }));
      expect(first).toMatchObject({ verb: "ratify-flagged-decision", result: { kind: "flagged-decision-ratified", decisionId: "r1/agent-0" } });
      expect(readFlaggedDecision(h.store, "r1/agent-0")).toMatchObject({ state: "ratified", ratifiedBy: "human" });
      // mutation: drop the ratified check -> 200 again instead of no-op-command, red
      expect(failure(service.ratifyFlaggedDecision(h.command("ratify-flagged-decision", { decisionId: "r1/agent-0" })))).toBe("no-op-command");
      flag(h, "r1/agent-0", "again");
      expect(readFlaggedDecision(h.store, "r1/agent-0")).toMatchObject({ state: "ratified", reason: "reconcile merged both sides" });
    } finally { await h.dispose(); }
  });

  it("refuses an unknown id, and another group's flag, as flagged-decision-not-found", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      const service = new WebControlService(h.deps);
      h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('other',1,1,'{}')").run();
      flag(h, "r9/agent-0", "elsewhere", "other");
      expect(failure(service.ratifyFlaggedDecision(h.command("ratify-flagged-decision", { decisionId: "nope" })))).toBe("flagged-decision-not-found");
      // mutation: drop the group_id comparison -> the other group's flag is ratified from "g", red
      expect(failure(service.ratifyFlaggedDecision(h.command("ratify-flagged-decision", { decisionId: "r9/agent-0" })))).toBe("flagged-decision-not-found");
      expect(readFlaggedDecision(h.store, "r9/agent-0")!.state).toBe("flagged");
    } finally { await h.dispose(); }
  });
});
