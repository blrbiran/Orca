/**
 * Dir-requirements spec §4.1, §6.1, §6.2 and §8.5 step 5 (plan Task 1; unit parts of D2): the folder workspace, one
 * folder ↔ one vault. Every world here has its own temporary root with ORCA_VAULT_DIR, ORCA_CONTROL_DIR and HOME inside
 * it (Rule 17): nothing resolves to the real ~/.orca.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, lstatSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importFolder, folderDrift, nextFolderCommit, openDirWorkspace } from "../../src/control/dirWorkspace.js";
import { buildRepositoryOverview } from "../../src/control/requirementOverview.js";
import { vaultKeyOf } from "../../src/flow/vault/paths.js";
import type { Vault } from "../../src/flow/vault/vault.js";
import { gv, vaultWorld } from "../flow/fixtures/vaultWorld.js";

async function world(files: Record<string, string>) {
  const w = await vaultWorld(files);
  const home = join(w.root, "home");
  mkdirSync(home, { mode: 0o700 });
  const env: NodeJS.ProcessEnv = { ...w.env, HOME: home, ORCA_PROJECTS_FILE: join(w.root, "projects.json") };
  const frozen = Object.freeze({ dir: w.folder.normalize("NFC"), vaultId: vaultKeyOf(w.folder) });
  return { ...w, env, frozen, ws: await openDirWorkspace(env, frozen) };
}
const names = (vault: Vault, commit: string): string[] => gv(vault, ["ls-tree", "-r", "--name-only", commit]).split("\n").filter((p) => p.length > 0);
const refOrNull = (vault: Vault, ref: string): string | null => { try { return gv(vault, ["rev-parse", "--verify", "-q", ref]); } catch { return null; } };
const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
  try { await promise; return "resolved"; } catch (error) { return (error as { code?: string }).code; }
};
function digestTree(dir: string): string {
  const hash = createHash("sha256");
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      const stat = lstatSync(path);
      hash.update(`${path}\0${stat.mode}\0${stat.mtimeMs}\0`);
      if (stat.isDirectory()) walk(path); else if (stat.isFile()) hash.update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

describe("openDirWorkspace (§4.1)", () => {
  it("opens the folder's own vault, the one a flow run on that folder names", async () => {
    const w = await world({ "a.md": "A\n" });
    expect(w.ws.vault.path).toBe(w.vault.path);
    expect(w.ws.vault.path).toBe(join(w.root, "vaults", `${w.frozen.vaultId}.git`));
  });

  it("a folder moved away, replaced by a symlink to elsewhere, or by a file is dir-folder-missing", async () => {
    const w = await world({ "a.md": "A\n" });
    renameSync(w.folder, `${w.folder}-moved`);
    expect(await codeOf(openDirWorkspace(w.env, w.frozen))).toBe("dir-folder-missing");
    // The moved folder still exists elsewhere: a symlink at the frozen path must not make it the group's folder again.
    symlinkSync(`${w.folder}-moved`, w.folder);
    expect(await codeOf(openDirWorkspace(w.env, w.frozen))).toBe("dir-folder-missing");
    execFileSync("rm", [w.folder]);
    writeFileSync(w.folder, "a file now\n");
    expect(await codeOf(openDirWorkspace(w.env, w.frozen))).toBe("dir-folder-missing");
  });

  it("a frozen vault id that is not the folder's is refused as a broken record, not opened", async () => {
    const w = await world({ "a.md": "A\n" });
    await expect(openDirWorkspace(w.env, { dir: w.frozen.dir, vaultId: "0".repeat(64) })).rejects.toThrow(/vault/);
  });
});

describe("importFolder (§6.1, §6.2, §10)", () => {
  it("never imports the folder's .decisions/: the import holds the folder's other files only", async () => {
    const w = await world({ "a.md": "A\n", ".decisions/x.jsonl": "{}\n", "sub/.decisions/y.jsonl": "{}\n" });
    const { commit } = await importFolder(w.ws, { reuseUnchanged: false, baseRef: null });
    expect(gv(w.vault, ["rev-parse", "refs/orca/import/1"])).toBe(commit);
    expect(names(w.vault, commit)).toEqual(["a.md", "sub/.decisions/y.jsonl"]);
  });

  it("reuseUnchanged answers the newest import while the folder's tree is the same; a change makes the next import", async () => {
    const w = await world({ "a.md": "A\n" });
    const first = await importFolder(w.ws, { reuseUnchanged: true, baseRef: null });
    // A .decisions/ file appearing changes nothing the import holds, so it is still the same tree.
    mkdirSync(join(w.folder, ".decisions"));
    writeFileSync(join(w.folder, ".decisions", "z.jsonl"), "{}\n");
    const again = await importFolder(w.ws, { reuseUnchanged: true, baseRef: null });
    expect(again.commit).toBe(first.commit);
    expect(refOrNull(w.vault, "refs/orca/import/2")).toBeNull();
    writeFileSync(join(w.folder, "a.md"), "A2\n");
    const changed = await importFolder(w.ws, { reuseUnchanged: true, baseRef: null });
    expect(changed.commit).not.toBe(first.commit);
    expect(gv(w.vault, ["rev-parse", `${changed.commit}^`])).toBe(first.commit);
    // Without reuseUnchanged every call is a new import, even of an unchanged folder.
    const fresh = await importFolder(w.ws, { reuseUnchanged: false, baseRef: null });
    expect(fresh.commit).not.toBe(changed.commit);
    expect(gv(w.vault, ["rev-parse", "refs/orca/import/3"])).toBe(fresh.commit);
  });

  it("a group base is written create-only: an existing one is answered as it is and never replaced", async () => {
    const w = await world({ "a.md": "A\n" });
    const base = "refs/orca/group/g-1/base";
    const first = await importFolder(w.ws, { reuseUnchanged: true, baseRef: base });
    expect(gv(w.vault, ["rev-parse", base])).toBe(first.commit);
    writeFileSync(join(w.folder, "a.md"), "changed after the base\n");
    const second = await importFolder(w.ws, { reuseUnchanged: true, baseRef: base });
    expect(second.commit).toBe(first.commit);
    expect(gv(w.vault, ["rev-parse", base])).toBe(first.commit);
    // baseRef null writes no group ref at all.
    expect(gv(w.vault, ["for-each-ref", "--format=%(refname)", "refs/orca/group/"])).toBe(base);
  });
});

describe("the overview of a dir group is built from the import commit (§6.2, unit part of D2)", () => {
  it("names the import commit in a bare vault with no HEAD; a git folder's .git is untouched and its HEAD never used", async () => {
    const w = await world({ "README.md": "# Folder\n", "src/a.ts": "export const a = 1\n", ".decisions/x.jsonl": "{}\n" });
    execFileSync("git", ["-c", "init.defaultBranch=main", "init", "-q"], { cwd: w.folder });
    execFileSync("git", ["-c", "user.name=p", "-c", "user.email=p@p", "-c", "core.hooksPath=/dev/null", "add", "README.md"], { cwd: w.folder });
    execFileSync("git", ["-c", "user.name=p", "-c", "user.email=p@p", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "mine"], { cwd: w.folder });
    const folderHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: w.folder, encoding: "utf8" }).trim();
    const before = digestTree(join(w.folder, ".git"));
    const { commit } = await importFolder(w.ws, { reuseUnchanged: true, baseRef: null });
    expect(refOrNull(w.vault, "HEAD")).toBeNull();
    const { overview } = await buildRepositoryOverview({ repo: w.ws.vault.path, repoId: `flow-vault-${w.frozen.vaultId}`, stateDir: join(w.root, "control", "state"), runId: "run-1", astGrepBin: null, commit });
    expect(overview.commit).toBe(commit);
    expect(overview.commit).not.toBe(folderHead);
    expect(overview.files.listed).toEqual(["README.md", "src/a.ts"]);
    expect(digestTree(join(w.folder, ".git"))).toBe(before);
  });

  it("a given commit is verified as a commit: a tree id is refused", async () => {
    const w = await world({ "a.md": "A\n" });
    const { commit } = await importFolder(w.ws, { reuseUnchanged: true, baseRef: null });
    const tree = gv(w.vault, ["rev-parse", `${commit}^{tree}`]);
    await expect(buildRepositoryOverview({ repo: w.ws.vault.path, repoId: "v", stateDir: join(w.root, "control", "state"), runId: "run-1", astGrepBin: null, commit: tree })).rejects.toThrow();
  });
});

describe("folderDrift (§4.1, §9.2)", () => {
  it("is the folder's change against a folder commit, .decisions/ excluded", async () => {
    const w = await world({ "a.md": "A\n", "b.md": "B\n" });
    const { commit } = await importFolder(w.ws, { reuseUnchanged: true, baseRef: null });
    expect(await folderDrift(w.ws, commit)).toBeNull();
    writeFileSync(join(w.folder, "a.md"), "edited\n");
    mkdirSync(join(w.folder, ".decisions"));
    writeFileSync(join(w.folder, ".decisions", "p.jsonl"), "{}\n");
    const drift = await folderDrift(w.ws, commit);
    expect(drift?.paths).toEqual(["a.md"]);
    expect(w.show(drift!.commit, "a.md")).toBe("edited\n");
  });
});

describe("nextFolderCommit (§8.2, §8.5 step 5)", () => {
  it("is the tip's tree with .decisions/, the document and the kept paths taken from placed; parent placed; Orca's identity", async () => {
    const w = await world({ "a.md": "A\n", "kept.md": "as placed\n" });
    const placed = (await importFolder(w.ws, { reuseUnchanged: true, baseRef: "refs/orca/group/g-1/base" })).commit;
    const doc = ".orca/requirements/2026-10-24-x.md";
    const tip = w.stepCommit(w.stepCommit(placed, { [doc]: "the document\n" }), {
      "a.md": "A landed\n", "new.md": "new\n", ".decisions/run-1.jsonl": "{}\n", "kept.md": "landed over it\n", "kept-new.md": "withheld new file\n",
    });
    const next = await nextFolderCommit(w.ws, { groupId: "g-1", tip, placed, keepFromPlaced: [doc, "kept.md", "kept-new.md"] });
    expect(names(w.vault, next.commit)).toEqual(["a.md", "kept.md", "new.md"]);
    expect(w.show(next.commit, "a.md")).toBe("A landed\n");
    expect(w.show(next.commit, "kept.md")).toBe("as placed\n");
    expect(next.differs).toEqual([".decisions/run-1.jsonl", doc, "kept-new.md", "kept.md"]);
    expect(gv(w.vault, ["rev-list", "--parents", "-n", "1", next.commit])).toBe(`${next.commit} ${placed}`);
    expect(gv(w.vault, ["log", "-1", "--format=%s|%an|%ae|%cn", next.commit])).toBe("orca: place g-1|orca|orca@invalid|orca");
  });

  it("a ledger-only landing gives a folder commit with placed's tree", async () => {
    const w = await world({ "a.md": "A\n" });
    const placed = (await importFolder(w.ws, { reuseUnchanged: true, baseRef: null })).commit;
    const tip = w.stepCommit(placed, { ".decisions/run-1.jsonl": "{}\n", ".decisions/run-2.jsonl": "{}\n" });
    const next = await nextFolderCommit(w.ws, { groupId: "g-1", tip, placed, keepFromPlaced: [] });
    expect(gv(w.vault, ["rev-parse", `${next.commit}^{tree}`])).toBe(gv(w.vault, ["rev-parse", `${placed}^{tree}`]));
    expect(next.differs).toEqual([".decisions/run-1.jsonl", ".decisions/run-2.jsonl"]);
  });
});
