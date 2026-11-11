import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptCheckPathOf, acceptRebuildPathOf } from "../../src/control/acceptAttemptDriver.js";
import { readRunActivity } from "../../src/control/activity.js";
import { readArtifact } from "../../src/control/archive.js";
import { acceptanceEvidence } from "../../src/control/checkpoints.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { DriverCrash, type ExecutionDriver } from "../../src/control/executionDriver.js";
import { prerequisiteDone } from "../../src/control/groupEdges.js";
import { readBudgetProposal, readGroup, readWork } from "../../src/control/queries.js";
import { snapshotSchema } from "../../src/control/snapshot.js";
import { driverHarness, git, type HarnessOptions } from "./fixtures/driverHarness.js";
import type { WebFixtureTask } from "./fixtures/web.js";

/**
 * Reviewed acceptance (spec 2026-11-11 §7, #227), the driver half: an owner's accepted attempt is rebuilt from the failed
 * run's archive snapshot, merged onto orca/<group>, its setup and required checks run on the merged tree, and it lands by
 * one merge commit -- or is refused by name with nothing moved. The synthetic ccloop runs no checks: every check a
 * criterion records here is Orca's own. Real git; fake agents only.
 */
type T = Awaited<ReturnType<typeof driverHarness>>;
const OWNER = { client: "web", principal: "user:owner" };
const NOTE = "read the diff; the checks are what matter";
const BRANCH = "refs/heads/orca/g";

async function closedFailure(task: WebFixtureTask, options: HarnessOptions) {
  const t = await driverHarness([task], { behaviour: () => "failed", sealedOwnerProof: true, ...options });
  const runId = await t.claim(), driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  const closed = t.service.closeRun(t.h.command("close-run", { runId }));
  if ("error" in closed) throw new Error(JSON.stringify(closed));
  await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
  return { t, runId, driver };
}

const accept = async (t: T, runId: string, commandId = "acc-1") => {
  const command = t.h.command("accept-attempt", { taskId: "a", runId, note: NOTE }, commandId);
  const answer = await withCommandContext(command.commandId, OWNER, () => t.service.acceptAttempt(command));
  return { command, answer };
};

/** Checks run off the round: rounds 50 ms apart up to a deadline (driverPostMergeCheck.test.ts's measured reason). */
async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 30_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await driver.round();
    if (!predicate()) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}
const settledAcceptance = (t: T, runId: string) => () => ["landed", "refused"].includes(t.body(runId).operatorAcceptance?.state);

/** Criterion 22: everything accounting is, as bytes. */
const accounting = (t: T, runId: string): string => {
  const group = readGroup(t.h.store, "g"), run = t.body(runId);
  return JSON.stringify({
    group: { used: group.used, reserved: group.reserved },
    ledger: t.h.store.db.prepare("SELECT * FROM usage_ledger ORDER BY rowid").all(),
    run: { cumulative: run.cumulative, remaining: run.remaining, grant: run.grant, usageSettlement: run.usageSettlement ?? null, terminalClosure: run.terminalClosure ?? null },
    allocations: readBudgetProposal(t.h.store, "g").allocations,
    events: t.h.store.db.prepare("SELECT * FROM usage_events ORDER BY run_id,seq").all(),
  });
};

/** A check that says it started, then waits for `go` before it records the tree it ran on. */
const gatedCheck = () => {
  const dir = mkdtempSync(join(tmpdir(), "orca-accept-"));
  const heads = join(dir, "heads"), started = join(dir, "started"), go = join(dir, "go");
  return { heads, started, go, command: `echo x >> '${started}'; while [ ! -f '${go}' ]; do sleep 0.05; done; git rev-parse HEAD >> '${heads}'; test -f a` };
};
const lines = (path: string): string[] => readFileSync(path, "utf8").trim().split("\n");

describe("accept-attempt lands an owner's accepted attempt after its checks (criteria 17, 20-23)", { timeout: 120_000 }, () => {
  it("rebuilds the attempt with its deletion, lands it by one merge commit whose tree the checks ran on, and records the acceptance; accounting untouched", async () => {
    const heads = join(mkdtempSync(join(tmpdir(), "orca-accept-")), "heads");
    const check = `git rev-parse HEAD >> '${heads}'; test -f a && test ! -f base.txt`;
    const { t, runId, driver } = await closedFailure({ taskId: "a", targetPaths: ["a", "base.txt"] }, { requiredChecks: [check], files: () => ({ a: "a\n", "base.txt": null }) });
    try {
      const before = accounting(t, runId), old = git(t.repo, "rev-parse", BRANCH);
      const { command, answer } = await accept(t, runId);
      expect(answer).toMatchObject({ result: { kind: "attempt-accept-requested", runId } });
      await untilDeadline(driver, settledAcceptance(t, runId));
      const intent = t.body(runId).operatorAcceptance;
      expect(intent).toMatchObject({ state: "landed", reason: null, staged: null });
      const tip = git(t.repo, "rev-parse", BRANCH);

      // Criterion 17: the rebuilt attempt's tree is the snapshot's, path by path and byte by byte, the deletion included.
      const snapshot = snapshotSchema.parse(JSON.parse((await readArtifact(t.h.store, intent.snapshot)).toString()));
      expect(snapshot.deleted).toEqual(["base.txt"]);
      const files = snapshot.tree.filter((entry) => entry.kind === "file");
      expect(files.map((entry) => entry.path)).toEqual(["a"]);
      expect(git(t.repo, "ls-tree", "-r", "--name-only", intent.attemptSha).split("\n")).toEqual(files.map((entry) => entry.path));
      for (const entry of files) expect(git(t.repo, "show", `${intent.attemptSha}:${entry.path}`)).toBe((await readArtifact(t.h.store, entry.ref!)).toString().trim());

      // Criterion 20: exactly one merge commit; its second parent is the attempt; the tree the checks ran on is the tip.
      expect(git(t.repo, "rev-list", "--count", "--first-parent", `${old}..${tip}`)).toBe("1");
      expect(git(t.repo, "rev-parse", `${tip}^1`)).toBe(old);
      expect(git(t.repo, "rev-parse", `${tip}^2`)).toBe(intent.attemptSha);
      expect(intent.landedCommit).toBe(tip);
      expect(lines(heads)).toEqual([tip]);
      expect(git(t.repo, "ls-tree", "-r", "--name-only", tip).split("\n").sort()).toEqual([`.decisions/${runId}.jsonl`, "a"]);

      // Criterion 21: the acceptance artifact, acceptance evidence, the task done, the ledger's code-authored record.
      const row = t.h.store.db.prepare("SELECT body FROM outbox WHERE id=? AND kind='acceptance'").get(`acceptance:${runId}`)!;
      const proof = JSON.parse((await readArtifact(t.h.store, JSON.parse(String(row.body)).source)).toString());
      expect(proof).toMatchObject({
        runId, checksPassed: true, landing: "landed", review: "operator-reviewed", principal: "user:owner", note: NOTE,
        commandId: command.commandId, attemptSha: intent.attemptSha, merged: tip, commit: tip, base: old, setup: [],
        checks: [{ command: check, exit: "0" }],
      });
      expect(await acceptanceEvidence(t.h.store, runId)).toBe(true);
      expect(readWork(t.h.store, "g", "a").status).toBe("done");
      const ledger = git(t.repo, "show", `${tip}:.decisions/${runId}.jsonl`).split("\n").map((line) => JSON.parse(line));
      expect(ledger.map((event) => event.id)).toEqual([`${runId}/orca-operator-accept`]);
      expect(ledger[0]).toMatchObject({ run: runId, kind: "criteria", evidence: expect.arrayContaining([`command ${command.commandId}`, `attempt ${intent.attemptSha}`]) });
      expect(readRunActivity(t.h.store, runId, 50).filter((entry) => entry.kind === "attempt-accepted")).toHaveLength(1);
      // The group's done rule counts the task.
      expect(prerequisiteDone(t.h.store, "g")).toBe(true);

      // Criterion 22: accounting byte-identical.
      expect(accounting(t, runId)).toBe(before);

      // Criterion 23: the same command again lands nothing twice; a retry is refused, the task being done.
      expect(await withCommandContext(command.commandId, OWNER, () => t.service.acceptAttempt(command))).toEqual(answer);
      for (let i = 0; i < 3; i += 1) await driver.round();
      expect(git(t.repo, "rev-parse", BRANCH)).toBe(tip);
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a" }))).toMatchObject({ error: { code: "work-already-done" } });
      expect(existsSync(acceptRebuildPathOf(t.deps.roots, runId))).toBe(false);
      expect(existsSync(acceptCheckPathOf(t.deps.roots, runId))).toBe(false);
    } finally { await t.h.dispose(); }
  });

  it("merges again and checks again when the tip moved while the checks ran", async () => {
    const gate = gatedCheck();
    const { t, runId, driver } = await closedFailure({ taskId: "a", targetPaths: ["a"] }, { requiredChecks: [gate.command] });
    try {
      await accept(t, runId);
      await untilDeadline(driver, () => existsSync(gate.started));
      // A person's commit on orca/g while the check runs.
      const side = join(t.h.root, "side");
      git(t.repo, "worktree", "add", "-q", side, "orca/g");
      writeFileSync(join(side, "z"), "z\n");
      git(side, "add", "z");
      git(side, "commit", "-qm", "person: moved the tip");
      git(t.repo, "worktree", "remove", side);
      const moved = git(t.repo, "rev-parse", BRANCH);
      writeFileSync(gate.go, "");
      await untilDeadline(driver, settledAcceptance(t, runId));
      const tip = git(t.repo, "rev-parse", BRANCH);
      expect(t.body(runId).operatorAcceptance).toMatchObject({ state: "landed", landedCommit: tip });
      expect(git(t.repo, "rev-parse", `${tip}^1`)).toBe(moved);
      const checked = lines(gate.heads);
      expect(checked).toHaveLength(2);
      expect(checked[0]).not.toBe(tip);
      expect(checked[1]).toBe(tip);
    } finally { await t.h.dispose(); }
  });

  it("writes nothing when the driver stops mid-check, and a new driver checks again and lands it", async () => {
    const gate = gatedCheck();
    const { t, runId, driver } = await closedFailure({ taskId: "a", targetPaths: ["a"] }, { requiredChecks: [gate.command] });
    try {
      await accept(t, runId);
      const pending = t.body(runId), old = git(t.repo, "rev-parse", BRANCH);
      await untilDeadline(driver, () => existsSync(gate.started));
      await driver.stop();
      expect(t.body(runId)).toEqual(pending);
      expect(git(t.repo, "rev-parse", BRANCH)).toBe(old);
      expect(readWork(t.h.store, "g", "a").status).toBe("blocked");
      writeFileSync(gate.go, "");
      const next = t.driver();
      await untilDeadline(next, settledAcceptance(t, runId));
      expect(t.body(runId).operatorAcceptance.state).toBe("landed");
      expect(lines(gate.started)).toHaveLength(2);
      expect(lines(gate.heads)).toEqual([git(t.repo, "rev-parse", BRANCH)]);
    } finally { await t.h.dispose(); }
  });

  it("finishes a landing the driver died after swapping, without a second merge", async () => {
    const { t, runId } = await closedFailure({ taskId: "a", targetPaths: ["a"] }, { requiredChecks: ["test -f a"] });
    try {
      await accept(t, runId);
      const old = git(t.repo, "rev-parse", BRANCH);
      t.deps.crash = (point) => { if (point === "accept-after-cas") throw new DriverCrash(point); };
      const dying = t.driver();
      const deadline = Date.now() + 30_000;
      while (dying.crashed === null && Date.now() < deadline) { await dying.round(); await new Promise((resolve) => setTimeout(resolve, 50)); }
      expect(dying.crashed).toBe("accept-after-cas");
      const swapped = git(t.repo, "rev-parse", BRANCH);
      expect(swapped).not.toBe(old);
      expect(t.body(runId).operatorAcceptance).toMatchObject({ state: "pending", staged: { next: swapped } });
      expect(readWork(t.h.store, "g", "a").status).toBe("blocked");
      t.deps.crash = undefined;
      const next = t.driver();
      await untilDeadline(next, settledAcceptance(t, runId));
      expect(git(t.repo, "rev-parse", BRANCH)).toBe(swapped);
      expect(t.body(runId).operatorAcceptance).toMatchObject({ state: "landed", landedCommit: swapped, staged: null });
      expect(readWork(t.h.store, "g", "a").status).toBe("done");
      expect(await acceptanceEvidence(t.h.store, runId)).toBe(true);
    } finally { await t.h.dispose(); }
  });
});

describe("accept-attempt refuses by name and lands nothing (criteria 18, 19)", { timeout: 120_000 }, () => {
  const refusedCase = async (task: WebFixtureTask, options: HarnessOptions) => {
    const { t, runId, driver } = await closedFailure(task, options);
    const old = git(t.repo, "rev-parse", BRANCH), before = accounting(t, runId);
    await accept(t, runId);
    await untilDeadline(driver, settledAcceptance(t, runId));
    const intent = t.body(runId).operatorAcceptance;
    expect(intent.state).toBe("refused");
    expect(git(t.repo, "rev-parse", BRANCH)).toBe(old);
    expect(readWork(t.h.store, "g", "a").status).toBe("blocked");
    expect(await acceptanceEvidence(t.h.store, runId)).toBe(false);
    expect(accounting(t, runId)).toBe(before);
    expect(readRunActivity(t.h.store, runId, 50).filter((entry) => entry.kind === "attempt-accept-refused")).toHaveLength(1);
    return { t, intent };
  };

  it("refuses an attempt that wrote outside its write set", async () => {
    const { t, intent } = await refusedCase({ taskId: "a", targetPaths: ["a"] }, { files: () => ({ a: "a\n", other: "o\n" }) });
    try { expect(intent.reason).toBe("out-of-bounds:other"); } finally { await t.h.dispose(); }
  });

  it("refuses an attempt that changed a file its checks are defined by", async () => {
    const { t, intent } = await refusedCase({ taskId: "a", targetPaths: ["a", "base.txt"] }, { requiredChecks: ["sh base.txt"], files: () => ({ a: "a\n", "base.txt": "exit 0\n" }) });
    try { expect(intent.reason).toMatch(/^criteria-(modified|weakening):.*base\.txt/); } finally { await t.h.dispose(); }
  });

  it("names a failing setup command as `setup: <cmd>` and runs no check", async () => {
    const { t, intent } = await refusedCase({ taskId: "a", targetPaths: ["a"], contextExtra: { setupCommands: ["exit 3"] } }, { requiredChecks: ["test -f a"] });
    try {
      expect(intent.reason).toBe("check-failed:setup: exit 3");
      expect(intent.failure).toMatchObject({ command: "setup: exit 3", exit: "3" });
    } finally { await t.h.dispose(); }
  });

  it("names a failing check by its command and exit", async () => {
    const { t, intent } = await refusedCase({ taskId: "a", targetPaths: ["a"] }, { requiredChecks: ["test -f a", "echo nope; exit 4"] });
    try {
      expect(intent.reason).toBe("check-failed:echo nope; exit 4");
      expect(intent.failure).toMatchObject({ command: "echo nope; exit 4", exit: "4", tail: "nope" });
    } finally { await t.h.dispose(); }
  });
});
