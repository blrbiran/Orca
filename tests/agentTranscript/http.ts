/**
 * The control read routes as the panel registers them (registerControlReadRoutes), on the Web or the socket listener,
 * with the principal a criterion names (the panel's auth middleware sets res.locals.orcaPrincipal the same way).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type { ControlFeatures } from "../../src/control/executionPort.js";
import type { ControlStore } from "../../src/control/store.js";
import { registerControlReadRoutes } from "../../src/panel/controlApi.js";
import type { Principal } from "../../src/panel/permissions.js";

export const PRINCIPALS: Record<string, Principal> = {
  owner: { kind: "user", userId: "u1", name: "Olive", roles: ["owner"] },
  member: { kind: "user", userId: "u2", name: "Max", roles: ["member"] },
  dispatched: { kind: "agent", client: "cli", dispatchedRun: "run-x" },
  socketAgent: { kind: "agent", client: "cli" },
};

export interface Served { get(path: string, who?: keyof typeof PRINCIPALS): Promise<{ status: number; body: any }>; close(): Promise<void> }

export async function serve(store: ControlStore, channel: "web" | "socket", features: Partial<ControlFeatures> | null = { transcripts: "v1" }): Promise<Served> {
  const app = express();
  app.use((req, res, next) => { res.locals.orcaPrincipal = PRINCIPALS[String(req.header("x-who") ?? "owner")]; next(); });
  const port = { readFeatures: async (): Promise<ControlFeatures> => ({ protocol: 1, ...(features ?? {}) }) };
  registerControlReadRoutes(app, { store, epoch: "epoch", config: { readView: async () => ({}) } as never, port: port as never }, channel);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    async get(path, who = "owner") {
      const response = await fetch(base + path, { headers: { "x-who": who } });
      return { status: response.status, body: await response.json() };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
