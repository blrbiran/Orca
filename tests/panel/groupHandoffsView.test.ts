/**
 * Tester follow-up G Parts 4.7 and 5 over a real Panel: the group view lists every run's handoff (by task, oldest first,
 * summary inline) and the Live notes with their state; a group with neither has exactly the view it had; one run's
 * stored handoff is read by its own route, and an unknown one is a 404 by name.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { groupViewSchema, taskHandoffContentSchema } from "../../src/control/webProtocol.js";
import { ingestRunHandoff, prepareRunHandoff } from "../../src/control/taskHandoffs.js";
import { GROUP, command, createHarness, get, json, revision, view } from "./fixtures/controlPanel.js";

const h = createHarness();
afterAll(async () => { await h.dispose(); });

async function importedPanel(epoch: string) {
  const panel = await h.boot(epoch, await h.workspace());
  const answer = await command(panel, "/api/control/groups/import-plan", {
    commandId: `${epoch}-import`, expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" },
  });
  expect(answer.status).toBe(201);
  return panel;
}
type P = Awaited<ReturnType<typeof importedPanel>>;
let clock = 1_000;
function finish(panel: P, taskId: string, runId: string, outcome: string, files: Record<string, string>) {
  const dirs = prepareRunHandoff(panel.store, GROUP, taskId, runId);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dirs.outputDir, name), text);
  ingestRunHandoff({ stateDir: panel.store.stateDir, now: () => (clock += 10) } as never, { groupId: GROUP, taskId, runId }, outcome, null);
}

describe("handoffs and live notes in the group view (Parts 4.7, 5)", () => {
  // mutation M-O5a: always emit `handoffs: []` -> the key is present (and the schema's min(1) refuses the view), red
  it("a group with no handoffs and no notes has neither key (the view is byte-identical to today's)", async () => {
    const panel = await importedPanel("epoch-handoffs-none");
    const body = await json(await get(panel, `/api/control/groups/${GROUP}`));
    expect(Object.hasOwn(body, "handoffs")).toBe(false);
    expect(Object.hasOwn(body, "liveNotes")).toBe(false);
    await panel.close();
  });

  it("lists every run's record per task, oldest first, with the summary text; notes with their state and delivery", async () => {
    const panel = await importedPanel("epoch-handoffs-list");
    finish(panel, "a", "run-a2", "succeeded", { "handoff.md": "A2", "summary.md": "second\n" });
    finish(panel, "a", "run-a1", "failed", { "summary.md": "first\n", "handoff.md": "x".repeat(8193) });
    const sent = await command(panel, `/api/control/groups/${GROUP}/tasks/a/live-notes`, { commandId: "note-1", expectedRevision: await revision(panel), payload: { text: "use v2" } });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ verb: "add-live-note", result: { kind: "live-note-queued", noteId: "note-1", taskId: "a" } });
    const v = groupViewSchema.parse(await view(panel));
    expect(v.handoffs).toEqual([
      { taskId: "a", runId: "run-a2", outcome: "succeeded", handoff: { state: "stored", reason: null, bytes: 2 }, summary: { state: "stored", reason: null, bytes: 7 }, summaryText: "second\n", recordedAt: 1010, notesMerged: 0 },
      { taskId: "a", runId: "run-a1", outcome: "failed", handoff: { state: "invalid", reason: "too-large", bytes: 8193 }, summary: { state: "stored", reason: null, bytes: 6 }, summaryText: "first\n", recordedAt: 1020, notesMerged: 0 },
    ]);
    expect(v.liveNotes).toEqual([{ noteId: "note-1", taskId: "a", text: "use v2", at: expect.any(Number), by: expect.any(String), state: "queued", delivered: null }]);
    await panel.close();
  });

  // mutation M-O5b: the read route swaps task and run in the file name -> nothing is found, red
  it("GET …/handoffs/:task/:run answers the stored bytes; an unknown run is 404 handoff-not-found", async () => {
    const panel = await importedPanel("epoch-handoffs-get");
    finish(panel, "a", "run-a1", "succeeded", { "handoff.md": "# Learned\nX\n", "summary.md": "did a\n" });
    const ok = await get(panel, `/api/control/groups/${GROUP}/handoffs/a/run-a1`);
    expect(ok.status).toBe(200);
    const content = taskHandoffContentSchema.parse(await json(ok));
    expect(content).toMatchObject({ groupId: GROUP, taskId: "a", runId: "run-a1", handoff: "# Learned\nX\n", summary: "did a\n", record: { runId: "run-a1", summaryText: "did a\n" } });
    for (const path of ["a/run-nope", "zz/run-a1", "a/..%2F..%2Fx"]) {
      const missing = await get(panel, `/api/control/groups/${GROUP}/handoffs/${path}`);
      expect(missing.status, path).toBe(404);
      expect(await json(missing), path).toMatchObject({ error: { code: "handoff-not-found" } });
    }
    await panel.close();
  });
});
