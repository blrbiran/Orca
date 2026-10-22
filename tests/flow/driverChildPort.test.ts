/**
 * Flow engine spec §6.2-§6.3 (plan Task 10, C14/C15 part): the driver-backed child port. A `work` execution's child is
 * a group of its own -- the parent never gets a task -- imported with no estimate, its work grant exactly the allocation
 * drawn from the pool (no handoff or goal-review allowance on top), delivery keep, the `flow` child block, and confirmed
 * once by orca-auto with the parent's profiles under a deterministic command id. A second open (a restart) adds nothing.
 * Without these the child could spend past its draw, integrate, run under profiles nobody froze, or be opened twice.
 */
import { describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { buildFlowStepPlanSource } from "../../src/control/flowStepPlan.js";
import { ORCHESTRATION_ACTOR } from "../../src/control/orchestration.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { CHILD_CONFIRM_COMMAND_ID, createDriverChildPort } from "../../src/flow/childPort.js";
import { flowVaultRepoId } from "../../src/flow/groups.js";
import type { FlowChildOpen } from "../../src/flow/kinds/work.js";
import { parentGroupBody } from "../../src/flow/parent.js";
import { insertFlowRun } from "../../src/flow/store.js";
import type { FlowStep } from "../../src/flow/template/schema.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

const VAULT_ID = "e".repeat(64);
const BASE = "a".repeat(40);
const STEP = { id: "write", kind: "work", prompt: "p.md" } as FlowStep;

async function world(withChildren = true) {
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const binding = { profileId: "all", profileHash: h.frozen.profileHash };
  h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('flow-1',0,1,0,?)").run(JSON.stringify(parentGroupBody({
    groupId: "flow-1", flowRunId: "fr-1", projectId: null, workspaceKind: "dir", vaultId: VAULT_ID, repoId: flowVaultRepoId(VAULT_ID), poolTokens: 500_000, at: 1, goal: "flow",
    confirmation: { call: null, children: withChildren ? { budgetMode: "soft", profiles: { estimator: binding, worker: binding, handoff: binding, goalReview: binding }, contextPolicy: { handoffAtContextTokens: 800_000 } } : null },
  })));
  insertFlowRun(h.store, {
    id: "fr-1", groupId: "flow-1", templateRef: "builtin/x", templateSha256: "t", workspace: { projectId: null, kind: "dir" }, vaultId: VAULT_ID,
    paramsSha256: "p", poolTokens: 500_000, poolDrawn: 70_000, state: "running", revision: 0, body: {},
  });
  const service = new WebControlService(h.deps);
  const port = createDriverChildPort({
    store: h.store, env: { ORCA_VAULT_DIR: h.root }, importDeps: h.deps, confirm: (command) => service.confirm(command as never), admissionGate: h.deps.admissionGate,
    selectionsHash: async (groupId) => (await resolveGroupSelections({ store: h.store, port: h.deps.port }, groupId, ORCHESTRATION_ACTOR)).selectionsHash,
  });
  const request: FlowChildOpen = {
    childGroupId: "flow-fr-1-write-1", parentGroupId: "flow-1", flowRunId: "fr-1", stepKey: "write", seq: 1, baseCommit: BASE, vaultPath: `${h.root}/${VAULT_ID}.git`,
    plan: buildFlowStepPlanSource({ flowRunId: "fr-1", step: STEP, seq: 1, baseCommit: BASE, vaultPath: `${h.root}/${VAULT_ID}.git`, promptEnvelope: "Write.", gates: [], agent: { agent: "codex" } }),
    work: { tokens: 70_000, activeMs: 1, attempts: 1, sessions: 1 }, skills: [], effectRecordId: null,
  };
  return { h, port, request };
}
const body = (h: Awaited<ReturnType<typeof webFixture>>, id: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body));
const count = (h: Awaited<ReturnType<typeof webFixture>>, sql: string, ...args: string[]) => Number(h.store.db.prepare(sql).get(...args)!.n);

describe("the driver-backed child port (§6.2)", () => {
  it("opens the step as its own group: vault repo, no estimate, the draw as its whole budget, keep, the child block; orca-auto confirms it once", async () => {
    const { h, port, request } = await world(); try {
      // The vault's repository has a non-keep default: a flow child keeps all the same (§5.1).
      writeRepositorySettingsBody(h.store, flowVaultRepoId(VAULT_ID), { workspaceMode: "worktree", revision: 1, integration: { delivery: "local", trigger: "task", method: "merge", target: "main" } });
      await port.open(request);
      const child = body(h, request.childGroupId);
      expect(child.flow).toEqual({ role: "child", flowRunId: "fr-1", parentGroupId: "flow-1", stepKey: "write", seq: 1, baseCommit: BASE });
      expect(child.plan.repoId).toBe(flowVaultRepoId(VAULT_ID));
      expect(Object.hasOwn(child, "integration")).toBe(false);
      expect(child.limit.tokens).toBe(70_000);
      const works = h.store.db.prepare("SELECT body FROM work_items WHERE group_id=?").all(request.childGroupId).map((row) => JSON.parse(String(row.body)));
      expect(works.map((w) => [w.taskId, w.grant.work.tokens, w.grant.handoff.tokens])).toEqual([["step", 70_000, 0]]);
      // The parent never gets a task, an estimate or a proposal.
      expect(count(h, "SELECT count(*) AS n FROM work_items WHERE group_id='flow-1'")).toBe(0);
      expect(count(h, "SELECT count(*) AS n FROM estimates WHERE group_id=?", request.childGroupId)).toBe(0);
      const proposal = readBudgetProposal(h.store, request.childGroupId);
      expect(proposal.state).toBe("confirmed");
      expect(proposal.profiles!.worker).toEqual({ profileId: "all", profileHash: h.frozen.profileHash });
      expect(h.store.db.prepare("SELECT id, actor_id FROM commands WHERE group_id=?").all(request.childGroupId).map((r) => [String(r.id), String(r.actor_id)]))
        .toEqual([[CHILD_CONFIRM_COMMAND_ID, ORCHESTRATION_ACTOR]]);
      expect((await port.status(request.childGroupId))).toEqual({ state: "running" });
      // A restart opens it again: nothing is added.
      await port.open(request);
      expect(count(h, "SELECT count(*) AS n FROM groups WHERE id LIKE 'flow-fr-1-%'")).toBe(1);
      expect(count(h, "SELECT count(*) AS n FROM commands WHERE group_id=?", request.childGroupId)).toBe(1);
      expect(await port.status("g")).toBe(null);
    } finally { await h.dispose(); }
  });

  it("a parent confirmed without children's profiles cannot confirm a child (nothing is borrowed)", async () => {
    const { h, port, request } = await world(false); try {
      await expect(port.open(request)).rejects.toThrow("flow-parent-unconfirmed:flow-1");
      expect(readBudgetProposal(h.store, request.childGroupId).state).not.toBe("confirmed");
    } finally { await h.dispose(); }
  });
});
