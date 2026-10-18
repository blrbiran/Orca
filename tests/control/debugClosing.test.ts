import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { DEBUG_INPUT_SCHEMA, type DebugInputV1 } from "../../src/control/debugInput.js";
import { driveRecordSchema } from "../../src/control/driveRecord.js";
import { DriverCrash, createExecutionDriver, type ExecutionDriver } from "../../src/control/executionDriver.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import type { PendingEntry } from "../../src/control/runLedger.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { AGENT_WRITTEN, ORCA_GENERATED } from "../../src/corrections/derive.js";
import { deriveFixRunId } from "../../src/corrections/fields.js";
import type { Correction } from "../../src/corrections/schema.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import { driverHarness, git, type HarnessOptions } from "./fixtures/driverHarness.js";

// Debug-task design §5, §12.5, §12.6 / plan Task 9: a debug run's landing commit carries the rows that close its
// correction. Every assertion reads git (`git show <landed>:<path>`) or the store, never writeDebugClosing's answer.

const LANDED = ["landed", "settled"];
const CID = "c_debug00000000001";
const ORIGINAL: DecisionEvent = {
  ev: "decision", id: "orig-run/agent-0", at: "2026-10-01T00:00:00.000Z", run: "orig-run",
  question: "which lock", chose: "an in-process mutex", alternatives: [{ option: "a file lease", why_not: "heavier" }],
  because: "quickest", undo: { how: `git revert --no-edit ${"c".repeat(40)}`, cost: "one file", blast_radius: "this repo" },
  scope: "repo", kind: "interface",
};
const decisionCorrection = (over: Partial<Correction> = {}): Correction => ({
  id: CID, projectKey: "github.com/o/r", decisionId: ORIGINAL.id, kind: "wrong", because: "it does not hold across processes",
  at: "2026-10-02T00:00:00.000Z", by: "amy", ...over,
});
const fixRunIdOf = (correction: Correction): string => { const { id, ...row } = correction; return deriveFixRunId(row, id); };
const PENDING: PendingEntry = {
  pendingId: "pending-orig-run-0", ledgerRun: "orig-run", entryIndex: 0, reason: "tier-0: undo.how",
  entry: { question: "which cache", chose: "no cache", alternatives: [{ option: "lru", why_not: "w" }], because: "b",
    undo: { how: "revert it", cost: "small", blast_radius: "one module" }, scope: "task", kind: "interface" },
  at: "2026-10-01T00:00:00.000Z", evidence: ["run orig-run"],
};
const pendingCorrection: Correction = {
  id: CID, projectKey: "github.com/o/r", runId: "orig-run", pendingId: PENDING.pendingId, kind: "not_my_taste",
  because: "a cache is needed", at: "2026-10-02T00:00:00.000Z", by: "amy",
};

const lines = (repo: string, commit: string, path: string): Record<string, any>[] =>
  git(repo, "show", `${commit}:${path}`).split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
const inTree = (repo: string, commit: string, path: string): boolean => {
  try { git(repo, "cat-file", "-e", `${commit}:${path}`); return true; } catch { return false; }
};
/** Commits `files` onto the checked-out branch (main) of `repo`. */
function commitFiles(repo: string, files: Record<string, string>, message: string): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), content);
    git(repo, "add", "-f", path);
  }
  git(repo, "commit", "-qm", message);
  return git(repo, "rev-parse", "HEAD");
}
const jsonl = (...rows: unknown[]): string => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
/** The closing rows a human `--close` would have written for the correction, at an arbitrary moment. */
function humanClosingRows(correction: Correction): unknown[] {
  const fixRunId = fixRunIdOf(correction);
  return [
    { ...ORIGINAL, id: `${fixRunId}/1`, run: fixRunId, at: "2026-10-03T00:00:00.000Z", chose: "a file lease",
      evidence: [`correction ${correction.id}`, `overturns ${ORIGINAL.id}`] },
    { ev: "overturned", id: ORIGINAL.id, correctionId: correction.id, replacedBy: `${fixRunId}/1`, at: "2026-10-03T00:00:00.000Z", run: fixRunId },
  ];
}

interface Setup { correction: Correction; decision?: DecisionEvent | null; pending?: PendingEntry | null; undoHow?: string | null }

/** The frozen input at open (ruling 3) and the group's debug mark naming it. */
function markGroup(t: Awaited<ReturnType<typeof driverHarness>>, setup: Setup): void {
  const input: DebugInputV1 = {
    schema: DEBUG_INPUT_SCHEMA, correction: setup.correction, decision: setup.decision === undefined ? ORIGINAL : setup.decision,
    decisionWhere: setup.decision === null ? null : "target", pending: setup.pending ?? null, originalRun: null, commits: null, contract: null, missing: ["run"],
  };
  const hash = sha256Canonical(input);
  writeCanonicalRecord(t.h.store, "g", hash, canonicalBytes(input).toString("utf8"));
  const mark = {
    correctionId: setup.correction.id, ordinal: 1, inputHash: hash, missing: ["run"], agentFallback: null,
    undoHow: setup.undoHow ?? null, closing: null, checks: { from: "named", namedBy: "human" },
  };
  const row = t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
  t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...JSON.parse(String(row.body)), debug: mark }));
}
const closingOf = (t: Awaited<ReturnType<typeof driverHarness>>): any =>
  JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).debug.closing;

/** A debug group `g` whose repo holds the original decision at base; the reproduce-first check is passed (Task 8's own tests cover it). */
async function debugHarness(setup: Setup, options: HarnessOptions = {}) {
  const t = await driverHarness([{ taskId: "a" }], options);
  commitFiles(t.repo, { ".decisions/orig-run.jsonl": jsonl(ORIGINAL) }, "the original decision");
  markGroup(t, setup);
  const passing = async () => ({ kind: "passed" as const, tests: [], command: "true" });
  const driver = (over: Partial<Parameters<typeof createExecutionDriver>[0]> = {}): ExecutionDriver =>
    createExecutionDriver({ ...t.deps, checkReproduction: passing, ...over });
  return { ...t, driver };
}

describe("a debug run's landing commit closes its correction (plan Task 9)", () => {
  it("the landing commit holds the closing file", async () => {
    const correction = decisionCorrection();
    const t = await debugHarness({ correction }, { debug: () => ({ choseInstead: "a file lease", reproCommand: "true" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const drive = t.body(runId).drive;
      const fixRunId = fixRunIdOf(correction);
      const rows = lines(t.repo, drive.landedCommit, `.decisions/${fixRunId}.jsonl`);
      expect(rows.map((row) => row.ev)).toEqual(["decision", "overturned"]);
      expect(rows[1]!.correctionId).toBe(CID);
      expect(rows[1]!.id).toBe(ORIGINAL.id);
      // M-9.2: undo.how taken from anywhere but the attempt's revert -> red.
      expect(rows[0]!.undo.how).toBe(`git revert --no-edit ${drive.attemptSha}${ORCA_GENERATED}`);
      // M-9.1: the agent's suffix dropped -> red.
      expect(rows[0]!.chose).toBe(`a file lease${AGENT_WRITTEN}`);
      expect(git(t.repo, "rev-parse", `${drive.landedCommit}^2`)).toBe(drive.attemptSha);
      expect(git(t.repo, "log", "-1", "--format=%s", drive.landedCommit)).toBe(`orca: land ${runId}`);
      // Cross-plan resolution 3: copied into the mark by the landing's write, cleared from the run.
      expect(closingOf(t)).toEqual({ state: "written", relPath: `.decisions/${fixRunId}.jsonl`, fixRunId });
      expect(drive.stagedDebugClosing).toBe(null);
    } finally { await t.h.dispose(); }
  });

  it("a human chose_instead and undo.how pass through with no suffix", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    const how = `git revert --no-edit ${"d".repeat(40)}`;
    const t = await debugHarness({ correction, undoHow: how }, { debug: () => ({ choseInstead: "something the agent said" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const [decision] = lines(t.repo, t.body(runId).drive.landedCommit, `.decisions/${fixRunIdOf(correction)}.jsonl`);
      expect(decision!.chose).toBe("a file lease");
      expect(decision!.undo.how).toBe(how);
    } finally { await t.h.dispose(); }
  });

  it("a pending target writes one decision row and no overturned", async () => {
    const t = await debugHarness({ correction: pendingCorrection, decision: null, pending: PENDING }, { debug: () => ({ choseInstead: "an lru cache" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const rows = lines(t.repo, t.body(runId).drive.landedCommit, `.decisions/${fixRunIdOf(pendingCorrection)}.jsonl`);
      // M-9.6: an overturned row for a pending target -> two lines, red (and check 5 would refuse it).
      expect(rows).toHaveLength(1);
      expect(rows[0]!.ev).toBe("decision");
      expect(rows[0]!.question).toBe("which cache");
      expect(rows[0]!.alternatives).toEqual([{ option: "no cache", why_not: `人在 correction ${CID} 里推翻了它：a cache is needed` }]);
      expect(rows[0]!.evidence).toEqual([`correction ${CID}`, `pending ${PENDING.pendingId}`]);
      expect(closingOf(t).state).toBe("written");
    } finally { await t.h.dispose(); }
  });

  it("a non-executable human undo.how is refused by appendEvent and the correction stays open", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    const t = await debugHarness({ correction, undoHow: "revert it" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const drive = t.body(runId).drive;
      // M-9.3: writing past the refusal -> the file is in the tree, red.
      expect(inTree(t.repo, drive.landedCommit, `.decisions/${fixRunIdOf(correction)}.jsonl`)).toBe(false);
      expect(closingOf(t).state).toBe("refused");
      expect(closingOf(t).reason).toContain("downgraded to tier 0, this decision is not the agent's to make");
      expect(LANDED).toContain(t.body(runId).state);
      expect(git(t.repo, "show", `${drive.landedCommit}:a`)).toBe("a");
    } finally { await t.h.dispose(); }
  });

  it("chose_instead missing leaves the correction open", async () => {
    const correction = decisionCorrection();
    const t = await debugHarness({ correction }, { debug: () => ({ reproCommand: "true" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      expect(closingOf(t)).toEqual({ state: "chose-instead-missing" });
      expect(inTree(t.repo, t.body(runId).drive.landedCommit, `.decisions/${fixRunIdOf(correction)}.jsonl`)).toBe(false);
    } finally { await t.h.dispose(); }
  });

  // Ruling 2 (C14): a debug value the schema refuses is no value at all, not a source of choseInstead.
  it("a malformed debug result gives no choseInstead", async () => {
    const correction = decisionCorrection();
    const t = await debugHarness({ correction }, { debug: () => ({ choseInstead: "from a malformed value", unknownKey: 1 }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      expect(closingOf(t)).toEqual({ state: "chose-instead-missing" });
    } finally { await t.h.dispose(); }
  });

  // Review Focus 5, ruling C1 (b): the integration target (HEAD for a group with no target ref) already holds the rows.
  it("already closed by hand on the target writes nothing", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    let closedAt: string | null = null;
    // At collect, after A2 made the group branch from main: only the target holds the human's rows.
    const t = await debugHarness({ correction }, { duringCollect: async () => {
      closedAt ??= commitFiles(t.repo, { [`.decisions/${fixRunIdOf(correction)}.jsonl`]: jsonl(...humanClosingRows(correction)) }, "orca correct --close");
    } }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const landed = t.body(runId).drive.landedCommit;
      // M-9.5: the check dropped -> the landing writes a second closing, red.
      expect(inTree(t.repo, landed, `.decisions/${fixRunIdOf(correction)}.jsonl`)).toBe(false);
      expect(closingOf(t)).toEqual({ state: "closed-by-human-first", commit: closedAt });
    } finally { await t.h.dispose(); }
  });

  // Ruling C1 (b) with a real target ref (fix round 1): the group's `local` integration names refs/heads/main, the
  // person's checkout is on another branch lacking the rows, and only main holds them. HEAD would say "not closed".
  it("already closed by hand on the integration target ref writes nothing", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    let closedAt: string | null = null;
    const t = await debugHarness({ correction }, { duringCollect: async () => {
      if (closedAt !== null) return;
      closedAt = commitFiles(t.repo, { [`.decisions/${fixRunIdOf(correction)}.jsonl`]: jsonl(...humanClosingRows(correction)) }, "orca correct --close");
      git(t.repo, "checkout", "-q", "side");
      // After A2, so the integration pass has had nothing to integrate; trigger `group`, so a landed task starts none.
      const row = t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!;
      const integration = newGroupIntegration({ delivery: "local", trigger: "group", method: "merge", target: "main" });
      t.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...JSON.parse(String(row.body)), integration }));
    } }); try {
      git(t.repo, "branch", "side");
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "landed");
      expect(git(t.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/side");
      expect(inTree(t.repo, "HEAD", `.decisions/${fixRunIdOf(correction)}.jsonl`)).toBe(false);
      // M-9.14: `ref = "HEAD"` hard-coded -> the rows are written, red.
      expect(inTree(t.repo, t.body(runId).drive.landedCommit, `.decisions/${fixRunIdOf(correction)}.jsonl`)).toBe(false);
      expect(closingOf(t)).toEqual({ state: "closed-by-human-first", commit: closedAt });
      expect(git(t.repo, "rev-parse", "refs/heads/main")).toBe(closedAt);
    } finally { await t.h.dispose(); }
  });

  // Fix round 1 (controller accepted call 3): a mark naming no stored frozen input is store damage, not a refusal.
  it("a missing frozen input record blocks the run at D", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    const t = await debugHarness({ correction }); try {
      const hash = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).debug.inputHash;
      expect(t.h.store.db.prepare("DELETE FROM execution_snapshots WHERE hash=?").run(hash).changes).toBe(1);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const drive = t.body(runId).drive;
      expect(drive.blockedAt).toBe("D");
      expect(drive.landedCommit).toBe(null);
      expect(drive.stagedDebugClosing).toBe(null);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(drive.base);
      expect(closingOf(t)).toBe(null);
    } finally { await t.h.dispose(); }
  });

  it("a frozen input naming neither a decision nor a pending entry blocks the run at D", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    const t = await debugHarness({ correction, decision: null, pending: null }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const drive = t.body(runId).drive;
      expect(drive.blockedAt).toBe("D");
      expect(drive.blockedReason).toContain("names neither a decision nor a pending entry");
      expect(drive.landedCommit).toBe(null);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(drive.base);
      expect(closingOf(t)).toBe(null);
    } finally { await t.h.dispose(); }
  });

  // Ruling C1 (a): the landing's own tree already holds the rows; named by the landing base, and nothing is appended.
  it("already closed in the landing tree writes nothing and names the landing base", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    const path = `.decisions/${fixRunIdOf(correction)}.jsonl`;
    let removed = false;
    // A2 makes the group branch from main while main holds the rows; by collect the target has dropped them, so only
    // the landing tree holds them (with the target still holding them too, (a) and (b) could not be told apart).
    const t = await debugHarness({ correction }, { duringCollect: async () => {
      if (removed) return;
      removed = true;
      git(t.repo, "rm", "-q", path);
      git(t.repo, "commit", "-qm", "the rows leave the target");
    } }); try {
      commitFiles(t.repo, { [path]: jsonl(...humanClosingRows(correction)) }, "orca correct --close");
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const drive = t.body(runId).drive;
      expect(lines(t.repo, drive.landedCommit, path)).toHaveLength(2);
      expect(closingOf(t)).toEqual({ state: "closed-by-human-first", commit: git(t.repo, "rev-parse", `${drive.landedCommit}^1`) });
    } finally { await t.h.dispose(); }
  });

  // Ruling C1: rows on a debug group's own branch (an archived earlier group's) never count; this `g` still writes.
  it("rows only on an earlier debug group's branch do not count", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    const t = await debugHarness({ correction }); try {
      // The earlier group's branch holds the rows; main (and so this group's branch, made from it) does not.
      commitFiles(t.repo, { [`.decisions/${fixRunIdOf(correction)}.jsonl`]: jsonl(...humanClosingRows(correction)) }, "an earlier debug group's landing");
      git(t.repo, "branch", `orca/debug-${CID}`);
      git(t.repo, "reset", "-q", "--hard", "HEAD~1");
      const runId = await t.claim();
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      const rows = lines(t.repo, t.body(runId).drive.landedCommit, `.decisions/${fixRunIdOf(correction)}.jsonl`);
      expect(rows.map((row) => row.ev)).toEqual(["decision", "overturned"]);
      expect(rows[0]!.undo.how).toBe(`git revert --no-edit ${t.body(runId).drive.attemptSha}${ORCA_GENERATED}`);
      expect(closingOf(t).state).toBe("written");
    } finally { await t.h.dispose(); }
  });

  // Ruling 8 (registered limitation): check 5 resolves the original only among top-level `.decisions/*.jsonl`.
  it("an original held only in an archive subdirectory leaves the overturned row refused", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    const t = await driverHarness([{ taskId: "a" }]); try {
      commitFiles(t.repo, { ".decisions/archive/orig-run.jsonl": jsonl(ORIGINAL) }, "an archived original");
      markGroup(t, { correction });
      const driver = createExecutionDriver({ ...t.deps, checkReproduction: async () => ({ kind: "passed", tests: [], command: "true" }) });
      const runId = await t.claim();
      await t.until(driver, () => LANDED.includes(t.body(runId).state));
      expect(closingOf(t).state).toBe("refused");
      expect(closingOf(t).reason).toMatch(/^refusing to append: /);
      expect(inTree(t.repo, t.body(runId).drive.landedCommit, `.decisions/${fixRunIdOf(correction)}.jsonl`)).toBe(false);
    } finally { await t.h.dispose(); }
  });

  it("a moved-tip retry writes the closing file once", async () => {
    let moved: string | null = null;
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    const stagedAtCas: unknown[] = [];
    const t = await debugHarness({ correction }); try {
      const runId = await t.claim();
      const driver = t.driver({ beforeCas: async () => {
        stagedAtCas.push(t.body(runId).drive.stagedDebugClosing?.state);
        if (moved !== null) return;
        const old = git(t.repo, "rev-parse", "refs/heads/orca/g");
        moved = git(t.repo, "commit-tree", `${old}^{tree}`, "-p", old, "-m", "someone else");
        git(t.repo, "update-ref", "refs/heads/orca/g", moved, old);
      } });
      await t.until(driver, () => LANDED.includes(t.body(runId).state));
      const landed = t.body(runId).drive.landedCommit;
      expect(git(t.repo, "rev-parse", `${landed}^1`)).toBe(moved);
      expect(lines(t.repo, landed, `.decisions/${fixRunIdOf(correction)}.jsonl`)).toHaveLength(2);
      expect(stagedAtCas).toEqual(["written", "written"]);
      expect(closingOf(t).state).toBe("written");
    } finally { await t.h.dispose(); }
  });

  // findLanding's recovery skips produce, so only the record staged before the swap can reach the mark.
  it("a death after the swap still copies the staged closing record when the landing is found", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    const t = await debugHarness({ correction }); try {
      const runId = await t.claim();
      const crashing = t.driver({ crash: (point) => { if (point === "D-after-cas") throw new DriverCrash(point); } });
      await t.until(crashing, () => crashing.crashed === "D-after-cas");
      expect(t.body(runId).state).toBe("collected");
      expect(closingOf(t)).toBe(null);
      await t.until(t.driver(), () => LANDED.includes(t.body(runId).state));
      expect(closingOf(t)).toEqual({ state: "written", relPath: `.decisions/${fixRunIdOf(correction)}.jsonl`, fixRunId: fixRunIdOf(correction) });
      expect(lines(t.repo, t.body(runId).drive.landedCommit, `.decisions/${fixRunIdOf(correction)}.jsonl`)).toHaveLength(2);
    } finally { await t.h.dispose(); }
  });

  it("parses a drive record from before stagedDebugClosing, as null", () => {
    const old = {
      workspaceMode: "worktree", sourceDir: "/x/state.runs/r", workspacePath: "/x/state.workspaces/r", targetRepo: null,
      prepared: false, base: null, envelopeHash: null, inspectUnknown: 0, outcome: null, attemptSha: null, landedCommit: null,
      reconcile: null, blockedAt: null, blockedReason: null, cleanedUp: false,
    };
    expect(driveRecordSchema.parse(old).stagedDebugClosing).toBe(null);
    expect(driveRecordSchema.parse({ ...old, stagedDebugClosing: { state: "chose-instead-missing" } }).stagedDebugClosing).toEqual({ state: "chose-instead-missing" });
  });
});

// The reconciliation is a background process, so its progress is wall-clock time (driverReconcileDecisions.test.ts).
async function untilDeadline(driver: ExecutionDriver, predicate: () => boolean, deadlineMs = 20_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await driver.round();
  }
  if (!predicate()) throw new Error("the driver did not reach the expected state before the deadline");
}

describe("the same through finishReconcile (plan Task 9)", { timeout: 60_000 }, () => {
  it("the reconciled landing commit holds the closing file", async () => {
    const correction = decisionCorrection();
    const conflicting = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }];
    const t = await driverHarness(conflicting, {
      files: (id) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" }), debug: () => ({ choseInstead: "a file lease" }),
    }); try {
      commitFiles(t.repo, { ".decisions/orig-run.jsonl": jsonl(ORIGINAL) }, "the original decision");
      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
      const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
      const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 10_000_000 } }));
      if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
      const ids = [await t.claim(), await t.claim()];
      const reconciled = () => ids.find((id) => t.body(id).drive?.reconcile != null);
      const driver = t.driver();
      // The first run lands through D before the group is marked, so only the reconciled landing closes the correction.
      await untilDeadline(driver, () => reconciled() !== undefined);
      markGroup(t, { correction });
      await untilDeadline(driver, () => ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      const runId = reconciled()!;
      const drive = t.body(runId).drive;
      expect(LANDED).toContain(t.body(runId).state);
      const rows = lines(t.repo, drive.landedCommit, `.decisions/${fixRunIdOf(correction)}.jsonl`);
      // M-9.4: finishReconcile's contribution skipped -> no such file, red.
      expect(rows.map((row) => row.ev)).toEqual(["decision", "overturned"]);
      expect(rows[1]!.correctionId).toBe(CID);
      expect(rows[0]!.undo.how).toBe(`git revert --no-edit ${drive.attemptSha}${ORCA_GENERATED}`);
      expect(git(t.repo, "show", `${drive.landedCommit}:shared.txt`)).toBe("A\nB");
      expect(closingOf(t).state).toBe("written");
      expect(existsSync(join(t.repo, ".decisions", `${fixRunIdOf(correction)}.jsonl`))).toBe(false);
    } finally { await t.h.dispose(); }
  });

  // Fix round 1: a moved tip at R's swap sends the run back to collected and it reconciles again on the new tip; the
  // first attempt's closing rows lived only in a merge that never landed.
  it("a moved-tip retry of a reconciled landing writes the closing file once", async () => {
    const correction = decisionCorrection({ chose_instead: "a file lease" });
    const conflicting = [{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }];
    let moved: string | null = null;
    const t = await driverHarness(conflicting, { files: (id) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" }) }); try {
      commitFiles(t.repo, { ".decisions/orig-run.jsonl": jsonl(ORIGINAL) }, "the original decision");
      await writeFile(t.deps.agentsTablePath, JSON.stringify({ status: "succeeded", spent: 7, holdMs: 0, files: { "shared.txt": "A\nB\n" } }));
      const limit = readControlGroup(t.h.store, "epoch-test", "g").ledger.groupLimit;
      const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, tokens: limit.tokens! + 10_000_000 } }));
      if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
      const ids = [await t.claim(), await t.claim()];
      const reconciled = () => ids.find((id) => t.body(id).drive?.reconcile != null);
      const driver = createExecutionDriver({ ...t.deps, beforeCas: async () => {
        if (moved !== null || !ids.some((id) => t.body(id).state === "reconciling")) return;
        const old = git(t.repo, "rev-parse", "refs/heads/orca/g");
        moved = git(t.repo, "commit-tree", `${old}^{tree}`, "-p", old, "-m", "someone else");
        git(t.repo, "update-ref", "refs/heads/orca/g", moved, old);
      } });
      await untilDeadline(driver, () => reconciled() !== undefined);
      markGroup(t, { correction });
      await untilDeadline(driver, () => ids.every((id) => [...LANDED, "blocked"].includes(t.body(id).state)));
      const runId = reconciled()!;
      const landed = t.body(runId).drive.landedCommit;
      expect(moved).not.toBeNull();
      // Two reconciliation spawns: the second finishReconcile is the one that landed.
      expect(readFileSync(`${t.deps.agentsTablePath}.runs`, "utf8").trim().split("\n")).toHaveLength(2);
      expect(git(t.repo, "rev-parse", `${landed}^1`)).toBe(moved);
      expect(lines(t.repo, landed, `.decisions/${fixRunIdOf(correction)}.jsonl`).map((row) => row.ev)).toEqual(["decision", "overturned"]);
      expect(closingOf(t).state).toBe("written");
      expect(t.body(runId).drive.stagedDebugClosing).toBe(null);
    } finally { await t.h.dispose(); }
  });
});
