import type { Express, NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { MemoryError, type MemoryScope } from "../memory/adapter.js";
import { createCcmemAdapter } from "../memory/ccmem.js";
import { type Parsed, parseLimit, parseQuery, parseRef } from "../memory/search.js";
import { memoryItemResponseSchema, memoryPageResponseSchema, memoryStatusResponseSchema } from "../memory/wire.js";
import { discoverRepos } from "../metrics/discover.js";
import type { PanelOptions } from "./server.js";

/**
 * Memory tab spec §5.1. GET only (G9): there is no other method under /api/memory, so a write gets express's 404.
 * The repository comes from the panel's discovery on every request (spec §10 D1), never from a path in the request.
 * Every input is checked before anything starts ccmem, because starting ccmem may migrate its data root (spec §4).
 */
export const MEMORY_REPO_UNKNOWN = "memory-repo-unknown";
export const MEMORY_NOT_FOUND = "memory-not-found";
export const MEMORY_QUERY_INVALID = "memory-query-invalid";
/** Every fixed code a memory route answers; `ccmem-failed:<status>` is the one open family. */
export const MEMORY_FIXED_CODES = [
  "ccmem-missing", "ccmem-timeout", "ccmem-output-too-large", "ccmem-output-invalid",
  MEMORY_REPO_UNKNOWN, MEMORY_NOT_FOUND, MEMORY_QUERY_INVALID,
] as const;

export function memoryHttpStatus(code: string): number {
  if (code === "ccmem-missing") return 503;
  if (code.startsWith("ccmem-")) return 502;
  if (code === MEMORY_REPO_UNKNOWN || code === MEMORY_NOT_FOUND) return 404;
  return 400;
}

/** Spec §5.1: the server checks its own answer. An extra or missing key throws, and the shared error handler answers 500. */
export function sendChecked(res: Response, schema: ZodTypeAny, body: unknown): void {
  res.json(schema.parse(body));
}

const refuse = (res: Response, code: string, message: string): void => { res.status(memoryHttpStatus(code)).json({ code, message }); };

export function registerMemoryRoutes(app: Express, opts: PanelOptions): void {
  const adapter = createCcmemAdapter(opts.memory ?? { ccmemBin: null, env: {} });
  const discovered = async () => (await discoverRepos({ root: opts.root, repos: opts.repos })).repos;

  /** Checks the inputs, then the repository, and only then lets `run` start ccmem. Answers 400/404 itself. */
  const route = (inputs: (req: Request) => Parsed<unknown>[], run: (scope: MemoryScope, req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      void (async () => {
        const projectKey = parseProjectKey(req.query.projectKey);
        const bad = [projectKey, ...inputs(req)].find((p) => !p.ok);
        if (bad !== undefined && !bad.ok) { refuse(res, MEMORY_QUERY_INVALID, bad.message); return; }
        const key = (projectKey as { ok: true; value: string }).value;
        const repo = (await discovered()).find((r) => r.projectKey === key);
        if (repo === undefined) { refuse(res, MEMORY_REPO_UNKNOWN, `this panel discovered no repository ${JSON.stringify(key)}`); return; }
        try {
          await run({ projectKey: key, repoPath: repo.path }, req, res);
        } catch (err) {
          if (err instanceof MemoryError) { refuse(res, err.code, err.message); return; }
          throw err;
        }
      })().catch(next);
    };

  app.get("/api/memory/status", (_req, res, next) => {
    void (async () => {
      const repos = await discovered();
      sendChecked(res, memoryStatusResponseSchema, {
        adapter: { id: adapter.id, capabilities: adapter.capabilities() },
        health: await adapter.health(),
        repos: repos.map((r) => ({ projectKey: r.projectKey })),
      });
    })().catch(next);
  });

  app.get("/api/memory/list", route((req) => [parseLimit(req.query.limit)], async (scope, req, res) => {
    const limit = (parseLimit(req.query.limit) as { ok: true; value: number }).value;
    sendChecked(res, memoryPageResponseSchema, { projectKey: scope.projectKey, query: "", page: await adapter.search(scope, { query: "", limit }) });
  }));

  app.get("/api/memory/search", route((req) => [parseQuery(req.query.q), parseLimit(req.query.limit)], async (scope, req, res) => {
    const query = (parseQuery(req.query.q) as { ok: true; value: string }).value;
    const limit = (parseLimit(req.query.limit) as { ok: true; value: number }).value;
    sendChecked(res, memoryPageResponseSchema, { projectKey: scope.projectKey, query, page: await adapter.search(scope, { query, limit }) });
  }));

  app.get("/api/memory/item", route((req) => [parseRef(req.query.ref)], async (scope, req, res) => {
    const ref = (parseRef(req.query.ref) as { ok: true; value: string }).value;
    const record = await adapter.get(scope, ref);
    if (record === null) { refuse(res, MEMORY_NOT_FOUND, `memory ${ref} is not visible from ${scope.projectKey}`); return; }
    sendChecked(res, memoryItemResponseSchema, { record });
  }));
}

function parseProjectKey(raw: unknown): Parsed<string> {
  if (typeof raw !== "string" || raw === "") return { ok: false, message: Array.isArray(raw) ? "projectKey was given more than once" : "projectKey is required" };
  return { ok: true, value: raw };
}
