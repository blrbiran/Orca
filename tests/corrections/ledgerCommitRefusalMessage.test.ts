import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCorrections } from "../../src/corrections/store.js";
import { captureStreams, closeArgs, makeTargetRepo, runCli, withCorrectionsDir } from "./harness.js";

/**
 * Round-4 review, item 1 (CRITICAL). `LEDGER_COMMIT_REFUSED`'s message used
 * to say "re-run the same --close", which is true only when the person
 * originally typed `--close <id>`. `closeArgs` here (the harness's fixture)
 * closes the loop in ONE shot — `--decision … --chose-instead … --undo-how
 * …`, no `--close` — which is exactly the shape the old wording misled:
 * re-running THAT same command a second time hits
 * `correction-already-recorded`, and followed to `--again` commits a SECOND
 * decision+overturned pair while the first (hook-refused) pair stays on disk
 * forever, staged and uncommitted, in an append-only file.
 *
 * The fix names the one recovery that does not duplicate rows:
 * `orca correct --repo <repo> --close <correctionId> --undo-how '…'`. This
 * criterion pins BOTH pieces the recovery needs: the flag and the actual id.
 * Reverting to the old wording keeps "--close" in the string (it always did)
 * but never mentions the correction's id — so the id assertion is what goes
 * red under that mutation, not the flag assertion.
 */
describe("orca correct --close — hook-refused commit names the actual recovery (round-4 review, item 1)", () => {
  it("stderr names --close and the correction id when the original run was a one-shot close", async () => {
    const target = await makeTargetRepo();
    try {
      await withCorrectionsDir(async (dir) => {
        const hook = join(target.path, ".git", "hooks", "pre-commit");
        await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });

        const first = await captureStreams(() => runCli(closeArgs(target.path)));
        expect(first.result).toBe(5);

        const correctionId = (await readCorrections(dir))[0].id;
        expect(first.stderr).toContain("--close");
        expect(first.stderr).toContain(correctionId);
      });
    } finally {
      await target.cleanup();
    }
  });
});
