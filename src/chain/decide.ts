import type { ResumeOutcome } from "../checkpoint/resume.js";
import type { ChainStatus } from "../checkpoint/schema.js";
import { formatBudget } from "./launch/claudeCode.js";

export const STOP_CATEGORIES = ["done", "blocked", "limit", "anomaly"] as const;
export type StopCategory = (typeof STOP_CATEGORIES)[number];
export interface Stop {
  kind: "stop";
  reason: string;
  category: StopCategory;
  detail: string | null;
  awaitingHuman: string[];
}
export type Next = { kind: "continue" } | Stop;
export type SessionOutcome = { kind: "exited"; exitCode: number | null } | { kind: "timeout" } | { kind: "launch-failed"; reason: string };

/** Measured on claude 2.1.275 (controller, run orca-dev-6662000e): `--max-budget-usd 0.0001` ⇒ exit 1 and this subtype. */
export const MAX_BUDGET_SUBTYPE = "error_max_budget_usd";
export const NO_CHECKPOINT_TEXT = "This repository has no checkpoint yet: this is the first session of the chain.\n";
/** Spec §4.3. */
export const EXIT_CODES: Record<StopCategory, number> = { done: 0, anomaly: 2, blocked: 3, limit: 4 };

const stop = (reason: string, category: StopCategory, detail: string | null = null, awaitingHuman: string[] = []): Stop => ({
  kind: "stop",
  reason,
  category,
  detail,
  awaitingHuman,
});

export interface SessionFacts {
  outcome: SessionOutcome;
  costUsd: number | null;
  subtype: string | null;
  exitCheckpoint: { status: ChainStatus; why: string; awaitingHuman: string[] } | null;
  guardedChanged: string[];
  worktreeClean: boolean;
  descendsFromStart: boolean;
  onStartBranch: boolean;
  interrupted: boolean;
  stopRequested: boolean;
  newCommits: number;
  sessionsRun: number;
  priorCostUsd: number;
  limits: { maxSessions: number; maxCostUsd: number };
}

/**
 * D-launch spec §4.2, in order; the first rule that matches wins. Any anomaly stops — stopping is the safe direction.
 * Rules 1–2 come before reading the cost (review I1): a killed or unlaunched session has no result JSON. Rules 3–3c
 * come before every ordinary ending: a bad scene stops the chain whatever the checkpoint says.
 */
export function decideNext(f: SessionFacts): Next {
  if (f.outcome.kind === "launch-failed") return stop("launch-failed", "anomaly", f.outcome.reason);
  if (f.outcome.kind === "timeout") return stop("session-timeout", "anomaly");
  if (f.guardedChanged.length > 0) return stop("gate-modified", "anomaly", f.guardedChanged.join(", "));
  if (!f.worktreeClean) return stop("dirty-after-session", "anomaly");
  if (!f.descendsFromStart) return stop("history-rewritten", "anomaly");
  if (!f.onStartBranch) return stop("branch-changed", "anomaly");
  // Spec §5.3 (plan PC-8): signalled, and none of 1–3c hit.
  if (f.interrupted) return stop("stop-requested", "limit", "the supervisor was signalled");
  if (f.costUsd === null) return stop("cost-unreadable", "anomaly");
  if (f.subtype === MAX_BUDGET_SUBTYPE) return stop("max-cost", "limit", "the session ran out of its --max-budget-usd");
  if (f.outcome.exitCode !== 0 || f.subtype !== "success") {
    return stop("session-failed", "anomaly", `exit ${f.outcome.exitCode}, subtype ${f.subtype}`);
  }
  if (f.exitCheckpoint === null) return stop("no-exit-checkpoint", "anomaly");
  if (f.exitCheckpoint.status === "done") return stop("done", "done", f.exitCheckpoint.why);
  if (f.exitCheckpoint.status === "blocked") return stop("blocked", "blocked", f.exitCheckpoint.why, f.exitCheckpoint.awaitingHuman);
  if (f.stopRequested) return stop("stop-requested", "limit");
  if (f.priorCostUsd + f.costUsd >= f.limits.maxCostUsd) return stop("max-cost", "limit");
  if (f.sessionsRun >= f.limits.maxSessions) return stop("max-sessions", "limit");
  if (f.newCommits === 0) return stop("no-progress", "limit");
  return { kind: "continue" };
}

export interface BeforeSession {
  stopRequested: boolean;
  remainingUsd: number;
  gate: { ok: true } | { ok: false; reason: string };
  worktreeClean: boolean;
  onStartBranch: boolean;
}

/** Spec §5.2 (review 4) and its judging order: limits before the gate check, then worktree and branch. Null = start. */
export function decideBeforeSession(b: BeforeSession): Stop | null {
  if (b.stopRequested) return stop("stop-requested", "limit");
  // Final review Minor-1: a remainder that --max-budget-usd would carry as 0 (below 1/10000 USD) is no budget either.
  if (b.remainingUsd <= 0 || formatBudget(b.remainingUsd) === "0") return stop("max-cost", "limit", "no budget left for another session");
  if (!b.gate.ok) return stop("gate-check-failed", "anomaly", b.gate.reason);
  if (!b.worktreeClean) return stop("dirty-before-session", "anomaly");
  if (!b.onStartBranch) return stop("branch-changed", "anomaly");
  return null;
}

export type ResumeResult = ResumeOutcome | { crashed: string };

/** Spec §4.4 (review I7). */
export function decideResume(r: ResumeResult, sessionNumber: number): { kind: "prompt"; text: string } | Stop {
  if ("crashed" in r) return stop("resume-failed", "anomaly", `resume threw: ${r.crashed}`);
  if (r.rejection === null && (r.exitCode === 0 || r.exitCode === 2)) return { kind: "prompt", text: r.text };
  if (r.rejection?.code === "no-checkpoint" && sessionNumber === 1) return { kind: "prompt", text: NO_CHECKPOINT_TEXT };
  return stop("resume-failed", "anomaly", r.rejection === null ? `resume exited ${r.exitCode}` : `${r.rejection.code}: ${r.rejection.message}`);
}
