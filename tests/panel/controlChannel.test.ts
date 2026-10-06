// Agent entry spec §3, §6: the socket channel's attribution comes only from the header gate. Mounted without it, the
// mutation routes must fail loud rather than book a row whose client is the string "undefined".
import express from "express";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { registerControlReadRoutes, verifyControlJsonBody } from "../../src/panel/controlApi.js";
import { webFixture } from "../control/fixtures/web.js";

describe("the socket channel without its header gate (spec §6)", () => {
  it("refuses a command with control-internal-error and books nothing", async () => {
    const h = await webFixture();
    const app = express();
    app.use(express.json({ verify: verifyControlJsonBody }));
    registerControlReadRoutes(app, { store: h.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service: new WebControlService(h.deps) }, "socket");
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    try {
      if (!address || typeof address === "string") throw new Error("address");
      const revision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
      const res = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/g/pause-dispatch`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "no-gate", expectedRevision: revision, payload: {} }),
      });
      expect(res.status).toBe(500);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe("control-internal-error");
      expect(h.store.db.prepare("SELECT id FROM commands WHERE id='no-gate'").get()).toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await h.dispose();
    }
  });
});
