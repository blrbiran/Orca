import { describe, expect, it } from "vitest";
import { REGISTRY } from "../../src/commands/registry.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readStartEnvelope } from "../../src/control/executionDriver.js";
import { readFundedAllowance } from "../../src/control/fundedAllowance.js";
import { ladderLevelOneCommandId } from "../../src/control/systemDebug.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { agentTopUpSum } from "../../src/control/workTopUp.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { Principal } from "../../src/panel/permissions.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester follow-up E §8 ("Attempts in an unlimited group"; human ruling 「其他都按你的建议走」): in a group whose
 * `limit.tokens` is null, an explicit `task retry` (a person's or an agent's) starts its run with the task's own attempts
 * and active time, not what is left of the lineage's; the ladder's automatic retries keep counting the lineage. The new
 * run never gets more than the group's own non-token limits leave. Finite groups: finiteRetryGolden.test.ts.
 * Synthetic ccloop: each run reports { tokens: 10, activeMs: 5, attempts: <workAttempts>, sessions: 1 } (driverPort.ts).
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const OWNER: Principal = { kind: "user", userId: "u-owner", name: "ana", roles: ["owner"] };
const AGENT: Principal = { kind: "agent", client: "cli" };
const BY = { by: "ana", via: "cli" };
const AUTHORED_ACTIVE_MS = 14_400_000;

const work = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
const retry = (t: Harness, who: Principal) => {
  const command = t.h.command("retry-task", { taskId: "a" });
  return withCommandContext(command.commandId, routedCommandContext(who.kind === "user" ? "web" : "cli", who, BY), () => t.service.retryTask(command)) as
    { result?: Record<string, unknown>; error?: { code: string; message: string } };
};
async function claimAgain(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  await driver.round();
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}
const policy = (t: Harness, runId: string) =>
  (readStartEnvelope(t.h.store, t.body(runId)) as { work: { contract: { executionPolicy: { maxAttempts: number; totalRuntimeBudgetMs: number } } }; tokenPolicy?: { inheritedUsage: { attempts: number } } });
async function prepared(t: Harness, driver: ReturnType<Harness["driver"]>, runId: string): Promise<void> {
  for (let i = 0; i < 400 && t.body(runId).drive?.prepared !== true; i++) await driver.round();
}

/**
 * An unlimited (optional-v1, `limit.tokens` null) group whose task a authors 2 attempts; its failed first run used
 * `used` of them. The group's non-token limits are raised so they do not bind, or its attempts limit set to `attempts`.
 */
async function failedOnce(used: number, attempts?: number) {
  const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", behaviour: () => "failed", stopReason: () => "Error: check failed: node check.js", workAttempts: () => used });
  const w = work(t); w.grant.work.attempts = 2;
  t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(w));
  const current = readWebGroup(t.h.store, "g").ledger.groupLimit;
  expect(current.tokens).toBeNull();
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...current, attempts: attempts ?? current.attempts + 10, activeMs: current.activeMs * 4, sessions: current.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const driver = t.driver();
  const first = await t.claim();
  await t.until(driver, () => t.body(first).state === "blocked");
  return { t, driver, first };
}

describe("an explicit retry in an unlimited group starts with fresh attempts and active time (tester follow-up E §8)", { timeout: 180_000 }, () => {
  it("a person's retry after the lineage used every attempt is admitted; the new run is funded and dispatched with the task's own 2 attempts and active time", async () => {
    const { t, driver, first } = await failedOnce(2);
    try {
      // mutation: no fresh credit (want = 0) -> refused authored-budget-exhausted, red
      const answer = retry(t, OWNER);
      expect(answer.error).toBeUndefined();
      // mutation: drop nextRun from the receipt -> red
      expect(answer.result).toMatchObject({ kind: "task-retried", taskId: "a", fromRunId: first, nextRun: { attempts: 2, activeMs: AUTHORED_ACTIVE_MS } });
      // Tester follow-up I (seat L): and why. mutation D3 (because always worker-lost) -> red here.
      expect(answer.result).toMatchObject({ nextRun: { because: "no-token-limit" } });
      const second = await claimAgain(t, driver);
      await prepared(t, driver, second);
      const funded = readFundedAllowance(t.h.store, t.body(second))!;
      expect([funded.grant.work.attempts, funded.grant.work.activeMs]).toEqual([2, AUTHORED_ACTIVE_MS]);
      const envelope = policy(t, second);
      expect([envelope.work.contract.executionPolicy.maxAttempts, envelope.work.contract.executionPolicy.totalRuntimeBudgetMs]).toEqual([2, AUTHORED_ACTIVE_MS]);
      // The lineage is still the lineage in Orca's record (the funded allowance inherits the 2 used); only the allowance is
      // fresh. (This fully funded finite-token task carries no envelope tokenPolicy, as before: webDispatch needsTokenPolicy.)
      expect(funded.inheritedUsage.attempts).toBe(2);
      // The record: the activity names the fresh start; the board shows no top-up for it (nobody added work).
      const activity = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM activity WHERE run_id=? AND kind='task-retried'").get(first)!.body));
      expect(activity).toMatchObject({ fromRunId: first, freshStart: { attempts: 2, activeMs: 5 } });
      // mutation: keep fresh-start rows in the board's top-up lines -> red
      expect(readControlGroup(t.h.store, "epoch", "g").workItems.find((item) => item.taskId === "a")).not.toHaveProperty("topUps");
      // The run goes on to its terminal and the read model stays whole.
      await t.until(driver, () => t.body(second).state === "blocked");
      expect(readControlGroup(t.h.store, "epoch", "g").schema).toBe("orca-control-group-v1");
      // A second explicit retry is fresh again.
      expect(retry(t, OWNER).result).toMatchObject({ nextRun: { attempts: 2, activeMs: AUTHORED_ACTIVE_MS } });
    } finally { await t.h.dispose(); }
  });

  it("an agent's retry without a person token is fresh too, and the credit is not an agent top-up", async () => {
    const { t, driver } = await failedOnce(1);
    try {
      expect(retry(t, AGENT).result).toMatchObject({ nextRun: { attempts: 2, activeMs: AUTHORED_ACTIVE_MS } });
      // mutation: count fresh-start rows in agentTopUpSum -> red
      expect(agentTopUpSum(t.h.store, "g")).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
      const second = await claimAgain(t, driver);
      expect(readFundedAllowance(t.h.store, t.body(second))!.grant.work.attempts).toBe(2);
    } finally { await t.h.dispose(); }
  });

  it("the group's own attempts limit bounds the fresh start: the new run gets what the group leaves, never a stranded task", async () => {
    // Measured (fixture, 2026-11-11): after the failed run the group has used 2 attempts and reserves 2 more, so a limit of
    // 5 leaves room for exactly 1 (the fixture's own limit, 6, would leave 2 and not bind).
    const { t, driver } = await failedOnce(2, 5);
    try {
      const group = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      expect([group.used.attempts, group.reserved.attempts, group.limit.attempts]).toEqual([2, 2, 5]);
      // mutation: no cap to the group's headroom -> nextRun.attempts 2 and the task is never claimed, red
      expect(retry(t, OWNER).result).toMatchObject({ nextRun: { attempts: 1 } });
      const second = await claimAgain(t, driver);
      expect(readFundedAllowance(t.h.store, t.body(second))!.grant.work.attempts).toBe(1);
    } finally { await t.h.dispose(); }
  });

  it("a group whose limits leave no attempt is refused by name and the task is left as it was, never ready with nothing", async () => {
    // Measured (fixture, 2026-11-11): after the failed run the group has used 2 attempts and reserves 2, so 4 leaves none.
    const { t, first } = await failedOnce(2, 4);
    try {
      const before = work(t);
      const answer = retry(t, OWNER);
      // mutation: drop the zero-left refusal after the headroom cap -> admitted with 0 attempts, red
      expect(answer.error).toMatchObject({ code: "task-not-retryable" });
      expect(answer.error!.message).toContain("authored-budget-exhausted");
      expect([work(t).status, work(t).currentRunId]).toEqual([before.status, first]);
      expect(Number(t.h.store.db.prepare("SELECT count(*) AS n FROM work_grant_top_ups").get()!.n)).toBe(0);
    } finally { await t.h.dispose(); }
  });

  it("names the spent dimension when the group's limits leave no attempt (#264)", async () => {
    const { t } = await failedOnce(2, 4);
    try {
      // The credit the group could not fund is not counted as authored.
      expect(retry(t, OWNER).error!.message).toBe("task-not-retryable:authored-budget-exhausted:attempts(authored=2,inherited=2,fresh=0); add work to the retry: orca task retry g a --work '{\"attempts\":1}'");
    } finally { await t.h.dispose(); }
  });

  it("a retry with a top-up starts with the task's own attempts plus the top-up; the board shows only the top-up", async () => {
    const { t, driver } = await failedOnce(2);
    try {
      const retried = (() => {
        const command = t.h.command("retry-task", { taskId: "a", work: { attempts: 1 } } as never);
        return withCommandContext(command.commandId, routedCommandContext("web", OWNER, BY), () => t.service.retryTask(command)) as { result?: Record<string, unknown> };
      })();
      // mutation: leave this retry's top-up out of the fresh start's authored amount -> 2, red
      expect(retried.result).toMatchObject({ nextRun: { attempts: 3, activeMs: AUTHORED_ACTIVE_MS } });
      const lines = readControlGroup(t.h.store, "epoch", "g").workItems.find((item) => item.taskId === "a")!.topUps!;
      expect(lines.map((line) => line.amount.attempts)).toEqual([1]);
      const second = await claimAgain(t, driver);
      expect(readFundedAllowance(t.h.store, t.body(second))!.grant.work.attempts).toBe(3);
    } finally { await t.h.dispose(); }
  });

  it("the ladder's automatic retry keeps counting the lineage", async () => {
    const { t, driver, first } = await failedOnce(1);
    try {
      const service = new WebControlService({ ...t.h.deps, knownRepository: (id: string) => id === "repo", resolveRepository: () => t.repo });
      const pass = await service.systemDebugPass();
      expect(pass.redispatched).toEqual(["g:a"]);
      const row = t.h.store.db.prepare("SELECT body_json FROM commands WHERE group_id='g' AND id=?").get(ladderLevelOneCommandId("a"))!;
      // mutation: the fresh start ignores who sent the retry -> the ladder's receipt carries nextRun 2, red
      expect(JSON.parse(String(row.body_json)).result).toEqual({ kind: "task-retried", taskId: "a", fromRunId: first });
      expect(Number(t.h.store.db.prepare("SELECT count(*) AS n FROM work_grant_top_ups").get()!.n)).toBe(0);
      const second = await claimAgain(t, driver);
      expect(readFundedAllowance(t.h.store, t.body(second))!.grant.work.attempts).toBe(1);
    } finally { await t.h.dispose(); }
  });
});

describe("task retry's human output says how many attempts the new run gets (tester follow-up E §8)", () => {
  it("names the attempts and active time from the receipt, and adds nothing when the receipt has none", () => {
    const def = REGISTRY.find((d) => d.domain === "task" && d.action === "retry")!;
    const body = (result: Record<string, unknown>) => ({ schema: "orca-command-success-v1", commandId: "c", verb: "retry-task", result });
    // mutation: drop the line from format -> red
    expect(def.format(body({ kind: "task-retried", taskId: "a", fromRunId: "run-1", nextRun: { attempts: 3, activeMs: 14_400_000 } })))
      .toContain("the new run of a gets 3 attempts and 240 min active time (fresh: the group has no token limit)");
    expect(def.format(body({ kind: "task-retried", taskId: "a", fromRunId: "run-1" }))).not.toContain("attempts");
  });
});
