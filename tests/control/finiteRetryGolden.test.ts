import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readStartEnvelope } from "../../src/control/executionDriver.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readFundedAllowance } from "../../src/control/fundedAllowance.js";
import { readWebGroup } from "../../src/control/webService.js";
import { driverHarness, type HarnessOptions } from "./fixtures/driverHarness.js";

/**
 * Tester follow-up E §8 ("Attempts in an unlimited group"): an explicit retry in a group whose `limit.tokens` is null
 * starts its run with fresh attempts and active time. Finite groups are unchanged byte for byte. This golden was captured
 * on the code before that change (tester follow-up E, W5, at commit 40b069ab) and pins, for a finite optional-v1 group and
 * a finite-legacy group, what a person's retry of a failed run answers and what the retried run is funded and dispatched
 * with -- the run's grant, its funded allowance and ccloop's execution policy -- and the next retry's answer once the
 * lineage's attempts are spent. Regenerate only on purpose: ORCA_WRITE_GOLDEN=1.
 *
 * Ruling (2026-11-12, tester follow-up G): regenerated for #264 -- the last retry's refusal now names the spent dimension,
 * its numbers and the --work top-up (`again.error.message` of the finite optional-v1 group); nothing else in it moved.
 */
const GOLDEN = new URL("./fixtures/finiteRetryGolden.json", import.meta.url);
type Harness = Awaited<ReturnType<typeof driverHarness>>;

/** The answer without its random run id (`fromRunId` is checked to name the run retried). */
const strip = (answer: unknown, runId: string): unknown => {
  const a = answer as { result?: { fromRunId?: string }; error?: { code: string; message?: string } };
  if (a.error !== undefined) return { error: { code: a.error.code, message: a.error.message } };
  expect(a.result?.fromRunId).toBe(runId);
  return { result: { ...a.result, fromRunId: "<the run retried>" } };
};

async function prepared(t: Harness, driver: ReturnType<Harness["driver"]>, runId: string): Promise<void> {
  for (let i = 0; i < 400 && t.body(runId).drive?.prepared !== true; i++) await driver.round();
}

/** The next run of the group, as the driver arms its start wake (retryTopUp.test.ts claimAgain). */
async function claimAgain(t: Harness, driver: ReturnType<Harness["driver"]>): Promise<string> {
  await driver.round();
  const delivered = await deliverScheduledStart(t.dispatch, "g");
  if (delivered.kind !== "claimed") throw new Error(`no claim: ${JSON.stringify(delivered)}`);
  return delivered.runId;
}

async function scenario(options: HarnessOptions, finiteOptional: boolean): Promise<unknown> {
  const t = await driverHarness([{ taskId: "a" }], { ...options, behaviour: () => "failed" });
  try {
    if (finiteOptional) {
      // An optional-v1 group with a finite token limit: what a group made finite by a person is.
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      const set = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 50_000_000 } }));
      if ("error" in set) throw new Error(`set-limit refused: ${JSON.stringify(set)}`);
    }
    const w = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
    w.grant.work.attempts = 2;
    t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(w));
    const driver = t.driver();
    const first = await t.claim();
    await prepared(t, driver, first);
    await t.until(driver, () => t.body(first).state === "blocked");
    const retried = t.service.retryTask(t.h.command("retry-task", { taskId: "a" }));
    const second = await claimAgain(t, driver);
    await prepared(t, driver, second);
    const policy = (run: string) => (readStartEnvelope(t.h.store, t.body(run)) as { work: { contract: { executionPolicy: { maxAttempts: number; tokenBudget: number | null; totalRuntimeBudgetMs: number } } } }).work.contract.executionPolicy;
    const pick = (run: string) => {
      const p = policy(run), funded = readFundedAllowance(t.h.store, t.body(run));
      return { grant: t.body(run).grant, funded, policy: { maxAttempts: p.maxAttempts, tokenBudget: p.tokenBudget, totalRuntimeBudgetMs: p.totalRuntimeBudgetMs } };
    };
    const out = { limitTokens: readWebGroup(t.h.store, "g").ledger.groupLimit.tokens, first: pick(first), retried: strip(retried, first), second: pick(second) };
    await t.until(driver, () => t.body(second).state === "blocked");
    const again = t.service.retryTask(t.h.command("retry-task", { taskId: "a" }));
    return { ...out, again: strip(again, second) };
  } finally { await t.h.dispose(); }
}

describe("finite groups' retry is unchanged byte for byte (tester follow-up E §8)", { timeout: 180_000 }, () => {
  it("a finite optional-v1 group and a finite-legacy group retry, fund and dispatch exactly as the golden captured before the change", async () => {
    const answers = {
      finiteOptional: await scenario({ tokenPolicy: "optional-v1" }, true),
      finiteLegacy: await scenario({}, false),
    };
    if (process.env.ORCA_WRITE_GOLDEN === "1") writeFileSync(GOLDEN, `${JSON.stringify(answers, null, 2)}\n`);
    // Non-vacuous: both groups are finite, and the optional one counts its lineage (the second run got what was left).
    expect([(answers.finiteOptional as { limitTokens: unknown }).limitTokens, (answers.finiteLegacy as { limitTokens: unknown }).limitTokens].every(v => typeof v === "number")).toBe(true);
    expect(JSON.stringify(answers, null, 2) + "\n").toBe(readFileSync(GOLDEN, "utf8"));
  });
});
