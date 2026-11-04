import { MAX_PACKAGE_BYTES, packageOf, workspaceDirs } from "./requirementManifests.js";
import { GIT_READ_TIMEOUT_MS, readBlobs, treeOf, type TreeEntry } from "./requirementOverview.js";

/** Task setup spec §4.3: one `npm test` / `npm run <s>` part of a command, and the workspace it names (null: the root). */
export type NpmPart = { script: string; workspace: string | null };
export type NpmCommand = { kind: "npm"; parts: NpmPart[] } | { kind: "unverifiable" };

/** A script or workspace token: no shell syntax, no quoting, not a flag. Anything else makes the command unverifiable. */
const NAME = /^[A-Za-z0-9@._:+/][A-Za-z0-9@._:+/-]*$/;

function partOf(text: string): NpmPart | null {
  const tokens = text.trim().split(/\s+/);
  if (tokens[0] !== "npm") return null;
  const subcommand = tokens[1];
  const rest = tokens.slice(2);
  let workspace: string | null = null;
  const positional: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]!;
    let named: string | undefined;
    if (token === "--workspace" || token === "-w") named = rest[++index];
    else if (token.startsWith("--workspace=")) named = token.slice("--workspace=".length);
    else if (NAME.test(token)) { positional.push(token); continue; }
    else return null;
    if (workspace !== null || named === undefined || !NAME.test(named)) return null;
    workspace = named;
  }
  if (subcommand === "test" && positional.length === 0) return { script: "test", workspace };
  if ((subcommand === "run" || subcommand === "run-script") && positional.length === 1) return { script: positional[0]!, workspace };
  return null;
}

/**
 * Spec §4.3: a command is verifiable only when every `&&` part is exactly `npm test`, `npm run <s>` or `npm run-script
 * <s>`, each with at most one `--workspace <w>` / `--workspace=<w>` / `-w <w>` after the subcommand. One part of any
 * other shape (a `cd`, an env prefix, `--` arguments, another flag) makes the whole command unverifiable: its npm parts
 * may run somewhere else or with something else, so code cannot say they would fail.
 */
export function classifyNpmCommand(command: string): NpmCommand {
  const parts = command.split("&&").map(partOf);
  return parts.every((part): part is NpmPart => part !== null) ? { kind: "npm", parts } : { kind: "unverifiable" };
}

const manifestPath = (dir: string): string => (dir === "" ? "package.json" : `${dir}/package.json`);
const pathOf = (workspace: string): string => workspace.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
/** npm's own `run` subcommands that need no script (`npm run env` lists the environment). */
const BUILT_IN_SCRIPTS: ReadonlySet<string> = new Set(["env"]);

/**
 * Spec §4.3: null when the command is unverifiable or every part names a script that exists; else `command:<command>:
 * <what is missing>` for the first part that does not. Read from the overview's commit itself, never the disk and never
 * the (cut) manifests view: the task starts from that commit. A workspace is one the root package.json lists, named by
 * its path or by its package's `name` (Review Focus 1), as npm accepts both. Code refuses only what it can tell npm
 * would refuse, so these leave the command unverifiable (null): `-w .` (the root) and `-w <dir>` for a directory
 * holding workspaces (npm selects every workspace under it); a package.json that cannot be read, is too large or does
 * not parse; a commit whose tree cannot be read. `npm run env` is npm's built-in, so it is not looked up.
 * `tree` is the commit's tree when the caller already has it (validateSplitDraft reads it once per draft).
 */
export async function npmCommandReason(repo: string, commit: string, command: string, tree?: readonly TreeEntry[]): Promise<string | null> {
  const classified = classifyNpmCommand(command);
  if (classified.kind === "unverifiable") return null;
  let entries = tree;
  if (entries === undefined) {
    try { entries = await treeOf(repo, commit); } catch { return null; }
  }
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  // undefined: no package.json there; null: one that cannot be read, is too large or does not parse.
  const packages = new Map<string, ReturnType<typeof packageOf> | undefined>();
  // Every dir not read yet is read in one `git cat-file --batch` (a by-name lookup reads all workspaces at once).
  const load = async (dirs: readonly string[]): Promise<void> => {
    const wanted = dirs.filter((dir) => !packages.has(dir));
    for (const dir of wanted) if (!byPath.has(manifestPath(dir))) packages.set(dir, undefined);
    const present = wanted.filter((dir) => byPath.has(manifestPath(dir)));
    if (present.length === 0) return;
    try {
      const blobs = await readBlobs(repo, present.map((dir) => byPath.get(manifestPath(dir))!.oid), MAX_PACKAGE_BYTES + 1, GIT_READ_TIMEOUT_MS);
      present.forEach((dir, index) => packages.set(dir, blobs[index]!.length > MAX_PACKAGE_BYTES ? null : packageOf(blobs[index]!)));
    } catch { for (const dir of present) packages.set(dir, null); }
  };
  const packageAt = async (dir: string): Promise<ReturnType<typeof packageOf> | undefined> => { await load([dir]); return packages.get(dir); };
  const root = await packageAt("");
  const missing = (what: string): string => `command:${command}: ${what}`;
  if (root === null) return null;
  if (root === undefined) return missing("there is no package.json at the root");
  const dirs = workspaceDirs(root.workspaces ?? [], [...entries]);
  for (const part of classified.parts) {
    let dir = "";
    if (part.workspace !== null) {
      const path = pathOf(part.workspace);
      if (path === "" || path === ".") return null;
      let found = dirs.find((candidate) => candidate === path);
      let unreadable = false;
      if (found === undefined) {
        await load(dirs);
        found = dirs.find((candidate) => packages.get(candidate)?.name === part.workspace);
        unreadable = dirs.some((candidate) => packages.get(candidate) === null);
      }
      if (found === undefined) {
        if (unreadable || dirs.some((candidate) => candidate.startsWith(`${path}/`))) return null;
        return missing(`"${part.workspace}" is not a workspace of the root package.json`);
      }
      dir = found;
    }
    if (BUILT_IN_SCRIPTS.has(part.script)) continue;
    // A workspace dir always has a package.json (workspaceDirs lists only those), so only "unreadable" is left to rule out.
    const found = dir === "" ? root : await packageAt(dir);
    if (found === null || found === undefined) return null;
    if (!Object.hasOwn(found.scripts, part.script)) {
      return missing(dir === "" ? `the root package.json has no script "${part.script}"` : `workspace ${part.workspace} (${manifestPath(dir)}) has no script "${part.script}"`);
    }
  }
  return null;
}
