// Stuck-runs spec 2026-11-17 S2 (#344) and S4's third bullet: `orca run abandon` ends an attempt now. A run with no token
// number carries a watch-only live ceiling (never reserved); abandon lowers it to the run's observed tokens, ccloop stops the
// run, and Orca settles it `settled-failed` / abandoned with its task `blocked` (`run-abandoned`), dispatching nothing until
// `task retry`. A run ccloop does not stop within the grace is named `abandon-unresolved` in recovery list; a run that never
// reached the provider is settled at once. Named mutations (each seen red in a clone, Rule 9) are written beside the
// assertion they turn red.
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readStartEnvelope, stepA1, stepA2 } from "../../src/control/executionDriver.js";
import type { LiveCeilingWire } from "../../src/control/executionPort.js";
import { syncCeilingReserve } from "../../src/control/liveCeiling.js";
import { readGroup, readWork } from "../../src/control/queries.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";
import { permissionRefusal } from "../../src/panel/permissions.js";
import { driverHarness } from "./fixtures/driverHarness.js";

type T = Awaited<ReturnType<typeof driverHarness>>;
const OWNER = { client: "web", principal: "user:owner" };
const NOTE = "the criterion is about the frozen plan, not the files";
const MAX = Number.MAX_SAFE_INTEGER;

/** A ccloop that runs silently until a live ceiling at or below what the run used arrives, then stops it `exhausted`. */
async function world(options: { honour: boolean }) {
  const knobs = { stopped: false, honour: options.honour, succeed: false };
  const sent: LiveCeilingWire[] = [];
  const t = await driverHarness([{ taskId: "a" }], {
    tokenPolicy: "optional-v1", modelVersion: "followup-g",
    behaviour: () => (knobs.succeed ? "succeed" : knobs.stopped ? "exhausted" : "stoppable-silent"),
    stopReason: () => (knobs.stopped ? "live token ceiling reached" : null),
    setLiveCeiling: async (_input, ceiling) => {
      sent.push(ceiling);
      if (knobs.honour && ceiling.tokens <= 10) knobs.stopped = true;
      return { revision: ceiling.revision, tokens: ceiling.tokens };
    },
    liveCeilingStop: () => (knobs.stopped ? { revision: sent.at(-1)!.revision, tokens: sent.at(-1)!.tokens, cause: "group", observedTokens: 10, phase: "execute", at: "mid-call" } : undefined),
  });
  return { t, knobs, sent };
}
const abandon = (t: T, runId: string, context: Parameters<typeof withCommandContext>[1] = OWNER) => {
  const command = t.h.command("abandon-run", { runId, note: NOTE });
  return withCommandContext(command.commandId, context, () => t.service.abandonRun(command as never));
};
const active = (t: T, runId: string): number => Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active);
const runCount = (t: T): number => Number(t.h.store.db.prepare("SELECT count(*) AS n FROM runs WHERE group_id='g' AND work_item_id='a'").get()!.n);
const code = (answer: unknown): string | undefined => (answer as { error?: { code?: string } }).error?.code;

describe("a run with no token number carries a watch-only ceiling (spec S2)", { timeout: 120_000 }, () => {
  it("its start envelope carries the ceiling ccloop watches, and the group's reserve holds none of it", async () => {
    const { t } = await world({ honour: true });
    try {
      expect(t.body(await t.claim()).grant.work.tokens).toBeNull();
      const runId = String(t.h.store.db.prepare("SELECT id FROM runs WHERE work_item_id='a'").get()!.id);
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      // mutation: drop the watch-only ceiling from createStartingRun -> no liveCeiling in the envelope, red
      expect(readStartEnvelope(t.h.store, t.body(runId)).liveCeiling).toEqual({ protocol: 1, revision: 1, tokens: MAX, cause: "group" });
      const group = readGroup(t.h.store, "g");
      // mutation: boundingCeilingOf answers a watch-only ceiling -> the re-derivation reserves MAX - used, red
      expect(syncCeilingReserve(t.h.store, group)).toBe(false);
      expect((readGroup(t.h.store, "g") as { liveCeilingReserved?: number }).liveCeilingReserved ?? 0).toBe(0);
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});

describe("run abandon on an accepted run (spec S2, acceptance 2)", { timeout: 240_000 }, () => {
  it("lowers the ceiling to the observed tokens, settles the run abandoned when ccloop stops it, dispatches nothing, and task retry works", async () => {
    const { t, sent } = await world({ honour: true });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      const observed = t.body(runId).cumulative.work.tokens;
      const answer = abandon(t, runId);
      expect(answer).toMatchObject({ result: { kind: "run-abandon-requested", runId, taskId: "a", stop: "live-ceiling" } });
      expect(t.body(runId).abandon).toMatchObject({ by: "user:owner", note: NOTE });
      await t.until(driver, () => active(t, runId) === 0, 120);
      // mutation: keep the ceiling's tokens in applyAbandonRun -> MAX sent, ccloop never stops, red (until times out)
      expect(sent.at(-1)).toEqual({ protocol: 1, revision: 2, tokens: observed, cause: "group" });
      const run = t.body(runId);
      // mutation: drop the abandon branch from stepC -> the ceiling path settles it recoverable and continues, red
      expect([run.state, run.failureCode, run.operatorSettlement]).toEqual(["settled-failed", "run-abandoned", { kind: "abandoned", by: "user:owner", note: NOTE, at: run.abandon.at }]);
      expect(readWork(t.h.store, "g", "a").status).toBe("blocked");
      for (let i = 0; i < 10; i += 1) await driver.round();
      expect(runCount(t)).toBe(1);
      // Human ruling 2026-11-17 (「按你的建议走」): an abandoned run keeps no work for accept-attempt.
      await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
      const accept = t.h.command("accept-attempt", { taskId: "a", runId, note: "land it anyway" });
      // mutation: drop the abandoned refusal from applyAcceptAttempt -> attempt-accept-requested, red
      const refused = await withCommandContext(accept.commandId, OWNER, () => t.service.acceptAttempt(accept as never));
      expect((refused as { error?: { code?: string; message?: string } }).error).toMatchObject({ code: "accept-attempt-unsupported" });
      // mutation: drop `abandoned` from retryTask's admissible forms -> task-not-retryable run-state:settled-failed, red
      const retried = t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }));
      expect(retried).toMatchObject({ result: { kind: "task-retried", taskId: "a", fromRunId: runId } });
      expect(readWork(t.h.store, "g", "a").status).toBe("ready");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  // Controller, same session (overrides the builder's reading of S2.3): abandon is for an attempt that cannot succeed;
  // one that finished successfully before ccloop saw the ceiling lands as any success does -- its work is paid for.
  it("a run that succeeds after the abandon request lands as a success, not abandoned", async () => {
    const { t, knobs } = await world({ honour: false });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      expect(abandon(t, runId)).toMatchObject({ result: { kind: "run-abandon-requested", runId } });
      knobs.succeed = true;
      await t.until(driver, () => readWork(t.h.store, "g", "a").status === "done" || t.body(runId).state === "settled-failed", 120);
      // mutation: settle every terminal of an abandoned run as abandoned -> settled-failed / blocked, red
      expect(readWork(t.h.store, "g", "a").status).toBe("done");
      expect(t.body(runId).operatorSettlement).toBeUndefined();
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("is refused to a member and to the socket agent without a person token; a second request is refused by name", async () => {
    expect(permissionRefusal({ kind: "user", userId: "u2", name: "m", roles: ["member"] }, "abandon-run", { runId: "run-1", note: NOTE })?.code).toBe("control-verb-human-only");
    expect(permissionRefusal({ kind: "agent", client: "cli:x" }, "abandon-run", { runId: "run-1", note: NOTE })?.code).toBe("control-person-token-required");
    const { t } = await world({ honour: false });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      expect(code(abandon(t, runId, { client: "cli:x", principal: "agent:cli:x" } as never))).toBe("run-abandon-person-required");
      expect(abandon(t, runId)).toMatchObject({ result: { stop: "live-ceiling" } });
      expect(code(abandon(t, runId))).toBe("run-abandon-pending");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});

describe("a run ccloop does not stop (spec S2 point 4, acceptance 3; S4 third bullet)", { timeout: 240_000 }, () => {
  it("is named abandon-unresolved in recovery list after the grace, and still settles abandoned when it ends", async () => {
    const { t, knobs } = await world({ honour: false });
    try {
      t.deps.handoffGraceMs = 50;
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      abandon(t, runId);
      expect(readControlRecovery(t.h.store, "e").unresolvedRuns).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 80));
      // mutation: drop noteAbandonUnresolved from advance -> never marked, red (until times out)
      await t.until(driver, () => t.body(runId).abandon.unresolvedAt !== undefined);
      expect(t.body(runId).state).toBe("accepted");
      expect(readControlRecovery(t.h.store, "e").unresolvedRuns).toEqual([
        { groupId: "g", taskId: "a", runId, code: "abandon-unresolved", next: ["orca group stop-handoff g", `orca run show ${runId}`] }]);
      knobs.stopped = true;
      await t.until(driver, () => active(t, runId) === 0, 120);
      expect(t.body(runId).operatorSettlement).toMatchObject({ kind: "abandoned" });
      expect(readControlRecovery(t.h.store, "e").unresolvedRuns).toBeUndefined();
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});

describe("a run abandoned before it reached the provider (spec S2 point 4)", { timeout: 240_000 }, () => {
  it("a prepared start-pending run is settled abandoned at once, never claimed again, and task retry works", async () => {
    const { t, sent } = await world({ honour: true });
    try {
      const runId = await t.claim();
      expect(stepA1(t.deps, runId)).toBe(true);
      expect(await stepA2(t.deps, runId)).toBe(true);
      expect([t.body(runId).state, t.body(runId).drive.prepared]).toEqual(["start-pending", true]);
      expect(abandon(t, runId)).toMatchObject({ result: { stop: "not-started" } });
      const driver = t.driver();
      await driver.round();
      // mutation: drop settleAbandonedUnstarted from advance -> stepB accepts it, red
      expect([active(t, runId), t.body(runId).state, t.body(runId).drive.outcome, t.body(runId).operatorSettlement?.kind]).toEqual([0, "settled-failed", "not-started", "abandoned"]);
      expect(t.fake.calls.accept).toEqual([]);
      expect(sent).toEqual([]);
      expect(readWork(t.h.store, "g", "a").status).toBe("blocked");
      for (let i = 0; i < 10; i += 1) await driver.round();
      expect(runCount(t)).toBe(1);
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }))).toMatchObject({ result: { kind: "task-retried" } });
      await driver.stop();
    } finally { await t.h.dispose(); }
  });

  it("a settled or blocked run is refused: only starting or running attempts can be abandoned", async () => {
    const { t } = await world({ honour: true });
    try {
      const runId = await t.claim();
      expect(abandon(t, runId)).toMatchObject({ result: { stop: "not-started" } });
      const driver = t.driver();
      await t.until(driver, () => active(t, runId) === 0);
      expect(code(abandon(t, runId))).toBe("run-abandon-not-running");
      await driver.stop();
    } finally { await t.h.dispose(); }
  });
});

describe("handoff-unresolved in recovery list (spec S4 third bullet)", () => {
  it("names an active run whose newest handoff request's outcome is unknown, with run abandon first", async () => {
    const { t } = await world({ honour: false });
    try {
      const runId = await t.claim();
      t.h.store.db.prepare("INSERT INTO handoff_requests(id,group_id,run_id,state,body) VALUES ('req-1','g',?,'outcome-unknown','{}')").run(runId);
      // mutation: drop the handoff-unresolved branch from unresolvedRunRows -> no row, red
      expect(readControlRecovery(t.h.store, "e").unresolvedRuns).toEqual([{ groupId: "g", taskId: "a", runId, code: "handoff-unresolved",
        next: [`orca run abandon g --run ${runId} --note <why>`, `orca recovery retry --run ${runId}`] }]);
    } finally { await t.h.dispose(); }
  });
});
