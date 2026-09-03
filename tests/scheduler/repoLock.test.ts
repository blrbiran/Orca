import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireRepoLock } from "../../src/scheduler/repoLock.js";
import { makeSandbox } from "./sandbox.js";

describe("acquireRepoLock", () => {
  it("creates <targetRepo>/.git/orca-lock, inside .git so porcelain never sees it", async () => {
    const s = await makeSandbox();
    try {
      const lock = await acquireRepoLock(s.targetRepo);
      try {
        const lockDir = join(s.targetRepo, ".git", "orca-lock");
        const info = await stat(lockDir);
        expect(info.isDirectory()).toBe(true);
        // Written for a human, not read back by any code — see repoLock.ts.
        const contents = await readFile(join(lockDir, "info"), "utf8");
        expect(contents).toMatch(/pid \d+/);
      } finally {
        await lock.release();
      }
    } finally {
      await s.cleanup();
    }
  });

  it("release() removes the lock directory so a later acquire succeeds", async () => {
    const s = await makeSandbox();
    try {
      const first = await acquireRepoLock(s.targetRepo);
      await first.release();
      // No throw: the lock is free again.
      const second = await acquireRepoLock(s.targetRepo);
      await second.release();
    } finally {
      await s.cleanup();
    }
  });

  it("release() is safe to call more than once", async () => {
    const s = await makeSandbox();
    try {
      const lock = await acquireRepoLock(s.targetRepo);
      await lock.release();
      await expect(lock.release()).resolves.toBeUndefined();
    } finally {
      await s.cleanup();
    }
  });
});
