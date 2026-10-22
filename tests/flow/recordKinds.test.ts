import { describe, expect, it } from "vitest";
import { getHead, listMessages } from "../../src/flow/store.js";
import { UNATTENDED_FRAGMENT } from "../../src/flow/prompt.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §4.2 (plan Task 8): the record kinds. `draft` is one schema-validated single call whose invalid output
 * takes the existing retry path; `check` runs its commands in the composition's worktree and a failing gate fails the
 * step (diagnostic output reaches the next prompt); `review` runs only after the gates pass, and `revise` queues an
 * `orca-auto` feedback revision of the reviewed step, at most `maxRounds`, then proceeds flagged.
 */
const HEAD = `format: orca-flow-v1
id: t
params:
  idea: {type: longtext, required: true}
workspace: {kind: dir}
roles:
  writer: {tier: high}
  reviewer: {tier: high, distinctFrom: writer, suggest: {agent: codex}}
`;

const DRAFT_ONLY = {
  yaml: `${HEAD}steps:
  - {id: outline, kind: draft, role: writer, prompt: prompts/outline.md}
  - {id: body, kind: draft, role: writer, prompt: prompts/body.md}
`,
  assets: { "prompts/outline.md": "Outline the idea: {{param.idea}}\n", "prompts/body.md": "Write the body.\n" },
};

describe("draft kind", () => {
  it("dispatches one call with the template prompt, records the content and points the next step at it", async () => {
    const w = await flowWorld({ t: DRAFT_ONLY }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { idea: "Tea at dawn" } });
      await w.advance();
      expect(w.calls).toHaveLength(1);
      expect(w.calls[0]).toMatchObject({ purpose: "flow-draft", key: { flowRunId, stepKey: "outline", seq: 1 } });
      expect(w.calls[0]!.prompt).toContain("Outline the idea: Tea at dawn");
      expect(w.calls[0]!.prompt).toContain("Role: writer");
      await w.answer(0, { content: "1. kettle 2. cups" });
      expect(w.latest(flowRunId, "outline")).toMatchObject({ state: "done", outputKind: "artifact" });
      expect(getHead(w.store, flowRunId, "outline")).toBe(1);
      expect(w.calls).toHaveLength(2);
      expect(w.calls[1]!.key.stepKey).toBe("body");
      // Code-generated pointer to the earlier active output (spec §12.1).
      expect(w.calls[1]!.prompt).toContain("1. kettle 2. cups");
      await w.answer(1, { content: "Body." });
      expect(w.store.db.prepare("SELECT state FROM flow_runs WHERE id=?").get(flowRunId)).toMatchObject({ state: "done" });
    } finally { await w.dispose(); }
  });

  it("an invalid output is retried twice with the reason, then the step fails and nothing after it starts", async () => {
    const w = await flowWorld({ t: DRAFT_ONLY }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { idea: "x" } });
      await w.advance();
      await w.answer(0, { nope: 1 });
      expect(w.calls).toHaveLength(2);
      expect(w.calls[1]!.key).toEqual(w.calls[0]!.key);
      expect(w.calls[1]!.prompt).toContain("Your previous answer was discarded");
      await w.answer(1, "not json");
      await w.answer(2, { content: "" });
      expect(w.calls).toHaveLength(3);
      expect(w.latest(flowRunId, "outline")).toMatchObject({ state: "failed" });
      expect((w.latest(flowRunId, "outline")!.body as { failure: string }).failure).toBe("draft-output-invalid");
      expect(w.execs(flowRunId, "body")).toHaveLength(0);
    } finally { await w.dispose(); }
  });
});

const CHECKED = {
  yaml: `${HEAD}steps:
  - {id: outline, kind: draft, role: writer, prompt: prompts/outline.md}
  - id: verify
    kind: check
    acceptance:
      checks:
        - {id: note, run: "test -s note.md && test ! -w '{{base:note.md}}' && grep -q tea '{{base:note.md}}'", role: gate}
        - {id: count, run: "echo DIAG-WORDS-$(wc -w < note.md | tr -d ' ')", role: diagnostic}
  - {id: polish, kind: review, role: reviewer, reviews: outline, rubric: prompts/rubric.md, maxRounds: 1}
`,
  assets: { "prompts/outline.md": "Outline.\n", "prompts/rubric.md": "Is it short?\n" },
};

describe("check kind", () => {
  it("runs in the composition's worktree with {{base:...}} read-only; diagnostics reach the next prompt", async () => {
    const w = await flowWorld({ t: CHECKED }, { files: { "note.md": "green tea\n" } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { idea: "x" } });
      await w.advance();
      await w.answer(0, { content: "outline" });
      expect(w.latest(flowRunId, "verify")).toMatchObject({ state: "done", outputKind: "artifact" });
      expect(w.calls).toHaveLength(2);
      expect(w.calls[1]).toMatchObject({ purpose: "flow-review", key: { stepKey: "polish" } });
      expect(w.calls[1]!.prompt).toContain("DIAG-WORDS-2");
    } finally { await w.dispose(); }
  });

  it("a failing gate fails the step and the review is never dispatched", async () => {
    const w = await flowWorld({ t: CHECKED }, { files: { "note.md": "coffee\n" } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { idea: "x" } });
      await w.advance();
      await w.answer(0, { content: "outline" });
      const verify = w.latest(flowRunId, "verify")!;
      expect(verify.state).toBe("failed");
      expect((verify.body as { failure: string }).failure).toBe("gate-failed:note");
      await w.advance();
      expect(w.calls).toHaveLength(1);
      expect(w.execs(flowRunId, "polish")).toHaveLength(0);
    } finally { await w.dispose(); }
  });
});

describe("review kind", () => {
  it("revise queues an orca-auto feedback revision up to maxRounds, then proceeds flagged; prompts carry the unattended fragment", async () => {
    const w = await flowWorld({ t: CHECKED }, { files: { "note.md": "green tea\n" } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { idea: "x" } });
      await w.advance();
      await w.answer(0, { content: "long outline" });
      expect(w.calls[1]!.prompt).toContain("Is it short?");
      expect(w.calls[1]!.prompt).toContain("long outline");
      expect(w.calls[1]!.prompt.trimEnd().endsWith(UNATTENDED_FRAGMENT.trimEnd())).toBe(true);
      await w.answer(1, { verdict: "revise", findings: ["Cut it to three lines."] });
      const feedback = listMessages(w.store, flowRunId);
      expect(feedback).toHaveLength(1);
      expect(feedback[0]).toMatchObject({ kind: "feedback", target: "step", by: "orca-auto", via: "orca", body: { stepKey: "outline" } });
      // The reviewed step runs again with the findings; the gate and the review follow it.
      expect(w.calls[2]).toMatchObject({ purpose: "flow-draft", key: { stepKey: "outline", seq: 2 } });
      expect(w.calls[2]!.prompt).toContain("Cut it to three lines.");
      await w.answer(2, { content: "short" });
      expect(w.execs(flowRunId, "verify").map((e) => e.state)).toEqual(["done", "done"]);
      expect(w.calls[3]).toMatchObject({ purpose: "flow-review", key: { stepKey: "polish", seq: 2 } });
      await w.answer(3, { verdict: "revise", findings: ["Still long."] });
      // maxRounds 1 is spent: no third outline; the review ends flagged and the run is done.
      expect(w.execs(flowRunId, "outline")).toHaveLength(2);
      expect((w.latest(flowRunId, "polish")!.body as { flags: string[] }).flags).toEqual(["review-unresolved"]);
      expect(w.store.db.prepare("SELECT state FROM flow_runs WHERE id=?").get(flowRunId)).toMatchObject({ state: "done" });
    } finally { await w.dispose(); }
  });

  it("fail fails the review step", async () => {
    const w = await flowWorld({ t: CHECKED }, { files: { "note.md": "green tea\n" } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t", params: { idea: "x" } });
      await w.advance();
      await w.answer(0, { content: "o" });
      await w.answer(1, { verdict: "fail", findings: ["Off topic."] });
      expect(w.latest(flowRunId, "polish")).toMatchObject({ state: "failed" });
    } finally { await w.dispose(); }
  });
});
