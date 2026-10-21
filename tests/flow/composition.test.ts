/**
 * Flow engine spec §5.3 and §6.5 (C4, IR-C3, plan Task 6): an execution's base is composed by code -- the run's import
 * plus every earlier step's ACTIVE output (`step_heads`), merged in template order -- never a branch tip. The flow head
 * moves only by compare-and-swap; a sibling that moved it first makes this one recompose. A conflict names the step whose
 * output no longer merges.
 */
import { describe, expect, it } from "vitest";
import { activeOutputs, advanceHead, advanceHeadWithRetry, compose, composeBase, headRef, type ExecutionOutput } from "../../src/flow/vault/compose.js";
import { importSnapshot } from "../../src/flow/vault/snapshot.js";
import { gv, vaultWorld } from "./fixtures/vaultWorld.js";

const caps = { perFileBytes: 1 << 20, perSnapshotBytes: 1 << 24 };
const ORDER = ["draft", "voice", "cover", "article", "publish"];

async function world() {
  const w = await vaultWorld({ "a.md": "one\ntwo\nthree\n" });
  const { commit: base } = await importSnapshot(w.vault, w.folder, { flowRunId: "run-1", caps });
  return { ...w, base };
}

describe("composition (§5.3, C4)", () => {
  it("K1: after cover and article both land and voice is rewound to #1, the next base holds voice#1 and both parallel outputs", async () => {
    const w = await world();
    const draft1 = w.stepCommit(w.base, { "a.md": "one\ntwo\nthree\nDRAFT\n" });
    const afterDraft = await compose(w.vault, w.base, [{ stepKey: "draft", commit: draft1, parent: w.base }]);
    if ("conflict" in afterDraft) throw new Error("unexpected conflict");
    const voice1 = w.stepCommit(afterDraft.commit, { "a.md": "ONE\ntwo\nthree\nDRAFT\n" });
    const voice2 = w.stepCommit(afterDraft.commit, { "a.md": "Uno\ntwo\nthree\nDRAFT\n" });
    const afterVoice2 = await compose(w.vault, w.base, [{ stepKey: "draft", commit: draft1, parent: w.base }, { stepKey: "voice", commit: voice2, parent: afterDraft.commit }]);
    if ("conflict" in afterVoice2) throw new Error("unexpected conflict");
    // cover and article run in parallel from the same composition (§6.5) and land in either order.
    const cover1 = w.stepCommit(afterVoice2.commit, { "cover.png": "PNG" });
    const article1 = w.stepCommit(afterVoice2.commit, { "a.html": "<p>" });
    const executions: ExecutionOutput[] = [
      { stepKey: "draft", seq: 1, commit: draft1, parent: w.base },
      { stepKey: "voice", seq: 1, commit: voice1, parent: afterDraft.commit },
      { stepKey: "voice", seq: 2, commit: voice2, parent: afterDraft.commit },
      { stepKey: "article", seq: 1, commit: article1, parent: afterVoice2.commit },
      { stepKey: "cover", seq: 1, commit: cover1, parent: afterVoice2.commit },
    ];
    const heads = { draft: 1, voice: 1, cover: 1, article: 1 };
    expect(activeOutputs(executions, heads, ORDER, "publish").map((o) => `${o.stepKey}#${executions.find((e) => e.commit === o.commit)!.seq}`)).toEqual(["draft#1", "voice#1", "cover#1", "article#1"]);
    const base = await composeBase(w.vault, w.base, executions, heads, ORDER, "publish");
    if ("conflict" in base) throw new Error("unexpected conflict");
    expect(w.show(base.commit, "a.md")).toBe("ONE\ntwo\nthree\nDRAFT\n");
    expect(w.show(base.commit, "cover.png")).toBe("PNG");
    expect(w.show(base.commit, "a.html")).toBe("<p>");
    expect(gv(w.vault, ["rev-parse", `${base.commit}^`])).toBe(w.base);
    // Only earlier steps count: the base of voice holds draft and nothing after it.
    const voiceBase = await composeBase(w.vault, w.base, executions, heads, ORDER, "voice");
    if ("conflict" in voiceBase) throw new Error("unexpected conflict");
    expect(w.show(voiceBase.commit, "a.md")).toBe("one\ntwo\nthree\nDRAFT\n");
    expect(w.show(voiceBase.commit, "cover.png")).toBeNull();
  });

  it("K2: a step with no active output contributes nothing; with none at all the base is the import's tree", async () => {
    const w = await world();
    const base = await composeBase(w.vault, w.base, [], {}, ORDER, "publish");
    if ("conflict" in base) throw new Error("unexpected conflict");
    expect(gv(w.vault, ["rev-parse", `${base.commit}^{tree}`])).toBe(gv(w.vault, ["rev-parse", `${w.base}^{tree}`]));
  });

  it("K3: two outputs that no longer merge: the composition names the later one", async () => {
    const w = await world();
    const cover1 = w.stepCommit(w.base, { "a.md": "COVER\ntwo\nthree\n" });
    const article1 = w.stepCommit(w.base, { "a.md": "ARTICLE\ntwo\nthree\n" });
    expect(await compose(w.vault, w.base, [{ stepKey: "cover", commit: cover1, parent: w.base }, { stepKey: "article", commit: article1, parent: w.base }])).toEqual({ conflict: "article" });
  });
});

describe("the flow head (§5.3)", () => {
  it("H1: advanceHead is a compare-and-swap: from the value read, or (for a new head) from nothing", async () => {
    const w = await world();
    const one = w.stepCommit(w.base, { "x.md": "1" });
    const two = w.stepCommit(w.base, { "y.md": "2" });
    expect(await advanceHead(w.vault, "run-1", null, one)).toBe(true);
    expect(await advanceHead(w.vault, "run-1", null, two)).toBe(false);
    expect(await advanceHead(w.vault, "run-1", w.base, two)).toBe(false);
    expect(gv(w.vault, ["rev-parse", headRef("run-1")])).toBe(one);
    expect(await advanceHead(w.vault, "run-1", one, two)).toBe(true);
    expect(gv(w.vault, ["rev-parse", headRef("run-1")])).toBe(two);
  });

  it("H2: a sibling that moved the head first makes this advance recompose; nothing the sibling wrote is lost", async () => {
    const w = await world();
    await advanceHead(w.vault, "run-1", null, w.base);
    const cover1 = w.stepCommit(w.base, { "cover.png": "PNG" });
    const article1 = w.stepCommit(w.base, { "a.html": "<p>" });
    let calls = 0;
    const final = await advanceHeadWithRetry(w.vault, "run-1", async (current) => {
      calls += 1;
      if (calls === 1) {
        // The sibling lands between this read and this swap.
        const sibling = await compose(w.vault, w.base, [{ stepKey: "cover", commit: cover1, parent: w.base }]);
        if ("conflict" in sibling) throw new Error("unexpected conflict");
        expect(await advanceHead(w.vault, "run-1", current, sibling.commit)).toBe(true);
      }
      const outputs = [{ stepKey: "article", commit: article1, parent: w.base }];
      if (calls > 1) outputs.unshift({ stepKey: "cover", commit: cover1, parent: w.base });
      const next = await compose(w.vault, w.base, outputs);
      if ("conflict" in next) throw new Error("unexpected conflict");
      return next.commit;
    });
    expect(calls).toBe(2);
    expect(gv(w.vault, ["rev-parse", headRef("run-1")])).toBe(final);
    expect(w.show(final, "cover.png")).toBe("PNG");
    expect(w.show(final, "a.html")).toBe("<p>");
  });
});
