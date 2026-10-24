import express, { type Express } from "express";
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { planLibraryImportBody, registerControlReadRoutes, verifyControlJsonBody, type ControlReadApiDeps } from "./controlApi.js";
import { sendControlError } from "./controlErrors.js";
import { registerSocketProjectRoutes, type ProjectsDeps } from "./projects.js";
import { CLIENT_HEADER, CLIENT_PATTERN, DISPATCHED_RUN_HEADER } from "../control/commandClient.js";
import type { Principal } from "./permissions.js";
import type { PanelAuth } from "./auth.js";

/** CLI v2 spec §15.5: the person token header. Sent by the CLI only with --as-person. */
export const PERSON_TOKEN_HEADER = "x-orca-person-token";

// CLI v2 plan Task 1: the socket's name and path rules live in a module the CLI can load without the control routes.
export { CONTROL_SOCKET_NAME, controlSocketPath, socketPathTooLong } from "./controlSocketPath.js";
import { socketPathTooLong } from "./controlSocketPath.js";

/** `close()` resolves once the socket server has closed (in-flight requests finished); repeated calls return the same promise. */
export interface ControlSocketHandle { path: string; close(): Promise<void> }
export interface ControlSocketFailure { code: "control-socket-path-too-long" | "control-socket-path-occupied" | "control-socket-listen-failed"; detail: string }

/**
 * Spec §3.2: only the control routes; no page, no Host check -- there is no network peer. CLI v2 spec §15.3: a request
 * may carry a person token (`auth`, the panel's accounts; without it no token is live), and `orca login`/`logout` mint
 * and revoke one here.
 */
export function buildControlSocketApp(deps: ControlReadApiDeps, projects?: ProjectsDeps, auth?: PanelAuth): Express {
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
    // CLI v2 spec §15.3: a token is checked on every request that carries one, a read too; one that is not live is refused
    // by name rather than ignored, so a stale login is never mistaken for the tier the caller asked for.
    const token = req.header(PERSON_TOKEN_HEADER);
    let person: { userId: string; name: string; roles: readonly ("owner" | "member")[] } | undefined;
    if (token !== undefined) {
      const current = auth?.authenticatePerson(token, auth.nowMs()) ?? null;
      if (current === null) {
        sendControlError(res, 401, "control-person-token-invalid", "The person token is not live (wrong, expired or revoked): run orca login again.");
        return;
      }
      person = { userId: current.user.id, name: current.user.name, roles: current.user.roles };
    }
    res.locals.orcaPrincipal = { kind: "agent", client, ...(dispatchedRun === undefined ? {} : { dispatchedRun }), ...(person === undefined ? {} : { person }) } satisfies Principal;
    next();
  });
  app.use(planLibraryImportBody);
  app.use(express.json({ limit: "64kb", verify: verifyControlJsonBody }));
  if (auth !== undefined) registerPersonRoutes(app, auth);
  // CLI v2 spec §14 R4: plan registration over the socket, by the HTTP route's own handler (projects.ts).
  if (projects !== undefined) registerSocketProjectRoutes(app, projects);
  registerControlReadRoutes(app, deps, "socket");
  app.use((_req, res) => { sendControlError(res, 404, "route-not-found", "The control socket serves only /api/control routes."); });
  return app;
}

/**
 * CLI v2 spec §15.3: `orca login` ({name, password} -> a person token, its own `cli` session) and `orca logout` (revokes
 * the session of the token it carries). Refusals by the Web login's codes; the throttle is the Web login's.
 */
function registerPersonRoutes(app: Express, auth: PanelAuth): void {
  app.post("/api/control/person/login", (req, res) => {
    const body = req.body as { name?: unknown; password?: unknown } | undefined;
    if (typeof body?.name !== "string" || typeof body.password !== "string") {
      sendControlError(res, 400, "control-non-json-payload", "person/login wants {name, password} strings");
      return;
    }
    const result = auth.personLogin(body.name, body.password, auth.nowMs());
    if (result.ok) { res.json({ token: result.token, sid: result.sid, user: { id: result.user.id, name: result.user.name }, expiresAt: result.expiresAt }); return; }
    if (result.code === "login-throttled") sendControlError(res, 429, "login-throttled", `too many failed logins for this name; wait ${result.retryAfterSec} s and try again`, { retryable: true });
    else sendControlError(res, 401, "login-failed", "the name or the password is wrong");
  });
  app.post("/api/control/person/logout", (req, res) => {
    const principal = res.locals.orcaPrincipal as Principal;
    const token = req.header(PERSON_TOKEN_HEADER);
    const current = token === undefined || principal.kind !== "agent" || principal.person === undefined ? null : auth.authenticatePerson(token, auth.nowMs());
    if (current === null) { sendControlError(res, 401, "control-person-token-invalid", "logout wants the live person token it ends"); return; }
    auth.logout(current.claims.sid, auth.nowMs());
    res.json({ revoked: current.claims.sid });
  });
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
