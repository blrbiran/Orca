// Tester follow-up G spec §2.1 / §2.5 / §10.3 (plan Part B, O4, review focus 2 and 5): what a run ccloop stopped at its live
// ceiling becomes. At the group cap it keeps its work and continues at once while the group has room (1M or more), else
// waits for a top-up, which continues it; at its pause line it waits for a decision; at a person's hard cap it ends
// exhausted as today. A lowered limit never lowers a running ceiling: the next claim is refused instead.
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readGroupActivity } from "../../src/control/activity.js";
import { archiveAdmission, blockRun, collectInto, readStartEnvelope, stepC } from "../../src/control/executionDriver.js";
import { commitCandidate, readCommittedCheckpoint } from "../../src/control/checkpoints.js";
import { archiveRun } from "../../src/control/archive.js";
import type { Candidate } from "../../src/control/types.js";
import { readGroup, readWork } from "../../src/control/queries.js";
import { recordUsage } from "../../src/control/usage.js";
import { readControlRecovery, readGroupSummary } from "../../src/panel/controlViews.js";
import { readWebGroup } from "../../src/control/webService.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { ExecutionPort, StartEnvelope } from "../../src/control/executionPort.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { ceilingStopNext } from "../../src/commands/domains/verbs.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;
const M = 1_000_000;

interface Knobs { exhausted: boolean; workTokens: number; cause: "group" | "pause-line" | "task-cap"; only?: string }
async function harness(tasks: string[], limit: number, knobs: Knobs, wrapPort?: (port: ExecutionPort) => ExecutionPort): Promise<Harness> {
  const t = await driverHarness(tasks.map(taskId => ({ taskId })), {
    tokenPolicy: "optional-v1", modelVersion: "followup-g", wrapPort,
    behaviour: (id: string) => knobs.exhausted && (knobs.only === undefined || knobs.only === id) ? "exhausted" : "stoppable",
    workTokens: () => knobs.workTokens,
    liveCeilingStop: (id: string, envelope: StartEnvelope) => knobs.exhausted && (knobs.only === undefined || knobs.only === id) && envelope.liveCeiling !== undefined
      ? { revision: envelope.liveCeiling.revision, tokens: envelope.liveCeiling.tokens, cause: knobs.cause, observedTokens: knobs.workTokens, phase: "execute" as const, at: "mid-call" as const }
      : undefined,
    stopReason: () => knobs.exhausted ? "live token ceiling reached" : null,
  });
  setLimit(t, limit);
  return t;
}
function setLimit(t: Harness, tokens: number): unknown {
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  return t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens } }));
}
const setIntent = (t: Harness, taskId: string, intent: unknown) => {
  const work = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
  work.tokenIntent = intent;
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify(work), taskId);
};
const work = (t: Harness, taskId = "a") => readWork(t.h.store, "g", taskId) as unknown as Record<string, unknown> & { status: string };
const kinds = (t: Harness, kind: string) => readGroupActivity(t.h.store, "g", 50).filter(entry => entry.kind === kind);
async function settled(t: Harness, driver: ReturnType<Harness["driver"]>, runId: string, state: string): Promise<void> {
  await t.until(driver, () => t.body(runId).state === state, 200);
}
async function nextRun(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  await driver.round();
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}

describe("a run stopped at its live ceiling (spec §2.1, §2.5)", { timeout: 300_000 }, () => {
  it("a group stop with room left continues the task with its work", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 2 * M, cause: "group" };
    const t = await harness(["a"], 20 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      await settled(t, driver, first, "settled-recoverable");
      expect(t.body(first).liveCeilingStop).toMatchObject({ cause: "group", observedTokens: 2 * M });
      expect(work(t)).toMatchObject({ status: "ready", allowancePredecessorRunId: first });
      expect(work(t)).not.toHaveProperty("groupCapStop");
      expect(kinds(t, "group-cap-reached").map(entry => entry.body)).toEqual([expect.objectContaining({ autoContinued: true, observedTokens: 2 * M })]);
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      for (let i = 0; i < 400 && t.body(second).drive?.prepared !== true; i++) await driver.round();
      // It continues from the stopped run's checkpoint, with a fresh ceiling.
      expect(readStartEnvelope(t.h.store, t.body(second)).inputCheckpoint).not.toBeNull();
      expect(t.body(second).liveCeiling).toMatchObject({ cause: "group" });
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // Tester #513: the ceiling and the task's own grant were the same number, so the overshoot emptied the grant while the
  // stop auto-continued the task (ready, its own run holding the work). The claim gate skips a zero-remaining task and no
  // surface said why. The exits now name the top-up retry, which accepts --work here and keeps the predecessor.
  it("an auto-continued stop its own grant cannot fund names a top-up, and the top-up continues its work", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 2 * M, cause: "group" };
    const t = await harness(["a"], 20 * M, knobs);
    try {
      const row = t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!;
      const item = JSON.parse(String(row.body)); item.grant.work.tokens = 1 * M;
      t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(item));
      const driver = t.driver();
      const first = await t.claim();
      await settled(t, driver, first, "settled-recoverable");
      expect(work(t)).toMatchObject({ status: "ready", allowancePredecessorRunId: first });
      // The grant gate skips it: remaining = max(0, 1M - 2M) = 0 (tokenPolicy.ts, fundedAllowance.ts). No start wake is
      // armed for a ceiling stop, so dispatch answers idle -- nothing claims the task.
      expect(await deliverScheduledStart(t.dispatch, "g")).toEqual({ kind: "idle" });
      const topUp = `orca task retry g a --as-person --work '{"tokens":${2 * M}}'`;
      const take = `orca task accept-attempt g a --run ${first} --note '<why the attempt is enough>'`;
      // mutation: drop the ceilingGrantExhausted branch of ceilingStopExits -> ceilingStops undefined, red
      expect(readControlRecovery(t.h.store, "epoch").ceilingStops).toEqual([{ groupId: "g", taskId: "a", runId: first, cause: "group", next: [topUp, take] }]);
      const bare = t.h.command("retry-task", { taskId: "a", runId: first });
      const refused = withCommandContext(bare.commandId, { client: "web", principal: "user:owner", personAuthority: true }, () => t.service.retryTask(bare)) as { error: { code: string; message: string } };
      // mutation: drop the ceilingGrantExhausted branch of ceilingStopWait -> run-state:settled-recoverable, red
      expect(refused.error).toMatchObject({ code: "task-not-retryable", message: expect.stringContaining("live-ceiling-stop:grant-exhausted:") });
      expect(ceilingStopNext(refused.error.message.slice("task-not-retryable:".length))).toBe(topUp);
      // mutation: keep the generic run-state refusal for a ready auto-continued stop -> the top-up retry is refused, red
      const retry = t.h.command("retry-task", { taskId: "a", runId: first, work: { tokens: 2 * M } });
      expect(withCommandContext(retry.commandId, { client: "web", principal: "user:owner", personAuthority: true }, () => t.service.retryTask(retry))).toMatchObject({ result: { kind: "task-retried" } });
      // The predecessor survives the top-up, so the next claim resumes the stopped attempt instead of re-planning it.
      expect(work(t)).toMatchObject({ status: "ready", allowancePredecessorRunId: first });
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      for (let i = 0; i < 400 && t.body(second).drive?.prepared !== true; i++) await driver.round();
      expect(readStartEnvelope(t.h.store, t.body(second)).inputCheckpoint).not.toBeNull();
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // #310: both C visits start while the run is accepted. The late one sees a changed result tree after the first settled.
  it("reuses the committed ceiling checkpoint instead of blocking a late C visit", async () => {
    let releaseSecond = () => {};
    const waiting = new Promise<void>((resolve) => { releaseSecond = resolve; });
    let secondReached = () => {};
    const reached = new Promise<void>((resolve) => { secondReached = resolve; });
    let collects = 0;
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs, (port) => ({ ...port, collect: async (input, afterSeq) => {
      if (++collects === 2) { secondReached(); await waiting; }
      return port.collect(input, afterSeq);
    } }));
    try {
      const driver = t.driver();
      const runId = await t.claim();
      knobs.workTokens = t.body(runId).liveCeiling.tokens - 100_000;
      await t.until(driver, () => t.body(runId).state === "accepted");
      const first = stepC(t.deps, runId);
      const second = stepC(t.deps, runId);
      const results = Promise.allSettled([first, second]);
      await reached;
      expect(await first).toBe(true);
      expect(t.body(runId).state).toBe("settled-recoverable");
      const usedAfterFirst = readGroup(t.h.store, "g").used.tokens;
      // Ruling (2026-11-19 change-sized runs P0): the ceiling settle now removes <sourceDir>/repo (spec §5.6), so the late
      // write goes into the source directory, whose logs a re-archive would capture differently; intent kept: a late C
      // visit reuses the committed checkpoint and never re-archives.
      expect(existsSync(join(t.body(runId).drive.sourceDir, "repo"))).toBe(false);
      writeFileSync(join(t.body(runId).drive.sourceDir, "late.txt"), "different snapshot\n");
      releaseSecond();
      expect(await results).toEqual([{ status: "fulfilled", value: true }, { status: "fulfilled", value: true }]);
      expect(t.body(runId).state).toBe("settled-recoverable");
      expect(readGroup(t.h.store, "g").used.tokens).toBe(usedAfterFirst);
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(runId)).toEqual({ n: 1 });
      expect((await readCommittedCheckpoint(t.h.store, runId)).checkpointId).toBe(`ceiling-${runId}`);
      expect(kinds(t, "group-cap-reached")).toHaveLength(1);
      await driver.stop();
    } finally { releaseSecond(); await t.h.dispose(); }
  });

  it("a late C collect error cannot reblock a run its earlier visit already settled", async () => {
    let releaseFirst = () => {}, releaseSecond = () => {}, sawFirst = () => {}, sawSecond = () => {};
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const firstEntered = new Promise<void>((resolve) => { sawFirst = resolve; });
    const secondEntered = new Promise<void>((resolve) => { sawSecond = resolve; });
    let collects = 0;
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs, (port) => ({ ...port, collect: async (input, afterSeq) => {
      const call = ++collects;
      if (call === 1) { sawFirst(); await firstGate; }
      if (call === 2) { sawSecond(); await secondGate; throw new Error("late collect failed"); }
      return port.collect(input, afterSeq);
    } }));
    try {
      const driver = t.driver();
      const runId = await t.claim();
      knobs.workTokens = t.body(runId).liveCeiling.tokens - 100_000;
      await t.until(driver, () => t.body(runId).state === "accepted");
      const first = stepC(t.deps, runId);
      await firstEntered;
      const late = driver.round();
      await secondEntered;
      releaseFirst();
      expect(await first).toBe(true);
      releaseSecond();
      await late;
      expect(t.body(runId).state).toBe("settled-recoverable");
      expect(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(runId)).toEqual({ n: 1 });
      await driver.stop();
    } finally { releaseFirst(); releaseSecond(); await t.h.dispose(); }
  });

  it("finishes a valid ceiling checkpoint written before its DB transaction", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs);
    try {
      const driver = t.driver();
      const runId = await t.claim();
      knobs.workTokens = t.body(runId).liveCeiling.tokens - 100_000;
      await t.until(driver, () => t.body(runId).state === "accepted");
      const report = await collectInto(t.deps, t.body(runId));
      expect(report.terminal?.outcome).toBe("exhausted");
      const sourceDir = t.body(runId).drive.sourceDir;
      const raw = report.candidate!;
      const archive = await archiveRun(t.h.store, { runId, sourceDir, repoDir: join(sourceDir, "repo"), stopProof: raw.stopProof }, archiveAdmission(t.deps));
      expect(archive.snapshot).not.toBeNull();
      const checkpointId = `ceiling-${runId}`;
      const candidate: Candidate = { ...raw, checkpointId, artifacts: [...archive.artifacts, ...raw.artifacts, raw.handoff], snapshot: archive.snapshot };
      await expect(commitCandidate(t.h.store, candidate, { ...archiveAdmission(t.deps), afterArchive: async () => { throw new Error("crash after file"); } }))
        .rejects.toThrow("crash after file");
      const checkpointDir = join(t.h.store.stateDir, "checkpoints", runId);
      expect(t.h.store.db.prepare("SELECT id FROM checkpoints WHERE run_id=?").get(runId)).toBeUndefined();
      const original = JSON.parse(readFileSync(join(checkpointDir, `${checkpointId}.json`), "utf8")) as Candidate;
      writeFileSync(join(sourceDir, "repo", "late.txt"), "changed after crash\n");
      expect(await stepC(t.deps, runId)).toBe(true);
      expect(t.body(runId).state).toBe("settled-recoverable");
      expect((await readCommittedCheckpoint(t.h.store, runId)).snapshot).toEqual(original.snapshot);
      expect(readdirSync(checkpointDir).filter((name) => name.startsWith(".staging-"))).toEqual([]);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("recovery retry repairs a blocked run whose ceiling checkpoint was already committed", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs);
    try {
      const driver = t.driver();
      const runId = await t.claim();
      knobs.workTokens = t.body(runId).liveCeiling.tokens - 100_000;
      await settled(t, driver, runId, "settled-recoverable");
      const committed = await readCommittedCheckpoint(t.h.store, runId);
      const activityCount = kinds(t, "group-cap-reached").length;
      // The old late C visit caught checkpoint-id-conflict and blockRun overwrote the settled run's body.
      blockRun(t.deps, runId, "C", "checkpoint-id-conflict");
      expect(t.body(runId).state).toBe("blocked");
      expect(readControlRecovery(t.h.store, "epoch").blockedRuns).toEqual([{
        groupId: "g", taskId: "a", runId, blockedAt: "C", reason: "checkpoint-id-conflict", next: `orca recovery retry --run ${runId}`,
      }]);
      expect(readGroupSummary(t.h.store, "g").recoveryBlockerCount).toBe(1);
      const result = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in result ? result.error : result.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(runId).state).toBe("settled-recoverable");
      expect(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)).toEqual({ active: 0 });
      expect(await readCommittedCheckpoint(t.h.store, runId)).toEqual(committed);
      expect(kinds(t, "group-cap-reached")).toHaveLength(activityCount);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // #313: a row written by the older settle has its ceiling checkpoint committed while the body still lacks
  // liveCeilingStop (the first settle ran before work usage was observed). Re-entering the settle must finish the
  // transition as a named, settleable block instead of hashing undefined forever.
  it("finishes a stored ceiling row whose committed checkpoint predates its liveCeilingStop (#313)", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs);
    try {
      const driver = t.driver();
      const runId = await t.claim();
      knobs.workTokens = t.body(runId).liveCeiling.tokens - 100_000;
      await settled(t, driver, runId, "settled-recoverable");
      const row = t.body(runId);
      delete row.liveCeilingStop;
      row.state = "accepted";
      row.unknown = { ...row.unknown, work: true };
      row.drive = { ...row.drive, blockedAt: null, blockedReason: null, outcome: null };
      t.h.store.db.prepare("UPDATE runs SET body=?, active=1 WHERE id=?").run(JSON.stringify(row), runId);
      // mutation: hashPayload(run.liveCeilingStop) without a guard -> control-non-json-payload.
      expect(await stepC(t.deps, runId)).toBe(true);
      const after = t.body(runId);
      expect(after.liveCeilingStop).toMatchObject({ cause: "group" });
      expect(after.state).toBe("blocked");
      expect(after.drive).toMatchObject({ blockedAt: "C", blockedReason: "live-ceiling-usage-unknown", outcome: "exhausted" });
      expect(readControlRecovery(t.h.store, "epoch").terminalRuns).toEqual([
        expect.objectContaining({ runId, outcome: "exhausted", next: "settle-usage" }),
      ]);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("repairs the old ceiling run after its task has already claimed a successor", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 2 * M, cause: "group" };
    const t = await harness(["a"], 20 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      await settled(t, driver, first, "settled-recoverable");
      knobs.exhausted = false;
      const next = await nextRun(t, driver);
      expect(work(t).status).toBe("running");
      blockRun(t.deps, first, "C", "checkpoint-id-conflict");
      const result = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", first, { scope: "run", runId: first }));
      expect("error" in result ? result.error : result.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      expect(t.body(first).state).toBe("settled-recoverable");
      expect(work(t).currentRunId).toBe(next);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("refuses repair while an out-of-order usage event remains unbooked", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs);
    try {
      const driver = t.driver();
      const runId = await t.claim();
      knobs.workTokens = t.body(runId).liveCeiling.tokens - 100_000;
      await settled(t, driver, runId, "settled-recoverable");
      blockRun(t.deps, runId, "C", "checkpoint-id-conflict");
      const row = t.h.store.db.prepare("SELECT body FROM usage_events WHERE run_id=? AND seq=1").get(runId);
      const event = JSON.parse(String(row!.body));
      const highWater = t.body(runId).highWater;
      expect(recordUsage(t.h.store, { ...event, eventSeq: highWater + 2 })).toMatchObject({ applied: true, highWater });
      const result = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in result ? result.error : result.result).toMatchObject({ code: "checkpoint-identity-conflict", message: expect.stringContaining("usage-gap") });
      expect(t.body(runId).state).toBe("blocked");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("does not offer a normal retry for an inactive run blocked at another step", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs);
    try {
      const driver = t.driver();
      const runId = await t.claim();
      knobs.workTokens = t.body(runId).liveCeiling.tokens - 100_000;
      await settled(t, driver, runId, "settled-recoverable");
      blockRun(t.deps, runId, "D", "checkpoint-id-conflict");
      expect(readControlRecovery(t.h.store, "epoch").blockedRuns).toBeUndefined();
      expect(readGroupSummary(t.h.store, "g").recoveryBlockerCount).toBe(0);
      const retry = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", runId, { scope: "run", runId }));
      expect("error" in retry ? retry.error : retry.result).toMatchObject({ code: "recovery-blocked", message: expect.stringContaining("inactive-run") });
      expect(t.body(runId).state).toBe("blocked");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a group stop without room waits as group-cap-reached, and a top-up continues it", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      knobs.workTokens = t.body(first).liveCeiling.tokens - 100_000;
      await settled(t, driver, first, "settled-recoverable");
      expect(work(t)).toMatchObject({ status: "blocked", groupCapStop: { runId: first, observedTokens: knobs.workTokens } });
      expect(kinds(t, "group-cap-reached").map(entry => entry.body)).toEqual([expect.objectContaining({ autoContinued: false })]);
      // Nothing is claimed while it waits.
      await driver.round();
      expect((await deliverScheduledStart(t.dispatch, "g")).kind).not.toBe("claimed");
      expect(setLimit(t, 13 * M)).toMatchObject({ result: { kind: "limit-set" } });
      expect(work(t).status).toBe("ready");
      expect(work(t)).not.toHaveProperty("groupCapStop");
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      expect(t.body(second).liveCeiling.tokens).toBeGreaterThan(9 * M);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a stop that passed the cap by its last request can still be topped up", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      // ccloop stops mid-call: the request in flight is booked past the ceiling, and past the group limit.
      knobs.workTokens = t.body(first).liveCeiling.tokens + 400_000;
      await settled(t, driver, first, "settled-recoverable");
      const g = readGroup(t.h.store, "g");
      expect(g.used.tokens + g.reserved.tokens).toBeGreaterThan(3 * M);
      expect(setLimit(t, 13 * M)).toMatchObject({ result: { kind: "limit-set" } });
      expect(work(t).status).toBe("ready");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a top-up continues a group-cap-stopped task while another runs, and the group holds no more than its limit", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group", only: "a" };
    const t = await harness(["a", "b"], 4 * M, knobs);
    try {
      const driver = t.driver();
      const runA = await t.claim();
      const runB = await t.claim();
      // a stops at the cap with no room left; b keeps running.
      knobs.workTokens = t.body(runA).liveCeiling.tokens;
      await settled(t, driver, runA, "settled-recoverable");
      const before = t.body(runB).liveCeiling;
      expect(work(t, "a").status).toBe("blocked");
      expect(setLimit(t, 14 * M)).toMatchObject({ result: { kind: "limit-set" } });
      expect(work(t, "a").status).toBe("ready");
      knobs.exhausted = false;
      // The waiting task is claimed first (its claim takes the headroom); it continues from its stopped run.
      const again = await nextRun(t, driver);
      for (let i = 0; i < 400 && t.body(again).drive?.prepared !== true; i++) await driver.round();
      expect(readStartEnvelope(t.h.store, t.body(again)).inputCheckpoint).not.toBeNull();
      expect(t.body(runB).state).toBe("accepted");
      expect(t.body(runB).liveCeiling.tokens).toBeGreaterThanOrEqual(before.tokens);
      const g = readGroup(t.h.store, "g");
      expect(g.used.tokens + g.reserved.tokens).toBeLessThanOrEqual(14 * M);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a lowered limit leaves running ceilings unchanged and the next claim is refused group-budget-unavailable", async () => {
    const knobs: Knobs = { exhausted: false, workTokens: 10, cause: "group" };
    const t = await harness(["a", "b"], 20 * M, knobs);
    try {
      const runA = await t.claim();
      const ceiling = t.body(runA).liveCeiling;
      const g = readGroup(t.h.store, "g");
      expect(setLimit(t, g.used.tokens + g.reserved.tokens)).toMatchObject({ result: { kind: "limit-set" } });
      expect(t.body(runA).liveCeiling).toEqual(ceiling);
      const driver = t.driver();
      await driver.round();
      expect(t.body(runA).liveCeiling).toEqual(ceiling);
      expect(await deliverScheduledStart(t.dispatch, "g")).toMatchObject({ reason: "group-budget-unavailable" });
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // Tester #478 (short term): the stopped task's person retry was refused `run-state:settled-recoverable` and recovery retry
  // answered an empty observation, neither naming the stop or the top-up that continues the task. Both now refuse by the
  // stop and name a set-limit that is run here as printed (parsed back from the refusal) and does continue the task.
  it("a group-cap wait: task retry and recovery retry name the stop and a set-limit that continues the task", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 0, cause: "group" };
    const t = await harness(["a"], 3 * M, knobs);
    try {
      const driver = t.driver();
      const first = await t.claim();
      knobs.workTokens = t.body(first).liveCeiling.tokens - 100_000;
      await settled(t, driver, first, "settled-recoverable");
      expect(work(t)).toMatchObject({ status: "blocked", groupCapStop: { runId: first } });
      const command = t.h.command("retry-task", { taskId: "a", runId: first });
      const retried = withCommandContext(command.commandId, { client: "web", principal: "user:owner", personAuthority: true }, () => t.service.retryTask(command)) as { error: { code: string; message: string } };
      // mutation: drop the ceilingStopWait check in retryTask -> run-state:settled-recoverable, red
      expect(retried.error.code).toBe("task-not-retryable");
      expect(retried.error.message).toContain("live-ceiling-stop:group-cap:the group's token limit (3000000) stopped this run");
      const recovery = await t.service.recoveryRetry(t.h.runCommand("recovery-retry", first, { scope: "run", runId: first })) as { error: { code: string; message: string } };
      // mutation: drop the ceilingStopWait check in retryRun -> recovery-observed resolved:false, red
      expect(recovery.error).toMatchObject({ code: "recovery-blocked", message: expect.stringContaining("live-ceiling-stop:group-cap:") });
      const next = ceilingStopNext(retried.error.message.slice("task-not-retryable:".length))!;
      expect(next).toBe(`orca group set-limit g --limit ${3 * M + knobs.workTokens} --as-person`);
      expect(ceilingStopNext(recovery.error.message.slice("recovery-blocked:".length))).toBe(next);
      // The printed exit works: its limit is a top-up, which continues the task with its work.
      expect(setLimit(t, Number(/--limit (\d+)/.exec(next)![1]))).toMatchObject({ result: { kind: "limit-set" } });
      expect(work(t)).toMatchObject({ status: "ready", allowancePredecessorRunId: first });
      knobs.exhausted = false;
      const second = await nextRun(t, driver);
      expect(t.body(second).taskId).toBe("a");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a pause-line wait: task retry names the stop and the decision", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 10_400_000, cause: "pause-line" };
    const t = await harness(["a"], 100 * M, knobs);
    try {
      setIntent(t, "a", { tokens: M, hard: false, provenance: "human", estimateId: null });
      const driver = t.driver();
      const first = await t.claim();
      await settled(t, driver, first, "settled-recoverable");
      const command = t.h.command("retry-task", { taskId: "a", runId: first });
      const retried = withCommandContext(command.commandId, { client: "web", principal: "user:owner", personAuthority: true }, () => t.service.retryTask(command)) as { error: { code: string; message: string } };
      // mutation: drop the usagePause branch of ceilingStopWait -> run-state:settled-recoverable, red
      expect(retried.error).toMatchObject({ code: "task-not-retryable", message: expect.stringContaining("live-ceiling-stop:pause-line:") });
      expect(ceilingStopNext(retried.error.message.slice("task-not-retryable:".length))).toBe("orca task decide-usage g a --decision continue");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a pause-line stop waits for a decision, with the ratio to its expectation", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 10_400_000, cause: "pause-line" };
    const t = await harness(["a"], 100 * M, knobs);
    try {
      setIntent(t, "a", { tokens: M, hard: false, provenance: "human", estimateId: null });
      const driver = t.driver();
      const first = await t.claim();
      expect(t.body(first).liveCeiling).toMatchObject({ tokens: 10 * M, cause: "pause-line" });
      await settled(t, driver, first, "settled-recoverable");
      expect(work(t)).toMatchObject({ status: "blocked", usagePause: { multiple: 1, line: 10 * M, usedTokens: 10_400_000, expectationTokens: M, runId: first } });
      expect(kinds(t, "usage-paused").map(entry => entry.body)).toEqual([expect.objectContaining({ ratio: 10.4, usedTokens: 10_400_000, expectationTokens: M })]);
      expect(kinds(t, "group-cap-reached")).toEqual([]);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a task-cap stop ends exhausted as today: no pause, no group-cap wait, no new activity", async () => {
    const knobs: Knobs = { exhausted: true, workTokens: 400_000, cause: "task-cap" };
    const t = await harness(["a"], 20 * M, knobs);
    try {
      setIntent(t, "a", { tokens: 400_000, hard: true, provenance: "human", estimateId: null });
      const driver = t.driver();
      const first = await t.claim();
      expect(t.body(first).liveCeiling).toMatchObject({ tokens: 400_000, cause: "task-cap" });
      await settled(t, driver, first, "blocked");
      expect(t.body(first).drive.blockedReason).toBe("terminal:exhausted");
      expect(work(t)).not.toHaveProperty("usagePause");
      expect(work(t)).not.toHaveProperty("groupCapStop");
      expect([...kinds(t, "usage-paused"), ...kinds(t, "group-cap-reached")]).toEqual([]);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});
