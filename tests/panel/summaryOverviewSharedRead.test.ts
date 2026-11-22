import { readControlOverview } from "../../src/panel/controlOverview.js";
import { readOverviewGroupSource } from "../../src/panel/controlViews.js";
import { readControlSummary, type GroupSourceCache } from "../../src/panel/controlViews.js";
import { installControlReadCounters } from "../control/fixtures/controlReadCounters.js";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { afterAll, describe, expect, it } from "vitest";
import { createHarness, GROUP } from "./fixtures/controlPanel.js";

const h = createHarness();
afterAll(() => h.dispose());
const { panelFixture, seedZeroQuestion } = createOverviewFixtures(h);

/**
 * Tester #393(b): `/api/control/summary` serves each group's `needsYou` from the overview pass, so the route walked
 * every group twice -- once for the summary it answers and once inside `readOverviewGroupSource`. A request-scoped
 * cache (`readControlSummary(store, epoch, since, forceComplete, cache)` together with
 * `readControlOverview(store, epoch, since, cache)`) makes the second walk reuse the first one's read.
 *
 * The instrument counts JSON parses per stored body (controlReadCounters buckets identical bytes), so the two walks
 * are told apart by how often one group's work and run bodies are parsed: twice without the cache, at most once
 * with it. It is a behavioural criterion -- it fails on the old code, where the two reads cannot share anything.
 */
describe("summary and overview share one per-group read (#393b)", () => {
  it("parses each stored work and run body of a group at most once per request", async () => {
    const { panel } = await panelFixture();
    seedZeroQuestion(panel, "healthy");
    const counter = installControlReadCounters(panel.store);
    try {
      counter.reset();
      const cache: GroupSourceCache = new Map();
      const summary = readControlSummary(counter.store, "overview-epoch", null, false, cache);
      readControlOverview(counter.store, "overview-epoch", null, cache);
      const parses = counter.snapshot().parses;
      const bodyKeys = [...parses.keys()].filter((key) => !key.startsWith("groups:"));
      // The fixture has at least one stored work/run body, or the criterion would be vacuous.
      expect(bodyKeys.length).toBeGreaterThan(0);
      for (const key of bodyKeys) expect(parses.get(key), key).toBe(1);
      // The cache did answer the summary: every visible group was read into it once.
      expect(cache.size).toBe(summary.groups.length);
    } finally {
      counter.restore();
    }
  });
  it("answers the same summary bytes with and without the shared cache", async () => {
    const { panel } = await panelFixture();
    seedZeroQuestion(panel, "healthy");
    expect(readControlSummary(panel.store, "overview-epoch", null, false, new Map()))
      .toEqual(readControlSummary(panel.store, "overview-epoch", null));
  });
  /**
   * The overview's source reader refuses a group whose stored run does not decode against the group's own identity
   * (taskNoteOldReviewRun.test.ts #282 is the live shape: an old run row the summary still answers for). A shared
   * cache must not import that strictness into the summary: a group it refuses falls back to the summary's own reader,
   * so the summary keeps answering, and only the overview calls the group unreadable (its own contract).
   */
  it("keeps a group the overview reader refuses readable in the summary", async () => {
    const { panel } = await panelFixture();
    seedZeroQuestion(panel, "healthy");
    const work = panel.store.db.prepare("SELECT id,body FROM work_items WHERE group_id=?").get(GROUP) as { id: string; body: string };
    const stored = JSON.parse(work.body) as { taskId: string; generation?: number };
    const generation = stored.generation ?? 1;
    // A run row whose owner disagrees with what the overview checks: this reader refuses it, the summary reader does not.
    panel.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,?,?)")
      .run("stale-run", GROUP, work.id, generation, 0, JSON.stringify({
        runId: "stale-run", groupId: GROUP, workItemId: "not-this-work-item", taskId: stored.taskId,
        generation, phase: "work", state: "settled",
      }));
    // The criterion is not vacuous: the overview's reader really does refuse this group now.
    expect(() => readOverviewGroupSource(panel.store, GROUP)).toThrow();
    // The summary still answers it, with and without the shared cache, byte for byte.
    const plain = readControlSummary(panel.store, "overview-epoch", null);
    expect(plain.groups.map((group) => group.groupId)).toContain(GROUP);
    expect(readControlSummary(panel.store, "overview-epoch", null, false, new Map())).toEqual(plain);
  });
});