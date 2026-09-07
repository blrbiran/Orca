import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CorrectRejection } from "./rejection.js";

const execFileAsync = promisify(execFile);

/**
 * A byte-for-byte port of ccmem's scripts/lib/project-key.mjs (read
 * 2026-09-07; ccmem is NOT called at runtime — ruling 5 of spec §1). The two
 * regexes are copied verbatim on purpose: this key has to equal the key ccmem
 * derives for the same repository, or cross-project aggregation splits in two
 * without anything failing. The drift risk that copying creates is registered
 * in spec §9 item 4 rather than papered over.
 *
 * ⚠️ ccmem's third branch — the `path:<sha256(cwd)>` fallback for a directory
 * with no remote — is deliberately NOT ported. Upstream spec §4.1 item 3 says
 * a target with no remote URL cannot produce a correction at all, so orca
 * never reaches that branch; implementing it would silently create rows keyed
 * by a local path that no other machine can resolve.
 */
export function normalizeRemoteUrl(remote: string): string {
  if (remote.startsWith("git@")) {
    const match = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (match) {
      const [, host, repo] = match;
      return `${host}/${repo}`;
    }
  }

  const url = new URL(remote);
  return `${url.hostname}${url.pathname.replace(/\.git$/, "")}`;
}

export const TARGET_HAS_NO_REMOTE = "target-has-no-remote";

/**
 * ⚠️ `git config --get remote.origin.url`, not `git remote get-url origin` —
 * the former is what ccmem runs, and the two disagree on repositories where
 * `insteadOf` rewriting is configured.
 */
export async function projectKeyOf(repo: string): Promise<string> {
  const remote = await execFileAsync("git", ["config", "--get", "remote.origin.url"], { cwd: repo })
    .then(({ stdout }) => stdout.trim())
    .catch(() => "");

  if (remote.length === 0) {
    throw new CorrectRejection(
      TARGET_HAS_NO_REMOTE,
      `${repo} has no remote: a correction is keyed by the repository's remote URL (the same key ccmem indexes by), ` +
        `and there is nothing to derive it from here`,
    );
  }

  return normalizeRemoteUrl(remote);
}
