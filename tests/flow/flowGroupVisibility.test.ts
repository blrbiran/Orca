/**
 * Flow engine spec §6.2 (plan Task 10): a flow run's `work` children are hidden from the summary (and so the kanban);
 * the run is shown by its run page (Task 16). `maxRunningGroups` counts the flow's parent only: a running run holds one
 * slot, and its children run under it -- a child never waits for a slot its own parent holds, and never takes a second.
 * Without these a flow of five steps would take five slots (or deadlock behind its own parent at cap 1), and a child's
 * card (or the parent's run row, which is not a plan group) would stand on the board.
 */
import { describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { runningGroupIds } from "../../src/control/orchestration.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { recordProjectionChange } from "../../src/control/projectionJournal.js";
import { WebControlService } from "../../src/control/webService.js";
import { insertFlowRun, setFlowRunState } from "../../src/flow/store.js";
import { readControlOverview } from "../../src/panel/controlOverview.js";
import { readControlSummary } from "../../src/panel/controlViews.js";
import { profileSnapshot, webFixture } from "../control/fixtures/web.js";

type H = Awaited<ReturnType<typeof webFixture>>;
const revisionOf = (h: H, id: string) => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(id)!.revision);
let sequence = 0;
async function confirm(h: H, service: WebControlService, groupId: string) {
  const payload = {
    planHash: readArchivedPlan(h.store, groupId).planHash, proposalVersion: readBudgetProposal(h.store, groupId).proposalVersion, budgetMode: "strict" as const,
    profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
    profileHashes: { estimator: h.frozen.profileHash, worker: h.frozen.profileHash, handoff: h.frozen.profileHash, goalReview: h.frozen.profileHash },
    contextPolicy: { handoffAtContextTokens: 800_000 },
    selectionsHash: (await resolveGroupSelections({ store: h.store, port: h.deps.port }, groupId, "human")).selectionsHash ?? "0".repeat(64),
  };
  const answer = await service.confirm(h.rawCommand(`confirm-${groupId}-${++sequence}`, revisionOf(h, groupId), "confirm", { kind: "group", groupId }, payload) as never);
  if ("error" in (answer as object)) throw new Error(JSON.stringify(answer));
}
const setCap = (h: H, service: WebControlService, maxRunningGroups: number) => service.setOrchestrationSettings(h.rawCommand(`cap-${++sequence}`,
  Number(h.store.db.prepare("SELECT revision FROM orchestration_settings").get()?.revision ?? 0), "set-orchestration-settings", { kind: "orchestration" }, { maxRunningGroups }) as never);

/** A running flow run whose parent is the bare row startFlowRun writes. */
function flowParent(h: H): void {
  h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('flow-1',0,1,0,?)").run(JSON.stringify({ groupId: "flow-1", status: "flow", flow: { role: "parent", flowRunId: "fr-1" } }));
  insertFlowRun(h.store, {
    id: "fr-1", groupId: "flow-1", templateRef: "builtin/x", templateSha256: "t", workspace: { projectId: null, kind: "dir" }, vaultId: "f".repeat(64),
    paramsSha256: "p", poolTokens: 1, poolDrawn: 0, state: "running", revision: 0, body: {},
  });
}
function asChild(h: H, groupId: string): void {
  const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body));
  h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, flow: { role: "child", flowRunId: "fr-1", parentGroupId: "flow-1", stepKey: "write", seq: 1 } }), groupId);
}

describe("flow groups on the board and in the slot count (§6.2)", () => {
  it("the summary lists neither the run's parent row nor its children, on a full read and on a change read", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
      flowParent(h);
      const full = readControlSummary(h.store, "e", null);
      expect(full.groups.map((g) => g.groupId)).toEqual(["g"]);
      asChild(h, "g");
      h.store.transaction(() => recordProjectionChange(h.store, ["g", "flow-1"]));
      expect(readControlSummary(h.store, "e", full.changeSeq).groups.map((g) => g.groupId)).toEqual([]);
      expect(readControlSummary(h.store, "e", null).groups.map((g) => g.groupId)).toEqual([]);
      // Nor the overview: the parent's row is no plan group to report as a stored-group issue.
      expect(readControlOverview(h.store, "e").issues).toEqual([]);
    } finally { await h.dispose(); }
  });

  it("a running flow run holds one slot through its parent; its child starts under it at cap 1 and holds none", async () => {
    for (const child of [false, true]) {
      const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]); try {
        const service = new WebControlService(h.deps);
        flowParent(h);
        await confirm(h, service, "g");
        if (child) asChild(h, "g");
        await setCap(h, service, 1);
        expect(runningGroupIds(h.store)).toEqual(["flow-1"]);
        expect(await service.autoStart()).toEqual({ started: child ? ["g"] : [], refused: [] });
        expect(runningGroupIds(h.store)).toEqual(["flow-1"]);
        h.store.transaction(() => setFlowRunState(h.store, "fr-1", "running", "done"));
        expect(runningGroupIds(h.store)).toEqual([]);
      } finally { await h.dispose(); }
    }
  });
});
