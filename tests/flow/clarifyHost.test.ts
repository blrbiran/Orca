import { describe, expect, it } from "vitest";
import { readRoundsAt } from "../../src/control/requirementRecords.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { answerFlowClarify, flowClarifyConsensus } from "../../src/flow/kinds/clarify.js";
import { getFlowRun, getHead } from "../../src/flow/store.js";
import { ROUND_ONE, ROUND_TWO } from "../control/fixtures/requirementOutputs.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §10.1 criterion C8 (IR-I13): a flow clarify step drafts with the template's background and sections,
 * stores its rounds under (parent group, step key, execution) -- never the dev flow's ('clarify', 1) -- and on consensus
 * completes the step with the document record; the requirement host's consensus (a split draft) never runs.
 */
const BRIEF = {
  yaml: `format: orca-flow-v1
id: t
params:
  idea: {type: longtext, required: true}
workspace: {kind: dir}
steps:
  - {id: brief, kind: clarify, background: prompts/brief.md, sections: [Reader, Purpose]}
  - {id: outline, kind: draft, prompt: prompts/outline.md}
`,
  assets: { "prompts/brief.md": "You are briefing a WeChat article for engineers.\n", "prompts/outline.md": "Outline.\n" },
};

describe("flow clarify host (C8)", () => {
  it("drafts with the template's background and sections and stores rounds under the step execution", async () => {
    const w = await flowWorld({ t: BRIEF }, { files: { "notes/raw.md": "material\n" } }); try {
      const { flowRunId, groupId } = await w.start({ templateRef: "builtin/t", params: { idea: "Why tea" } });
      await w.advance();
      expect(w.calls).toHaveLength(1);
      const prompt = w.calls[0]!.prompt;
      expect(w.calls[0]).toMatchObject({ purpose: "clarify", key: { stepKey: "brief", seq: 1 } });
      expect(prompt).toContain("You are briefing a WeChat article for engineers.");
      expect(prompt).toContain("## Reader");
      expect(prompt).toContain("## Purpose");
      expect(prompt).not.toContain("one software repository");
      expect(prompt).toContain("Why tea");
      // Context: the run params and a listing of the workspace composition.
      expect(prompt).toMatch(/<<<ORCA-DATA context [0-9a-f]{16}/);
      expect(prompt).toContain("notes/raw.md");
      expect(readRoundsAt(w.store, { groupId, stepKey: "brief", execSeq: 1 }).map((r) => r.state)).toEqual(["drafting"]);
      expect(readRoundsAt(w.store, { groupId, stepKey: "clarify", execSeq: 1 })).toEqual([]);

      await w.answer(0, ROUND_ONE);
      expect(w.latest(flowRunId, "brief")!.state).toBe("needs-person");
      expect(w.calls).toHaveLength(1);
      const q = readRoundsAt(w.store, { groupId, stepKey: "brief", execSeq: 1 })[0]!.result!.questions;
      await answerFlowClarify(w.deps, { flowRunId, stepKey: "brief" }, {
        roundNo: 1, answers: [{ id: q[0]!.id, kind: "recommended" }, { id: q[1]!.id, kind: "text", text: "None" }], glossaryDecisions: [], adrDecisions: [],
      }, "ann", "cli:test");
      expect(w.calls).toHaveLength(2);
      expect(w.calls[1]!.key).toEqual(w.calls[0]!.key);
      expect(w.calls[1]!.prompt).toContain("None");
      await w.answer(1, ROUND_TWO);
      expect(readRoundsAt(w.store, { groupId, stepKey: "brief", execSeq: 1 }).map((r) => r.state)).toEqual(["answered", "awaiting-answers"]);

      await flowClarifyConsensus(w.deps, { flowRunId, stepKey: "brief" }, "ann", "cli:test");
      await w.advance();
      const brief = w.latest(flowRunId, "brief")!;
      expect(brief).toMatchObject({ state: "done", outputKind: "artifact" });
      expect(getHead(w.store, flowRunId, "brief")).toBe(1);
      const doc = JSON.parse(readCanonicalRecord(w.store, brief.outputRef!)) as { statement: string; sections: string[] };
      expect(doc).toMatchObject({ statement: ROUND_TWO.statement, sections: ["Reader", "Purpose"] });
      // The requirement host's consensus (draft 1 and its split call) never ran.
      expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM requirement_drafts").get()).toMatchObject({ n: 0 });
      expect(w.store.db.prepare("SELECT COUNT(*) AS n FROM scheduler_wakes").get()).toMatchObject({ n: 0 });
      expect(getFlowRun(w.store, flowRunId)!.groupId).toBe(groupId);
      expect(w.calls[2]).toMatchObject({ purpose: "flow-draft", key: { stepKey: "outline" } });
      expect(w.calls[2]!.prompt).toContain(ROUND_TWO.statement);
    } finally { await w.dispose(); }
  });

  it("a run started with clarify skip records the idea as the document, marked not clarified", async () => {
    const w = await flowWorld({ t: BRIEF }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { idea: "Why tea" }, clarify: "skip" });
      await w.advance();
      const brief = w.latest(flowRunId, "brief")!;
      expect(brief.state).toBe("done");
      expect(JSON.parse(readCanonicalRecord(w.store, brief.outputRef!))).toMatchObject({ statement: "Why tea", notClarified: true });
      expect(w.calls.map((c) => c.purpose)).toEqual(["flow-draft"]);
    } finally { await w.dispose(); }
  });
});
