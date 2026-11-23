import { describe, expect, it } from "vitest";
import { appendConfirmedTaskInTransaction } from "../../src/control/groupTaskAppend.js";
import { readArchivedContract, readWork } from "../../src/control/queries.js";
import { readControlOverview } from "../../src/panel/controlOverview.js";
import { readControlSummary, readOverviewGroupSource } from "../../src/panel/controlViews.js";
import { driverHarness } from "../control/fixtures/driverHarness.js";

type Harness = Awaited<ReturnType<typeof driverHarness>>;

async function groupWithAppendedTask(): Promise<Harness> {
  const t = await driverHarness([{ taskId: "a" }]);
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

/**
 * Tester #442: a group with an appended task (a review-fix task added after confirm) made the OVERVIEW read fail.
 * `readOverviewGroupSource` pre-fetches each canonical record it will need in ONE query and hands that map to the
 * authority reader, which refuses by name when a hash is missing (`readCanonicalRecord` → `recovery-blocked`) rather
 * than falling back to SQL. The pre-fetch listed only `plan.tasks` hashes, never `body.appendedTasks`, so an appended
 * task's contract was absent, the group raised `recovery-blocked`, and `needsYou` vanished from the overview — the dead
 * group disappeared from every patrol surface (`orca status` stopped counting it as needing you, `recovery list` said
 * `blockers: (none)`).
 */
describe("a group with an appended task stays readable everywhere (#442)", () => {
  it("the overview source reads it instead of raising recovery-blocked", async () => {
    const t = await groupWithAppendedTask();
    try {
      // mutation: drop the appendedTasks hashes from the pre-fetch -> this throws recovery-blocked, red
      expect(readOverviewGroupSource(t.h.store, "g")).not.toBeNull();
    } finally { await t.h.dispose(); }
  }, 120000);

  it("the overview keeps the group and does not report it recovery-blocked", async () => {
    const t = await groupWithAppendedTask();
    try {
      const overview = readControlOverview(t.h.store, "epoch", null);
      expect(overview.groups.map((group) => group.groupId)).toContain("g");
      // mutation: same pre-fetch omission -> the group is refused, so the issue row appears, red
      expect(overview.issues.filter((issue) => issue.groupId === "g").map((issue) => issue.reason))
        .not.toContain("recovery-blocked");
    } finally { await t.h.dispose(); }
  }, 120000);

  it("the summary and the overview answer the same group", async () => {
    const t = await groupWithAppendedTask();
    try {
      const summary = readControlSummary(t.h.store, "epoch", null);
      expect(summary.groups.find((group) => group.groupId === "g")).toBeDefined();
      expect(readControlOverview(t.h.store, "epoch", null).groups.map((group) => group.groupId)).toContain("g");
    } finally { await t.h.dispose(); }
  }, 120000);
});