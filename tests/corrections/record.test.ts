import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
import { captureStreams, git, makeTargetRepo, runCli, withCorrectionsDir } from "./harness.js";

const recordArgs = (repo: string, overrides: string[] = []) => [
  "correct", "--repo", repo, "--by", "amy",
  "--decision", "orca-dev-1/1", "--kind", "wrong", "--because", "那个前提当时就不成立",
  ...overrides,
];

describe("orca correct — record only (spec §14.3 记-1…记-3)", () => {
  it("writes one row keyed by the repository's remote, stamped now", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const before = new Date().toISOString();
        const { result: rc } = await captureStreams(() => runCli(recordArgs(target.path)));
        const after = new Date().toISOString();

        expect(rc).toBe(0);
        const rows = await readCorrections(dir);
        expect(rows).toHaveLength(1);
        expect(rows[0].projectKey).toBe("github.com/biran/orca");
        expect(rows[0].decisionId).toBe("orca-dev-1/1");
        expect(rows[0].by).toBe("amy");
        expect(rows[0].at >= before && rows[0].at <= after).toBe(true);
        expect(rows[0].id).toMatch(/^c_[0-9a-f]{16}$/);
      });
    } finally {
      await target.cleanup();
    }
  });

  // 🔴 E20 (§14.3, second seat I-E): record-only must stay usable while a round
  // is in flight. The repo lock is held for the whole of `orca run`, so taking
  // it here would mean a person cannot write down what they think for as long
  // as orca is working.
  it("records while another process holds the repo lock", async () => {
    const target = await makeTargetRepo();
    try {
      await mkdir(join(target.path, ".git", "orca-lock"), { recursive: true });
      await withCorrectionsDir(async (dir) => {
        const { result: rc } = await captureStreams(() => runCli(recordArgs(target.path)));
        expect(rc).toBe(0);
        expect(await readCorrections(dir)).toHaveLength(1);
      });
    } finally {
      await target.cleanup();
    }
  });

  // 🔴 E2b (§14.3, third seat): both modes run the SAME read-only preflight.
  // A linked worktree's `.git` is a file, so the closing mode can never take
  // the repo lock there — and if record-only skipped the check, the store
  // would end up holding a row that can never be closed from the checkout the
  // person is standing in, with nothing saying why.
  it("refuses a linked worktree in record mode too, by the same code", async () => {
    const target = await makeTargetRepo();
    try {
      const linked = join(target.path, "..", "linked");
      await git(target.path, ["worktree", "add", "-b", "wt", linked]);
      await withCorrectionsDir(async (dir) => {
        const { result: rc, stderr } = await captureStreams(() => runCli(recordArgs(linked)));
        expect(stderr).toContain("rejected: target-not-a-git-repo:");
        // §14.9: the predicate and the code are reused; the MESSAGE is not.
        // The existing one says "this round … the repo lock it takes before
        // reading anything", and `orca correct` is not a round — record mode
        // takes no lock at all.
        expect(stderr).not.toContain("this round");
        expect(rc).toBe(1);
        expect(existsSync(join(dir, "corrections.jsonl"))).toBe(false);
      });
    } finally {
      await target.cleanup();
    }
  });

  it("refuses a second correction on the same decision by the same person, and takes --again", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        expect((await captureStreams(() => runCli(recordArgs(target.path)))).result).toBe(0);

        const second = await captureStreams(() => runCli(recordArgs(target.path)));
        expect(second.stderr).toContain("rejected: correction-already-recorded:");
        expect(second.result).toBe(1);

        const third = await captureStreams(() => runCli(recordArgs(target.path, ["--again"])));
        expect(third.result).toBe(0);
        expect(await readCorrections(dir)).toHaveLength(2);
      });
    } finally {
      await target.cleanup();
    }
  });
});
