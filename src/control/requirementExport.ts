import { createHash } from "node:crypto";
import { ControlError } from "./errors.js";
import { documentPathOf } from "./requirementDocument.js";
import { readRequirementGroup, saveRequirementGroup, type RequirementBlock } from "./requirementRecords.js";
import { readCanonicalRecord } from "./snapshot.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import { QUIET_GIT, workBranchRef } from "./workspace.js";
import { git, type GitOptions } from "../scheduler/gitExec.js";

const TRAILER = "Orca-Document-Sha256";
/** N1 spec §15 item 10 (the Task 5 lesson): every git child the export starts is killed after this long. */
const GIT_EXPORT_TIMEOUT_MS = 30_000;

export interface ExportDeps {
  store: ControlStore; admissionGate?: AdmissionGate; resolveRepository(repoId: string): string;
  /** Criteria lower it; production never passes one. */
  gitTimeoutMs?: number;
}

function write<T>(deps: ExportDeps, action: () => T): T { const release = deps.admissionGate?.enter(); try { return deps.store.transaction(action); } finally { release?.(); } }
function record(deps: ExportDeps, groupId: string, exported: RequirementBlock["export"]): void {
  write(deps, () => { const group = readRequirementGroup(deps.store, groupId); group.requirement.export = exported; saveRequirementGroup(deps.store, group); });
}

/**
 * Every child runs QUIET_GIT (no hook -- reference-transaction included -- and no fsmonitor of the target runs) and is
 * bounded. None of the commands below checks anything out, so no smudge filter can run; hash-object, the one that
 * converts content, is given --no-filters.
 */
function exportGit(deps: ExportDeps, repo: string) {
  const timeoutMs = deps.gitTimeoutMs ?? GIT_EXPORT_TIMEOUT_MS;
  return async (args: string[], options: Omit<GitOptions, "timeoutMs"> = {}): Promise<string> => git(repo, [...QUIET_GIT, ...args], { ...options, timeoutMs });
}
type ExportGit = ReturnType<typeof exportGit>;
const revParse = async (run: ExportGit, rev: string): Promise<string> => (await run(["rev-parse", "--verify", `${rev}^{commit}`])).trim();
const tipOf = async (run: ExportGit, ref: string): Promise<string | null> => revParse(run, ref).catch(() => null);

/** One `ls-tree -z` entry, kept as git printed it so that mktree writes it back byte for byte. */
interface TreeEntry { mode: string; type: string; oid: string; name: string }
async function listTree(run: ExportGit, tree: string): Promise<TreeEntry[]> {
  return (await run(["ls-tree", "-z", tree])).split("\0").filter((line) => line.length > 0).map((line) => {
    const tab = line.indexOf("\t");
    const [mode, type, oid] = line.slice(0, tab).split(" ") as [string, string, string];
    return { mode, type, oid, name: line.slice(tab + 1) };
  });
}
/** The entries of directory `name` in `entries`: none when it is absent; a non-directory there is refused, never replaced. */
async function subtree(run: ExportGit, entries: TreeEntry[], name: string, path: string): Promise<TreeEntry[]> {
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined) return [];
  if (entry.type !== "tree") throw new Error(`requirement export: ${path} in HEAD is not a directory`);
  return listTree(run, entry.oid);
}
/** `entries` with `entry` put in place of any entry by its name; mktree sorts them as git does. */
async function makeTree(run: ExportGit, entries: TreeEntry[], entry: TreeEntry): Promise<string> {
  const all = [...entries.filter((candidate) => candidate.name !== entry.name), entry];
  return (await run(["mktree", "-z"], { input: all.map((e) => `${e.mode} ${e.type} ${e.oid}\t${e.name}\0`).join("") })).trim();
}

/** DR21: a commit is this document's when its message carries the hash and it adds exactly one requirement file with these bytes. */
async function documentCommitPath(run: ExportGit, commit: string, requirement: RequirementBlock): Promise<string | null> {
  const message = await run(["log", "-1", "--format=%B", commit]);
  if (!message.split("\n").includes(`${TRAILER}: ${requirement.document!.sha256}`)) return null;
  const changed = (await run(["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", commit])).trim().split("\n").filter((line) => line.length > 0);
  if (changed.length !== 1 || !changed[0]!.startsWith(".orca/requirements/")) return null;
  const blob = await run(["cat-file", "blob", `${commit}:${changed[0]}`]);
  return createHash("sha256").update(blob, "utf8").digest("hex") === requirement.document!.sha256 ? changed[0]! : null;
}

/**
 * N1 spec §9.2 (as corrected by the controller's ruling on the Task 11 review): git plumbing only -- hash-object and
 * mktree on stdin, commit-tree on HEAD, and a create-only update-ref of orca/<groupId>. The person's working tree and index are never read
 * or written. A branch that already exists with anything else blocks (requirement-export-conflict) and is never moved.
 */
export async function exportRequirementDocument(deps: ExportDeps, groupId: string): Promise<"done" | "conflict" | "nothing"> {
  const group = readRequirementGroup(deps.store, groupId);
  const requirement = group.requirement;
  if (requirement.document === null || requirement.export.state !== "pending" || requirement.slug === null) return "nothing";
  const text = (JSON.parse(readCanonicalRecord(deps.store, requirement.document.recordHash)) as { text: string }).text;
  if (createHash("sha256").update(text, "utf8").digest("hex") !== requirement.document.sha256) throw new ControlError("recovery-blocked", "requirement-document-hash");
  const repo = deps.resolveRepository(requirement.repoId);
  const run = exportGit(deps, repo);
  const ref = workBranchRef(groupId);
  const existing = await tipOf(run, ref);
  if (existing !== null) {
    const path = await documentCommitPath(run, existing, requirement);
    if (path === null) {
      record(deps, groupId, { ...requirement.export, state: "conflict", detail: `requirement-export-conflict:${ref} is at ${existing}` });
      return "conflict";
    }
    record(deps, groupId, { state: "done", path, commit: existing, parent: await revParse(run, `${existing}^`), detail: null });
    return "done";
  }
  const head = await revParse(run, "HEAD");
  // Controller ruling (Task 11 review): no temporary index and nothing written outside the repository. HEAD's three
  // levels are read with ls-tree, and each changed level is written bottom-up with mktree, every child under the
  // target's own umask, so the objects get the modes git gives them there.
  const root = await listTree(run, `${head}^{tree}`);
  const orca = await subtree(run, root, ".orca", ".orca");
  const requirements = await subtree(run, orca, "requirements", ".orca/requirements");
  const names = new Set(requirements.map((entry) => entry.name));
  let suffix = 1;
  while (names.has(documentPathOf(requirement.createdOn, requirement.slug, suffix).slice(".orca/requirements/".length))) suffix += 1;
  const path = documentPathOf(requirement.createdOn, requirement.slug, suffix);
  const blob = (await run(["hash-object", "-w", "--stdin", "--no-filters"], { input: text })).trim();
  const requirementsTree = await makeTree(run, requirements, { mode: "100644", type: "blob", oid: blob, name: path.slice(".orca/requirements/".length) });
  const orcaTree = await makeTree(run, orca, { mode: "040000", type: "tree", oid: requirementsTree, name: "requirements" });
  const tree = await makeTree(run, root, { mode: "040000", type: "tree", oid: orcaTree, name: ".orca" });
  // DR21: dated at the freeze, so a re-run builds the same commit. commit-tree signs only with -S: a target's
  // commit.gpgSign is not read (measured on git 2.50.1; the criterion pins that no signing program runs).
  const at = requirement.document.frozenAt;
  const commit = (await run(["commit-tree", tree, "-p", head], {
    input: `docs(requirements): ${requirement.slug}\n\n${TRAILER}: ${requirement.document.sha256}\n`,
    env: { GIT_AUTHOR_NAME: "Orca", GIT_AUTHOR_EMAIL: "orca@localhost", GIT_COMMITTER_NAME: "Orca", GIT_COMMITTER_EMAIL: "orca@localhost", GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  })).trim();
  try { await run(["update-ref", ref, commit, ""]); }
  catch (error) {
    // Created concurrently: whatever is there now is judged like any existing branch. Any other failure is thrown.
    if ((await tipOf(run, ref)) === null) throw error;
    return exportRequirementDocument(deps, groupId);
  }
  record(deps, groupId, { state: "done", path, commit, parent: head, detail: null });
  return "done";
}

/** DR14: the driver's pass over undelivered export wakes; the pump has no handler for them, so they wait for the driver. */
export async function exportPendingRequirements(deps: ExportDeps): Promise<boolean> {
  let moved = false;
  for (const row of deps.store.db.prepare("SELECT id,group_id FROM scheduler_wakes WHERE kind='requirement-export' AND delivered=0 ORDER BY rowid").all()) {
    try {
      const outcome = await exportRequirementDocument(deps, String(row.group_id));
      write(deps, () => deps.store.db.prepare("UPDATE scheduler_wakes SET delivered=1 WHERE id=? AND delivered=0").run(String(row.id)));
      moved = moved || outcome !== "nothing";
    } catch (error) {
      // A draining panel refuses every write: the round ends, as for the runs. Anything else is this group's alone; the
      // wake stays undelivered and the next round tries again.
      if (error instanceof ControlError && error.code === "panel-draining") throw error;
      process.stderr.write(`orca-driver: requirement export ${String(row.group_id)}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  return moved;
}
