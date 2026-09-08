import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
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
 * gives `add` its own catch alongside `commit`'s, so this failure produces
 * the same honest, named refusal a hook-refused commit gives: the rows are
 * written, the commit did not happen.
 *
 * ⚠️ Scoped re-review minor: the first version of this fix put `add` and
 * `commit` behind ONE shared message that said "written … and staged" on
 * BOTH branches. When `add` is what failed, the file was never staged —
 * that is precisely why `add` refused — so that message asserted something
 * false about what is on disk. The message body is now asserted here too,
 * not just the code and exit.
 *
 * ⚠️ The "does not say staged" assertion is checked against a fixture whose
 * git-printed error text is known (captured empirically) not to contain the
 * word "staged" anywhere in its own output — otherwise this criterion could
 * pass for the wrong reason, the same accidental-pass channel fix 1's
 * criterion fell into (git's own echoed text satisfying an assertion that
 * was meant to check OUR wording).
 */
describe("orca correct --close — a gitignored ledger path is a named refusal, not a crash (round-4 review, item 2)", () => {
  it("refuses with ledger-commit-refused and exit 5, naming --close and never claiming the file was staged", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        await writeFile(join(target.path, ".gitignore"), ".decisions/\n");
        await git(target.path, ["add", "-A"]);
        await git(target.path, ["commit", "-m", "ignore the ledger directory"]);

        const { result: rc, stderr } = await captureStreams(() => runCli(closeArgs(target.path)));

        expect(stderr).toContain("rejected: ledger-commit-refused:");
        expect(rc).toBe(5);

        // The load-bearing pair: the message must not claim the file was
        // staged (it was never staged -- add is what refused), and it must
        // still name the real recovery, adjacent, the same way fix 1 pins it.
        const correctionId = (await readCorrections(dir))[0].id;
        expect(stderr).not.toContain("staged");
        expect(stderr).toContain(`--close ${correctionId}`);
      });
    } finally {
      await target.cleanup();
    }
  });
});
