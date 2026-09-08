import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
import {
  captureStreams,
  closeArgs,
  git,
  makeTargetRepo,
  runCli,
  withCorrectionsDir,
} from "./harness.js";

async function ledgerFiles(decisionsDir: string): Promise<string[]> {
  return (await readdir(decisionsDir).catch(() => [] as string[]))
    .filter((n) => n.endsWith(".jsonl"))
    .sort();
}

async function countOverturned(decisionsDir: string): Promise<number> {
  const files = await ledgerFiles(decisionsDir);
  let count = 0;
  for (const file of files) {
    const text = await readFile(join(decisionsDir, file), "utf8");
    for (const raw of text.split("\n")) {
      if (raw.trim().length === 0) continue;
      if ((JSON.parse(raw) as { ev?: unknown }).ev === "overturned") count++;
    }
  }
  return count;
}

/**
 * Re-tries an already-recorded correction via `--close <id>`, the shape a
 * person actually re-runs (§14.1, third seat): `--chose-instead` is NOT
 * repeated here, because the stored row already carries it from the first
 * close, and supplying it again would hit args.ts's CLOSE_ARG_CONFLICT
 * rather than exercise the idempotence questions this file is about.
 */
const reCloseArgs = (repo: string, correctionId: string): string[] => [
  "correct", "--repo", repo, "--by", "amy", "--close", correctionId,
  "--undo-how", "删掉 src/scheduler/pool.ts 里的那处互斥",
];

describe("orca correct --close — commit and branch-independent idempotence (闭-8, §14.1)", () => {
  it("E14: commits exactly the one ledger file it wrote, leaving the worktree clean", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async () => {
        const { result: rc } = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(rc).toBe(0);

        expect(await git(target.path, ["status", "--porcelain"])).toBe("");

        const committed = (await git(target.path, ["show", "--name-only", "--format=", "HEAD"]))
          .split("\n").filter((l) => l.length > 0);
        expect(committed).toHaveLength(1);
        expect(committed[0]).toMatch(/^\.decisions\/orca-fix-[0-9a-f]{8}\.jsonl$/);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E14b: commits only the ledger file, and leaves what the person had staged staged", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async () => {
        await writeFile(join(target.path, "mine.txt"), "mine\n");
        await git(target.path, ["add", "--", "mine.txt"]);

        const { result: rc } = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(rc).toBe(0);

        const committed = (await git(target.path, ["show", "--name-only", "--format=", "HEAD"]))
          .split("\n").filter((l) => l.length > 0);
        expect(committed).toHaveLength(1);
        expect(committed[0]).toMatch(/^\.decisions\/orca-fix-[0-9a-f]{8}\.jsonl$/);

        const staged = await git(target.path, ["diff", "--cached", "--name-only"]);
        expect(staged).toContain("mine.txt");
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E5a: re-running the same --close a second time reports success without duplicating the rows", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const first = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(first.result).toBe(0);

        const correctionId = (await readCorrections(dir))[0].id;
        const filesBefore = await ledgerFiles(target.decisionsDir);

        const second = await captureStreams(() => runCli(reCloseArgs(target.path, correctionId)));
        expect(second.result).toBe(0);

        // The write count, not just the exit code (§14.9 Rule 9): a second
        // write into the same run's file would still leave exit 0 and the
        // same filename set, but would double the `overturned` rows.
        expect(await countOverturned(target.decisionsDir)).toBe(1);
        expect(await ledgerFiles(target.decisionsDir)).toEqual(filesBefore);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E5c (branch-independent): closing on branch W, then re-running the same close from the main line, is a no-op there too", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const main = (await git(target.path, ["symbolic-ref", "--short", "HEAD"])).trim();
        await git(target.path, ["checkout", "-b", "W"]);

        const first = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(first.result).toBe(0);
        const headOnW = (await git(target.path, ["rev-parse", "HEAD"])).trim();
        const correctionId = (await readCorrections(dir))[0].id;

        await git(target.path, ["checkout", main]);
        const filesOnMainBefore = await ledgerFiles(target.decisionsDir);
        expect(await git(target.path, ["status", "--porcelain"])).toBe("");

        const second = await captureStreams(() => runCli(reCloseArgs(target.path, correctionId)));
        expect(second.result).toBe(0);
        // Names the ref/commit it found the earlier close on, not just "done".
        expect(second.stdout).toContain(headOnW);

        expect(await git(target.path, ["status", "--porcelain"])).toBe("");
        expect(await ledgerFiles(target.decisionsDir)).toEqual(filesOnMainBefore);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("E5b (recovery path): re-running the same close after a hook refused the commit finishes it", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const hook = join(target.path, ".git", "hooks", "pre-commit");
        await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });

        const first = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(first.stderr).toContain("rejected: ledger-commit-refused:");
        expect(first.result).toBe(5);
        expect(await git(target.path, ["status", "--porcelain"])).toContain(".decisions/");

        const headBefore = (await git(target.path, ["rev-parse", "HEAD"])).trim();
        await rm(hook);

        const correctionId = (await readCorrections(dir))[0].id;
        const second = await captureStreams(() => runCli(reCloseArgs(target.path, correctionId)));

        // The mutation this is here to kill: "make the re-run not attempt
        // the commit" satisfies a bare exit-0 assertion the whole way
        // through, so HEAD and porcelain are asserted first (§14.1, third
        // seat), not just the exit code.
        expect((await git(target.path, ["rev-parse", "HEAD"])).trim()).not.toBe(headBefore);
        expect(await git(target.path, ["status", "--porcelain"])).not.toContain(".decisions/");
        expect(second.result).toBe(0);
      });
    } finally {
      await target.cleanup();
    }
  });
});
