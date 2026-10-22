/**
 * Review finding M1: a `flow-start` that crashed after its vault import and before its run row left the run id's base
 * ref (and head) in the vault. The same command sent again derives the same run id, so its import must not fail forever
 * on the create-only ref: the orphan is replaced (compare-and-swap from the value read), and the run starts from what the
 * folder holds now.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRun, startFlowRun, vaultOf } from "../../src/flow/kernel.js";
import { readHead } from "../../src/flow/vault/compose.js";
import { baseRef } from "../../src/flow/vault/snapshot.js";
import { vaultGit } from "../../src/flow/vault/vault.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TPL = { t: { yaml: "format: orca-flow-v1\nid: t\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: draft, prompt: p.md}\n", assets: { "p.md": "Write.\n" } } };
/** kernel.ts uuidOf: the run id a command id derives (copied here: the crash is made by taking the group id first). */
const idOf = (key: string): string => {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

async function crashedStart(key: string) {
  const w = await flowWorld(TPL, { files: { "a.md": "one\n" } });
  const id = idOf(key);
  // The crash: the run's group row cannot be written (taken), after the import was made.
  w.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES (?,1,1,0,'{}')").run(`flow-${id}`);
  const input = { templateRef: "builtin/t", dir: w.folder, params: {}, by: "ann", via: "cli:test", idempotencyKey: key };
  await expect(startFlowRun(w.deps, input)).rejects.toThrow();
  w.store.db.prepare("DELETE FROM groups WHERE id=?").run(`flow-${id}`);
  return { w, input, flowRunId: `fr-${id}` };
}

describe("a start retried after a crash between the import and the run row (M1)", () => {
  it("the same command starts the run when the folder is unchanged; base and head name its import", async () => {
    const { w, input, flowRunId } = await crashedStart("cmd-same"); try {
      const started = await startFlowRun(w.deps, input);
      expect(started.flowRunId).toBe(flowRunId);
      const run = loadRun(w.store, flowRunId);
      const vault = vaultOf(run)!;
      expect((await vaultGit(vault, ["rev-parse", baseRef(flowRunId)])).trim()).toBe(run.body.importCommit);
      expect(await readHead(vault, flowRunId)).toBe(run.body.importCommit);
    } finally { await w.dispose(); }
  });

  it("a folder changed meanwhile: the retry imports it anew and the run's base and head are the new import", async () => {
    const { w, input, flowRunId } = await crashedStart("cmd-changed"); try {
      writeFileSync(join(w.folder, "a.md"), "two\n");
      await startFlowRun(w.deps, input);
      const run = loadRun(w.store, flowRunId);
      const vault = vaultOf(run)!;
      expect(await vaultGit(vault, ["show", `${run.body.importCommit}:a.md`])).toBe("two\n");
      expect((await vaultGit(vault, ["rev-parse", baseRef(flowRunId)])).trim()).toBe(run.body.importCommit);
      expect(await readHead(vault, flowRunId)).toBe(run.body.importCommit);
    } finally { await w.dispose(); }
  });
});
