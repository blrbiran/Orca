import { describe, expect, it } from "vitest";
import { WebControlService } from "../../src/control/webService.js";
import { settleHandoffRequest } from "../../src/control/stopIntent.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { writeArtifact } from "../../src/control/archive.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";
import { webFixture } from "../control/fixtures/web.js";
import type { ControlStore } from "../../src/control/store.js";
import type { FakeBehaviour } from "../control/fixtures/driverPort.js";
import { requestState, stop, work, type Harness } from "../control/fixtures/handoffHarness.js";

// Handoff delivery spec §13.1 C-4 (human ruling 2026-09-25, an online contract change): `RunViewV1.continuable`
// is true only for a run a handoff stopped -- persisted `settled-recoverable` holding a checkpoint whose
// result is `partial`. A run the driver settled normally also DISPLAYS `settled-recoverable` (persisted
// `settled` + `recoverable`), and before this field the panel offered it for continuation.

const EPOCH = "epoch-continuable";
const persisted = (store: ControlStore, runId: string) => JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body)) as Record<string, unknown>;
const viewOf = (store: ControlStore, runId: string) => readControlGroup(store, EPOCH, "g").runs.find((entry) => entry.runId === runId)!;

/** A confirmed group with one Web work run, handoff-stopped and settled through the adapter-facing API, holding a checkpoint. */
async function handedOff(result: "partial" | "complete", outcome: "settled-recoverable" | "settled-unrecoverable" = "settled-recoverable") {
  const h = await webFixture();
  const deps = { ...h.deps, now: () => new Date("2026-09-25T10:00:00.000Z") };
  const service = new WebControlService(deps);
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): confirmation resolves agent selections through ccloop first, so it is awaited and carries the previewed selectionsHash.
  await service.confirm(h.command("confirm", await h.confirmPayload()));
  await service.start(h.command("start", {}));
  const claim = await deliverScheduledStart(deps, "g");
  if (claim.kind !== "claimed") throw new Error(JSON.stringify(claim));
  const runId = claim.runId;
  const stopped = await service.handoffStop(h.command("handoff-stop", {}));
  if ("error" in stopped) throw new Error(JSON.stringify(stopped));
  const requestId = String(h.store.db.prepare("SELECT id FROM handoff_requests WHERE run_id=?").get(runId)!.id);
  settleHandoffRequest(deps, { requestId, outcome });
  const run = persisted(h.store, runId);
  const checkpointId = `cp-${runId}`;
  // The read model re-hashes every checkpoint's handoff reference, so the packet goes through the real archiver.
  const handoff = await writeArtifact(h.store, `handoff-${runId}`, canonicalBytes({ schema: "orca-handoff-packet-v1", runId, result }));
  // Canonical bytes and hash, as H-settle writes them (spec §13.2 C-1). `candidateSchema` (src/control/schema.ts)
  // is strict and has no `schema` field, so the fixture must not carry one either.
  const candidate = {
    checkpointId, groupId: "g", workItemId: run.workItemId, taskId: run.taskId, runId,
    generation: run.generation, graphVersion: run.graphVersion, targetVersion: run.targetVersion, usageHighWater: run.highWater,
    result, artifacts: [], snapshot: null, handoff, missing: [], unresolvedRequestIds: [], stopProof: null, terminalOutcome: "cancelled",
  };
  h.store.db.prepare("INSERT INTO checkpoints(id,run_id,hash,body) VALUES (?,?,?,?)").run(checkpointId, runId, sha256Canonical(candidate), canonicalBytes(candidate).toString("utf8"));
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...run, checkpointId, recoverable: outcome === "settled-recoverable" }), runId);
  return { h, runId };
}

describe("RunViewV1.continuable (handoff delivery C-4)", () => {
  it("is false for a run the driver settled normally, although it displays settled-recoverable", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const run = persisted(t.h.store, runId);
      expect(run).toMatchObject({ state: "settled", recoverable: true });
      const checkpoint = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM checkpoints WHERE id=?").get(String(run.checkpointId))!.body)) as { result: string };
      expect(checkpoint.result).toBe("complete");
      expect(viewOf(t.h.store, runId)).toMatchObject({ state: "settled-recoverable", continuable: false });
    } finally { await t.h.dispose(); }
  }, 30000);

  it("is true for a run a handoff settled recoverably with a partial checkpoint", async () => {
    const { h, runId } = await handedOff("partial"); try {
      // Final fix wave: every assertion reads the read model's own output, after the call (no read-back of the fixture's writes).
      expect(viewOf(h.store, runId)).toMatchObject({ state: "settled-recoverable", continuable: true });
    } finally { await h.dispose(); }
  });

  it("is false for a handoff-settled run whose checkpoint says the task completed", async () => {
    const { h, runId } = await handedOff("complete"); try {
      expect(viewOf(h.store, runId)).toMatchObject({ state: "settled-recoverable", continuable: false });
    } finally { await h.dispose(); }
  });

  it("is false for a handoff-settled run that is not recoverable, although its checkpoint is partial", async () => {
    const { h, runId } = await handedOff("partial", "settled-unrecoverable"); try {
      expect(viewOf(h.store, runId)).toMatchObject({ state: "settled-unrecoverable", continuable: false });
    } finally { await h.dispose(); }
  });

  // Preflight ruling I5 (spec §13.2 I-5, controller 2026-09-25): `continuable` also requires every
  // dimension of the run's remaining work grant to be > 0 -- otherwise `registerContinuation`
  // (continuation.ts:169) would refuse the whole batch with `budget-overrun` the moment this
  // predecessor were selected. The task's `work_items.grant` is kept in sync with the run's
  // `remaining` (the D-VIEW invariant, controlViews.ts:503) so the read model stays valid.
  it("is false for a handoff-settled run with a partial checkpoint whose remaining work grant has an exhausted dimension", async () => {
    const { h, runId } = await handedOff("partial"); try {
      const run = persisted(h.store, runId) as { workItemId: string; grant: { work: Record<string, number> }; cumulative: { work: Record<string, number> }; remaining: { work: Record<string, number> } };
      const exhausted = {
        ...run,
        cumulative: { ...run.cumulative, work: { ...run.cumulative.work, tokens: run.grant.work.tokens } },
        remaining: { ...run.remaining, work: { ...run.remaining.work, tokens: 0 } },
      };
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(exhausted), runId);
      const workRow = h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id=?").get("g", run.workItemId)!;
      const work = JSON.parse(String(workRow.body)) as { grant: { work: Record<string, number> } };
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?")
        .run(JSON.stringify({ ...work, grant: { ...work.grant, work: { ...work.grant.work, tokens: 0 } } }), "g", run.workItemId);
      expect(viewOf(h.store, runId)).toMatchObject({ state: "settled-recoverable", continuable: false, remaining: { tokens: 0 } });
    } finally { await h.dispose(); }
  });
});

// Final fix wave FR-C1 (final review C1, controller ruling 2026-09-25): a predecessor that was already continued
// keeps its persisted `settled-recoverable` and `partial` checkpoint for good, so `continuable` must also require
// what `assertPredecessor` requires -- the task's `currentRunId` is this run and its status is `held`. Otherwise,
// after any later handoff-stop of the group, the panel's one batch is refused whole and its no-continuation
// resume is hidden: no exit.

/**
 * The panel's rule (web/src/ControlGroupView.tsx `continuableRuns`), applied to the server's read model, as
 * handoffE2E.test.ts applies it: every run the server marks continuable, with its non-unknown checkpoint.
 */
function panelSelections(t: Harness): Array<{ taskId: string; predecessorRunId: string; checkpointId: string }> {
  const view = readControlGroup(t.h.store, "epoch-test", "g");
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.continuable !== true) return [];
    const checkpoint = view.checkpoints.find((candidate) => candidate.runId === run.runId && candidate.state !== "unknown");
    return checkpoint ? [{ taskId: run.taskId, predecessorRunId: run.runId, checkpointId: checkpoint.checkpointId }] : [];
  });
}

/** Task a stopped mid-run, parked held, then continued: answers the predecessor and the claimed continuation. */
async function continued(behaviour: { value: FakeBehaviour }, after: FakeBehaviour) {
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => behaviour.value });
  const predecessor = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(predecessor).state === "accepted");
  const [first] = await stop(t);
  await t.until(driver, () => requestState(t, first!) === "settled-recoverable");
  const checkpointId = t.body(predecessor).checkpointId as string;
  const resumed = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: predecessor, checkpointId }] } as never));
  if ("error" in resumed) throw new Error(`resume-from-handoff refused: ${JSON.stringify(resumed.error)}`);
  behaviour.value = after;
  const claimed = await deliverScheduledStart(t.dispatch, "g");
  if (claimed.kind !== "claimed") throw new Error(`resume claim refused: ${JSON.stringify(claimed)}`);
  return { t, driver, predecessor, continuation: claimed.runId };
}

describe("RunViewV1.continuable after a continuation (final fix wave FR-C1)", { timeout: 60_000 }, () => {
  it("offers only the newest link of a continuation chain after a second handoff, and the panel's batch is accepted", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, driver, predecessor, continuation } = await continued(behaviour, "stoppable"); try {
      await t.until(driver, () => t.body(continuation).state === "accepted");
      const [second] = await stop(t);
      await t.until(driver, () => requestState(t, second!) === "settled-recoverable");
      const view = readControlGroup(t.h.store, "epoch-test", "g");
      expect(view.summary.stopState).toBe("handoff-complete");
      const flags = Object.fromEntries(view.runs.map((run) => [run.runId, { state: run.state, continuable: run.continuable }]));
      // Both display settled-recoverable with a partial checkpoint; only the one the task is parked on is continuable.
      expect(flags).toEqual({
        [predecessor]: { state: "settled-recoverable", continuable: false },
        [continuation]: { state: "settled-recoverable", continuable: true },
      });
      const selections = panelSelections(t);
      expect(selections).toEqual([{ taskId: "a", predecessorRunId: continuation, checkpointId: t.body(continuation).checkpointId }]);
      const resumed = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections } as never));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
      // Registered, not yet claimed: the task still names this run but is no longer held, so it is not offered twice.
      expect(work(t, "a")).toMatchObject({ status: "continuing", currentRunId: continuation });
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.find((run) => run.runId === continuation)).toMatchObject({ continuable: false });
    } finally { await t.h.dispose(); }
  });

  it("offers nothing once the continuation landed and the group is stopped again, so the no-continuation resume is the way out", async () => {
    const behaviour = { value: "stoppable" as FakeBehaviour };
    const { t, driver, predecessor, continuation } = await continued(behaviour, "succeed"); try {
      await t.until(driver, () => t.body(continuation).state === "settled" && t.body(continuation).drive.cleanedUp === true);
      expect(work(t, "a").status).toBe("done");
      await stop(t);
      const view = readControlGroup(t.h.store, "epoch-test", "g");
      expect(view.summary.stopState).toBe("handoff-complete");
      expect(view.runs.find((run) => run.runId === predecessor)).toMatchObject({ state: "settled-recoverable", continuable: false });
      expect(view.runs.find((run) => run.runId === continuation)).toMatchObject({ state: "settled-recoverable", continuable: false });
      // The panel renders "Resume (no continuation)" exactly when this is empty at handoff-complete; that command is accepted.
      expect(panelSelections(t)).toEqual([]);
      const resumed = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] } as never));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
    } finally { await t.h.dispose(); }
  });
});
