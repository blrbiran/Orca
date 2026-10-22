import { describe, expect, it } from "vitest";
import { resolveLevel } from "../../src/flow/settings.js";
import type { FlowsLayer, GlobalFlowsLayer } from "../../src/flow/settingsSchema.js";

/**
 * Flow engine spec §9.1-§9.3, §21 C18 (H24-H26, H29): the level an effect-classed step runs at, resolved by code with its
 * provenance. The project layer overrides the global one (the human: 项目设置覆盖全局设置); `follow-template` takes the
 * template's recommendation; `irreversible` defaults to a confirm card and never reaches apply-flag through a template;
 * a global lock lets a project only tighten (apply-flag < confirm < stage-only). Configured delivery (a push/PR the
 * person set in the Web UI) is their explicit choice: apply-flag.
 */
const step = (recommendedLevel?: "apply-flag" | "confirm" | "stage-only") => (recommendedLevel === undefined ? {} : { recommendedLevel });
const P = (effects: FlowsLayer["effects"]): FlowsLayer => ({ effects });
const G = (effects: GlobalFlowsLayer["effects"], locks: GlobalFlowsLayer["locks"] = []): GlobalFlowsLayer => ({ effects, locks });

describe("effect level resolution (C18)", () => {
  it("project over global over built-in, each with its source", () => {
    expect(resolveLevel("cost", step(), P({ cost: "confirm" }), G({ cost: "stage-only" }))).toEqual({ value: "confirm", source: "project", lockedBy: null });
    expect(resolveLevel("cost", step(), P({}), G({ cost: "stage-only" }))).toEqual({ value: "stage-only", source: "global", lockedBy: null });
    expect(resolveLevel("cost", step(), null, null)).toEqual({ value: "apply-flag", source: "builtin", lockedBy: null });
    expect(resolveLevel("external", step(), null, null)).toEqual({ value: "apply-flag", source: "builtin", lockedBy: null });
    expect(resolveLevel("local", step(), null, null)).toEqual({ value: "apply-flag", source: "builtin", lockedBy: null });
  });

  it("follow-template picks the step's recommended confirm; without one, the class default", () => {
    expect(resolveLevel("external", step("confirm"), P({ external: "follow-template" }), null)).toEqual({ value: "confirm", source: "template", lockedBy: null });
    expect(resolveLevel("external", step("confirm"), null, G({ external: "follow-template" }))).toEqual({ value: "confirm", source: "template", lockedBy: null });
    expect(resolveLevel("external", step(), P({ external: "follow-template" }), null)).toEqual({ value: "apply-flag", source: "builtin", lockedBy: null });
  });

  it("irreversible defaults to confirm and cannot reach apply-flag through a template or a stored value", () => {
    expect(resolveLevel("irreversible", step(), null, null)).toEqual({ value: "confirm", source: "builtin", lockedBy: null });
    expect(resolveLevel("irreversible", step("apply-flag"), P({ irreversible: "follow-template" }), null)).toEqual({ value: "confirm", source: "builtin", lockedBy: null });
    expect(resolveLevel("irreversible", step("stage-only"), P({ irreversible: "follow-template" }), null)).toEqual({ value: "stage-only", source: "template", lockedBy: null });
    expect(resolveLevel("irreversible", step(), P({ irreversible: "apply-flag" }), G({ irreversible: "apply-flag" })).value).toBe("confirm");
  });

  it("configured delivery is the person's explicit choice: apply-flag, even for irreversible", () => {
    expect(resolveLevel("irreversible", step(), null, null, { configuredDelivery: true })).toEqual({ value: "apply-flag", source: "project", lockedBy: null });
  });

  it("a global lock clamps a looser project value to the global one and keeps a tighter one", () => {
    const locked = G({ cost: "confirm" }, ["effects.cost"]);
    expect(resolveLevel("cost", step(), P({ cost: "apply-flag" }), locked)).toEqual({ value: "confirm", source: "global", lockedBy: "global", overriddenByLock: "apply-flag" });
    expect(resolveLevel("cost", step(), P({ cost: "stage-only" }), locked)).toEqual({ value: "stage-only", source: "project", lockedBy: "global" });
    expect(resolveLevel("cost", step(), null, locked)).toEqual({ value: "confirm", source: "global", lockedBy: "global" });
    // A lock on one class binds only that class.
    expect(resolveLevel("external", step(), P({ external: "apply-flag" }), G({ external: "confirm" }, ["effects.cost"]))).toEqual({ value: "apply-flag", source: "project", lockedBy: null });
    // Configured delivery is a project choice: a lock still bounds it.
    expect(resolveLevel("irreversible", step(), null, G({ irreversible: "stage-only" }, ["effects.irreversible"]), { configuredDelivery: true }).value).toBe("stage-only");
  });
});
