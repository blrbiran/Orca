import { expect } from "vitest";
import { withCommandContext } from "../../../src/control/commandClient.js";
import { createExecutionProfileRouter, resolveProfile } from "../../../src/control/profiles.js";
import { profileSnapshot } from "./web.js";
import { driverHarness } from "./driverHarness.js";
import { latestRequestForRun } from "../../../src/control/stopIntent.js";
export const ds = ["tokens", "activeMs", "attempts", "sessions"] as const;
type Harness = Awaited<ReturnType<typeof driverHarness>>;
export async function unknownFailure(tasks = [{ taskId: "a" }], reportedPartial = true, options: { claimOther?: boolean; workTokens?: number; silentOther?: boolean; extraReserve?: boolean; spentAllTokens?: boolean; missing?: boolean } = {}) {
  const t = await driverHarness(tasks, { behaviour: id => options.silentOther && id === "b" ? "stoppable-silent" : "failed", ...(options.workTokens ? { workTokens: () => options.workTokens! } : {}), stopReason: () => "provider crashed" });
  const collect = t.fake.port.collect;
  t.fake.port.collect = async (envelope, after) => {
    const report = await collect(envelope, after);
    if (report.candidate && report.terminal && report.events.length) {
      if (options.missing) report.candidate.missing = ["lost-evidence"];
      if (options.spentAllTokens) {
        for (const event of report.events) if (event.cumulative) event.cumulative.tokens = envelope.claim.grant[event.bucket].tokens;
      }
      if (reportedPartial) {
        report.events.push({ ...report.events[0]!, eventSeq: 3, bucket: "work", cumulative: null });
        report.candidate.usageHighWater = 3;
      } else report.events[0] = { ...report.events[0]!, cumulative: null };
    }
    return report;
  };
  t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
  if (options.extraReserve) {
    const { readWebGroup } = await import("../../../src/control/webService.js");
    const limit = readWebGroup(t.h.store, "g").limit;
    const raised = t.service.setLimit(t.h.command("set-limit", { limit: { tokens: limit.tokens * 4, activeMs: limit.activeMs * 4, attempts: limit.attempts * 4, sessions: limit.sessions * 4 } }));
    if ("error" in raised) throw new Error(JSON.stringify(raised));
  }
  const runId = await t.claim();
  const otherRunId = options.claimOther ? await t.claim() : null;
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  return { t, runId, driver, otherRunId };
}
export const settle = (t: Harness, runId: string, command?: any) => {
  const c = command ?? t.h.command("settle-unknown-usage" as any, { taskId: "a", runId, generation: 1, acknowledge: "charge-remaining-grant" });
  return withCommandContext(c.commandId, { client: "web", principal: "user:owner" }, () => (t.service as any).settleUnknownUsage(c));
};
export const sum = (pair: any) => Object.fromEntries(ds.map(d => [d, pair.work[d] + pair.handoff[d]]));
export async function handoff(t: Harness, runId: string, driver: ReturnType<Harness["driver"]>) {
  expect(await t.service.handoffStop(t.h.command("handoff-stop", {}))).not.toHaveProperty("error");
  await t.until(driver, () => latestRequestForRun(t.h.store, "g", runId)?.state.startsWith("settled-") === true);
}
