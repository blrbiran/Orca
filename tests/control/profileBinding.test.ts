import { describe, expect, it } from "vitest";
import {
  createExecutionProfileRouter,
  legacyProfileHash,
  profileBindingHash,
  resolveProfile,
  sameProfileHash,
} from "../../src/control/profiles.js";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import type { ExecutionProfileSnapshotV1 } from "../../src/control/webProtocol.js";

// #381 (session 3ba26002, human rulings 1, 4, 5, 6, 7): which parts of a profile file a group, run or estimate request is
// bound to. The estimator preflight block, the estimator tokenizer artifact and the secret value hashes are read at each
// launch and frozen in that call's own contract, so changing them must not refuse the work already bound to the file;
// everything else still must.

const hash = (value: string) => value.repeat(64);

function snapshot(edit: (value: ExecutionProfileSnapshotV1) => void = () => undefined): ExecutionProfileSnapshotV1 {
  const value: ExecutionProfileSnapshotV1 = {
    schema: "orca-execution-profile-snapshot-v2",
    profile: {
      profileId: "all",
      allowedWorkKinds: ["budget-estimate", "goal-review", "handoff", "task"],
      contextTokenizer: { tokenizerId: "tok", tokenizerVersion: "1" },
      workMaxOutputTokens: 1000,
      capabilities: {
        usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "phase-end", handoffControl: "durable",
        handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null,
      },
      estimatorPreflight: {
        instructionVersion: "1", schemaVersion: "budget-estimate-v1", maxOutputTokens: 64_000, framingTokenOverhead: 17,
        tokenizer: { kind: "exact", tokenizerId: "est", tokenizerVersion: "1" },
      },
    },
    resolved: {
      proofDocumentContentHashes: [hash("c")],
      tokenizerArtifactHashes: [{ purpose: "context", contentHash: hash("d") }, { purpose: "estimator", contentHash: hash("e") }],
      secretValueHashes: [{ name: "/adapter/token", valueHash: hash("f") }],
    },
  };
  edit(value);
  return value;
}

describe("profile binding hash (#381)", () => {
  it("is a fixed digest of the bound fields only, and the legacy hash stays the whole snapshot's", () => {
    // Literals: computed once from this fixture; a change of algorithm (a field added or dropped) changes them.
    expect(profileBindingHash(snapshot())).toBe("3eb0d9e83c13025a3a26d4375cce3cdf34aeb236b3f413ed11b111123e392b01");
    expect(legacyProfileHash(snapshot())).toBe("c2aae65adb0f381d2dab02c69cf1db0c5e11a9563366dc86bec272b3ecb5dc31");
    expect(resolveProfile(snapshot()).profileHash).toBe("3eb0d9e83c13025a3a26d4375cce3cdf34aeb236b3f413ed11b111123e392b01");
  });

  it.each([
    ["instructionVersion", (s: ExecutionProfileSnapshotV1) => { s.profile.estimatorPreflight!.instructionVersion = "4"; }],
    ["maxOutputTokens", (s: ExecutionProfileSnapshotV1) => { s.profile.estimatorPreflight!.maxOutputTokens = 8_000; }],
    ["framingTokenOverhead", (s: ExecutionProfileSnapshotV1) => { s.profile.estimatorPreflight!.framingTokenOverhead = 12_000; }],
    ["the estimator tokenizer and its artifact", (s: ExecutionProfileSnapshotV1) => {
      s.profile.estimatorPreflight!.tokenizer = { kind: "utf8-upper-bound", numerator: 2, denominator: 3, proofRef: "proof" };
      s.resolved.tokenizerArtifactHashes = [{ purpose: "context", contentHash: hash("d") }];
    }],
    ["the estimator artifact's content", (s: ExecutionProfileSnapshotV1) => { s.resolved.tokenizerArtifactHashes[1] = { purpose: "estimator", contentHash: hash("9") }; }],
    ["a secret value", (s: ExecutionProfileSnapshotV1) => { s.resolved.secretValueHashes = [{ name: "/adapter/token", valueHash: hash("8") }]; }],
    ["the whole preflight block", (s: ExecutionProfileSnapshotV1) => {
      s.profile.estimatorPreflight = null;
      s.resolved.tokenizerArtifactHashes = [{ purpose: "context", contentHash: hash("d") }];
    }],
  ])("does not change when %s changes", (_name, edit) => {
    expect(profileBindingHash(snapshot(edit))).toBe(profileBindingHash(snapshot()));
    expect(legacyProfileHash(snapshot(edit))).not.toBe(legacyProfileHash(snapshot()));
  });

  it.each([
    ["profileId", (s: ExecutionProfileSnapshotV1) => { s.profile.profileId = "other"; }],
    ["allowedWorkKinds", (s: ExecutionProfileSnapshotV1) => { s.profile.allowedWorkKinds = ["budget-estimate", "goal-review", "handoff"]; s.profile.workMaxOutputTokens = null; }],
    ["capabilities", (s: ExecutionProfileSnapshotV1) => { s.profile.capabilities.budgetEnforcement = "unavailable"; }],
    ["contextTokenizer", (s: ExecutionProfileSnapshotV1) => { s.profile.contextTokenizer = { tokenizerId: "tok", tokenizerVersion: "2" }; }],
    ["the context tokenizer artifact", (s: ExecutionProfileSnapshotV1) => { s.resolved.tokenizerArtifactHashes[0] = { purpose: "context", contentHash: hash("7") }; }],
    ["proofDocumentContentHashes", (s: ExecutionProfileSnapshotV1) => { s.resolved.proofDocumentContentHashes = [hash("6")]; }],
    ["workMaxOutputTokens", (s: ExecutionProfileSnapshotV1) => { s.profile.workMaxOutputTokens = 2000; }],
  ])("changes when %s changes", (_name, edit) => {
    expect(profileBindingHash(snapshot(edit))).not.toBe(profileBindingHash(snapshot()));
  });
});

describe("one profile-hash comparison (#381 ruling 7)", () => {
  it("matches equal hashes, and a legacy hash only through an alias to the same binding", () => {
    const aliases = new Map([[hash("1"), hash("b")], [hash("2"), hash("b")], [hash("3"), hash("c")]]);
    expect(sameProfileHash(hash("b"), hash("b"))).toBe(true);
    expect(sameProfileHash(hash("1"), hash("b"))).toBe(false);
    expect(sameProfileHash(hash("1"), hash("b"), aliases)).toBe(true);
    expect(sameProfileHash(hash("b"), hash("1"), aliases)).toBe(true);
    expect(sameProfileHash(hash("1"), hash("2"), aliases)).toBe(true);
    expect(sameProfileHash(hash("1"), hash("3"), aliases)).toBe(false);
    expect(sameProfileHash(hash("1"), hash("c"), aliases)).toBe(false);
  });

  it("resolves a legacy-bound record through the router's alias, and refuses one aliased to another binding", () => {
    const current = resolveProfile(snapshot((s) => { s.profile.estimatorPreflight!.instructionVersion = "4"; }));
    const legacy = legacyProfileHash(snapshot());
    expect(legacy).not.toBe(current.profileHash);
    const bare = createExecutionProfileRouter([current]);
    expect(() => bare.resolve("task", "all", legacy)).toThrow("profile-changed");
    const router = createExecutionProfileRouter([current], { aliases: new Map([[legacy, current.profileHash]]) });
    expect(router.resolve("task", "all", legacy).profileHash).toBe(current.profileHash);
    expect(router.resolve("task", "all", current.profileHash).profileHash).toBe(current.profileHash);
    const elsewhere = createExecutionProfileRouter([current], { aliases: new Map([[legacy, hash("0")]]) });
    expect(() => elsewhere.resolve("task", "all", legacy)).toThrow("profile-changed");
  });

  it("refuses a router entry whose hash is the legacy one", () => {
    const frozen = resolveProfile(snapshot());
    expect(() => createExecutionProfileRouter([{ ...frozen, profileHash: sha256Canonical(frozen.snapshot) }])).toThrow("control-profile-invalid");
  });
});
