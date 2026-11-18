// Stuck-runs spec 2026-11-17 Correction 3 (independent review 2026-11-18, Orca session 4389b15f). Adapted from the reviewer's
// reproductions. An abandoned run with an open handoff request never settled: its terminal went to the abandoned settle,
// which yielded to the request, and step H yielded back (findings 1 and 7). A start-pending run ccloop had already accepted
// kept its watch-only ceiling when the driver found it accepted, so ccloop never stopped it (finding 2). The recovery row
// for a handoff-unresolved run offered `run abandon` after the run was abandoned (finding 8). Controller's decision: abandon
// wins -- the request closes `settled-unrecoverable` (`run-abandoned`) and the run settles as every abandoned run does.
// Named mutations (each seen red in a clone, Rule 9) are written beside the assertion they turn red.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { createExecutionDriver, DriverCrash, readStartEnvelope, stepA1, stepA2 } from "../../src/control/executionDriver.js";
import type { LiveCeilingWire } from "../../src/control/executionPort.js";
import { readBudgetProposal, readGroup, readWork } from "../../src/control/queries.js";
import { groupStopState, readHandoffRequest } from "../../src/control/stopIntent.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { committedAndUsed, requestBody, requestState, stop } from "./fixtures/handoffHarness.js";

type T = Awaited<ReturnType<typeof driverHarness>>;
const OWNER = { client: "web", principal: "user:owner" };
const NOTE = "worthless";

/**
 * A ccloop that runs silently until told to stop, then reports `exhausted` with a live-ceiling stop. With `honour`, a
 * ceiling at or below what the run used stops it. `final` replaces the stopped terminal (an unknown-usage one).
 * `honour` models the ccloop re-check proposed in Correction 3 (a ceiling write re-evaluated at once against the run's
 * observed total), not today's ccloop, which compares only when its next usage observation arrives (or at a phase boundary).
 */
async function world(options: { honour?: boolean; final?: FakeBehaviour; delayAccept?: () => Promise<void> } = {}) {
  const knobs = { stopped: false };
  const sent: LiveCeilingWire[] = [];
  const t = await driverHarness([{ taskId: "a" }], {
    tokenPolicy: "optional-v1", modelVersion: "followup-g", sealedOwnerProof: true,
    behaviour: () => (knobs.stopped ? options.final ?? "exhausted" : "stoppable-silent"),
    stopReason: () => (knobs.stopped ? "live token ceiling reached" : null),
    setLiveCeiling: async (_input, ceiling) => {
      sent.push(ceiling);
      if (options.honour === true && ceiling.tokens <= 10) knobs.stopped = true;
      return { revision: ceiling.revision, tokens: ceiling.tokens };
    },
    liveCeilingStop: () => (knobs.stopped && sent.length > 0 ? { revision: sent.at(-1)!.revision, tokens: sent.at(-1)!.tokens, cause: "group", observedTokens: 10, phase: "execute", at: "mid-call" } : undefined),
    ...(options.delayAccept === undefined ? {} : { delayAccept: options.delayAccept }),
  });
  return { t, knobs, sent };
}
const abandon = (t: T, runId: string) => {
  const command = t.h.command("abandon-run", { runId, note: NOTE });
  return withCommandContext(command.commandId, OWNER, () => t.service.abandonRun(command as never));
};
const active = (t: T, runId: string): number => Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active);
const runCount = (t: T): number => Number(t.h.store.db.prepare("SELECT count(*) AS n FROM runs WHERE group_id='g' AND work_item_id='a'").get()!.n);
const settledAbandoned = (t: T, runId: string) => {
  const run = t.body(runId);
  return [active(t, runId), run.state, run.failureCode, run.operatorSettlement?.kind, readWork(t.h.store, "g", "a").status];
};
const ABANDONED = [0, "settled-failed", "run-abandoned", "abandoned", "blocked"];
/** What the group's books say once the run settled: reserved + used per dimension, used tokens, the task's allocation states. */
const books = (t: T) => ({
  committedAndUsed: committedAndUsed(t), used: readGroup(t.h.store, "g").used.tokens,
  allocations: readBudgetProposal(t.h.store, "g").allocations.filter((a) => a.ownerKind === "task" && a.ownerId === "a").map((a) => a.state),
});

/** The plain abandon (no stop at all): the books every abandon under a request must match. */
async function plainAbandonBooks() {
  const { t, knobs } = await world();
  try {
    const runId = await t.claim();
    const driver = t.driver();
    await t.until(driver, () => t.body(runId).state === "accepted");
    abandon(t, runId);
    knobs.stopped = true;
    await t.until(driver, () => active(t, runId) === 0);
    expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
    return books(t);
  } finally { await t.h.dispose(); }
}

describe("abandon wins over an open handoff request (Correction 3, finding 1)", { timeout: 240_000 }, () => {
  it("route A: abandon, then stop-handoff, then ccloop stops the run -- the request closes run-abandoned and the books match a plain abandon", async () => {
    const expected = await plainAbandonBooks();
    const { t, knobs } = await world();
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      expect(abandon(t, runId)).toMatchObject({ result: { stop: "live-ceiling" } });
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "collecting");
      knobs.stopped = true;
      // mutation: drop the open-request close from settleAbandonedTerminal (yield to the request again) -> active stays 1, red
      await t.until(driver, () => active(t, runId) === 0);
      // mutation: close the request with settleHandoffRequestInTransaction (a second terminaliseRun), or release the run's
      // remainder a second time -> the settle's transaction fails, the run is blocked at C and the handoff settles it
      // settled-recoverable / held, red here
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
      expect(t.body(runId).operatorSettlement).toEqual({ kind: "abandoned", by: "user:owner", note: NOTE, at: t.body(runId).abandon.at });
      expect([requestBody(t, requestId!).state, requestBody(t, requestId!).failureCode]).toEqual(["settled-unrecoverable", "run-abandoned"]);
      // mutation: count a run-abandoned request as partial in deriveFrozenStopState -> handoff-partial, resume refused, red
      expect(groupStopState(t.h.store, "g")).toBe("handoff-complete");
      // mutation: release 1 activeMs more when the request closes -> committed + used differs from a plain abandon, red
      expect(books(t)).toEqual(expected);
      // The stop lifts (nothing to continue), and still nothing is dispatched for the abandoned task until a person's task retry.
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }) as never)).not.toHaveProperty("error");
      for (let i = 0; i < 10; i += 1) await driver.round();
      expect(runCount(t)).toBe(1);
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }))).toMatchObject({ result: { kind: "task-retried" } });
    } finally { await t.h.dispose(); }
  });

  it("route B: stop-handoff past grace (handoff-unresolved), then run abandon as recovery list says, then ccloop stops", async () => {
    const { t, knobs } = await world();
    try {
      const runId = await t.claim();
      let now = Date.now();
      const driver = createExecutionDriver({ ...t.deps, now: () => new Date(now) });
      await t.until(driver, () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "collecting");
      now = Date.parse(readHandoffRequest(t.h.store, "g", requestId!).request.deadlineAt) + 10_000_000;
      await t.until(driver, () => requestState(t, requestId!) === "outcome-unknown");
      expect(readControlRecovery(t.h.store, "e").unresolvedRuns?.[0]?.next[0]).toBe(`orca run abandon g --run ${runId} --note <why>`);
      expect(abandon(t, runId)).toMatchObject({ result: { stop: "live-ceiling" } });
      knobs.stopped = true;
      await t.until(driver, () => active(t, runId) === 0);
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
      // mutation: close only an OPEN_STATES request (not outcome-unknown) -> it stays outcome-unknown, red
      expect([requestBody(t, requestId!).state, requestBody(t, requestId!).failureCode]).toEqual(["settled-unrecoverable", "run-abandoned"]);
      expect(readControlRecovery(t.h.store, "e").unresolvedRuns).toBeUndefined();
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a start-pending run abandoned before it started, then frozen by stop-handoff, settles abandoned, not restartable", async () => {
    const { t } = await world();
    try {
      const runId = await t.claim();
      expect(stepA1(t.deps, runId)).toBe(true);
      expect(await stepA2(t.deps, runId)).toBe(true);
      expect(abandon(t, runId)).toMatchObject({ result: { stop: "not-started" } });
      const [requestId] = await stop(t);
      const driver = t.driver();
      await t.until(driver, () => active(t, runId) === 0);
      // mutation: drop settleAbandonedUnstarted from stepH -> restartRun settles it settled-restartable, task ready, red
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
      expect([t.body(runId).drive.outcome, requestBody(t, requestId!).state, requestBody(t, requestId!).failureCode]).toEqual(["not-started", "settled-unrecoverable", "run-abandoned"]);
      expect(t.fake.calls.accept).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a run that succeeds after abandon under a request still lands (Correction 2.2 holds)", async () => {
    const { t, knobs } = await world({ final: "succeed" });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      abandon(t, runId);
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "collecting");
      knobs.stopped = true;
      await t.until(driver, () => !["request-pending", "latched", "collecting"].includes(requestState(t, requestId!)));
      expect(readWork(t.h.store, "g", "a").status).toBe("done");
      expect(t.body(runId).operatorSettlement).toBeUndefined();
      expect(requestState(t, requestId!)).toBe("settled-recoverable");
    } finally { await t.h.dispose(); }
  });
});

describe("abandon-unresolved under a handoff request (Correction 3, finding 7)", { timeout: 240_000 }, () => {
  it("is marked past the grace on step H's path too, and its row offers no stop-handoff the group already has", async () => {
    const { t, knobs } = await world();
    try {
      t.deps.handoffGraceMs = 50;
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      abandon(t, runId);
      const [requestId] = await stop(t);
      await new Promise((resolve) => setTimeout(resolve, 80));
      // mutation: drop noteAbandonUnresolved from stepH's accepted case -> never marked, red (until times out)
      await t.until(driver, () => t.body(runId).abandon.unresolvedAt !== undefined);
      expect(requestState(t, requestId!)).toBe("collecting");
      // mutation: offer `orca group stop-handoff` whatever the group's stop -> the refused step is listed first, red
      expect(readControlRecovery(t.h.store, "e").unresolvedRuns).toEqual([
        { groupId: "g", taskId: "a", runId, code: "abandon-unresolved", next: [`orca run show ${runId}`] }]);
      knobs.stopped = true;
      await t.until(driver, () => active(t, runId) === 0);
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
      expect(readControlRecovery(t.h.store, "e").unresolvedRuns).toBeUndefined();
    } finally { await t.h.dispose(); }
  });
});

describe("a handoff-unresolved run already abandoned (Correction 3, finding 8)", () => {
  it("is not offered run abandon again (it would be refused run-abandon-pending)", async () => {
    const { t } = await world();
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      abandon(t, runId);
      t.h.store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES ('req-1','g',?,'outcome-unknown','{}')").run(runId);
      // mutation: drop the abandon-pending case from unresolvedRunRows -> `orca run abandon` offered first, red
      expect(readControlRecovery(t.h.store, "e").unresolvedRuns).toEqual([{ groupId: "g", taskId: "a", runId, code: "handoff-unresolved",
        next: [`orca run show ${runId}`, `orca recovery retry --run ${runId}`] }]);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});

describe("an abandoned start-pending run ccloop already accepted (Correction 3, finding 2)", { timeout: 240_000 }, () => {
  it("found accepted by the never-started inspection: its ceiling is lowered and it settles abandoned", async () => {
    const { t, sent } = await world({ honour: true });
    try {
      const runId = await t.claim();
      expect(stepA1(t.deps, runId)).toBe(true);
      expect(await stepA2(t.deps, runId)).toBe(true);
      await t.fake.port.accept(readStartEnvelope(t.h.store, t.body(runId)));
      expect(abandon(t, runId)).toMatchObject({ result: { stop: "not-started" } });
      const driver = t.driver();
      // mutation: drop the ceiling lowering from persistStatus -> MAX stays, ccloop never stops, red (until times out)
      await t.until(driver, () => active(t, runId) === 0);
      expect(sent).toEqual([{ protocol: 1, revision: 2, tokens: 0, cause: "group" }]);
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
    } finally { await t.h.dispose(); }
  });

  it("abandoned while stepB's accept is in flight: the accept lowers its ceiling and it settles abandoned", async () => {
    const box: { t?: T; runId?: string; answer?: unknown } = {};
    const { t, sent } = await world({ honour: true, delayAccept: async () => { if (box.answer === undefined) box.answer = abandon(box.t!, box.runId!); } });
    box.t = t;
    try {
      box.runId = await t.claim();
      const runId = box.runId;
      const driver = t.driver();
      await t.until(driver, () => box.answer !== undefined);
      expect(box.answer).toMatchObject({ result: { stop: "not-started" } });
      // mutation: drop the ceiling lowering from persistStatus -> MAX stays, ccloop never stops, red (until times out)
      await t.until(driver, () => active(t, runId) === 0);
      expect(sent).toEqual([{ protocol: 1, revision: 2, tokens: 0, cause: "group" }]);
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
    } finally { await t.h.dispose(); }
  });
});

describe("an abandoned run moved to accepted by the other writers (Correction 3, finding 2)", { timeout: 240_000 }, () => {
  it("stepB's own recorded execution: a start-pending run with an execution id is accepted with its ceiling lowered", async () => {
    const { t, sent } = await world({ honour: true });
    try {
      const runId = await t.claim();
      expect(stepA1(t.deps, runId)).toBe(true);
      expect(await stepA2(t.deps, runId)).toBe(true);
      await t.fake.port.accept(readStartEnvelope(t.h.store, t.body(runId)));
      // The execution recorded while the run is still start-pending (as a crash between the two writes would leave it).
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...t.body(runId), executionId: `execution-${runId}` }), runId);
      expect(abandon(t, runId)).toMatchObject({ result: { stop: "not-started" } });
      const driver = t.driver();
      // mutation: drop the ceiling lowering from stepB's recorded-execution path -> MAX stays, never stops, red (until times out)
      await t.until(driver, () => active(t, runId) === 0);
      expect(sent).toEqual([{ protocol: 1, revision: 2, tokens: 0, cause: "group" }]);
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
    } finally { await t.h.dispose(); }
  });

  it("step H's inspection: an abandoned run whose accept answered unknown, then frozen by stop-handoff, is accepted with its ceiling lowered", async () => {
    const knobs = { lost: true, stopped: false };
    const sent: LiveCeilingWire[] = [];
    const box: { t?: T; runId?: string; requestId?: string } = {};
    const t = await driverHarness([{ taskId: "a" }], {
      tokenPolicy: "optional-v1", modelVersion: "followup-g", sealedOwnerProof: true,
      behaviour: () => (knobs.lost ? "lost-accept" : knobs.stopped ? "exhausted" : "stoppable-silent"),
      setLiveCeiling: async (_input, ceiling) => { sent.push(ceiling); if (ceiling.tokens <= 10) knobs.stopped = true; return { revision: ceiling.revision, tokens: ceiling.tokens }; },
      liveCeilingStop: () => (knobs.stopped ? { revision: sent.at(-1)!.revision, tokens: sent.at(-1)!.tokens, cause: "group", observedTokens: 10, phase: "execute", at: "mid-call" } : undefined),
      // The person abandons and stops the group while the accept is in flight; ccloop then answers in doubt.
      delayAccept: async () => { if (box.requestId === undefined) { abandon(box.t!, box.runId!); [box.requestId] = await stop(box.t!); } },
      wrapPort: (port) => ({ ...port, accept: async (envelope) => { const answer = await port.accept(envelope); knobs.lost = false; return answer; } }),
    });
    box.t = t;
    try {
      box.runId = await t.claim();
      const runId = box.runId;
      const driver = t.driver();
      await t.until(driver, () => box.requestId !== undefined && t.body(runId).state !== "start-pending");
      // mutation: drop the ceiling lowering from inspectUnderStop -> MAX stays, never stops, red (until times out)
      await t.until(driver, () => active(t, runId) === 0);
      expect(sent).toEqual([{ protocol: 1, revision: 2, tokens: 0, cause: "group" }]);
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
      expect([requestBody(t, box.requestId!).state, requestBody(t, box.requestId!).failureCode]).toEqual(["settled-unrecoverable", "run-abandoned"]);
    } finally { await t.h.dispose(); }
  });
});

describe("an abandoned run whose usage is unknown at its terminal (Correction 2.3)", { timeout: 240_000 }, () => {
  it("is blocked at C as a failed run is; settle-usage ends it as abandoned, with nothing left for close-run", async () => {
    const { t, knobs } = await world({ final: "failed-usage-unknown" });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      abandon(t, runId);
      knobs.stopped = true;
      // mutation: drop the usage-unknown block from settleAbandonedTerminal -> settled abandoned with unknown usage, red
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect([active(t, runId), t.body(runId).drive.blockedAt, t.body(runId).drive.blockedReason, t.body(runId).unknown.work]).toEqual([1, "C", "usage-unknown", true]);
      expect(readControlRecovery(t.h.store, "e").terminalRuns).toEqual([{ groupId: "g", taskId: "a", runId, outcome: "failed", next: "settle-usage" }]);
      for (let i = 0; i < 5; i += 1) await driver.round();
      expect(active(t, runId)).toBe(1);
      const run = t.body(runId);
      const settled = await withCommandContext("settle-abandoned", OWNER, () => (t.service as never as { settleUnknownUsage: (c: unknown) => unknown }).settleUnknownUsage({
        schema: "orca-raw-command-v1", commandId: "settle-abandoned", actorId: "human", expectedRevision: Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
        verb: "settle-unknown-usage", target: { kind: "group", groupId: "g" },
        payload: { taskId: "a", runId, generation: run.generation, acknowledge: run.remaining.work.tokens === null ? "release-unmetered" : "charge-remaining-grant" },
      }));
      expect(settled).not.toHaveProperty("error");
      // Ruling (2026-11-19 tester batch D gate): D4 + review I4 settle an abandoned run blocked on unknown usage as abandoned
      // once any usage settle makes its usage known (settleAbandonedOnceKnown), in the settle's own transaction. The run is
      // then ended by settle-usage alone -- the abandon kept (run-abandoned, operatorSettlement abandoned) -- so close-run,
      // which this criterion used to need, finds no terminal run to close. The intent (the run ends, no new run) is kept.
      // mutation: settle only after a floor method again -> still blocked, active 1, red here.
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ error: { code: "run-closure-not-terminal" } });
      for (let i = 0; i < 5; i += 1) await driver.round();
      expect(runCount(t)).toBe(1);
    } finally { await t.h.dispose(); }
  });
});

// Correction 3, re-review (controller's ruling 2026-11-18): an abandoned attempt never becomes continuable through the handoff.
describe("an abandoned run ccloop answers with a handoff checkpoint (Correction 3, re-review)", { timeout: 240_000 }, () => {
  /** A ccloop that answers a handoff request with a stop-proof checkpoint and no terminal (driverPort.ts `stoppable`). */
  const stoppable = (behaviour: FakeBehaviour) => driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", modelVersion: "followup-g", sealedOwnerProof: true, behaviour: () => behaviour });

  it("usage known: settles abandoned, not a held checkpoint; its request closes run-abandoned; task retry is its way out", async () => {
    const t = await stoppable("stoppable");
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      expect(abandon(t, runId)).toMatchObject({ result: { stop: "live-ceiling" } });
      const [requestId] = await stop(t);
      await t.until(driver, () => active(t, runId) === 0);
      // mutation: drop the abandoned settle from deliverAndCollect's checkpoint branch -> settled-recoverable / held, red
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
      // Ruling (2026-11-19 change-sized runs P0 review): the abandoned settle now writes `cleanedUp: false` and the next
      // round's stepCleanupFailed removes the result copy, then writes `cleanedUp: true` (spec §5.6 Correction, review I2).
      // Intent kept: the run ends cleaned up with outcome `stopped` and no checkpoint; it is judged once that round ran.
      await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
      // mutation: leave the drive outcome null -> red here (and task retry below would refuse outcome:none)
      expect([t.body(runId).drive.outcome, t.body(runId).drive.cleanedUp, t.body(runId).checkpointId]).toEqual(["stopped", true, null]);
      expect([requestBody(t, requestId!).state, requestBody(t, requestId!).failureCode]).toEqual(["settled-unrecoverable", "run-abandoned"]);
      expect(groupStopState(t.h.store, "g")).toBe("handoff-complete");
      expect(await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }) as never)).not.toHaveProperty("error");
      for (let i = 0; i < 5; i += 1) await driver.round();
      expect(runCount(t)).toBe(1);
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }))).toMatchObject({ result: { kind: "task-retried" } });
    } finally { await t.h.dispose(); }
  });

  it("a blocked run's collected failure (closeBlocked): settles abandoned, its outcome kept", async () => {
    const t = await stoppable("failed");
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      // The state an abandoned run reaches when it was blocked at C for unknown usage and a later usage event made it known
      // (usage.ts clears `unknown` on a later cumulative): blocked at C, an outcome, known usage, `abandon` on the run.
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...t.body(runId), abandon: { by: "user:owner", note: NOTE, at: Date.now() } }), runId);
      const [requestId] = await stop(t);
      await t.until(driver, () => active(t, runId) === 0);
      // mutation: drop the abandoned settle from closeBlocked -> the collected failure becomes a held checkpoint, red
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
      expect(t.body(runId).drive.outcome).toBe("failed");
      expect([requestBody(t, requestId!).state, requestBody(t, requestId!).failureCode]).toEqual(["settled-unrecoverable", "run-abandoned"]);
    } finally { await t.h.dispose(); }
  });

  it("a blocked success (closeBlocked) is not settled abandoned: a success is never abandoned (Correction 2.2)", async () => {
    const t = await driverHarness([{ taskId: "a", safetyPolicy: { denylistPaths: ["outside.txt"] } }], { tokenPolicy: "optional-v1", modelVersion: "followup-g", sealedOwnerProof: true, // Ruling: human 「这次批准改写所有必要的判据」 (Orca session ca534c51, 2026-11-18) — v4 bounds a harvest by the denylist, so the out-of-bounds write is denied explicitly
      behaviour: () => "succeed", files: () => ({ a: "a\n", "outside.txt": "x\n" }) });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect([t.body(runId).drive.outcome, t.body(runId).drive.blockedReason]).toEqual(["succeeded", "out-of-bounds:outside.txt"]);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...t.body(runId), abandon: { by: "user:owner", note: NOTE, at: Date.now() } }), runId);
      const [requestId] = await stop(t);
      await t.until(driver, () => active(t, runId) === 0);
      // mutation: settle any collected outcome abandoned in closeBlocked (succeeded too) -> settled-failed / abandoned, red
      expect(t.body(runId).operatorSettlement).toBeUndefined();
      expect(requestBody(t, requestId!).failureCode).not.toBe("run-abandoned");
    } finally { await t.h.dispose(); }
  });

  it("usage unknown: stays unrecoverable (usage-unsettled), and settle-usage refuses `recovered`, so it is never continued", async () => {
    const t = await stoppable("stoppable-usage-unknown");
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      abandon(t, runId);
      const [requestId] = await stop(t);
      await t.until(driver, () => active(t, runId) === 0);
      expect([t.body(runId).state, readWork(t.h.store, "g", "a").status, requestBody(t, requestId!).state, requestBody(t, requestId!).failureCode])
        .toEqual(["settled-unrecoverable", "blocked", "settled-unrecoverable", "usage-unsettled"]);
      const run = t.body(runId);
      const settled = await withCommandContext("settle-abandoned-stop", OWNER, () => (t.service as never as { settleUnknownUsage: (c: unknown) => unknown }).settleUnknownUsage({
        schema: "orca-raw-command-v1", commandId: "settle-abandoned-stop", actorId: "human", expectedRevision: Number(t.h.store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision),
        verb: "settle-unknown-usage", target: { kind: "group", groupId: "g" },
        payload: { taskId: "a", runId, generation: run.generation, acknowledge: run.remaining.work.tokens === null ? "release-unmetered" : "charge-remaining-grant" },
      }));
      // mutation: drop the abandon refusal from settlementAdmission -> recovered: settled-recoverable, task held, red
      expect(settled).toMatchObject({ error: { code: "run-usage-not-settleable", message: "run-usage-not-settleable:abandoned" } });
      expect([t.body(runId).state, readWork(t.h.store, "g", "a").status]).toEqual(["settled-unrecoverable", "blocked"]);
    } finally { await t.h.dispose(); }
  });
});

/**
 * Change-sized runs spec 2026-11-19 §5.6 (P0 review I2): the abandoned settle under a stop archived the run and removed its
 * workspace, but wrote `cleanedUp: true` with <sourceDir>/repo still there, so nothing ever removed it. It now writes
 * `cleanedUp: false`, and stepCleanupFailed finishes the run: no second archive (the row is complete), the copy removed,
 * then `cleanedUp: true` -- resumable across a crash anywhere between.
 */
describe("an abandoned run settled under a stop loses its result copy (change-sized runs §5.6, P0 review I2)", { timeout: 240_000 }, () => {
  const archiveCount = (t: T, runId: string): number => Number(t.h.store.db.prepare("SELECT count(*) AS n FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=?").get(runId)!.n);

  // mutation I2: write `cleanedUp: true` in settleAbandonedUnderStop again -> stepCleanupFailed never runs, repo stays, red
  it("after the next round the copy is gone and cleanedUp is true, with no second archive", async () => {
    const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", modelVersion: "followup-g", sealedOwnerProof: true, behaviour: () => "stoppable" });
    try {
      const driver = t.driver();
      const runId = await t.claim();
      await t.until(driver, () => t.body(runId).state === "accepted");
      abandon(t, runId);
      await stop(t);
      await t.until(driver, () => active(t, runId) === 0);
      const repo = join(t.body(runId).drive.sourceDir, "repo");
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
      // What the settle leaves: archived, workspace gone, the copy still here for stepCleanupFailed.
      expect([t.body(runId).drive.cleanedUp, existsSync(t.body(runId).drive.workspacePath), existsSync(repo)]).toEqual([false, false, true]);
      const archived = archiveCount(t, runId);
      expect(archived).toBeGreaterThan(0);
      await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
      expect(t.body(runId).drive).toMatchObject({ outcome: "stopped", cleanedUp: true, cleanupError: null });
      expect(existsSync(repo)).toBe(false);
      expect(existsSync(t.body(runId).drive.sourceDir)).toBe(true);
      expect(archiveCount(t, runId)).toBe(archived);
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
    } finally { await t.h.dispose(); }
  });

  // The crash leaves the copy removed and `cleanedUp: false`; the next driver skips the archive (the latest row is
  // complete), finds nothing left to remove and writes `cleanedUp: true`. mutation: archive unconditionally in
  // stepCleanupFailed -> the resumed round reads the removed copy (ENOENT), cleanupError set, red.
  it("a crash between the removal and the cleanedUp write is finished by the next driver", async () => {
    const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", modelVersion: "followup-g", sealedOwnerProof: true, behaviour: () => "stoppable" });
    try {
      const crashing = createExecutionDriver({ ...t.deps, crash: (point: string) => { if (point === "cleanup-failed-after-result-copies") throw new DriverCrash(point as never); } });
      const runId = await t.claim();
      await t.until(crashing, () => t.body(runId).state === "accepted");
      abandon(t, runId);
      await stop(t);
      await t.until(crashing, () => crashing.crashed !== null);
      const repo = join(t.body(runId).drive.sourceDir, "repo");
      expect(settledAbandoned(t, runId)).toEqual(ABANDONED);
      expect([t.body(runId).drive.cleanedUp, existsSync(repo)]).toEqual([false, false]);
      const archived = archiveCount(t, runId);
      await crashing.stop();
      await t.until(t.driver(), () => t.body(runId).drive.cleanedUp === true);
      expect(t.body(runId).drive).toMatchObject({ cleanedUp: true, cleanupError: null });
      expect(archiveCount(t, runId)).toBe(archived);
    } finally { await t.h.dispose(); }
  });
});
