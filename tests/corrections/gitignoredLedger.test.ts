import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureStreams, closeArgs, git, makeTargetRepo, runCli, withCorrectionsDir } from "./harness.js";

/**
 * Round-4 review, item 2 (IMPORTANT). Measured: a target repository whose
 * `.gitignore` lists `.decisions/` makes `git add -- <path>` itself fail —
 * and `git status --porcelain` then reports nothing (the file is ignored),
 * so a person has no signal that anything is left over.
 *
 * Before the fix, `add` sat OUTSIDE `commitLedgerFile`'s try/catch, so this
 * raw git failure escaped as an untyped exception: exit 3, a stack trace,
 * AFTER both ledger rows were already irreversibly written to disk. The fix
 * moves `add` inside the same try as `commit`, so this failure produces the
 * same honest, named refusal a hook-refused commit gives: the rows are
 * written, the commit did not happen.
 */
describe("orca correct --close — a gitignored ledger path is a named refusal, not a crash (round-4 review, item 2)", () => {
  it("refuses with ledger-commit-refused and exit 5, not a stack trace", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async () => {
        await writeFile(join(target.path, ".gitignore"), ".decisions/\n");
        await git(target.path, ["add", "-A"]);
        await git(target.path, ["commit", "-m", "ignore the ledger directory"]);

        const { result: rc, stderr } = await captureStreams(() => runCli(closeArgs(target.path)));

        expect(stderr).toContain("rejected: ledger-commit-refused:");
        expect(rc).toBe(5);
      });
    } finally {
      await target.cleanup();
    }
  });
});
