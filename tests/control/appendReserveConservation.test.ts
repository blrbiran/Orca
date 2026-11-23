import { describe, expect, it } from "vitest";
import { readConfirmedTaskExecution } from "../../src/control/executionSnapshot.js";
import { appendConfirmedTaskInTransaction } from "../../src/control/groupTaskAppend.js";
import { readArchivedContract, readWork } from "../../src/control/queries.js";
import { assertKnownConservation } from "../../src/control/webService.js";
import { readBudgetProposal, readGroup } from "../../src/control/queries.js";

import { driverHarness } from "./fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;

async function groupWithAppendedTask(tokenPolicy?: "optional-v1"): Promise<Harness> {
  const t = await driverHarness([{ taskId: "a" }], { tokenPolicy });
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
  const base = structuredClone(readArchivedContract(t.h.store, "g", "a").contract);
  const grant = (readWork(t.h.store, "g", "a") as unknown as { grant: { work: never; handoff: never } }).grant;
  t.h.store.transaction(() => appendConfirmedTaskInTransaction(t.h.store, "g", {
    taskId: "fix-1",
    contract: { ...base, objective: { ...base.objective, taskId: "fix-1", goal: "fix what the review found" } } as never,
    agentFrom: "a", work: grant.work, handoff: grant.handoff, dependsOn: ["a"],
  }));
  return t;
}
const body = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;

/**
 * Tester #437: the WRITE side (groupTaskAppend.ts) counted an appended `ready` task's finite work+handoff grant as
 * committed reserve; the READ side (webService.ts assertKnownConservation) counts a `draft`/`ready` task as 0 tokens in a
 * token-policy group. One appended fix task therefore left `group.reserved` above what the reader could re-derive by
 * exactly that grant, and every budget command (set-limit, proposal edit, set-loop, start) answered 423
 * `recovery-blocked`/`retryable:false` forever, with `recovery list` saying `blockers: (none)`.
 *
 * The reader's rule is the one that already had a ruling behind it (#212: a ready task's grant is an expectation, and a
 * claim funds it from headroom). The two sides share one function now, so they cannot drift again.
 */
describe("an appended task keeps the reserve the reader can re-derive (#437)", () => {
  it("the reader's conservation check accepts the group after the append", async () => {
    const t = await groupWithAppendedTask("optional-v1");
    try {
      // mutation: count the appended ready task's grant in the reader (or the writer again) -> recovery-blocked, red
      expect(() => assertKnownConservation(t.h.store, readGroup(t.h.store, "g") as never, readBudgetProposal(t.h.store, "g"))).not.toThrow();
    } finally { await t.h.dispose(); }
  }, 120000);

  it("the append adds nothing to the reserve for the new task's grant", async () => {
    // The same shaped group twice: the reserve the append leaves must equal the reserve before it, because a `ready`
    // task's grant is an expectation in a token-policy group (#212). `driverHarness` alone is the "before" reading.
    const before = await driverHarness([{ taskId: "a" }], { tokenPolicy: "optional-v1" });
    let baseline: number;
    try {
      const runId = await before.claim();
      await before.until(before.driver(), () => before.body(runId).drive?.cleanedUp === true);
      baseline = (JSON.parse(String(before.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as { reserved: { tokens: number } }).reserved.tokens;
    } finally { await before.h.dispose(); }

    const t = await groupWithAppendedTask("optional-v1");
    try {
      const g = (readWork(t.h.store, "g", "fix-1") as unknown as { grant: { work: { tokens: number | null }; handoff: { tokens: number | null } } }).grant;
      expect((g.work.tokens ?? 0) + (g.handoff.tokens ?? 0)).toBeGreaterThan(0);
      const after = (body(t) as { reserved: { tokens: number } }).reserved.tokens;
      // mutation: writer counts the appended grant -> `after` is `before` plus that grant, red
      expect(after).toBe(baseline);
    } finally { await t.h.dispose(); }
  }, 180000);
});
