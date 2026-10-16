import { describe, expect, it } from "vitest";
import { ccloopResolutionSchema } from "../../src/control/ccloopPort.js";
import { estimatorCompatibility } from "../../src/control/estimatorCompatibility.js";
import { resolveProfile } from "../../src/control/profiles.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";
import { profileSnapshot } from "./fixtures/web.js";

// Spec 2026-10-15 §6.2 (R2): strict requires "v1"; soft accepts "v1" or "v1-soft". The fixture profile is strict-capable
// (bounded, with a request-bound proof), so single-call-unavailable is the only reason either way.
const profile = resolveProfile(profileSnapshot());
const at = (execution: "v1" | "v1-soft" | null, mode: "strict" | "soft") => estimatorCompatibility({ profile, observed: profile.snapshot.profile.capabilities, probeFailureCode: null,
  resolution: { ...fixtureResolutionFor(profile.snapshot.profile.capabilities), singleCallExecution: execution } }, mode).reasonCodes;

describe("strict and soft single-call execution (spec §6.2)", () => {
  it.each([
    ["v1", "strict", []], ["v1-soft", "strict", ["single-call-unavailable"]], [null, "strict", ["single-call-unavailable"]],
    ["v1", "soft", []], ["v1-soft", "soft", []], [null, "soft", ["single-call-unavailable"]],
  ] as const)("%s in %s mode", (execution, mode, reasons) => {
    expect(at(execution, mode)).toEqual(reasons);
  });

  it("parses v1-soft from ccloop and refuses any other new value", () => {
    const answer = { protocol: 3, selection: { agent: "codex", model: "gpt-6-sol", contextWindow: "agent-default" }, configHash: "a".repeat(64), timeoutMs: 1000, killGraceMs: 0,
      capabilities: profile.snapshot.profile.capabilities, singleCallExecution: "v1-soft", singleCallOutputCap: null };
    expect([ccloopResolutionSchema.safeParse(answer).success, ccloopResolutionSchema.safeParse({ ...answer, singleCallExecution: "v2" }).success]).toEqual([true, false]);
  });
});
