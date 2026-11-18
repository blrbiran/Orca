import type { ControlStore } from "../control/store.js";
import { executionFormatFailureSchema, savedSourceSchema } from "../control/savedResultProtocol.js";
import { settlementArtifact } from "../control/usageSettlement.js";
import { z } from "zod";
import type { ArtifactRef } from "../control/types.js";
import { join } from "node:path";
import { readFormatFailureWork, type FormatFailureWork } from "./formatFailureWork.js";
import { refusedFormatField } from "../control/formatRefusal.js";
import { readConfirmedTaskExecution } from "../control/executionSnapshot.js";
import { ControlError } from "../control/errors.js";
import { denylistMatches } from "../control/harvestBound.js";
import type { SiblingClaims } from "../control/parallelClaims.js";
import type { taskContractSchema } from "../scheduler/planFile.js";

type TaskContract = z.infer<typeof taskContractSchema>;

export interface RunDiagnosis {
  phase: "estimate" | "work" | "handoff" | "single-call";
  step: "planning" | "executing" | "verifying" | null;
  cause: "execution-format-invalid" | "execution-format-ambiguous-or-hidden" | "usage-unsettled" | "path-policy" | "parallel-claim" | "unknown";
  /** Off-plan writes W4 (#346): with `parallel-claim`, the parallel siblings whose frozen claim the run wrote; omitted otherwise. */
  siblings?: string[];
  attempt: number;
  /**
   * Issue #131 (session 3cfc2e73): ccloop's own run-level cause, when its drive record kept one (failure-cause spec
   * 2026-10-21 §5) -- a setup failure is `{cause: "setup-failed", phase: "setup", detail: "<cmd> exit=1"}`. Omitted when
   * none was stated. `cause` above stays Orca's decode axis; this says what ccloop reported.
   */
  failureCause?: { cause: string; phase: "plan" | "execute" | "verify" | "setup" | null; detail: string | null };
  /** Session 3cfc2e73 D7 (#158): where an omp execute format failure's work is kept (formatFailureWork.ts); omitted when none. */
  formatFailureWork?: FormatFailureWork;
  /**
   * Tester #274: the field ccloop's strict execute shape refused (`commandOutputs: expected array, received string`), from
   * the failure cause's detail (formatRefusal.ts); omitted when the detail names none. `cause` above is unchanged by it.
   */
  formatField?: string;
}

type DiagnosticRun = {
  groupId: string; workItemId: string; taskId: string | null; runId: string; generation: number; graphVersion: number; targetVersion: number; executionId: string | null;
  phase: RunDiagnosis["phase"]; progress?: { status: string } | null; providerAttemptOrdinal: number; drive?: { sourceDir?: string; targetRepo?: string | null; envelopeHash?: string | null; failureCause?: { cause: string; phase: "plan" | "execute" | "verify" | "setup" | null; detail: string | null } | null; pathPolicyMisses?: unknown[];
    stopReason?: string; blockedReason?: string | null; dirs?: ReadonlyArray<{ key: string }> } | null; savedSource?: unknown; failureCode: string | null;
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

const DENYLIST_STOP = "denylist match: ";
const OUT_OF_BOUNDS_STOP = "out-of-bounds:";

/**
 * Off-plan writes W4 (#346, plan Task 5): the path a v4 run was stopped on for writing a parallel sibling's frozen claim,
 * and the siblings whose claim it is -- matched with ccloop's denylist rule (exact, `<dir>/**` by prefix, `**`), in the
 * repository the stop names. `null` when the stop is of neither shape below, or names only paths no sibling claims (a
 * protected path: that stop keeps its own diagnosis).
 *
 * The two stops are read so:
 * - ccloop's gate, `denylist match: <path>`, or `denylist match: <key>:<path>` for an extra repository (ccloop's runLoop
 *   prefixes the extra's key). The key is relative to the receiving task (as `siblings`' claims are), so it is read as a
 *   key only when it is one of `contract`'s `additionalRepos[].key`; otherwise the whole is a primary path that holds `:`.
 * - Orca's harvest bound at collect (executionDriver), `out-of-bounds:<paths>` for one directory and, in a multi-directory
 *   run, `out-of-bounds:<key>:<paths>;<key>:<paths>...` keyed by the run's `drive.dirs[].key`. `primaryDirKey` is that run's
 *   first directory's key (its primary, which the receiver keys `null`); it is given exactly for a multi-directory run.
 *   A segment keyed by neither it nor an extra key of `contract`'s is skipped. Paths are joined by `,` and segments by `;`
 *   as the producer joins them; a path that itself holds `,` (or, multi-directory, `;`) is misread as several, and a
 *   piece that matches no claim is simply not a parallel claim.
 * Where several paths qualify, the first in the stop's order answers.
 */
export function parallelClaimOf(stopReason: string | undefined, contract: TaskContract, siblings: readonly SiblingClaims[], primaryDirKey?: string):
  { path: string; repoKey: string | null; siblingIds: string[] } | null {
  const extraKeys = new Set((contract.context.additionalRepos ?? []).map(repo => repo.key));
  let candidates: Array<{ repoKey: string | null; path: string }>;
  if (stopReason?.startsWith(DENYLIST_STOP) === true) {
    const named = stopReason.slice(DENYLIST_STOP.length), colon = named.indexOf(":");
    const key = colon < 0 ? null : named.slice(0, colon);
    candidates = [key !== null && extraKeys.has(key) ? { repoKey: key, path: named.slice(colon + 1) } : { repoKey: null, path: named }];
  } else if (stopReason?.startsWith(OUT_OF_BOUNDS_STOP) === true) {
    const listed = stopReason.slice(OUT_OF_BOUNDS_STOP.length);
    candidates = primaryDirKey === undefined ? listed.split(",").map(path => ({ repoKey: null, path }))
      : listed.split(";").flatMap(segment => {
        const colon = segment.indexOf(":"), key = segment.slice(0, colon);
        const repoKey = colon < 0 ? undefined : key === primaryDirKey ? null : extraKeys.has(key) ? key : undefined;
        return repoKey === undefined ? [] : segment.slice(colon + 1).split(",").map(path => ({ repoKey, path }));
      });
  } else return null;
  for (const candidate of candidates) {
    const siblingIds = siblings.filter(sibling => sibling.claims.some(claim => claim.repoKey === candidate.repoKey && denylistMatches(claim.path, candidate.path)))
      .map(sibling => sibling.siblingId);
    if (siblingIds.length > 0) return { ...candidate, siblingIds };
  }
  return null;
}

/**
 * The run's parallel-claim stop, read against its task's confirmed execution (the derived contract and the frozen
 * siblings). Only a task run whose stop has one of the two claim-bearing shapes reads it; a group whose confirmed execution
 * cannot be read (not confirmed, or refused as recovery-blocked) has no such stop to name.
 */
function runParallelClaim(store: ControlStore, run: DiagnosticRun): string[] | null {
  const drive = run.drive;
  const reasons = [drive?.stopReason, drive?.blockedReason ?? undefined];
  if (run.taskId === null || !reasons.some(reason => reason?.startsWith(DENYLIST_STOP) === true || reason?.startsWith(OUT_OF_BOUNDS_STOP) === true)) return null;
  let confirmed: ReturnType<typeof readConfirmedTaskExecution>;
  try { confirmed = readConfirmedTaskExecution(store, run.groupId, run.taskId); } catch (error) {
    if (error instanceof ControlError) return null;
    throw error;
  }
  const primaryDirKey = drive?.dirs?.[0]?.key;
  for (const reason of reasons) {
    const claim = parallelClaimOf(reason, confirmed.contract, confirmed.siblings, primaryDirKey);
    if (claim !== null) return claim.siblingIds;
  }
  return null;
}

/** Only a hash-checked, identity-matched producer capsule can name a decode cause. Historic run strings stay unknown. */
export function readRunDiagnosis(store: ControlStore, run: DiagnosticRun): RunDiagnosis {
  const step = run.progress?.status === "planning" || run.progress?.status === "executing" || run.progress?.status === "verifying" ? run.progress.status : null;
  let cause: RunDiagnosis["cause"] = run.failureCode === "usage-unsettled" ? "usage-unsettled" : "unknown";
  cause = savedFormatFailureEvidence(store, run)?.cause ?? cause;
  // Off-plan writes W4 (#346): a stop on a parallel sibling's claim says so, before any allowlist misses ccloop observed
  // with it (a retry allowing those would stop on the same claim again).
  const siblings = cause === "unknown" ? runParallelClaim(store, run) : null;
  if (siblings !== null) cause = "parallel-claim";
  // Tester #265: a run ccloop stopped on paths outside its allowlist (the misses it reported are kept on the drive record).
  if (cause === "unknown" && (run.drive?.pathPolicyMisses?.length ?? 0) > 0) cause = "path-policy";
  const failure = run.drive?.failureCause ?? null;
  // ccloop's run directory is `<sourceDir>/run` (ccloop src/control/worker.ts); its attempt refs live in the target repository.
  const formatFailureWork = run.drive?.sourceDir === undefined ? null : readFormatFailureWork(join(run.drive.sourceDir, "run"), run.drive.targetRepo ?? null);
  const formatField = refusedFormatField(failure?.detail);
  return { phase: run.phase, step, cause, ...(siblings === null ? {} : { siblings }), attempt: run.providerAttemptOrdinal,
    ...(failure === null ? {} : { failureCause: { cause: failure.cause, phase: failure.phase, detail: failure.detail } }),
    ...(formatFailureWork === null ? {} : { formatFailureWork }), ...(formatField === null ? {} : { formatField }) };
}
