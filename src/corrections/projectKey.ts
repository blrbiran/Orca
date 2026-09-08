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
 * A remote exists but is not a shape `normalizeRemoteUrl` can turn into a
 * key (round-4 review, item 3). `new URL(remote)` throws for a path-style
 * remote — `/tmp/some/bare.git`, `../sibling.git`, exactly what
 * `git clone --local` / `git clone /path` leave behind — and for a
 * colon-less `git@host` that does not match the scp-style regex either.
 * ccmem has no normalisation for these shapes either (it throws the same
 * way), so this is deliberately a refusal, not an invented key: "you have no
 * remote" (TARGET_HAS_NO_REMOTE) would be a different and misleading
 * diagnosis for "your remote is not URL-shaped".
 */
export const TARGET_REMOTE_NOT_KEYABLE = "target-remote-not-keyable";

/**
 * ⚠️ `git config --get remote.origin.url`, not `git remote get-url origin` —
 * the former is what ccmem runs, and the two disagree on repositories where
 * `insteadOf` rewriting is configured.
 */
export async function projectKeyOf(repo: string): Promise<string> {
  const remote = await readOriginRemote(repo);

  if (remote.length === 0) {
    throw new CorrectRejection(
      TARGET_HAS_NO_REMOTE,
      `${repo} has no remote: a correction is keyed by the repository's remote URL (the same key ccmem indexes by), ` +
        `and there is nothing to derive it from here`,
    );
  }

  try {
    return normalizeRemoteUrl(remote);
  } catch (err) {
    throw new CorrectRejection(
      TARGET_REMOTE_NOT_KEYABLE,
      `${repo}'s remote is ${JSON.stringify(remote)}, which is not a URL orca can key a correction by ` +
        `(a correction is keyed by the repository's remote URL): ${(err as Error).message.trim()}`,
    );
  }
}

/**
 * `git config --get` exits 1 with empty stdout when the key is simply
 * unset — that, and only that, is folded into "" (genuinely no remote,
 * handled by the caller above). Any other failure — git not installed, the
 * directory unreadable, a corrupt config — is a different problem and must
 * say so rather than being reported as "has no remote" (round-4 review, item
 * 3 minor: `.catch(() => "")` used to collapse every one of these).
 */
async function readOriginRemote(repo: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "--get", "remote.origin.url"], { cwd: repo });
    return stdout.trim();
  } catch (err) {
    const execErr = err as { code?: unknown; stdout?: string };
    if (execErr.code === 1 && (execErr.stdout ?? "").trim().length === 0) {
      return "";
    }
    throw new CorrectRejection(
      TARGET_HAS_NO_REMOTE,
      `${repo}: could not read remote.origin.url: ${(err as Error).message.trim()}`,
    );
  }
}
