import express, { type Express } from "express";
import { chmodSync, lstatSync, unlinkSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { registerControlReadRoutes, verifyControlJsonBody, type ControlReadApiDeps } from "./controlApi.js";
import { sendControlError } from "./controlErrors.js";

/** Agent entry spec §3: the panel's second listener, for agents on this machine. Auth is the file mode. */
export const CONTROL_SOCKET_NAME = "control.sock";
/** sun_path including its NUL: 104 on macOS, 108 on Linux. */
const SUN_PATH_BYTES = process.platform === "darwin" ? 104 : 108;

export const controlSocketPath = (stateDir: string): string => join(stateDir, CONTROL_SOCKET_NAME);
export const socketPathTooLong = (path: string): boolean => Buffer.byteLength(path) >= SUN_PATH_BYTES;

/** `close()` resolves once the socket server has closed (in-flight requests finished); repeated calls return the same promise. */
export interface ControlSocketHandle { path: string; close(): Promise<void> }
export interface ControlSocketFailure { code: "control-socket-path-too-long" | "control-socket-path-occupied" | "control-socket-listen-failed"; detail: string }

/** Spec §3.2: only the control routes; no page, no token, no Host check -- there is no network peer. */
export function buildControlSocketApp(deps: ControlReadApiDeps): Express {
  const app = express();
  app.use(express.json({ limit: "64kb", verify: verifyControlJsonBody }));
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
