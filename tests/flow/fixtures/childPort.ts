/**
 * Flow engine plan Task 10: a child port that records what the kernel opens and settles children when a criterion says
 * so. Opening is idempotent per child id, as the driver-backed port's is (§6.2): `dispatches` counts first opens only,
 * `opens` every call. A landing is a real vault commit on the child's base (git plumbing, as an attempt commit would be).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControlStore } from "../../../src/control/store.js";
import type { FlowChildOpen, FlowChildPort, FlowChildStatus } from "../../../src/flow/kinds/work.js";

const git = (vault: string, args: string[], env: NodeJS.ProcessEnv = {}, input?: string): string =>
  execFileSync("/usr/bin/git", ["--git-dir", vault, ...args], { env: { ...process.env, ...env }, encoding: "utf8", ...(input === undefined ? {} : { input }) }).trim();

/** The driver-backed port opens a real group row (step_executions.child_group_id references groups); so does this one. */
export function fakeChildPort() {
  let store: ControlStore | null = null;
  const opened = new Map<string, FlowChildOpen>();
  const statuses = new Map<string, FlowChildStatus>();
  let opens = 0, dispatches = 0;
  let failNextOpen = false;
  const port: FlowChildPort = {
    async open(request) {
      opens += 1;
      if (!opened.has(request.childGroupId)) {
        store!.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,0,1,0,?)").run(request.childGroupId, JSON.stringify({ groupId: request.childGroupId, flow: { role: "child" } }));
        opened.set(request.childGroupId, structuredClone(request)); statuses.set(request.childGroupId, { state: "running" }); dispatches += 1; }
      if (failNextOpen) { failNextOpen = false; throw new Error("crash after the dispatch, before the kernel recorded it"); }
    },
    status: async (id) => statuses.get(id) ?? null,
  };
  /** Land child `id` with these files written on its base; returns the landed commit. */
  const land = (id: string, files: Record<string, string>, extra: Partial<Extract<FlowChildStatus, { state: "landed" }>> = {}): string => {
    const request = opened.get(id)!;
    const dir = mkdtempSync(join(tmpdir(), "orca-child-index-"));
    try {
      const env = { GIT_INDEX_FILE: join(dir, "index"), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
      git(request.vaultPath, ["read-tree", request.baseCommit], env);
      for (const [path, text] of Object.entries(files)) {
        const blob = git(request.vaultPath, ["hash-object", "-w", "--stdin"], env, text);
        git(request.vaultPath, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], env);
      }
      const tree = git(request.vaultPath, ["write-tree"], env);
      const commit = git(request.vaultPath, ["commit-tree", tree, "-p", request.baseCommit, "-m", `attempt ${id}`], env);
      statuses.set(id, { state: "landed", commit, spentTokens: 0, ...extra });
      return commit;
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const fail = (id: string, reason: string, spentTokens = 0, extra: Partial<Extract<FlowChildStatus, { state: "failed" }>> = {}) => { statuses.set(id, { state: "failed", reason, spentTokens, ...extra }); };
  const bind = (s: ControlStore): FlowChildPort => { store = s; return port; };
  return { port: bind, opened, land, fail, failNextOpen: () => { failNextOpen = true; }, counts: () => ({ opens, dispatches }) };
}
