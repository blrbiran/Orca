// Tester #173 / #224 / #266 (follow-up L; human, round K: "at confirm, use the median actual spend of this repo's past
// tasks as a reference, computed by code, and show the estimate/history ratio"): the estimator gave 28k-190k per task where
// the same repository's tasks used 1-5M. Before confirm the group view carries, by code, the median work tokens of the
// repository's finished tasks and each task's estimate as a multiple of it, so a person sees the gap before confirming.
// Information only: no estimate, limit or refusal changes.
import { describe, expect, it } from "vitest";
import { HISTORY_MIN_SAMPLE, historyRatio, medianOf, repoTaskHistory } from "../../src/control/estimateHistory.js";
import { readArchivedPlan, readEstimateRecord } from "../../src/control/queries.js";
import type { ControlStore } from "../../src/control/store.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { webFixture, type WebFixtureTask } from "./fixtures/web.js";

const M = 1_000_000;
const SUGGESTED = { tokens: 1_500_000, activeMs: 7_000_000, attempts: 2, sessions: 1 };
const ONE = { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 };
type Fixture = Awaited<ReturnType<typeof webFixture>>;

/** Another group's stored rows, as the store keeps them: only the fields the history reads are meaningful. */
function seedGroup(store: ControlStore, groupId: string, body: Record<string, unknown>): void {
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,1,1,?)").run(groupId, JSON.stringify(body));
}
let runSeq = 0;
function seedTask(store: ControlStore, groupId: string, taskId: string, status: string, runs: Array<Record<string, unknown>>): void {
  store.db.prepare("INSERT INTO work_items(group_id,id,target_version,body) VALUES (?,?,1,?)").run(groupId, taskId, JSON.stringify({ workItemId: taskId, taskId, kind: "task", status }));
  for (const body of runs) store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,1,0,?)").run(`seed-run-${++runSeq}`, groupId, taskId, JSON.stringify(body));
}
const run = (tokens: number, extra: Record<string, unknown> = {}) => ({ unknown: { work: false }, cumulative: { work: { tokens } }, ...extra });
const REPO = { plan: { repoId: "repo" } };

/**
 * Three tasks that count -- 1M; 1.5M + 0.5M over two runs (a failed attempt and the one that landed); 4M in an archived
 * group -- median 2M. Each task that must not count spends 100 tokens, so counting any of them moves the median and n.
 */
function seedHistory(store: ControlStore): void {
  seedGroup(store, "o1", REPO); seedTask(store, "o1", "a", "done", [run(1 * M)]);
  seedGroup(store, "o2", REPO); seedTask(store, "o2", "a", "done", [run(1.5 * M), run(0.5 * M)]);
  // Archiving a finished group does not undo what it spent: it counts.
  seedGroup(store, "o3", { ...REPO, archived: { at: 1, actor: "human" } }); seedTask(store, "o3", "a", "done", [run(4 * M)]);
  // Left out: another repository; a task not done; a system group (any systemDebug mark); usage unknown or approximate; no run.
  seedGroup(store, "x-repo", { plan: { repoId: "other" } }); seedTask(store, "x-repo", "a", "done", [run(100)]);
  seedTask(store, "o1", "b", "blocked", [run(100)]);
  seedGroup(store, "x-system", { ...REPO, systemDebug: { source: { kind: "criteria-review" } } }); seedTask(store, "x-system", "a", "done", [run(100)]);
  seedTask(store, "o2", "unknown", "done", [run(100), run(0, { unknown: { work: true } })]);
  seedTask(store, "o2", "approximate", "done", [run(100, { usageApproximate: { floorTokens: null, reason: "test", at: 1 } })]);
  seedTask(store, "o2", "no-run", "done", []);
}

/** Claims the fixture's estimate and completes it with SUGGESTED for the one task (tests/control/estimateExpectation.test.ts). */
async function readyEstimate(h: Fixture, service: WebControlService, taskId: string): Promise<void> {
  const claimed = await service.claimEstimate("g", h.estimateId);
  const row = JSON.parse(String(h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(claimed!.runId)!.body));
  row.state = "settled-restartable";
  h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), claimed!.runId);
  service.completeEstimate("g", h.estimateId, { schema: "budget-estimate-v1", planHash: readArchivedPlan(h.store, "g").planHash,
    tasks: [{ taskId, complexity: "M", confidence: "high", work: SUGGESTED, handoff: ONE, rationale: "small", assumptions: ["clean"] }],
    goalReviewReserve: ONE, groupRationale: "small" });
  expect(readEstimateRecord(h.store, "g", h.estimateId).state).toBe("ready");
}

const TASK: WebFixtureTask = { taskId: "c" };

describe("this repository's history beside the estimate, before confirm (#173/#224/#266)", { timeout: 120_000 }, () => {
  it("is the median work tokens of other groups' done tasks of the repository, every run of a task summed", async () => {
    const h = await webFixture(undefined, [TASK]);
    try {
      seedHistory(h.store);
      // mutations L-repo, L-done, L-system, L-unknown, L-approximate, L-norun: a left-out task counts -> n 4, median 1.5M, red;
      // L-archived: archived groups left out -> n 2, too few, red; L-allruns: only one run of a task -> o2 is 0.5M or 1.5M, red.
      expect(readControlGroup(h.store, "epoch", "g").estimateHistory).toEqual({
        medianTokens: 2 * M, sampleCount: 3, minimumSample: HISTORY_MIN_SAMPLE, tasks: [{ taskId: "c", estimateTokens: null, ratio: null }],
      });
    } finally { await h.dispose(); }
  });

  it("names each task's ready estimate as a multiple of that median", async () => {
    const h = await webFixture(undefined, [TASK]);
    try {
      seedHistory(h.store);
      await readyEstimate(h, new WebControlService(h.deps), "c");
      // mutation L-ratio: the ratio as median/estimate -> 1.3, red
      expect(readControlGroup(h.store, "epoch", "g").estimateHistory?.tasks).toEqual([{ taskId: "c", estimateTokens: 1.5 * M, ratio: 0.75 }]);
    } finally { await h.dispose(); }
  });

  it("gives no median below the minimum sample, and still says how many there were", async () => {
    const h = await webFixture(undefined, [TASK]);
    try {
      seedGroup(h.store, "o1", REPO); seedTask(h.store, "o1", "a", "done", [run(1 * M)]); seedTask(h.store, "o1", "b", "done", [run(3 * M)]);
      await readyEstimate(h, new WebControlService(h.deps), "c");
      // mutation L-min: the minimum sample check dropped -> median 2M and a ratio, red
      expect(readControlGroup(h.store, "epoch", "g").estimateHistory).toEqual({
        medianTokens: null, sampleCount: 2, minimumSample: HISTORY_MIN_SAMPLE, tasks: [{ taskId: "c", estimateTokens: 1.5 * M, ratio: null }],
      });
    } finally { await h.dispose(); }
  });

  it("leaves out the group's own tasks", async () => {
    const h = await webFixture(undefined, [TASK]);
    try {
      seedHistory(h.store);
      // Read for o1: its own task (1M) is not history; o2 (2M) and o3 (4M) are -- too few.
      // mutation L-self: the group itself counted -> n 3, median 2M, red
      expect(repoTaskHistory(h.store, "o1")).toEqual({ medianTokens: null, sampleCount: 2 });
    } finally { await h.dispose(); }
  });

  it("is absent once the proposal is confirmed: it is read before confirm", async () => {
    const h = await webFixture(undefined, [TASK]);
    try {
      seedHistory(h.store);
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", { ...await h.confirmPayload(), budgetMode: "soft" }))).toMatchObject({ result: { kind: "confirmed" } });
      // mutation L-editable: the field given whatever the proposal state -> present, red
      expect(readControlGroup(h.store, "epoch", "g")).not.toHaveProperty("estimateHistory");
    } finally { await h.dispose(); }
  });
});

describe("the arithmetic", () => {
  it("takes the middle value, or the rounded mean of the two middle ones", () => {
    expect(medianOf([4, 1, 2])).toBe(2);
    // mutation L-even: the upper middle for an even count -> 30, red
    expect(medianOf([40, 10, 30, 20])).toBe(25);
    // Tokens are whole: a half rounds up.
    expect(medianOf([1, 2])).toBe(2);
  });

  it("writes a ratio to two significant digits, so a 75x gap is not rounded to 0", () => {
    // mutation L-sig: one decimal place (ratioOf's) -> 0, red
    expect(historyRatio(28_000, 2_100_000)).toBe(0.013);
    expect(historyRatio(1_500_000, 2_000_000)).toBe(0.75);
    expect(historyRatio(9_000_000, 2_000_000)).toBe(4.5);
    // A median of 0 has no multiple.
    expect(historyRatio(1, 0)).toBeNull();
  });
});
