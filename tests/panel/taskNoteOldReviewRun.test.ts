import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import type { Principal } from "../../src/panel/permissions.js";
import { reviewWorld, verdicts } from "../control/fixtures/reviewWorld.js";
import { overSocket } from "./fixtures/socketPanel.js";

/**
 * Tester #282, follow-up I: on an older build a group holding a requirement-review run row without `estimateId` answered
 * 423 `recovery-blocked:run-invalid` not only to `group show` / `proposal show` but also to
 * `orca task note <group> <task> --text …`: the CLI reads the group's revision from the summary first, and every read of
 * that group built its view over the bad row. Here the row is written as the old writer did (no `estimateId`) and the
 * note travels the socket route the CLI uses, as an agent on the socket: summary read, then the live-notes POST, then
 * the two reads `group show` and `proposal show` make.
 */
const agent: Principal = { kind: "agent", client: "mcp:test" };
const fixFiles = (id: string): Record<string, string | null> => (id.startsWith("review-fix-") ? { a: `fixed a by ${id}\n` } : { [id]: `${id}\n` });

describe("task note on a group holding a requirement-review run stored without estimateId (#282)", () => {
  it("the CLI's socket path queues the note, and group show / proposal show read", async () => {
    // A not-met round opens a fix task, so the group has a task a note can still reach.
    const w = await reviewWorld({ harness: { files: fixFiles }, answer: () => ({ outcome: "complete", output: verdicts({ AC1: "not-met", AC2: "met" }) }) });
    const app = express(); app.use(express.json());
    app.use((_req, res, next) => { res.locals.orcaPrincipal = agent; next(); });
    registerControlReadRoutes(app, { store: w.t.h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service: w.t.service }, "socket");
    const server = createServer(app), socketPath = join(w.t.h.root, "note.sock");
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "fixing", 120);
      const store = w.t.h.store;
      const review = store.db.prepare("SELECT id FROM runs WHERE group_id='g' AND json_extract(body,'$.purpose')='requirement-review'").get();
      expect(review).toBeDefined();
      // As the old writer stored it: no estimateId key at all.
      store.db.prepare("UPDATE runs SET body=json_remove(body,'$.estimateId') WHERE id=?").run(String(review!.id));
      expect(JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(String(review!.id))!.body))).not.toHaveProperty("estimateId");
      expect(JSON.parse(String(store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='review-fix-1'").get()!.body)).status).not.toBe("done");

      // `orca task note` step 1 (commands/write.ts readRevision): the group's commandRevision from the summary.
      const summary = await overSocket(socketPath, "GET", "/api/control/summary", { "x-orca-client": "mcp:test" });
      expect(summary.status, summary.text).toBe(200);
      const revision = (JSON.parse(summary.text) as { groups: Array<{ groupId: string; commandRevision: number }> }).groups.find((g) => g.groupId === "g")?.commandRevision;
      expect(typeof revision).toBe("number");
      // Step 2: the add-live-note POST on the task's live-notes route (on this build it does not read the group view).
      const note = await overSocket(socketPath, "POST", "/api/control/groups/g/tasks/review-fix-1/live-notes", { "x-orca-client": "mcp:test" },
        { commandId: "note-282", expectedRevision: revision, payload: { text: "the fixture lives in test/data" } });
      expect(note.status, note.text).toBe(200);
      expect(JSON.parse(note.text)).toMatchObject({ result: { kind: "live-note-queued", noteId: "note-282", taskId: "review-fix-1" } });

      // `group show` reads groups/g; `proposal show` reads groups/g and groups/g/funding-preview.
      // mutation R (read schema's estimateId default removed) -> groups/g answers 423 run-invalid, red
      for (const path of ["/api/control/groups/g", "/api/control/groups/g/funding-preview"]) {
        const read = await overSocket(socketPath, "GET", path, { "x-orca-client": "mcp:test" });
        expect(read.status, `${path}: ${read.text}`).toBe(200);
      }
      const view = JSON.parse((await overSocket(socketPath, "GET", "/api/control/groups/g", { "x-orca-client": "mcp:test" })).text) as { runs: Array<{ runId: string }> };
      expect(view.runs.map((run) => run.runId)).toContain(String(review!.id));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
      await w.t.h.dispose();
    }
  }, 300000);
});
