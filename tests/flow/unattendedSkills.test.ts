import { describe, expect, it } from "vitest";
import { reportedFlowOf } from "../../src/control/reportedDecisions.js";
import { answerNeeds, openAsks } from "../../src/flow/kernel.js";
import { builtinKinds, type KindDefinition } from "../../src/flow/kinds/registry.js";
import { UNATTENDED_FRAGMENT, buildStepPrompt } from "../../src/flow/prompt.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §4.3 criterion C22: an agent that cannot answer a skill's question reports `flow.needs`; the execution
 * ends needs-person, which parks only that step and the steps after it (a parallel sibling finishes); code opens an ask
 * and the answer queues a revision carrying it. A confirmation from an unclassed step surfaces as an ask too.
 *
 * The `work` kind is plan Task 10's; this criterion registers a stand-in that reads a run result the way it will, through
 * reportedFlowOf, so the kernel's handling of `flow.needs` is what is measured.
 */
const standInWork: KindDefinition = {
  kind: "work", kindVersion: 1, interactive: false,
  async start(ctx) { return { call: { purpose: "flow-work-stand-in", prompt: ctx.prompt(), responseSchema: {}, maxOutputTokens: 1000 } }; },
  collect(_ctx, raw) {
    const flow = reportedFlowOf(raw);
    if (flow.kind === "malformed") return { invalid: "flow-malformed" };
    if (flow.kind === "object" && flow.value.needs !== undefined) return { needs: flow.value.needs };
    return { done: { record: { result: raw } } };
  },
};
// The stand-in replaces the built-in work kind (Task 10 registers a real one, which needs a child port).
const registry = () => { const base = builtinKinds(); return { register: base.register, get: (kind: string) => kind === "work" ? standInWork : base.get(kind) }; };

const TPL = {
  yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
steps:
  - {id: act, kind: work, prompt: act.md}
  - {id: side, kind: draft, prompt: side.md, parallelWith: act}
  - {id: after, kind: draft, prompt: after.md}
`,
  assets: { "act.md": "Act.\n", "side.md": "Side.\n", "after.md": "After.\n" },
};

describe("flow.needs parks only its step (C22)", () => {
  it("an input request opens an ask; the sibling finishes; the answer queues a revision with it in the prompt", async () => {
    const w = await flowWorld({ t: TPL }, { registry: registry() }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      expect(w.calls.map((c) => c.key.stepKey)).toEqual(["act", "side"]);
      expect(w.calls[0]!.prompt).toContain(UNATTENDED_FRAGMENT.trim());
      await w.answer(0, { flow: { needs: { kind: "input", question: "Which audience?", candidates: ["engineers", "managers"] } } });
      expect(w.latest(flowRunId, "act")!.state).toBe("needs-person");
      expect(openAsks(w.store, flowRunId)).toEqual([{ stepKey: "act", seq: 1, ask: { kind: "input", question: "Which audience?", candidates: ["engineers", "managers"], unclassed: true } }]);
      await w.answer(1, { content: "side done" });
      expect(w.latest(flowRunId, "side")!.state).toBe("done");
      expect(w.execs(flowRunId, "after")).toHaveLength(0);
      expect(w.calls).toHaveLength(2);

      await answerNeeds(w.deps, { flowRunId, stepKey: "act" }, "engineers", "ann", "cli:test");
      await w.advance();
      expect(openAsks(w.store, flowRunId)).toEqual([]);
      expect(w.calls[2]).toMatchObject({ key: { stepKey: "act", seq: 2 } });
      expect(w.calls[2]!.prompt).toContain("Which audience?");
      expect(w.calls[2]!.prompt).toContain("engineers");
      await w.answer(2, { decisions: [] });
      expect(w.latest(flowRunId, "act")!.state).toBe("done");
      expect(w.calls[3]).toMatchObject({ key: { stepKey: "after" } });
    } finally { await w.dispose(); }
  });

  it("a confirmation request from an unclassed step surfaces as an ask", async () => {
    const w = await flowWorld({ t: TPL }, { registry: registry() }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      await w.advance();
      await w.answer(0, { flow: { needs: { kind: "confirmation", what: "upload 3 images", payloadSummary: "cover.png, a.png, b.png" } } });
      expect(openAsks(w.store, flowRunId)).toEqual([{ stepKey: "act", seq: 1, ask: { kind: "confirmation", what: "upload 3 images", payloadSummary: "cover.png, a.png, b.png", unclassed: true } }]);
    } finally { await w.dispose(); }
  });
});

describe("reportedFlowOf (spec §4.3)", () => {
  it("reads only the top-level flow key", () => {
    expect(reportedFlowOf({ decisions: [] })).toEqual({ kind: "absent" });
    expect(reportedFlowOf({ flow: { candidates: { title: { items: ["A", "B"], recommended: 1 } }, effect: { remoteId: "m-1" } } }))
      .toEqual({ kind: "object", value: { candidates: { title: { items: ["A", "B"], recommended: 1 } }, effect: { remoteId: "m-1" } } });
    expect(reportedFlowOf({ flow: { candidates: { title: { items: ["A", "B", "C", "D"], recommended: 0 } } } }).kind).toBe("malformed");
    expect(reportedFlowOf({ flow: { candidates: { title: { items: ["A"], recommended: 1 } } } }).kind).toBe("malformed");
    expect(reportedFlowOf({ flow: { needs: { kind: "input", question: "q" } } }).kind).toBe("malformed");
    expect(reportedFlowOf({ flow: { extra: 1 } }).kind).toBe("malformed");
  });
});

describe("buildStepPrompt (spec §12.1)", () => {
  it("orders role prefix, instruction, pointers, acceptance, then the unattended fragment, which a template cannot remove", () => {
    const prompt = buildStepPrompt({ role: "writer", instruction: "Write it.", pointers: ["- outline (draft): kettle"], acceptance: ["test -s a.md"], unattended: true });
    const at = (s: string) => prompt.indexOf(s);
    expect(at("Role: writer")).toBeLessThan(at("Write it."));
    expect(at("Write it.")).toBeLessThan(at("kettle"));
    expect(at("kettle")).toBeLessThan(at("test -s a.md"));
    expect(at("test -s a.md")).toBeLessThan(at(UNATTENDED_FRAGMENT.trim()));
    expect(UNATTENDED_FRAGMENT).toContain("flow.needs");
    expect(UNATTENDED_FRAGMENT).toContain("--confirmed-by-orca");
  });
});
