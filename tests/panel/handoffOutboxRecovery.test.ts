import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";

it("#170: recovery distinguishes an open handoff request from a settled request and a service record", async () => {
  // Removing the request-state join makes the settled row look open; treating every delivered=0 row as a queue
  // makes the service row look open. Both would send a person looking for a delivery that cannot occur.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orca-handoff-outbox-")));
  const store = await openControlStore({ stateDir: join(root, "state") });
  try {
    store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',1,1,'{\"groupId\":\"g\"}')").run();
    const add = (id: string, requestId: string, state: string, body: object, delivered = 0) => {
      store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES (?,'g','r',?,?)")
        .run(requestId, state, JSON.stringify({ requestId, runId: "r", state, deadlineAt: "2030-01-01T00:00:00.000Z", phaseAttemptOrdinal: 1, failureCode: null, evidenceIds: [] }));
      store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,'handoff-request',?,?)")
        .run(id, JSON.stringify(body), delivered);
    };
    add("handoff-stop:g:1:r", "h-open", "request-pending", { groupId: "g", requestId: "h-open", runId: "r", origin: "handoff" });
    add("handoff-stop:g:2:r", "h-done", "settled-recoverable", { groupId: "g", requestId: "h-done", runId: "r", origin: "handoff" });
    add("handoff-request:r", "h-service", "request-pending", { workItemId: "w", request: { requestId: "h-service", runId: "r" } });
    add("handoff-stop:g:3:r", "h-delivered", "latched", { groupId: "g", requestId: "h-delivered", runId: "r", origin: "handoff" }, 1);

    expect(readControlRecovery(store, "epoch-test").handoffOutbox).toEqual([
      { outboxId: "handoff-stop:g:1:r", requestId: "h-open", requestState: "request-pending", delivery: "open-request" },
      { outboxId: "handoff-stop:g:2:r", requestId: "h-done", requestState: "settled-recoverable", delivery: "finished" },
      { outboxId: "handoff-request:r", requestId: "h-service", requestState: "request-pending", delivery: "service-record" },
    ]);
    store.db.prepare("UPDATE outbox SET delivered=1 WHERE kind='handoff-request'").run();
    expect(readControlRecovery(store, "epoch-test")).not.toHaveProperty("handoffOutbox");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
