/**
 * Gaps plan Task 10-A (spec §6.3, §8.4): what the run page reads to offer a defer dialog and "set <param> instead". Each
 * step names the external/irreversible effect steps a defer of it would hold (`deferHolds`, the same rule the defer
 * command checks its `effects` against: after it in template order, not its `parallelWith` sibling, cost and local
 * effects never), and the params its `when` reads with their types (`whenParams`). Without them the page would have to
 * guess which defer needs the dialog, or which param would stand in for a failed step.
 */
import { describe, expect, it } from "vitest";
import { readFlowRun } from "../../src/flow/views.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const YAML = `format: orca-flow-v1
id: h
params:
  cover: {type: path, required: false}
  fancy: {type: bool, default: false}
workspace: {kind: dir}
effects:
  gen: {class: cost}
  push: {class: external}
  burn: {class: irreversible}
steps:
  - {id: write, kind: draft, prompt: p.md}
  - {id: art, kind: draft, prompt: p.md, when: {and: [{not: {param: cover, truthy: true}}, {param: fancy, truthy: true}, {param: cover, truthy: false}]}}
  - {id: image, kind: work, prompt: p.md, effect: gen, parallelWith: send}
  - {id: send, kind: work, prompt: p.md, effect: push}
  - {id: seal, kind: work, prompt: p.md, effect: burn}
`;

type StepView = { stepKey: string; deferHolds: string[]; whenParams: Array<{ id: string; type: string | null }> };

describe("the run view names what a defer would hold and the params a step's `when` reads (Task 10-A)", () => {
  it("lists the held effect steps per step and each `when` param once, with its type", async () => {
    const w = await flowWorld({ h: { yaml: YAML, assets: { "p.md": "Write.\n" } } });
    try {
      const { flowRunId } = await w.start({ templateRef: "builtin/h", params: { fancy: true } });
      const steps = (readFlowRun(w.store, flowRunId) as { steps: StepView[] }).steps;
      const of = (key: string) => steps.find((s) => s.stepKey === key)!;
      // mutation: hold every later effect step (drop the class filter) -> write's list gains image, red
      expect(of("write").deferHolds).toEqual(["send", "seal"]);
      // mutation: drop the parallelWith exclusion -> image's list gains send, red
      expect(of("image").deferHolds).toEqual(["seal"]);
      expect(of("seal").deferHolds).toEqual([]);
      // mutation: report only the first param of a compound `when` -> fancy missing, red
      expect(of("art").whenParams).toEqual([{ id: "cover", type: "path" }, { id: "fancy", type: "bool" }]);
      expect(of("write").whenParams).toEqual([]);
    } finally { await w.dispose(); }
  });
});
