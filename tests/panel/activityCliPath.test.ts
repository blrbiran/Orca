import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { controlGet } from "../../src/entry/operations.js";
import { runControlCommand } from "../../src/entry/controlCommand.js";
import { boot, overSocket, useSocketPanels, workspace } from "./fixtures/socketPanel.js";

useSocketPanels();

describe("Activity through the isolated panel and real CLI socket client", () => {
  it("distinguishes a valid empty run from missing and damaged activity", async () => {
    const w = await workspace();
    const panel = await boot(w);
    const db = new DatabaseSync(join(w.state, "control.sqlite"));
    try {
      db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,'{}')").run();
      db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-empty','g','w',1,0,'{}'),('run-bad','g','w',1,0,'{}')").run();
      const empty = await controlGet({ socketPath: panel.socketPath!, client: "cli:activity-test", path: "runs/run-empty/activity" });
      expect(empty).toEqual({ schema: "orca-cli-response-v1", status: 200, body: { schema: "orca-run-activity-v1", runId: "run-empty", entries: [] } });
      const lines: string[] = [];
      const exit = await runControlCommand(["get", "runs/run-empty/activity", "--control-state-dir", w.state], w.env, { write: line => lines.push(line), readFile: () => "" });
      expect(exit).toBe(0);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toEqual(empty);
      const raw = await overSocket(panel.socketPath!, "GET", "/api/control/runs/run-empty/activity");
      expect(raw.status).toBe(200);
      expect(JSON.parse(raw.text)).toEqual(empty.body);

      const missing = await controlGet({ socketPath: panel.socketPath!, client: "cli:activity-test", path: "runs/run-missing/activity" });
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({ error: { code: "run-not-found" } });

      db.prepare("INSERT INTO activity(group_id,task_id,run_id,at,kind,body) VALUES ('g','t','run-bad',1,'phase','null')").run();
      const malformed = await controlGet({ socketPath: panel.socketPath!, client: "cli:activity-test", path: "runs/run-bad/activity" });
      expect(malformed.status).not.toBe(200);
      expect(malformed.body).toMatchObject({ error: { code: "recovery-blocked" } });
    } finally { db.close(); }
  });
});
