/**
 * Gaps spec §6, §17 G5 (plan Task 4): the person skips, defers and fills a step of the built-in `wechat-article` run
 * (fake agents, the wechat world). A marked step is settled -- the run goes on past a failed `cover` -- and later steps
 * never see its output: the composition and the folder lose it while `step_heads` keeps it, and later prompts get a
 * code-owned line instead. A deferral holds the `external` draft box after it (parked, `deferred-upstream`) until a newer
 * defer says `proceed` (then its own level gate applies) or the deferred step is filled and the plan reaches it. A run
 * whose only open item is a deferred step ends `done` with it under needs-you; a skip owes nothing.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { orchestrationRevision, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { answerNeeds, loadRun, vaultOf } from "../../src/flow/kernel.js";
import { heldBy, heldEffectSteps, marksOf } from "../../src/flow/marks.js";
import { acceptMessage } from "../../src/flow/messages.js";
import type { FlowTemplate } from "../../src/flow/template/schema.js";
import { getFlowRun, listEffects, listHeads, listMessages, listPlans, type MessageRow } from "../../src/flow/store.js";
import { readHead } from "../../src/flow/vault/compose.js";
import { readFlowList } from "../../src/flow/views.js";
import { SLUG, TITLES, WECHAT, wechatFile, wechatWorld, zeroRound } from "./fixtures/wechatWorld.js";

type World = Awaited<ReturnType<typeof wechatWorld>>;
const ILLUSTRATED = `${SLUG}.illustrated.md`;
const VISUAL = "assets/wechat/01-visual.png";
const DEFERRED_LINE = (step: string) => `\`${step}\`: deferred by the person (to be filled later) — its output is not available yet; proceed without it`;
const SKIPPED_LINE = (step: string) => `\`${step}\`: skipped by the person — its output is not available; proceed without it`;
const COVER_FILES = { "assets/wechat/00-cover.jpg": "jpg\n", "assets/wechat/00-cover.final.txt": "assets/wechat/00-cover.jpg\n" };
const COVER_EFFECT = { flow: { effect: { remoteId: "assets/wechat/00-cover.jpg" } } };

function setLevels(world: World, effects: Record<string, string>): void {
  const { w } = world;
  w.store.transaction(() => writeOrchestrationSettings(w.store, { maxRunningGroups: 3, flows: { effects } } as never, orchestrationRevision(w.store) + 1));
}

/** Brief → … → the article asks the person a question; visuals ran first when the run is illustrated. The cover is out. */
async function untilArticleAsks(world: World, params: Record<string, unknown> = {}): Promise<string> {
  const { w, children, child } = world;
  const { flowRunId } = await w.start({ templateRef: "builtin/wechat-article", params: { idea: "Tea for engineers", ...params } as never });
  await w.advance();
  await w.answer(0, zeroRound);
  const land = async (stepKey: string, seq: number, files: Record<string, string>, extra = {}) => { children.land(child(flowRunId, stepKey, seq), files, extra); await w.advance(); };
  await land("outline", 1, { [`${SLUG}.outline.md`]: "# Tea\n## Why\n## How\n" });
  await w.answer(1, { candidates: {} });
  await land("draft", 1, { [`${SLUG}.md`]: "# Tea\n\nTea slows you down.\n" });
  await land("deslop", 1, { [`${SLUG}.md`]: "# Tea\n\nTea slows you.\n" });
  await land("voice", 1, { [`${SLUG}.md`]: "# Tea\n\nTea slows you down a bit.\n" });
  await land("finetune", 1, { [WECHAT]: wechatFile("Draft title", "Drink it.") }, { flow: { candidates: { title: TITLES } } });
  if (params.illustrations === true) await land("visuals", 1, { [ILLUSTRATED]: "# Tea\n\n![v](assets/wechat/01-visual.png)\n", [VISUAL]: "png\n" }, { flow: { effect: { remoteId: VISUAL } } });
  await land("article", 1, {}, { flow: { needs: { kind: "input", question: "Which source?", candidates: ["plain", "illustrated"] } } });
  return flowRunId;
}

const command = (world: World, flowRunId: string, stepKey: string, body: Record<string, unknown>, requestId: string) =>
  acceptMessage(world.w.deps, flowRunId, { kind: "command", target: { kind: "step", stepKey }, body, by: "ann", via: "cli:test", requestId });
const needsYouOf = (world: World, flowRunId: string) => readFlowList(world.w.store).runs.find((r) => r.flowRunId === flowRunId)!.needsYou;
const lsTree = (vaultPath: string, commit: string): string[] =>
  execFileSync("/usr/bin/git", ["--git-dir", vaultPath, "ls-tree", "-r", "--name-only", commit], { encoding: "utf8" }).trim().split("\n");

/** The article asked; the cover lands WITHOUT its effect report (§9.6: the effect failed); the article's answer runs it. */
async function coverFailed(world: World): Promise<string> {
  const { w, children, child } = world;
  const flowRunId = await untilArticleAsks(world);
  children.land(child(flowRunId, "cover", 1), COVER_FILES);
  await w.advance();
  expect(w.latest(flowRunId, "cover")).toMatchObject({ state: "failed" });
  await answerNeeds(w.deps, { flowRunId, stepKey: "article" }, "plain", "ann", "cli:test");
  await w.advance();
  children.land(child(flowRunId, "article", 2), { [`${SLUG}.wechat.html`]: "<p>Tea</p>\n" });
  await w.advance();
  // The failed cover stops the run there: the draft box never started.
  expect(w.execs(flowRunId, "to-draft-box")).toHaveLength(0);
  expect(getFlowRun(w.store, flowRunId)!.state).toBe("running");
  return flowRunId;
}

describe("marks are derived from the applied messages (marks.ts, pure)", () => {
  const msg = (seq: number, command: string, stepKey: string, extra: Record<string, unknown> = {}, state: MessageRow["state"] = "applied"): MessageRow => ({
    flowRunId: "r", seq, requestId: `m${seq}`, kind: "command", target: "step", body: { command, target: { kind: "step", stepKey }, ...extra }, by: "ann", via: "t", state, reason: null, at: seq,
  });
  it("the newest mark wins, fill removes it, an unapplied or rejected message is no mark", () => {
    const marks = marksOf([msg(3, "defer", "cover", { effects: { "to-draft-box": "proceed" } }), msg(1, "skip", "cover"), msg(2, "skip", "visuals"), msg(4, "fill", "visuals"),
      msg(5, "skip", "draft", {}, "accepted"), msg(6, "defer", "deslop", {}, "rejected")]);
    expect([...marks.entries()]).toEqual([["cover", { kind: "defer", messageSeq: 3, effects: { "to-draft-box": "proceed" } }]]);
  });
  it("a defer holds the external/irreversible effect steps after it, not its parallel sibling, not a cost step; proceed releases only its own hold", () => {
    const template = {
      effects: { img: { class: "cost" }, push: { class: "external" }, burn: { class: "irreversible" } },
      steps: [
        { id: "a", kind: "work", prompt: "a.md" }, { id: "push1", kind: "work", prompt: "p.md", effect: "push", parallelWith: "a" },
        { id: "b", kind: "work", prompt: "b.md" }, { id: "img", kind: "work", prompt: "i.md", effect: "img" },
        { id: "push2", kind: "work", prompt: "p.md", effect: "push" }, { id: "burn", kind: "work", prompt: "x.md", effect: "burn" },
      ],
    } as unknown as FlowTemplate;
    const both = marksOf([msg(1, "defer", "a"), msg(2, "defer", "b", { effects: { push2: "proceed" } })]);
    expect([...heldEffectSteps(template, both)]).toEqual(["push2", "burn"]);
    expect(heldBy(template, both, "push2")).toEqual(["a"]);
    expect(heldBy(template, both, "burn")).toEqual(["a", "b"]);
    expect([...heldEffectSteps(template, marksOf([msg(1, "skip", "a")]))]).toEqual([]);
  });
});

describe("skip / defer / fill on the wechat run (G5)", { timeout: 60_000 }, () => {
  it("a failed cover deferred: the run continues, the draft box is held; defer … proceed starts it and its level gate applies", async () => {
    const world = await wechatWorld();
    const { w, children, child } = world; try {
      const flowRunId = await coverFailed(world);
      const deferred = await command(world, flowRunId, "cover", { command: "defer" }, "d1");
      expect(deferred).toMatchObject({ state: "applied", reason: null });
      const cover = w.latest(flowRunId, "cover")!;
      expect(cover).toMatchObject({ seq: 2, state: "skipped", by: "ann" });
      expect(cover.body).toMatchObject({ mark: { kind: "defer", messageSeq: deferred.seq } });
      // Held with no effects choice: parked, needs-you `deferred-upstream`, no child opened.
      expect(w.execs(flowRunId, "to-draft-box").map((e) => e.state)).toEqual(["parked"]);
      expect((w.latest(flowRunId, "to-draft-box")!.body as { needsYou?: unknown }).needsYou).toEqual({ kind: "deferred-upstream", deferred: ["cover"] });
      expect(children.opened.has(child(flowRunId, "to-draft-box", 1))).toBe(false);
      // While it is held the run is not done: running, with the held step and the owed cover under needs-you.
      await w.advance();
      expect(getFlowRun(w.store, flowRunId)!.state).toBe("running");
      expect(needsYouOf(world, flowRunId)).toBe(2);

      // proceed: it starts afresh, so its own gate applies -- external at `confirm` is a card, nothing pushed yet.
      setLevels(world, { external: "confirm" });
      await command(world, flowRunId, "cover", { command: "defer", effects: { "to-draft-box": "proceed" } }, "d2");
      expect(w.execs(flowRunId, "to-draft-box").map((e) => e.state)).toEqual(["skipped", "needs-person"]);
      expect((w.latest(flowRunId, "to-draft-box")!.body as { ask?: { kind?: string } }).ask?.kind).toBe("effect-confirm");
      expect(listEffects(w.store, flowRunId).filter((r) => r.stepKey === "to-draft-box").map((r) => r.state)).toEqual(["staged"]);
      expect(children.opened.has(child(flowRunId, "to-draft-box", 2))).toBe(false);
    } finally { await w.dispose(); }
  });

  it("with nothing held a deferred step leaves the run done with needs-you; a skipped one with none", async () => {
    for (const mark of ["defer", "skip"] as const) {
      const world = await wechatWorld();
      const { w, children, child, goalOf } = world; try {
        const flowRunId = await coverFailed(world);
        await command(world, flowRunId, "cover", mark === "defer" ? { command: "defer", effects: { "to-draft-box": "proceed" } } : { command: "skip" }, "m1");
        // Not held (proceed, or a skip): the draft box runs, its prompt told the cover's output is not there.
        expect(goalOf(child(flowRunId, "to-draft-box", 1))).toContain(mark === "defer" ? DEFERRED_LINE("cover") : SKIPPED_LINE("cover"));
        children.land(child(flowRunId, "to-draft-box", 1), {}, { flow: { effect: { remoteId: "media-1" } } });
        await w.advance();
        expect(getFlowRun(w.store, flowRunId)!.state, mark).toBe("done");
        expect(needsYouOf(world, flowRunId), mark).toBe(mark === "defer" ? 1 : 0);
      } finally { await w.dispose(); }
    }
  });

  it("defer of an effect step at its confirm card discards its staged record, by the person", async () => {
    const world = await wechatWorld();
    const { w } = world; try {
      setLevels(world, { cost: "confirm" });
      const flowRunId = await untilArticleAsks(world);
      const card = w.latest(flowRunId, "cover")!;
      expect(card).toMatchObject({ seq: 1, state: "needs-person" });
      const [record] = listEffects(w.store, flowRunId).filter((r) => r.stepKey === "cover");
      expect(record).toMatchObject({ state: "staged" });
      await command(world, flowRunId, "cover", { command: "defer" }, "d1");
      expect(listEffects(w.store, flowRunId).find((r) => r.id === record!.id)!.state).toBe("discarded");
      expect(w.execs(flowRunId, "cover").map((e) => e.state)).toEqual(["skipped", "skipped"]);
      expect(w.execs(flowRunId, "cover")[0]!.body).toMatchObject({ effectDiscarded: record!.id });
      expect(listMessages(w.store, flowRunId).find((m) => m.requestId === `effect:discard:${record!.id}`)).toMatchObject({ by: "ann", via: "cli:test" });
    } finally { await w.dispose(); }
  });

  it("skip or defer on a clarify or ask step is refused flow-step-not-skippable; fill on an unmarked step flow-step-not-marked", async () => {
    const world = await wechatWorld();
    const { w } = world; try {
      const flowRunId = await untilArticleAsks(world);
      expect(await command(world, flowRunId, "brief", { command: "skip" }, "r1")).toMatchObject({ state: "rejected", reason: "flow-step-not-skippable:brief" });
      expect(await command(world, flowRunId, "pick-title", { command: "defer" }, "r2")).toMatchObject({ state: "rejected", reason: "flow-step-not-skippable:pick-title" });
      world.children.land(world.child(flowRunId, "cover", 1), COVER_FILES, COVER_EFFECT);
      await w.advance();
      expect(await command(world, flowRunId, "cover", { command: "fill" }, "r3")).toMatchObject({ state: "rejected", reason: "flow-step-not-marked" });
      expect(listPlans(w.store, flowRunId)).toHaveLength(0);
      expect(marksOf(listMessages(w.store, flowRunId)).size).toBe(0);
    } finally { await w.dispose(); }
  });

  /** Illustrated: visuals ran (its files in the folder); the article asks; the cover lands; then visuals is deferred. */
  async function visualsDeferred(world: World): Promise<string> {
    const { w, children, child } = world;
    const flowRunId = await untilArticleAsks(world, { illustrations: true });
    expect(existsSync(join(w.folder, ILLUSTRATED))).toBe(true);
    children.land(child(flowRunId, "cover", 1), COVER_FILES, COVER_EFFECT);
    await w.advance();
    await command(world, flowRunId, "visuals", { command: "defer" }, "d1");
    return flowRunId;
  }

  it("a deferred visuals: later steps never see its output (base, head, folder), step_heads unchanged, the article's pointer says so", async () => {
    const world = await wechatWorld();
    const { w, children, child, goalOf } = world; try {
      const flowRunId = await visualsDeferred(world);
      expect(listHeads(w.store, flowRunId).visuals).toBe(1);
      // The head and the folder lost the suppressed output at this boundary; the person's other files stay.
      const vault = vaultOf(loadRun(w.store, flowRunId))!;
      const head = lsTree(vault.path, (await readHead(vault, flowRunId))!);
      expect(head).not.toContain(ILLUSTRATED);
      expect(head).not.toContain(VISUAL);
      expect(existsSync(join(w.folder, ILLUSTRATED))).toBe(false);
      expect(existsSync(join(w.folder, VISUAL))).toBe(false);
      expect(existsSync(join(w.folder, WECHAT))).toBe(true);
      // The article runs again (the person's answer): on a base without visuals' files, told visuals is deferred.
      await answerNeeds(w.deps, { flowRunId, stepKey: "article" }, "plain", "ann", "cli:test");
      await w.advance();
      const opened = children.opened.get(child(flowRunId, "article", 2))!;
      const base = lsTree(opened.vaultPath, opened.baseCommit);
      expect(base).toContain(WECHAT);
      expect(base).not.toContain(ILLUSTRATED);
      expect(base).not.toContain(VISUAL);
      expect(goalOf(child(flowRunId, "article", 2))).toContain(DEFERRED_LINE("visuals"));
      expect(listHeads(w.store, flowRunId).visuals).toBe(1);
      // The article landed; the draft box after the deferred visuals is held.
      children.land(child(flowRunId, "article", 2), { [`${SLUG}.wechat.html`]: "<p>Tea</p>\n" });
      await w.advance();
      expect(w.latest(flowRunId, "to-draft-box")).toMatchObject({ state: "parked" });
      expect((w.latest(flowRunId, "to-draft-box")!.body as { needsYou?: unknown }).needsYou).toEqual({ kind: "deferred-upstream", deferred: ["visuals"] });
    } finally { await w.dispose(); }
  });

  it("fill: a plan with reason fill, visuals re-runs (its old output never comes back by itself), the held draft box then runs once under the plan", async () => {
    const world = await wechatWorld();
    const { w, children, child } = world; try {
      const flowRunId = await visualsDeferred(world);
      await answerNeeds(w.deps, { flowRunId, stepKey: "article" }, "plain", "ann", "cli:test");
      await w.advance();
      children.land(child(flowRunId, "article", 2), { [`${SLUG}.wechat.html`]: "<p>Tea</p>\n" });
      await w.advance();
      expect(w.latest(flowRunId, "to-draft-box")).toMatchObject({ seq: 1, state: "parked" });

      expect(await command(world, flowRunId, "visuals", { command: "fill" }, "f1")).toMatchObject({ state: "applied" });
      const [plan] = listPlans(w.store, flowRunId);
      const list = (plan!.candidates as { list: Array<{ stepKey: string; reasons: string[] }>; trigger: string }).list;
      expect((plan!.candidates as { trigger: string }).trigger).toBe("fill");
      expect(list.find((c) => c.stepKey === "visuals")!.reasons).toContain("fill");
      expect(list.find((c) => c.stepKey === "article")!.reasons).toContain("upstream-changed:visuals");
      // Filled is not shown: the old output stays out of the folder until visuals has run again.
      expect(existsSync(join(w.folder, ILLUSTRATED))).toBe(false);
      await w.answer(w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal"), { skips: [] });
      expect(children.opened.has(child(flowRunId, "visuals", 3))).toBe(true);
      expect(existsSync(join(w.folder, ILLUSTRATED))).toBe(false);
      children.land(child(flowRunId, "visuals", 3), { [ILLUSTRATED]: "# Tea\n\n![v2](assets/wechat/01-visual.png)\n", [VISUAL]: "png2\n" }, { flow: { effect: { remoteId: VISUAL } } });
      await w.advance();
      expect(existsSync(join(w.folder, ILLUSTRATED))).toBe(true);
      const article = [...children.opened.keys()].filter((id) => id.includes("article")).at(-1)!;
      children.land(article, { [`${SLUG}.illustrated.html`]: "<p>Tea, illustrated</p>\n" });
      await w.advance();
      const cover = [...children.opened.keys()].filter((id) => id.includes("cover")).at(-1)!;
      children.land(cover, COVER_FILES, COVER_EFFECT);
      await w.advance();
      // Released by the plan reaching it: one draft box, under plan 1, gated afresh (apply-flag by default).
      const boxes = [...children.opened.keys()].filter((id) => id.includes("to-draft-box"));
      expect(boxes).toHaveLength(1);
      children.land(boxes[0]!, {}, { flow: { effect: { remoteId: "media-1" } } });
      await w.advance();
      // The parked execution was released (skipped); the one that ran is plan 1's.
      expect(w.execs(flowRunId, "to-draft-box").map((e) => [e.state, e.planNo])).toEqual([["skipped", null], ["done", 1]]);
      expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
      expect(needsYouOf(world, flowRunId)).toBe(0);
    } finally { await w.dispose(); }
  });

  it("filled but not yet re-run: a recompose meanwhile (another step skipped) does not bring the old output back", async () => {
    const world = await wechatWorld();
    const { w } = world; try {
      const flowRunId = await visualsDeferred(world);
      setLevels(world, { cost: "confirm" });
      await command(world, flowRunId, "visuals", { command: "fill" }, "f1");
      await w.answer(w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal"), { skips: [] });
      expect(w.latest(flowRunId, "visuals")).toMatchObject({ seq: 3, state: "needs-person" });
      expect(existsSync(join(w.folder, "assets/wechat/00-cover.final.txt"))).toBe(true);
      // Skipping the cover composes the head again and copies it back: the cover's files go, visuals' old ones stay out.
      await command(world, flowRunId, "cover", { command: "skip" }, "s1");
      expect(existsSync(join(w.folder, "assets/wechat/00-cover.final.txt"))).toBe(false);
      expect(existsSync(join(w.folder, ILLUSTRATED))).toBe(false);
      expect(existsSync(join(w.folder, VISUAL))).toBe(false);
      expect(listHeads(w.store, flowRunId).visuals).toBe(1);
    } finally { await w.dispose(); }
  });

  it("the model may neither skip a filled step nor mark it unsure: both answers are invalid and asked again", async () => {
    const world = await wechatWorld();
    const { w } = world; try {
      const flowRunId = await visualsDeferred(world);
      await command(world, flowRunId, "visuals", { command: "fill" }, "f1");
      const proposals = () => w.calls.filter((c) => c.purpose === "rerun-proposal").length;
      const last = () => w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal");
      expect(proposals()).toBe(1);
      await w.answer(last(), { skips: [{ stepKey: "visuals", reason: "Same images." }] });
      expect(proposals()).toBe(2);
      expect(listPlans(w.store, flowRunId)[0]).toMatchObject({ state: "proposed", proposal: { retries: 1, lastInvalid: "visuals has feedback or fill; it may not be skipped" } });
      await w.answer(last(), { skips: [], unsure: [{ stepKey: "visuals", question: "Keep the old images?" }] });
      expect(proposals()).toBe(3);
      expect(listPlans(w.store, flowRunId)[0]).toMatchObject({ state: "proposed", proposal: { retries: 2, lastInvalid: "visuals has feedback or fill; it may not be unsure" } });
    } finally { await w.dispose(); }
  });

  it("a defer after fill while the fill plan is open removes the step from the plan", async () => {
    const world = await wechatWorld();
    const { w, children, child } = world; try {
      const flowRunId = await visualsDeferred(world);
      await command(world, flowRunId, "visuals", { command: "fill" }, "f1");
      expect(listPlans(w.store, flowRunId)[0]).toMatchObject({ planNo: 1, state: "proposed" });
      // The person defers again before the plan ran: the newer mark wins.
      await command(world, flowRunId, "visuals", { command: "defer" }, "d2");
      await w.answer(w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal"), { skips: [] });
      const chosen = listPlans(w.store, flowRunId)[0]!.chosen as { steps: string[] };
      expect(chosen.steps).not.toContain("visuals");
      expect(children.opened.has(child(flowRunId, "visuals", 3))).toBe(false);
      expect(w.execs(flowRunId, "visuals").map((e) => e.state)).toEqual(["done", "skipped", "skipped"]);
      expect(w.latest(flowRunId, "visuals")!.body).toMatchObject({ mark: { kind: "defer" } });
      expect(existsSync(join(w.folder, ILLUSTRATED))).toBe(false);
    } finally { await w.dispose(); }
  });

  it("a defer while the running fill plan waits on the step's confirm card takes it out of the plan", async () => {
    const world = await wechatWorld();
    const { w } = world; try {
      const flowRunId = await visualsDeferred(world);
      setLevels(world, { cost: "confirm" });
      await command(world, flowRunId, "visuals", { command: "fill" }, "f1");
      await w.answer(w.calls.map((c) => c.purpose).lastIndexOf("rerun-proposal"), { skips: [] });
      expect(w.latest(flowRunId, "visuals")).toMatchObject({ seq: 3, state: "needs-person", planNo: 1 });
      expect((listPlans(w.store, flowRunId)[0]!.chosen as { steps: string[] }).steps).toContain("visuals");
      await command(world, flowRunId, "visuals", { command: "defer" }, "d2");
      expect((listPlans(w.store, flowRunId)[0]!.chosen as { steps: string[] }).steps).not.toContain("visuals");
      expect(w.execs(flowRunId, "visuals").map((e) => e.state)).toEqual(["done", "skipped", "skipped", "skipped"]);
      expect(listEffects(w.store, flowRunId).filter((r) => r.stepKey === "visuals").map((r) => r.state)).toEqual(["applied", "discarded"]);
    } finally { await w.dispose(); }
  });
});
