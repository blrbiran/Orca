import { execFile, spawn } from "node:child_process";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SessionOutcome } from "../decide.js";

/**
 * D-launch spec §2.2-5 (review I4): CLAUDE_CODE_SIMPLE and CLAUDE_CODE_SAFE_MODE can switch hooks off; with
 * CMUX_SURFACE_ID set, the cmux shim on this machine's PATH injects --settings.
 */
export const STRIPPED_ENV = ["CLAUDE_CODE_SIMPLE", "CLAUDE_CODE_SAFE_MODE", "CLAUDECODE"] as const;
/** Plan PC-21 (review I5): whole families — the parent session's identity and messaging, and everything cmux reads. */
export const STRIPPED_ENV_PREFIXES = ["CLAUDE_CODE_SESSION_", "CLAUDE_CODE_MESSAGING_", "CMUX_"] as const;
/** Spec §4.2: SIGTERM to the whole group, SIGKILL 10 s later. */
export const KILL_GRACE_MS = 10_000;

export interface LaunchRequest {
  repo: string;
  prompt: string;
  sessionId: string;
  model: string;
  budgetUsd: number;
  timeoutMs: number;
  logDir: string;
  n: number;
  chainId: string;
  claudeBin?: string;
  baseEnv?: NodeJS.ProcessEnv;
  graceMs?: number;
  signal?: AbortSignal;
  pollMs?: number;
  onPoll?: () => Promise<void> | void;
}
export interface SessionResult {
  outcome: SessionOutcome;
  costUsd: number | null;
  subtype: string | null;
  leftoverProcesses: number;
  stdoutPath: string;
  stderrPath: string;
}

/** Floors to 1/10000 USD so the flag never exceeds what is left of the chain's budget. */
export function formatBudget(usd: number): string {
  return (Math.floor(usd * 10_000) / 10_000).toString();
}

/** Spec §2.2-4: the whole argv, item for item — a whitelist, so no flag that widens permissions can ride along. */
export function claudeArgv(r: { prompt: string; model: string; sessionId: string; budgetUsd: number }): string[] {
  return ["-p", r.prompt, "--output-format", "json", "--permission-mode", "auto", "--model", r.model, "--session-id", r.sessionId, "--max-budget-usd", formatBudget(r.budgetUsd)];
}

export function childEnv(base: NodeJS.ProcessEnv, chainId: string, sessionId: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of Object.keys(env)) {
    if ((STRIPPED_ENV as readonly string[]).includes(key) || STRIPPED_ENV_PREFIXES.some((p) => key.startsWith(p))) delete env[key];
  }
  env.ORCA_CHAIN_ID = chainId;
  env.ORCA_CHAIN_SESSION = sessionId;
  return env;
}

/** The `{"type":"result", …}` object from `--output-format json`; a missing or negative cost is null, never 0 (Rule 14). */
export function parseResult(stdout: string): { costUsd: number | null; subtype: string | null } {
  const text = stdout.trim();
  for (const candidate of [text, ...text.split("\n").reverse()]) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "result") continue;
    const v = value as { total_cost_usd?: unknown; subtype?: unknown };
    const cost = typeof v.total_cost_usd === "number" && Number.isFinite(v.total_cost_usd) && v.total_cost_usd >= 0 ? v.total_cost_usd : null;
    return { costUsd: cost, subtype: typeof v.subtype === "string" ? v.subtype : null };
  }
  return { costUsd: null, subtype: null };
}

/** Live members of process group `pgid` (the group outlives its leader). */
export async function groupMembers(pgid: number): Promise<number[]> {
  const { stdout } = await promisify(execFile)("ps", ["-A", "-o", "pid=,pgid="]);
  const members: number[] = [];
  for (const line of stdout.split("\n")) {
    const [pid, group] = line.trim().split(/\s+/).map(Number);
    if (group === pgid && Number.isInteger(pid)) members.push(pid);
  }
  return members;
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // The group is gone.
  }
}

async function waitForEmptyGroup(pgid: number, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && (await groupMembers(pgid)).length > 0) await new Promise((r) => setTimeout(r, 50));
}

/**
 * D-launch spec §2.1: the launch adapter. It starts one session in a process group of its own, stops that group at the
 * timeout or on abort, counts and ends whatever the session left in the group, and reads the result JSON.
 * It judges nothing: that is decide.ts.
 */
export async function launchClaudeCode(req: LaunchRequest): Promise<SessionResult> {
  await mkdir(req.logDir, { recursive: true });
  const stdoutPath = join(req.logDir, `${req.n}.stdout.json`);
  const stderrPath = join(req.logDir, `${req.n}.stderr.txt`);
  const out = await open(stdoutPath, "w");
  const err = await open(stderrPath, "w");
  const graceMs = req.graceMs ?? KILL_GRACE_MS;
  let pid: number | undefined;
  let graceTimer: NodeJS.Timeout | undefined;
  const outcome = await new Promise<SessionOutcome>((resolve) => {
    let child;
    try {
      child = spawn(req.claudeBin ?? "claude", claudeArgv(req), {
        cwd: req.repo,
        env: childEnv(req.baseEnv ?? process.env, req.chainId, req.sessionId),
        stdio: ["ignore", out.fd, err.fd],
        detached: true,
      });
    } catch (e) {
      resolve({ kind: "launch-failed", reason: (e as Error).message });
      return;
    }
    pid = child.pid;
    let timedOut = false;
    let settled = false;
    const terminate = (): void => {
      if (pid === undefined) return;
      signalGroup(pid, "SIGTERM");
      graceTimer ??= setTimeout(() => signalGroup(pid as number, "SIGKILL"), graceMs);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, req.timeoutMs);
    const poll = setInterval(() => void req.onPoll?.(), req.pollMs ?? 5_000);
    const onAbort = (): void => terminate();
    req.signal?.addEventListener("abort", onAbort, { once: true });
    if (req.signal?.aborted) terminate();
    const finish = (o: SessionOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      req.signal?.removeEventListener("abort", onAbort);
      resolve(o);
    };
    child.once("error", (e) => finish({ kind: "launch-failed", reason: e.message }));
    child.once("exit", (code) => finish(timedOut ? { kind: "timeout" } : { kind: "exited", exitCode: code }));
  });
  if (graceTimer !== undefined) clearTimeout(graceTimer);
  await out.close();
  await err.close();
  // Review M8: after every session, not only a timed-out one.
  let leftoverProcesses = 0;
  if (outcome.kind !== "launch-failed" && pid !== undefined) {
    leftoverProcesses = (await groupMembers(pid)).length;
    if (leftoverProcesses > 0) {
      signalGroup(pid, "SIGKILL");
      await waitForEmptyGroup(pid, 2_000);
    }
  }
  // Plan PC-22 (review M1): a session that deleted its own log has no result JSON; that is rule 4, not a crash.
  const stdoutText =
    outcome.kind === "exited"
      ? await readFile(stdoutPath, "utf8").catch((e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return "";
          throw e;
        })
      : "";
  const parsed = parseResult(stdoutText);
  return { outcome, ...parsed, leftoverProcesses, stdoutPath, stderrPath };
}
