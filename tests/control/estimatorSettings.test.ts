import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { buildBudgetEstimateRequest } from "../../src/control/estimator.js";
import { estimatorCompatibility } from "../../src/control/estimatorCompatibility.js";
import { resolveProfile } from "../../src/control/profiles.js";
import { executionProfileSnapshotSchema, type ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { profileSnapshot } from "./fixtures/web.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";

// #381 (session 3ba26002, human rulings 2 and 3): Orca decides the estimate instruction -- always the newest it holds,
// whatever the profile names -- and every request and contract records the one it used. maxOutputTokens,
// framingTokenOverhead and tokenizer come from the profile when it has them, else Orca's default (64000, 17, the utf8
// upper bound 2/3 with proofRef "proof": the README's sample profile and every acceptance script use exactly these).
const contract = { objective: { taskId: "a", goal: "ship" } };
const plan = {
  schema: "orca-control-plan-v1", repoId: "repo", planId: "plan", goal: "ship", successConditions: ["passes"],
  tasks: [{ taskId: "a", dependencyTaskIds: [], targetVersion: 1, originalContractHash: sha256Canonical(contract), originalContractCanonicalJson: canonicalBytes(contract).toString("utf8") }],
};
const planCanonicalJson = canonicalBytes(plan).toString("utf8");
const planHash = sha256Canonical(plan);
const build = (snapshot: ExecutionProfileSnapshotV1) => {
  const profile = resolveProfile(snapshot);
  const observation = { profile, observed: snapshot.profile.capabilities, probeFailureCode: null, resolution: fixtureResolutionFor(snapshot.profile.capabilities, "v1") };
  return buildBudgetEstimateRequest({ planHash, planCanonicalJson, profile, observation, mode: "soft" });
};

describe("estimator settings read at launch (#381)", () => {
  it("uses the newest instruction whatever the profile names, and records it in the request and the contract", () => {
    for (const named of ["1", "3", "99"]) {
      const snapshot = profileSnapshot();
      snapshot.profile.estimatorPreflight!.instructionVersion = named;
      const result = build(snapshot);
      expect([named, result.state, result.request?.instructionVersion, result.contract?.instructionVersion]).toEqual([named, "queued", "4", "4"]);
    }
  });

  it("an unknown instruction named by the profile is no longer a compatibility reason", () => {
    const snapshot = profileSnapshot();
    snapshot.profile.estimatorPreflight!.instructionVersion = "99";
    const profile = resolveProfile(snapshot);
    const observation = { profile, observed: snapshot.profile.capabilities, probeFailureCode: null, resolution: fixtureResolutionFor(snapshot.profile.capabilities, "v1") };
    expect(estimatorCompatibility(observation, "soft").reasonCodes).not.toContain("instruction-unknown");
  });

  it("a preflight block with no fields parses and launches with Orca's defaults", () => {
    const snapshot = profileSnapshot() as unknown as { profile: Record<string, unknown> };
    snapshot.profile.estimatorPreflight = {};
    const parsed = executionProfileSnapshotSchema.safeParse(snapshot);
    expect(parsed.success).toBe(true);
    const result = build(parsed.data!);
    expect(result.contract).toMatchObject({
      instructionVersion: "4", responseSchemaVersion: "budget-estimate-v1", maxOutputTokens: 64000, framingTokenOverhead: 17,
      tokenizer: { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" },
    });
  });

  it("the profile's own maxOutputTokens, framingTokenOverhead and tokenizer win when present", () => {
    const snapshot = profileSnapshot();
    snapshot.profile.estimatorPreflight = { ...snapshot.profile.estimatorPreflight!, maxOutputTokens: 8000, framingTokenOverhead: 12000,
      tokenizer: { kind: "utf8-upper-bound", numerator: 1, denominator: 1, proofRef: "measured" } };
    expect(build(snapshot).contract).toMatchObject({ maxOutputTokens: 8000, framingTokenOverhead: 12000,
      tokenizer: { kind: "utf8-upper-bound", numerator: 1, denominator: 1, proofRef: "measured" } });
  });

  it("an exact tokenizer still needs its estimator artifact; a preflight without a tokenizer needs none", () => {
    const exact = profileSnapshot();
    exact.profile.estimatorPreflight!.tokenizer = { kind: "exact", tokenizerId: "tok", tokenizerVersion: "1" };
    expect(executionProfileSnapshotSchema.safeParse(exact).success).toBe(false);
    const bare = profileSnapshot() as unknown as { profile: { estimatorPreflight: Record<string, unknown> } };
    delete bare.profile.estimatorPreflight.tokenizer;
    expect(executionProfileSnapshotSchema.safeParse(bare).success).toBe(true);
  });
});
