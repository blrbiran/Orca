/**
 * Flow engine spec §5.4 and §7.2 (C5, IR-I6, plan Task 6): before each execution code snapshots the person's folder;
 * paths that differ from the flow head are the person's drift. The drift is placed at the earliest step whose active
 * output wrote any drifted path, else at the start, and committed onto that step's active output as a person-authored
 * execution -- so the next composition holds it and the planner sees an edit: that step is not a candidate, later
 * steps are.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidates, type Execution } from "../../src/flow/journal/candidates.js";
import { composeBase, type ExecutionOutput } from "../../src/flow/vault/compose.js";
import { copyBack } from "../../src/flow/vault/copyBack.js";
import { commitDriftOnto, placeDrift, snapshotDrift } from "../../src/flow/vault/drift.js";
import { importSnapshot } from "../../src/flow/vault/snapshot.js";
import { gv, vaultWorld } from "./fixtures/vaultWorld.js";

const caps = { perFileBytes: 1 << 20, perSnapshotBytes: 1 << 24 };
const ORDER = ["draft", "finetune", "article"];

describe("placeDrift (§5.4)", () => {
  const outputs = [{ stepKey: "draft", paths: ["a.md"] }, { stepKey: "finetune", paths: ["a.wechat.md", "a.md"] }, { stepKey: "article", paths: ["a.wechat.html"] }];
  it.each<[string[], string]>([
    [["a.wechat.md"], "finetune"],
    [["a.wechat.html", "a.wechat.md"], "finetune"],
    [["a.md"], "draft"],
    [["notes.txt"], "start"],
    [["notes.txt", "a.wechat.html"], "article"],
  ])("D1: drift on %j is placed at %s (the earliest step that wrote any of it, else the start)", (paths, at) => {
    expect(placeDrift(paths, outputs)).toBe(at);
  });
});

describe("drift end to end over a real vault (C5)", () => {
  async function run() {
    const w = await vaultWorld({ "notes.txt": "n\n" });
    const { commit: imported } = await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps });
    const draft1 = w.stepCommit(imported, { "a.md": "draft\n" });
    const finetune1 = w.stepCommit(draft1, { "a.wechat.md": "title: one\nbody\n" });
    const article1 = w.stepCommit(finetune1, { "a.wechat.html": "<p>" });
    const executions: ExecutionOutput[] = [
      { stepKey: "draft", seq: 1, commit: draft1, parent: imported },
      { stepKey: "finetune", seq: 1, commit: finetune1, parent: draft1 },
      { stepKey: "article", seq: 1, commit: article1, parent: finetune1 },
    ];
    const head = article1;
    await copyBack(w.vault, w.folder, imported, head);
    return { ...w, imported, executions, head, finetune1, draft1 };
  }

  it("D2: no change in the folder is no drift", async () => {
    const w = await run();
    expect(await snapshotDrift(w.vault, w.folder, w.head)).toBeNull();
  });

  it("D3: an edit to finetune's file becomes a person-authored execution of finetune, held by the next composition", async () => {
    const w = await run();
    writeFileSync(join(w.folder, "a.wechat.md"), "title: mine\nbody\n");
    const drift = await snapshotDrift(w.vault, w.folder, w.head);
    expect(drift?.paths).toEqual(["a.wechat.md"]);
    const at = placeDrift(drift!.paths, [{ stepKey: "draft", paths: ["a.md"] }, { stepKey: "finetune", paths: ["a.wechat.md"] }, { stepKey: "article", paths: ["a.wechat.html"] }]);
    expect(at).toBe("finetune");
    const person = await commitDriftOnto(w.vault, w.finetune1, drift!.commit, drift!.paths);
    expect(gv(w.vault, ["rev-parse", `${person}^`])).toBe(w.finetune1);
    expect(w.show(person, "a.wechat.md")).toBe("title: mine\nbody\n");
    // The person's execution replaces finetune's output: its change is taken against finetune's own parent.
    const executions = [...w.executions, { stepKey: "finetune", seq: 2, commit: person, parent: w.draft1 }];
    const base = await composeBase(w.vault, w.imported, executions, { draft: 1, finetune: 2, article: 1 }, ORDER, "article");
    if ("conflict" in base) throw new Error("unexpected conflict");
    expect(w.show(base.commit, "a.wechat.md")).toBe("title: mine\nbody\n");
    expect(w.show(base.commit, "a.md")).toBe("draft\n");

    // The planner sees an edit of finetune: finetune is not a candidate, article (later) is.
    const exec = (stepKey: string, seq: number, outputHash: string, earlier: Array<[string, string]>): Execution => ({
      stepKey, seq, state: "done", definitionHash: `def-${stepKey}`, fingerprint: `fp-${stepKey}-${seq}`, outputHash, projection: null, readSet: null,
      ranOnInputs: { start: "import-1", params: "p", earlier: earlier.map(([k, h]) => ({ stepKey: k, outputHash: h, projection: null })) },
    });
    const journal = {
      executions: [exec("draft", 1, "d1", []), exec("finetune", 1, "f1", [["draft", "d1"]]), exec("finetune", 2, "f2-person", [["draft", "d1"]]), exec("article", 1, "a1", [["draft", "d1"], ["finetune", "f1"]])],
      heads: { draft: 1, finetune: 2, article: 1 },
    };
    const list = candidates(journal, { steps: ORDER.map((id) => ({ id })) }, [{ kind: "edit", target: { kind: "step", stepKey: "finetune" } }],
      { definitionHashes: { draft: "def-draft", finetune: "def-finetune", article: "def-article" }, start: "import-1", params: "p", whenFalse: new Set(), composeConflicts: new Set() });
    expect(list).toEqual([{ stepKey: "article", reasons: ["upstream-changed:finetune"] }]);
  });

  it("D5: a file the snapshot could not take (over a cap) is not drift: the folder still has it", async () => {
    const w = await run();
    expect(await snapshotDrift(w.vault, w.folder, w.head, { perFileBytes: 3, perSnapshotBytes: 1 << 20 })).toBeNull();
  });

  it("D4: an edit to a file no step wrote is placed at the start", async () => {
    const w = await run();
    writeFileSync(join(w.folder, "notes.txt"), "mine\n");
    const drift = await snapshotDrift(w.vault, w.folder, w.head);
    expect(drift?.paths).toEqual(["notes.txt"]);
    expect(placeDrift(drift!.paths, [{ stepKey: "draft", paths: ["a.md"] }, { stepKey: "finetune", paths: ["a.wechat.md"] }])).toBe("start");
    expect(gv(w.vault, ["rev-parse", `${drift!.commit}^`])).toBe(w.head);
    expect(w.show(drift!.commit, "notes.txt")).toBe("mine\n");
  });
});
