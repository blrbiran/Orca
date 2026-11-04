import { MAX_PACKAGE_BYTES, packageOf, workspaceDirs } from "./requirementManifests.js";
import { GIT_READ_TIMEOUT_MS, readBlobs, treeOf } from "./requirementOverview.js";

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

/**
 * Spec §4.3: null when the command is unverifiable or every part names a script that exists; else `command:<command>:
 * <what is missing>` for the first part that does not. Read from the overview's commit itself, never the disk and never
 * the (cut) manifests view: the task starts from that commit. A workspace is one the root package.json lists, named by
 * its path or by its package's `name` (Review Focus 1), as npm accepts both.
 */
export async function npmCommandReason(repo: string, commit: string, command: string): Promise<string | null> {
  const classified = classifyNpmCommand(command);
  if (classified.kind === "unverifiable") return null;
  const tree = await treeOf(repo, commit);
  const byPath = new Map(tree.map((entry) => [entry.path, entry]));
  const packages = new Map<string, ReturnType<typeof packageOf>>();
  const packageAt = async (dir: string): Promise<ReturnType<typeof packageOf>> => {
    if (!packages.has(dir)) {
      const entry = byPath.get(manifestPath(dir));
      const bytes = entry === undefined ? null : (await readBlobs(repo, [entry.oid], MAX_PACKAGE_BYTES + 1, GIT_READ_TIMEOUT_MS))[0]!;
      packages.set(dir, bytes === null || bytes.length > MAX_PACKAGE_BYTES ? null : packageOf(bytes));
    }
    return packages.get(dir)!;
  };
  const root = await packageAt("");
  const missing = (what: string): string => `command:${command}: ${what}`;
  if (root === null) return missing("there is no package.json at the root");
  const dirs = workspaceDirs(root.workspaces ?? [], tree);
  for (const part of classified.parts) {
    let dir = "";
    if (part.workspace !== null) {
      const byName = async (): Promise<string | undefined> => {
        for (const candidate of dirs) if ((await packageAt(candidate))?.name === part.workspace) return candidate;
        return undefined;
      };
      const found = dirs.find((candidate) => candidate === pathOf(part.workspace!)) ?? (await byName());
      if (found === undefined) return missing(`"${part.workspace}" is not a workspace of the root package.json`);
      dir = found;
    }
    const scripts = (dir === "" ? root : await packageAt(dir))?.scripts ?? {};
    if (!Object.hasOwn(scripts, part.script)) {
      return missing(dir === "" ? `the root package.json has no script "${part.script}"` : `workspace ${part.workspace} (${manifestPath(dir)}) has no script "${part.script}"`);
    }
  }
  return null;
}
