import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture, profileSnapshot } from "./fixtures/web.js";
import { recordUsage } from "../../src/control/usage.js";
import { claimWork } from "../../src/control/budget.js";
import { caps } from "./fixtures/store.js";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalBytes } from "../../src/control/canonicalJson.js";

describe("atomic confirmation", () => {
  it("freezes every profile and derived grant and invalidates confirmation on prestart edit", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps);
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): confirmation resolves the selections through ccloop
      // first, so it is awaited and carries the previewed selectionsHash; the frozen profiles and grants, the replay of the
      // same command and the reopening edit are asserted exactly as before.
      const command = h.command("confirm", await h.confirmPayload());
      const result = await service.confirm(command);
      expect(result).toMatchObject({ result: { kind: "confirmed" } });
      if ("error" in result || result.result.kind !== "confirmed") throw new Error("confirmation failed");
      const snapshot = JSON.parse(readCanonicalRecord(h.store, result.result.executionSnapshotHash));
      expect(snapshot.profiles.worker.profileHash).toBe(h.frozen.profileHash);
      const derived = JSON.parse(readCanonicalRecord(h.store, snapshot.derivedContracts[0].derivedContractHash));
      expect(JSON.parse(derived.contractCanonicalJson).executionPolicy).toEqual({ autonomyLevel: "L2", worktreeRequired: true, maxAttempts: 3, tokenBudget: 3000000, totalRuntimeBudgetMs: 14400000, perAttemptTimeoutMs: 60000, partialOutcomeRecoveryWindowMs: 30000 });
      expect(derived.confirmedGrant.work.sessions).toBe(3);
      expect(readControlGroup(h.store, "epoch", "g").summary.state).toBe("ready");
      expect(await service.confirm(command)).toEqual(result);
      expect(service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [{ target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" }, value: 2000000, provenance: "human" }] }))).toMatchObject({ result: { proposalVersion: 2 } });
      expect(readBudgetProposal(h.store, "g").executionSnapshotHash).toBeNull();
      expect(readControlGroup(h.store, "epoch", "g").summary.state).toBe("draft");
    } finally { await h.dispose(); }
  });
  it("updates the reserved goal-review grant and rejects understated live commitments", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps);
      service.editProposal(h.command("proposal-edit", { baseProposalVersion: 1, operations: [{ target: { scope: "goal-review", dimension: "tokens" }, value: 500000, provenance: "human" }] }));
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the confirmation is awaited and carries the previewed
      // selectionsHash; the reserved review grant and the refused understated commitment are asserted as before.
      await service.confirm(h.command("confirm", await h.confirmPayload()));
      const group = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      expect(group.reviewRemaining.tokens).toBe(500000);
      const proposal = readBudgetProposal(h.store, "g");
      group.status = "running"; group.reserved.tokens -= 100; group.ledger.committedRemaining.tokens -= 100;
      group.ledger.explicitUnallocatedReserve.tokens += 100; proposal.explicitUnallocatedReserve.tokens += 100;
      proposal.allocations.find(a => a.ownerKind === "reserve")!.amount.tokens += 100;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
      h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(canonicalBytes(proposal).toString("utf8"));
      expect(service.setLimit(h.command("set-limit", { limit: { ...proposal.groupLimit, tokens: proposal.groupLimit.tokens + 1000 } }))).toMatchObject({ error: { code: "recovery-blocked" } });
    } finally { await h.dispose(); }
  });
  it("reads only archived derived execution authority after the original source changes", async () => {
    const h = await webFixture(); try {
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the confirmation is awaited and carries the previewed
      // selectionsHash; only archived authority is read afterwards, as before.
      const service = new WebControlService(h.deps); await service.confirm(h.command("confirm", await h.confirmPayload()));
      await writeFile(join(h.root, "contract.json"), "damaged mutable source");
      const resolved = readConfirmedTaskExecution(h.store, "g", "a");
      expect(resolved.contract.executionPolicy.tokenBudget).toBe(3000000);
      expect(resolved.grant.work.sessions).toBe(3);
      expect(resolved.derivedContractHash).toMatch(/^[a-f0-9]{64}$/);
    } finally { await h.dispose(); }
  });
  it("confirms against remaining active estimate commitment after accounted usage", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps), run = await service.claimEstimate("g", h.estimateId);
      recordUsage(h.store, { runId: run!.runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 1000, activeMs: 100, attempts: 0, sessions: 0 }, source: { artifactId: "observed", hash: "a".repeat(64) } });
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): awaited, with the previewed selectionsHash; it still
      // confirms against the remaining estimate commitment and conserves the ledger.
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).toMatchObject({ result: { kind: "confirmed" } });
      const view = readControlGroup(h.store, "epoch", "g");
      expect(view.ledger.used.tokens).toBe(1000);
      expect(view.ledger.used.tokens + view.ledger.committedRemaining.tokens + view.ledger.explicitUnallocatedReserve.tokens).toBe(view.ledger.groupLimit.tokens);
    } finally { await h.dispose(); }
  });
  it("blocks ordinary claims while a Web proposal is draft", async () => {
    const h = await webFixture(); try {
      expect(() => claimWork(h.store, { groupId: "g", workItemId: "a", commandId: "legacy-claim", expectedRevision: 1, by: "service", graphVersion: 1, targetVersion: 1, capabilities: caps })).toThrow("group-state-invalid");
      expect(h.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n).toBe(0);
    } finally { await h.dispose(); }
  });
  it("rejects model-assisted handoff without all required grant dimensions", async () => {
    const profile = profileSnapshot(); profile.profile.capabilities.handoffExecution = "model-assisted-v1";
    const h = await webFixture(profile); try {
      const service = new WebControlService(h.deps);
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): awaited, with the previewed selectionsHash; the
      // model-assisted grant check still refuses it and leaves the proposal editable.
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).toMatchObject({ error: { code: "handoff-grant-insufficient" } });
      expect(readBudgetProposal(h.store, "g").state).toBe("editable");
    } finally { await h.dispose(); }
  });
  it("set-limit changes only live ceiling/reserve and preserves readable frozen authority", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps);
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): awaited, with the previewed selectionsHash; set-limit
      // is still judged against the frozen authority exactly as before.
      await service.confirm(h.command("confirm", await h.confirmPayload()));
      const before = readBudgetProposal(h.store, "g");
      const limit = { ...before.groupLimit, tokens: before.groupLimit.tokens + 500000 };
      expect(service.setLimit(h.command("set-limit", { limit }))).toMatchObject({ result: { kind: "limit-set", limit } });
      const after = readBudgetProposal(h.store, "g");
      expect(after.executionSnapshotHash).toBe(before.executionSnapshotHash);
      expect(after.explicitUnallocatedReserve.tokens).toBe(before.explicitUnallocatedReserve.tokens + 500000);
      expect(readControlGroup(h.store, "epoch", "g").ledger.groupLimit).toEqual(limit);
    } finally { await h.dispose(); }
  });
  it("rolls back confirmation for unknown usage, invalid context and publication failure", async () => {
    const h = await webFixture(); try {
      const service = new WebControlService(h.deps);
      // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): each confirmation is awaited and carries the
      // previewed selectionsHash, and a throw inside the transaction is a rejected promise; the same three refusals roll
      // back the same way (no snapshot row, proposal still editable).
      expect(await service.confirm(h.command("confirm", { ...(await h.confirmPayload()), contextPolicy: { handoffAtContextTokens: 1000001 } }))).toMatchObject({ error: { code: "execution-policy-unrepresentable" } });
      const group = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      group.ledger.usageUnknown = true; h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
      expect(await service.confirm(h.command("confirm", await h.confirmPayload()))).toMatchObject({ error: { code: "recovery-blocked" } });
      group.ledger.usageUnknown = false; h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
      const count = h.store.db.prepare("SELECT count(*) AS n FROM execution_snapshots").get()!.n;
      const crashing = new WebControlService({ ...h.deps, beforeCommit: () => { throw new Error("interrupted"); } });
      await expect(crashing.confirm(h.command("confirm", await h.confirmPayload()))).rejects.toThrow("interrupted");
      expect(h.store.db.prepare("SELECT count(*) AS n FROM execution_snapshots").get()!.n).toBe(count);
      expect(readBudgetProposal(h.store, "g").state).toBe("editable");
    } finally { await h.dispose(); }
  });
});
