import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import { TARGET_REMOTE_NOT_KEYABLE, projectKeyOf } from "../../src/corrections/projectKey.js";

const execFileAsync = promisify(execFile);

async function repoWithRemote(remote: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orca-pk-nk-"));
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: dir });
  return dir;
}

/**
 * Round-4 review, item 3 (IMPORTANT). `new URL(remote)` throws for an
 * ordinary path-style remote — measured for `/tmp/some/bare.git`,
 * `../sibling.git`, and a colon-less `git@github.com` — and a path-style
 * origin is exactly what `git clone --local` / `git clone /path` produce.
 * Because `projectKeyOf` sits in the preflight both `orca correct` modes
 * share, such a repository used to kill the whole command: exit 3, a stack
 * trace, instead of a named refusal.
 *
 * `normalizeRemoteUrl`'s regexes are NOT changed (ccmem's key must match
 * for every remote ccmem can handle, and ccmem has no fallback for these
 * shapes either — it throws the same way). The fix wraps the failure and
 * refuses by a NEW name, `TARGET_REMOTE_NOT_KEYABLE`, rather than reusing
 * `TARGET_HAS_NO_REMOTE` — "you have no remote" would be a misleading
 * diagnosis for "your remote is not URL-shaped". Message asserted before
 * code, per this file's neighbour projectKey.test.ts: an earlier assertion
 * short-circuits later ones, so what a criterion measures has to come
 * first. Mutation: remove the wrapper ⇒ red on the message assertion (a bare
 * TypeError has no `.code` property to read).
 */
describe("projectKey — a remote that is not URL-shaped is a named refusal, not a crash (round-4 review, item 3)", () => {
  it("refuses a path-style remote (the git clone --local shape) by name", async () => {
    const dir = await repoWithRemote("/tmp/some/bare.git");
    const error = await projectKeyOf(dir).then(
      () => { throw new Error("projectKeyOf resolved for a path-style remote"); },
      (e: unknown) => e,
    );
    expect((error as Error).message).toContain("/tmp/some/bare.git");
    expect((error as Error).message).toContain("remote URL");
    expect(error).toBeInstanceOf(CorrectRejection);
    expect((error as CorrectRejection).code).toBe(TARGET_REMOTE_NOT_KEYABLE);
    expect((error as CorrectRejection).exitCode).toBe(1);
  });

  it("refuses a colon-less git@host remote by name", async () => {
    const dir = await repoWithRemote("git@github.com");
    const error = await projectKeyOf(dir).then(
      () => { throw new Error("projectKeyOf resolved for a colon-less git@ remote"); },
      (e: unknown) => e,
    );
    expect((error as Error).message).toContain("git@github.com");
    expect((error as Error).message).toContain("remote URL");
    expect(error).toBeInstanceOf(CorrectRejection);
    expect((error as CorrectRejection).code).toBe(TARGET_REMOTE_NOT_KEYABLE);
  });
});
