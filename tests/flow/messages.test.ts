import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acceptMessage } from "../../src/flow/messages.js";
import { runPlan } from "../../src/flow/rerun.js";
import { getHead, listMessages, listPlans } from "../../src/flow/store.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §7.4-§7.5, §8 (plan Task 11): the person's message stream. A message is stored (deduped by its
 * request id) and consumed only at a step boundary -- never in the middle of a running step. Feedback and edits make a
 * re-run plan: code bounds the candidates, the model's proposal may only remove, the person runs it (by default the run
 * waits for them), and code executes the chosen steps in template order while skipped steps keep their outputs.
 * A rejected command is recorded with its reason; `repin` makes the steps whose definition changed candidates.
 */
const yaml = (bPrompt = "b.md", version = 1) => `format: orca-flow-v1
id: t
version: ${version}
workspace: {kind: dir}
steps:
  - {id: a, kind: draft, prompt: a.md}
  - {id: b, kind: draft, prompt: ${bPrompt}}
  - {id: c, kind: draft, prompt: c.md}
`;
const TPL = { yaml: yaml(), assets: { "a.md": "Write a.\n", "b.md": "Write b.\n", "c.md": "Write c.\n", "b2.md": "Write b, better.\n" } };
const msg = (over: Record<string, unknown>) => ({ by: "ann", via: "cli:test", requestId: `r-${Math.random()}`, ...over }) as Parameters<typeof acceptMessage>[2];

async function settledRun() {
  const w = await flowWorld({ t: TPL });
  // The person's checklist (`rerunReview: review`); the built-in default is `auto` since gaps spec §5.2.
  w.deps.rerunReview = () => "review";
  const { flowRunId } = await w.start({ templateRef: "builtin/t" });
  await w.advance();
  await w.answer(0, { content: "A1" });
  await w.answer(1, { content: "B1" });
  await w.answer(2, { content: "C1" });
  return { w, flowRunId };
}
const runState = (w: Awaited<ReturnType<typeof flowWorld>>, id: string) => String(w.store.db.prepare("SELECT state FROM flow_runs WHERE id=?").get(id)!.state);

describe("message stream (§8)", () => {
  it("a message never interrupts a running step: it is consumed at the boundary", async () => {
    const w = await flowWorld({ t: TPL }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      expect(w.latest(flowRunId, "a")!.state).toBe("running");
      const accepted = await acceptMessage(w.deps, flowRunId, msg({ kind: "feedback", target: { kind: "step", stepKey: "a" }, body: { text: "shorter" } }));
      expect(accepted.state).toBe("accepted");
      expect(w.calls).toHaveLength(1);
      expect(w.latest(flowRunId, "a")).toMatchObject({ state: "running", seq: 1 });
      expect(listMessages(w.store, flowRunId).at(-1)!.state).toBe("accepted");
      await w.answer(0, { content: "A1" });
      expect(listMessages(w.store, flowRunId).find((m) => m.kind === "feedback")!.state).toBe("applied");
      expect(w.calls.at(-1)).toMatchObject({ purpose: "rerun-proposal", key: { flowRunId, stepKey: "@plan", seq: 1 } });
    } finally { await w.dispose(); }
  });

  it("feedback makes a plan; the person's run executes chosen steps in order and skipped ones keep their outputs", async () => {
    const { w, flowRunId } = await settledRun(); try {
      await acceptMessage(w.deps, flowRunId, msg({ kind: "feedback", target: { kind: "step", stepKey: "b" }, body: { text: "more tea" } }));
      const proposalCall = w.calls.at(-1)!;
      expect(proposalCall).toMatchObject({ purpose: "rerun-proposal" });
      expect(proposalCall.prompt).toContain("more tea");
      expect(listPlans(w.store, flowRunId)[0]!.candidates).toMatchObject({ list: [{ stepKey: "b", reasons: ["feedback"] }, { stepKey: "c", reasons: ["upstream-changed:b"] }] });
      await w.answer(w.calls.length - 1, { skips: [{ stepKey: "c", reason: "c only formats" }] });
      // A person's plan waits for them (rerunReview: review, pinned in settledRun): nothing runs.
      const calls = w.calls.length;
      await w.advance();
      expect(w.calls).toHaveLength(calls);
      expect(listPlans(w.store, flowRunId)[0]!.state).toBe("proposed");
      await runPlan(w.deps, flowRunId, 1, {}, "ann", "cli:test");
      expect(w.calls.at(-1)).toMatchObject({ purpose: "flow-draft", key: { stepKey: "b", seq: 2 } });
      expect(w.calls.at(-1)!.prompt).toContain("more tea");
      await w.answer(w.calls.length - 1, { content: "B2" });
      expect(w.calls).toHaveLength(calls + 1);
      expect(getHead(w.store, flowRunId, "c")).toBe(1);
      expect(w.latest(flowRunId, "c")).toMatchObject({ state: "skipped", planNo: 1 });
      expect(listPlans(w.store, flowRunId)[0]!.state).toBe("done");
      expect(runState(w, flowRunId)).toBe("done");
      // A person's plan writes no decisions for the skips they chose.
      expect(w.store.db.prepare("SELECT count(*) AS n FROM flow_decisions").get()!.n).toBe(0);
    } finally { await w.dispose(); }
  });

  it("cutoff: a re-run whose output did not change takes the later steps out of the plan (§7.5)", async () => {
    const { w, flowRunId } = await settledRun(); try {
      await acceptMessage(w.deps, flowRunId, msg({ kind: "feedback", target: { kind: "step", stepKey: "b" }, body: { text: "check it" } }));
      await w.answer(w.calls.length - 1, { skips: [] });
      await runPlan(w.deps, flowRunId, 1, {}, "ann", "cli:test");
      expect(listPlans(w.store, flowRunId)[0]!.chosen).toMatchObject({ steps: ["b", "c"] });
      const calls = w.calls.length;
      await w.answer(calls - 1, { content: "B1" });
      expect(w.calls).toHaveLength(calls);
      expect(listPlans(w.store, flowRunId)[0]).toMatchObject({ state: "done", chosen: { steps: ["b"] } });
      expect(getHead(w.store, flowRunId, "c")).toBe(1);
    } finally { await w.dispose(); }
  });

  it("an edited step stays out of the plan even when an earlier step re-runs (§7.2)", async () => {
    const { w, flowRunId } = await settledRun(); try {
      await acceptMessage(w.deps, flowRunId, msg({ kind: "feedback", target: { kind: "step", stepKey: "a" }, body: { text: "x" } }));
      await acceptMessage(w.deps, flowRunId, msg({ kind: "edit", target: { kind: "step", stepKey: "b" }, body: { record: { content: "B by Ann" } } }));
      expect(listPlans(w.store, flowRunId).map((p) => p.state)).toEqual(["abandoned", "proposed"]);
      expect(listPlans(w.store, flowRunId)[1]!.candidates).toMatchObject({ list: [{ stepKey: "a", reasons: ["feedback"] }, { stepKey: "c", reasons: ["upstream-changed:a", "upstream-changed:b"] }] });
    } finally { await w.dispose(); }
  });

  it("a plan run twice, or an older plan, is refused flow-plan-stale", async () => {
    const { w, flowRunId } = await settledRun(); try {
      await acceptMessage(w.deps, flowRunId, msg({ kind: "feedback", target: { kind: "step", stepKey: "b" }, body: { text: "x" } }));
      await w.answer(w.calls.length - 1, { skips: [] });
      await runPlan(w.deps, flowRunId, 1, {}, "ann", "cli:test");
      await expect(runPlan(w.deps, flowRunId, 1, {}, "ann", "cli:test")).rejects.toThrow(/flow-plan-stale/);
    } finally { await w.dispose(); }
  });

  it("a duplicate request id stores one row", async () => {
    const { w, flowRunId } = await settledRun(); try {
      const m = msg({ kind: "feedback", target: { kind: "step", stepKey: "c" }, body: { text: "x" }, requestId: "same" });
      const first = await acceptMessage(w.deps, flowRunId, m);
      const second = await acceptMessage(w.deps, flowRunId, m);
      expect(second).toMatchObject({ deduped: true, seq: first.seq });
      expect(listMessages(w.store, flowRunId).filter((row) => row.requestId === "same")).toHaveLength(1);
      expect(listPlans(w.store, flowRunId)).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("a rejected command is stored rejected with its reason", async () => {
    const { w, flowRunId } = await settledRun(); try {
      const retry = await acceptMessage(w.deps, flowRunId, msg({ kind: "command", target: { kind: "step", stepKey: "c" }, body: { command: "retry" } }));
      expect(retry).toMatchObject({ state: "rejected", reason: "flow-step-not-failed" });
      const unknown = await acceptMessage(w.deps, flowRunId, msg({ kind: "command", target: { kind: "run" }, body: { command: "explode" } }));
      expect(unknown.state).toBe("rejected");
      const missing = await acceptMessage(w.deps, flowRunId, msg({ kind: "feedback", target: { kind: "step", stepKey: "zz" }, body: { text: "x" } }));
      expect(missing).toMatchObject({ state: "rejected", reason: "flow-message-target-missing" });
      const rows = listMessages(w.store, flowRunId);
      expect(rows.map((row) => [row.state, row.reason])).toEqual([["rejected", "flow-step-not-failed"], ["rejected", expect.stringMatching(/command/)], ["rejected", "flow-message-target-missing"]]);
      expect(listPlans(w.store, flowRunId)).toHaveLength(0);
    } finally { await w.dispose(); }
  });

  it("pause holds the run at its boundary; resume lets it go on", async () => {
    const w = await flowWorld({ t: TPL }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      await acceptMessage(w.deps, flowRunId, msg({ kind: "command", target: { kind: "run" }, body: { command: "pause" } }));
      await w.answer(0, { content: "A1" });
      expect(runState(w, flowRunId)).toBe("paused");
      expect(w.calls).toHaveLength(1);
      await acceptMessage(w.deps, flowRunId, msg({ kind: "command", target: { kind: "run" }, body: { command: "resume" } }));
      await w.advance();
      expect(w.calls.at(-1)!.key.stepKey).toBe("b");
    } finally { await w.dispose(); }
  });

  it("repin to a new template version makes the steps whose definition changed candidates", async () => {
    const { w, flowRunId } = await settledRun(); try {
      writeFileSync(join(w.builtinRoot, "t", "template.yaml"), yaml("b2.md", 2));
      const wrong = await acceptMessage(w.deps, flowRunId, msg({ kind: "command", target: { kind: "run" }, body: { command: "repin", version: 3 } }));
      expect(wrong.state).toBe("rejected");
      await acceptMessage(w.deps, flowRunId, msg({ kind: "command", target: { kind: "run" }, body: { command: "repin", version: 2 } }));
      expect(listPlans(w.store, flowRunId)[0]!.candidates).toMatchObject({ list: [{ stepKey: "b", reasons: ["definition-changed"] }, { stepKey: "c", reasons: ["upstream-changed:b"] }] });
    } finally { await w.dispose(); }
  });

  it("an edit becomes the step's new active output by the person; the edited step is not a candidate, later steps are", async () => {
    const { w, flowRunId } = await settledRun(); try {
      await acceptMessage(w.deps, flowRunId, msg({ kind: "edit", target: { kind: "step", stepKey: "b" }, body: { record: { content: "B by Ann" } } }));
      expect(w.latest(flowRunId, "b")).toMatchObject({ seq: 2, state: "done", by: "ann", via: "cli:test" });
      expect(getHead(w.store, flowRunId, "b")).toBe(2);
      expect(listPlans(w.store, flowRunId)[0]!.candidates).toMatchObject({ list: [{ stepKey: "c", reasons: ["upstream-changed:b"] }] });
    } finally { await w.dispose(); }
  });
});
