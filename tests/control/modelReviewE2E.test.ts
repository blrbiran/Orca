import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCheckState } from "../../src/control/checks/state.js";
import { criteriaReviewCandidates } from "../../src/control/criteriaReview.js";
import { flagDecision, listFlagsInvolving, listFlaggedDecisions, readFlaggedDecision } from "../../src/control/flaggedDecisions.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { MODEL_REVIEW_ADMIT_MS } from "../../src/control/modelReview/run.js";
import { autoStartPass, ORCHESTRATION_ACTOR, recordConfirmed } from "../../src/control/orchestration.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { readSystemDebugMark } from "../../src/control/systemDebug.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { WebControlService } from "../../src/control/webService.js";
import { readRepositorySettingsBody, writeRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

/**
 * Checks spec 2026-10-22 §6 (plan Task 9, criterion 8): the model review as a read-only system run. The pump opens one
 * review group as orca-auto when its trigger holds on the range since the watermark; the group is confirmed with the
 * newest confirmed group's profiles, admitted last, run by a synthetic ccloop over a real repository, and settled by
 * code into exactly one end. A completed review routes valid findings (major ⇒ a fix group and a red flag; minor ⇒ a
 * minor flag), drops invalid ones with their reason, and moves the watermark; an errored one moves nothing. No paid run.
 */
const DAY = 86_400_000;
type Snapshot = { attemptsRemaining: number; timeRemainingMs: number; tokenBudgetRemaining: number | null };

async function world(options: { behaviour?: FakeBehaviour; budgetSnapshot?: Snapshot; reviewerExtra?: Record<string, string> } = {}) {
  let now = Date.parse("2026-10-22T00:00:00.000Z");
  let findings: unknown = null;
  const t = await driverHarness([{ taskId: "a" }], {
    storeNow: () => now,
    files: (id) => id === "debug" ? { ".orca-review/findings.json": JSON.stringify(findings), ...(options.reviewerExtra ?? {}) } : { [id]: `${id}\n` },
    behaviour: (id) => id === "debug" ? options.behaviour ?? "succeed" : "succeed",
    ...(options.budgetSnapshot ? { budgetSnapshot: (id: string) => id === "debug" ? options.budgetSnapshot : undefined } : {}),
  });
  const { h, repo } = t;
  const service = new WebControlService({ ...h.deps, now: () => new Date(now), knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => repo });
  const body = (groupId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
  /** A group merged into main with `files` changed (what the integration pass records). */
  const land = async (groupId: string, files: Record<string, string>): Promise<string> => {
    for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(repo, path)), { recursive: true }); await writeFile(join(repo, path), content); }
    git(repo, "add", "-A"); git(repo, "commit", "-q", "--allow-empty", "-m", `land ${groupId}`);
    const commit = git(repo, "rev-parse", "main");
    if (h.store.db.prepare("SELECT 1 FROM groups WHERE id=?").get(groupId) === undefined) h.importDeferred(groupId);
    const integration = { ...newGroupIntegration({ delivery: "local", trigger: "task", method: "merge", target: "main" })!, lastIntegrated: commit, integratedCommit: commit };
    h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body(groupId), status: "done", integration }), groupId);
    return commit;
  };
  const state = () => readCheckState(h.store, "repo", "model-review", "main");
  const reviews = () => h.store.db.prepare("SELECT id FROM groups WHERE substr(id,1,10)='sysreview-' ORDER BY rowid").all().map((row) => String(row.id));
  const findingGroups = () => h.store.db.prepare("SELECT id FROM groups WHERE substr(id,1,11)='sysfinding-' ORDER BY rowid").all().map((row) => String(row.id));
  const mark = (groupId: string) => readSystemDebugMark(body(groupId))!;
  /** The standard range: g1 and g2 both change shared.txt (overlap), g3 changes c.txt alone. */
  const landThree = async () => {
    await land("old", { "old.txt": "old\n" });
    expect((await service.checksPass()).initialised).toContain("repo");
    const W = git(repo, "rev-parse", "main");
    const g1 = await land("g1", { "shared.txt": "one\n", "a1.txt": "a1\n" });
    const g2 = await land("g2", { "shared.txt": "one\ntwo\n", "b1.txt": "b1\n" });
    const g3 = await land("g3", { "c.txt": "c\n" });
    return { W, g1, g2, g3 };
  };
  const driver = t.driver();
  /** Confirm (system debug pass), admit (auto start), claim and drive the review's task until its run settles or blocks. */
  const driveReview = async (reviewId: string): Promise<string> => {
    expect((await service.systemDebugPass()).confirmed).toContain(reviewId);
    expect((await service.autoStart()).started).toContain(reviewId);
    const delivered = await deliverScheduledStart(t.dispatch, reviewId);
    if (delivered.kind !== "claimed") throw new Error(`review claim refused: ${JSON.stringify(delivered)}`);
    await t.until(driver, () => ["settled", "blocked"].includes(t.body(delivered.runId).state), 120);
    return delivered.runId;
  };
  return {
    t, h, repo, service, body, land, state, reviews, findingGroups, mark, landThree, driveReview,
    setFindings: (doc: unknown) => { findings = doc; }, advance: (ms: number) => { now += ms; }, now: () => now,
  };
}
type World = Awaited<ReturnType<typeof world>>;

const doc = (from: string, to: string, findings: unknown[]) => ({ schema: "orca-model-review-findings-v1", range: { from, to }, findings });
const finding = (id: string, severity: "major" | "minor", evidence: Array<[string, string, number]>) => ({
  id, category: "contract-drift", severity, title: `t ${id}`, explanation: `e ${id}`, suggestedFix: `f ${id}`,
  evidence: evidence.map(([groupId, path, line]) => ({ groupId, path, line, note: "n" })),
});
const goodFindings = (w: World, reviewId: string) => {
  const { from, to } = w.mark(reviewId).source as { from: string; to: string };
  return doc(from, to, [
    finding("drift-major", "major", [["g1", "shared.txt", 1], ["g2", "shared.txt", 2]]),
    finding("dup-minor", "minor", [["g1", "a1.txt", 1], ["g2", "b1.txt", 1]]),
    // g3 never changed shared.txt: dropped by code.
    finding("bad-ref", "major", [["g3", "shared.txt", 1], ["g1", "shared.txt", 1]]),
  ]);
};
/** Opens the review on the standard range; returns its id. */
const openOne = async (w: World): Promise<string> => {
  await w.landThree();
  const opened = await w.service.checksPass();
  expect(opened.opened).toHaveLength(1);
  expect(w.reviews()).toEqual(opened.opened);
  return opened.opened[0]!;
};
const settledOf = (w: World, reviewId: string) => w.mark(reviewId).settled;

describe("the model review run (checks spec §6, criterion 8)", { timeout: 240_000 }, () => {
  it("opens one read-only review as orca-auto, routes valid findings, drops the invalid one, and moves the watermark", async () => {
    const w = await world(); try {
      // The project's own default merges into main: a review must still never carry it (it never lands, §6.1).
      writeRepositorySettingsBody(w.h.store, "repo", { workspaceMode: "worktree", revision: 1, integration: { delivery: "local", trigger: "task", method: "merge", target: "main" } } as never);
      const { W } = await w.landThree();
      const H = git(w.repo, "rev-parse", "main");
      const opened = await w.service.checksPass();
      expect(opened.opened).toHaveLength(1);
      const reviewId = opened.opened[0]!;
      expect(reviewId).toMatch(/^sysreview-[a-f0-9]{16}$/);
      // A second pass while it is open opens nothing.
      expect((await w.service.checksPass()).opened).toEqual([]);
      const mark = w.mark(reviewId);
      expect(mark.source).toEqual({ kind: "model-review", repoId: "repo", target: "main", from: W, to: H, runSeq: 1 });
      expect(mark.stackOn).toBeNull();
      expect(mark.openedAt).toBe(w.now());
      // The open is orca-auto's command.
      const command = w.h.store.db.prepare("SELECT result FROM commands WHERE group_id=?").get(reviewId);
      expect(JSON.parse(String(command!.result))).toMatchObject({ actorId: ORCHESTRATION_ACTOR, verb: "system-debug-open" });
      // §6.2: the inputs are files under the runs root; the facts name the directory, whose index hash is on the mark.
      const inputDir = mark.review!.inputDir;
      expect(existsSync(join(inputDir, "index.json"))).toBe(true);
      expect(statSync(inputDir).mode & 0o777).toBe(0o700);
      expect(createHash("sha256").update(readFileSync(join(inputDir, "index.json"))).digest("hex")).toBe(mark.review!.inputSha256);
      const contract = JSON.parse(readArchivedPlan(w.h.store, reviewId).plan.tasks[0]!.originalContractCanonicalJson) as { objective: { goal: string }; context: { targetPaths: string[] } };
      expect(contract.objective.goal).toContain(inputDir);
      expect(contract.context.targetPaths).toEqual([".orca-review/findings.json", ".decisions/**"]);
      expect(JSON.parse(readFileSync(join(inputDir, "range.json"), "utf8")).groups.map((group: { groupId: string }) => group.groupId)).toEqual(["g1", "g2", "g3"]);
      // Stripped group: no goal-review and no handoff money; the work grant and the limit are the review budget.
      const proposal = readBudgetProposal(w.h.store, reviewId) as unknown as { allocations: Array<{ ownerKind: string; bucket: string; amount: { tokens: number; activeMs: number } }>; groupLimit: { tokens: number } };
      const allocation = (kind: string, bucket: string) => proposal.allocations.find((entry) => entry.ownerKind === kind && entry.bucket === bucket)!;
      expect(allocation("goal-review", "review").amount).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
      expect(allocation("task", "handoff").amount).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
      expect(allocation("task", "work").amount.tokens).toBe(1_000_000);
      expect(proposal.groupLimit.tokens).toBe(1_000_000);
      expect(w.body(reviewId).integration).toBeUndefined();

      // Confirmed with the newest confirmed group's profiles (the harness's "g").
      w.setFindings(goodFindings(w, reviewId));
      // A group lands while the review runs: nothing waits on the review.
      const late = await w.land("g4", { "late.txt": "late\n" });
      await w.driveReview(reviewId);
      expect(readBudgetProposal(w.h.store, reviewId).profiles?.worker.profileId).toBe(readBudgetProposal(w.h.store, "g").profiles?.worker.profileId);
      expect(listFlaggedDecisions(w.h.store, reviewId).filter((row) => row.source === "test-change")).toEqual([]);
      const settled = await w.service.systemDebugPass();
      expect(settled.settled).toContain(reviewId);
      expect(settledOf(w, reviewId)?.state).toBe("completed");

      // One major ⇒ a fix group (orca-auto) and a red flag on the review group, naming both involved groups.
      expect(w.findingGroups()).toHaveLength(1);
      const fixId = w.findingGroups()[0]!;
      expect(w.mark(fixId).source).toEqual({ kind: "model-review-finding", repoId: "repo", reviewGroupId: reviewId, findingId: "drift-major" });
      const fixContract = JSON.parse(readArchivedPlan(w.h.store, fixId).plan.tasks[0]!.originalContractCanonicalJson) as { verification: { requiredChecks: string[] }; objective: { goal: string } };
      expect(fixContract.verification.requiredChecks).toEqual(["true"]);
      expect(fixContract.objective.goal).toContain("shared.txt");
      const major = readFlaggedDecision(w.h.store, `model-review:${reviewId}:drift-major`)!;
      expect(major).toMatchObject({ groupId: reviewId, source: "model-review", state: "flagged", severity: "major", involvedGroupIds: ["g1", "g2"], flaggedBy: ORCHESTRATION_ACTOR });
      const minor = readFlaggedDecision(w.h.store, `model-review:${reviewId}:dup-minor`)!;
      expect(minor).toMatchObject({ groupId: reviewId, severity: "minor", involvedGroupIds: ["g1", "g2"] });
      expect(readFlaggedDecision(w.h.store, `model-review:${reviewId}:bad-ref`)).toBeNull();
      expect(listFlagsInvolving(w.h.store, "g1").map((row) => row.decisionId).sort()).toEqual([`model-review:${reviewId}:drift-major`, `model-review:${reviewId}:dup-minor`]);
      expect(listFlagsInvolving(w.h.store, "g3")).toEqual([]);

      // The watermark moves to the head read at the start, not past the late landing; the record keeps the dropped one.
      const last = w.state()!.last!;
      expect(w.state()!.watermark).toBe(H);
      expect(w.state()!.watermark).not.toBe(late);
      expect(w.state()!.failureStreak).toBe(0);
      expect(last).toMatchObject({ state: "completed", reviewGroupId: reviewId, debugGroupIds: [fixId], from: W, to: H, groups: ["g1", "g2", "g3"] });
      const record = JSON.parse(readCanonicalRecord(w.h.store, last.recordHash!)) as { valid: Array<{ id: string }>; dropped: Array<{ findingId: string; reason: string }> };
      expect(record.valid.map((entry) => entry.id)).toEqual(["drift-major", "dup-minor"]);
      expect(record.dropped).toEqual([{ findingId: "bad-ref", reason: "ref-not-in-range:g3:shared.txt" }]);

      // The fix group is confirmed on the next pass (profiles from the involved groups, else the repository's newest).
      expect((await w.service.systemDebugPass()).confirmed).toContain(fixId);
      // The review itself is never folded or landed: its branch is its own, and nothing is settled again.
      expect(git(w.repo, "rev-parse", "main")).toBe(late);
      expect((await w.service.systemDebugPass()).settled).toEqual([]);
    } finally { await w.h.dispose(); }
  });

  it("an attempt that writes outside the findings file ends errored: not-read-only, watermark kept, streak 1", async () => {
    const w = await world({ reviewerExtra: { "src.txt": "changed\n" } }); try {
      const reviewId = await openOne(w);
      const W = w.state()!.watermark;
      w.setFindings(goodFindings(w, reviewId));
      await w.driveReview(reviewId);
      await w.service.systemDebugPass();
      expect(settledOf(w, reviewId)).toMatchObject({ state: "errored", detail: "not-read-only" });
      expect(w.state()).toMatchObject({ watermark: W, failureStreak: 1, last: { state: "errored", detail: "not-read-only" } });
      expect(w.findingGroups()).toEqual([]);
      expect(listFlaggedDecisions(w.h.store, reviewId).filter((row) => row.source === "model-review")).toEqual([]);
    } finally { await w.h.dispose(); }
  });

  it("the post-run path check reads the work branch: a commit beside the findings ends errored: not-read-only", async () => {
    const w = await world(); try {
      const reviewId = await openOne(w);
      w.setFindings(goodFindings(w, reviewId));
      const runId = await w.driveReview(reviewId);
      // Someone (or something) added a commit to the review's branch after its run.
      const branch = `refs/heads/orca/${reviewId}`;
      const tip = git(w.repo, "rev-parse", branch);
      expect(w.t.body(runId).drive.landedCommit).toBe(tip);
      git(w.repo, "worktree", "add", "-q", join(w.h.root, "wt"), branch.replace("refs/heads/", ""));
      await writeFile(join(w.h.root, "wt", "extra.txt"), "x\n");
      git(join(w.h.root, "wt"), "add", "extra.txt"); git(join(w.h.root, "wt"), "commit", "-qm", "extra");
      await w.service.systemDebugPass();
      expect(settledOf(w, reviewId)).toMatchObject({ state: "errored", detail: "not-read-only" });
      expect(w.findingGroups()).toEqual([]);
    } finally { await w.h.dispose(); }
  });

  it("a findings file that names another range is errored: findings-invalid", async () => {
    const w = await world(); try {
      const reviewId = await openOne(w);
      const { from } = w.mark(reviewId).source as { from: string };
      w.setFindings(doc(from, from, []));
      await w.driveReview(reviewId);
      await w.service.systemDebugPass();
      expect(settledOf(w, reviewId)).toMatchObject({ state: "errored", detail: "findings-invalid" });
      expect(w.state()?.failureStreak).toBe(1);
    } finally { await w.h.dispose(); }
  });

  it("an exhausted run whose snapshot shows no tokens left is errored: budget; exhausted alone is run-failed", async () => {
    const zero = await world({ behaviour: "exhausted", budgetSnapshot: { attemptsRemaining: 2, timeRemainingMs: 1000, tokenBudgetRemaining: 0 } }); try {
      const reviewId = await openOne(zero);
      await zero.driveReview(reviewId);
      await zero.service.systemDebugPass();
      expect(settledOf(zero, reviewId)).toMatchObject({ state: "errored", detail: "budget: tokens" });
    } finally { await zero.h.dispose(); }
    const left = await world({ behaviour: "exhausted", budgetSnapshot: { attemptsRemaining: 2, timeRemainingMs: 1000, tokenBudgetRemaining: 5 } }); try {
      const reviewId = await openOne(left);
      await left.driveReview(reviewId);
      await left.service.systemDebugPass();
      expect(settledOf(left, reviewId)).toMatchObject({ state: "errored", detail: "run-failed:exhausted" });
    } finally { await left.h.dispose(); }
  });

  it("a terminal blocked_waiting_human is errored: blocked-waiting-human", async () => {
    const w = await world({ behaviour: "blocked-waiting-human" }); try {
      const reviewId = await openOne(w);
      await w.driveReview(reviewId);
      await w.service.systemDebugPass();
      expect(settledOf(w, reviewId)).toMatchObject({ state: "errored", detail: "blocked-waiting-human" });
    } finally { await w.h.dispose(); }
  });

  it("a claim refused for the group's limit is errored: budget", async () => {
    const w = await world(); try {
      const reviewId = await openOne(w);
      expect((await w.service.systemDebugPass()).confirmed).toContain(reviewId);
      expect((await w.service.autoStart()).started).toContain(reviewId);
      // The review's whole limit is spent (as a booked usage would leave it).
      const group = w.body(reviewId) as { used: { tokens: number }; limit: { tokens: number } };
      w.h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...group, used: { ...group.used, tokens: group.limit.tokens } }), reviewId);
      expect(await deliverScheduledStart(w.t.dispatch, reviewId)).toMatchObject({ kind: "blocked", reason: "group-budget-unavailable" });
      await w.service.systemDebugPass();
      expect(settledOf(w, reviewId)).toMatchObject({ state: "errored", detail: "budget: limit" });
    } finally { await w.h.dispose(); }
  });

  it("a review a person archives or stops is errored: archived / stopped", async () => {
    const w = await world(); try {
      const reviewId = await openOne(w);
      const archived = w.service.archiveGroup(w.h.rawCommand("archive-review", Number(w.h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(reviewId)!.revision), "archive-group", { kind: "group", groupId: reviewId }, {}) as never);
      expect("error" in archived).toBe(false);
      await w.service.systemDebugPass();
      expect(settledOf(w, reviewId)).toMatchObject({ state: "errored", detail: "archived" });
      expect(w.state()?.last).toMatchObject({ state: "errored", detail: "archived" });
    } finally { await w.h.dispose(); }
    const s = await world(); try {
      const reviewId = await openOne(s);
      expect((await s.service.systemDebugPass()).confirmed).toContain(reviewId);
      const stopped = await s.service.handoffStop(s.h.rawCommand("stop-review", Number(s.h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(reviewId)!.revision), "handoff-stop", { kind: "group", groupId: reviewId }, {}) as never);
      expect("error" in stopped).toBe(false);
      await s.service.systemDebugPass();
      expect(settledOf(s, reviewId)).toMatchObject({ state: "errored", detail: "stopped" });
    } finally { await s.h.dispose(); }
  });

  it("a review not admitted within 24 h is errored: not-admitted and archived as orca-auto", async () => {
    const w = await world(); try {
      const reviewId = await openOne(w);
      expect((await w.service.systemDebugPass()).confirmed).toContain(reviewId);
      w.advance(MODEL_REVIEW_ADMIT_MS - 1);
      await w.service.systemDebugPass();
      expect(settledOf(w, reviewId)).toBeNull();
      w.advance(1);
      await w.service.systemDebugPass();
      expect(settledOf(w, reviewId)).toMatchObject({ state: "errored", detail: "not-admitted" });
      expect(w.body(reviewId).archived).toMatchObject({ actor: ORCHESTRATION_ACTOR });
    } finally { await w.h.dispose(); }
  });

  it("with no confirmed group in the project the review is not opened: errored no-profiles", async () => {
    const w = await world(); try {
      const archived = w.service.archiveGroup(w.h.command("archive-group", {}) as never);
      expect("error" in archived).toBe(false);
      await w.landThree();
      expect((await w.service.checksPass()).opened).toEqual([]);
      expect(w.reviews()).toEqual([]);
      expect(w.state()).toMatchObject({ failureStreak: 1, last: { state: "errored", detail: "no-profiles" } });
    } finally { await w.h.dispose(); }
  });

  it("a findings path the range's own denylist forbids is not opened: errored findings-path-denied (Rule 16)", async () => {
    const w = await world(); try {
      // g3's contract denies .orca-review/**.
      const path = join(w.h.root, "contract-a.json");
      const contract = JSON.parse(readFileSync(path, "utf8"));
      await w.land("old", { "old.txt": "old\n" }); await w.service.checksPass();
      await w.land("g1", { "shared.txt": "one\n" }); await w.land("g2", { "shared.txt": "two\n" });
      await writeFile(path, JSON.stringify({ ...contract, safetyPolicy: { ...contract.safetyPolicy, denylistPaths: [".orca-review/**"] } }));
      await w.land("g3", { "c.txt": "c\n" });
      expect((await w.service.checksPass()).opened).toEqual([]);
      expect(w.state()?.last).toMatchObject({ state: "errored", detail: "findings-path-denied" });
    } finally { await w.h.dispose(); }
  });

  it("a major finding whose involved groups hold no checks is flagged red with no fix group: no-checks", async () => {
    const w = await world(); try {
      const reviewId = await openOne(w);
      // g1 and g2's plans cannot be read any more: their required checks are unknown (empty).
      for (const groupId of ["g1", "g2"]) w.h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...w.body(groupId), planHash: "0".repeat(64) }), groupId);
      w.setFindings(goodFindings(w, reviewId));
      await w.driveReview(reviewId);
      await w.service.systemDebugPass();
      expect(settledOf(w, reviewId)?.state).toBe("completed");
      expect(w.findingGroups()).toEqual([]);
      expect(readFlaggedDecision(w.h.store, `model-review:${reviewId}:drift-major`)).toMatchObject({ severity: "major", state: "flagged" });
      const record = JSON.parse(readCanonicalRecord(w.h.store, w.state()!.last!.recordHash!)) as { routed: Array<{ findingId: string; detail: string | null }> };
      expect(record.routed).toContainEqual({ findingId: "drift-major", severity: "major", debugGroupId: null, detail: "no-checks: fix not opened" });
    } finally { await w.h.dispose(); }
  });

  it("after an errored review the next trigger on the same range opens a new group; the errored one is kept as it was", async () => {
    const w = await world(); try {
      const first = await openOne(w);
      w.service.archiveGroup(w.h.rawCommand("archive-review", Number(w.h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(first)!.revision), "archive-group", { kind: "group", groupId: first }, {}) as never);
      await w.service.systemDebugPass();
      const before = JSON.stringify(w.body(first));
      // The interval (7 days) keeps the same range from being retried at once.
      expect((await w.service.checksPass()).opened).toEqual([]);
      w.advance(7 * DAY);
      const again = await w.service.checksPass();
      expect(again.opened).toHaveLength(1);
      expect(again.opened[0]).not.toBe(first);
      expect(w.mark(again.opened[0]!).source).toMatchObject({ from: w.mark(first).source.kind === "model-review" ? (w.mark(first).source as { from: string }).from : "", runSeq: 2 });
      expect(JSON.stringify(w.body(first))).toBe(before);
    } finally { await w.h.dispose(); }
  });

  it("a range longer than maxGroupsPerReview is cut oldest first; the watermark moves to the last included group", async () => {
    const w = await world(); try {
      writeRepositorySettingsBody(w.h.store, "repo", { ...(readRepositorySettingsBody(w.h.store, "repo") ?? { workspaceMode: "worktree", revision: 1 }), checks: { modelReview: { maxGroupsPerReview: 2 } } } as never);
      const { g2 } = await w.landThree();
      const opened = await w.service.checksPass();
      const reviewId = opened.opened[0]!;
      expect(w.mark(reviewId).source).toMatchObject({ to: g2 });
      expect(w.mark(reviewId).review!.groups).toEqual(["g1", "g2"]);
      const { from, to } = w.mark(reviewId).source as { from: string; to: string };
      w.setFindings(doc(from, to, []));
      await w.driveReview(reviewId);
      await w.service.systemDebugPass();
      expect(w.state()).toMatchObject({ watermark: g2, last: { state: "completed", groups: ["g1", "g2"] } });
    } finally { await w.h.dispose(); }
  });

  it("is admitted after person-confirmed groups (lowest admission priority)", async () => {
    const w = await world(); try {
      const reviewId = await openOne(w);
      expect((await w.service.systemDebugPass()).confirmed).toContain(reviewId);
      // One slot: the person's group goes before the review, whatever the confirm order.
      w.h.importDeferred("p");
      w.h.store.db.prepare("UPDATE groups SET body=? WHERE id='p'").run(JSON.stringify({ ...w.body("p"), status: "ready" }));
      w.h.store.transaction(() => recordConfirmed(w.h.store, "p", "run", 1));
      const order: string[] = [];
      w.h.store.db.prepare("INSERT INTO orchestration_settings(singleton,revision,body) VALUES (1,1,?) ON CONFLICT(singleton) DO UPDATE SET body=excluded.body").run(JSON.stringify({ maxRunningGroups: 64 }));
      await autoStartPass({ store: w.h.store, now: () => w.now(), start: async (command) => { order.push(command.target.groupId); return {}; } });
      expect(order.indexOf("p")).toBeGreaterThanOrEqual(0);
      expect(order.indexOf("p")).toBeLessThan(order.indexOf(reviewId));
      expect(order.at(-1)).toBe(reviewId);
    } finally { await w.h.dispose(); }
  });

  it("the criteria-review pass skips a review group (it can change no test)", async () => {
    const w = await world(); try {
      const reviewId = await openOne(w);
      w.h.store.transaction(() => flagDecision(w.h.store, { decisionId: "r1/orca-criteria", groupId: reviewId, runId: "r1", source: "test-change", reason: "x", evidence: [], by: "orca-auto", at: new Date().toISOString() }));
      w.h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('r1',?,'debug',1,0,?)").run(reviewId, JSON.stringify({ runId: "r1", taskId: "debug" }));
      expect(criteriaReviewCandidates(w.h.store, () => false).map((candidate) => candidate.groupId)).not.toContain(reviewId);
    } finally { await w.h.dispose(); }
  });
});
