import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasPath } from "../../src/control/driverLanding.js";
import { DriverCrash, createExecutionDriver } from "../../src/control/executionDriver.js";
import { listPendingDecisions } from "../../src/control/pendingDecisions.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";

// Control run decisions plan Task 7: an empty result is not landed (deviation D14), yet the decisions its run reported
// still reach the group branch -- through a ledger-only commit E makes on `orca/<g>` by compare-and-swap. An
// out-of-bounds run is still blocked at C and writes none. Every assertion reads git or the store.
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
const BRANCH = "refs/heads/orca/g";
const ledgerIds = (repo: string, rev: string, runId: string): unknown[] =>
  git(repo, "show", `${rev}:.decisions/${runId}.jsonl`).split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l).id);
const acceptances = (t: Awaited<ReturnType<typeof driverHarness>>): unknown =>
  t.h.store.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE kind='acceptance'").get()!.n;

describe("E: an empty result's decisions land in a ledger-only commit (control run decisions Task 7)", () => {
  it("records an empty result's decisions in a ledger-only commit on the group branch", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}), decisions: () => [good()] }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const drive = t.body(runId).drive;
      expect(t.body(runId).state).toBe("settled");
      const tip = git(t.repo, "rev-parse", BRANCH);
      expect(ledgerIds(t.repo, BRANCH, runId)).toEqual([`${runId}/agent-0`]); // mutation E1: skip the commit -> red
      expect(drive.ledgerCommit).toBe(tip);
      expect(git(t.repo, "log", "-1", "--format=%s", tip)).toBe(`orca: decisions ${runId}`);
      // A single-parent commit on the tip the run started from, adding the ledger file and nothing else.
      expect(git(t.repo, "rev-list", "--parents", "-n", "1", tip).split(" ")).toEqual([tip, drive.base]);
      expect(git(t.repo, "ls-tree", "-r", "--name-only", tip).split("\n").sort()).toEqual([".decisions/" + `${runId}.jsonl`, "base.txt"]);
      // D14 kept: still no landing and no acceptance.
      expect(drive.landedCommit).toBe(null);
      expect(acceptances(t)).toBe(0);
      expect(listPendingDecisions(t.h.store, "g")).toEqual([]);
      expect(existsSync(join(t.deps.roots.workspacesRoot, `ledger-${runId}`))).toBe(false);
      expect(git(t.repo, "worktree", "list", "--porcelain")).not.toContain(`ledger-${runId}`);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("makes no ledger-only commit when there is nothing to write", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const drive = t.body(runId).drive;
      expect(git(t.repo, "rev-parse", BRANCH)).toBe(drive.base);
      expect(drive.ledgerCommit).toBe(null);
      expect(listPendingDecisions(t.h.store, "g")).toEqual([]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("makes no commit for an empty result whose only decision is refused, and records it as pending", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}), decisions: () => [good({ kind: "opinion" })] }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      const drive = t.body(runId).drive;
      expect(git(t.repo, "rev-parse", BRANCH)).toBe(drive.base);
      expect(drive.ledgerCommit).toBe(null);
      // mutation E2: skip the pending insert when nothing was committed -> red
      expect(listPendingDecisions(t.h.store, "g").map((p) => [p.pendingId, p.entry.reason])).toEqual([[`pending-${runId}-0`, 'kind-unknown:"opinion"']]);
      expect(drive.stagedPending).toEqual([]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("adopts its own ledger-only commit after a death between the swap and the record", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}), decisions: () => [good(), good({ kind: "opinion" })] }); try {
      const runId = await t.claim();
      const crashing = createExecutionDriver({ ...t.deps, crash: (point) => { if (point === "E-after-ledger-cas") throw new DriverCrash(point); } });
      await t.until(crashing, () => crashing.crashed === "E-after-ledger-cas");
      // The seeded state: the branch holds the run's ledger commit, the run does not know it yet.
      const seeded = git(t.repo, "rev-parse", BRANCH);
      const commits = git(t.repo, "rev-list", "--count", BRANCH);
      expect(git(t.repo, "log", "-1", "--format=%s", seeded)).toBe(`orca: decisions ${runId}`);
      expect(t.body(runId).state).toBe("landed");
      expect(t.body(runId).drive.ledgerCommit).toBe(null);
      expect(listPendingDecisions(t.h.store, "g")).toEqual([]);
      await t.until(t.driver(), () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId).drive.ledgerCommit).toBe(seeded); // mutation E3: skip the adopt step -> red
      expect(git(t.repo, "rev-parse", BRANCH)).toBe(seeded);
      expect(git(t.repo, "rev-list", "--count", BRANCH)).toBe(commits);
      expect(ledgerIds(t.repo, BRANCH, runId)).toEqual([`${runId}/agent-0`]);
      expect(listPendingDecisions(t.h.store, "g").map((p) => p.pendingId)).toEqual([`pending-${runId}-1`]);
      expect(t.body(runId).drive.stagedPending).toEqual([]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("makes its ledger-only commit on the new tip when the branch moved under it", async () => {
    let moved: string | null = null;
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}), decisions: () => [good()] }); try {
      const runId = await t.claim();
      const driver = createExecutionDriver({ ...t.deps, beforeCas: async () => {
        if (moved !== null) return;
        const old = git(t.repo, "rev-parse", BRANCH);
        moved = git(t.repo, "commit-tree", `${old}^{tree}`, "-p", old, "-m", "someone else");
        git(t.repo, "update-ref", BRANCH, moved, old);
      } });
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      const ledger = t.body(runId).drive.ledgerCommit;
      expect(git(t.repo, "rev-parse", BRANCH)).toBe(ledger); // mutation E4: treat a moved tip as swapped -> red
      expect(git(t.repo, "rev-parse", `${ledger}^1`)).toBe(moved);
      expect(ledgerIds(t.repo, ledger, runId)).toEqual([`${runId}/agent-0`]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("waits without committing while a sibling run of the group is reconciling, then commits", async () => {
    // Final review I1: a ledger-only commit now would move orca/<g> under the paid reconciliation, as a D landing would.
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}), decisions: () => [good()] }); try {
      const runId = await t.claim();
      t.h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-sibling','g','sibling',1,1,?)").run(JSON.stringify({ state: "reconciling" }));
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      for (let i = 0; i < 3; i += 1) await driver.round();
      // mutation I1-E: drop the reconciling guard in E -> the ledger-only commit moves the branch, red
      expect(git(t.repo, "rev-parse", BRANCH)).toBe(t.body(runId).drive.base);
      expect([t.body(runId).state, t.body(runId).drive.ledgerCommit]).toEqual(["landed", null]);
      t.h.store.db.prepare("UPDATE runs SET active=0 WHERE id='run-sibling'").run();
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      expect(t.body(runId).drive.ledgerCommit).toBe(git(t.repo, "rev-parse", BRANCH));
      expect(ledgerIds(t.repo, BRANCH, runId)).toEqual([`${runId}/agent-0`]);
    } finally { await t.h.dispose(); }
  }, 30000);

  it("reads whether the tip holds the run's ledger from the tree, and a git failure is an error, not absence", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const head = git(t.repo, "rev-parse", "HEAD");
      expect(await hasPath(t.repo, head, "base.txt")).toBe(true);
      expect(await hasPath(t.repo, head, ".decisions/run-x.jsonl")).toBe(false);
      // Final review T7: a missing tip object read as "absent" would make E commit again instead of stopping.
      await expect(hasPath(t.repo, "0".repeat(40), ".decisions/run-x.jsonl")).rejects.toThrow();
    } finally { await t.h.dispose(); }
  }, 30000);

  it("still blocks an out-of-bounds run and writes no decision", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({ "elsewhere.txt": "x\n" }), decisions: () => [good(), good({ kind: "opinion" })] }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "blocked"); // mutation B1: C does not block an out-of-bounds result -> red
      for (let i = 0; i < 3; i += 1) await driver.round();
      expect(t.body(runId).state).toBe("blocked");
      expect(t.body(runId).drive.blockedReason).toMatch(/^out-of-bounds:/);
      expect(git(t.repo, "ls-tree", "-r", "--name-only", BRANCH).split("\n").filter((p) => p.startsWith(".decisions/"))).toEqual([]);
      expect(listPendingDecisions(t.h.store, "g")).toEqual([]);
    } finally { await t.h.dispose(); }
  }, 30000);
});
