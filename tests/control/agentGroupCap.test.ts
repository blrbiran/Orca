import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { permissionRefusal } from "../../src/panel/permissions.js";
import { webFixture } from "./fixtures/web.js";

const agent = { kind: "agent" as const, client: "cli:claude" };
const dispatched = { ...agent, dispatchedRun: "run-1" };

describe("an attended agent can cap a draft group without gaining budget authority", () => {
  it("accepts a finite lower token ceiling and replays the same command without further change", async () => {
    const h = await webFixture();
    try {
      const service = new WebControlService(h.deps);
      const before = readBudgetProposal(h.store, "g");
      const limit = { ...before.groupLimit, tokens: before.groupLimit.tokens! - 500_000 };
      const payload = { baseProposalVersion: before.proposalVersion, operations: [], proposedGroupLimit: limit, capOnly: true as const };
      expect(permissionRefusal(agent, "proposal-edit", payload)).toBeNull();
      const command = h.command("proposal-edit", payload);
      expect(service.editProposal(command)).toMatchObject({ result: { kind: "proposal-edited", proposalVersion: before.proposalVersion + 1 } });
      expect(readBudgetProposal(h.store, "g").groupLimit).toEqual(limit);
      expect(service.editProposal(command)).toMatchObject({ result: { kind: "proposal-edited", proposalVersion: before.proposalVersion + 1 } });
      expect(readBudgetProposal(h.store, "g").proposalVersion).toBe(before.proposalVersion + 1);
    } finally { await h.dispose(); }
  });

  it("caps a previously unlimited draft without altering its task grants", async () => {
    const h = await webFixture();
    try {
      const service = new WebControlService(h.deps);
      const original = readBudgetProposal(h.store, "g");
      const unlimited = { ...original.groupLimit, tokens: null };
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: original.proposalVersion, operations: [], proposedGroupLimit: unlimited }))).toHaveProperty("result");
      const before = readBudgetProposal(h.store, "g");
      const capped = { ...before.groupLimit, tokens: original.groupLimit.tokens! - 500_000 };
      const payload = { baseProposalVersion: before.proposalVersion, operations: [], proposedGroupLimit: capped, capOnly: true as const };
      expect(service.editProposal(h.command("proposal-edit", payload))).toHaveProperty("result");
      const after = readBudgetProposal(h.store, "g");
      expect(after.groupLimit).toEqual(capped);
      expect(after.allocations.find(a => a.ownerId === "a" && a.bucket === "work")!.amount).toEqual(before.allocations.find(a => a.ownerId === "a" && a.bucket === "work")!.amount);
    } finally { await h.dispose(); }
  });

  it("rejects raising, clearing, or changing another dimension even if the caller claims capOnly", async () => {
    for (const change of [
      (limit: ReturnType<typeof readBudgetProposal>["groupLimit"]) => ({ ...limit, tokens: limit.tokens! + 1 }),
      (limit: ReturnType<typeof readBudgetProposal>["groupLimit"]) => ({ ...limit, tokens: null }),
      (limit: ReturnType<typeof readBudgetProposal>["groupLimit"]) => ({ ...limit, tokens: limit.tokens! - 500_000, attempts: limit.attempts + 1 }),
    ]) {
      const h = await webFixture();
      try {
        const service = new WebControlService(h.deps);
        const before = readBudgetProposal(h.store, "g");
        const payload = { baseProposalVersion: before.proposalVersion, operations: [], proposedGroupLimit: change(before.groupLimit), capOnly: true as const };
        expect(service.editProposal(h.command("proposal-edit", payload))).toMatchObject({ error: { code: "agent-group-cap-invalid" } });
        expect(readBudgetProposal(h.store, "g").groupLimit).toEqual(before.groupLimit);
      } finally { await h.dispose(); }
    }
  });

  it("refuses allocation edits hidden inside a cap request", async () => {
    const h = await webFixture();
    try {
      const service = new WebControlService(h.deps), before = readBudgetProposal(h.store, "g");
      const payload = { baseProposalVersion: before.proposalVersion, capOnly: true as const,
        proposedGroupLimit: { ...before.groupLimit, tokens: before.groupLimit.tokens! - 500_000 },
        operations: [{ target: { scope: "task" as const, taskId: "a", allocation: "work" as const, dimension: "tokens" as const }, value: 2_000_000, provenance: "human" as const }] };
      expect(service.editProposal(h.command("proposal-edit", payload))).toMatchObject({ error: { code: "agent-group-cap-invalid" } });
      expect(readBudgetProposal(h.store, "g").proposalVersion).toBe(before.proposalVersion);
    } finally { await h.dispose(); }
  });

  it("rejects a stale proposal and retains the human-only rule for ordinary edits", async () => {
    const h = await webFixture();
    try {
      const service = new WebControlService(h.deps), before = readBudgetProposal(h.store, "g");
      const lower = { ...before.groupLimit, tokens: before.groupLimit.tokens! - 500_000 };
      const first = h.command("proposal-edit", { baseProposalVersion: before.proposalVersion, operations: [], proposedGroupLimit: lower, capOnly: true });
      expect(service.editProposal(first)).toHaveProperty("result");
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: before.proposalVersion, operations: [], proposedGroupLimit: { ...lower, tokens: lower.tokens! - 1 }, capOnly: true }))).toMatchObject({ error: { code: "proposal-version-conflict" } });
      expect(permissionRefusal(agent, "proposal-edit", { baseProposalVersion: before.proposalVersion, operations: [], proposedGroupLimit: lower })?.code).toBe("control-person-token-required");
      expect(permissionRefusal(dispatched, "proposal-edit", { baseProposalVersion: before.proposalVersion, operations: [], proposedGroupLimit: lower, capOnly: true })?.code).toBe("control-dispatched-run-refused");
    } finally { await h.dispose(); }
  });
});
