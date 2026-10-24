import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { git, gitBytes } from "../scheduler/gitExec.js";
import { isDirGroup } from "./dirGroup.js";
import { ControlError } from "./errors.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { readGroup } from "./queries.js";
import type { ControlStore } from "./store.js";
import { QUIET_GIT } from "./workspace.js";

/**
 * Control run decisions plan Task 8: a decision lives in a ledger file that moves from the group branch to the
 * integration target (and into a checkout of it). The group's decisions view reads every place it can be, in order,
 * from git objects -- never by checking anything out.
 */
export type DecisionWhere = "working-tree" | "target" | "group-branch";
export type LedgerSource = { where: DecisionWhere; ref: string | null };
export type LedgerLine = { path: string; value: unknown };

/** Every non-blank line of `text` that parses as JSON; an unparseable one is skipped, as readLedgerLeniently does. */
function parseLines(path: string, text: string): LedgerLine[] {
  const lines: LedgerLine[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try { lines.push({ path, value: JSON.parse(line) }); } catch { /* not a ledger line */ }
  }
  return lines;
}

/** Every `.decisions/**\/*.jsonl` line at `ref` (archives included); null when the ref does not resolve to a commit. */
export async function readLedgerAtRef(repo: string, ref: string): Promise<LedgerLine[] | null> {
  let commit: string;
  try { commit = (await git(repo, [...QUIET_GIT, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim(); }
  catch { return null; }
  const listing = await git(repo, [...QUIET_GIT, "ls-tree", "-r", "-z", commit, "--", ".decisions/"]);
  const lines: LedgerLine[] = [];
  for (const entry of listing.split("\0").filter(Boolean)) {
    // `<mode> <type> <object>\t<path>`
    const tab = entry.indexOf("\t");
    const path = entry.slice(tab + 1);
    const [, type, object] = entry.slice(0, tab).split(" ");
    if (type !== "blob" || !path.endsWith(".jsonl")) continue;
    lines.push(...parseLines(path, (await gitBytes(repo, [...QUIET_GIT, "cat-file", "blob", object!])).toString("utf8")));
  }
  return lines;
}

/** The same file set in the working tree of `repo`; a missing `.decisions/` is no lines. */
async function readLedgerInWorkingTree(repo: string): Promise<LedgerLine[]> {
  const lines: LedgerLine[] = [];
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(join(repo, relative), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
      throw error;
    });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) lines.push(...parseLines(path, await readFile(join(repo, path), "utf8")));
    }
  };
  await walk(".decisions");
  return lines;
}

/** One source's lines: the working tree for a null ref, else the ref's tree (none when it does not resolve). */
export async function readSource(repo: string, source: LedgerSource): Promise<LedgerLine[]> {
  return source.ref === null ? readLedgerInWorkingTree(repo) : (await readLedgerAtRef(repo, source.ref)) ?? [];
}

/**
 * Cross-plan resolution 4: the group's integration target as a ref of the target repository -- `refs/heads/<target>`
 * for `local`, `refs/remotes/<remote>/<target>` for the push schemes, null under `keep` (no record).
 */
export async function integrationTargetRef(store: ControlStore, groupId: string): Promise<string | null> {
  const integration = readGroupIntegration(readGroup(store, groupId));
  if (integration === null) return null;
  const { scheme } = integration;
  if (scheme.delivery === "keep") return null;
  return scheme.delivery === "local" ? `refs/heads/${scheme.target}` : `refs/remotes/${scheme.remote}/${scheme.target}`;
}

/**
 * Where a group's decision can be, in the order the first holder wins: working tree, integration target, group branch.
 * Dir-requirements spec §10: a dir group's ledger lives only on its work branch in the (bare) vault -- no working tree,
 * no integration target. Its base is an import with `.decisions/` left out, so every ledger line on the branch was added
 * by a landing of the group; a base that holds one is a broken invariant (Rule 12).
 */
export async function ledgerSources(store: ControlStore, repo: string, groupId: string): Promise<LedgerSource[]> {
  if (isDirGroup(store, groupId)) {
    let base: string | null;
    try { base = (await git(repo, [...QUIET_GIT, "rev-parse", "--verify", "--quiet", `refs/orca/group/${groupId}/base^{commit}`])).trim(); }
    catch { base = null; } // not exported yet: no base, and no branch to read either
    if (base !== null && (await git(repo, [...QUIET_GIT, "ls-tree", base, "--", ".decisions/"])).trim() !== "") {
      throw new ControlError("recovery-blocked", `dir-base-holds-decisions:${groupId}`);
    }
    return [{ where: "group-branch", ref: `refs/heads/orca/${groupId}` }];
  }
  const target = await integrationTargetRef(store, groupId);
  return [
    { where: "working-tree", ref: null },
    ...(target === null ? [] : [{ where: "target" as const, ref: target }]),
    { where: "group-branch", ref: `refs/heads/orca/${groupId}` },
  ];
}

const decisionId = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null || (value as { ev?: unknown }).ev !== "decision") return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
};

/** The first source (in the order given) holding a decision line with `id`, and that line. */
export async function findDecision(repo: string, sources: readonly LedgerSource[], id: string): Promise<{ where: DecisionWhere; value: unknown } | null> {
  for (const source of sources) {
    const hit = (await readSource(repo, source)).find((line) => decisionId(line.value) === id);
    if (hit !== undefined) return { where: source.where, value: hit.value };
  }
  return null;
}

/** Every decision line of every source, each id labelled by the first source holding it (its line from that source). */
export async function labelDecisions(repo: string, sources: readonly LedgerSource[]): Promise<{
  first: Map<string, { where: DecisionWhere; value: unknown }>; lines: Array<{ path: string; id: string }>;
}> {
  const first = new Map<string, { where: DecisionWhere; value: unknown }>();
  const lines: Array<{ path: string; id: string }> = [];
  for (const source of sources) {
    for (const line of await readSource(repo, source)) {
      const id = decisionId(line.value);
      if (id === null) continue;
      lines.push({ path: line.path, id });
      if (!first.has(id)) first.set(id, { where: source.where, value: line.value });
    }
  }
  return { first, lines };
}
