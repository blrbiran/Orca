import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { ControlService } from "../../src/control/service.js";
import { createGroup, putWork } from "../../src/control/commands.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { MAX_TIMER_MS } from "../../src/control/schema.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";
import { amount, caps, fixtureAgent, openTestStore, resolvedAs } from "./fixtures/store.js";

/**
 * Ledger W7 ruling (2026-10-01): ccloop hands a contract's phase timeout to Node's setTimeout, which turns any delay
 * above 2^31 - 1 ms into 1 ms -- a phase given "more than 24.8 days" would time out at once. So every phase timeout Orca
 * derives from a task's active time is capped at MAX_TIMER_MS, while the task's total active time stays what was granted.
 */
const ACTIVE_MS = 3_000_000_000;

async function confirmedWithHugeActiveTime() {
  // The hand-written contract asks for a phase timeout larger than both the active time and the cap.
  const h = await webFixture(undefined, [{ taskId: "a", perAttemptTimeoutMs: Number.MAX_SAFE_INTEGER }]);
  const service = new WebControlService(h.deps);
  const proposal = readBudgetProposal(h.store, "g");
  const edited = service.editProposal(h.command("proposal-edit", {
    baseProposalVersion: proposal.proposalVersion,
    proposedGroupLimit: { ...proposal.groupLimit, activeMs: proposal.groupLimit.activeMs + ACTIVE_MS },
    operations: [{ target: { scope: "task", taskId: "a", allocation: "work", dimension: "activeMs" }, value: ACTIVE_MS, provenance: "human" }],
  }));
  if ("error" in edited) throw new Error(JSON.stringify(edited));
  const confirmed = await service.confirm(h.command("confirm", await h.confirmPayload()));
  if ("error" in confirmed || confirmed.result.kind !== "confirmed") throw new Error(JSON.stringify(confirmed));
  return { h, snapshotHash: confirmed.result.executionSnapshotHash };
}

describe("a derived phase timeout stays within a Node timer's reach", () => {
  it("confirmation derives a phase timeout of MAX_TIMER_MS when the task's active time is larger", async () => {
    const { h, snapshotHash } = await confirmedWithHugeActiveTime();
    try {
      const snapshot = JSON.parse(readCanonicalRecord(h.store, snapshotHash));
      const derived = JSON.parse(readCanonicalRecord(h.store, snapshot.derivedContracts[0].derivedContractHash));
      const policy = JSON.parse(derived.contractCanonicalJson).executionPolicy;
      expect([policy.perAttemptTimeoutMs, policy.totalRuntimeBudgetMs]).toEqual([MAX_TIMER_MS, ACTIVE_MS]);
    } finally { await h.dispose(); }
  });

  it("the group view accepts that capped derived contract instead of calling it forged", async () => {
    const { h } = await confirmedWithHugeActiveTime();
    try {
      expect(() => readControlGroup(h.store, "epoch", "g")).not.toThrow();
    } finally { await h.dispose(); }
  });

  it("a reconciliation budget caps its phase timeout at MAX_TIMER_MS and keeps the granted active time", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, { groupId: "g1", projectKey: "example/repo", goal: "Ship", successConditions: ["checks pass"], budgetMode: "strict",
        limit: amount(100, 10_000_000_000, 100, 100), reviewReserve: amount(10, 100, 1, 1), deadlineAt: null }, { commandId: "create", expectedRevision: 0, by: "human" });
      putWork(h.store, "g1", { workItemId: "T1", taskId: "T1", kind: "task", dependsOn: [], contract: { scope: { allowedPaths: ["one"] } }, configHash: "config1",
        agent: fixtureAgent, grant: { work: amount(60, 100_000, 2, 2), handoff: amount(10, 1000, 0, 0) } }, { commandId: "w1", expectedRevision: 1, by: "human" });
      const service = new ControlService(h.store, { resolveAgent: async () => resolvedAs(caps) } as never,
        { reconcileGrant: { work: amount(7, ACTIVE_MS, 1, 1), handoff: amount(2, 50, 0, 0) } });
      const budget = await service.reconcileBudget("g1", "T1");
      expect([budget.perAttemptTimeoutMs, budget.totalRuntimeBudgetMs]).toEqual([MAX_TIMER_MS, ACTIVE_MS]);
    } finally { await h.dispose(); }
  });
});
