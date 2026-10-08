/**
 * Issue-fixes spec §3.2 (2) and §3.4, invariant S1: a persisted `shutdown` stop intent exists only when a shutdown froze
 * at least one active run. Stores written by an older Orca hold empty-frozen-set shutdown intents on idle groups, which
 * refuse `start` with `stop-mode-conflict` and offer no way out; startup recovery deletes them. The seed below writes the
 * row exactly as the older `shutdownGroup` did (state `handoff-complete`, frozen set empty, group `stopped`).
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recoverControl } from "../../src/control/recovery.js";
import { readGroupActivity } from "../../src/control/activity.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { WebControlService } from "../../src/control/webService.js";
import { deliverScheduledStart, settleProviderAttempt } from "../../src/control/webDispatch.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const ACCEPTED_AT = "2026-10-07T10:00:00.000Z";
const DEADLINE_AT = "2026-10-07T10:02:00.000Z";

const revisionOf = (store: ControlStore): number => Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
const projectionOf = (store: ControlStore): number => Number(store.db.prepare("SELECT projection_seq FROM groups WHERE id='g'").get()!.projection_seq);
const stopped = (store: ControlStore): boolean => (JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { stopped: boolean }).stopped;
const stopRow = (store: ControlStore): { mode: string; revision: number; body: string } | undefined => {
  const row = store.db.prepare("SELECT mode,revision,body FROM stop_intents WHERE group_id='g'").get();
  return row ? { mode: String(row.mode), revision: Number(row.revision), body: String(row.body) } : undefined;
};
const cleared = (store: ControlStore) => readGroupActivity(store, "g", 50).filter((entry) => entry.kind === "stop-cleared");

/** The row an older Orca's shutdown left on an idle group: a shutdown intent at the current revision, group stopped. */
function seedShutdownIntent(store: ControlStore, frozenRunIds: string[]): void {
  const state = frozenRunIds.length === 0 ? "handoff-complete" : "handoff-pending";
  const body = canonicalBytes({ mode: "shutdown", state, frozenRunIds, acceptedAt: ACCEPTED_AT, deadlineAt: DEADLINE_AT }).toString("utf8");
  store.db.prepare("INSERT INTO stop_intents(group_id,mode,revision,body) VALUES ('g','shutdown',?,?)").run(revisionOf(store), body);
  const group = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  group.stopped = true;
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), "g");
}

async function confirmedGroup() {
  const h = await webFixture();
  const service = new WebControlService(h.deps);
  const confirmed = await service.confirm(h.command("confirm", await h.confirmPayload()));
  if ("error" in confirmed) throw new Error(JSON.stringify(confirmed));
  return { h, service };
}

describe("startup recovery heals empty-frozen-set shutdown intents (issue-fixes spec §3.2 (2))", () => {
  it("deletes the intent, clears stopped, keeps the revision, advances the projection once, records stop-cleared, and start then succeeds", async () => {
    const { h, service } = await confirmedGroup(); try {
      seedShutdownIntent(h.store, []);
      // The dead end the healing removes: start is refused while the stale intent exists.
      const refused = await service.start(h.command("start", {}));
      expect("error" in refused ? refused.error.code : "accepted").toBe("stop-mode-conflict");
      const before = { revision: revisionOf(h.store), projection: projectionOf(h.store) };
      await recoverControl(h.store, h.deps.port);
      expect(stopRow(h.store)).toBeUndefined();
      expect(stopped(h.store)).toBe(false);
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(projectionOf(h.store)).toBe(before.projection + 1);
      expect(cleared(h.store).map((entry) => entry.body)).toEqual([{ reason: "empty-shutdown-intent" }]);
      // A second recovery of the same store finds nothing to heal: no second row, no second projection change.
      await recoverControl(h.store, h.deps.port);
      expect(cleared(h.store)).toHaveLength(1);
      expect(projectionOf(h.store)).toBe(before.projection + 1);
      const started = await service.start(h.command("start", {}));
      expect("error" in started ? started.error.code : started.result.kind).toBe("scheduled");
    } finally { await h.dispose(); }
  });

  it("leaves a shutdown intent that froze a run untouched", async () => {
    const { h } = await confirmedGroup(); try {
      seedShutdownIntent(h.store, ["run-frozen"]);
      const before = { intent: stopRow(h.store), revision: revisionOf(h.store), projection: projectionOf(h.store) };
      await recoverControl(h.store, h.deps.port);
      expect(stopRow(h.store)).toEqual(before.intent);
      expect(stopped(h.store)).toBe(true);
      expect(revisionOf(h.store)).toBe(before.revision);
      expect(projectionOf(h.store)).toBe(before.projection);
      expect(cleared(h.store)).toEqual([]);
    } finally { await h.dispose(); }
  });

  // Review Focus 1: a store already stranded by an older Orca. It is written at schema 8 (no activity table, built the way
  // schema8.test.ts builds older stores), holds the empty-frozen-set intent and a run without startedAt, and must migrate
  // on the normal open, heal, render its views with null times, and accept `start`.
  it("a stranded v8 store migrates, heals, renders a run with startedAt null, and then accepts start", async () => {
    const { h, service } = await confirmedGroup(); try {
      const first = await service.start(h.command("start", {}));
      expect("error" in first ? first.error.code : first.result.kind).toBe("scheduled");
      const claim = await deliverScheduledStart({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, "g");
      if (claim.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(claim)}`);
      // A run written by a pre-v9 Orca has no startedAt/endedAt. It is a proved-never-started run, so recovery has no live work to block on.
      settleProviderAttempt({ store: h.store, profileRouter: h.deps.profileRouter, admissionGate: h.deps.admissionGate }, { runId: claim.runId, phase: "work", firstAttemptProof: "invalid" });
      const run = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(claim.runId)!.body)) as Record<string, unknown>;
      delete run.startedAt; delete run.endedAt;
      h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(run), claim.runId);
      seedShutdownIntent(h.store, []);
      const dir = h.store.stateDir;
      h.store.close();
      // Downgrade to what a version-8 build leaves: no activity table, meta at "8".
      const raw = new DatabaseSync(join(dir, "control.sqlite"));
      raw.exec("DROP TABLE activity");
      raw.prepare("UPDATE meta SET value='8' WHERE key='schemaVersion'").run();
      raw.close();

      const store = await openControlStore({ stateDir: dir });
      try {
        expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()?.value).toBe("9");
        expect(stopRow(store)?.mode).toBe("shutdown");
        // The panel runs recovery with the driver owning web runs, so the stranded run is not walked (it is the driver's).
        await recoverControl(store, h.deps.port, undefined, { driverOwnsWebRuns: true });
        expect(stopRow(store)).toBeUndefined();
        expect(cleared(store).map((entry) => entry.body)).toEqual([{ reason: "empty-shutdown-intent" }]);
        const view = readControlGroup(store, "epoch", "g");
        expect(view.runs.find((entry) => entry.runId === claim.runId)).toMatchObject({ startedAt: null, endedAt: null });
        const after = new WebControlService({ ...h.deps, store });
        const started = await after.start(h.rawCommand("start-after-upgrade", revisionOf(store), "start", { kind: "group", groupId: "g" }, {}) as Parameters<typeof after.start>[0]);
        expect("error" in started ? started.error.code : started.result.kind).toBe("scheduled");
      } finally { store.close(); }
    } finally { await h.dispose().catch(() => undefined); }
  });
});
