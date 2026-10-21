/**
 * A stand-in for the panel's control socket (CLI v2 plan Tasks 3-6): canned answers per `METHOD path`, every request
 * recorded byte for byte. It checks what the CLI sends; the real panel's behaviour is pinned by the panel's own criteria
 * and by the real-panel cases in these files.
 */
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { runRegistered } from "../../../src/commands/run.js";
import type { CommandIo } from "../../../src/commands/types.js";

export interface Recorded { method: string; path: string; headers: IncomingHttpHeaders; text: string }
export type Answer = { status: number; body: unknown } | "drop";
export type Route = Answer | ((request: Recorded, nth: number) => Answer);

const servers: Array<{ server: Server; dir: string }> = [];
export function useFakePanels(): void {
  afterEach(async () => {
    while (servers.length) {
      const { server, dir } = servers.pop()!;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(dir, { recursive: true, force: true });
    }
  });
}

/** `routes` keys: `GET summary`, `POST groups/g/start` (no /api/control/ prefix; a query is part of the path); `POST *` answers the rest. */
export async function fakePanel(routes: Record<string, Route>) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "fp-")));
  const requests: Recorded[] = [];
  const counts = new Map<string, number>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = (req.url ?? "").replace(/^\/api\/control\//, "");
      const recorded: Recorded = { method: req.method ?? "", path, headers: req.headers, text: Buffer.concat(chunks).toString("utf8") };
      requests.push(recorded);
      const key = `${req.method} ${path}`;
      const nth = counts.get(key) ?? 0;
      counts.set(key, nth + 1);
      const route = routes[key] ?? routes[`${req.method} *`];
      const answer: Answer = route === undefined ? { status: 404, body: { error: { code: "route-not-found", message: key, retryable: false } } } : typeof route === "function" ? route(recorded, nth) : route;
      if (answer === "drop") { req.socket.destroy(); return; }
      res.writeHead(answer.status, { "content-type": "application/json" }).end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(join(dir, "control.sock"), resolve));
  servers.push({ server, dir });
  return { dir, requests, routes };
}

/** Run argv through the registry with captured output, against the panel at `stateDir`. */
export async function cli(argv: string[], stateDir: string, extra: Partial<CommandIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIo = {
    stdout: (text) => { out.push(text); }, stderr: (text) => { err.push(text); },
    env: { ORCA_PANEL_DIR: "/nonexistent/panel", ORCA_PROJECTS_FILE: "/nonexistent/p.json" }, cwd: "/", stdinIsTTY: false, ...extra,
  };
  const code = await runRegistered([...argv, "--control-state-dir", stateDir], io);
  const stdout = out.join("");
  return { code, stdout, stderr: err.join(""), json: () => JSON.parse(stdout) as { schema: string; status: number; commandId?: string; body: any; request?: any } };
}
