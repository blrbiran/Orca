import { describe, expect, it } from "vitest";
import { acceptMessage } from "../../src/flow/messages.js";
import { getHead, listPlans } from "../../src/flow/store.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §7.4, §21 C12 (IR-I13), goal.md P7: an unattended re-run (a trigger, an `orca-auto` revision) has no
 * person to decide, so it takes the model's proposal as it is -- but the proposal may only skip candidates, and each skip
 * it took is written as a minor decision the person can see and correct later. A skip outside the candidates makes the
 * proposal invalid: it is asked again and, when no valid one comes, every candidate runs.
 */
const TPL = {
  yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
steps:
  - {id: a, kind: draft, prompt: a.md}
  - {id: b, kind: draft, prompt: b.md}
  - {id: c, kind: draft, prompt: c.md}
  - {id: d, kind: draft, prompt: d.md}
`,
  assets: { "a.md": "a\n", "b.md": "b\n", "c.md": "c\n", "d.md": "d\n" },
};

async function settled() {
  const w = await flowWorld({ t: TPL });
  const { flowRunId } = await w.start({ templateRef: "builtin/t" });
  await w.advance();
  for (let n = 0; n < 4; n += 1) await w.answer(n, { content: `out-${n}` });
  return { w, flowRunId };
}
const decisions = (w: Awaited<ReturnType<typeof flowWorld>>, id: string) =>
  w.store.db.prepare(`SELECT grade, step_key, body, "by" FROM flow_decisions WHERE flow_run_id=? ORDER BY seq`).all(id)
    .map((row) => ({ grade: String(row.grade), stepKey: String(row.step_key), body: JSON.parse(String(row.body)) as Record<string, unknown>, by: String(row.by) }));
const unattendedFeedback = (stepKey: string) => ({ kind: "feedback" as const, target: { kind: "step" as const, stepKey }, body: { text: "the trigger saw a stale figure" }, by: "orca-auto", via: "orca", requestId: `trigger-${stepKey}` });

describe("unattended re-runs take the proposal and record each skip (C12)", () => {
  it("an orca-auto plan runs at once with the proposal's skips and writes one minor decision per skip", async () => {
    const { w, flowRunId } = await settled(); try {
      await acceptMessage(w.deps, flowRunId, unattendedFeedback("b"));
      const call = w.calls.length - 1;
      expect(w.calls[call]).toMatchObject({ purpose: "rerun-proposal" });
      await w.answer(call, { skips: [{ stepKey: "c", reason: "c only restates b's title" }, { stepKey: "d", reason: "d is a format pass" }] });
      expect(listPlans(w.store, flowRunId)[0]).toMatchObject({ state: "running", by: "orca-auto", chosen: { steps: ["b"] } });
      expect(decisions(w, flowRunId)).toEqual([
        { grade: "minor", stepKey: "c", by: "orca-auto", body: expect.objectContaining({ kind: "rerun-skip", planNo: 1, reason: "c only restates b's title" }) },
        { grade: "minor", stepKey: "d", by: "orca-auto", body: expect.objectContaining({ kind: "rerun-skip", planNo: 1, reason: "d is a format pass" }) },
      ]);
      expect(w.calls.at(-1)).toMatchObject({ purpose: "flow-draft", key: { stepKey: "b", seq: 2 } });
      await w.answer(w.calls.length - 1, { content: "B2" });
      expect([getHead(w.store, flowRunId, "c"), getHead(w.store, flowRunId, "d")]).toEqual([1, 1]);
      expect(listPlans(w.store, flowRunId)[0]!.state).toBe("done");
    } finally { await w.dispose(); }
  });

  it("a skip outside the candidates is not taken: the proposal is asked again, and with none valid every candidate runs", async () => {
    const { w, flowRunId } = await settled(); try {
      await acceptMessage(w.deps, flowRunId, unattendedFeedback("c"));
      const first = w.calls.length - 1;
      await w.answer(first, { skips: [{ stepKey: "a", reason: "a is fine" }] });
      expect(w.calls).toHaveLength(first + 2);
      expect(w.calls.at(-1)).toMatchObject({ purpose: "rerun-proposal", key: { stepKey: "@plan", seq: 1 } });
      expect(w.calls.at(-1)!.prompt).toContain("a is not a candidate");
      await w.answer(first + 1, { skips: [{ stepKey: "c", reason: "c has feedback but the model skips it" }] });
      await w.answer(first + 2, "not json");
      expect(listPlans(w.store, flowRunId)[0]).toMatchObject({ state: "running", chosen: { steps: ["c", "d"] } });
      expect(decisions(w, flowRunId)).toEqual([]);
      expect(w.calls.at(-1)).toMatchObject({ purpose: "flow-draft", key: { stepKey: "c", seq: 2 } });
    } finally { await w.dispose(); }
  });
});
