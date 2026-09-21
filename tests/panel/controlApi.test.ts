/**
 * Task 10 steps 1-2: the whole web control plane driven through a real Panel.
 *
 * Everything a browser can do goes over HTTP here -- including token auth and the
 * canonical-JSON gate -- so a route that answers 200 with a body the ledger never
 * booked, or a view that leaks a trusted path, fails this file rather than a unit
 * test. The two facts a browser cannot supply (the estimate result and a run's
 * terminal disposition) are settled inside the Panel process; see
 * `fixtures/controlPanel.ts` for that boundary.
 */
import { afterAll, describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import {
  commandSuccessSchema,
  controlConfigSchema,
  controlSummarySchema,
  recoveryViewSchema,
  type BudgetEstimateV1,
} from "../../src/control/webProtocol.js";
import type { Amount } from "../../src/control/types.js";
import {
  GROUP,
  command,
  createHarness,
  get,
  json,
  proposalEdit,
  revision,
  settleRecoverableWork,
  settleRun,
  view,
} from "./fixtures/controlPanel.js";

/** The estimate this Panel is answered with; `model` provenance is only valid at exactly these numbers. */
const ESTIMATE_WORK: Amount = { tokens: 2_000_000, activeMs: 9_000_000, attempts: 2, sessions: 2 };
const ESTIMATE_HANDOFF: Amount = { tokens: 100_000, activeMs: 600_000, attempts: 0, sessions: 0 };
const amount = (tokens: number, activeMs: number, attempts: number, sessions: number): Amount => ({ tokens, activeMs, attempts, sessions });

const h = createHarness();
afterAll(async () => {
  await h.dispose();
});

describe("web control acceptance over a real panel (task 10 step 1)", () => {
  it("takes a plan from import to a continued task, and the ledger's own state is durable at every boundary", async () => {
    const paths = await h.workspace();
    const panel = await h.boot("epoch-accept", paths);

    const config = controlConfigSchema.parse(await json(await get(panel, "/api/control/config")));
    expect(config).toMatchObject({ epoch: "epoch-accept", defaults: { estimatorProfileId: "all", estimateMode: "soft" } });
    expect(config.repositories).toEqual([{ repoId: "repo", displayName: "Repo" }]);
    expect(config.plans).toEqual([{ planId: "plan", repoId: "repo", displayName: "Plan" }]);
    expect(config.profiles[0]).toMatchObject({ profileId: "all", observed: { budgetEnforcement: "bounded", contextObservation: "unavailable" } });
    expect(JSON.stringify(config)).not.toContain(panel.root);

    const imported = await command(panel, "/api/control/groups/import-plan", {
      commandId: "accept-import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" },
    });
    expect(imported.status).toBe(201);
    const importResult = commandSuccessSchema.parse(imported.body);
    expect(importResult).toMatchObject({ commandId: "accept-import", verb: "import-plan", result: { kind: "imported" } });
    expect(String(imported.body.actorId)).toMatch(/^operator-/);
    expect(panel.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(GROUP)).toMatchObject({ revision: 1 });
    expect(panel.store.db.prepare("SELECT state FROM estimates WHERE group_id=?").get(GROUP)).toMatchObject({ state: "queued" });
    expect(panel.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE group_id=? AND kind='budget-estimate'").get(GROUP)).toMatchObject({ delivered: 0 });

    const draft = await view(panel);
    expect(draft.schema).toBe("orca-control-group-v1");
    expect(draft.epoch).toBe("epoch-accept");
    expect(draft.plan.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(draft.proposal).toMatchObject({ state: "editable", proposalVersion: 1, budgetMode: null, executionSnapshotHash: null });
    expect(draft.workItems.map((item) => item.taskId)).toEqual(["a"]);
    expect(draft.allocations.find((row) => row.ownerKind === "task" && row.bucket === "work")!.fieldProvenance.tokens).toMatchObject({ provenance: "complex-1m-default" });
    // No trusted path is rendered to the browser, in any view.
    expect(JSON.stringify(draft)).not.toContain(panel.root);
    expect(JSON.stringify(draft)).not.toContain("repoPath");

    await panel.drainWakes();
    const estimateRun = panel.store.db.prepare("SELECT id FROM runs WHERE group_id=? AND work_item_id=?").get(GROUP, String(draft.estimates[0].estimateId))!;
    settleRun(panel.store, String(estimateRun.id), "settled-restartable");
    const output: BudgetEstimateV1 = {
      schema: "budget-estimate-v1", planHash: draft.plan.planHash,
      tasks: [{ taskId: "a", complexity: "M", confidence: "high", work: ESTIMATE_WORK, handoff: ESTIMATE_HANDOFF, rationale: "one module", assumptions: ["clean tree"] }],
      goalReviewReserve: amount(200_000, 900_000, 1, 1), groupRationale: "single task",
    };
    panel.service.completeEstimate(GROUP, draft.estimates[0].estimateId, output);

    const estimated = await view(panel);
    expect(estimated.estimates[0]).toMatchObject({ state: "ready", output, outputHash: sha256Canonical(output) });
    // The model's advice is only authority for the exact number it named.
    const edited = await command(panel, `/api/control/groups/${GROUP}/proposal/edit`, {
      commandId: "accept-edit", expectedRevision: await revision(panel),
      payload: { baseProposalVersion: estimated.proposal.proposalVersion, operations: [{ target: { scope: "task", taskId: "a", allocation: "work", dimension: "tokens" }, value: ESTIMATE_WORK.tokens, provenance: "model", estimateId: estimated.estimates[0].estimateId }] },
    });
    expect(edited.status).toBe(200);
    expect(commandSuccessSchema.parse(edited.body).result).toMatchObject({ kind: "proposal-edited", proposalVersion: 2 });
    expect((await view(panel)).allocations.find((row) => row.ownerKind === "task" && row.bucket === "work")!.fieldProvenance.tokens)
      .toEqual({ provenance: "model", estimateId: estimated.estimates[0].estimateId });

    const binding = { profileId: "all", profileHash: config.profiles[0]!.profileHash };
    const confirmed = await command(panel, `/api/control/groups/${GROUP}/confirm`, {
      commandId: "accept-confirm", expectedRevision: await revision(panel),
      payload: {
        planHash: draft.plan.planHash, proposalVersion: 2, budgetMode: "soft",
        profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" },
        profileHashes: { estimator: binding.profileHash, worker: binding.profileHash, handoff: binding.profileHash, goalReview: binding.profileHash },
        contextPolicy: { handoffAtContextTokens: 800_000 },
      },
    });
    expect(confirmed.status).toBe(200);
    expect(commandSuccessSchema.parse(confirmed.body).result).toMatchObject({ kind: "confirmed" });
    const ready = await view(panel);
    expect(ready.summary.state).toBe("ready");
    expect(ready.proposal).toMatchObject({ state: "confirmed", budgetMode: "soft", executionSnapshotHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(panel.store.db.prepare("SELECT hash FROM execution_snapshots WHERE group_id=?").all(GROUP).length).toBeGreaterThan(0);

    const started = await command(panel, `/api/control/groups/${GROUP}/start`, { commandId: "accept-start", expectedRevision: await revision(panel), payload: {} });
    expect(started.status).toBe(202);
    const scheduled = commandSuccessSchema.parse(started.body).result as { kind: string; wakeId: string };
    expect(scheduled.kind).toBe("scheduled");
    expect(panel.store.db.prepare("SELECT delivered FROM scheduler_wakes WHERE id=?").get(scheduled.wakeId)).toMatchObject({ delivered: 0 });
    await panel.drainWakes();
    const running = await view(panel);
    const workRun = running.runs.find((run) => run.phase === "work")!;
    expect(workRun).toMatchObject({ taskId: "a", state: "starting", phase: "work" });
    expect(panel.store.db.prepare("SELECT id FROM outbox WHERE kind='work-claim' AND id=?").get(`work:${GROUP}:${workRun.runId}`)).toBeDefined();

    const paused = await command(panel, `/api/control/groups/${GROUP}/pause-dispatch`, { commandId: "accept-pause", expectedRevision: await revision(panel), payload: {} });
    expect(paused.status).toBe(200);
    expect((await view(panel)).stop).toMatchObject({ mode: "pause", state: "paused" });
    expect(panel.store.db.prepare("SELECT mode FROM stop_intents WHERE group_id=?").get(GROUP)).toMatchObject({ mode: "pause" });
    const resumed = await command(panel, `/api/control/groups/${GROUP}/resume-dispatch`, { commandId: "accept-resume", expectedRevision: await revision(panel), payload: {} });
    expect(resumed.status).toBe(202);
    expect((await view(panel)).stop).toBeNull();
    expect(panel.store.db.prepare("SELECT mode FROM stop_intents WHERE group_id=?").get(GROUP)).toBeUndefined();

    const stopped = await command(panel, `/api/control/groups/${GROUP}/handoff-stop`, { commandId: "accept-handoff", expectedRevision: await revision(panel), payload: {} });
    expect(stopped.status).toBe(200);
    expect(["handoff-stopped", "handoff-requested", "stop-requested"]).toContain((commandSuccessSchema.parse(stopped.body).result as { kind: string }).kind);
    const handingOff = await view(panel);
    expect(handingOff.stop?.mode).toBe("handoff");
    expect(panel.store.db.prepare("SELECT mode FROM stop_intents WHERE group_id=?").get(GROUP)).toMatchObject({ mode: "handoff" });

    await settleRecoverableWork(panel, workRun.runId, "cp-a-1");
    const recovered = await view(panel);
    expect(recovered.summary.stopState).toBe("handoff-complete");
    expect(recovered.checkpoints.map((row) => row.checkpointId)).toEqual(["cp-a-1"]);
    expect(recovered.runs.find((run) => run.runId === workRun.runId)).toMatchObject({ state: "settled-recoverable" });

    const continued = await command(panel, `/api/control/groups/${GROUP}/resume-from-handoff`, {
      commandId: "accept-continue", expectedRevision: await revision(panel),
      payload: { selections: [{ taskId: "a", predecessorRunId: workRun.runId, checkpointId: "cp-a-1" }] },
    });
    expect(continued.status).toBe(200);
    expect(commandSuccessSchema.parse(continued.body).result).toMatchObject({ kind: "resumed-from-handoff", pendingRuns: [{ taskId: "a" }] });
    expect((await view(panel)).stop).toBeNull();
    await panel.drainWakes();
    const after = await view(panel);
    // The view lists runs by id, so the continuation is named by lineage, not by position.
    const continuedRuns = after.runs.filter((run) => run.phase === "work");
    expect(continuedRuns.map((run) => run.state).sort()).toEqual(["settled-recoverable", "starting"]);
    const next = continuedRuns.find((run) => run.runId !== workRun.runId)!;
    expect(next).toMatchObject({ taskId: "a", state: "starting" });
    expect(recoveryViewSchema.parse(await json(await get(panel, "/api/control/recovery"))).blockers).toEqual([]);
    await panel.close();
  }, 30_000);
});

describe("lost answers, restart and a second tab (task 10 step 2)", () => {
  it("answers an applied-but-lost command from the ledger, and replays the identical envelope instead of re-issuing", async () => {
    const paths = await h.workspace();
    const panel = await h.boot("epoch-lost", paths);
    await command(panel, "/api/control/groups/import-plan", { commandId: "lost-import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });

    // The browser's side of a lost response: the request committed and the answer
    // never reached `sendControlCommand`, so the id stays unresolved and is looked up.
    const envelope = { commandId: "lost-edit", expectedRevision: await revision(panel), payload: proposalEdit(1) };
    const committed = await command(panel, `/api/control/groups/${GROUP}/proposal/edit`, envelope);
    expect(committed.status).toBe(200);
    const discarded = await command(panel, `/api/control/groups/${GROUP}/proposal/edit`, envelope);
    expect(discarded).toEqual(committed);
    const lookup = await json(await get(panel, `/api/control/groups/${GROUP}/commands/lost-edit`));
    expect(lookup).toEqual({ schema: "orca-command-lookup-v1", originalStatus: committed.status, body: committed.body });
    expect(panel.store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE group_id=?").get(GROUP)).toMatchObject({ n: 2 });

    // A command nobody ever answered: the lookup says so, which is what lets the
    // person issue it again under a fresh id instead of being stuck on a phantom.
    const absent = await get(panel, `/api/control/groups/${GROUP}/commands/never-sent`);
    expect(absent.status).toBe(404);
    expect(await absent.json()).toMatchObject({ error: { code: "command-result-not-found" } });
    await panel.close();
  });

  it("refuses the second of two commands naming the same revision and keeps exactly one durable effect", async () => {
    const paths = await h.workspace();
    const panel = await h.boot("epoch-tabs", paths);
    await command(panel, "/api/control/groups/import-plan", { commandId: "tabs-import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
    const before = await view(panel);
    const competing = await Promise.all([
      command(panel, `/api/control/groups/${GROUP}/proposal/edit`, { commandId: "tab-a", expectedRevision: before.summary.commandRevision, payload: proposalEdit(1) }),
      command(panel, `/api/control/groups/${GROUP}/proposal/edit`, { commandId: "tab-b", expectedRevision: before.summary.commandRevision, payload: proposalEdit(2) }),
    ]);
    const statuses = competing.map((result) => result.status).sort();
    expect(statuses).toEqual([200, 409]);
    const refused = competing.find((result) => result.status === 409)!;
    expect(refused.body).toMatchObject({ error: { code: "revision-conflict" } });
    // The refusal names what to re-read against: the winner's revision, not the one it sent.
    expect((refused.body.error as { commandRevision: number }).commandRevision).toBe(before.summary.commandRevision + 1);
    const winner = competing.find((result) => result.status === 200)!;
    const after = await view(panel);
    // Exactly one durable effect: the ledger moved once and the winning edit is the visible one.
    expect(after.proposal.proposalVersion).toBe((winner.body.result as { proposalVersion: number }).proposalVersion);
    expect(after.allocations.find((row) => row.ownerKind === "goal-review")!.amount.tokens).toBe(winner.body.commandId === "tab-a" ? 1 : 2);
    expect((await revision(panel)) - before.summary.commandRevision).toBe(1);
    // Three retained rows, one applied command: the refused one is durable too, which is
    // what lets a second tab read back why its own write did not land.
    expect(panel.store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE group_id=?").get(GROUP)).toMatchObject({ n: 3 });
    expect(panel.store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE group_id=? AND original_status=409").get(GROUP)).toMatchObject({ n: 1 });
    await panel.close();
  });

  it("restarts under a new epoch, voids the cached projection, and keeps the durable group state", async () => {
    const paths = await h.workspace();
    const first = await h.boot("epoch-one", paths);
    await command(first, "/api/control/groups/import-plan", { commandId: "restart-import", expectedRevision: 0, payload: { groupId: GROUP, repoId: "repo", planId: "plan" } });
    const before = await view(first);
    const staleRevision = before.summary.commandRevision;
    await first.close();

    const second = await h.boot("epoch-two", paths);
    const summary = controlSummarySchema.parse(await json(await get(second, "/api/control/summary")));
    expect(summary).toMatchObject({ epoch: "epoch-two", resetRequired: true });
    expect(summary.groups.map((group) => group.groupId)).toEqual([GROUP]);
    const reloaded = await view(second);
    expect(reloaded.epoch).toBe("epoch-two");
    expect(reloaded.plan.planHash).toBe(before.plan.planHash);
    expect(reloaded.proposal.proposalVersion).toBe(before.proposal.proposalVersion);
    // The ledger's own revision survived the restart, so it -- not any cached view --
    // is what a new command must name: a stale one is refused, the reloaded one applies.
    const stale = await command(second, `/api/control/groups/${GROUP}/proposal/edit`, { commandId: "restart-stale", expectedRevision: staleRevision - 1, payload: proposalEdit(7) });
    expect(stale.status).toBe(409);
    expect((await view(second)).proposal.proposalVersion).toBe(before.proposal.proposalVersion);
    const replayed = await command(second, `/api/control/groups/${GROUP}/proposal/edit`, { commandId: "restart-edit", expectedRevision: staleRevision, payload: proposalEdit(7) });
    expect(replayed.status).toBe(200);
    expect((await view(second)).proposal.proposalVersion).toBe(before.proposal.proposalVersion + 1);
    // A command the browser lost across the restart is still answerable.
    const lookup = await get(second, `/api/control/groups/${GROUP}/commands/restart-import`);
    expect(lookup.status).toBe(200);
    expect(await lookup.json()).toMatchObject({ originalStatus: 201, body: { commandId: "restart-import" } });
    const recovery = recoveryViewSchema.parse(await json(await get(second, "/api/control/recovery")));
    expect(recovery.epoch).toBe("epoch-two");
    await second.close();
  });
});
