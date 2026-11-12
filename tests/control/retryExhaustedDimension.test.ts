import { describe, expect, it } from "vitest";
import { withCommandContext } from "../../src/control/commandClient.js";
import { routedCommandContext } from "../../src/panel/controlApi.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import type { Principal } from "../../src/panel/permissions.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester #264: `task-not-retryable:authored-budget-exhausted` did not say which dimension ran out, so a person whose
 * attempts were spent kept adding tokens and was refused each time. The refusal now names every spent dimension with its
 * authored / inherited / fresh numbers, and the `--work` top-up that lets the retry run -- which is then accepted.
 * The synthetic ccloop books { tokens: 10, activeMs: 5, attempts: 1, sessions: 1 } per run (driverPort.ts).
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const OWNER: Principal = { kind: "user", userId: "u-owner", name: "ana", roles: ["owner"] };
const code = (answer: unknown) => (answer as { error?: { code: string; message: string } }).error ?? null;
function retry(t: Harness, taskId: string, payload: Record<string, unknown> = {}) {
  const command = t.h.command("retry-task", { taskId, ...payload } as never);
  return withCommandContext(command.commandId, routedCommandContext("web", OWNER, { by: "ana", via: "web" }), () => t.service.retryTask(command));
}

describe("an authored-budget-exhausted retry names the dimension, its numbers and the top-up (#264)", { timeout: 120_000 }, () => {
  it.each([
    ["attempts", 1, 1, 1], ["sessions", 1, 1, 1], ["tokens", 10, 10, 10], ["activeMs", 5, 5, 5],
  ] as const)("%s authored %i, used %i: named, and a top-up of %i is accepted", async (dimension, authored, used, suggested) => {
    const t = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1", behaviour: () => "failed" }); try {
      // A finite token limit, so the retry counts the lineage (an unlimited group credits attempts and active time back).
      const limit = readControlGroup(t.h.store, "epoch", "g").ledger.groupLimit;
      expect(code(t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: 50_000_000 } })))).toBeNull();
      const w = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id='a'").get()!.body));
      w.grant.work[dimension] = authored;
      t.h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id='a'").run(JSON.stringify(w));
      const first = await t.claim();
      await t.until(t.driver(), () => t.body(first).state === "blocked");
      expect(t.body(first).cumulative.work[dimension]).toBe(used);
      expect(code(retry(t, "a"))).toMatchObject({ code: "task-not-retryable",
        message: `task-not-retryable:authored-budget-exhausted:${dimension}(authored=${authored},inherited=${used},fresh=0); add work to the retry: orca task retry g a --work '{"${dimension}":${suggested}}'` });
      // The suggested top-up is enough: the retry it names is accepted.
      expect(code(retry(t, "a", { work: { [dimension]: suggested } }))).toBeNull();
    } finally { await t.h.dispose(); }
  });
});
