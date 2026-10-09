import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerControlMutationRoutes } from "../../src/panel/controlApi.js";
import type { Principal } from "../../src/panel/permissions.js";
import { unknownFailure } from "../control/fixtures/unknownFailure.js";
import { overSocket } from "./fixtures/socketPanel.js";

// The listener's login/socket gate supplies the principal out of band. These route tests exercise that exact boundary
// with real driver evidence; accounts/auth.test.ts covers login and session validation itself.
const owner: Principal = { kind: "user", userId: "owner-1", name: "owner", roles: ["owner"] };
const member: Principal = { kind: "user", userId: "member-1", name: "member", roles: ["member"] };
const agent: Principal = { kind: "agent", client: "mcp:test" };

describe("D9 transport permission and accounting", () => {
  it.each([owner, member, agent])("uses the authenticated principal $kind/$name and never actorId or acknowledgement", async principal => {
    const { t, runId } = await unknownFailure();
    const app = express(); app.use(express.json());
    app.use((_req, res, next) => { res.locals.orcaPrincipal = principal; next(); });
    const socket = principal.kind === "agent";
    registerControlMutationRoutes(app, t.h.store, t.service, socket ? "socket" : "web");
    const server = createServer(app), socketPath = join(t.h.root, "test.sock");
    await new Promise<void>(resolve => { if (socket) server.listen(socketPath, resolve); else server.listen(0, "127.0.0.1", resolve); });
    try {
      const envelope = { commandId: `settlement-${principal.kind}-${"userId" in principal ? principal.userId : "agent"}`, expectedRevision: Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision), payload: { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" } };
      const route = "/api/control/groups/g/settle-unknown-usage", before = t.h.store.db.prepare("SELECT * FROM usage_ledger ORDER BY id").all();
      let status: number, body: any;
      if (socket) { const r = await overSocket(socketPath, "POST", route, { "x-orca-client": "mcp:test" }, envelope); status = r.status; body = JSON.parse(r.text); }
      else { const address = server.address() as { port: number }; const r = await fetch(`http://127.0.0.1:${address.port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope) }); status = r.status; body = await r.json(); }
      if (principal === owner) {
        expect(status).toBe(200); expect(body.result.kind).toBe("usage-settled");
        expect(t.body(runId).usageSettlement.principal).toBe("user:owner-1");
        expect(t.h.store.db.prepare("SELECT client,principal FROM commands WHERE id=?").get(envelope.commandId)).toEqual({ client: "web", principal: "user:owner-1" });
      } else {
        expect(status).toBe(403); expect(body.error.code).toBe("control-verb-human-only");
        expect(t.body(runId).usageSettlement).toBeUndefined(); expect(t.h.store.db.prepare("SELECT * FROM usage_ledger ORDER BY id").all()).toEqual(before);
        expect(t.h.store.db.prepare("SELECT id FROM commands WHERE id=?").get(envelope.commandId)).toBeUndefined();
      }
    } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await t.h.dispose(); }
  });
});
