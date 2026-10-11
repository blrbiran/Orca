import { describe, expect, it } from "vitest";
import { openTestStore } from "../control/fixtures/store.js";
import { persistRecoveryArtifact } from "../../src/control/savedResultRecoveryPackage.js";
import { readRunDiagnosis, savedFormatFailureEvidence } from "../../src/panel/runDiagnosis.js";

const hash = "a".repeat(64);
const ref = { artifactId: "fixture-ref", hash };

describe("run diagnosis from retained typed facts", () => {
  it("uses the normalizer's reason only through a matching hash-bound capsule", async () => {
    const h = await openTestStore();
    try {
      const normalization = persistRecoveryArtifact(h.store, { status: "unavailable", reason: "execution-format-invalid", diagnostic: { method: "none", candidates: 0, valid: 0, hidden: false, originalBytes: 24 } });
      const capsuleBody = {
        schema: "ccloop-execution-format-failure-v1", identity: { groupId: "g", workItemId: "w", taskId: "t", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, executionId: "exec-1", envelopeHash: hash }, attempt: 2,
        executor: { kind: "codex", configHash: hash }, frozenContractHash: hash, acceptedBase: "main", resolvedBase: "a".repeat(40), attemptStartHead: "a".repeat(40), decoder: "strict-execution-v1", classification: "execution-format-failure-v1",
        process: { reason: "completed", code: 0, signal: null, isolated: true }, usage: { tokenUsage: 10, highWater: 2 }, verifier: { entered: false, proof: ref },
        artifacts: { envelope: ref, config: ref, acceptedContract: ref, runtimeContract: ref, final: ref, events: ref, schema: ref, decodeError: ref, normalization, outcome: ref, process: ref, plan: ref, usage: ref, usageLedger: ref, usageObservations: [], owner: ref },
        snapshot: ref, completeness: { complete: true, parts: ["original-process", "original-stream", "actual-usage", "successful-plan", "verifier-not-entered", "tree-index-bundle-files"] }, capturedAt: "2026-10-11T00:00:00.000Z", captureOwner: "test",
      };
      const capsule = persistRecoveryArtifact(h.store, capsuleBody);
      const run = { groupId: "g", workItemId: "w", taskId: "t", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, executionId: "exec-1", drive: { envelopeHash: hash }, providerAttemptOrdinal: 2, phase: "work" as const, progress: { status: "executing" as const }, failureCode: null, savedSource: { authorityKind: "execution-format-failure-v1" as const, source: capsule, attempt: 2 } };
      expect(readRunDiagnosis(h.store, run)).toEqual({ phase: "work", step: "executing", cause: "execution-format-invalid", attempt: 2 });
      expect(savedFormatFailureEvidence(h.store, run)?.refs.map(item => item.kind)).toEqual(["saved-decode-capsule", "saved-final", "saved-decode-error", "saved-normalization"]);
      expect(readRunDiagnosis(h.store, { ...run, runId: "other" })).toEqual({ phase: "work", step: "executing", cause: "unknown", attempt: 2 });
      expect(savedFormatFailureEvidence(h.store, { ...run, runId: "other" })).toBeNull();
      expect(readRunDiagnosis(h.store, { ...run, generation: 2 }).cause).toBe("unknown");
      expect(readRunDiagnosis(h.store, { ...run, savedSource: { ...run.savedSource, attempt: 3 } }).cause).toBe("unknown");
      const firstDispatch = { ...run, providerAttemptOrdinal: 1 };
      expect(readRunDiagnosis(h.store, firstDispatch)).toEqual({ phase: "work", step: "executing", cause: "execution-format-invalid", attempt: 1 });
      expect(savedFormatFailureEvidence(h.store, firstDispatch)?.refs.map(item => item.kind)).toEqual(["saved-decode-capsule", "saved-final", "saved-decode-error", "saved-normalization"]);
      const ambiguousNormalization = persistRecoveryArtifact(h.store, { status: "unavailable", reason: "execution-format-ambiguous-or-hidden", diagnostic: { method: "none", candidates: 1, valid: 2, hidden: false, originalBytes: 242 } });
      const ambiguousCapsule = persistRecoveryArtifact(h.store, { ...capsuleBody, artifacts: { ...capsuleBody.artifacts, normalization: ambiguousNormalization } });
      const ambiguous = { ...firstDispatch, savedSource: { ...firstDispatch.savedSource, source: ambiguousCapsule } };
      expect(readRunDiagnosis(h.store, ambiguous).cause).toBe("execution-format-ambiguous-or-hidden");
      expect(savedFormatFailureEvidence(h.store, ambiguous)?.refs.map(item => item.kind)).toContain("saved-final");
      const wrongEnvelope = persistRecoveryArtifact(h.store, { ...capsuleBody, identity: { ...capsuleBody.identity, envelopeHash: "b".repeat(64) } });
      const foreign = { ...run, savedSource: { ...run.savedSource, source: wrongEnvelope } };
      expect(readRunDiagnosis(h.store, foreign).cause).toBe("unknown");
      expect(savedFormatFailureEvidence(h.store, foreign)).toBeNull(); // no saved final/decode refs in the manifest
      for (const invalidNormalization of [
        { status: "unavailable", reason: "execution-format-invalid" },
        { status: "unavailable", reason: "execution-format-invalid", diagnostic: { method: "none", candidates: 1, valid: 1, hidden: false, originalBytes: 24 } },
      ]) {
        const normalizationRef = persistRecoveryArtifact(h.store, invalidNormalization);
        const source = persistRecoveryArtifact(h.store, { ...capsuleBody, artifacts: { ...capsuleBody.artifacts, normalization: normalizationRef } });
        const invalid = { ...run, savedSource: { ...run.savedSource, source } };
        expect(readRunDiagnosis(h.store, invalid).cause).toBe("unknown");
        expect(savedFormatFailureEvidence(h.store, invalid)).toBeNull();
      }
      expect(readRunDiagnosis(h.store, { ...run, savedSource: undefined, failureCode: "usage-unsettled" })).toEqual({ phase: "work", step: "executing", cause: "usage-unsettled", attempt: 2 });
      expect(readRunDiagnosis(h.store, { ...run, savedSource: undefined, failureCode: null })).toEqual({ phase: "work", step: "executing", cause: "unknown", attempt: 2 });
    } finally { await h.dispose(); }
  });
});
