import { describe, expect, it } from "vitest";
import {
  EXIT_CODES,
  NO_CHECKPOINT_TEXT,
  type BeforeSession,
  type SessionFacts,
  decideBeforeSession,
  decideNext,
  decideResume,
} from "../../src/chain/decide.js";

const base = (over: Partial<SessionFacts> = {}): SessionFacts => ({
  outcome: { kind: "exited", exitCode: 0 },
  costUsd: 0.5,
  subtype: "success",
  exitCheckpoint: { status: "continue", why: "more to do", awaitingHuman: [] },
  guardedChanged: [],
  worktreeClean: true,
  descendsFromStart: true,
  onStartBranch: true,
  interrupted: false,
  stopRequested: false,
  newCommits: 2,
  sessionsRun: 1,
  priorCostUsd: 0,
  limits: { maxSessions: 5, maxCostUsd: 10 },
  ...over,
});
const stop = (reason: string, category: string, detail: string | null = null, awaitingHuman: string[] = []) => ({
  kind: "stop",
  reason,
  category,
  detail,
  awaitingHuman,
});
const NO_RESULT = { costUsd: null, subtype: null };

describe("decideNext: D-launch spec §4.2, one row each", () => {
  it("R1 a session that could not start ⇒ launch-failed", () => {
    expect(decideNext(base({ outcome: { kind: "launch-failed", reason: "spawn claude ENOENT" }, ...NO_RESULT }))).toEqual(
      stop("launch-failed", "anomaly", "spawn claude ENOENT"),
    );
  });
  it("R2 killed at the timeout ⇒ session-timeout", () => {
    expect(decideNext(base({ outcome: { kind: "timeout" }, ...NO_RESULT }))).toEqual(stop("session-timeout", "anomaly"));
  });
  it("R3 a guarded path changed ⇒ gate-modified, naming it", () => {
    expect(decideNext(base({ guardedChanged: ["src/gate/hook.ts"] }))).toEqual(stop("gate-modified", "anomaly", "src/gate/hook.ts"));
  });
  it("R3a uncommitted changes ⇒ dirty-after-session", () => {
    expect(decideNext(base({ worktreeClean: false }))).toEqual(stop("dirty-after-session", "anomaly"));
  });
  it("R3b HEAD no longer descends from the session's start ⇒ history-rewritten", () => {
    expect(decideNext(base({ descendsFromStart: false }))).toEqual(stop("history-rewritten", "anomaly"));
  });
  it("R3c HEAD left the starting branch ⇒ branch-changed", () => {
    expect(decideNext(base({ onStartBranch: false }))).toEqual(stop("branch-changed", "anomaly"));
  });
  it("R5.3 the supervisor was signalled ⇒ stop-requested (limit)", () => {
    expect(decideNext(base({ interrupted: true, outcome: { kind: "exited", exitCode: null }, ...NO_RESULT, exitCheckpoint: null }))).toEqual(
      stop("stop-requested", "limit", "the supervisor was signalled"),
    );
  });
  it("R4 no total_cost_usd ⇒ cost-unreadable", () => {
    expect(decideNext(base({ costUsd: null }))).toEqual(stop("cost-unreadable", "anomaly"));
  });
  it("R5 the budget ran out ⇒ max-cost", () => {
    expect(decideNext(base({ outcome: { kind: "exited", exitCode: 1 }, subtype: "error_max_budget_usd", costUsd: 1.2, exitCheckpoint: null }))).toEqual(
      stop("max-cost", "limit", "the session ran out of its --max-budget-usd"),
    );
  });
  it("R6 a non-zero exit ⇒ session-failed, keeping the subtype", () => {
    expect(decideNext(base({ outcome: { kind: "exited", exitCode: 1 }, subtype: "error_during_execution" }))).toEqual(
      stop("session-failed", "anomaly", "exit 1, subtype error_during_execution"),
    );
  });
  it("R6b exit 0 with a subtype other than success ⇒ session-failed", () => {
    expect(decideNext(base({ subtype: "error_max_turns" }))).toEqual(stop("session-failed", "anomaly", "exit 0, subtype error_max_turns"));
  });
  it("R7 no exit checkpoint ⇒ no-exit-checkpoint", () => {
    expect(decideNext(base({ exitCheckpoint: null }))).toEqual(stop("no-exit-checkpoint", "anomaly"));
  });
  it("R8 done ⇒ done", () => {
    expect(decideNext(base({ exitCheckpoint: { status: "done", why: "goal met", awaitingHuman: [] } }))).toEqual(stop("done", "done", "goal met"));
  });
  it("R9 blocked ⇒ blocked, carrying awaitingHuman", () => {
    expect(
      decideNext(base({ exitCheckpoint: { status: "blocked", why: "needs a push", awaitingHuman: ["[irreversible] push main"] } })),
    ).toEqual(stop("blocked", "blocked", "needs a push", ["[irreversible] push main"]));
  });
  it("R10 a stop request ⇒ stop-requested", () => {
    expect(decideNext(base({ stopRequested: true }))).toEqual(stop("stop-requested", "limit"));
  });
  it("R11 cumulative cost over the limit ⇒ max-cost", () => {
    expect(decideNext(base({ priorCostUsd: 9.6 }))).toEqual(stop("max-cost", "limit"));
  });
  it("R11b cumulative cost exactly at the limit ⇒ max-cost", () => {
    expect(decideNext(base({ priorCostUsd: 9.5 }))).toEqual(stop("max-cost", "limit"));
  });
  it("R12 the session limit reached ⇒ max-sessions", () => {
    expect(decideNext(base({ sessionsRun: 5 }))).toEqual(stop("max-sessions", "limit"));
  });
  it("R13 no commit outside .orca/checkpoints ⇒ no-progress", () => {
    expect(decideNext(base({ newCommits: 0 }))).toEqual(stop("no-progress", "limit"));
  });
  it("otherwise ⇒ continue", () => {
    expect(decideNext(base())).toEqual({ kind: "continue" });
  });
});

describe("decideNext: priorities (spec §4.2 notes, §8.2-1)", () => {
  it("P1 done but the worktree is dirty ⇒ dirty-after-session", () => {
    expect(decideNext(base({ exitCheckpoint: { status: "done", why: "w", awaitingHuman: [] }, worktreeClean: false }))).toEqual(
      stop("dirty-after-session", "anomaly"),
    );
  });
  it("P2 the budget ran out on a clean tree ⇒ max-cost, not session-failed", () => {
    expect(decideNext(base({ outcome: { kind: "exited", exitCode: 1 }, subtype: "error_max_budget_usd", exitCheckpoint: null }))).toEqual(
      stop("max-cost", "limit", "the session ran out of its --max-budget-usd"),
    );
  });
  it("P3 killed at the timeout ⇒ session-timeout, not cost-unreadable", () => {
    expect(decideNext(base({ outcome: { kind: "timeout" }, ...NO_RESULT, exitCheckpoint: null }))).toEqual(stop("session-timeout", "anomaly"));
  });
  it("P4 could not launch ⇒ launch-failed even with a guarded change", () => {
    expect(decideNext(base({ outcome: { kind: "launch-failed", reason: "x" }, ...NO_RESULT, guardedChanged: [".claude/settings.json"] }))).toEqual(
      stop("launch-failed", "anomaly", "x"),
    );
  });
  it("P5 signalled with a dirty tree ⇒ dirty-after-session", () => {
    expect(decideNext(base({ interrupted: true, worktreeClean: false, outcome: { kind: "exited", exitCode: null }, ...NO_RESULT }))).toEqual(
      stop("dirty-after-session", "anomaly"),
    );
  });
  it("P6 blocked while a stop was requested ⇒ blocked", () => {
    expect(
      decideNext(base({ exitCheckpoint: { status: "blocked", why: "w", awaitingHuman: ["[irreversible] a"] }, stopRequested: true })),
    ).toEqual(stop("blocked", "blocked", "w", ["[irreversible] a"]));
  });
  it("P7 a stop request while over budget ⇒ stop-requested", () => {
    expect(decideNext(base({ stopRequested: true, priorCostUsd: 9.9 }))).toEqual(stop("stop-requested", "limit"));
  });
  it("P8 over budget at the session limit ⇒ max-cost", () => {
    expect(decideNext(base({ priorCostUsd: 9.9, sessionsRun: 5 }))).toEqual(stop("max-cost", "limit"));
  });
  it("P9 at the session limit with no commits ⇒ max-sessions", () => {
    expect(decideNext(base({ sessionsRun: 5, newCommits: 0 }))).toEqual(stop("max-sessions", "limit"));
  });
  it("P10 no cost reported and exit 1 ⇒ cost-unreadable, not session-failed", () => {
    expect(decideNext(base({ outcome: { kind: "exited", exitCode: 1 }, ...NO_RESULT }))).toEqual(stop("cost-unreadable", "anomaly"));
  });
});

const ready = (over: Partial<BeforeSession> = {}): BeforeSession => ({
  stopRequested: false,
  remainingUsd: 5,
  gate: { ok: true },
  worktreeClean: true,
  onStartBranch: true,
  ...over,
});

describe("decideBeforeSession: spec §5.2 and its judging order", () => {
  it("B0 all clear ⇒ null", () => expect(decideBeforeSession(ready())).toBeNull());
  it("B1 a stop request ⇒ stop-requested", () => expect(decideBeforeSession(ready({ stopRequested: true }))).toEqual(stop("stop-requested", "limit")));
  it("B2 no budget left (exactly zero) ⇒ max-cost", () =>
    expect(decideBeforeSession(ready({ remainingUsd: 0 }))).toEqual(stop("max-cost", "limit", "no budget left for another session")));
  it("B6 a remainder --max-budget-usd would carry as 0 ⇒ max-cost, not a session launched with 0 (final review Minor-1)", () => {
    expect(decideBeforeSession(ready({ remainingUsd: 0.00005 }))).toEqual(stop("max-cost", "limit", "no budget left for another session"));
    expect(decideBeforeSession(ready({ remainingUsd: 1 - 0.99995 }))).toEqual(stop("max-cost", "limit", "no budget left for another session"));
    // The smallest amount the flag can carry still starts a session.
    expect(decideBeforeSession(ready({ remainingUsd: 0.0001 }))).toBeNull();
  });
  it("B3 the gate check failed ⇒ gate-check-failed with its reason", () =>
    expect(decideBeforeSession(ready({ gate: { ok: false, reason: "r" } }))).toEqual(stop("gate-check-failed", "anomaly", "r")));
  it("B4 a dirty worktree ⇒ dirty-before-session", () =>
    expect(decideBeforeSession(ready({ worktreeClean: false }))).toEqual(stop("dirty-before-session", "anomaly")));
  it("B5 off the starting branch ⇒ branch-changed", () =>
    expect(decideBeforeSession(ready({ onStartBranch: false }))).toEqual(stop("branch-changed", "anomaly")));
  it("PB1 a stop request outranks a failed gate check", () =>
    expect(decideBeforeSession(ready({ stopRequested: true, gate: { ok: false, reason: "r" } }))).toEqual(stop("stop-requested", "limit")));
  it("PB2 no budget outranks a failed gate check", () =>
    expect(decideBeforeSession(ready({ remainingUsd: -1, gate: { ok: false, reason: "r" } }))).toEqual(
      stop("max-cost", "limit", "no budget left for another session"),
    ));
  it("PB3 a failed gate check outranks a dirty worktree", () =>
    expect(decideBeforeSession(ready({ gate: { ok: false, reason: "r" }, worktreeClean: false }))).toEqual(stop("gate-check-failed", "anomaly", "r")));
  it("PB4 a dirty worktree outranks a changed branch", () =>
    expect(decideBeforeSession(ready({ worktreeClean: false, onStartBranch: false }))).toEqual(stop("dirty-before-session", "anomaly")));
});

describe("decideResume: spec §4.4, one row each", () => {
  it("Q0 exit 0 ⇒ its output goes into the prompt", () =>
    expect(decideResume({ exitCode: 0, text: "resume text\n", rejection: null }, 2)).toEqual({ kind: "prompt", text: "resume text\n" }));
  it("Q2 exit 2 (a measurement changed) ⇒ its output goes into the prompt", () =>
    expect(decideResume({ exitCode: 2, text: "changed\n", rejection: null }, 2)).toEqual({ kind: "prompt", text: "changed\n" }));
  it("Q1a no-checkpoint on the first session ⇒ the no-checkpoint sentence", () =>
    expect(decideResume({ exitCode: 1, text: "", rejection: { code: "no-checkpoint", message: "m" } }, 1)).toEqual({ kind: "prompt", text: NO_CHECKPOINT_TEXT }));
  it("Q1b no-checkpoint on a later session ⇒ resume-failed", () =>
    expect(decideResume({ exitCode: 1, text: "", rejection: { code: "no-checkpoint", message: "m" } }, 2)).toEqual(
      stop("resume-failed", "anomaly", "no-checkpoint: m"),
    ));
  it("Q1c any other refusal ⇒ resume-failed", () =>
    expect(decideResume({ exitCode: 1, text: "", rejection: { code: "measurement-gated", message: "g" } }, 1)).toEqual(
      stop("resume-failed", "anomaly", "measurement-gated: g"),
    ));
  it("Q3 resume threw (the CLI's exit 3) ⇒ resume-failed", () =>
    expect(decideResume({ crashed: "boom" }, 1)).toEqual(stop("resume-failed", "anomaly", "resume threw: boom")));
});

describe("exit codes: spec §4.3", () => {
  it("done 0, anomaly 2, blocked 3, limit 4", () => expect(EXIT_CODES).toEqual({ done: 0, anomaly: 2, blocked: 3, limit: 4 }));
});
