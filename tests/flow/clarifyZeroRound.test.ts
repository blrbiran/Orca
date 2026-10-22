import { describe, expect, it } from "vitest";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §10.2 level 2, criterion C9 (IR-I13): under `mode: auto` the round-1 answer may set `zeroRound: true`
 * with a one-line understanding; code accepts it only for small + clear, reaches consensus at once with no questions and
 * records the understanding as a minor decision. Any other class or mode makes the answer invalid (the retry path).
 */
const tpl = (mode: string) => ({
  yaml: `format: orca-flow-v1
id: t
params:
  idea: {type: longtext, required: true}
workspace: {kind: dir}
steps:
  - {id: brief, kind: clarify${mode}, background: b.md}
  - {id: outline, kind: draft, prompt: o.md}
`,
  assets: { "b.md": "Brief an article.\n", "o.md": "Outline.\n" },
});

const zero = (scope: string, clarity: string) => ({
  slug: "tea", statement: "An article on tea for engineers.", acceptanceCriteria: [{ id: "AC1", text: "Mentions tea." }],
  questions: [], frontierEmpty: true, openBranches: [], glossary: [], adrs: [],
  classification: { scope, scopeReason: "One article.", clarity, clarityReason: "The idea says it all." },
  zeroRound: true, understanding: "A short tea article for engineers.",
});

const decisions = (w: { store: { db: { prepare(sql: string): { all(...a: unknown[]): unknown[] } } } }, flowRunId: string) =>
  w.store.db.prepare("SELECT grade, step_key AS stepKey, body, \"by\" FROM flow_decisions WHERE flow_run_id=?").all(flowRunId) as Array<{ grade: string; stepKey: string; body: string; by: string }>;

describe("clarify zero round (C9)", () => {
  it("small + clear under mode auto: consensus at once, one minor decision with the understanding", async () => {
    const w = await flowWorld({ t: tpl(", mode: auto") }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { idea: "tea" } });
      await w.advance();
      expect(w.calls[0]!.prompt).toContain("zeroRound");
      await w.answer(0, zero("small", "clear"));
      const brief = w.latest(flowRunId, "brief")!;
      expect(brief.state).toBe("done");
      expect(JSON.parse(readCanonicalRecord(w.store, brief.outputRef!))).toMatchObject({ zeroRound: true, understanding: "A short tea article for engineers." });
      const rows = decisions(w, flowRunId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ grade: "minor", stepKey: "brief", by: "orca-auto" });
      expect(JSON.parse(rows[0]!.body)).toMatchObject({ kind: "clarify-zero-round", understanding: "A short tea article for engineers." });
      expect(w.calls[1]).toMatchObject({ purpose: "flow-draft" });
    } finally { await w.dispose(); }
  });

  it("a medium class makes zeroRound invalid: retried with the reason, no decision", async () => {
    const w = await flowWorld({ t: tpl(", mode: auto") }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { idea: "tea" } });
      await w.advance();
      await w.answer(0, zero("medium", "clear"));
      expect(w.calls).toHaveLength(2);
      expect(w.calls[1]!.key).toEqual(w.calls[0]!.key);
      expect(w.calls[1]!.prompt).toContain("zero-round-not-allowed");
      expect(w.latest(flowRunId, "brief")!.state).toBe("running");
      expect(decisions(w, flowRunId)).toHaveLength(0);
    } finally { await w.dispose(); }
  });

  it("without mode auto zeroRound is invalid even for small + clear", async () => {
    const w = await flowWorld({ t: tpl("") }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { idea: "tea" } });
      await w.advance();
      expect(w.calls[0]!.prompt).not.toContain("zeroRound");
      await w.answer(0, zero("small", "clear"));
      expect(w.calls).toHaveLength(2);
      expect(w.calls[1]!.prompt).toContain("zero-round-not-allowed");
      expect(decisions(w, flowRunId)).toHaveLength(0);
    } finally { await w.dispose(); }
  });
});
