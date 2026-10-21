import express, { type Express } from "express";
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { registerControlReadRoutes, verifyControlJsonBody, type ControlReadApiDeps } from "./controlApi.js";
import { sendControlError } from "./controlErrors.js";
import { registerSocketProjectRoutes, type ProjectsDeps } from "./projects.js";
import { CLIENT_HEADER, CLIENT_PATTERN, DISPATCHED_RUN_HEADER } from "../control/commandClient.js";
import type { Principal } from "./permissions.js";

// CLI v2 plan Task 1: the socket's name and path rules live in a module the CLI can load without the control routes.
export { CONTROL_SOCKET_NAME, controlSocketPath, socketPathTooLong } from "./controlSocketPath.js";
import { socketPathTooLong } from "./controlSocketPath.js";

/** `close()` resolves once the socket server has closed (in-flight requests finished); repeated calls return the same promise. */
export interface ControlSocketHandle { path: string; close(): Promise<void> }
export interface ControlSocketFailure { code: "control-socket-path-too-long" | "control-socket-path-occupied" | "control-socket-listen-failed"; detail: string }

/** Spec §3.2: only the control routes; no page, no token, no Host check -- there is no network peer. */
export function buildControlSocketApp(deps: ControlReadApiDeps, projects?: ProjectsDeps): Express {
  const app = express();
  // Spec §4.2: before the body is read and for every verb, GET included. Attribution only, never authorization (§6).
  app.use((req, res, next) => {
    const client = req.header(CLIENT_HEADER);
    if (client === undefined || !CLIENT_PATTERN.test(client)) {
      sendControlError(res, 400, "control-client-invalid", `Socket requests carry ${CLIENT_HEADER}: cli|mcp[:<name>].`);
      return;
    }
    // Accounts spec §3.5: every socket request acts as the agent principal; the header names it, never authorizes it.
    // CLI v2 spec §15.4: a request from a run Orca dispatched carries its run id; present (any value) marks it.
    const dispatchedRun = req.header(DISPATCHED_RUN_HEADER);
    res.locals.orcaPrincipal = { kind: "agent", client, ...(dispatchedRun === undefined ? {} : { dispatchedRun }) } satisfies Principal;
    next();
  });
  app.use(express.json({ limit: "64kb", verify: verifyControlJsonBody }));
  // CLI v2 spec §14 R4: plan registration over the socket, by the HTTP route's own handler (projects.ts).
  if (projects !== undefined) registerSocketProjectRoutes(app, projects);
  registerControlReadRoutes(app, deps, "socket");
  app.use((_req, res) => { sendControlError(res, 404, "route-not-found", "The control socket serves only /api/control routes."); });
  return app;
}

const isSocketAt = (path: string): boolean | null => {
  try { return lstatSync(path).isSocket(); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
};

/**
 * Spec §3.1: called only by the process holding the store lock, after recovery. A socket already at the path is a dead
 * owner's leftover and is replaced; anything else there is not ours to remove.
 */
export async function bindControlSocket(app: Express, path: string): Promise<ControlSocketHandle | ControlSocketFailure> {
  if (socketPathTooLong(path)) return { code: "control-socket-path-too-long", detail: `${Buffer.byteLength(path)} bytes: ${path}` };
  const server: Server = createServer(app);
  try {
    const existing = isSocketAt(path);
    if (existing === false) return { code: "control-socket-path-occupied", detail: path };
    // Safe only because socket close always completes before control.close() releases the store lock (spec §3.3).
    if (existing === true) unlinkSync(path);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, () => resolve()); });
    chmodSync(path, 0o600);
  } catch (error) {
    server.close();
    return { code: "control-socket-listen-failed", detail: error instanceof Error ? error.message : String(error) };
  }
  let closing: Promise<void> | null = null;
  return {
    path,
    close() {
      closing ??= new Promise<void>((resolve) => {
        server.close(() => {
          try { if (isSocketAt(path) === true) unlinkSync(path); } catch { /* the file is already gone or not ours */ }
          resolve();
        });
        server.closeIdleConnections();
      });
      return closing;
    },
  };
}
