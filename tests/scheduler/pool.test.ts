import { describe, expect, it } from "vitest";
import { MAX_PARALLEL_TASKS, mapWithPool } from "../../src/scheduler/pool.js";

/** Resolves on the next macrotask, so two calls can genuinely overlap. */
function tick(ms = 5): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("mapWithPool (spec §1.3's fixed upper bound)", () => {
  it("never has more than `limit` calls in flight at once", async () => {
    // spec §1.3 put the *adaptive* budget out of scope with the parenthetical
    // that v1 uses a fixed upper bound — and no bound existed. A 40-task layer
    // spawned 40 clones and 40 node processes at once on a machine §1.2 rule 1
    // already pins to one host.
    //
    // Mutation `M-POOL-CAP`: replace the pool's body with
    // `Promise.all(items.map(fn))` — `maxInFlight` becomes 12 and this
    // assertion is what goes red.
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);

    const results = await mapWithPool(items, 3, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await tick();
      inFlight -= 1;
      return item * 2;
    });

    expect(maxInFlight).toBe(3);
    // And the cap is a cap, not a cut: every item still ran, in input order.
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual(items.map((i) => i * 2));
  });

  it("settles every item even when one throws, instead of discarding the rest", async () => {
    // The half of `Promise.all` that mattered more than the missing bound: it
    // rejects on the FIRST failure, so its siblings keep running as orphans,
    // the results of the ones that finish afterwards are thrown away
    // un-harvested and un-disposed, and run.ts's `finally` releases the repo
    // lock while those children are still writing into runsDir.
    //
    // Mutation `M-POOL-SETTLED`: make the worker rethrow instead of recording
    // `{ status: "rejected" }` — the call below rejects, `outcome.ok` becomes
    // false, and the FIRST assertion goes red. Deliberately captured into a
    // value rather than awaited bare: a bare await would end this criterion
    // by crashing before any assertion ran, which §0.3 does not accept as
    // evidence about the assertion.
    const finished: number[] = [];
    const outcome = await mapWithPool([0, 1, 2, 3], 2, async (item) => {
      await tick();
      if (item === 1) throw new Error(`item ${item} exploded`);
      finished.push(item);
      return item;
    }).then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason }),
    );

    expect(outcome.ok).toBe(true);
    const results = outcome.ok ? outcome.value : [];
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled", "fulfilled"]);
    // The three that did not throw all ran to completion and kept their
    // values — the property "discarded un-harvested" is about.
    expect(finished.sort()).toEqual([0, 2, 3]);
    expect(results[1].status === "rejected" && (results[1].reason as Error).message).toBe("item 1 exploded");
  });

  it("refuses a limit below 1 rather than silently doing nothing", async () => {
    // Rule 12: a limit of 0 would make the pool return an array of holes and
    // report success over zero work — the silent-empty shape this repository
    // has paid for before.
    const outcome = await mapWithPool([1, 2], 0, async (n) => n).then(
      () => "resolved",
      (err: Error) => err.message,
    );
    expect(outcome).toMatch(/limit of at least 1/);
  });

  it("exports a bound that is actually bounded", () => {
    expect(MAX_PARALLEL_TASKS).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(MAX_PARALLEL_TASKS)).toBe(true);
  });
});
