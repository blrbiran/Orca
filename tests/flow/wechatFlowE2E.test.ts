import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptMessage } from "../../src/flow/messages.js";
import { runPlan } from "../../src/flow/rerun.js";
import { getFlowRun, listEffects, listHeads, listPlans } from "../../src/flow/store.js";
import { SLUG, TITLES, WECHAT, toDraftBox, wechatFile, wechatWorld } from "./fixtures/wechatWorld.js";

/**
 * Flow engine spec §21 C6 (§7, §8, §9, §15; plan Task 14): the built-in article flow end to end on fake agents. It runs
 * to the draft box crossing an ask (the article step's question parks only it and the steps after it; the parallel cover
 * finishes meanwhile; the answer resumes it), and the stub draft box records the draft's remote id. Then the person's
 * feedback on `voice` makes a plan: candidates `voice`…`to-draft-box` with their reasons, the model proposes skipping
 * `cover`, the person also unticks `pick-title`; only the chosen steps run, in template order, and the skipped ones keep
 * their outputs (the picked title and the cover stay in the folder). The re-run draft box records its own remote id.
 */
describe("wechat-article end to end (C6)", () => {
  it("runs to the draft box across an ask, then re-runs only what the person chose after feedback on voice", async () => {
    const world = await wechatWorld();
    const { w, children, child, goalOf } = world; try {
      const flowRunId = await toDraftBox(world);
      expect(world.commands).toEqual(["md2wechat doctor --json"]);
      expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
      const [draftBox] = listEffects(w.store, flowRunId).filter((r) => r.stepKey === "to-draft-box");
      expect(draftBox).toMatchObject({ state: "applied", remoteRef: "media-1", level: "apply-flag", effectKind: "wechat-draft" });
      expect(readFileSync(join(w.folder, WECHAT), "utf8")).toBe(wechatFile(TITLES.items[1]!, "Drink it."));

      // Feedback on voice: a plan with the candidates, their reasons, and the model's proposed skip.
      await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "step", stepKey: "voice" }, body: { text: "Warmer, please." }, by: "ann", via: "cli:test", requestId: "f1" });
      const [plan] = listPlans(w.store, flowRunId);
      const list = (plan!.candidates as { list: Array<{ stepKey: string; reasons: string[] }> }).list;
      expect(list.map((c) => c.stepKey)).toEqual(["voice", "finetune", "pick-title", "article", "cover", "to-draft-box"]);
      expect(list[0]!.reasons).toEqual(["feedback"]);
      for (const c of list.slice(1)) expect(c.reasons, c.stepKey).toContain("upstream-changed:voice");
      const proposal = w.calls.findIndex((c) => c.purpose === "rerun-proposal");
      expect(w.calls[proposal]!.prompt).toContain("skip when: the cover follows the article's subject and title");
      await w.answer(proposal, { skips: [{ stepKey: "cover", reason: "The subject and title did not change." }] });
      expect(listPlans(w.store, flowRunId)[0]).toMatchObject({ state: "proposed", proposal: { skips: [{ stepKey: "cover" }] } });
      expect(children.opened.has(child(flowRunId, "voice", 2))).toBe(false);

      // The person also unticks pick-title and runs the plan.
      await runPlan(w.deps, flowRunId, plan!.planNo, { skip: ["cover", "pick-title"] }, "ann", "cli:test");
      expect(goalOf(child(flowRunId, "voice", 2))).toContain("Warmer, please.");
      children.land(child(flowRunId, "voice", 2), { [`${SLUG}.md`]: "# Tea\n\nTea slows you down, gently.\n" });
      await w.advance();
      children.land(child(flowRunId, "finetune", 2), { [WECHAT]: wechatFile("Draft title", "Drink it warm.") }, { flow: { candidates: { title: TITLES } } });
      await w.advance();
      children.land(child(flowRunId, "article", 3), { [`${SLUG}.wechat.html`]: "<p>Tea, gently</p>\n" });
      await w.advance();
      children.land(child(flowRunId, "to-draft-box", 2), {}, { flow: { effect: { remoteId: "media-2" } } });
      await w.advance();

      expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
      expect(listPlans(w.store, flowRunId)[0]).toMatchObject({ state: "done", chosen: { steps: ["voice", "finetune", "article", "to-draft-box"] } });
      // Skipped steps did not run again: no second cover child, no new pick-title answer; they keep their outputs.
      expect(children.opened.has(child(flowRunId, "cover", 2))).toBe(false);
      expect(w.execs(flowRunId, "cover").map((e) => e.state)).toEqual(["done", "skipped"]);
      expect(w.execs(flowRunId, "pick-title").map((e) => e.state)).toEqual(["done", "skipped"]);
      expect(listHeads(w.store, flowRunId)).toMatchObject({ cover: 1, "pick-title": 1, voice: 2, finetune: 2, article: 3, "to-draft-box": 2 });
      expect(readFileSync(join(w.folder, WECHAT), "utf8")).toBe(wechatFile(TITLES.items[1]!, "Drink it warm."));
      expect(readFileSync(join(w.folder, "assets/wechat/00-cover.final.txt"), "utf8")).toBe("assets/wechat/00-cover.jpg\n");
      // The re-run draft box is a new effect record with its own remote id.
      expect(listEffects(w.store, flowRunId).filter((r) => r.stepKey === "to-draft-box").map((r) => [r.state, r.remoteRef])).toEqual([["applied", "media-1"], ["applied", "media-2"]]);
    } finally { await w.dispose(); }
  });
});
