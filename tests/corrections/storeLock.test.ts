import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CorrectRejection } from "../../src/corrections/rejection.js";
import { storeLockDir } from "../../src/corrections/paths.js";
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

  // A stale release() must not tear down a lock a LATER holder has since
  // acquired. `rm(..., { force: true })` alone tolerates a missing
  // directory either way, so a released-guard test that only re-releases
  // an idle lock can never go red (Rule 9's first corollary) — this shape
  // pins what the guard is actually for: releasing `first` again AFTER
  // `second` has acquired must not remove `second`'s lock directory. The
  // stale call below is also the "releasing twice does not throw" case.
  it("a stale release does not tear down a later holder's lock, and releasing twice does not throw", async () => {
    const dir = await tempDir();
    const first = await acquireStoreLock(dir);
    await first.release();
    const second = await acquireStoreLock(dir);
    await first.release();
    expect(existsSync(storeLockDir(dir))).toBe(true);
    await second.release();
    expect(existsSync(storeLockDir(dir))).toBe(false);
  });

  // E17 (directory half, store dir AND lock dir). ⚠️ umask is pinned
  // explicitly and RESTORED: without pinning, a machine whose umask is 077
  // gets 0700 for free and the mutation that removes a mode argument stays
  // green; without restoring, every later criterion in this same process
  // inherits the changed umask. The lock-directory assertion has to run
  // while the lock is still held — release() removes the directory — so
  // it is checked between acquire and release, not after.
  it("creates the store directory and the lock directory 0700 whatever the umask is", async () => {
    const parent = await tempDir();
    const dir = join(parent, ".orca");
    const previousUmask = process.umask(0o022);
    try {
      const lock = await acquireStoreLock(dir);
      try {
        // 🔴 Round-4 review, item 5: the literal, not CORRECTIONS_DIR_MODE.
        // Asserting against the constant under test only proves the constant
        // reached mkdir -- it stays green even if the constant itself is
        // loosened (measured: setting CORRECTIONS_DIR_MODE = 0o755 left this
        // criterion green). spec §14.17 requires 0700 on these directories;
        // that requirement is what must be pinned.
        expect((await stat(dir)).mode & 0o777).toBe(0o700);
        expect((await stat(storeLockDir(dir))).mode & 0o777).toBe(0o700);
      } finally {
        await lock.release();
      }
    } finally {
      process.umask(previousUmask);
    }
  });
});
