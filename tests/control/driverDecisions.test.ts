import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DriverCrash, createExecutionDriver } from "../../src/control/executionDriver.js";
import { listPendingDecisions } from "../../src/control/pendingDecisions.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Control run decisions plan Task 5: D writes the run's reported decisions into `.decisions/<runId>.jsonl`
// inside the landing merge commit itself, and the refused ones become pending decisions when -- and only
// when -- the run is marked landed. Every assertion reads git or the store, never a return value.
const LANDED = ["landed", "settled"];
const good = (over: Record<string, unknown> = {}) => ({
  question: "q",
  chose: "c",
  alternatives: [{ option: "o", why_not: "w" }],
  because: "b",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "c", blast_radius: "r" },
  scope: "task",
  kind: "interface",
  ...over,
});
const ledgerLines = (repo: string, commit: string, runId: string): Record<string, unknown>[] =>
  git(repo, "show", `${commit}:.decisions/${runId}.jsonl`).split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
const inTree = (repo: string, commit: string, path: string): boolean => {
  try { git(repo, "cat-file", "-e", `${commit}:${path}`); return true; } catch { return false; }
};

describe("D: a landing merge carries the run's decisions (control run decisions Task 5)", () => {
  it("lands two reported decisions inside the landing merge commit", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good(), good()] }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const drive = t.body(runId).drive;
      const landed = drive.landedCommit;
      const lines = ledgerLines(t.repo, landed, runId);
      expect(lines.map((l) => l.id)).toEqual([`${runId}/agent-0`, `${runId}/agent-1`]); // mutation D1: drop the append -> red
      expect((lines[0]!.evidence as string[]).slice(0, 2)).toEqual([`run ${runId}`, `attempt ${drive.attemptSha}`]);
      expect(git(t.repo, "rev-parse", `${landed}^2`)).toBe(drive.attemptSha);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(landed);
      expect(git(t.repo, "log", "-1", "--format=%s", landed)).toBe(`orca: land ${runId}`);
      expect(git(t.repo, "show", `${landed}:a`)).toBe("a");
      expect(listPendingDecisions(t.h.store, "g")).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("lands the task and records a bad-kind entry as pending, not in the ledger", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good({ kind: "opinion" }), good()] }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const landed = t.body(runId).drive.landedCommit;
      expect(ledgerLines(t.repo, landed, runId).map((l) => l.id)).toEqual([`${runId}/agent-1`]);
      const pending = listPendingDecisions(t.h.store, "g"); // mutation D2: skip insertPendingDecisions in markLanded -> red
      expect(pending.map((p) => [p.pendingId, p.runId, p.state, p.entry.reason])).toEqual([[`pending-${runId}-0`, runId, "pending", 'kind-unknown:"opinion"']]);
      expect(pending[0]!.entry.entry).toMatchObject({ kind: "opinion" });
      expect(t.body(runId).drive.stagedPending).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("lands a non-executable undo.how as pending (tier 0) and the task as landed", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good({ undo: { how: "revert it", cost: "c", blast_radius: "r" } })] }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const landed = t.body(runId).drive.landedCommit;
      expect(git(t.repo, "show", `${landed}:a`)).toBe("a");
      expect(inTree(t.repo, landed, `.decisions/${runId}.jsonl`)).toBe(false);
      const pending = listPendingDecisions(t.h.store, "g");
      expect(pending.map((p) => p.pendingId)).toEqual([`pending-${runId}-0`]);
      expect(pending[0]!.entry.reason).toMatch(/^tier-0:/);
    } finally { await t.h.dispose(); }
  });

  it("records a non-array decisions value as one pending item and lands", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => ({ question: "q" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const landed = t.body(runId).drive.landedCommit;
      expect(git(t.repo, "show", `${landed}:a`)).toBe("a");
      expect(inTree(t.repo, landed, `.decisions/${runId}.jsonl`)).toBe(false);
      const pending = listPendingDecisions(t.h.store, "g");
      expect(pending.map((p) => [p.pendingId, p.entry.reason, p.entry.entry])).toEqual([[`pending-${runId}-0`, "decisions-not-array", { question: "q" }]]);
    } finally { await t.h.dispose(); }
  });

  it("leaves the landed tree exactly as before when no decisions are reported", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const landed = t.body(runId).drive.landedCommit;
      expect(git(t.repo, "ls-tree", "-r", "--name-only", landed).split("\n").sort()).toEqual(["a", "base.txt"]);
      expect(git(t.repo, "rev-parse", `${landed}^2`)).toBe(t.body(runId).drive.attemptSha);
      expect(listPendingDecisions(t.h.store, "g")).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("lands the decision file even when the target ignores .decisions/", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good()] }); try {
      writeFileSync(join(t.repo, ".gitignore"), ".decisions/\n");
      git(t.repo, "add", ".gitignore");
      git(t.repo, "commit", "-qm", "ignore decisions");
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state)); // mutation: drop -f -> red
      const landed = t.body(runId).drive.landedCommit;
      expect(git(t.repo, "show", `${landed}:.gitignore`)).toBe(".decisions/");
      expect(ledgerLines(t.repo, landed, runId).map((l) => l.id)).toEqual([`${runId}/agent-0`]);
    } finally { await t.h.dispose(); }
  });

  it("does not append twice when it finds a landing it already made", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good(), good(), good({ kind: "opinion" })] }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      const landed = t.body(runId).drive.landedCommit;
      const commits = git(t.repo, "rev-list", "--count", "refs/heads/orca/g");
      const pendingBefore = listPendingDecisions(t.h.store, "g");
      expect(pendingBefore.map((p) => p.pendingId)).toEqual([`pending-${runId}-2`]);
      // A death after the swap, before markLanded: the run is still collected and its staged pending items are still on it.
      const row = t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!;
      const body = JSON.parse(String(row.body));
      const staged = pendingBefore.map((p) => p.entry);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, state: "collected", drive: { ...body.drive, landedCommit: null, stagedPending: staged } }), runId);
      await t.until(driver, () => t.body(runId).state === "landed");
      expect(t.body(runId).drive.landedCommit).toBe(landed); // mutation D3: run produce on the recovery path -> red
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(landed);
      expect(git(t.repo, "rev-list", "--count", "refs/heads/orca/g")).toBe(commits);
      expect(ledgerLines(t.repo, landed, runId).map((l) => l.id)).toEqual([`${runId}/agent-0`, `${runId}/agent-1`]);
      expect(listPendingDecisions(t.h.store, "g")).toEqual(pendingBefore);
      expect(t.body(runId).drive.stagedPending).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("inserts the pending items staged before a death after the swap when it recovers", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good({ kind: "opinion" })] }); try {
      const runId = await t.claim();
      const crashing = createExecutionDriver({ ...t.deps, crash: (point) => { if (point === "D-after-cas") throw new DriverCrash(point); } });
      await t.until(crashing, () => crashing.crashed === "D-after-cas");
      expect(t.body(runId).state).toBe("collected");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g^2")).toBe(t.body(runId).drive.attemptSha);
      expect(listPendingDecisions(t.h.store, "g")).toEqual([]);
      expect(t.body(runId).drive.stagedPending.map((p: { pendingId: string }) => p.pendingId)).toEqual([`pending-${runId}-0`]);
      await t.until(t.driver(), () => t.body(runId).state === "landed");
      expect(listPendingDecisions(t.h.store, "g").map((p) => p.pendingId)).toEqual([`pending-${runId}-0`]);
    } finally { await t.h.dispose(); }
  });

  it("does not duplicate lines or pending items on a moved-tip retry", async () => {
    let moved: string | null = null;
    const stagedAtCas: number[] = [];
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good({ kind: "opinion" }), good()] }); try {
      const runId = await t.claim();
      const driver = createExecutionDriver({ ...t.deps, beforeCas: async () => {
        stagedAtCas.push(t.body(runId).drive.stagedPending.length);
        if (moved !== null) return;
        const old = git(t.repo, "rev-parse", "refs/heads/orca/g");
        moved = git(t.repo, "commit-tree", `${old}^{tree}`, "-p", old, "-m", "someone else");
        git(t.repo, "update-ref", "refs/heads/orca/g", moved, old);
      } });
      await t.until(driver, () => LANDED.includes(t.body(runId).state));
      const landed = t.body(runId).drive.landedCommit;
      expect(git(t.repo, "rev-parse", `${landed}^1`)).toBe(moved);
      expect(ledgerLines(t.repo, landed, runId).map((l) => l.id)).toEqual([`${runId}/agent-1`]);
      expect(stagedAtCas).toEqual([1, 1]); // mutation D4: stagePending appends instead of replacing -> [1, 2], red
      expect(listPendingDecisions(t.h.store, "g").map((p) => p.pendingId)).toEqual([`pending-${runId}-0`]);
    } finally { await t.h.dispose(); }
  });

  it("inserts no pending item for a run whose landing never completed", async () => {
    const t = await driverHarness([{ taskId: "a" }], { decisions: () => [good({ kind: "opinion" })] }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "collected");
      const old = git(t.repo, "rev-parse", "refs/heads/orca/g");
      writeFileSync(join(t.repo, ".git", "refs", "heads", "orca", "g.lock"), `${old}\n`);
      await t.until(driver, () => t.body(runId).state === "blocked", 5);
      expect(t.body(runId).drive.blockedAt).toBe("D");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(old);
      expect(t.body(runId).drive.stagedPending.map((p: { pendingId: string }) => p.pendingId)).toEqual([`pending-${runId}-0`]);
      expect(listPendingDecisions(t.h.store, "g")).toEqual([]);
    } finally { await t.h.dispose(); }
  });
});
