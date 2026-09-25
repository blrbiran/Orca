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
  service.confirm(h.command("confirm", h.confirmPayload()));
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
      expect(persisted(h.store, runId)).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(viewOf(h.store, runId)).toMatchObject({ state: "settled-recoverable", continuable: true });
    } finally { await h.dispose(); }
  });

  it("is false for a handoff-settled run whose checkpoint says the task completed", async () => {
    const { h, runId } = await handedOff("complete"); try {
      expect(persisted(h.store, runId)).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(viewOf(h.store, runId)).toMatchObject({ state: "settled-recoverable", continuable: false });
    } finally { await h.dispose(); }
  });

  it("is false for a handoff-settled run that is not recoverable, although its checkpoint is partial", async () => {
    const { h, runId } = await handedOff("partial", "settled-unrecoverable"); try {
      expect(persisted(h.store, runId)).toMatchObject({ state: "settled-unrecoverable", recoverable: false, checkpointId: `cp-${runId}` });
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
      expect(persisted(h.store, runId)).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(viewOf(h.store, runId)).toMatchObject({ state: "settled-recoverable", continuable: false });
    } finally { await h.dispose(); }
  });
});
