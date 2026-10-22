/**
 * Review finding M3: an edit reaches applyEdit from the boundary, from a rewind's re-apply and from an ask's write-back.
 * One carrying neither a record nor files is refused by name (`flow-message-invalid`, a FlowRefusal the boundary books as
 * the message's rejection) -- never a TypeError that would stop the run's boundary on a workspace step.
 */
import { describe, expect, it } from "vitest";
import { FlowRefusal, loadRun } from "../../src/flow/kernel.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { applyEdit } from "../../src/flow/messages.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const ONE = { one: { yaml: "format: orca-flow-v1\nid: one\nworkspace: {kind: dir}\nsteps:\n  - {id: write, kind: work, prompt: p.md}\n", assets: { "p.md": "Write.\n" } } };

describe("an edit with neither record nor files (M3)", () => {
  it("is refused flow-message-invalid on a workspace step, and nothing is written", async () => {
    const children = fakeChildPort();
    const w = await flowWorld(ONE, { children: children.port }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/one" });
      await w.advance();
      children.land(childGroupIdOf(flowRunId, "write", 1), { "a.md": "a\n" });
      await w.advance();
      const edit = applyEdit(w.deps, loadRun(w.store, flowRunId), { seq: 1, by: "ann", via: "cli:test", body: { target: { kind: "step", stepKey: "write" } } }, { kind: "step", stepKey: "write" });
      await expect(edit).rejects.toBeInstanceOf(FlowRefusal);
      await expect(edit).rejects.toMatchObject({ code: "flow-message-invalid", detail: "edit needs record or files" });
      expect(w.execs(flowRunId, "write").map((e) => e.seq)).toEqual([1]);
    } finally { await w.dispose(); }
  });
});
