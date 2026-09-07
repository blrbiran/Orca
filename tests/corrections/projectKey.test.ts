import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import { TARGET_HAS_NO_REMOTE, normalizeRemoteUrl, projectKeyOf } from "../../src/corrections/projectKey.js";

const execFileAsync = promisify(execFile);

async function repoWithRemote(remote?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orca-pk-"));
  await execFileAsync("git", ["init"], { cwd: dir });
  if (remote !== undefined) {
    await execFileAsync("git", ["remote", "add", "origin", remote], { cwd: dir });
  }
  return dir;
}

describe("projectKey (spec §2.3, ruling 5)", () => {
  // E1a. ⚠️ The mutation for this one does NOT delete the git@ branch:
  // deleting it sends "git@host:p.git" into new URL(), which throws, and a
  // criterion that goes red on a crash proves nothing about the string.
  it("turns an scp-style remote into host/path", () => {
    expect(normalizeRemoteUrl("git@github.com:biran/orca.git")).toBe("github.com/biran/orca");
  });

  // E1b
  it("turns an https remote into host/path and strips .git", () => {
    expect(normalizeRemoteUrl("https://github.com/biran/orca.git")).toBe("github.com/biran/orca");
  });

  // The drift risk registered in spec §9 item 4 made concrete: these are the
  // exact outputs ccmem's scripts/lib/project-key.mjs produces for the same
  // two inputs (read 2026-09-07, not executed — ccmem is not a runtime
  // dependency, ruling 5). If ccmem changes its normaliser, cross-project
  // aggregation silently splits and nothing here goes red; that is the
  // accepted cost, named here so the next reader finds it.
  it("keeps a trailing .git only when it is not the suffix", () => {
    expect(normalizeRemoteUrl("git@github.com:biran/orca.github")).toBe("github.com/biran/orca.github");
  });

  // E2. ⚠️ Message asserted BEFORE the code: an earlier assertion short-circuits
  // the later ones, so what this criterion measures has to come first.
  it("refuses a target with no remote instead of falling back to a path key", async () => {
    const dir = await repoWithRemote();
    const error = await projectKeyOf(dir).then(
      () => { throw new Error("projectKeyOf resolved, but this target has no remote"); },
      (e: unknown) => e,
    );
    expect((error as Error).message).toContain("has no remote");
    expect(error).toBeInstanceOf(CorrectRejection);
    expect((error as CorrectRejection).code).toBe(TARGET_HAS_NO_REMOTE);
    expect((error as CorrectRejection).exitCode).toBe(1);
    // ccmem's fallback shape, which this deliberately does not implement.
    expect((error as Error).message).not.toContain("path:");
  });

  it("reads the remote out of a real repository", async () => {
    const dir = await repoWithRemote("https://github.com/biran/orca.git");
    expect(await projectKeyOf(dir)).toBe("github.com/biran/orca");
  });
});
