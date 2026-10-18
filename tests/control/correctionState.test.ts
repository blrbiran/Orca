import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { correctionClosedState, readCorrectionList } from "../../src/control/correctionState.js";
import { debugGroupIdFor } from "../../src/control/debugGroup.js";
import { integratePendingGroups } from "../../src/control/integrationPass.js";
import { newGroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { deriveRows } from "../../src/corrections/derive.js";
import { deriveFixRunId } from "../../src/corrections/fields.js";
import { withdrawalsFile } from "../../src/corrections/paths.js";
import { projectKeyOf } from "../../src/corrections/projectKey.js";
import { correctionRowFrom, recordNewCorrection } from "../../src/corrections/record.js";
import type { Correction } from "../../src/corrections/schema.js";
import { withdrawCorrection } from "../../src/corrections/withdrawals.js";
import type { DecisionEvent } from "../../src/ledger/schema.js";
import { registerControlReadRoutes, type ControlChannel } from "../../src/panel/controlApi.js";
import type { Principal } from "../../src/panel/permissions.js";
import { FIXTURE_AGENT, webFixture } from "./fixtures/web.js";

// Debug task plan Task 10 (design §12.1, ruling C16): a correction's closed state is computed from the integration
// target's tree, never stored and never `git log --all`. Every assertion reads git, the store or a route's answer; the
// corrections store is a temp directory (ORCA_CORRECTIONS_DIR, Rule 17). Real git children: a minute per test.
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
const DECISION: DecisionEvent = {
  ev: "decision", id: `${RUN}/agent-0`, at: "2026-10-18T00:00:00.000Z", run: RUN, question: "which lock", chose: "in-process mutex",
  alternatives: [{ option: "file lease", why_not: "too heavy" }], because: "fastest",
  undo: { how: "git revert x", cost: "one repo", blast_radius: "one repo" }, scope: "repo", kind: "interface",
};
const BY = "owner@example.invalid";
const LOCAL_MERGE: IntegrationScheme = { delivery: "local", trigger: "task", method: "merge", target: "main" };
const LOCAL_SQUASH: IntegrationScheme = { delivery: "local", trigger: "task", method: "squash", target: "main" };
const fixRunIdOf = (correction: Correction): string => { const { id, ...row } = correction; return deriveFixRunId(row, id); };
/** The closing file deriveRows gives the correction (what a debug landing or a `--close` writes), as one ledger file. */
function closingFile(correction: Correction): Record<string, string> {
  const { decision, overturned } = deriveRows({ correction, original: DECISION, choseInstead: "file lease", undo: { how: "git revert --no-edit HEAD" }, at: "2026-10-18T03:00:00.000Z", runId: fixRunIdOf(correction) });
  return { [`.decisions/${fixRunIdOf(correction)}.jsonl`]: `${JSON.stringify(decision)}\n${JSON.stringify(overturned)}\n` };
}

afterEach(() => { vi.unstubAllEnvs(); });

/**
 * Group `g` ran `run-1` over the repository `target` (repoId `repo`, main checked out and clean, the decision's ledger
 * line on main); one correction of that decision is recorded. `open` opens its debug group through the service and
 * gives it `scheme` (frozen) or none (keep); `land` makes a landing on the debug group's branch; `pass` is one
 * integration pass.
 */
async function world() {
  const h = await webFixture(undefined, [{ taskId: "a" }], { preferences: { defaultAgent: "claude", perAgent: {} } });
  const repo = join(h.root, "target");
  await mkdir(repo);
  g(repo, ["init", "-q", "-b", "main"]);
  g(repo, ["remote", "add", "origin", "https://example.invalid/o/r.git"]);
  await writeFile(join(repo, "base.txt"), "base\n");
  await mkdir(join(repo, "tests")); await writeFile(join(repo, "tests", "keep.txt"), "\n");
  g(repo, ["add", "base.txt", "tests/keep.txt"]); g(repo, ["commit", "-qm", "base"]);
  const base = g(repo, ["rev-parse", "HEAD"]);
  const attempt = commitOn(repo, "refs/heads/attempt", { "a.txt": "a\n" }, "attempt", "main");
  commitOn(repo, "refs/heads/main", { [".decisions/run-1.jsonl"]: `${JSON.stringify(DECISION)}\n` }, "ledger on target", "main");
  g(repo, ["reset", "-q", "--hard", "main"]);
  h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,0,?)").run(RUN, "g", "a", 1, JSON.stringify({
    runId: RUN, groupId: "g", workItemId: "a", taskId: "a", generation: 1, graphVersion: 1, targetVersion: 1, state: "settled",
    agent: FIXTURE_AGENT, configHash: "config-hash-1", drive: { base, attemptSha: attempt, landedCommit: attempt },
  }));
  const dir = join(h.root, "corrections");
  await mkdir(dir, { mode: 0o700 });
  vi.stubEnv("ORCA_CORRECTIONS_DIR", dir);
  const projectKey = await projectKeyOf(repo);
  let clock = Date.parse("2026-10-18T01:00:00.000Z");
  let recorded = 0;
  // A second correction of the same decision is recorded on purpose (`--again`).
  const record = async (key = projectKey): Promise<Correction> =>
    recordNewCorrection(dir, correctionRowFrom({ projectKey: key, decisionId: DECISION.id, kind: "wrong", because: "the premise was false", by: BY }, () => new Date(clock += 1000)), { again: recorded++ > 0 });
  const correction = await record();
  const listRepositories = () => [{ repoId: "repo", path: repo }];
  const service = new WebControlService({ ...h.deps, correctionsDir: dir, correctionsBy: BY, listRepositories });
  const body = (groupId: string) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
  let sequence = 0;
  const open = async (scheme: IntegrationScheme | null): Promise<string> => {
    const groupId = debugGroupIdFor(h.store, correction.id, false);
    const revision = Number(h.store.db.prepare("SELECT revision FROM groups WHERE id=?").get(groupId)?.revision ?? 0);
    const result = await service.openCorrectionDebugGroup({ schema: "orca-raw-command-v1", commandId: `open-${++sequence}`, actorId: "human",
      expectedRevision: revision, verb: "correction-debug-open", target: { kind: "group", groupId }, payload: { correctionId: correction.id } });
    if ("error" in result) throw new Error(JSON.stringify(result));
    const { integration: _integration, ...rest } = body(groupId);
    h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(scheme === null ? rest : { ...rest, integration: { ...newGroupIntegration(scheme)!, frozen: true } }), groupId);
    // The driver creates the work branch from HEAD at the first claim.
    g(repo, ["update-ref", `refs/heads/orca/${groupId}`, "HEAD"]);
    return groupId;
  };
  const land = (groupId: string, files: Record<string, string>) => commitOn(repo, `refs/heads/orca/${groupId}`, files, "land");
  const pass = () => integratePendingGroups({
    store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), admissionGate: h.deps.admissionGate, repoPathOf: () => repo,
    now: () => Date.now(), ghBin: "/nonexistent/gh", stopped: () => false,
  });
  const list = () => readCorrectionList({ store: h.store, correctionsDir: dir, listRepositories });
  const item = async (id = correction.id) => (await list()).find((entry) => entry.correction.id === id)!;
  const closedRows = (groupId: string) => readGroupActivity(h.store, groupId, 50).filter((entry) => entry.kind === "correction-closed");
  return { ...h, repo, dir, correction, record, service, open, land, pass, list, item, closedRows };
}

describe("a correction's closed state is computed from the integration target (plan Task 10)", { timeout: 60_000 }, () => {
  it("rows on the group branch only leave the correction open", async () => {
    const w = await world(); try {
      const groupId = await w.open(LOCAL_MERGE);
      const landed = w.land(groupId, closingFile(w.correction));
      // The rows are in git (on the group branch), which `git log --all` would find.
      expect(g(w.repo, ["log", "--all", "--format=%H", "--", `.decisions/${fixRunIdOf(w.correction)}.jsonl`])).toBe(landed);
      // M-10.1: a predicate over `git log --all` (alreadyCommitted) -> red here.
      expect((await w.item()).closed).toEqual({ state: "open" });
      expect(await correctionClosedState(w.repo, w.correction, { ref: "refs/heads/main", via: "debug-group" })).toEqual({ state: "open" });
    } finally { await w.dispose(); }
  });

  it("after local merge integration it is closed, and the move is recorded once", async () => {
    const w = await world(); try {
      const groupId = await w.open(LOCAL_MERGE);
      w.land(groupId, closingFile(w.correction));
      expect(w.closedRows(groupId)).toEqual([]);
      expect(await w.pass()).toBe(true);
      expect(g(w.repo, ["cat-file", "-e", `refs/heads/main:.decisions/${fixRunIdOf(w.correction)}.jsonl`])).toBe("");
      const item = await w.item();
      expect(item.closed).toEqual({ state: "closed", ref: "refs/heads/main", via: "debug-group" });
      expect(item.debugGroups).toEqual([{ groupId, ordinal: 1, live: true, state: expect.any(String) }]);
      expect(w.closedRows(groupId).map((row) => [row.runId, row.body])).toEqual([[null, { correctionId: w.correction.id, ref: "refs/heads/main", via: "debug-group" }]]);
      // A second landing settles a second integration; the correction was already closed, so no second row (M-10.5).
      w.land(groupId, { "b.txt": "b\n" });
      expect(await w.pass()).toBe(true);
      expect(w.closedRows(groupId)).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("after local squash integration it is closed (review focus 2)", async () => {
    const w = await world(); try {
      const groupId = await w.open(LOCAL_SQUASH);
      const landed = w.land(groupId, closingFile(w.correction));
      expect(await w.pass()).toBe(true);
      // Under squash the landing commit is not an ancestor of the target: M-10.2 (merge-base --is-ancestor) -> red.
      expect(() => g(w.repo, ["merge-base", "--is-ancestor", landed, "refs/heads/main"])).toThrow();
      expect((await w.item()).closed).toEqual({ state: "closed", ref: "refs/heads/main", via: "debug-group" });
      expect(w.closedRows(groupId)).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("keep never closes by itself", async () => {
    const w = await world(); try {
      const groupId = await w.open(null);
      w.land(groupId, closingFile(w.correction));
      expect(await w.pass()).toBe(false);
      // M-10.3: keep mapped to the group branch -> red.
      expect((await w.item()).closed).toEqual({ state: "open" });
      expect(await correctionClosedState(w.repo, w.correction, null)).toEqual({ state: "open" });
      expect(w.closedRows(groupId)).toEqual([]);
    } finally { await w.dispose(); }
  });

  it("the list shows a correction with no debug group and its open state", async () => {
    const w = await world(); try {
      const item = await w.item();
      expect(item).toEqual({ correction: w.correction, repoId: "repo", debugGroups: [], closed: { state: "open" }, closing: null, withdrawn: null });
    } finally { await w.dispose(); }
  });

  it("a by-hand close on the current branch, with no debug group, is closed by-hand; a detached HEAD is read as HEAD", async () => {
    const w = await world(); try {
      commitOn(w.repo, "refs/heads/main", closingFile(w.correction), "orca correct --close");
      // M-10.6: no debug group read as no target -> red.
      expect((await w.item()).closed).toEqual({ state: "closed", ref: "refs/heads/main", via: "by-hand" });
      g(w.repo, ["checkout", "-q", "--detach", "main"]);
      // M-10.7: a detached HEAD read as a branch -> red.
      expect((await w.item()).closed).toEqual({ state: "closed", ref: "HEAD", via: "by-hand" });
    } finally { await w.dispose(); }
  });

  it("a correction whose repository is not configured is listed with repoId null and open", async () => {
    const w = await world(); try {
      const elsewhere = await w.record("github.com/someone/else");
      // The repository it would be judged in holds its closing rows on HEAD: unmatched, it is still open.
      commitOn(w.repo, "refs/heads/main", closingFile(elsewhere), "closing rows of another project");
      // M-10.8: an unmatched correction given a repository anyway -> red.
      expect(await w.item(elsewhere.id)).toMatchObject({ repoId: null, closed: { state: "open" } });
      expect((await w.item()).repoId).toBe("repo");
    } finally { await w.dispose(); }
  });

  it("a withdrawn correction is listed with who withdrew it and when", async () => {
    const w = await world(); try {
      const other = await w.record();
      await withdrawCorrection(w.dir, { correctionId: w.correction.id, by: BY, at: "2026-10-18T02:00:00.000Z", isClosed: () => false });
      // M-10.4: the withdrawal not carried -> red.
      expect((await w.item()).withdrawn).toEqual({ by: BY, at: "2026-10-18T02:00:00.000Z" });
      expect((await w.item(other.id)).withdrawn).toBeNull();
    } finally { await w.dispose(); }
  });
});

describe("GET /api/control/corrections (plan Task 10)", { timeout: 60_000 }, () => {
  async function serve(w: Awaited<ReturnType<typeof world>>, channel: ControlChannel, service: WebControlService | undefined) {
    const app = express();
    app.use((_req, res, next) => { res.locals.orcaPrincipal = (channel === "socket" ? { kind: "agent", client: "cli:test" } : { kind: "user", userId: "o", name: "o", roles: ["owner"] }) satisfies Principal; next(); });
    registerControlReadRoutes(app, { store: w.store, epoch: "epoch", config: { readView: async () => ({}) } as never, service }, channel);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address");
    return {
      get: async () => { const response = await fetch(`http://127.0.0.1:${address.port}/api/control/corrections`); return { status: response.status, body: await response.json() as any }; },
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it.each(["web", "socket"] as const)("answers the list over the %s channel; a damaged withdrawals file is its booked code", async (channel) => {
    const w = await world();
    const closers: Array<() => Promise<void>> = [];
    try {
      const api = await serve(w, channel, w.service); closers.push(api.close);
      const answer = await api.get();
      expect(answer.status).toBe(200);
      expect(answer.body.schema).toBe("orca-correction-list-v1");
      expect(answer.body.corrections.map((entry: any) => [entry.correction.id, entry.repoId, entry.closed, entry.withdrawn])).toEqual([[w.correction.id, "repo", { state: "open" }, null]]);
      await appendFile(withdrawalsFile(w.dir), "not json\n");
      const damaged = await api.get();
      expect([damaged.status, damaged.body.error.code]).toEqual([409, "correction-withdrawals-unreadable"]);
      const unconfigured = await serve(w, channel, new WebControlService({ ...w.deps })); closers.push(unconfigured.close);
      const refused = await unconfigured.get();
      expect([refused.status, refused.body.error.code]).toEqual([422, "corrections-store-unconfigured"]);
    } finally { for (const close of closers) await close(); await w.dispose(); }
  });

  it("is listed in the orca-control skill's reading section", async () => {
    const skill = await readFile("skills/orca-control/SKILL.md", "utf8");
    const reading = skill.slice(skill.indexOf("## 2. Reading"), skill.indexOf("## 3. Writing"));
    expect(reading).toContain("`orca control get corrections`");
  });
});
