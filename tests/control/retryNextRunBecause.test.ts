// Tester follow-up I (seat L; the controller's paid dogfood run, group g-28d9b560 with a 4,000,000-token limit): a person's
// `task retry … --work` of a worker-lost task printed "the new run of search gets 3 attempts and 80 min active time (fresh:
// the group has no token limit)". The credit came from the lost worker (worker-lost recovery spec §5.4), not from a missing
// limit. Why it matters: a person deciding how much budget to add reads that line; it must name the real reason. The
// receipt now says why (`nextRun.because`), and the CLI line follows it.
import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { readWebGroup } from "../../src/control/webService.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import { REGISTRY } from "../../src/commands/registry.js";
import { driverHarness } from "./fixtures/driverHarness.js";

const M = 1_000_000;

describe("a retry receipt says why the new run's attempts are fresh (tester follow-up I, D)", { timeout: 120_000 }, () => {
  it("a worker-lost run in a group with a token limit: because worker-lost", async () => {
    const t = await driverHarness([{ taskId: "a" }], {
      tokenPolicy: "optional-v1", modelVersion: "followup-g", workTokens: () => 61_193,
      behaviour: () => "failed-after-observed-usage-unknown",
      failure: () => ({ failureCause: { cause: "worker-lost", phase: "execute", retries: 0, detail: "owner pid 1 does not exist" } }) as never,
    });
    try {
      const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
      expect(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 4 * M } }))).not.toHaveProperty("error");
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const c = t.h.command("settle-unknown-usage" as never, { taskId: "a", runId, generation: 1, acknowledge: "charge-observed-floor" } as never) as unknown as { commandId: string };
      const settled = await withCommandContext(c.commandId, routedCommandContext("cli", { kind: "agent", client: "cli" }, { by: "agent", via: "cli" }),
        () => (t.service as never as { settleUnknownUsage(c: unknown): Promise<{ error?: unknown }> }).settleUnknownUsage(c));
      expect(settled.error).toBeUndefined();
      const retried = t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }) as never) as { error?: unknown; result?: unknown };
      expect(retried.error).toBeUndefined();
      // mutation D1 (no because on the receipt) -> red here.
      expect(retried.result).toMatchObject({ kind: "task-retried", nextRun: { because: "worker-lost" } });
    } finally { await t.h.dispose(); }
  });

  it("the CLI line names the reason the receipt gives, and keeps the old words for a receipt without one", () => {
    const def = REGISTRY.find((d) => d.domain === "task" && d.action === "retry")!;
    const body = (nextRun: Record<string, unknown>) => ({ schema: "orca-command-success-v1", commandId: "c", verb: "retry-task", result: { kind: "task-retried", taskId: "search", fromRunId: "run-1", nextRun } });
    // mutation D2 (the line ignores because) -> red here.
    const lost = def.format(body({ attempts: 3, activeMs: 4_800_000, because: "worker-lost" }));
    expect(lost).toContain("the new run of search gets 3 attempts and 80 min active time (its lost run's attempts are credited back: the machine lost that work)");
    expect(lost).not.toContain("no token limit");
    expect(def.format(body({ attempts: 3, activeMs: 4_800_000, because: "no-token-limit" }))).toContain("(fresh: the group has no token limit)");
    expect(def.format(body({ attempts: 3, activeMs: 4_800_000 }))).toContain("(fresh: the group has no token limit)");
  });
});
