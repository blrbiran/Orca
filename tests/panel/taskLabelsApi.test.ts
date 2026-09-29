/**
 * Labels and progress spec §3.1 and §8 R7-R9 over a real Panel: the one new POST route, a vocabulary refusal that is
 * ledgered (not a malformed request), and a wrong-shaped payload that never reaches the ledger.
 */
import { afterAll, describe, expect, it } from "vitest";
import { SYSTEM_LABELS } from "../../src/control/labels.js";
import { commandLookupSchema, commandSuccessSchema } from "../../src/control/webProtocol.js";
import { GROUP, command, createHarness, get, json, revision, view } from "./fixtures/controlPanel.js";

const h = createHarness();
afterAll(async () => { await h.dispose(); });

const LABELS = `/api/control/groups/${GROUP}/tasks/a/labels`;

async function importedPanel(epoch: string) {
  const panel = await h.boot(epoch, await h.workspace());
  const answer = await command(panel, "/api/control/groups/import-plan", {
    commandId: `${epoch}-import`, expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" },
  });
  expect(answer.status).toBe(201);
  return panel;
}

describe("the set-task-labels route (spec §3.1, §8 R7-R9)", () => {
  it("R9: sets a task's labels over POST /tasks/:taskId/labels, moving the group's revision once", async () => {
    const panel = await importedPanel("epoch-labels-set");
    const before = await view(panel);
    const answer = await command(panel, LABELS, {
      commandId: "labels-1", expectedRevision: before.summary.commandRevision, payload: { labels: ["custom:前端", "bug"], baseLabelsVersion: 0 },
    });
    expect(answer.status).toBe(200);
    expect(commandSuccessSchema.parse(answer.body)).toMatchObject({
      verb: "set-task-labels", target: { kind: "task", groupId: GROUP, taskId: "a" }, result: { kind: "task-labels-set", taskId: "a", labelsVersion: 1 },
    });
    const after = await view(panel);
    expect(after.summary.commandRevision).toBe(before.summary.commandRevision + 1);
    expect(after.changeSeq).toBeGreaterThan(before.changeSeq);
    expect(after.workItems[0]).toMatchObject({ labels: ["bug", "custom:前端"], labelsProvenance: "operator", labelsVersion: 1 });
    await panel.close();
  });

  it("R8: refuses a 17th distinct label as a ledgered labels-invalid naming the count, not as a malformed request", async () => {
    const panel = await importedPanel("epoch-labels-invalid");
    const labels = [...SYSTEM_LABELS, ...Array.from({ length: 7 }, (_, i) => `custom:c${i}`)];
    const answer = await command(panel, LABELS, { commandId: "labels-17", expectedRevision: await revision(panel), payload: { labels, baseLabelsVersion: 0 } });
    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({ error: { code: "labels-invalid", message: "labels-invalid:count:17" } });
    const lookup = commandLookupSchema.parse(await json(await get(panel, `/api/control/groups/${GROUP}/commands/labels-17`)));
    expect(lookup).toMatchObject({ originalStatus: 422, body: { error: { code: "labels-invalid" } } });
    await panel.close();
  });

  it("R8: a payload of the wrong shape is refused before the ledger, as control-non-json-payload", async () => {
    const panel = await importedPanel("epoch-labels-shape");
    const answer = await command(panel, LABELS, { commandId: "labels-shape", expectedRevision: await revision(panel), payload: { labels: [1], baseLabelsVersion: 0 } });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: { code: "control-non-json-payload" } });
    await panel.close();
  });
});
