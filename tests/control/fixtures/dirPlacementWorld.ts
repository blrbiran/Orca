/**
 * Dir-requirements spec §8 (plan Task 5a/5b): one dir group "g" on its own folder, as the export leaves it -- the folder's
 * vault with `refs/orca/group/g/base` (an import of the folder), `placed` = base, the work branch `orca/g` at a document
 * commit on base, and a control store whose group row carries `dirWorkspace`, the requirement's export path and the
 * placement record. `land` makes a landing the way the driver leaves one (a commit on the work branch that also writes the
 * run's `.decisions/` file, its tip recorded as `landedTip`); `place` runs the placement pass.
 *
 * Rule 17: HOME, ORCA_VAULT_DIR, ORCA_CONTROL_DIR and ORCA_PROJECTS_FILE are under the world's own temporary root, in the
 * env the pass is given; the pass never reads process.env for them.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { initialPlacement, readPlacement, recordLandedTip, type PlacementRecord } from "../../../src/control/dirGroup.js";
import { applyResolveFolderChange } from "../../../src/control/folderChangeCommands.js";
import type { FolderChangeAction } from "../../../src/control/webProtocol.js";
import { placeDirGroups, type PlacementHook } from "../../../src/control/dirPlacement.js";
import { freezeDirWorkspace, importFolder, openDirWorkspace } from "../../../src/control/dirWorkspace.js";
import type { ControlStore } from "../../../src/control/store.js";
import { openTestStore } from "./store.js";

export const DOC = ".orca/requirements/2026-10-24-notes.md";
export type Change = string | Buffer | null | { content: string; mode: "100644" | "100755" | "120000" };

export function writeTree(root: string, files: Record<string, string | Buffer>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** Every entry under `dir` (path → kind, mode, inode, mtime and a digest of its bytes or link target). */
export function folderState(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const path = rel === "" ? name : `${rel}/${name}`, abs = join(dir, path), stat = lstatSync(abs, { bigint: true });
      const kind = stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "dir" : "file";
      const bytes = kind === "file" ? createHash("sha256").update(readFileSync(abs)).digest("hex") : "";
      out[path] = `${kind} ${stat.mode.toString(8)} ${stat.ino} ${stat.mtimeNs} ${bytes}`;
      if (kind === "dir") walk(path);
    }
  };
  walk("");
  return out;
}
/** Every `.orca-*` name left anywhere in the folder. */
export const orcaNames = (dir: string): string[] => Object.keys(folderState(dir)).filter((path) => /(^|\/)\.orca-[0-9a-f]{8}$/.test(path));

export async function placementWorld(files: Record<string, string | Buffer>, options: { folder?: string } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orca-dir-placement-")));
  const folder = options.folder ?? join(root, "notes");
  mkdirSync(folder, { recursive: true });
  writeTree(folder, files);
  const env: NodeJS.ProcessEnv = { HOME: join(root, "home"), ORCA_VAULT_DIR: join(root, "vaults"), ORCA_CONTROL_DIR: join(root, "control"), ORCA_PROJECTS_FILE: join(root, "projects.json") };
  mkdirSync(env.HOME!, { mode: 0o700 });
  const frozen = await freezeDirWorkspace(folder);
  const ws = await openDirWorkspace(env, frozen);
  const vault = ws.vault.path;
  const git = (args: string[], input?: string | Buffer, extraEnv: NodeJS.ProcessEnv = {}): string =>
    execFileSync("git", ["--git-dir", vault, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, ...extraEnv }, ...(input === undefined ? {} : { input }) }).trim();
  const ref = (name: string): string | null => { try { return git(["rev-parse", "--verify", "-q", name]); } catch { return null; } };
  const base = (await importFolder(ws, { reuseUnchanged: false, baseRef: "refs/orca/group/g/base" })).commit;
  git(["update-ref", "refs/orca/group/g/placed", base, ""]);
  /** A commit on `parent` with these paths set or removed. */
  const commitOn = (parent: string, changes: Record<string, Change>, message = "landing"): string => {
    const index = join(root, `index-${Math.random().toString(36).slice(2)}`);
    const env2 = { GIT_INDEX_FILE: index };
    git(["read-tree", parent], undefined, env2);
    const removals: string[] = [], puts: string[] = [];
    for (const [path, change] of Object.entries(changes)) {
      if (change === null) { removals.push(`0 ${"0".repeat(40)}\t${path}`); continue; }
      const { content, mode } = typeof change === "string" || Buffer.isBuffer(change) ? { content: change, mode: "100644" } : change;
      puts.push(`${mode} ${git(["hash-object", "-w", "--stdin"], content)}\t${path}`);
    }
    // Removals first, so a file and a directory of one name are never in the index together.
    git(["update-index", "--index-info"], [...removals, ...puts].map((line) => `${line}\n`).join(""), env2);
    return git(["commit-tree", git(["write-tree"], undefined, env2), "-p", parent, "-m", message]);
  };
  const doc = commitOn(base, { [DOC]: "# Notes export\n" }, "orca: requirement document");
  git(["update-ref", "refs/heads/orca/g", doc, ""]);
  const h = await openTestStore();
  const store: ControlStore = h.store;
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,?)").run(JSON.stringify({
    groupId: "g", revision: 0, graphVersion: 1, status: "running", stopped: false, dirWorkspace: frozen,
    requirement: { repoId: "repo", export: { state: "done", path: DOC, commit: doc, parent: base, detail: null } },
    placement: initialPlacement({ base, landedTip: doc, at: 1 }),
  }));
  let runs = 0, resolutions = 0;
  const body = (): Record<string, unknown> => JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  const record = (): PlacementRecord => readPlacement(body().placement)!;
  const setRecord = (patch: Partial<PlacementRecord>): void => {
    store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body(), placement: { ...record(), ...patch } }));
  };
  const tip = (): string => ref("refs/heads/orca/g")!;
  return {
    root, folder, env, frozen, ws, vault, git, ref, base, doc, store, commitOn, body, record, setRecord, tip,
    /** A landing on the work branch: these changes plus the run's `.decisions/` file; its tip recorded as landedTip. */
    land(changes: Record<string, Change>): string {
      runs += 1;
      const commit = commitOn(tip(), { ...changes, [`.decisions/run-${runs}.jsonl`]: `{"ev":"decision","id":"d${runs}"}\n` });
      git(["update-ref", "refs/heads/orca/g", commit, tip()]);
      store.transaction(() => recordLandedTip(store, "g", commit));
      return commit;
    },
    place: (crash?: PlacementHook): Promise<boolean> => placeDirGroups({ store, env, ...(crash === undefined ? {} : { crash }) }),
    /** The person's `resolve-folder-change` command (§9.2): records the answer (the next `place` acts on it). */
    resolve(action: FolderChangeAction, commandId = `resolve-${action}-${++resolutions}`): { ok: true } | { ok: false; code: string } {
      const revision = Number(store.db.prepare("SELECT revision FROM groups WHERE id='g'").get()!.revision);
      const command = {
        schema: "orca-raw-command-v1" as const, commandId, actorId: "owner@example.invalid", expectedRevision: revision,
        verb: "resolve-folder-change" as const, target: { kind: "group" as const, groupId: "g" }, payload: { action },
      };
      const answer = applyResolveFolderChange({ store }, command) as { error?: { code?: string } };
      return answer.error === undefined ? { ok: true } : { ok: false, code: String(answer.error.code) };
    },
    /** The file entry of `path` in a commit: "<mode> <blob>", or "absent" (also for a directory): a withheld `toEntry`. */
    entry(commit: string, path: string): string {
      const line = git(["ls-tree", "-r", "--full-tree", commit, "--", path]).split("\n").find((l) => l.split("\t")[1] === path);
      if (line === undefined) return "absent";
      const [mode, , oid] = line.split("\t")[0]!.split(" ");
      return `${mode} ${oid}`;
    },
    show: (commit: string, path: string): string => git(["show", `${commit}:${path}`]),
    dispose: async () => { await h.dispose(); rmSync(root, { recursive: true, force: true }); },
  };
}
export type PlacementWorld = Awaited<ReturnType<typeof placementWorld>>;
