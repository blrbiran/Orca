import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import { CORRECTIONS_DIR_MODE, storeLockDir } from "../../src/corrections/paths.js";
import { CORRECTIONS_STORE_BUSY, acquireStoreLock } from "../../src/corrections/storeLock.js";

const tempDir = () => mkdtemp(join(tmpdir(), "orca-lock-"));

describe("corrections store lock (spec §7.2 / §7.3 / §14.8)", () => {
  // §14.8 (I3): repoLock's non-recursive mkdir is safe only because
  // <repo>/.git is guaranteed to exist. ORCA_CORRECTIONS_DIR is not — on a
  // fresh machine the very first `orca correct` used to die on
  // "ENOENT: … mkdir '…/.orca/.corrections-lock'".
  it("creates the store directory before the lock directory inside it", async () => {
    const parent = await tempDir();
    const dir = join(parent, "nested", ".orca");
    const lock = await acquireStoreLock(dir);
    try {
      expect(existsSync(storeLockDir(dir))).toBe(true);
    } finally {
      await lock.release();
    }
  });

  // E7: exclusive, and the second attempt does NOT overwrite the first's info.
  it("refuses a second holder and leaves the first holder's info intact", async () => {
    const dir = await tempDir();
    const first = await acquireStoreLock(dir);
    try {
      const infoBefore = await readFile(join(storeLockDir(dir), "info"), "utf8");
      const error = await acquireStoreLock(dir, 60).then(
        () => { throw new Error("acquired a lock someone else already holds"); },
        (e: unknown) => e,
      );
      expect((error as Error).message).toContain(storeLockDir(dir));
      expect((error as CorrectRejection).code).toBe(CORRECTIONS_STORE_BUSY);
      expect(await readFile(join(storeLockDir(dir), "info"), "utf8")).toBe(infoBefore);
    } finally {
      await first.release();
    }
  });

  // E8: the timeout is a named rejection with exit 4, and the message carries
  // what a person needs to go find the holder — the lock path and the pid.
  it("times out with a named rejection carrying the lock path and the holder's pid", async () => {
    const dir = await tempDir();
    const first = await acquireStoreLock(dir);
    try {
      const error = await acquireStoreLock(dir, 60).then(
        () => { throw new Error("acquired a lock someone else already holds"); },
        (e: unknown) => e,
      );
      expect((error as Error).message).toContain(`pid ${process.pid}`);
      expect((error as Error).message).toContain(storeLockDir(dir));
      expect((error as CorrectRejection).code).toBe(CORRECTIONS_STORE_BUSY);
      expect((error as CorrectRejection).exitCode).toBe(4);
    } finally {
      await first.release();
    }
  });

  it("releases so the next holder can take it, and releasing twice is not an error", async () => {
    const dir = await tempDir();
    const first = await acquireStoreLock(dir);
    await first.release();
    await first.release();
    const second = await acquireStoreLock(dir);
    await second.release();
    expect(existsSync(storeLockDir(dir))).toBe(false);
  });

  // E17 (directory half). ⚠️ umask is pinned explicitly and RESTORED: without
  // pinning, a machine whose umask is 077 gets 0700 for free and the mutation
  // that removes the mode argument stays green; without restoring, every later
  // criterion in this same process inherits the changed umask.
  it("creates the store directory 0700 whatever the umask is", async () => {
    const parent = await tempDir();
    const dir = join(parent, ".orca");
    const previousUmask = process.umask(0o022);
    try {
      const lock = await acquireStoreLock(dir);
      await lock.release();
      expect((await stat(dir)).mode & 0o777).toBe(CORRECTIONS_DIR_MODE);
    } finally {
      process.umask(previousUmask);
    }
  });
});
