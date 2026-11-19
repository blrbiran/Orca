// Tester #170 (human ruling: read side only, no data migration). A run's own handoff request (service.ts, outbox id
// `handoff-request:<runId>`) is marked delivered only when that run ends `settled`; a run that ended any other way leaves
// its row at delivered=0 for ever, and the recovery read listed it beside the requests still in flight as a
// `service-record`, so a settled request read as waiting. Such a row, its run no longer active, is now `finished`:
// hidden by default and counted in finishedHidden (#372), listed with `all`. A run still active keeps its record shown.
// Nothing is written.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";

it("#170: a run's own handoff record whose run has ended is finished, not waiting", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orca-handoff-ended-")));
  const store = await openControlStore({ stateDir: join(root, "state") });
  try {
    store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',1,1,'{\"groupId\":\"g\"}')").run();
    const add = (runId: string, active: 0 | 1) => {
      store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,'g',?,1,?,'{}')").run(runId, `w-${runId}`, active);
      store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'handoff-request',?,0)")
        .run(`handoff-request:${runId}`, JSON.stringify({ workItemId: `h-${runId}`, request: { requestId: `req-${runId}`, runId } }));
    };
    add("r-ended", 0); add("r-live", 1);
    const before = store.db.prepare("SELECT id,body,delivered FROM outbox ORDER BY id").all();
    const view = readControlRecovery(store, "e");
    // mutation: drop the ended-run branch -> r-ended listed as service-record and finishedHidden absent, red
    expect(view.handoffOutbox).toEqual([{ outboxId: "handoff-request:r-live", requestId: "req-r-live", requestState: null, delivery: "service-record" }]);
    expect(view.finishedHidden).toBe(1);
    expect(readControlRecovery(store, "e", { all: true }).handoffOutbox).toEqual([
      { outboxId: "handoff-request:r-ended", requestId: "req-r-ended", requestState: null, delivery: "finished" },
      { outboxId: "handoff-request:r-live", requestId: "req-r-live", requestState: null, delivery: "service-record" },
    ]);
    expect(store.db.prepare("SELECT id,body,delivered FROM outbox ORDER BY id").all()).toEqual(before);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
