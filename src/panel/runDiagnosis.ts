import type { ControlStore } from "../control/store.js";
import { executionFormatFailureSchema, savedSourceSchema } from "../control/savedResultProtocol.js";
import { settlementArtifact } from "../control/usageSettlement.js";
import { z } from "zod";
import type { ArtifactRef } from "../control/types.js";

export interface RunDiagnosis {
  phase: "estimate" | "work" | "handoff" | "single-call";
  step: "planning" | "executing" | "verifying" | null;
  cause: "execution-format-invalid" | "execution-format-ambiguous-or-hidden" | "usage-unsettled" | "unknown";
  attempt: number;
}

type DiagnosticRun = {
  groupId: string; workItemId: string; taskId: string | null; runId: string; generation: number; graphVersion: number; targetVersion: number; executionId: string | null;
  phase: RunDiagnosis["phase"]; progress?: { status: string } | null; providerAttemptOrdinal: number; drive?: { envelopeHash?: string | null } | null; savedSource?: unknown; failureCode: string | null;
};
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const normalizationSchema = z.object({
  status: z.literal("unavailable"),
  reason: z.enum(["execution-format-invalid", "execution-format-ambiguous-or-hidden"]),
  diagnostic: z.object({
    method: z.enum(["whole", "candidate", "none"]), candidates: count, valid: count, hidden: z.boolean(), originalBytes: count,
  }).strict(),
}).strict().refine(value => value.reason === (value.diagnostic.hidden || value.diagnostic.valid > 0 ? "execution-format-ambiguous-or-hidden" : "execution-format-invalid"));

export function savedFormatFailureEvidence(store: ControlStore, run: DiagnosticRun): { cause: "execution-format-invalid" | "execution-format-ambiguous-or-hidden"; refs: Array<{ kind: string; ref: ArtifactRef }> } | null {
  const source = savedSourceSchema.safeParse(run.savedSource);
  if (!source.success || source.data.authorityKind !== "execution-format-failure-v1") return null;
  try {
    const capsule = executionFormatFailureSchema.parse(JSON.parse(settlementArtifact(store, source.data.source).toString("utf8")));
    const identity = capsule.identity;
    if (identity.groupId !== run.groupId || identity.workItemId !== run.workItemId || identity.taskId !== run.taskId
      || identity.runId !== run.runId || identity.generation !== run.generation || identity.graphVersion !== run.graphVersion
      || identity.targetVersion !== run.targetVersion || identity.executionId !== run.executionId
      || identity.envelopeHash !== run.drive?.envelopeHash || capsule.attempt !== source.data.attempt) return null;
    const normalization = normalizationSchema.parse(JSON.parse(settlementArtifact(store, capsule.artifacts.normalization).toString("utf8")));
    return { cause: normalization.reason, refs: [
      { kind: "saved-decode-capsule", ref: source.data.source },
      { kind: "saved-final", ref: capsule.artifacts.final },
      { kind: "saved-decode-error", ref: capsule.artifacts.decodeError },
      { kind: "saved-normalization", ref: capsule.artifacts.normalization },
    ] };
  } catch { return null; }
}

/** Only a hash-checked, identity-matched producer capsule can name a decode cause. Historic run strings stay unknown. */
export function readRunDiagnosis(store: ControlStore, run: DiagnosticRun): RunDiagnosis {
  const step = run.progress?.status === "planning" || run.progress?.status === "executing" || run.progress?.status === "verifying" ? run.progress.status : null;
  let cause: RunDiagnosis["cause"] = run.failureCode === "usage-unsettled" ? "usage-unsettled" : "unknown";
  cause = savedFormatFailureEvidence(store, run)?.cause ?? cause;
  return { phase: run.phase, step, cause, attempt: run.providerAttemptOrdinal };
}
