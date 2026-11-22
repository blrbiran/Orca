import { readControlOverview } from "../../src/panel/controlOverview.js";
import { readControlSummary, type GroupSourceCache } from "../../src/panel/controlViews.js";
import { installControlReadCounters } from "../control/fixtures/controlReadCounters.js";
import { createOverviewFixtures } from "./controlOverviewFixtures.js";
import { afterAll, describe, expect, it } from "vitest";
import { createHarness } from "./fixtures/controlPanel.js";

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
});