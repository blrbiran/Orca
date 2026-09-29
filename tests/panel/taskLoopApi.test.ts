import { writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LOOP_PLAN_IDS, currentLoopPlanVersion, loopPlanDefinition } from "../../src/control/loopPlans.js";
import { commandLookupSchema, commandSuccessSchema } from "../../src/control/webProtocol.js";
import { WEB_LOOP_PLANS } from "../../web/src/controlTypes.js";
import { GROUP, command, createHarness, get, json, view } from "./fixtures/controlPanel.js";

/**
 * Loop plans spec §5.2 over a real Panel: the one new POST route, a refusal that is ledgered and names its reason, a
 * wrong-shaped payload that never reaches the ledger, and the web mirror of the plans' names (spec §2.2).
 */
const h = createHarness();
afterAll(async () => { await h.dispose(); });

const LOOP_ROUTE = `/api/control/groups/${GROUP}/tasks/a/loop`;
const LOOP = { plan: "standard", goal: "ship a", successCondition: "a passes", targetPaths: ["a.ts"], checks: ["true"] };

async function importedLoopPanel(epoch: string) {
  const paths = await h.workspace();
  // The harness's plan names a contract file for task a; this criterion needs the same task as a loop task (spec §3.1).
  await writeFile(paths.planPath, JSON.stringify({
    targetRepo: paths.repo, ccloopBin: paths.binary, runsDir: dirname(paths.repo), workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo",
    goal: "Ship a", successConditions: ["a passes"], tasks: [{ taskId: "a", loop: LOOP, dependsOn: [], targetVersion: 1 }],
  }));
  const panel = await h.boot(epoch, paths);
  const answer = await command(panel, "/api/control/groups/import-plan", { commandId: `${epoch}-import`, expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
  expect(answer.status).toBe(201);
  return panel;
}
type Panel = Awaited<ReturnType<typeof importedLoopPanel>>;
/** A set-task-loop body built from what the panel shows, with `over` applied to the inputs. */
async function body(panel: Panel, commandId: string, over: Record<string, unknown> = {}) {
  const current = await view(panel);
  const plan = current.workItems[0]!.loopPlan!;
  const work = current.allocations.find((row) => row.ownerKind === "task" && row.ownerId === "a" && row.bucket === "work")!.amount;
  return { commandId, expectedRevision: current.summary.commandRevision,
    payload: { baseLoopVersion: plan.loopVersion, plan: plan.planId, inputs: { ...plan.inputs, ...over }, work: { tokens: work.tokens, activeMs: work.activeMs, attempts: work.attempts } } };
}

describe("the set-task-loop route (spec §5.2)", () => {
  it("changes a loop task over POST /tasks/:taskId/loop, and the view shows it amended", async () => {
    const panel = await importedLoopPanel("epoch-loop-set");
    const answer = await command(panel, LOOP_ROUTE, await body(panel, "loop-1", { goal: "ship a, changed" }));
    expect(answer.status).toBe(200);
    expect(commandSuccessSchema.parse(answer.body)).toMatchObject({
      verb: "set-task-loop", target: { kind: "task", groupId: GROUP, taskId: "a" }, result: { kind: "task-loop-set", taskId: "a", loopVersion: 1 },
    });
    expect((await view(panel)).workItems[0]!.loopPlan).toMatchObject({ amended: true, loopVersion: 1, inputs: { goal: "ship a, changed" } });
    await panel.close();
  });

  it("ledgers a refused path shape as loop-plan-invalid naming the reason", async () => {
    const panel = await importedLoopPanel("epoch-loop-invalid");
    const answer = await command(panel, LOOP_ROUTE, await body(panel, "loop-bad", { targetPaths: ["src/*.ts"] }));
    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ error: { code: "loop-plan-invalid", message: "loop-plan-invalid:path-shape" } });
    const lookup = commandLookupSchema.parse(await json(await get(panel, `/api/control/groups/${GROUP}/commands/loop-bad`)));
    expect(lookup).toMatchObject({ originalStatus: 422, body: { error: { code: "loop-plan-invalid" } } });
    await panel.close();
  });

  it("refuses a payload of the wrong shape before the ledger, as control-non-json-payload", async () => {
    const panel = await importedLoopPanel("epoch-loop-shape");
    const answer = await command(panel, LOOP_ROUTE, { commandId: "loop-shape", expectedRevision: (await view(panel)).summary.commandRevision, payload: { baseLoopVersion: 0, plan: "standard" } });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: { code: "control-non-json-payload" } });
    await panel.close();
  });

  it("mirrors every plan's current panel name on the web side", () => {
    expect(WEB_LOOP_PLANS.map((plan) => [plan.planId, plan.name]))
      .toEqual(LOOP_PLAN_IDS.map((planId) => [planId, loopPlanDefinition(planId, currentLoopPlanVersion(planId)!)!.name]));
  });
});
