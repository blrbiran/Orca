import { describe, expect, it } from "vitest";
import { frozenSlotOf, type AgentResolution } from "../../src/control/agentSelection.js";
import { ccloopResolutionSchema } from "../../src/control/ccloopPort.js";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { frozenSlotSchema } from "../../src/control/webProtocol.js";

// ccloop declared-context-window spec 2026-10-21 §2.3 (#70): when the window is the installation's declared value, not the
// catalog's, the resolution says so. Orca freezes the marker (so a stored estimate or snapshot can still show "声明值"), and
// a slot without it keeps its bytes -- the marker must not change any hash over a slot whose window is the catalog's.
const answer = (extra: Record<string, unknown> = {}) => ({
  protocol: 3, selection: { agent: "codex", model: "gpt-unlisted", contextWindow: "agent-default" }, configHash: "d".repeat(64), timeoutMs: 120_000, killGraceMs: 5_000,
  capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 400_000, requestBoundProof: null },
  singleCallExecution: null, ...extra,
});
const provenance = { agent: "operator", model: "operator", contextWindow: "descriptor" } as const;
const slotOf = (extra: Record<string, unknown>) => {
  const { protocol: _protocol, ...parsed } = ccloopResolutionSchema.parse(answer(extra));
  return frozenSlotOf(parsed as AgentResolution, { agent: "codex" }, provenance);
};

describe("an installation-declared context window (#70)", () => {
  it("is frozen into the slot, and the stored slot parses", () => {
    const slot = slotOf({ contextWindowSource: "installation-declared" });
    expect(slot.contextWindowSource).toBe("installation-declared");
    expect(frozenSlotSchema.parse(slot)).toEqual(slot);
  });

  it("leaves a slot whose window is the catalog's byte-identical to one frozen before the marker existed", () => {
    const slot = slotOf({});
    expect("contextWindowSource" in slot).toBe(false);
    const before = { selection: slot.selection, configHash: slot.configHash, timeoutMs: slot.timeoutMs, killGraceMs: slot.killGraceMs, capabilities: slot.capabilities, partial: slot.partial, provenance: slot.provenance };
    expect(canonicalBytes(slot).equals(canonicalBytes(before))).toBe(true);
  });

  it("is refused in a stored slot when it names any other source", () => {
    expect(frozenSlotSchema.safeParse({ ...slotOf({}), contextWindowSource: "catalog" }).success).toBe(false);
  });
});
