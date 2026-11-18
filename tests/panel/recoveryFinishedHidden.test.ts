// Tester #372, plan 2026-11-18 tester batch D, Task V4 (human ruling: read-side filter only; #170 stays open). recovery list's
// handoffOutbox listed every delivered=0 handoff row, finished requests included, so it grew with history (30 rows, none
// actionable). The default read now lists only the rows still in flight and counts the finished ones it hides; `all`
// (CLI --all) lists them all. No row is written: delivered stays 0 (#170 is not decided here).
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import express from "express";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";
import { recoveryViewSchema } from "../../src/control/webProtocol.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";
import { cli, fakePanel, useFakePanels } from "../commands/fixtures/fakePanel.js";

useFakePanels();

describe("recovery list shows the handoff rows still in flight (#372)", () => {
  it("3 finished + 1 open: the default read has 1 row and finishedHidden 3; all has 4; no row changes", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "orca-fh-")));
    const store = await openControlStore({ stateDir: join(root, "state") });
    try {
      store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',1,1,'{\"groupId\":\"g\"}')").run();
      const add = (n: number, state: string) => {
        const requestId = `h-${n}`;
        store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES (?,'g','r',?,?)")
          .run(requestId, state, JSON.stringify({ requestId, runId: "r", state, deadlineAt: "2030-01-01T00:00:00.000Z", phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [] }));
        store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'handoff-request',?,0)")
          .run(`handoff-stop:g:${n}:r`, JSON.stringify({ groupId: "g", requestId, runId: "r", origin: "handoff" }));
      };
      add(1, "settled-recoverable"); add(2, "request-pending"); add(3, "settled-unrecoverable"); add(4, "settled-recoverable");
      const before = store.db.prepare("SELECT id,body,delivered FROM outbox ORDER BY id").all();
      const view = readControlRecovery(store, "e");
      expect(recoveryViewSchema.safeParse(view).success).toBe(true);
      // mutation: drop the finished filter -> 4 rows, red
      expect(view.handoffOutbox).toEqual([{ outboxId: "handoff-stop:g:2:r", requestId: "h-2", requestState: "request-pending", delivery: "open-request" }]);
      expect(view.finishedHidden).toBe(3);
      const all = readControlRecovery(store, "e", { all: true });
      expect(all.handoffOutbox?.map((row) => row.outboxId)).toEqual(["handoff-stop:g:1:r", "handoff-stop:g:2:r", "handoff-stop:g:3:r", "handoff-stop:g:4:r"]);
      expect(all).not.toHaveProperty("finishedHidden");
      expect(store.db.prepare("SELECT id,body,delivered FROM outbox ORDER BY id").all()).toEqual(before);
      // The route: `?all=1` asks for every row; without it the default.
      const app = express();
      registerControlReadRoutes(app, { store, epoch: "e", config: { readView: async () => ({}) } as never }, "web");
      const server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        const port = (server.address() as { port: number }).port;
        const get = async (query: string) => await (await fetch(`http://127.0.0.1:${port}/api/control/recovery${query}`)).json() as { handoffOutbox?: unknown[]; finishedHidden?: number };
        // mutation: ignore the route's ?all=1 -> 1 row, red
        expect((await get("?all=1")).handoffOutbox).toHaveLength(4);
        expect(await get("")).toMatchObject({ finishedHidden: 3 });
      } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
    } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
  }, 20_000);

  it("CLI: recovery list says how many finished rows it hides; --all asks the panel for all of them", async () => {
    const base = { schema: "orca-control-recovery-v1", epoch: "e", dispatchBlocked: false, blockers: [] };
    const p = await fakePanel({
      "GET recovery": { status: 200, body: { ...base, finishedHidden: 3 } },
      "GET recovery?all=1": { status: 200, body: { ...base, handoffOutbox: [{ outboxId: "o1", requestId: "h1", requestState: "settled-recoverable", delivery: "finished" }] } },
    });
    const plain = await cli(["recovery", "list"], p.dir);
    expect(plain.code, plain.stderr).toBe(0);
    expect(plain.stdout).toContain("3 finished handoff rows hidden (orca recovery list --all shows them)");
    const all = await cli(["recovery", "list", "--all"], p.dir);
    expect(all.code, all.stderr).toBe(0);
    // mutation: ignore --all in the CLI path -> the plain route, no o1, red
    expect(all.stdout).toContain("o1");
    expect(p.requests.map((r) => r.path)).toEqual(["recovery", "recovery?all=1"]);
  });
});
