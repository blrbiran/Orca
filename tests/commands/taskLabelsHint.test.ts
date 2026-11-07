import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

describe("task set-labels names the labels it accepts (tester #186)", () => {
  it("prints the vocabulary and the custom form with a labels-invalid refusal", async () => {
    const w = await world({}, {
      "POST groups/g-alpha/tasks/t1/labels": () => ({ status: 422, body: { error: { code: "labels-invalid", message: "labels-invalid:Feature", commandRevision: 5, evidenceIds: [], retryable: false } } }),
    });
    const out = await cli(["task", "set-labels", "g-alpha", "t1", "--label", "Feature"], w.dir);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("valid labels: feature, bug, refactor, test, doc, design, investigate, perf, security, chore, or custom:<text>");
  });
});
