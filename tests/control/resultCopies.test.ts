import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { archiveRun } from "../../src/control/archive.js";
import { removeResultCopies } from "../../src/control/cleanup.js";
import { verifySnapshot } from "../../src/control/snapshot.js";
import { archiveCase } from "./fixtures/archive.js";

/**
 * Change-sized runs spec 2026-11-19 §5.6 (P0-4): `<sourceDir>/repo` is the one repository-sized copy P0 deletes, and the
 * deletion cannot be undone. One criterion per row of the guard table, each naming the mutation that deletes its branch.
 * The keep branches are judged as carefully as the delete branch (Rule 17): every refusal checks that the copy is still
 * there, byte for byte.
 */
type Case = Awaited<ReturnType<typeof archiveCase>>;
const setState = (h: Case, state: string) => h.store.db.prepare("UPDATE runs SET body=json_set(body,'$.state',?) WHERE id=?").run(state, h.claim.runId);
const archive = (h: Case) => archiveRun(h.store, { runId: h.claim.runId, sourceDir: h.sourceDir, repoDir: h.repoDir, stopProof: h.stopProof });
const latestRow = (h: Case) => JSON.parse(String(h.store.db.prepare("SELECT body FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=? ORDER BY rowid DESC LIMIT 1").get(h.claim.runId)!.body)) as { snapshot: { artifactId: string; hash: string } | null; missing: string[] };
async function extras(h: Case) {
  await mkdir(join(h.sourceDir, "repos", "beta"), { recursive: true });
  await writeFile(join(h.sourceDir, "repos", "beta", "x.txt"), "extra\n");
}
/** The copy is untouched: same entries and the same bytes in the file the fixture wrote. */
async function copyIntact(h: Case) {
  expect(readdirSync(h.repoDir).sort()).toEqual([".git", ".gitignore", "binary", "executable", "ignored", "link", "tracked"]);
  expect(await readFile(join(h.repoDir, "tracked"), "utf8")).toBe("WORKTREE\n");
}

describe("removeResultCopies (change-sized runs §5.6)", { timeout: 30_000 }, () => {
  // M4.1: ignore `extras` (always remove repos/) -> the first call removes repos/, red
  it("removes repo, and repos only when asked, once a complete archive holds it", async () => {
    const h = await archiveCase();
    try {
      await extras(h);
      const archived = await archive(h);
      expect(archived.missing).toEqual([]);
      setState(h, "settled-failed");
      expect(await removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: false })).toEqual({ removed: [h.repoDir], kept: null });
      expect(existsSync(h.repoDir)).toBe(false);
      expect(await readFile(join(h.sourceDir, "repos", "beta", "x.txt"), "utf8")).toBe("extra\n");
      expect(await removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: true })).toEqual({ removed: [join(h.sourceDir, "repos")], kept: null });
      expect(existsSync(join(h.sourceDir, "repos"))).toBe(false);
      // The source directory and its logs stay; the evidence is whole without the copy.
      expect(await readFile(join(h.sourceDir, "stdout.log"), "utf8")).toBe("raw stdout.log\n");
      await verifySnapshot(h.store, archived.snapshot!);
    } finally { await h.dispose(); }
  });

  it("is idempotent: a second call removes nothing and does not throw", async () => {
    const h = await archiveCase();
    try {
      await archive(h);
      setState(h, "settled");
      expect((await removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: true })).removed).toEqual([h.repoDir]);
      expect(await removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: true })).toEqual({ removed: [], kept: null });
      expect(existsSync(h.sourceDir)).toBe(true);
    } finally { await h.dispose(); }
  });

  // M4.2: skip the row check -> the copy is removed, red
  it("throws result-copy-unarchived and removes nothing when the run has no archive row", async () => {
    const h = await archiveCase();
    try {
      await archive(h);
      setState(h, "settled-failed");
      h.store.db.prepare("DELETE FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=?").run(h.claim.runId);
      await expect(removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: true })).rejects.toThrow("result-copy-unarchived");
      await copyIntact(h);
    } finally { await h.dispose(); }
  });

  // M4.3: drop the completeness check -> the copy is removed although the archive does not hold all of it, red
  it("keeps the copies when the latest archive is partial", async () => {
    const h = await archiveCase();
    try {
      execFileSync("mkfifo", [join(h.sourceDir, "pipe")]);
      await extras(h);
      const archived = await archive(h);
      expect(archived.missing).toContain("special:pipe");
      expect(latestRow(h).missing).toContain("special:pipe");
      setState(h, "settled-failed");
      expect(await removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: true })).toEqual({ removed: [], kept: "archive-partial" });
      await copyIntact(h);
      expect(existsSync(join(h.sourceDir, "repos", "beta", "x.txt"))).toBe(true);
    } finally { await h.dispose(); }
  });

  // M4.4: drop the state check -> an active run loses its copy, red
  it("throws result-copy-run-active for a run that is not terminal", async () => {
    const h = await archiveCase();
    try {
      await archive(h);
      for (const state of ["running", "accepted", "landed", "blocked"]) {
        setState(h, state);
        await expect(removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: true }), state).rejects.toThrow("result-copy-run-active");
        await copyIntact(h);
      }
    } finally { await h.dispose(); }
  });

  // M4.5: drop the identity check -> the copy in the replaced directory is removed, red
  it("throws cleanup-source-reused when the source directory was replaced", async () => {
    const h = await archiveCase();
    try {
      await archive(h);
      setState(h, "settled");
      await rename(h.sourceDir, `${h.sourceDir}-moved`);
      await mkdir(join(h.sourceDir, "repo"), { recursive: true });
      await writeFile(join(h.sourceDir, "repo", "someone-elses.txt"), "keep\n");
      await expect(removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: true })).rejects.toThrow("cleanup-source-reused");
      expect(await readFile(join(h.sourceDir, "repo", "someone-elses.txt"), "utf8")).toBe("keep\n");
      expect(await readFile(join(`${h.sourceDir}-moved`, "repo", "tracked"), "utf8")).toBe("WORKTREE\n");
    } finally { await h.dispose(); }
  });

  // M4.6: drop the lstat symlink check -> the link is removed, red
  it("refuses a repo that is a symlink and leaves the link and its target alone", async () => {
    const h = await archiveCase();
    try {
      await archive(h);
      setState(h, "settled");
      const outside = join(h.root, "outside-repo");
      await rename(h.repoDir, outside);
      await symlink(outside, h.repoDir);
      await expect(removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: true })).rejects.toThrow("cleanup-path-invalid");
      expect(lstatSync(h.repoDir).isSymbolicLink()).toBe(true);
      expect(await readFile(join(outside, "tracked"), "utf8")).toBe("WORKTREE\n");
    } finally { await h.dispose(); }
  });

  // P0 review M3. M4.7: read the oldest row (ORDER BY rowid ASC) -> the older complete row lets the copy go, red
  it("keeps the copies when an older row is complete but the latest is partial", async () => {
    const h = await archiveCase();
    try {
      expect((await archive(h)).missing).toEqual([]);
      execFileSync("mkfifo", [join(h.sourceDir, "pipe")]);
      expect((await archive(h)).missing).toContain("special:pipe");
      expect(Number(h.store.db.prepare("SELECT count(*) AS n FROM outbox WHERE kind='archive' AND json_extract(body,'$.runId')=?").get(h.claim.runId)!.n)).toBe(2);
      setState(h, "settled-failed");
      expect(await removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: true })).toEqual({ removed: [], kept: "archive-partial" });
      await copyIntact(h);
    } finally { await h.dispose(); }
  });

  // P0 review M3: a source directory not named for the run is refused, and nothing in it is removed. Three path tests
  // refuse it, each alone: the basename, the parent-realpath join and the realpath after lstat (archiveRun recorded a
  // source named for the run, so the latter two fail for any other name). Dropping one or two leaves this green (seen);
  // M4.10: drop all three -> the identity test refuses instead (cleanup-source-reused), red on the named code.
  it("throws cleanup-path-invalid for a source directory not named for the run, and removes nothing", async () => {
    const h = await archiveCase();
    try {
      await archive(h);
      setState(h, "settled");
      const other = `${h.sourceDir}-other`;
      await mkdir(join(other, "repo"), { recursive: true });
      await writeFile(join(other, "repo", "someone-elses.txt"), "keep\n");
      await expect(removeResultCopies(h.store, h.claim.runId, other, { extras: true })).rejects.toThrow("cleanup-path-invalid");
      expect(await readFile(join(other, "repo", "someone-elses.txt"), "utf8")).toBe("keep\n");
      await copyIntact(h);
    } finally { await h.dispose(); }
  });

  // P0 review M3. M4.8: drop the not-a-directory check -> the file is removed, red
  it("refuses a repo that is a regular file and leaves it alone", async () => {
    const h = await archiveCase();
    try {
      await archive(h);
      setState(h, "settled");
      await rename(h.repoDir, join(h.root, "moved-repo"));
      await writeFile(h.repoDir, "a file, not a copy\n");
      await expect(removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: false })).rejects.toThrow("cleanup-path-invalid");
      expect(await readFile(h.repoDir, "utf8")).toBe("a file, not a copy\n");
    } finally { await h.dispose(); }
  });

  // P0 review M3. M4.9: drop the symlink check -> the repos link is removed (and repo with it), red
  it("refuses a repos that is a symlink, and removes neither it, its target nor repo", async () => {
    const h = await archiveCase();
    try {
      await archive(h);
      setState(h, "settled");
      const outside = join(h.root, "outside-repos");
      await mkdir(join(outside, "beta"), { recursive: true });
      await writeFile(join(outside, "beta", "x.txt"), "extra\n");
      await symlink(outside, join(h.sourceDir, "repos"));
      await expect(removeResultCopies(h.store, h.claim.runId, h.sourceDir, { extras: true })).rejects.toThrow("cleanup-path-invalid");
      expect(lstatSync(join(h.sourceDir, "repos")).isSymbolicLink()).toBe(true);
      expect(await readFile(join(outside, "beta", "x.txt"), "utf8")).toBe("extra\n");
      await copyIntact(h);
    } finally { await h.dispose(); }
  });
});
