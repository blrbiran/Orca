// Shared helpers for criteria that boot a panel and talk to its control socket (agent entry spec §3).
// Usage: call `useSocketPanels()` once at the top of a test file; it installs an afterEach that restores mocks,
// closes every panel `boot` started and removes every `workspace` temp dir.
import { request } from "node:http";
import { chmod, copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, vi } from "vitest";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../../src/panel/server.js";

const roots: string[] = [];
const panels: StartedPanel[] = [];

export async function cleanupSocketPanels(): Promise<void> {
  vi.restoreAllMocks();
  while (panels.length) await panels.pop()!.close().catch(() => undefined);
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
}

export function useSocketPanels(): void {
  afterEach(cleanupSocketPanels);
}

/** Register a panel started by hand (not through `boot`) for cleanup. */
export function trackSocketPanel(panel: StartedPanel): StartedPanel {
  panels.push(panel);
  return panel;
}

/** Forget a panel the test already closed itself. */
export function untrackSocketPanel(panel: StartedPanel): void {
  const at = panels.indexOf(panel);
  if (at !== -1) panels.splice(at, 1);
}

export async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "os-")));
  roots.push(root);
  for (const dir of ["repo", "corrections", "control"]) await mkdir(join(root, dir), { recursive: true });
  return { root, repo: join(root, "repo"), state: join(root, "s"), env: { ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections") } };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

// set-workspace-mode is accepted only for a repository a configured execution port knows (driver §2.1); the fake
// ccloop answers its control calls and nothing real is spawned.
async function configurePort(w: Workspace): Promise<void> {
  const binary = join(w.root, "ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary);
  await chmod(binary, 0o700);
  const table = join(w.root, "agents.json");
  await writeFile(table, "{}", { mode: 0o600 });
  Object.assign(w.env, { ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: table });
}

/** `port: true` gives the panel an execution port (fake ccloop); it also leaves the env in `w.env` for a spawned CLI. */
export async function boot(w: Workspace, extra: string[] = [], options: { port?: boolean } = {}): Promise<StartedPanel> {
  if (options.port) await configurePort(w);
  const opts = parsePanelArgs(["--by", "tester", "--repo", `proj=${w.repo}`, "--control-state-dir", w.state, ...extra], w.env);
  return trackSocketPanel(await createPanelServer(opts, w.env));
}

export function overSocket(socketPath: string, method: string, path: string, headers: Record<string, string> = { "x-orca-client": "cli" }, body?: unknown) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request({ socketPath, method, path, headers: { connection: "close", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
