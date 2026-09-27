import { describe, expect, it, vi } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { buildBudgetEstimateRequest, estimateCapabilityDegraded } from "../../src/control/estimator.js";
import { BUDGET_ESTIMATE_JSON_SCHEMA, ESTIMATE_INSTRUCTIONS, buildEstimatePrompt } from "../../src/control/estimatePrompt.js";
import { resolveProfile } from "../../src/control/profiles.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";
import { profileSnapshot } from "./fixtures/web.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";

// Single-call estimate spec §4.2: the prompt is the instruction, a blank line and the request's canonical bytes, and
// the input tokens the preflight checks are that whole prompt's, in both tokenizer branches (review I2).
const contract = { objective: { taskId: "a", goal: "ship" } };
const plan = {
  schema: "orca-control-plan-v1", repoId: "repo", planId: "plan", goal: "ship", successConditions: ["passes"],
  tasks: [{ taskId: "a", dependencyTaskIds: [], targetVersion: 1, originalContractHash: sha256Canonical(contract), originalContractCanonicalJson: canonicalBytes(contract).toString("utf8") }],
};
const planCanonicalJson = canonicalBytes(plan).toString("utf8");
const planHash = sha256Canonical(plan);
const observe = (snapshot: ExecutionProfileSnapshotV1, singleCallExecution: "v1" | null | "no-resolution" = "v1") => {
  const profile = resolveProfile(snapshot);
  return { profile, observation: { profile, observed: snapshot.profile.capabilities, probeFailureCode: null,
    resolution: singleCallExecution === "no-resolution" ? null : fixtureResolutionFor(snapshot.profile.capabilities, singleCallExecution) } };
};
const exactSnapshot = (): ExecutionProfileSnapshotV1 => {
  const snapshot = profileSnapshot();
  snapshot.profile.estimatorPreflight = { ...snapshot.profile.estimatorPreflight!, tokenizer: { kind: "exact", tokenizerId: "tok", tokenizerVersion: "1" } };
  snapshot.resolved.tokenizerArtifactHashes = [{ purpose: "estimator", contentHash: "d".repeat(64) }];
  return snapshot;
};

describe("the estimate prompt (single-call estimate spec §4.2)", () => {
  it("is the v1 instruction, one blank line, then the request bytes exactly", () => {
    expect(buildEstimatePrompt("1", "{\"x\":1}")).toBe(`${ESTIMATE_INSTRUCTIONS["1"]}\n\n{"x":1}`);
    expect(ESTIMATE_INSTRUCTIONS["1"]!.endsWith("\n")).toBe(false);
    // The instruction names the output contract it will be checked against.
    for (const text of ["budget-estimate-v1", "planHash", "goalReviewReserve", "groupRationale", "assumptions", "\"S\"", "\"XL\"", "\"low\"", "\"high\"", "9007199254740991"]) {
      expect(ESTIMATE_INSTRUCTIONS["1"]).toContain(text);
    }
    expect(() => buildEstimatePrompt("2", "{}")).toThrow(expect.objectContaining({ code: "recovery-blocked", detail: "estimate-instruction-unknown:2" }));
  });

  it("counts the whole prompt under the utf8 upper bound", () => {
    const { profile, observation } = observe(profileSnapshot());
    const result = buildBudgetEstimateRequest({ planHash, planCanonicalJson, profile, observation, mode: "soft" });
    expect(result.state).toBe("queued");
    const requestBytes = canonicalBytes(result.request).length;
    const promptBytes = Buffer.byteLength(ESTIMATE_INSTRUCTIONS["1"]!) + 2 + requestBytes;
    expect(result.inputTokens).toBe(Math.ceil(promptBytes * 2 / 3) + 17);
    expect(result.requiredRequestTokens).toBe(Math.ceil(promptBytes * 2 / 3) + 17 + 64_000);
    // Not the request alone: the instruction is material (more than 500 tokens of it).
    expect(result.inputTokens! - (Math.ceil(requestBytes * 2 / 3) + 17)).toBeGreaterThan(500);
  });

  it("hands the exact tokenizer the whole prompt's bytes", () => {
    const snapshot = exactSnapshot();
    const { profile, observation } = observe(snapshot);
    const counted: Buffer[] = [];
    const exactTokenCount = vi.fn((_profile: unknown, bytes: Buffer) => { counted.push(bytes); return 4_321; });
    const result = buildBudgetEstimateRequest({ planHash, planCanonicalJson, profile, observation, mode: "soft", exactTokenCount });
    expect(counted).toHaveLength(1);
    expect(counted[0]!.toString("utf8")).toBe(`${ESTIMATE_INSTRUCTIONS["1"]}\n\n${canonicalBytes(result.request).toString("utf8")}`);
    expect(result.inputTokens).toBe(4_321 + 17);
  });

  it("is blocked-capability for an instruction version Orca does not know", () => {
    const snapshot = profileSnapshot();
    snapshot.profile.estimatorPreflight = { ...snapshot.profile.estimatorPreflight!, instructionVersion: "2" };
    const { profile, observation } = observe(snapshot);
    expect(buildBudgetEstimateRequest({ planHash, planCanonicalJson, profile, observation, mode: "soft" }))
      .toMatchObject({ state: "blocked-capability", reasonCode: "estimate-blocked-capability", request: null });
  });

  it("is blocked-capability unless ccloop answers singleCallExecution v1, and a claim degrades the same way", () => {
    const snapshot = profileSnapshot();
    const queued = buildBudgetEstimateRequest({ planHash, planCanonicalJson, ...observe(snapshot, "v1"), mode: "soft" });
    expect(queued.state).toBe("queued");
    for (const answer of [null, "no-resolution"] as const) {
      expect(buildBudgetEstimateRequest({ planHash, planCanonicalJson, ...observe(snapshot, answer), mode: "soft" }), String(answer))
        .toMatchObject({ state: "blocked-capability", reasonCode: "estimate-blocked-capability" });
      expect(estimateCapabilityDegraded(queued.request!, observe(snapshot, answer).observation, "soft"), String(answer)).toBe(true);
    }
    expect(estimateCapabilityDegraded(queued.request!, observe(snapshot, "v1").observation, "soft")).toBe(false);
  });
});
