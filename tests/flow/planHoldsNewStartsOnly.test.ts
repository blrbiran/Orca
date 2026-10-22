import { describe, expect, it } from "vitest";
import { orchestrationRevision, writeOrchestrationSettings } from "../../src/control/orchestration.js";
import { enactEffect } from "../../src/flow/effects.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { acceptMessage } from "../../src/flow/messages.js";
import { getFlowRun, listEffects, listPlans } from "../../src/flow/store.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

/**
 * Flow engine spec §7.4-§7.5, §8.2, §9.6 (T18 enact, finding B): an open plan the person has not settled holds the run
 * -- it decides which steps START next. It never stops the kernel from reading how an execution already running ended:
 * in the acceptance run plan 1 (from the person's voice feedback) was proposed, the staged draft-box record was enacted,
 * its child failed, and Orca never noticed -- the step stayed `running`, the effect record `confirmed`, the run's
 * lastError null -- because the pass returned at the plan before polling any child. The person then sees a run that
 * looks busy forever and a draft-box effect that seems to be in flight.
 */
const TPL = { t: { yaml: `format: orca-flow-v1
id: t
workspace: {kind: dir}
effects:
  wechat-draft: {class: external}
steps:
  - {id: note, kind: draft, prompt: note.md}
  - {id: upload, kind: work, prompt: upload.md, effect: wechat-draft}
`, assets: { "note.md": "Note.\n", "upload.md": "Upload.\n" } } };

async function enactedUnderProposedPlan() {
  const children = fakeChildPort();
  const w = await flowWorld(TPL, { children: children.port });
  w.store.transaction(() => writeOrchestrationSettings(w.store, { maxRunningGroups: 3, flows: { effects: { external: "stage-only" } } }, orchestrationRevision(w.store) + 1));
  const { flowRunId } = await w.start({ templateRef: "builtin/t" });
  await w.advance();
  await w.answer(0, { content: "note" });
  expect(getFlowRun(w.store, flowRunId)!.state).toBe("done");
  const [record] = listEffects(w.store, flowRunId);
  // The person's feedback makes a plan; its proposal call is never answered here, so it stays proposed (the
  // built-in rerunReview is `auto` since gaps spec §5.2: an answered proposal would run it at once).
  await acceptMessage(w.deps, flowRunId, { kind: "feedback", target: { kind: "step", stepKey: "note" }, body: { text: "shorter" }, by: "ann", via: "cli:test", requestId: "fb-1" });
  expect(listPlans(w.store, flowRunId).map((p) => p.state)).toEqual(["proposed"]);
  expect(await enactEffect(w.deps, record!.id, "ann", "cli:test")).toEqual({ state: "running", recordId: record!.id });
  const child = childGroupIdOf(flowRunId, "upload", 1);
  expect(children.opened.has(child)).toBe(true);
  return { w, children, flowRunId, child, recordId: record!.id };
}

describe("an open plan holds new starts only (§7.4, T18 finding B)", () => {
  it("a child that failed while a plan is proposed is settled: the step fails, its effect record fails", async () => {
    const { w, children, flowRunId, child, recordId } = await enactedUnderProposedPlan(); try {
      children.fail(child, "md2wechat refused the cover");
      await w.advance();
      expect(w.latest(flowRunId, "upload")).toMatchObject({ seq: 1, state: "failed" });
      expect((w.latest(flowRunId, "upload")!.body as { failure?: string }).failure).toBe("md2wechat refused the cover");
      expect(listEffects(w.store, flowRunId).find((r) => r.id === recordId)!.state).toBe("failed");
      // The plan still holds what it holds: nothing new started, it is still the person's to run.
      expect(listPlans(w.store, flowRunId).map((p) => p.state)).toEqual(["proposed"]);
      expect(w.execs(flowRunId, "note")).toHaveLength(1);
    } finally { await w.dispose(); }
  });

  it("a child that landed while a plan is proposed is settled: the step is done and its effect applied", async () => {
    const { w, children, flowRunId, child, recordId } = await enactedUnderProposedPlan(); try {
      children.land(child, { "sent.json": "{}" }, { flow: { effect: { remoteId: "media-9" } } });
      await w.advance();
      expect(w.latest(flowRunId, "upload")).toMatchObject({ seq: 1, state: "done" });
      expect(listEffects(w.store, flowRunId).find((r) => r.id === recordId)).toMatchObject({ state: "applied", remoteRef: "media-9" });
      expect(listPlans(w.store, flowRunId).map((p) => p.state)).toEqual(["proposed"]);
    } finally { await w.dispose(); }
  });
});
