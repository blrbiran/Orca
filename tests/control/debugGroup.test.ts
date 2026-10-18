import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyArchiveGroup } from "../../src/control/archiveGroup.js";
import { lookupCommandResult } from "../../src/control/commandLedger.js";
import { collectDebugInput, DEBUG_INPUT_SCHEMA, type DebugInputV1 } from "../../src/control/debugInput.js";
import { archiveUnstartedDebugGroups, debugGroupIdFor, debugGroupIds, liveDebugGroups, readDebugMark } from "../../src/control/debugGroup.js";
import { ControlError, durableCommandErrorStatuses } from "../../src/control/errors.js";
import { ESTIMATE_GRANT, GOAL_REVIEW, TASK_HANDOFF, TASK_WORK } from "../../src/control/estimator.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { insertPendingDecisions } from "../../src/control/pendingDecisions.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { pendingIdOf } from "../../src/control/runLedger.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { WebControlService } from "../../src/control/webService.js";
import { unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { deriveFixRunId } from "../../src/corrections/fields.js";
import { correctionsFile } from "../../src/corrections/paths.js";
import { projectKeyOf } from "../../src/corrections/projectKey.js";
import { correctionRowFrom, recordNewCorrection } from "../../src/corrections/record.js";
import type { Correction } from "../../src/corrections/schema.js";
import { withdrawCorrection } from "../../src/corrections/withdrawals.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import { registerControlReadRoutes, verifyControlJsonBody } from "../../src/panel/controlApi.js";
import { readGroupSummary } from "../../src/panel/controlViews.js";
import type { Principal } from "../../src/panel/permissions.js";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { claimContinuation } from "../../src/control/continuation.js";
import { createExecutionDriver } from "../../src/control/executionDriver.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import { FAKE_CCLOOP_RUN } from "./fixtures/driverHarness.js";
import { fakeCcloopPort } from "./fixtures/driverPort.js";
import { DEBUG_DEFAULT_BUILD_TEST_COMMANDS } from "../../src/control/debugPlan.js";
import { FIXTURE_AGENT, profileSnapshot, webFixture } from "./fixtures/web.js";

// Debug task plan Task 6: `correction-debug-open`. Every assertion reads the control store, a route's answer or git;
// the corrections store is a directory under the fixture's temp root (ORCA_CORRECTIONS_DIR points there, Rule 17).
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
  const commit = g(repo, ["commit-tree", g(repo, ["write-tree"], { env }), "-p", parent, "-m", message]);
  g(repo, ["update-ref", ref, commit]);
  return commit;
}

const RUN = "run-1";
const DECISION_ID = `${RUN}/agent-0`;
const decision = (id: string): DecisionEvent => ({
  ev: "decision", id, at: "2026-10-18T00:00:00.000Z", run: id.split("/")[0]!, question: "which lock", chose: "in-process mutex",
  alternatives: [{ option: "file lease", why_not: "too heavy" }], because: "fastest",
  undo: { how: "git revert x", cost: "one repo", blast_radius: "one repo" }, scope: "repo", kind: "interface",
});
const ledger = (...ids: string[]) => ids.map((id) => JSON.stringify(decision(id))).join("\n") + "\n";
const BY = "owner@example.invalid";

/** Where the original decision's ledger line is: HEAD (main, checked out), or only one of the places HEAD lacks. */
type LedgerAt = "head" | "target-not-head" | "working-tree" | "group-branch";

afterEach(() => { vi.unstubAllEnvs(); });

/**
 * Group `g` (task `a`) ran `run-1` (agent codex) over a real repo with a remote; its attempt added a.txt and the
 * decision's ledger line. The operator's default agent is claude, so the original agent differs from it.
 */
async function world(options: { ledgerAt?: LedgerAt; port?: (base: ExecutionPort) => ExecutionPort; listRepositories?: boolean; correctionsDir?: boolean; before?: Array<{ repoId: string; path: string }> } = {}) {
  const h = await webFixture(undefined, [{ taskId: "a" }], { preferences: { defaultAgent: "claude", perAgent: {} } });
  const repo = join(h.root, "repo");
  g(repo, ["init", "-q", "-b", "main"]);
  g(repo, ["remote", "add", "origin", "https://example.invalid/o/r.git"]);
  await writeFile(join(repo, "base.txt"), "base\n");
  await mkdir(join(repo, "tests")); await writeFile(join(repo, "tests", "keep.txt"), "\n");
  g(repo, ["add", "base.txt", "tests/keep.txt"]); g(repo, ["commit", "-qm", "base"]);
  const base = g(repo, ["rev-parse", "HEAD"]);
  const ledgerAt = options.ledgerAt ?? "head";
  const attempt = commitOn(repo, "refs/heads/attempt", { "a.txt": "a\n" }, "attempt", "main");
  const line = { ".decisions/run-1.jsonl": ledger(DECISION_ID) };
  if (ledgerAt === "head" || ledgerAt === "target-not-head") commitOn(repo, "refs/heads/main", line, "ledger on target", "main");
  if (ledgerAt === "group-branch") commitOn(repo, "refs/heads/orca/g", line, "ledger on group branch", "main");
  if (ledgerAt === "head") g(repo, ["reset", "-q", "--hard", "main"]);
  else g(repo, ["checkout", "-q", "-b", "work", base]);
  if (ledgerAt === "working-tree") { await mkdir(join(repo, ".decisions")); await writeFile(join(repo, ".decisions", "run-1.jsonl"), ledger(DECISION_ID)); }
  const groupBody = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({
    ...groupBody, integration: newGroupIntegration({ delivery: "local", trigger: "task", method: "merge", target: "main" }) }));
  h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,0,?)").run(RUN, "g", "a", 1, JSON.stringify({
    runId: RUN, groupId: "g", workItemId: "a", taskId: "a", generation: 1, graphVersion: 1, targetVersion: 1, state: "settled",
    agent: FIXTURE_AGENT, configHash: "config-hash-1", drive: { base, attemptSha: attempt, landedCommit: attempt },
  }));
  const dir = join(h.root, "corrections");
  await mkdir(dir, { mode: 0o700 });
  vi.stubEnv("ORCA_CORRECTIONS_DIR", dir);
  const projectKey = await projectKeyOf(repo);
  let clock = Date.parse("2026-10-18T01:00:00.000Z");
  const record = async (target: { decisionId: string } | { runId: string; pendingId: string }): Promise<Correction> =>
    recordNewCorrection(dir, correctionRowFrom({ projectKey, ...target, kind: "wrong", because: "the premise was false", by: BY }, () => new Date(clock += 1000)), { again: false });
  const correction = await record({ decisionId: DECISION_ID });
  const service = new WebControlService({
    ...h.deps, ...(options.port === undefined ? {} : { port: options.port(h.deps.port) }),
    ...(options.correctionsDir === false ? {} : { correctionsDir: dir }), correctionsBy: BY,
    ...(options.listRepositories === false ? {} : { listRepositories: () => [...(options.before ?? []), { repoId: "repo", path: repo }] }),
  });
  let sequence = 0;
  const revisionOf = (groupId: string) => Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)?.revision ?? 0);
  /** The open as the route sends it: the target its resolver names, at that group's current revision. */
  const openCommand = (correctionId: string, payload: { reopen?: boolean; undoHow?: string } = {}, commandId = `open-${++sequence}`) => {
    const groupId = debugGroupIdFor(h.store, correctionId, payload.reopen === true);
    return { schema: "orca-raw-command-v1" as const, commandId, actorId: "human", expectedRevision: revisionOf(groupId), verb: "correction-debug-open" as const,
      target: { kind: "group" as const, groupId }, payload: { correctionId, ...payload } };
  };
  const open = (correctionId: string, payload: { reopen?: boolean; undoHow?: string } = {}) => service.openCorrectionDebugGroup(openCommand(correctionId, payload));
  const storeBytes = () => readFile(correctionsFile(dir), "utf8");
  const body = (groupId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
  const groupCount = (correctionId: string) => Number(h.store.db.prepare("SELECT COUNT(*) AS n FROM groups WHERE substr(id,1,?)=?").get(`debug-${correctionId}`.length, `debug-${correctionId}`)!.n);
  return { ...h, repo, base, attempt, dir, correction, record, service, openCommand, open, storeBytes, body, revisionOf, groupCount };
}
type World = Awaited<ReturnType<typeof world>>;

const opened = (result: unknown) => (result as { result: { kind: string; groupId: string; correctionId: string; created: boolean } }).result;
const refusal = (result: unknown) => (result as { error?: { code: string } }).error?.code;

describe("correction-debug-open (debug task Task 6)", () => {
  it("opens one group whose frozen plan holds the correction, decision, diff and contract", async () => {
    const w = await world(); try {
      const cid = w.correction.id;
      const result = await w.open(cid, { undoHow: "git revert --no-edit HEAD" });
      expect(opened(result)).toEqual({ kind: "debug-group-opened", groupId: `debug-${cid}`, correctionId: cid, created: true });
      const plan = readArchivedPlan(w.store, `debug-${cid}`).plan;
      expect(plan.repoId).toBe("repo");
      const contract = plan.tasks[0]!.originalContractCanonicalJson;
      expect(contract).toContain(DECISION_ID);
      // The diff's changed path, as git records it for the attempt.
      expect(g(w.repo, ["diff", "--name-only", w.base, w.attempt])).toBe("a.txt");
      expect(contract).toContain("+++ b/a.txt");
      // The test directory that exists at the root is in the write set.
      expect(JSON.parse(contract).context.targetPaths).toContain("tests/**");
      const mark = readDebugMark(w.body(`debug-${cid}`))!;
      expect(mark).toMatchObject({ correctionId: cid, ordinal: 1, missing: [], agentFallback: null, undoHow: "git revert --no-edit HEAD", closing: null });
      const frozen = JSON.parse(readCanonicalRecord(w.store, mark.inputHash)) as DebugInputV1;
      expect(frozen.schema).toBe(DEBUG_INPUT_SCHEMA);
      expect(frozen).toEqual(await collectDebugInput({ store: w.store, repoPath: w.repo }, w.correction));
      // Read through the command path: the group is at revision 1 with a projection, and its summary names the mark.
      expect(readGroupSummary(w.store, `debug-${cid}`)).toMatchObject({ commandRevision: 1, debug: { correctionId: cid, ordinal: 1 } });
    } finally { await w.dispose(); }
  });

  it("opening again returns the same group", async () => {
    const w = await world(); try {
      const cid = w.correction.id;
      const first = w.openCommand(cid);
      const created = await w.service.openCorrectionDebugGroup(first);
      expect(await w.service.openCorrectionDebugGroup(first)).toEqual(created);
      const again = await w.open(cid);
      expect(opened(again)).toEqual({ kind: "debug-group-opened", groupId: `debug-${cid}`, correctionId: cid, created: false });
      expect(w.groupCount(cid)).toBe(1);
      // Returned unchanged: no revision bump.
      expect(w.revisionOf(`debug-${cid}`)).toBe(1);
    } finally { await w.dispose(); }
  });

  it("opening spends nothing", async () => {
    const w = await world(); try {
      const wakes = () => Number(w.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes").get()!.n);
      const before = wakes();
      const gid = opened(await w.open(w.correction.id)).groupId;
      expect(Number(w.store.db.prepare("SELECT COUNT(*) AS n FROM estimates WHERE group_id=?").get(gid)!.n)).toBe(0);
      expect(wakes()).toBe(before);
      // The non-queued reserve: the goal review and the one task, no estimate grant.
      const committed = (w.body(gid).ledger as { committedRemaining: Record<string, number> }).committedRemaining;
      expect(committed.tokens).toBe(GOAL_REVIEW.tokens);
      expect(committed.activeMs).toBe(GOAL_REVIEW.activeMs + TASK_WORK.activeMs + TASK_HANDOFF.activeMs);
      expect(committed.activeMs).not.toBe(GOAL_REVIEW.activeMs + TASK_WORK.activeMs + TASK_HANDOFF.activeMs + ESTIMATE_GRANT.activeMs);
    } finally { await w.dispose(); }
  });

  it("agent default = the original claim's agent and model", async () => {
    const w = await world(); try {
      expect(FIXTURE_AGENT.agent).toBe("codex");
      const gid = opened(await w.open(w.correction.id)).groupId;
      expect(readArchivedPlan(w.store, gid).plan.agent).toEqual({ agent: "codex", model: FIXTURE_AGENT.model });
      expect(readDebugMark(w.body(gid))!.agentFallback).toBeNull();
    } finally { await w.dispose(); }
  });

  it("an unresolvable original agent falls back to the operator default and says why", async () => {
    const w = await world({ port: (base) => ({ ...base, resolveAgent: async (partial) => {
      if (partial.agent === "codex") throw new ControlError("agent-installation-missing", "codex");
      return base.resolveAgent(partial);
    } }) }); try {
      const gid = opened(await w.open(w.correction.id)).groupId;
      expect(readArchivedPlan(w.store, gid).plan.agent).toBeUndefined();
      const fallback = readDebugMark(w.body(gid))!.agentFallback!;
      expect(fallback.original).toEqual({ agent: "codex", model: FIXTURE_AGENT.model });
      expect(fallback.reason).toContain("agent-installation-missing");
    } finally { await w.dispose(); }
  });
});

describe("correction-debug-open's refusals leave the corrections store and the control store unchanged", () => {
  /** The refusal's code, booked; no group of the correction exists afterwards; the store's bytes are those read before. */
  async function refused(w: World, code: string, correctionId = w.correction.id): Promise<void> {
    const before = await w.storeBytes();
    const command = w.openCommand(correctionId);
    const answer = await w.service.openCorrectionDebugGroup(command);
    expect(refusal(answer)).toBe(code);
    expect(lookupCommandResult(w.store, command.target.groupId, command.commandId)!.body).toMatchObject({ error: { code } });
    // Booked: the same command replays the same answer.
    expect(await w.service.openCorrectionDebugGroup(command)).toEqual(answer);
    expect(w.groupCount(correctionId)).toBe(0);
    expect(await w.storeBytes()).toBe(before);
  }

  it("refuses a closed correction: the integration target holds its closing row", async () => {
    const w = await world(); try {
      const { id, ...row } = w.correction;
      const fixRunId = deriveFixRunId(row, id);
      commitOn(w.repo, "refs/heads/main", { [`.decisions/${fixRunId}.jsonl`]: JSON.stringify({ ev: "decision", id: `${fixRunId}/1`, evidence: [`correction ${id}`, `overturns ${DECISION_ID}`] }) + "\n" }, "closing row", "main");
      await refused(w, "correction-already-closed");
    } finally { await w.dispose(); }
  });

  it("does not count a closing row only on a debug group's own branch", async () => {
    const w = await world(); try {
      const { id, ...row } = w.correction;
      const fixRunId = deriveFixRunId(row, id);
      commitOn(w.repo, `refs/heads/orca/debug-${id}`, { [`.decisions/${fixRunId}.jsonl`]: JSON.stringify({ ev: "decision", id: `${fixRunId}/1`, evidence: [`correction ${id}`] }) + "\n" }, "closing row on the group branch", "main");
      expect(opened(await w.open(id)).created).toBe(true);
    } finally { await w.dispose(); }
  });

  it("refuses an unknown repository", async () => {
    const w = await world({ listRepositories: false }); try { await refused(w, "correction-repository-unknown"); } finally { await w.dispose(); }
  });

  it.each(["target-not-head", "working-tree", "group-branch"] as const)("refuses a decision HEAD's ledger lacks (%s)", async (ledgerAt) => {
    const w = await world({ ledgerAt }); try {
      expect(g(w.repo, ["ls-tree", "-r", "--name-only", "HEAD"]).split("\n")).not.toContain(".decisions/run-1.jsonl");
      await refused(w, "correction-decision-not-integrated");
    } finally { await w.dispose(); }
  });

  it("refuses a withdrawn correction before its input is frozen", async () => {
    const w = await world(); try {
      await withdrawCorrection(w.dir, { correctionId: w.correction.id, by: BY, at: "2026-10-18T02:00:00.000Z", isClosed: () => false });
      await refused(w, "correction-withdrawn");
    } finally { await w.dispose(); }
  });

  it("refuses, booked, when the withdrawals file has a line that does not parse", async () => {
    const w = await world(); try {
      await writeFile(join(w.dir, "correction-withdrawals.jsonl"), "not json\n", { mode: 0o600 });
      await refused(w, "correction-withdrawals-unreadable");
    } finally { await w.dispose(); }
  });

  it("skips a configured repository with no keyable remote listed before the right one", async () => {
    const w0 = await webFixture(); const bare = join(w0.root, "bare"); await mkdir(bare); g(bare, ["init", "-q"]);
    const w = await world({ before: [{ repoId: "bare", path: bare }] }); try {
      expect(opened(await w.open(w.correction.id))).toMatchObject({ created: true });
      expect(readArchivedPlan(w.store, `debug-${w.correction.id}`).plan.repoId).toBe("repo");
    } finally { await w.dispose(); await w0.dispose(); }
  });

  it("matches the repository by the panel's own key first", async () => {
    const w = await world(); try {
      const panelKeyed = new WebControlService({ ...w.deps, correctionsDir: w.dir, correctionsBy: BY,
        listRepositories: () => [{ repoId: "other", path: w.repo }, { repoId: "repo", path: w.repo }], repoIdOfProjectKey: (key) => (key === "mykey" ? "repo" : `x-${key}`) });
      const mine = await recordNewCorrection(w.dir, correctionRowFrom({ projectKey: "mykey", decisionId: DECISION_ID, kind: "stale", because: "panel-recorded", by: BY }, () => new Date("2026-10-18T03:00:00.000Z")), { again: false });
      const command = { ...w.openCommand(mine.id) };
      expect(opened(await panelKeyed.openCorrectionDebugGroup(command))).toMatchObject({ created: true });
      expect(readArchivedPlan(w.store, `debug-${mine.id}`).plan.repoId).toBe("repo");
    } finally { await w.dispose(); }
  });

  it("refuses an id the store does not hold", async () => {
    const w = await world(); try { await refused(w, "correction-not-found", "c_0000000000000000"); } finally { await w.dispose(); }
  });

  it("refuses without a corrections store rather than reading the environment's", async () => {
    const w = await world({ correctionsDir: false }); try { await refused(w, "corrections-store-unconfigured"); } finally { await w.dispose(); }
  });

  it("refuses a decision no ledger holds, and a pending item the control store no longer has", async () => {
    const w = await world(); try {
      const missingDecision = await w.record({ decisionId: `${RUN}/agent-9` });
      await refused(w, "original-decision-not-found", missingDecision.id);
      const missingPending = await w.record({ runId: RUN, pendingId: pendingIdOf(RUN, 0) });
      await refused(w, "original-pending-decision-not-found", missingPending.id);
    } finally { await w.dispose(); }
  });

  it("opens a pending-target correction: no ledger line is needed in HEAD", async () => {
    const w = await world({ ledgerAt: "target-not-head" }); try {
      insertPendingDecisions(w.store, "g", RUN, [{ pendingId: pendingIdOf(RUN, 0), ledgerRun: RUN, entryIndex: 0, entry: { question: "q" }, reason: "refused", at: "2026-10-18T00:00:00.000Z", evidence: [] }]);
      const pending = await w.record({ runId: RUN, pendingId: pendingIdOf(RUN, 0) });
      expect(opened(await w.open(pending.id)).created).toBe(true);
    } finally { await w.dispose(); }
  });
});

describe("a stopped group is returned with its state; Reopen makes -2", () => {
  it("returns a paused group, answers group-archived for an archived one, reopens -2, and refuses a reopen while -2 is live", async () => {
    const w = await world(); try {
      const cid = w.correction.id, first = `debug-${cid}`;
      await w.open(cid);
      const pause = { schema: "orca-raw-command-v1" as const, commandId: "pause-1", actorId: "human", expectedRevision: w.revisionOf(first), verb: "pause-dispatch" as const, target: { kind: "group" as const, groupId: first }, payload: {} };
      expect(await w.service.pauseDispatch(pause)).toMatchObject({ result: { kind: "paused" } });
      expect(opened(await w.open(cid))).toMatchObject({ groupId: first, created: false });
      // A paused group is stopped, so not live: a reopen would name the next ordinal.
      expect(debugGroupIdFor(w.store, cid, true)).toBe(`${first}-2`);
      // A paused (stopped) newest is not live, so a reopen makes the next one; first the archived case.
      const resume = { ...pause, commandId: "resume-1", expectedRevision: w.revisionOf(first), verb: "resume-dispatch" as const };
      await w.service.resumeDispatch(resume);
      const archive = { ...pause, commandId: "archive-1", expectedRevision: w.revisionOf(first), verb: "archive-group" as const };
      expect(applyArchiveGroup({ store: w.store }, archive)).toMatchObject({ result: { kind: "archived" } });
      expect(refusal(await w.open(cid))).toBe("group-archived");
      const reopened = await w.open(cid, { reopen: true });
      expect(opened(reopened)).toEqual({ kind: "debug-group-opened", groupId: `${first}-2`, correctionId: cid, created: true });
      expect(readDebugMark(w.body(`${first}-2`))!.ordinal).toBe(2);
      expect(debugGroupIds(w.store, cid)).toEqual([first, `${first}-2`]);
      expect(refusal(await w.open(cid, { reopen: true }))).toBe("debug-group-not-reopenable");
      expect(w.groupCount(cid)).toBe(2);
    } finally { await w.dispose(); }
  });

  it("refuses a command whose target the store no longer names", async () => {
    const w = await world(); try {
      const command = { ...w.openCommand(w.correction.id), target: { kind: "group" as const, groupId: `debug-${w.correction.id}-5` } };
      expect(refusal(await w.service.openCorrectionDebugGroup(command))).toBe("plan-version-conflict");
      expect(w.groupCount(w.correction.id)).toBe(0);
    } finally { await w.dispose(); }
  });

  it("refuses a group of that id no correction opened", async () => {
    const w = await world(); try {
      const cid = w.correction.id;
      await w.open(cid);
      const gid = `debug-${cid}`;
      const { debug: _debug, ...unmarked } = w.body(gid);
      w.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(unmarked), gid);
      // The resolver finds no debug group of the correction, so it names the base id, which is taken.
      expect(refusal(await w.open(cid))).toBe("group-already-exists");
    } finally { await w.dispose(); }
  });

  it("blocks by name on a debug mark that does not parse", () => {
    expect(readDebugMark({})).toBeNull();
    expect(() => readDebugMark({ debug: { correctionId: "c" } })).toThrow(/debug-mark-invalid/);
  });
});

describe("withdraw Amendment 2: an unstarted debug group is archived, a started one is left running", () => {
  it("archives an unstarted live group, names a started one, and returns the first refusal", async () => {
    const w = await world(); try {
      const cid = w.correction.id, first = `debug-${cid}`;
      await w.open(cid);
      const actor = { actorId: "human", principal: "user:u1" };
      // Started: a task run of the group exists.
      w.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,0,?)").run("run-d", first, "debug", 1, JSON.stringify({ runId: "run-d", groupId: first, taskId: "debug" }));
      expect(liveDebugGroups(w.store, cid)).toEqual([{ groupId: first, started: true }]);
      expect(archiveUnstartedDebugGroups({ store: w.store, service: w.service }, cid, actor)).toEqual({ debugGroups: [{ groupId: first, state: "started: left running" }], failure: null });
      expect(readGroupSummary(w.store, first).archived).toBe(false);
      // An estimate's run (taskId null) is not a start.
      w.store.db.prepare("UPDATE runs SET body=? WHERE id='run-d'").run(JSON.stringify({ runId: "run-d", groupId: first, taskId: null }));
      expect(archiveUnstartedDebugGroups({ store: w.store, service: w.service }, cid, actor)).toEqual({ debugGroups: [{ groupId: first, state: "archived" }], failure: null });
      expect(readGroupSummary(w.store, first).archived).toBe(true);
      expect(liveDebugGroups(w.store, cid)).toEqual([]);
    } finally { await w.dispose(); }
  });

  it("returns an archive the group refuses, so the withdrawal is answered beside it", async () => {
    const w = await world(); try {
      const cid = w.correction.id, first = `debug-${cid}`;
      await w.open(cid);
      w.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,1,?)").run("run-e", first, "estimate-x", 1, JSON.stringify({ runId: "run-e", groupId: first, taskId: null }));
      const settled = archiveUnstartedDebugGroups({ store: w.store, service: w.service }, cid, { actorId: "human", principal: "user:u1" });
      expect(settled).toMatchObject({ debugGroups: [], failure: { groupId: first, code: "archive-run-active" } });
      expect(readGroupSummary(w.store, first).archived).toBe(false);
    } finally { await w.dispose(); }
  });
});

describe("the correction-debug-open route", () => {
  it("opens through POST /api/control/corrections/:id/debug-group, refuses an agent's undoHow, and replays a retried reopen", async () => {
    const w = await world();
    let close = async (): Promise<void> => {};
    try {
      const app = express();
      app.use((req, res, next) => {
        res.locals.orcaPrincipal = (req.headers["x-test-agent"] ? { kind: "agent", client: "mcp:test" } : { kind: "user", userId: "o", name: "o", roles: ["owner"] }) satisfies Principal;
        next();
      });
      app.use(express.json({ verify: verifyControlJsonBody }));
      registerControlReadRoutes(app, { store: w.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service: w.service }, "web");
      const server = createServer(app);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      close = () => new Promise<void>((resolve) => server.close(() => resolve()));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("address");
      const cid = w.correction.id;
      const post = async (body: unknown, agent = false, id = cid) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/control/corrections/${id}/debug-group`, {
          method: "POST", headers: { "content-type": "application/json", ...(agent ? { "x-test-agent": "1" } : {}) }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };
      const asAgent = await post({ commandId: "agent-1", expectedRevision: 0, payload: { correctionId: cid, undoHow: "git revert --no-edit HEAD" } }, true);
      expect([asAgent.status, (asAgent.body.error as { code: string }).code]).toEqual([403, "control-field-human-only"]);
      expect(w.groupCount(cid)).toBe(0);
      const mismatch = await post({ commandId: "m-1", expectedRevision: 0, payload: { correctionId: "c_0000000000000000" } });
      expect(mismatch.status).toBe(400);
      const first = await post({ commandId: "agent-2", expectedRevision: 0, payload: { correctionId: cid } }, true);
      expect([first.status, first.body.result]).toEqual([201, { kind: "debug-group-opened", groupId: `debug-${cid}`, correctionId: cid, created: true }]);
      const view = await fetch(`http://127.0.0.1:${address.port}/api/control/groups/debug-${cid}`);
      expect(view.status).toBe(200);
      // Reopen once the newest is archived; the same command retried after -2 is archived too replays, making no -3.
      applyArchiveGroup({ store: w.store }, { schema: "orca-raw-command-v1", commandId: "a-1", actorId: "human", expectedRevision: w.revisionOf(`debug-${cid}`), verb: "archive-group", target: { kind: "group", groupId: `debug-${cid}` }, payload: {} });
      const reopen = { commandId: "reopen-1", expectedRevision: 0, payload: { correctionId: cid, reopen: true } };
      const reopened = await post(reopen);
      expect([reopened.status, (reopened.body.result as { groupId: string }).groupId]).toEqual([201, `debug-${cid}-2`]);
      applyArchiveGroup({ store: w.store }, { schema: "orca-raw-command-v1", commandId: "a-2", actorId: "human", expectedRevision: w.revisionOf(`debug-${cid}-2`), verb: "archive-group", target: { kind: "group", groupId: `debug-${cid}-2` }, payload: {} });
      expect(await post(reopen)).toEqual(reopened);
      expect(w.groupCount(cid)).toBe(2);
    } finally { await close(); await w.dispose(); }
  });
});

const confirmDebug = async (w: World, groupId: string) => {
  const frozen = { profileId: "all", hash: w.frozen.profileHash };
  const result = await w.service.confirm({ schema: "orca-raw-command-v1", commandId: `confirm-${groupId}`, actorId: "human", expectedRevision: w.revisionOf(groupId), verb: "confirm",
    target: { kind: "group", groupId }, payload: { planHash: readArchivedPlan(w.store, groupId).planHash, proposalVersion: readBudgetProposal(w.store, groupId).proposalVersion, budgetMode: "soft",
      profileIds: { estimator: null, worker: frozen.profileId, handoff: frozen.profileId, goalReview: frozen.profileId },
      profileHashes: { estimator: null, worker: frozen.hash, handoff: frozen.hash, goalReview: frozen.hash }, contextPolicy: { handoffAtContextTokens: 800_000 },
      selectionsHash: (await resolveGroupSelections({ store: w.store, port: w.deps.port }, groupId, "human")).selectionsHash ?? "0".repeat(64) } });
  return result;
};
const startDebug = (w: World, groupId: string) => w.service.start({ schema: "orca-raw-command-v1", commandId: `start-${groupId}`, actorId: "human",
  expectedRevision: w.revisionOf(groupId), verb: "start", target: { kind: "group", groupId }, payload: {} });

/**
 * Debug task plan Task 7 (design §4.4): the debug run is a fresh session. Open, confirm and start a debug group, drive
 * its claimed run through a synthetic ccloop, and read what the claim and the start envelope carried.
 */
describe("the debug run is a fresh session (debug task Task 7)", () => {
  it("claims its own run id and sends no input checkpoint; continuing from the original run is refused by identity", async () => {
    const w = await world(); try {
      const cid = w.correction.id, groupId = opened(await w.open(cid)).groupId;
      // The original run is a real recoverable, checkpointed predecessor, so only the identity check (continuation.ts) can refuse.
      const original = JSON.parse(String(w.store.db.prepare("SELECT body FROM runs WHERE id=?").get(RUN)!.body)) as Record<string, unknown>;
      w.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...original, recoverable: true, checkpointId: "checkpoint-1" }), RUN);

      const confirmed = await confirmDebug(w, groupId);
      expect(confirmed).toMatchObject({ result: { kind: "confirmed" } });
      expect(await startDebug(w, groupId)).toMatchObject({ result: { kind: "scheduled" } });
      const snapshot = profileSnapshot();
      const fake = fakeCcloopPort({ capabilities: snapshot.profile.capabilities, behaviour: () => "succeed", files: () => ({}) });
      fake.port.listAgents = w.deps.port.listAgents;
      const dispatch = { store: w.store, profileRouter: w.deps.profileRouter, admissionGate: w.deps.admissionGate };
      const delivered = await deliverScheduledStart(dispatch, groupId);
      if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
      const driver = createExecutionDriver({
        store: w.store, router: createExecutionProfileRouter([resolveProfile(snapshot, fake.port)]), admissionGate: w.deps.admissionGate,
        roots: controlWorkspaceRoots(w.store.stateDir), resolveRepository: () => w.repo, ccloopBin: FAKE_CCLOOP_RUN, agentsTablePath: join(w.root, "reconcile-agents.json"),
      });
      for (let i = 0; i < 60 && fake.calls.accept.length === 0; i += 1) await driver.round();

      expect(delivered.runId).not.toBe(RUN);
      expect(fake.calls.accept).toHaveLength(1);
      const envelope = fake.calls.accept[0]!;
      expect(envelope.claim).toMatchObject({ groupId, runId: delivered.runId, workItemId: "debug" });
      expect(envelope.inputCheckpoint).toBeNull();
      // continuation.ts: the predecessor passes the recoverability check, so the refusal is the group/work-item identity one.
      const run = JSON.parse(String(w.store.db.prepare("SELECT body FROM runs WHERE id=?").get(delivered.runId)!.body)) as { graphVersion: number; targetVersion: number };
      expect(() => claimContinuation(w.store, { groupId, predecessorRunId: RUN, workItemId: "debug", taskId: "debug", graphVersion: run.graphVersion, targetVersion: run.targetVersion,
        commandId: "continue-original", expectedRevision: w.revisionOf(groupId), by: "human" })).toThrowError(expect.objectContaining({ code: "continuation-identity-conflict" }));
    } finally { await w.dispose(); }
  });
});

describe("a debug group whose checks are still the placeholder is not confirmed or started (debug task Task 7, controller ruling)", () => {
  const PLACEHOLDER = DEBUG_DEFAULT_BUILD_TEST_COMMANDS[0];
  /** A debug group with no original contract: its correction names a pending item of a run the control store never saw. */
  async function placeholderGroup(w: World): Promise<string> {
    // A run with no task (an estimate's) is no original run: the input has no contract, so the plan keeps the placeholder.
    w.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,0,?)").run("run-9", "g", "estimate", 1, JSON.stringify({ runId: "run-9", groupId: "g", workItemId: "estimate", taskId: null, generation: 1, state: "settled" }));
    insertPendingDecisions(w.store, "g", "run-9", [{ pendingId: pendingIdOf("run-9", 0), ledgerRun: "run-9", entryIndex: 0, entry: { question: "q" }, reason: "refused", at: "2026-10-18T00:00:00.000Z", evidence: [] }]);
    const pending = await w.record({ runId: "run-9", pendingId: pendingIdOf("run-9", 0) });
    const groupId = opened(await w.open(pending.id)).groupId;
    expect(readArchivedPlan(w.store, groupId).plan.tasks[0]!.originalContractCanonicalJson).toContain(PLACEHOLDER);
    return groupId;
  }
  const proposalState = (w: World, groupId: string) => readBudgetProposal(w.store, groupId).state;

  it("refuses confirm, booked with its 409 status, and leaves the proposal unconfirmed", async () => {
    const w = await world(); try {
      const groupId = await placeholderGroup(w);
      const answer = await confirmDebug(w, groupId);
      expect(refusal(answer)).toBe("debug-checks-unnamed");
      expect(durableCommandErrorStatuses["debug-checks-unnamed"]).toBe(409);
      expect(lookupCommandResult(w.store, groupId, `confirm-${groupId}`)!.body).toMatchObject({ error: { code: "debug-checks-unnamed" } });
      expect(proposalState(w, groupId)).not.toBe("confirmed");
    } finally { await w.dispose(); }
  });

  it("refuses start, booked, for a ready group whose plan is the placeholder", async () => {
    const w = await world(); try {
      const groupId = await placeholderGroup(w);
      // Confirm refuses this group, so the mark is lifted for the confirmation and put back: start is the second line of defence.
      const marked = w.body(groupId), { debug, ...unmarked } = marked;
      w.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(unmarked), groupId);
      expect(await confirmDebug(w, groupId)).toMatchObject({ result: { kind: "confirmed" } });
      w.store.db.prepare("UPDATE groups SET body=json_set(body,'$.debug',json(?)) WHERE id=?").run(JSON.stringify(debug), groupId);
      expect(readDebugMark(w.body(groupId))).not.toBeNull();
      const answer = await startDebug(w, groupId);
      expect(refusal(answer)).toBe("debug-checks-unnamed");
      expect(lookupCommandResult(w.store, groupId, `start-${groupId}`)!.body).toMatchObject({ error: { code: "debug-checks-unnamed" } });
    } finally { await w.dispose(); }
  });

  it("lets a debug group with a named check be confirmed and started", async () => {
    const w = await world(); try {
      const groupId = opened(await w.open(w.correction.id)).groupId;
      expect(readArchivedPlan(w.store, groupId).plan.tasks[0]!.originalContractCanonicalJson).not.toContain(PLACEHOLDER);
      expect(await confirmDebug(w, groupId)).toMatchObject({ result: { kind: "confirmed" } });
      expect(await startDebug(w, groupId)).toMatchObject({ result: { kind: "scheduled" } });
    } finally { await w.dispose(); }
  });

  it("does not touch a group no correction opened, whatever its checks say", async () => {
    const h = await webFixture(undefined, [{ taskId: "a" }], { requiredChecks: [PLACEHOLDER] }); try {
      const service = new WebControlService({ ...h.deps, knownRepository: (repoId: string) => repoId === "repo" });
      expect(readArchivedPlan(h.store, "g").plan.tasks[0]!.originalContractCanonicalJson).toContain(PLACEHOLDER);
      expect(readDebugMark(JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)))).toBeNull();
      expect(await service.confirm(h.command("confirm", { ...(await h.confirmPayload()), budgetMode: "soft" }))).toMatchObject({ result: { kind: "confirmed" } });
      expect(await service.start(h.command("start", {}))).toMatchObject({ result: { kind: "scheduled" } });
    } finally { await h.dispose(); }
  });
});
