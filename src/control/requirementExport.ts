import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ControlError } from "./errors.js";
import { privateDirectory } from "./paths.js";
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
 * bounded. None of the commands below checks anything out, so no smudge filter can run; hash-object, the one that reads
 * a file, is given --no-filters.
 */
function exportGit(deps: ExportDeps, repo: string) {
  const timeoutMs = deps.gitTimeoutMs ?? GIT_EXPORT_TIMEOUT_MS;
  return async (args: string[], options: Omit<GitOptions, "timeoutMs"> = {}): Promise<string> => git(repo, [...QUIET_GIT, ...args], { ...options, timeoutMs });
}
type ExportGit = ReturnType<typeof exportGit>;
const revParse = async (run: ExportGit, rev: string): Promise<string> => (await run(["rev-parse", "--verify", `${rev}^{commit}`])).trim();
const tipOf = async (run: ExportGit, ref: string): Promise<string | null> => revParse(run, ref).catch(() => null);
const exists = async (run: ExportGit, commit: string, path: string): Promise<boolean> => {
  try { await run(["cat-file", "-e", `${commit}:${path}`]); return true; } catch { return false; }
};

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
 * N1 spec §9.2: git plumbing only -- hash-object, a temporary index under Orca's state directory, write-tree,
 * commit-tree on HEAD, and a create-only update-ref of orca/<groupId>. The person's working tree and index are never read
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
  let suffix = 1;
  while (await exists(run, head, documentPathOf(requirement.createdOn, requirement.slug, suffix))) suffix += 1;
  const path = documentPathOf(requirement.createdOn, requirement.slug, suffix);
  // Spec §13 and §15 item 5: the temporary index and the two scratch files live beside each other under the control
  // state directory, 0700 / 0600 (PR-I6); a crash leaves them, and the next attempt removes them first.
  const scratch = privateDirectory(`${deps.store.stateDir}.overview`);
  const indexFile = join(scratch, `index-${groupId}`), documentFile = join(scratch, `document-${groupId}.md`), messageFile = join(scratch, `message-${groupId}.txt`);
  const scratchFiles = [indexFile, documentFile, messageFile];
  try {
    for (const file of scratchFiles) await rm(file, { force: true });
    await writeFile(documentFile, text, { mode: 0o600, flag: "wx" });
    await writeFile(messageFile, `docs(requirements): ${requirement.slug}\n\n${TRAILER}: ${requirement.document.sha256}\n`, { mode: 0o600, flag: "wx" });
    const blob = (await run(["hash-object", "-w", "--no-filters", "--", documentFile])).trim();
    const index = { env: { GIT_INDEX_FILE: indexFile }, privateFiles: true };
    await run(["read-tree", `${head}^{tree}`], index);
    await run(["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], index);
    const tree = (await run(["write-tree"], index)).trim();
    // DR21: dated at the freeze, so a re-run builds the same commit. commit-tree signs only with -S: a target's
    // commit.gpgSign is not read (measured on git 2.50.1; the criterion pins that no signing program runs).
    const at = requirement.document.frozenAt;
    const commit = (await run(["commit-tree", tree, "-p", head, "-F", messageFile], { env: {
      GIT_AUTHOR_NAME: "Orca", GIT_AUTHOR_EMAIL: "orca@localhost", GIT_COMMITTER_NAME: "Orca", GIT_COMMITTER_EMAIL: "orca@localhost", GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at,
    } })).trim();
    try { await run(["update-ref", ref, commit, ""]); }
    catch (error) {
      // Created concurrently: whatever is there now is judged like any existing branch. Any other failure is thrown.
      if ((await tipOf(run, ref)) === null) throw error;
      return exportRequirementDocument(deps, groupId);
    }
    record(deps, groupId, { state: "done", path, commit, parent: head, detail: null });
    return "done";
  } finally {
    for (const file of scratchFiles) await rm(file, { force: true });
  }
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
