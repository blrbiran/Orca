import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CorrectRejection } from "../corrections/rejection.js";
import { projectKeyOf } from "../corrections/projectKey.js";
import { MetricsRejection } from "./rejection.js";

export const KEY_MATCHES_MULTIPLE_PATHS = "key-matches-multiple-paths";
export const UNRESOLVED_PROJECT_KEYS = "unresolved-project-keys";
export const REPO_PATH_MISSING = "repo-path-missing";

export interface DiscoveredRepo {
  projectKey: string;
  path: string;
}
export interface UnkeyableRepo {
  path: string;
  reason: string;
}
export interface DiscoverOptions {
  root?: string;
  repos: ReadonlyArray<{ projectKey: string; path: string }>;
}

/**
 * spec §2.1: two mechanisms, no persistent registry.
 *
 * Scanning --root catches the well-behaved repository nobody remembered to
 * mention — the one with decisions and zero corrections, which is exactly the
 * one whose absence inflates the correction rate. --repo is a READ-SIDE
 * argument for repositories outside that root, persisted nowhere: a registry
 * would cost a writer, a lock, a slice of Rule 17 surface, and the risk that
 * existing criteria start writing into a real ~/.orca (spec §1.9, §12.2),
 * while buying nothing the gate below does not.
 */
export async function discoverRepos(opts: DiscoverOptions): Promise<{
  repos: DiscoveredRepo[];
  unkeyable: UnkeyableRepo[];
}> {
  const byKey = new Map<string, string[]>();
  const unkeyable: UnkeyableRepo[] = [];

  for (const explicit of opts.repos) {
    const info = await stat(explicit.path).catch(() => undefined);
    if (info === undefined || !info.isDirectory()) {
      // spec §2.1.1 row 4: it contributes zero decisions, so accepting it
      // shrinks the denominator in silence — the same poison as row 1.
      throw new MetricsRejection(
        REPO_PATH_MISSING,
        `--repo ${explicit.projectKey}=${explicit.path}: no such directory. It would contribute 0 decisions, ` +
          `which silently lowers the correction rate's denominator.`,
      );
    }
    push(byKey, explicit.projectKey, explicit.path);
  }

  if (opts.root !== undefined) {
    for (const candidate of await candidateRepos(opts.root)) {
      let key: string;
      try {
        key = await projectKeyOf(candidate);
      } catch (error) {
        // spec §2.1.1 row 2: skip but NAME. A `git clone --local` copy really
        // does appear under a root — this subsystem's own mutation discipline
        // creates them — and refusing the whole command for one copy is out of
        // proportion. Staying silent is the other failure: nobody would ever
        // learn a repository was left out.
        if (error instanceof CorrectRejection) {
          unkeyable.push({ path: candidate, reason: error.message });
          continue;
        }
        throw error;
      }
      push(byKey, key, candidate);
    }
  }

  const repos: DiscoveredRepo[] = [];
  for (const [projectKey, paths] of byKey) {
    const unique = [...new Set(paths)].sort();
    if (unique.length > 1) {
      // spec §2.1.1 row 3: picking one is a GUESS, counting both is double
      // counting, and the gate below can never catch this — it only fires when
      // a key resolves to NOTHING.
      throw new MetricsRejection(
        KEY_MATCHES_MULTIPLE_PATHS,
        `projectKey ${projectKey} resolves to ${unique.length} paths:\n${unique.map((p) => `  ${p}`).join("\n")}\n` +
          `Picking one would be a guess and counting both would double the decisions. ` +
          `Point --repo at the one you mean, or move the other out of --root.`,
      );
    }
    repos.push({ projectKey, path: unique[0] });
  }

  // spec §6 item 2: a total order, never readdir's.
  repos.sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));
  unkeyable.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { repos, unkeyable };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

/**
 * A candidate is a directory holding `.decisions/`. Recursion stops there and
 * at node_modules / .git: a target repo nested inside another target repo's
 * .decisions is not a shape this system creates.
 */
async function candidateRepos(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entries.some((e) => e.isDirectory() && e.name === ".decisions")) {
      found.push(dir);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await walk(join(dir, entry.name), depth + 1);
    }
  };
  await walk(root, 0);
  return found.sort();
}

/**
 * spec §2.1.1 row 1. A correction carries a projectKey and nothing else (§1.2);
 * if that key resolves to no repository, that repository's decisions are
 * missing from the denominator and the correction rate rises with nothing
 * saying so. Refusing by name is the only handling that cannot be misread —
 * and the message says what to do, because the fix is one --repo away.
 */
export function enforceIntegrityGate(
  repos: readonly DiscoveredRepo[],
  keysInStore: readonly string[],
): void {
  const known = new Set(repos.map((r) => r.projectKey));
  const missing = [...new Set(keysInStore)].filter((k) => !known.has(k)).sort();
  if (missing.length === 0) return;

  throw new MetricsRejection(
    UNRESOLVED_PROJECT_KEYS,
    `the corrections store has ${missing.length} projectKey(s) that neither --root nor --repo resolves:\n` +
      `${missing.map((k) => `  ${k}`).join("\n")}\n` +
      `Their decisions are not in the denominator, so the correction rate would read high. ` +
      `Add --repo <projectKey>=<path> for each, or widen --root.`,
  );
}
