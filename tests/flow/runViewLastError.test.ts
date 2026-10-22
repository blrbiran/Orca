/**
 * Found in the Task 18 acceptance: a run whose kernel pass kept failing (`recovery-blocked:flow-child-agent-selection-
 * rejected`) showed its step `running` and nothing else in `orca flow show` -- the error lived only on the run's body.
 * The run view carries the run's last error (and null once a pass succeeds), so the person sees why nothing moves.
 */
import { describe, expect, it } from "vitest";
import { recordRunError } from "../../src/flow/kernel.js";
import { readFlowRun } from "../../src/flow/views.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const TPL = { yaml: "format: orca-flow-v1\nid: t\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: draft, prompt: p.md}\n", assets: { "p.md": "Write.\n" } };

describe("the run view names the run's last error (T18 acceptance finding)", () => {
  it("shows the error the kernel recorded, and null again once it is cleared", async () => {
    const w = await flowWorld({ t: TPL }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/t" });
      expect((readFlowRun(w.store, flowRunId) as { lastError: unknown }).lastError).toBeNull();
      recordRunError(w.deps, flowRunId, "recovery-blocked:flow-child-agent-selection-rejected");
      expect((readFlowRun(w.store, flowRunId) as { lastError: unknown }).lastError).toEqual({ message: "recovery-blocked:flow-child-agent-selection-rejected", at: expect.any(Number) });
      recordRunError(w.deps, flowRunId, null);
      expect((readFlowRun(w.store, flowRunId) as { lastError: unknown }).lastError).toBeNull();
    } finally { await w.dispose(); }
  });
});
