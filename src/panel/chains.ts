import { spawn } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Express, Request, Response } from "express";
import { ChainStartSchema } from "../chain/args.js";
import { loadChainConfig } from "../chain/config.js";
import { lockState } from "../chain/lock.js";
import { totalCostUsd } from "../chain/notify.js";
import { chainLogDir, newChainId } from "../chain/paths.js";
import { type ChainRecord, listChainRecords } from "../chain/recordSchema.js";
import { ChainRejection } from "../chain/rejection.js";
import { requestStop } from "../chain/stopRequest.js";
import type { PanelOptions } from "./server.js";

/**
 * D-launch spec §6.2–§6.3. The panel READS chain records and never writes one: a chain is started only by spawning
 * `orca chain start` (detached, stdio to a log file — review I3), and stopped only through requestStop, the same
 * function `orca chain stop` uses. Panel spec §2.1 still holds for this process: no repo lock, no .decisions/, no commit.
 */
const ORCA_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CHAIN_START_WAIT_MS = 10_000;
export const CHAIN_VIEW_FIELDS = ["chainId", "goal", "by", "via", "startedAt", "state", "holderGone", "sessionsDone", "costUsd", "stop"] as const;

export interface ChainView {
  chainId: string;
  goal: string;
  by: string;
  via: "cli" | "panel";
  startedAt: string;
  state: "running" | "stopped";
  holderGone: boolean;
  sessionsDone: number;
  costUsd: number | null;
  stop: ChainRecord["stop"];
}
export interface ChainRepoView {
  repoKey: string;
  defaultSessionTimeoutMin: number | null;
  chain: ChainView | null;
  problem: string | null;
}

/** Spec §6.2: the latest chain of one repository. "running" with no live holder is shown as such, never as running. */
export async function chainRepoView(repoKey: string, path: string): Promise<ChainRepoView> {
  const defaultSessionTimeoutMin = await loadChainConfig(path).then((c) => c.sessionTimeoutMin, () => null);
  let listed: { records: ChainRecord[]; problems: string[] };
  try {
    listed = await listChainRecords(path);
  } catch (err) {
    return { repoKey, defaultSessionTimeoutMin, chain: null, problem: (err as Error).message };
  }
  const problem = listed.problems.length > 0 ? listed.problems.join("; ") : null;
  const latest = [...listed.records].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1);
  if (latest === undefined) return { repoKey, defaultSessionTimeoutMin, chain: null, problem };
  const lock = await lockState(path).catch(() => ({ kind: "free" as const }));
  const holderAlive = lock.kind === "held" && lock.holder.chainId === latest.chainId;
  return {
    repoKey,
    defaultSessionTimeoutMin,
    problem,
    chain: {
      chainId: latest.chainId,
      goal: latest.goal,
      by: latest.startedBy.by,
      via: latest.startedBy.via,
      startedAt: latest.startedAt,
      state: latest.state,
      holderGone: latest.state === "running" && !holderAlive,
      sessionsDone: latest.sessions.length,
      costUsd: totalCostUsd(latest),
      stop: latest.stop,
    },
  };
}

type StartOutcome = { kind: "started" } | { kind: "exited"; code: number | null } | { kind: "timeout" };

/**
 * Spec §2 (review 6): wait for the `started` line, but answer as soon as the child exits instead of waiting it out.
 *
 * Review fix round 1: takes the exit/error state as a GETTER rather than the child itself. The listeners that
 * populate it must be attached synchronously, right after `spawn()`, before any `await` -- Node can emit a spawn
 * failure's `error` event (ENOENT: tsx missing or the path is wrong; EACCES; EAGAIN) before this function ever
 * runs, and a `ChildProcess` with no `error` listener at all turns that into an uncaught exception that takes the
 * whole panel process down instead of a named `500 chain-start-failed`. Criterion: C11.
 */
async function waitForStart(logPath: string, chainId: string, waitMs: number, getExited: () => { code: number | null } | undefined): Promise<StartOutcome> {
  const line = `orca chain: started ${chainId}`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    const text = await readFile(logPath, "utf8").catch(() => "");
    if (text.includes(line)) return { kind: "started" };
    const exited = getExited();
    if (exited !== undefined) return { kind: "exited", code: exited.code };
    if (Date.now() >= deadline) return { kind: "timeout" };
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function registerChainRoutes(
  app: Express,
  opts: PanelOptions,
  objectBody: (req: Request, res: Response) => Record<string, unknown> | undefined,
): void {
  app.get("/api/chains", (_req, res, next) => {
    void (async () => {
      res.json({ repos: await Promise.all(opts.repos.map((r) => chainRepoView(r.projectKey, r.path))) });
    })().catch(next);
  });

  app.post("/api/chains", (req, res, next) => {
    void (async () => {
      const body = objectBody(req, res);
      if (body === undefined) return;
      const repo = opts.repos.find((r) => r.projectKey === body.repoKey);
      if (repo === undefined) {
        res.status(404).json({ code: "repo-not-found", message: `this panel has no --repo ${JSON.stringify(body.repoKey)}` });
        return;
      }
      // Spec §2: the panel mints the id and passes it on; the same schema as the CLI checks the request (by = --by).
      const chainId = newChainId();
      const parsed = ChainStartSchema.safeParse({
        repo: repo.path,
        by: opts.by,
        goal: body.goal,
        maxSessions: body.maxSessions,
        maxCostUsd: body.maxCostUsd,
        sessionTimeoutMin: body.sessionTimeoutMin,
        chainId,
        via: "panel",
      });
      if (!parsed.success) {
        res.status(400).json({ code: "chain-args-invalid", message: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") });
        return;
      }
      const a = parsed.data;
      const logDir = chainLogDir(repo.path, chainId);
      await mkdir(logDir, { recursive: true });
      const logPath = join(logDir, "supervisor.log");
      const log = await open(logPath, "a");
      const argv = [
        join(ORCA_ROOT, "src", "cli.ts"), "chain", "start", "--repo", a.repo, "--by", a.by, "--goal", a.goal,
        "--max-sessions", String(a.maxSessions), "--max-cost-usd", String(a.maxCostUsd),
        ...(a.sessionTimeoutMin === undefined ? [] : ["--session-timeout-min", String(a.sessionTimeoutMin)]),
        "--chain-id", chainId, "--via", "panel",
      ];
      const child = spawn(opts.chainTsxBin ?? join(ORCA_ROOT, "node_modules", ".bin", "tsx"), argv, {
        cwd: ORCA_ROOT,
        env: opts.chainEnv ?? process.env,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      });
      // Review fix round 1: the VERY NEXT statement after spawn(), before any await -- see waitForStart's comment.
      let exited: { code: number | null } | undefined;
      child.once("exit", (code) => (exited = { code }));
      child.once("error", () => (exited = { code: null }));
      await log.close();
      child.unref();
      const outcome = await waitForStart(logPath, chainId, opts.chainStartWaitMs ?? CHAIN_START_WAIT_MS, () => exited);
      if (outcome.kind === "started") {
        res.json({ chainId });
        return;
      }
      if (outcome.kind === "exited") {
        const refusal = /^rejected: ([a-z0-9-]+): (.*)$/m.exec(await readFile(logPath, "utf8").catch(() => ""));
        if (refusal !== null) {
          res.status(409).json({ code: refusal[1], message: refusal[2] });
          return;
        }
        res.status(500).json({ code: "chain-start-failed", message: `orca chain start exited ${outcome.code} without starting; see ${logPath}` });
        return;
      }
      res.status(500).json({
        code: "chain-start-timeout",
        message: `no "orca chain: started ${chainId}" line in ${logPath} within ${(opts.chainStartWaitMs ?? CHAIN_START_WAIT_MS) / 1000} s`,
        pid: child.pid,
      });
    })().catch(next);
  });

  app.post("/api/chains/:chainId/stop", (req, res, next) => {
    void (async () => {
      const body = objectBody(req, res);
      if (body === undefined) return;
      const repo = opts.repos.find((r) => r.projectKey === body.repoKey);
      if (repo === undefined) {
        res.status(404).json({ code: "repo-not-found", message: `this panel has no --repo ${JSON.stringify(body.repoKey)}` });
        return;
      }
      const chainId = String(req.params.chainId);
      try {
        await requestStop(repo.path, chainId);
      } catch (err) {
        if (err instanceof ChainRejection) {
          const status = err.code === "chain-not-found" ? 404 : err.code === "chain-not-running" ? 409 : 400;
          res.status(status).json({ code: err.code, message: err.message });
          return;
        }
        throw err;
      }
      res.json({ chainId, stopRequested: true });
    })().catch(next);
  });
}
