import { afterAll, describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { ccloopWorlds, noBlocked, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Accounts plan Task 12 (spec §5.1, H9): the per-model wire end to end. ccloop's Part B (orca/usage-by-model, merged
 * into ccloop main) states a `byModel` breakdown on each usage event; Orca books every applied work delta as rows
 * carrying the model, quality `reported`. Against a ccloop without Part B (c3af4d6) the same run books one
 * `unattributed` row per delta with no model -- that is this criterion's red, seen before the re-pin.
 *
 * The fake codex reports usage on `turn.completed`; ccloop's codex adapter attributes all of it to the run's one model.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-usage-by-model-", epochPrefix: "epoch-usage-by-model-" });
afterAll(removeRoots);

describe("per-model usage from a real ccloop run reaches the usage ledger", { timeout: 240_000 }, () => {
  relocateHome("orca-usage-by-model-home-");

  it("books a run's work usage as reported rows of the run's model, adding up to what the group used", async (ctx) => {
    if (!realBinary) ctx.skip();
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" } } });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return workRuns(runtime).some((run) => run.body.drive?.cleanedUp === true); }, 180_000, "the run to settle");

      const rows = runtime.store.db.prepare("SELECT source,model,tokens,quality FROM usage_ledger WHERE group_id='g'").all()
        .map((row) => ({ source: String(row.source), model: row.model === null ? null : String(row.model), tokens: Number(row.tokens), quality: String(row.quality) }));
      const work = rows.filter((row) => row.source === "run-work");
      // The fake spends tokens on every phase, so a settled run has work rows; a world that booked none proves nothing.
      expect(work.length).toBeGreaterThan(0);
      expect(work.reduce((sum, row) => sum + row.tokens, 0)).toBeGreaterThan(0);
      // What Part B buys: every work row is attributed to a model, and it is one model (codex runs one).
      expect(work.filter((row) => row.quality !== "reported" || row.model === null)).toEqual([]);
      // ... and that model is the one ccloop resolved for the task's worker slot when the group was confirmed.
      const { slots } = await resolveGroupSelections({ store: runtime.store, port: runtime.port }, "g", "human");
      const worker = slots.flatMap((slot) => slot.slot === "worker" && slot.outcome.kind === "resolved" ? [slot.outcome.frozen.selection.model] : []);
      expect(worker).toHaveLength(1);
      expect([...new Set(work.map((row) => row.model))]).toEqual(worker);
      // D16: the handoff bucket books nothing for a run that never handed off.
      expect(rows.filter((row) => row.source === "run-handoff")).toEqual([]);
      // The breakdown neither loses nor invents tokens: the ledger adds up to the group's used tokens.
      const usedTokens = Number(runtime.store.db.prepare("SELECT json_extract(body,'$.used.tokens') AS tokens FROM groups WHERE id='g'").get()!.tokens);
      expect(rows.reduce((sum, row) => sum + row.tokens, 0)).toBe(usedTokens);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
