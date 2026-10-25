/**
 * Multi-directory projects spec §9: one complete multi group with a `local` repository, a `push-target` repository (a bare
 * remote) and a `dir` folder, in registered order, with each work branch already carrying one commit and the export
 * bases in `lastLanded`. `pass` is one driver round's multi landing pass; `settle` also waits through the opt-in checks
 * that run off the round. Rule 17: HOME, ORCA_VAULT_DIR, ORCA_CONTROL_DIR and ORCA_PROJECTS_FILE are under the world's
 * own temporary root, in the env the pass is given.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyResolveFolderChange } from "../../../src/control/folderChangeCommands.js";
import { freezeDirWorkspace, importFolder, openDirWorkspace } from "../../../src/control/dirWorkspace.js";
import { applyMultiDirLanding, landMultiDirGroups, readMultiLanding, type MultiLanding, type MultiLandingCrashPoint, type MultiLandingDeps, type MultiPrecheck } from "../../../src/control/multiLanding.js";
import { initialLanding, type LandingScheme } from "../../../src/control/multiLandingRecord.js";
import { placementRefs } from "../../../src/control/dirPlacement.js";
import { writeRepositorySettingsBody } from "../../../src/control/workspaceSettings.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../../src/control/workspace.js";
import { flowVaultRepoId, vaultPathOfRepoId } from "../../../src/flow/groups.js";
import type { FolderChangeAction } from "../../../src/control/webProtocol.js";
import type { ControlStore } from "../../../src/control/store.js";
import { openTestStore } from "./store.js";

type Change = Record<string, string | null>;
type GitRun = (args: string[], options?: { input?: string; env?: NodeJS.ProcessEnv }) => string;

const BASE = { ...unsetInheritedGitEnv(), GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };

function runner(prefix: string[]): GitRun {
  return (args, options = {}) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...prefix, ...args], {
    encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...BASE, ...options.env },
  }).trim();
}
const repoOf = (path: string): GitRun => runner(["-C", path]);
const vaultOf = (path: string): GitRun => runner(["--git-dir", path]);

export interface MultiLandingWorldOptions {
  /** A scheme other than the default, by key: `keep` makes that directory never due. */
  delivery?: Partial<Record<"local" | "remote" | "posts", LandingScheme>>;
}

export async function multiLandingWorld(options: MultiLandingWorldOptions = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orca-multi-landing-pass-")));
  const env: NodeJS.ProcessEnv = {
    HOME: join(root, "home"), ORCA_VAULT_DIR: join(root, "vaults"), ORCA_CONTROL_DIR: join(root, "control"), ORCA_PROJECTS_FILE: join(root, "projects.json"),
  };
  mkdirSync(env.HOME!, { mode: 0o700 });
  const personDir = join(root, "dispatched-person");
  mkdirSync(personDir, { recursive: true });

  /** A commit on `parent` with `changes` set or removed, made with plumbing. */
  const commitWith = (run: GitRun, parent: string, changes: Change, message: string): string => {
    const env2 = { GIT_INDEX_FILE: join(root, `index-${Math.random().toString(36).slice(2)}`) };
    run(["read-tree", parent], { env: env2 });
    const lines: string[] = [];
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) { lines.push(`0 ${"0".repeat(40)}\t${path}`); continue; }
      lines.push(`100644 ${run(["hash-object", "-w", "--stdin"], { input: text })}\t${path}`);
    }
    if (lines.length > 0) run(["update-index", "--index-info"], { input: `${lines.join("\n")}\n`, env: env2 });
    return run(["commit-tree", run(["write-tree"], { env: env2 }), "-p", parent, "-m", message]);
  };

  // The local target: another branch checked out, so a landing moves main by `update-ref` without a worktree.
  const local = join(root, "local");
  mkdirSync(local);
  const l = repoOf(local);
  l(["init", "-q", "-b", "main"]);
  writeFileSync(join(local, "local.txt"), "base\n");
  l(["add", "local.txt"]); l(["commit", "-qm", "local base"]);
  const localMain = l(["rev-parse", "main"]);
  l(["checkout", "-q", "-b", "other"]);
  l(["update-ref", "refs/heads/orca/g", localMain]);
  const localWork = commitWith(l, localMain, { "local.txt": "landed\n" }, "local work");
  l(["update-ref", "refs/heads/orca/g", localWork]);

  // The push-target: a target repository and a bare remote, its work branch one landing ahead.
  const remote = join(root, "remote"), bare = join(root, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  repoOf(bare)(["config", "core.logAllRefUpdates", "always"]);
  mkdirSync(remote);
  const r = repoOf(remote);
  r(["init", "-q", "-b", "main"]);
  writeFileSync(join(remote, "remote.txt"), "base\n");
  r(["add", "remote.txt"]); r(["commit", "-qm", "remote base"]);
  r(["remote", "add", "origin", bare]);
  r(["push", "-q", "origin", "main"]);
  const remoteMain = r(["rev-parse", "main"]);
  r(["update-ref", "refs/heads/orca/g", remoteMain]);
  const remoteWork = commitWith(r, remoteMain, { "remote.txt": "landed\n" }, "remote work");
  r(["update-ref", "refs/heads/orca/g", remoteWork]);

  // The folder: its vault's import is the export base; its work branch one landing ahead of it.
  const folder = join(root, "posts");
  mkdirSync(join(folder, "notes"), { recursive: true });
  writeFileSync(join(folder, "README.md"), "# Posts\n");
  writeFileSync(join(folder, "notes", "p1.md"), "first post\n");
  const frozen = await freezeDirWorkspace(folder);
  const ws = await openDirWorkspace(env, frozen);
  const vault = ws.vault.path;
  const v = vaultOf(vault);
  const base = (await importFolder(ws, { reuseUnchanged: false, baseRef: "refs/orca/group/g/base" })).commit;
  v(["update-ref", placementRefs("g").placed, base, ""]);
  const postsWork = commitWith(v, base, { "notes/p1.md": "landed post\n" }, "posts work");
  v(["update-ref", "refs/heads/orca/g", postsWork, ""]);
  const postsRepoId = flowVaultRepoId(frozen.vaultId);

  const h = await openTestStore();
  const store: ControlStore = h.store;
  const defaults: Record<"local" | "remote" | "posts", LandingScheme> = {
    local: { delivery: "local", trigger: "task", method: "merge", target: "main" },
    remote: { delivery: "push-target", trigger: "task", method: "merge", target: "main", remote: "origin" },
    posts: { delivery: "place" },
  };
  const delivery = Object.entries(defaults).map(([key, scheme]) => ({ key, scheme: options.delivery?.[key as keyof typeof defaults] ?? scheme }));
  const landing = { ...initialLanding(delivery, 1), lastLanded: { local: localMain, remote: remoteMain, posts: base } };
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,?)").run(JSON.stringify({
    groupId: "g", revision: 0, graphVersion: 1, status: "done", stopped: false,
    ledger: { usageUnknown: false },
    multiDir: { project: "p", dirs: [
      { key: "local", repoId: "local", kind: "repo" },
      { key: "remote", repoId: "remote", kind: "repo" },
      { key: "posts", repoId: postsRepoId, kind: "dir", dirWorkspace: frozen },
    ], landing },
  }));
  const roots = controlWorkspaceRoots(store.stateDir);
  const prechecks = new Map<string, MultiPrecheck>();
  const repoPath = (repoId: string): string => repoId === "local" ? local : repoId === "remote" ? remote : (vaultPathOfRepoId(env, repoId) ?? vault);

  const body = (): Record<string, unknown> => JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  const record = (): MultiLanding => readMultiLanding((body().multiDir as { landing: unknown }).landing)!;
  const setLanding = (patch: Partial<MultiLanding>): void => {
    const multi = body().multiDir as Record<string, unknown>;
    store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body(), multiDir: { ...multi, landing: { ...record(), ...patch } } }));
  };
  const tipOf = (repo: string, ref: string): string | null => {
    try { return repoOf(repo)(["rev-parse", "--verify", "-q", ref]); } catch { return null; }
  };
  const command = (verb: "resolve-folder-change" | "multi-dir-landing", payload: Record<string, unknown>) => {
    const revision = Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
    return { schema: "orca-raw-command-v1" as const, commandId: `${verb}-${revision + 1}`, actorId: "owner@example.invalid", expectedRevision: revision,
      verb, target: { kind: "group" as const, groupId: "g" }, payload } as never;
  };

  return {
    root, env, personDir, store, roots, local, remote, bare, folder, vault, base, postsRepoId,
    localMain, localWork, remoteMain, remoteWork, postsWork, frozen,
    body, landing: record, setLanding, tipOf, commitWith, repoOf, vaultOf, prechecks,
    pass(extra: Partial<MultiLandingDeps> = {}): Promise<boolean> {
      return landMultiDirGroups({ store, roots, repoPathOf: repoPath, personDir, env, prechecks, ...extra });
    },
    /** Rounds until the landing is settled (journaled plans are carried out; the opt-in checks run off the round). */
    async settle(extra: Partial<MultiLandingDeps> = {}): Promise<void> {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        await this.pass(extra);
        if (!["prechecking", "landing"].includes(record().state)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error("the landing did not settle");
    },
    /** `resolve-folder-change`, with the multi member named. */
    resolve(action: FolderChangeAction, dir?: string) {
      const answer = applyResolveFolderChange({ store }, command("resolve-folder-change", dir === undefined ? { action } : { action, dir })) as { error?: { code?: string } };
      return answer.error === undefined ? { ok: true as const } : { ok: false as const, code: String(answer.error.code) };
    },
    /** `multi-dir-landing` (the person's answer to a stopped landing). */
    answer(action: "retry-rest" | "mark-resolved") {
      const answer = applyMultiDirLanding({ store }, command("multi-dir-landing", { action }) as never) as { result?: unknown; error?: { code?: string } };
      return answer.error === undefined ? { ok: true as const, result: answer.result } : { ok: false as const, code: String(answer.error.code) };
    },
    setCheck(repoId: string, enabled: boolean, commandText: string | null): void {
      const current = store.db.prepare("SELECT body FROM repository_settings WHERE repo_id=?").get(repoId);
      const revision = current === undefined ? 0 : (JSON.parse(String(current.body)) as { revision: number }).revision;
      writeRepositorySettingsBody(store, repoId, { workspaceMode: "worktree", revision: revision + 1, checks: { integrationCheck: { enabled, command: commandText } } });
    },
    /** A commit on a work branch with this landing's own changes (the driver's landing leaves one). */
    async dispose(): Promise<void> { await h.dispose(); rmSync(root, { recursive: true, force: true }); },
  };
}
export type MultiLandingWorld = Awaited<ReturnType<typeof multiLandingWorld>>;
export type { MultiLandingCrashPoint };
