import { createHash } from "node:crypto";
import { isGroupArchived } from "./archivedMark.js";
import { dirWorkspaceOf, groupRepoId, initialPlacement } from "./dirGroup.js";
import { importFolder, openDirWorkspace } from "./dirWorkspace.js";
import { ControlError } from "./errors.js";
import { waitingPrerequisites } from "./groupEdges.js";
import { documentPathOf } from "./requirementDocument.js";
import { readRequirementGroup, saveRequirementGroup, type RequirementBlock } from "./requirementRecords.js";
import { readCanonicalRecord } from "./snapshot.js";
import type { AdmissionGate } from "./admissionGate.js";
import type { ControlStore } from "./store.js";
import { QUIET_GIT, unsetInheritedGitEnv, workBranchRef } from "./workspace.js";
import { git, gitBytes, type GitOptions } from "../scheduler/gitExec.js";

const TRAILER = "Orca-Document-Sha256";
/** The two reasons an export is blocked (state "conflict"); each is the prefix of the export's detail. */
export const EXPORT_CONFLICT = "requirement-export-conflict";
export const EXPORT_PATH_BLOCKED = "requirement-export-path-blocked";
/** The reason a blocked export names, for the panel's summary: the code its detail starts with. */
export function exportReasonOf(detail: string | null): typeof EXPORT_CONFLICT | typeof EXPORT_PATH_BLOCKED {
  return detail !== null && detail.startsWith(`${EXPORT_PATH_BLOCKED}:`) ? EXPORT_PATH_BLOCKED : EXPORT_CONFLICT;
}
/** N1 spec §15 item 10 (the Task 5 lesson): every git child the export starts is killed after this long. */
const GIT_EXPORT_TIMEOUT_MS = 30_000;

export interface ExportDeps {
  store: ControlStore; admissionGate?: AdmissionGate; resolveRepository(repoId: string): string;
  /** Criteria lower it; production never passes one. */
  gitTimeoutMs?: number;
  /** Dir-requirements spec §6.1 (Rule 17): where a dir group's vault is found ($ORCA_VAULT_DIR). */
  env?: NodeJS.ProcessEnv;
}

function write<T>(deps: ExportDeps, action: () => T): T { const release = deps.admissionGate?.enter(); try { return deps.store.transaction(action); } finally { release?.(); } }
/** Dir-requirements spec §6.4 step 3: a dir group's `done` is recorded with its first placement record, in one transaction. */
function record(deps: ExportDeps, groupId: string, exported: RequirementBlock["export"], dirBase: string | null = null): void {
  write(deps, () => {
    const group = readRequirementGroup(deps.store, groupId);
    group.requirement.export = exported;
    if (dirBase !== null && exported.state === "done") group.placement = initialPlacement({ base: dirBase, landedTip: exported.commit!, at: deps.store.now() });
    saveRequirementGroup(deps.store, group);
  });
}

/**
 * Dir-requirements spec §6.4 step 2: the dir group's base. An existing `refs/orca/group/<g>/base` is the answer as it is
 * (never replaced, no import made); else a fresh import of the folder (reused while unchanged) becomes it, create-only.
 * `placed` is then created equal to the base, create-only: a replay finds both and makes neither.
 */
async function dirBaseOf(deps: ExportDeps, groupId: string, run: ExportGit, frozen: NonNullable<ReturnType<typeof dirWorkspaceOf>>): Promise<string> {
  if (deps.env === undefined) throw new Error("orca: a dir group's export needs the driver's env ($ORCA_VAULT_DIR)");
  const baseRef = `refs/orca/group/${groupId}/base`, placedRef = `refs/orca/group/${groupId}/placed`;
  const base = await tipOf(run, baseRef) ?? (await importFolder(await openDirWorkspace(deps.env, frozen), { reuseUnchanged: true, baseRef })).commit;
  if (await tipOf(run, placedRef) === null) {
    try { await run(["update-ref", placedRef, base, ""]); }
    catch (error) { if (await tipOf(run, placedRef) === null) throw error; }
  }
  return base;
}

/**
 * Every child runs QUIET_GIT (no hook -- reference-transaction included -- and no fsmonitor of the target runs), without
 * any GIT_* variable of Orca's own environment (final review triage), and is bounded. None of the commands below checks
 * anything out, so no smudge filter can run; hash-object, the one that converts content, is given --no-filters.
 */
function exportGit(deps: ExportDeps, repo: string) {
  const timeoutMs = deps.gitTimeoutMs ?? GIT_EXPORT_TIMEOUT_MS;
  const env = (options: Omit<GitOptions, "timeoutMs">): NodeJS.ProcessEnv => ({ ...unsetInheritedGitEnv(), ...options.env });
  const run = async (args: string[], options: Omit<GitOptions, "timeoutMs"> = {}): Promise<string> => git(repo, [...QUIET_GIT, ...args], { ...options, env: env(options), timeoutMs });
  return Object.assign(run, {
    bytes: async (args: string[], options: Omit<GitOptions, "timeoutMs"> = {}): Promise<Buffer> => gitBytes(repo, [...QUIET_GIT, ...args], { ...options, env: env(options), timeoutMs }),
  });
}
type ExportGit = ReturnType<typeof exportGit>;
const revParse = async (run: ExportGit, rev: string): Promise<string> => (await run(["rev-parse", "--verify", `${rev}^{commit}`])).trim();
const tipOf = async (run: ExportGit, ref: string): Promise<string | null> => revParse(run, ref).catch(() => null);

/**
 * One `ls-tree -z` entry, kept as the bytes git printed: the name is never decoded, so a name that is not valid UTF-8
 * goes back into mktree unchanged (Task 11 review, fix round 2).
 */
interface TreeEntry { header: Buffer; type: string; oid: string; name: Buffer }
async function listTree(run: ExportGit, tree: string): Promise<TreeEntry[]> {
  const out = await run.bytes(["ls-tree", "-z", tree]);
  const entries: TreeEntry[] = [];
  for (let at = 0; at < out.length;) {
    const end = out.indexOf(0, at), record = out.subarray(at, end === -1 ? out.length : end);
    at = end === -1 ? out.length : end + 1;
    if (record.length === 0) continue;
    const tab = record.indexOf(9);
    const [, type, oid] = record.subarray(0, tab).toString("latin1").split(" ") as [string, string, string];
    entries.push({ header: record.subarray(0, tab), type, oid, name: record.subarray(tab + 1) });
  }
  return entries;
}
const entryOf = (mode: string, type: string, oid: string, name: string): TreeEntry => ({ header: Buffer.from(`${mode} ${type} ${oid}`, "latin1"), type, oid, name: Buffer.from(name, "utf8") });
/** A level of HEAD that is there but is not a directory: the export is blocked by name, never replaced. */
class PathBlocked extends Error { constructor(readonly path: string) { super(`${path} in HEAD is not a directory`); } }
/** The entries of directory `name` in `entries`: none when it is absent; a non-directory there is refused (PathBlocked). */
async function subtree(run: ExportGit, entries: TreeEntry[], name: string, path: string): Promise<TreeEntry[]> {
  const entry = entries.find((candidate) => candidate.name.equals(Buffer.from(name, "utf8")));
  if (entry === undefined) return [];
  if (entry.type !== "tree") throw new PathBlocked(path);
  return listTree(run, entry.oid);
}
/** `entries` with `entry` put in place of any entry by its name; mktree sorts them as git does. */
async function makeTree(run: ExportGit, entries: TreeEntry[], entry: TreeEntry): Promise<string> {
  const all = [...entries.filter((candidate) => !candidate.name.equals(entry.name)), entry];
  const input = Buffer.concat(all.flatMap((e) => [e.header, Buffer.from([9]), e.name, Buffer.from([0])]));
  return (await run(["mktree", "-z"], { input })).trim();
}

/**
 * DR21: a commit is this document's when it has exactly one parent (the export's commit-tree always gives it HEAD; final
 * review triage), its message carries the hash, and it adds exactly one requirement file with these bytes.
 */
async function documentCommitPath(run: ExportGit, commit: string, requirement: RequirementBlock): Promise<string | null> {
  if ((await run(["rev-list", "--parents", "-n", "1", commit])).trim().split(" ").length !== 2) return null;
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
 * or written. A branch that already exists with anything else blocks (requirement-export-conflict) and is never moved;
 * a .orca or .orca/requirements in HEAD that is not a directory blocks (requirement-export-path-blocked).
 */
export async function exportRequirementDocument(deps: ExportDeps, groupId: string): Promise<"done" | "conflict" | "nothing" | "waiting"> {
  const group = readRequirementGroup(deps.store, groupId);
  const requirement = group.requirement;
  if (requirement.document === null || requirement.export.state !== "pending" || requirement.slug === null) return "nothing";
  // Dir-requirements spec §6.4 step 1: a dir group's base must hold what its prerequisites placed in the folder, so it
  // waits for them -- a DB read only, before any git child or vault access.
  const frozen = dirWorkspaceOf(group);
  if (frozen !== null && waitingPrerequisites(deps.store, groupId).length > 0) return "waiting";
  const text = (JSON.parse(readCanonicalRecord(deps.store, requirement.document.recordHash)) as { text: string }).text;
  if (createHash("sha256").update(text, "utf8").digest("hex") !== requirement.document.sha256) throw new ControlError("recovery-blocked", "requirement-document-hash");
  // Dir-requirements spec §6.1: the target repository (a dir group's is its folder's vault).
  const repo = deps.resolveRepository(groupRepoId(deps.store, groupId));
  const run = exportGit(deps, repo);
  const dirBase = frozen === null ? null : await dirBaseOf(deps, groupId, run, frozen);
  const ref = workBranchRef(groupId);
  const existing = await tipOf(run, ref);
  if (existing !== null) {
    const path = await documentCommitPath(run, existing, requirement);
    if (path === null) {
      record(deps, groupId, { ...requirement.export, state: "conflict", detail: `${EXPORT_CONFLICT}:${ref} is at ${existing}` });
      return "conflict";
    }
    record(deps, groupId, { state: "done", path, commit: existing, parent: await revParse(run, `${existing}^`), detail: null }, dirBase);
    return "done";
  }
  // Dir-requirements spec §6.4 step 3: a dir group's document goes on its base (the vault's HEAD is never read).
  const head = dirBase ?? await revParse(run, "HEAD");
  // Controller ruling (Task 11 review): no temporary index and nothing written outside the repository. HEAD's three
  // levels are read with ls-tree, and each changed level is written bottom-up with mktree, every child under the
  // target's own umask, so the objects get the modes git gives them there.
  const root = await listTree(run, `${head}^{tree}`);
  let orca: TreeEntry[], requirements: TreeEntry[];
  try {
    orca = await subtree(run, root, ".orca", ".orca");
    requirements = await subtree(run, orca, "requirements", ".orca/requirements");
  } catch (error) {
    if (!(error instanceof PathBlocked)) throw error;
    // Controller ruling (fix round 2): durable, like a conflict -- the wake is delivered, and recovery-retry re-arms it
    // once the person has changed HEAD.
    record(deps, groupId, { ...requirement.export, state: "conflict", detail: `${EXPORT_PATH_BLOCKED}:${error.message}` });
    return "conflict";
  }
  const taken = (name: string) => requirements.some((entry) => entry.name.equals(Buffer.from(name, "utf8")));
  let suffix = 1;
  while (taken(documentPathOf(requirement.createdOn, requirement.slug, suffix).slice(".orca/requirements/".length))) suffix += 1;
  const path = documentPathOf(requirement.createdOn, requirement.slug, suffix);
  const blob = (await run(["hash-object", "-w", "--stdin", "--no-filters"], { input: text })).trim();
  const requirementsTree = await makeTree(run, requirements, entryOf("100644", "blob", blob, path.slice(".orca/requirements/".length)));
  const orcaTree = await makeTree(run, orca, entryOf("040000", "tree", requirementsTree, "requirements"));
  const tree = await makeTree(run, root, entryOf("040000", "tree", orcaTree, ".orca"));
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
  record(deps, groupId, { state: "done", path, commit, parent: head, detail: null }, dirBase);
  return "done";
}

/** DR14: the driver's pass over undelivered export wakes; the pump has no handler for them, so they wait for the driver. */
export async function exportPendingRequirements(deps: ExportDeps): Promise<boolean> {
  let moved = false;
  for (const row of deps.store.db.prepare("SELECT id,group_id FROM scheduler_wakes WHERE kind='requirement-export' AND delivered=0 ORDER BY rowid").all()) {
    try {
      // Issue-fixes spec §6.3 (Part E ruling 2): an archived group's export waits, its wake undelivered, until unarchived.
      if (isGroupArchived(deps.store, String(row.group_id))) continue;
      const outcome = await exportRequirementDocument(deps, String(row.group_id));
      // Dir-requirements spec §6.4 step 1: a waiting export keeps its wake and is not progress (it never starts a round by
      // itself); the round some other progress starts looks at it again.
      if (outcome === "waiting") continue;
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
