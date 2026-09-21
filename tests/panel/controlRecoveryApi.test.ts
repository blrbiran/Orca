/**
 * Task 10 step 2: what the Panel says when a claim cannot be made, and what it refuses to say.
 *
 * Recovery is the part of this feature a person cannot see working, so it is the part worth
 * pinning to the HTTP surface: a blocker has to be durable, scoped and clearable by one named
 * command; an evidence manifest has to resolve to bytes the store actually holds; and a restart
 * that finds a run still open has to stop dispatching rather than guess.
 */
import { afterAll, describe, expect, it } from "vitest";
import { commandSuccessSchema, controlConfigSchema, recoveryViewSchema } from "../../src/control/webProtocol.js";
import type { Amount } from "../../src/control/types.js";
import {
  GROUP,
  command,
  createHarness,
  get,
  json,
  revision,
  settleRecoverableWork,
  settleRun,
  view,
  type Panel,
} from "./fixtures/controlPanel.js";
import { profileSnapshot } from "../control/fixtures/web.js";

/** What a healthy profile reports; the degraded-claim test withholds one field of it. */
const snapshotCaps = profileSnapshot().profile.capabilities as unknown as Record<string, unknown>;

const ESTIMATE_WORK: Amount = { tokens: 2_000_000, activeMs: 9_000_000, attempts: 2, sessions: 2 };
const ESTIMATE_HANDOFF: Amount = { tokens: 100_000, activeMs: 600_000, attempts: 0, sessions: 0 };
const amount = (tokens: number, activeMs: number, attempts: number, sessions: number): Amount => ({ tokens, activeMs, attempts, sessions });

const h = createHarness();
afterAll(async () => {
  await h.dispose();
});

/** Import, answer the estimate the import queued, and confirm soft -- the state a claim needs. */
async function confirmSoft(panel: Panel): Promise<string> {
  const config = controlConfigSchema.parse(await json(await get(panel, "/api/control/config")));
  const imported = await command(panel, "/api/control/groups/import-plan", { commandId: `recover-import-${panel.epoch}`, expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
  expect(imported.status).toBe(201);
  const draft = await view(panel);
  await panel.drainWakes();
  const estimateRun = panel.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=?").get(GROUP, String(draft.estimates[0].estimateId))!;
  settleRun(panel.store, String(estimateRun.id), "settled-restartable");
  panel.service.completeEstimate(GROUP, draft.estimates[0].estimateId, {
    schema: "budget-estimate-v1", planHash: draft.plan.planHash,
    tasks: [{ taskId: "a", complexity: "M", confidence: "high", work: ESTIMATE_WORK, handoff: ESTIMATE_HANDOFF, rationale: "one module", assumptions: ["clean tree"] }],
    goalReviewReserve: amount(200_000, 900_000, 1, 1), groupRationale: "single task",
  });
  const hash = config.profiles[0]!.profileHash;
  const confirmed = await command(panel, `/api/control/groups/${GROUP}/confirm`, {
    commandId: `recover-confirm-${panel.epoch}`, expectedRevision: await revision(panel),
    payload: {
      planHash: draft.plan.planHash, proposalVersion: draft.proposal.proposalVersion, budgetMode: "soft",
      profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
      profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
      contextPolicy: { handoffAtContextTokens: 800_000 },
    },
  });
  expect(confirmed.status).toBe(200);
  return draft.plan.planHash;
}

describe("recovery blockers over the panel (task 10 step 2)", () => {
  it("keeps a refused claim durable and group-local, and one retry re-arms it into a real run", async () => {
    const paths = await h.workspace();
    let capable = true;
    const panel = await h.boot("epoch-blocked", paths, {
      capabilities: () => ({ ...snapshotCaps, usageObservation: capable ? "realtime" : "unavailable" }),
    });
    await confirmSoft(panel);

    // The claim is accepted while the profiles still probe clean -- so the degradation is found
    // by the dispatcher on delivery, which is the only path that records a group-local blocker.
    const started = await command(panel, `/api/control/groups/${GROUP}/start`, { commandId: "blocked-start", expectedRevision: await revision(panel), payload: {} });
    expect(started.status).toBe(202);
    capable = false;
    await panel.drainWakes();

    // The claim was refused, so nothing was booked: no run, no dispatch, and the wake is
    // still pending -- which is exactly what makes the retry an observation, not a re-apply.
    const blocked = await view(panel);
    expect(blocked.runs.filter((run) => run.phase === "work")).toEqual([]);
    expect(panel.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE group_id=? AND kind='start'").get(GROUP)).toMatchObject({ delivered: 0 });
    const recovery = recoveryViewSchema.parse(await json(await get(panel, "/api/control/recovery")));
    expect(recovery.dispatchBlocked).toBe(false);
    expect(recovery.blockers).toEqual([{ scope: "group", groupId: GROUP, runId: null, code: "claim-capability-unavailable", evidenceIds: [] }]);
    expect((await get(panel, "/api/control/recovery")).status).toBe(200);

    capable = true;
    const retried = await command(panel, "/api/control/recovery/retry", {
      commandId: "blocked-retry", expectedRevision: await revision(panel), payload: { scope: "group", groupId: GROUP },
    });
    expect(retried.status).toBe(200);
    expect(commandSuccessSchema.parse(retried.body).result).toMatchObject({
      kind: "recovery-observed", resolved: true, blockerCodes: ["claim-capability-unavailable"], evidenceIds: [], wakeIds: [],
    });
    expect(recoveryViewSchema.parse(await json(await get(panel, "/api/control/recovery"))).blockers).toEqual([]);

    await panel.drainWakes();
    const claimed = await view(panel);
    expect(claimed.runs.find((run) => run.phase === "work")).toMatchObject({ taskId: "a", state: "starting" });
    await panel.close();
  });
});

describe("evidence and restart (task 10 step 2)", () => {
  it("serves a recoverable run's evidence manifest as bytes the store holds, and refuses a dangling reference", async () => {
    const paths = await h.workspace();
    const panel = await h.boot("epoch-evidence", paths);
    await confirmSoft(panel);
    await command(panel, `/api/control/groups/${GROUP}/start`, { commandId: "evidence-start", expectedRevision: await revision(panel), payload: {} });
    await panel.drainWakes();
    const runId = (await view(panel)).runs.find((run) => run.phase === "work")!.runId;

    await command(panel, `/api/control/groups/${GROUP}/handoff-stop`, { commandId: "evidence-stop", expectedRevision: await revision(panel), payload: {} });
    await settleRecoverableWork(panel, runId, "cp-evidence-1");
    const manifest = await json(await get(panel, `/api/control/runs/${runId}/evidence`));
    expect(manifest).toMatchObject({ schema: "orca-run-evidence-v1", runId });
    expect(manifest.entries).toMatchObject([{ kind: "handoff", evidenceId: `handoff-${runId}` }]);
    expect(String(JSON.stringify(manifest))).not.toContain(panel.root);
    const entry = (manifest.entries as Array<Record<string, unknown>>)[0];
    expect(Number(entry.byteLength)).toBeGreaterThan(0);
    const download = await get(panel, String(entry.downloadUrl));
    expect(download.status).toBe(200);
    expect((await download.arrayBuffer()).byteLength).toBe(entry.byteLength);

    // The reference is what the browser is handed, so a manifest whose bytes are gone has to
    // be refused rather than rendered with a hole in it.
    panel.store.db.prepare("DELETE FROM artifacts WHERE id=?").run(String(entry.evidenceId));
    const dangling = await get(panel, `/api/control/runs/${runId}/evidence`);
    expect(dangling.status).toBe(423);
    expect(await dangling.json()).toMatchObject({ error: { code: "recovery-blocked", retryable: false } });
    await panel.close();
  });

  it("reopens onto a run still marked active and stops dispatching until a person recovers it", async () => {
    const paths = await h.workspace();
    const first = await h.boot("epoch-crash", paths);
    await confirmSoft(first);
    await command(first, `/api/control/groups/${GROUP}/start`, { commandId: "crash-start", expectedRevision: await revision(first), payload: {} });
    await first.drainWakes();
    const openRun = (await view(first)).runs.find((run) => run.phase === "work")!;
    expect(first.store.db.prepare("SELECT active FROM runs WHERE id=?").get(openRun.runId)).toMatchObject({ active: 1 });
    await first.close();

    // Nothing told the store the run ended, so the reopened Panel cannot assume it may dispatch.
    const second = await h.boot("epoch-crash-2", paths);
    expect(second.store.dispatchBlocked).toBe(true);
    const recovery = recoveryViewSchema.parse(await json(await get(second, "/api/control/recovery")));
    expect(recovery).toMatchObject({ epoch: "epoch-crash-2", dispatchBlocked: true });
    expect(second.store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE group_id=? AND active=1").get(GROUP)).toMatchObject({ n: 1 });

    await second.drainWakes();
    const after = await view(second);
    expect(after.runs.filter((run) => run.phase === "work").map((run) => run.runId)).toEqual([openRun.runId]);
    // The refusal is the store's, not this process's: a read-only view still answers.
    expect(recoveryViewSchema.parse(await json(await get(second, "/api/control/recovery"))).dispatchBlocked).toBe(true);
    await second.close();
  });
});
