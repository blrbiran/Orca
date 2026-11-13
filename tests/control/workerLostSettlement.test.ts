// Tester follow-up I, seat K (Orca session d467cbd2; the controller's paid dogfood run, group g-28d9b560): an
// expectation-model run whose ccloop worker was killed mid-execute. Its plan's usage was observed, the killed call's is
// unknown, and its group has a finite token limit, so it waits for an explicit settlement (worker-lost recovery spec
// 2026-11-12 §5.5). Measured there:
//  B -- `charge-remaining-grant` stored `remaining.work.tokens: 0` beside `grant.work.tokens: null`, so every group read
//       refused `recovery-blocked:run-identity:<run>` (the whole group unreadable) and the settlement marker itself did not
//       validate (no grant to check the charge against), which also refused the task's retry;
//  C -- it charged the run's unused active time, attempts and sessions as if the killed call had spent them, so the
//       automatic worker-lost restart was skipped `authored-budget-exhausted` (the machine lost the work, the task did not
//       fail: spec §5.4);
//  A -- `charge-observed-floor` was refused `observed-floor-unknown`: ccloop writes its floor from the dead worker, which
//       never can, although the run's own observed usage is known.
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { decideFundedAllowance } from "../../src/control/fundedAllowance.js";
import { refreshCeilingReserves } from "../../src/control/liveCeiling.js";
import { readGroup, readWork } from "../../src/control/queries.js";
import { workerLostCommandId } from "../../src/control/systemDebug.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { readWebGroup } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";

const M = 1_000_000, OBSERVED = 61_193;
const workerLost = { failureCause: { cause: "worker-lost", phase: "execute", retries: 0, detail: "owner pid 97863 does not exist" } } as const;

async function lostRun(options: { cause?: string; behaviour?: "failed-after-observed-usage-unknown" | "failed-usage-unknown" } = {}) {
  const t = await driverHarness([{ taskId: "a" }], {
    tokenPolicy: "optional-v1", modelVersion: "followup-g", workTokens: () => OBSERVED,
    behaviour: () => options.behaviour ?? "failed-after-observed-usage-unknown",
    failure: () => ({ failureCause: { ...workerLost.failureCause, cause: options.cause ?? "worker-lost" } }) as never,
  });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const set = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 10 * M } }));
  if ("error" in set) throw new Error(`set-limit refused: ${JSON.stringify(set)}`);
  // Orca restarts a worker-lost task only in a group it orchestrates (`run`).
  t.h.store.db.prepare("UPDATE group_orchestration SET body=json_set(body,'$.mode','run') WHERE group_id='g'").run();
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "blocked");
  return { t, runId };
}
type Lost = Awaited<ReturnType<typeof lostRun>>;

/** As the dogfood run sent it: `orca task settle-usage` from an agent on the socket (no person token). */
async function settle({ t, runId }: Lost, acknowledge: string): Promise<{ error?: { message: string }; result?: unknown }> {
  const c = t.h.command("settle-unknown-usage" as never, { taskId: "a", runId, generation: 1, acknowledge } as never) as unknown as { commandId: string };
  return withCommandContext(c.commandId, routedCommandContext("cli", { kind: "agent", client: "cli" }, { by: "agent", via: "cli" }),
    () => (t.service as never as { settleUnknownUsage(c: unknown): Promise<{ error?: { message: string } }> }).settleUnknownUsage(c));
}
/** `orca group show`'s read: answers, or throws the recovery-blocked refusal the CLI printed as 423. */
const groupShow = (t: Lost["t"]) => readControlGroup(t.h.store, "epoch-test", "g");
const zero = { activeMs: 0, attempts: 0, sessions: 0 };

describe("an expectation-model run whose worker was lost settles and stays readable (tester follow-up I, seat K)", { timeout: 120_000 }, () => {
  it("K1 (B, C): charge-remaining-grant charges the unused ceiling only in tokens; the group reads, and Orca restarts the task", async () => {
    const lost = await lostRun(); const { t, runId } = lost; try {
      const before = t.body(runId);
      expect(before.grant.work.tokens).toBeNull();
      expect(before.unknown.work).toBe(true);
      expect(before.cumulative.work.tokens).toBe(OBSERVED);
      const ceiling = before.liveCeiling.tokens as number;
      expect((await settle(lost, "charge-remaining-grant")).error).toBeUndefined();
      const run = t.body(runId);
      // B: no work grant, so no work token remainder -- the invariant every group read checks (remaining = max(grant -
      // cumulative, 0), null when the grant is null).
      // mutation K-B1: chargeRunRemainder empties the remainder to 0 whatever it was -> remaining 0 and the read below refuses, red
      expect(run.remaining.work.tokens).toBeNull();
      // mutation K-B2: hasValidUsageSettlement checks every remaining-grant charge against a grant -> run-usage-settlement refusal, red
      expect(() => groupShow(t)).not.toThrow();
      expect(groupShow(t).runs.find((r: { runId: string }) => r.runId === runId)).toBeDefined();
      // R4 (the group cap is hard): the tokens are charged at the whole unused ceiling, as before.
      expect(run.usageSettlement.charged.work.tokens).toBe(ceiling - OBSERVED);
      expect(run.cumulative.work.tokens).toBe(ceiling);
      // C: what the run observed stands for the other dimensions -- the killed call's attempt and session were already
      // counted, and the time and attempts it never started were not spent.
      // mutation K-C1: the worker-lost charge keeps the remainder's other dimensions -> charged 2 attempts etc., red
      expect({ ...run.usageSettlement.charged.work, tokens: 0 }).toEqual({ tokens: 0, ...zero });
      expect({ ...run.usageSettlement.charged.handoff, tokens: 0 }).toEqual({ tokens: 0, ...zero });
      expect({ activeMs: run.cumulative.work.activeMs, attempts: run.cumulative.work.attempts, sessions: run.cumulative.work.sessions })
        .toEqual({ activeMs: before.cumulative.work.activeMs, attempts: before.cumulative.work.attempts, sessions: before.cumulative.work.sessions });
      // The worker-lost restart (spec §5.4), not the ladder's skip: the task is started again by Orca.
      await t.service.systemDebugPass();
      // mutation K-C2: the uncharged remainder emptied anyway (keepUncharged ignored) -> remaining 0 beside the observed
      // cumulative, the read below refuses run-identity, red
      expect(() => groupShow(t)).not.toThrow();
      expect(t.h.store.db.prepare("SELECT body FROM activity WHERE run_id=? AND kind='ladder-skipped'").all(runId)).toEqual([]);
      const restart = t.h.store.db.prepare("SELECT original_status FROM commands WHERE group_id='g' AND id=?").get(workerLostCommandId("a", runId));
      expect(Number(restart?.original_status)).toBe(200);
      expect(readWork(t.h.store, "g", "a").status).toBe("ready");
      expect(() => groupShow(t)).not.toThrow();
    } finally { await t.h.dispose(); }
  });

  it("K2 (B): a run the old writer stored (remainder 0 beside a null grant, every remainder charged) reads, and its retry is admitted", async () => {
    // The stored shape of run-a4ed7f10 (g-28d9b560), produced here by the old arithmetic on the same run: the read side must
    // take it without the database being edited, since its marker, receipt and booking still agree with each other.
    const lost = await lostRun(); const { t, runId } = lost; try {
      const before = t.body(runId), ceiling = before.liveCeiling.tokens as number;
      expect((await settle(lost, "charge-remaining-grant")).error).toBeUndefined();
      const run = t.body(runId), unused = { work: before.remaining.work, handoff: before.remaining.handoff };
      const charged = { work: { ...unused.work, tokens: ceiling - OBSERVED }, handoff: unused.handoff };
      const old = { ...run, remaining: { work: { tokens: 0, ...zero }, handoff: { tokens: 0, ...zero } },
        cumulative: { work: { ...before.cumulative.work, tokens: ceiling, activeMs: before.cumulative.work.activeMs + unused.work.activeMs, attempts: before.cumulative.work.attempts + unused.work.attempts, sessions: before.cumulative.work.sessions + unused.work.sessions },
          handoff: { tokens: before.cumulative.handoff.tokens + unused.handoff.tokens, activeMs: before.cumulative.handoff.activeMs + unused.handoff.activeMs, attempts: before.cumulative.handoff.attempts + unused.handoff.attempts, sessions: before.cumulative.handoff.sessions + unused.handoff.sessions } },
        usageSettlement: { ...run.usageSettlement, charged } };
      expect(unused.work.attempts).toBeGreaterThan(0);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(old), runId);
      const row = t.h.store.db.prepare("SELECT body_json FROM commands WHERE group_id='g' AND id=?").get(run.usageSettlement.commandId);
      const receipt = JSON.parse(String(row!.body_json));
      receipt.result.charged = charged;
      t.h.store.db.prepare("UPDATE commands SET body_json=? WHERE group_id='g' AND id=?").run(JSON.stringify(receipt), run.usageSettlement.commandId);
      // mutation K-B3: validAccounting takes no stored shape but the invariant -> run-identity refusal (the dogfood 423), red
      // mutation K-B4: the legacy remainder admitted for any run, not only a settled live-ceiling one -> see K3, red there
      expect(() => groupShow(t)).not.toThrow();
      // Its retry checks the marker too (retryTask.ts `retry-settlement`); the old charge used up the task's time, so a
      // retry is refused by its budget, naming the top-up -- not by the marker.
      const retry = t.service.retryTask(t.h.command("retry-task", { taskId: "a" }) as never) as { error?: { message: string } };
      expect(retry.error?.message ?? "").not.toMatch(/retry-settlement/);
    } finally { await t.h.dispose(); }
  });

  it("K3 (B): a work token remainder of 0 beside a null grant stays refused when no settlement explains it", async () => {
    const { t, runId } = await lostRun(); try {
      const body = t.body(runId);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, remaining: { ...body.remaining, work: { ...body.remaining.work, tokens: 0 } } }), runId);
      expect(() => groupShow(t)).toThrow(`run-identity:${runId}`);
    } finally { await t.h.dispose(); }
  });

  it("K4 (A, B): charge-observed-floor books what the run observed when the dead worker left no floor; the group reads and the task restarts", async () => {
    const lost = await lostRun(); const { t, runId } = lost; try {
      const usedBefore = readGroup(t.h.store, "g").used.tokens;
      // mutation K-A1: the worker-lost floor withheld -> run-usage-not-settleable:observed-floor-unknown, red
      expect((await settle(lost, "charge-observed-floor")).error).toBeUndefined();
      const run = t.body(runId);
      expect(run.usageSettlement).toMatchObject({ method: "observed-floor", floorTokens: 0, charged: { work: { tokens: 0, ...zero }, handoff: { tokens: 0, ...zero } } });
      expect(run.cumulative.work.tokens).toBe(OBSERVED);
      expect(run.remaining.work.tokens).toBeNull();
      expect(readGroup(t.h.store, "g").used.tokens).toBe(usedBefore);
      // mutation K-A2: hasValidUsageSettlement refuses an observed floor of 0 -> run-usage-settlement refusal, red
      expect(() => groupShow(t)).not.toThrow();
      await t.service.systemDebugPass();
      expect(Number(t.h.store.db.prepare("SELECT original_status FROM commands WHERE group_id='g' AND id=?").get(workerLostCommandId("a", runId))?.original_status)).toBe(200);
      // Once the restart released the lost run, its unused ceiling is no longer held (on the next re-derivation, as any ended
      // run's), and the restarted task's claim is funded.
      t.h.store.transaction(() => refreshCeilingReserves(t.h.store));
      expect((readGroup(t.h.store, "g") as unknown as { liveCeilingReserved: number }).liveCeilingReserved).toBe(0);
      expect(decideFundedAllowance(t.h.store, "g", "a", Date.now()).reason).toBe("funded");
    } finally { await t.h.dispose(); }
  });

  it("K6 (B, same class): a proved-zero settlement (#215) leaves its group readable", async () => {
    // Found while checking the other settlement methods: release-known-zero empties the remainder by design, which every
    // group read refused as run-identity -- the same 423 as the dogfood run's.
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed-usage-unknown", sealedOwnerProof: true, tokenPolicy: "optional-v1",
      failure: () => ({ failureCause: { cause: "rate-limited", phase: "plan", retries: 0, detail: null, usageKnownZero: true } }) as never });
    try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const lost = { t, runId } as unknown as Lost;
      expect((await settle(lost, "release-known-zero")).error).toBeUndefined();
      expect(t.body(runId).usageSettlement.method).toBe("known-zero");
      // mutation K-B5: validAccounting reads no known-zero shape -> run-identity refusal, red
      expect(() => groupShow(t)).not.toThrow();
    } finally { await t.h.dispose(); }
  });

  it("K5 (A): no floor stays refused for a run that did not lose its worker, and for a lost one that observed nothing", async () => {
    const other = await lostRun({ cause: "required-check-failed" }); try {
      // mutation K-A3: the floor of 0 offered to every failed run -> admitted, red
      expect((await settle(other, "charge-observed-floor")).error?.message).toBe("run-usage-not-settleable:observed-floor-unknown");
    } finally { await other.t.h.dispose(); }
    const blind = await lostRun({ behaviour: "failed-usage-unknown" }); try {
      // mutation K-A4: the worker-lost floor admitted with nothing observed -> admitted at 0 tokens, red
      expect((await settle(blind, "charge-observed-floor")).error?.message).toBe("run-usage-not-settleable:observed-floor-unknown");
    } finally { await blind.t.h.dispose(); }
  });
});
