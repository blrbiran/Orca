import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectDebugInput, debugDiffArgs, debugDiffCommand, debugRunIdOf, DEBUG_INPUT_SCHEMA } from "../../src/control/debugInput.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { insertPendingDecisions, readPendingDecision } from "../../src/control/pendingDecisions.js";
import { pendingIdOf, type PendingEntry } from "../../src/control/runLedger.js";
import { DECISION_NOT_FOUND } from "../../src/corrections/originalDecision.js";
import type { Correction } from "../../src/corrections/schema.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import { unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { FIXTURE_AGENT, webFixture } from "./fixtures/web.js";

// Debug task Task 3: the evidence for one correction, frozen. Each assertion reads what collectDebugInput returned for a
// repository and a control store built here; git facts are read back with `git show`, not from the code under test.
const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...unsetInheritedGitEnv(), ...options.env } }).trim();

/** A commit on `ref` (child of `from`) whose tree is its parent's with `files` written, by plumbing; HEAD is untouched. */
function commitOn(repo: string, ref: string, files: Record<string, string>, message: string, from = ref): string {
  const parent = g(repo, ["rev-parse", from]);
  const env = { GIT_INDEX_FILE: join(repo, ".git", `orca-test-index-${process.pid}`) };
  g(repo, ["read-tree", parent], { env });
  for (const [path, text] of Object.entries(files)) {
    const blob = g(repo, ["hash-object", "-w", "--stdin"], { input: text });
    g(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
  }
  const tree = g(repo, ["write-tree"], { env });
  const commit = g(repo, ["commit-tree", tree, "-p", parent, "-m", message]);
  g(repo, ["update-ref", ref, commit]);
  return commit;
}

const RUN = "run-1";
const decision = (id: string): DecisionEvent => ({
  ev: "decision", id, at: "2026-10-18T00:00:00.000Z", run: id.split("/")[0]!, question: "which lock", chose: "in-process mutex",
  alternatives: [{ option: "file lease", why_not: "too heavy" }], because: "fastest",
  undo: { how: "git revert x", cost: "one repo", blast_radius: "one repo" }, scope: "repo", kind: "interface",
});
const ledger = (...ids: string[]) => ids.map((id) => JSON.stringify(decision(id))).join("\n") + "\n";
const correctionOf = (target: { decisionId: string } | { runId: string; pendingId: string }): Correction => ({
  id: "c_0", projectKey: "example.invalid/o/r", kind: "wrong", because: "the facts were wrong", at: "2026-10-18T00:00:00.000Z", by: "owner@example.invalid", ...target,
} as Correction);

/**
 * Group `g` (task `a`, contract archived) over a real git repo: `base` -> `attempt` (adds a.txt and a ledger file) ->
 * `landed` (a merge-like commit that also adds other.txt). The integration target `main` holds the run's ledger; the
 * working tree sits on branch `work` at `base`, which does not, so a decision found there is found at the target.
 */
async function world(options: { attemptSha?: string } = {}) {
  const h = await webFixture(); 
  const repo = join(h.root, "repo");
  g(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "base.txt"), "base\n");
  g(repo, ["add", "base.txt"]); g(repo, ["commit", "-qm", "base"]);
  const base = g(repo, ["rev-parse", "HEAD"]);
  const attempt = commitOn(repo, "refs/heads/attempt", { "a.txt": "a\n", ".decisions/run-1.jsonl": ledger(`${RUN}/agent-0`) }, "attempt", "main");
  const landed = commitOn(repo, "refs/heads/landed", { "other.txt": "from another task\n" }, "landed", "attempt");
  commitOn(repo, "refs/heads/main", { ".decisions/run-1.jsonl": ledger(`${RUN}/agent-0`, `reconcile-${RUN}/1`) }, "ledger on target", "main");
  g(repo, ["checkout", "-q", "-b", "work", base]);
  const groupBody = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({
    ...groupBody, integration: newGroupIntegration({ delivery: "local", trigger: "task", method: "merge", target: "main" }) }));
  const runBody = {
    runId: RUN, groupId: "g", workItemId: "a", taskId: "a", generation: 1, graphVersion: 1, targetVersion: 1, state: "settled",
    agent: FIXTURE_AGENT, configHash: "config-hash-1",
    drive: { base, attemptSha: options.attemptSha ?? attempt, landedCommit: landed },
  };
  h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,0,?)").run(RUN, "g", "a", 1, JSON.stringify(runBody));
  return { ...h, repo, base, attempt, landed, deps: { store: h.store, repoPath: repo } };
}

const pendingEntry = (ledgerRun: string, entryIndex: number): PendingEntry => ({
  pendingId: pendingIdOf(ledgerRun, entryIndex), ledgerRun, entryIndex, entry: { kind: "x", n: entryIndex }, reason: "refused", at: "2026-10-18T00:00:00.000Z", evidence: ["run run-1"],
});

describe("debugRunIdOf (debug task Task 3)", () => {
  it("reads a ledger run, strips a reconcile prefix, and takes a pending target's control run as is", () => {
    expect(debugRunIdOf({ kind: "decision", decisionId: "run-1/agent-0" })).toBe("run-1");
    expect(debugRunIdOf({ kind: "decision", decisionId: "reconcile-run-1/1" })).toBe("run-1");
    expect(debugRunIdOf({ kind: "pending", runId: "run-1", pendingId: "pending-reconcile-run-1-0" })).toBe("run-1");
  });
});

describe("the diff command is spelled once", () => {
  it("has an argument form and a display form that agree", () => {
    expect(debugDiffArgs("b", "a")).toEqual(["diff", "--no-color", "b", "a", "--", ".", ":(exclude).decisions"]);
    expect(debugDiffCommand("b", "a")).toBe("git diff --no-color b a -- . ':(exclude).decisions'");
  });
});

describe("collectDebugInput (debug task Task 3)", () => {
  it("freezes correction, decision, diff and contract for a control-run decision", async () => {
    const w = await world(); try {
      const correction = correctionOf({ decisionId: `${RUN}/agent-0` });
      const input = await collectDebugInput(w.deps, correction);
      expect(input.schema).toBe(DEBUG_INPUT_SCHEMA);
      expect(input.correction).toEqual(correction);
      expect(input.decision!.id).toBe(`${RUN}/agent-0`);
      // The working tree is on `work` at the base commit and holds no ledger; the integration target does.
      expect(g(w.repo, ["ls-tree", "-r", "--name-only", "HEAD"])).toBe("base.txt");
      expect(input.decisionWhere).toBe("target");
      expect(input.commits).toMatchObject({ base: w.base, attemptSha: w.attempt });
      expect(input.commits!.diff).toContain("a.txt");
      expect(input.commits!.diff).not.toContain(".decisions/");
      // The attempt commit really does carry the ledger file the diff leaves out.
      expect(g(w.repo, ["show", `${w.attempt}:.decisions/run-1.jsonl`])).toContain(`${RUN}/agent-0`);
      expect(input.contract!.objective.taskId).toBe("a");
      expect(input.originalRun).toEqual({ runId: RUN, groupId: "g", taskId: "a", agent: FIXTURE_AGENT, configHash: "config-hash-1" });
      expect(input.pending).toBeNull();
      expect(input.missing).toEqual([]);
      // The frozen record is plain JSON: a round trip changes nothing.
      expect(JSON.parse(JSON.stringify(input))).toEqual(input);
    } finally { await w.dispose(); }
  });

  it("uses base..attemptSha, not base..landedCommit", async () => {
    const w = await world(); try {
      expect(g(w.repo, ["show", `${w.landed}:other.txt`])).toBe("from another task");
      const input = await collectDebugInput(w.deps, correctionOf({ decisionId: `${RUN}/agent-0` }));
      expect(input.commits!.diff).not.toContain("other.txt");
    } finally { await w.dispose(); }
  });

  it("finds a decision in the working tree first when the checkout holds it", async () => {
    const w = await world(); try {
      await mkdir(join(w.repo, ".decisions"));
      await writeFile(join(w.repo, ".decisions", "run-1.jsonl"), ledger(`${RUN}/agent-0`));
      expect((await collectDebugInput(w.deps, correctionOf({ decisionId: `${RUN}/agent-0` }))).decisionWhere).toBe("working-tree");
    } finally { await w.dispose(); }
  });

  it("refuses a decision no source holds, by the existing decision-not-found code", async () => {
    const w = await world(); try {
      await expect(collectDebugInput(w.deps, correctionOf({ decisionId: `${RUN}/agent-9` })))
        .rejects.toMatchObject({ name: "CorrectRejection", code: DECISION_NOT_FOUND });
    } finally { await w.dispose(); }
  });

  it("a scheduler-era run id has no run", async () => {
    const w = await world(); try {
      const id = "orca-x-1a2b3c4d/1";
      await mkdir(join(w.repo, ".decisions"));
      await writeFile(join(w.repo, ".decisions", "orca-x-1a2b3c4d.jsonl"), ledger(id));
      const input = await collectDebugInput(w.deps, correctionOf({ decisionId: id }));
      expect(input.originalRun).toBeNull();
      expect(input.commits).toBeNull();
      expect(input.contract).toBeNull();
      expect(input.missing).toEqual(["run"]);
      expect(input.decision!.id).toBe(id);
      expect(input.decisionWhere).toBe("working-tree");
    } finally { await w.dispose(); }
  });

  it("unreachable objects are omitted and named", async () => {
    const w = await world({ attemptSha: "f".repeat(40) }); try {
      const input = await collectDebugInput(w.deps, correctionOf({ decisionId: `${RUN}/agent-0` }));
      expect(input.commits).toBeNull();
      expect(input.missing).toContain("objects");
      // The rest of the evidence is still frozen.
      expect(input.contract!.objective.taskId).toBe("a");
    } finally { await w.dispose(); }
  });

  it("a run body without a drive record names base and attemptSha", async () => {
    const w = await world(); try {
      const row = w.store.db.prepare("SELECT body FROM runs WHERE id=?").get(RUN)!;
      const { drive: _drive, ...rest } = JSON.parse(String(row.body)) as Record<string, unknown>;
      w.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(rest), RUN);
      const input = await collectDebugInput(w.deps, correctionOf({ decisionId: `${RUN}/agent-0` }));
      expect(input.commits).toBeNull();
      expect(input.missing).toEqual(["base", "attemptSha"]);
    } finally { await w.dispose(); }
  });

  it("a pending target carries the pending entry", async () => {
    const w = await world(); try {
      w.store.transaction(() => insertPendingDecisions(w.store, "g", RUN, [pendingEntry(RUN, 0)]));
      const input = await collectDebugInput(w.deps, correctionOf({ runId: RUN, pendingId: `pending-${RUN}-0` }));
      expect(input.pending).toEqual(readPendingDecision(w.store, `pending-${RUN}-0`)!.entry);
      expect(input.pending).not.toBeNull();
      expect(input.decision).toBeNull();
      expect(input.decisionWhere).toBeNull();
      expect(input.originalRun!.runId).toBe(RUN);
    } finally { await w.dispose(); }
  });

  it("refuses a pending target whose row is gone", async () => {
    const w = await world(); try {
      await expect(collectDebugInput(w.deps, correctionOf({ runId: RUN, pendingId: `pending-${RUN}-0` })))
        .rejects.toMatchObject({ name: "CorrectRejection", code: "original-pending-decision-not-found" });
    } finally { await w.dispose(); }
  });

  it("a reconcile decision resolves to the reconciled run", async () => {
    const w = await world(); try {
      const input = await collectDebugInput(w.deps, correctionOf({ decisionId: `reconcile-${RUN}/1` }));
      expect(input.originalRun!.runId).toBe(RUN);
      expect(input.decision!.id).toBe(`reconcile-${RUN}/1`);
    } finally { await w.dispose(); }
  });
});
