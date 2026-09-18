import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exitCheckpointAtHead } from "../checkpoint/covering.js";
import { type ResumeOutcome, resumeOutcome } from "../checkpoint/resume.js";
import { EXIT_CODES, type ResumeResult, type SessionFacts, type Stop, decideBeforeSession, decideNext, decideResume } from "./decide.js";
import { currentBranch, guardedChanges, headOf, isAncestor, progressCommits, worktreeClean } from "./facts.js";
import { chainGit } from "./git.js";
import { checkGate } from "./gateCheck.js";
import { KILL_GRACE_MS, type LaunchRequest, type SessionResult, launchClaudeCode } from "./launch/claudeCode.js";
import { acquireChainLock } from "./lock.js";
import { macNotify, summaryText } from "./notify.js";
import { chainLogDir } from "./paths.js";
import { type PreflightDeps, type Preflighted, preflight } from "./preflight.js";
import { chainPrompt } from "./prompt.js";
import { commitChainRecord, commitMessage, writeChainRecordFile } from "./record.js";
import type { ChainRecord } from "./recordSchema.js";
import { ChainRejection } from "./rejection.js";
import { stopRequested } from "./stopRequest.js";

// D-launch spec §2 (review 1): every module above is imported statically, so the supervisor runs the code of the
// checkout it was started from for its whole life, whatever a session does to the worktree.
export const SUPERVISOR_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const STOP_POLL_MS = 5_000;

export interface ChainDeps extends PreflightDeps {
  launch: (req: LaunchRequest) => Promise<SessionResult>;
  /** In-process always (spec §2, review 1); injectable only so a criterion can make it throw (W32). */
  resume: (opts: { repo: string }) => Promise<ResumeOutcome>;
  notify: (title: string, body: string) => Promise<string | null>;
  out: (text: string) => void;
  err: (text: string) => void;
  now: () => Date;
  newSessionId: () => string;
  pollMs: number;
  graceMs: number;
  supervisorRoot: string;
}

export function defaultChainDeps(): ChainDeps {
  // Controller note (Task 7 review): checkGate must see the same environment the launch adapter gives the headless
  // `claude` child (deps.env — same CLAUDE_CONFIG_DIR/HOME), not a separately captured process.env, or the user-level
  // disableAllHooks check (plan PC-19) can read the wrong config directory. Read lazily through the `deps` binding
  // (evaluated when gateCheck is called, not when this function returns) so a later `deps.env = …` is honoured, the
  // way tests here already mutate `deps.claudeBin` after construction.
  const deps: ChainDeps = {
    launch: launchClaudeCode,
    // Controller ruling on W30 (plan PC-20): resume's own read-only git calls carry the same
    // -c core.hooksPath=/dev/null -c core.fsmonitor=false as every other supervisor git call.
    resume: (opts) => resumeOutcome({ ...opts, git: chainGit }),
    gateCheck: (repo) => checkGate(repo, deps.env),
    notify: (title, body) => macNotify(title, body, process.env),
    out: (text) => void process.stdout.write(text),
    err: (text) => void process.stderr.write(text),
    now: () => new Date(),
    newSessionId: () => randomUUID(),
    claudeBin: "claude",
    env: process.env,
    pollMs: STOP_POLL_MS,
    graceMs: KILL_GRACE_MS,
    supervisorRoot: SUPERVISOR_ROOT,
  };
  return deps;
}

/**
 * Review m1: the launch adapter (Task 6) awaits `onPoll` as `void req.onPoll?.()` — a rejection there would be an
 * unhandled rejection that could kill the supervisor mid-session (Task 6 review; also the note this round follows
 * up on). `check` throwing must never propagate, and must never itself count as a stop request: the next poll or
 * the post-session `stopRequested` check tries again. Exported (not left as an inline closure) so it has its own
 * criterion, not just incidental coverage from the sessions that happen to reach a poll tick.
 */
export async function pollForStop(check: () => Promise<boolean>, latched: { value: boolean }): Promise<void> {
  try {
    if (!latched.value && (await check())) latched.value = true;
  } catch {
    // A poll failure is not a stop request; the next poll or the post-session check tries again.
  }
}

function stopFromError(err: unknown): Stop {
  const detail = err instanceof Error ? err.message : String(err);
  return { kind: "stop", reason: err instanceof ChainRejection ? err.code : "supervisor-error", category: "anomaly", detail, awaitingHuman: [] };
}

/**
 * D-launch spec §2: preflight → write and commit the record → sessions until decideNext stops → final record and
 * commit → release the lock (finally) → terminal summary → macOS notification → exit code (§4.3).
 * A preflight refusal propagates as a ChainRejection (exit 1, nothing written).
 */
export async function startChain(raw: unknown, deps: ChainDeps): Promise<number> {
  const pre = await preflight(raw, deps);
  if (pre.repo === (await realpath(deps.supervisorRoot).catch(() => deps.supervisorRoot))) {
    deps.err(
      `orca chain: warning: ${pre.repo} is the checkout this supervisor runs from; a session's changes to src/chain/** take effect at the next \`orca chain start\` (D-launch spec §7-6). Prefer a dedicated clone or worktree.\n`,
    );
  }
  const lock = await acquireChainLock(pre.repo, pre.chainId);
  const abort = new AbortController();
  const flags = { signalled: false };
  const onSignal = (): void => {
    flags.signalled = true;
    abort.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal); // plan PC-23 (review M4): a closed terminal is a stop request too
  const record: ChainRecord = {
    v: 1,
    chainId: pre.chainId,
    repo: pre.repo,
    startedBy: { via: pre.args.via, by: pre.args.by },
    goal: pre.args.goal,
    limits: { maxSessions: pre.args.maxSessions, maxCostUsd: pre.args.maxCostUsd, sessionTimeoutMin: pre.timeoutMin },
    model: pre.config.model,
    startedAt: deps.now().toISOString(),
    startHead: pre.head,
    branch: pre.branch,
    supervisorPid: process.pid,
    sessions: [],
    state: "running",
    stop: null,
  };
  let stop: Stop;
  try {
    let label = "stopped";
    try {
      await commitChainRecord(pre.repo, record, commitMessage(pre.chainId, "started"));
      deps.out(`orca chain: started ${pre.chainId}\n`);
      ({ stop, label } = await runSessions(pre, record, deps, abort.signal, flags));
    } catch (err) {
      // Spec §4.2: any anomaly stops, and stopping is the safe direction — including one nobody foresaw.
      stop = stopFromError(err);
    }
    record.state = "stopped";
    record.stop = { reason: stop.reason, category: stop.category, at: deps.now().toISOString(), awaitingHuman: stop.awaitingHuman, detail: stop.detail };
    if (stop.reason === "record-commit-refused") {
      await writeChainRecordFile(pre.repo, record); // Spec §5.3: left on disk, uncommitted, and the summary says so.
    } else {
      try {
        await commitChainRecord(pre.repo, record, commitMessage(pre.chainId, `${label}, ${stop.reason}`));
      } catch (err) {
        const previous = stop.reason;
        stop = stopFromError(err);
        record.stop = { ...record.stop, reason: stop.reason, category: "anomaly", detail: `the chain stopped with ${previous}, then: ${stop.detail}` };
        await writeChainRecordFile(pre.repo, record);
      }
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("SIGHUP", onSignal);
    await lock.release();
  }
  deps.out(summaryText(record));
  const warning = await deps.notify(`orca chain ${stop.category}`, `${record.chainId}: ${stop.reason}`);
  if (warning !== null) deps.err(`orca chain: warning: the macOS notification failed (${warning}); the chain record has the outcome\n`);
  return EXIT_CODES[stop.category];
}

async function runSessions(
  pre: Preflighted,
  record: ChainRecord,
  deps: ChainDeps,
  signal: AbortSignal,
  flags: { signalled: boolean },
): Promise<{ stop: Stop; label: string }> {
  const { repo, chainId } = pre;
  let spent = 0;
  const latched = { value: false };
  for (let n = 1; ; n += 1) {
    // Spec §5.2, judged in decideBeforeSession's order.
    latched.value = latched.value || flags.signalled || (await stopRequested(repo, chainId));
    const before = decideBeforeSession({
      stopRequested: latched.value,
      remainingUsd: record.limits.maxCostUsd - spent,
      gate: await deps.gateCheck(repo),
      worktreeClean: await worktreeClean(repo),
      onStartBranch: (await currentBranch(repo)) === pre.branch,
    });
    if (before !== null) return { stop: before, label: "stopped" };

    // Spec §4.4, in this process (review 1).
    let resumed: ResumeResult;
    try {
      resumed = await deps.resume({ repo });
    } catch (err) {
      resumed = { crashed: err instanceof Error ? err.message : String(err) };
    }
    const r = decideResume(resumed, n);
    if (r.kind === "stop") return { stop: r, label: "stopped" };

    const sessionId = deps.newSessionId();
    const startHead = await headOf(repo);
    const startedAt = deps.now().toISOString();
    const result = await deps.launch({
      repo,
      chainId,
      n,
      sessionId,
      model: pre.config.model,
      budgetUsd: record.limits.maxCostUsd - spent,
      timeoutMs: record.limits.sessionTimeoutMin * 60_000,
      logDir: chainLogDir(repo, chainId),
      prompt: chainPrompt({ chainId, n, goal: record.goal, sessionId, repo, resumeText: r.text }),
      claudeBin: deps.claudeBin,
      baseEnv: deps.env,
      graceMs: deps.graceMs,
      signal,
      pollMs: deps.pollMs,
      // Spec §2 step 4: latched in memory, so a request deleted later still counts (review I10). pollForStop is
      // what keeps this from ever rejecting (review m1).
      onPoll: () => pollForStop(() => stopRequested(repo, chainId), latched),
    });
    latched.value = latched.value || (await stopRequested(repo, chainId));

    const exit = await exitCheckpointAtHead(repo, sessionId);
    const facts: SessionFacts = {
      outcome: result.outcome,
      costUsd: result.costUsd,
      subtype: result.subtype,
      exitCheckpoint:
        exit.kind === "found"
          ? { status: exit.checkpoint.chain.status, why: exit.checkpoint.chain.why, awaitingHuman: exit.checkpoint.awaitingHuman.map((a) => `[${a.kind}] ${a.what}`) }
          : null,
      guardedChanged: await guardedChanges(repo, startHead, sessionId),
      worktreeClean: await worktreeClean(repo),
      descendsFromStart: await isAncestor(repo, startHead),
      onStartBranch: (await currentBranch(repo)) === pre.branch,
      interrupted: flags.signalled,
      stopRequested: latched.value,
      newCommits: await progressCommits(repo, startHead),
      sessionsRun: n,
      priorCostUsd: spent,
      limits: record.limits,
    };
    const next = decideNext(facts);
    if (result.costUsd !== null) spent += result.costUsd;
    record.sessions.push({
      n,
      sessionRef: sessionId,
      startedAt,
      endedAt: deps.now().toISOString(),
      outcome: result.outcome.kind,
      exitCode: result.outcome.kind === "exited" ? result.outcome.exitCode : null,
      subtype: result.subtype,
      costUsd: result.costUsd,
      exitCheckpoint: exit.kind === "found" ? exit.relPath : null,
      chain: exit.kind === "found" ? exit.checkpoint.chain : null,
      commits: facts.newCommits,
      leftoverProcesses: result.leftoverProcesses,
    });
    if (next.kind === "stop") return { stop: next, label: `session ${n}` };
    await commitChainRecord(repo, record, commitMessage(chainId, `session ${n}, continue`));
  }
}
