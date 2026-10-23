/**
 * Dir-requirements spec §6.3, criterion D3 (plan Task 2): a split call of a requirement on a `dir` project is judged in
 * the vault at the import its own A2 made. A target path the folder has passes and an absent one is `path:<task>:<p>`;
 * the stored plan's `targetRepo` is the vault path, never the folder. The folder is changed while the call is out (after
 * A2, before Ce): the judgement still reads the call's commit, not the folder as it is now.
 */
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDraft } from "../../src/control/requirementRecords.js";
import { vaultKeyOf } from "../../src/flow/vault/paths.js";
import { dirRequirementHarness } from "./fixtures/dirRequirement.js";
import { INVALID_SPLIT, VALID_SPLIT } from "./fixtures/requirementOutputs.js";

describe("a split call on a dir project is judged in the vault (D3)", () => {
  it("an absent target path is path:<task>:<p>; a present one passes at the call's commit; targetRepo is the vault", async () => {
    let folder = "";
    // Answered while the call is out: the folder loses src/ and gains missing/dir/ -- the opposite of what the call saw.
    const changeFolderThen = () => {
      rmSync(join(folder, "src"), { recursive: true, force: true });
      mkdirSync(join(folder, "missing", "dir"), { recursive: true });
      return VALID_SPLIT;
    };
    const x = await dirRequirementHarness({ answers: [{ purpose: "split", output: INVALID_SPLIT }, { purpose: "split", output: changeFolderThen }], startAt: "split" });
    try {
      folder = x.folder;
      // The harness seeded "r" as requirement-open on this dir project leaves it (§5.1).
      const real = realpathSync(x.folder).normalize("NFC");
      x.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify({ ...x.body(), dirWorkspace: { dir: real, vaultId: vaultKeyOf(real) } }));
      await x.until(() => readDraft(x.store, "r", 2).state !== "drafting");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "invalid", reasons: ["path:exporter:missing/dir/x.ts"] });
      const draft = readDraft(x.store, "r", 2);
      expect(draft).toMatchObject({ state: "awaiting-review", reasons: [] });
      const vault = join(x.env.ORCA_VAULT_DIR!, `${vaultKeyOf(real)}.git`);
      expect(draft.plan).toMatchObject({ workBranch: "orca/r", targetRepo: vault });
      const [first, second] = x.runs();
      expect(draft.calls[0]!.commit).toBe(second.overview.commit);
      expect(first.overview.commit).toBe(second.overview.commit); // the folder was unchanged between the two A2s
    } finally { await x.dispose(); }
  });
});
