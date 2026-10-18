import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, gitBytes } from "../scheduler/gitExec.js";
import { QUIET_GIT } from "./workspace.js";

/**
 * Control run decisions plan Task 6: a reconciled landing's tree is the reconciling agent's, built by commit-tree with
 * no worktree to write into. These two put ledger files into such a tree through a temporary index, so neither the
 * copy's own index nor any checkout is touched.
 */

/** Every top-level `.decisions/*.jsonl` blob of `treeish`, written byte for byte into `into`. */
export async function exportLedgerDir(repo: string, treeish: string, into: string): Promise<void> {
  const listing = await git(repo, [...QUIET_GIT, "ls-tree", "-z", treeish, "--", ".decisions/"]);
  for (const entry of listing.split("\0").filter(Boolean)) {
    // `<mode> <type> <object>\t<path>`: a subdirectory or a non-.jsonl file is not a ledger.
    const [meta, path] = entry.split("\t") as [string, string];
    const name = path.slice(".decisions/".length);
    if (meta.split(" ")[1] !== "blob" || !name.endsWith(".jsonl")) continue;
    await writeFile(join(into, name), await gitBytes(repo, [...QUIET_GIT, "show", `${treeish}:${path}`]));
  }
}

/** `baseTree` with `.decisions/<name>` replaced (or added) by `fromDir/<name>` for every name given; the new tree's id. */
export async function treeWithLedgerFiles(repo: string, baseTree: string, fromDir: string, names: string[]): Promise<string> {
  const indexDir = await mkdtemp(join(tmpdir(), "orca-ledger-index-"));
  const env = { GIT_INDEX_FILE: join(indexDir, "index") };
  try {
    await git(repo, [...QUIET_GIT, "read-tree", baseTree], { env });
    for (const name of names) {
      const blob = (await git(repo, [...QUIET_GIT, "hash-object", "-w", "--no-filters", join(fromDir, name)])).trim();
      await git(repo, [...QUIET_GIT, "update-index", "--add", "--cacheinfo", `100644,${blob},.decisions/${name}`], { env });
    }
    return (await git(repo, [...QUIET_GIT, "write-tree"], { env })).trim();
  } finally {
    await rm(indexDir, { recursive: true, force: true });
  }
}
