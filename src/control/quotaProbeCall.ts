import { createHash, randomUUID } from "node:crypto";
import { frozenWorkAgent } from "./agentFreeze.js";
import { add, subtract, syncWebBudget } from "./budget.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { dimensions, zero } from "./commands.js";
import type { DriveRecord } from "./driveRecord.js";
import { ControlError } from "./errors.js";
import { readGroup, readWork, saveGroup } from "./queries.js";
import { singleCallClaimRowOf } from "./singleCall.js";
import { assertCallUsageBooked, closeSingleCall, insertSingleCallRun, verifyStoppedSingleCall, type StoppedSingleCallRun } from "./singleCallLedger.js";
import type { SingleCallHandler } from "./singleCallPurposes.js";
import { claimCapBlocking } from "./spendCaps.js";
import { writeCanonicalRecord } from "./snapshot.js";
import type { ControlStore } from "./store.js";
import type { Amount } from "./types.js";

/**
 * Quota rest probe spec 2026-11-06 §2 (human: 「可以先跑一个测试限额是否恢复的小探针run，再决定正式run是否跑」): one small
 * single call on an installation whose rest ended, in a group that can fund it, on a work item of its own. Its run row is
 * the record: the verdict is written on it by code from ccloop's single-call record. Kept free of the control import
 * cycle (no driver, dispatch, stop or service module): the driver, the stop path and the pass all reach it.
 */

/** §2 Grant (controller decision): about four times the one-line codex call's measured input; the call times out at 110 s. */
export const QUOTA_PROBE_GRANT: Readonly<Amount> = Object.freeze({ tokens: 50_000, activeMs: 120_000, attempts: 1, sessions: 1 });
export const QUOTA_PROBE_MAX_OUTPUT_TOKENS = 64;
export const QUOTA_PROBE_PROMPT = "Orca quota probe. Answer with the JSON object {\"ok\": true} and nothing else.";
export const QUOTA_PROBE_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false,
});
export const QUOTA_PROBE_USAGE_UNKNOWN = "quota-probe-usage-unknown";

/** §2 Run identity: the probe's own work item, keyed by the installation and the last quota run of its streak. */
export function quotaProbeWorkItemId(installation: string, restRunId: string): string {
  return `quota-probe-${createHash("sha256").update(installation, "utf8").digest("hex").slice(0, 16)}-${restRunId}`;
}

/**
 * §2 Outcome, by code from ccloop's record: `back` -- the provider answered (complete, or ran to its end with invalid
 * output); `quota` -- ccloop's typed cause is quota; `aborted` -- a stop reached it (not an outcome); `failed` --
 * anything else, including a record with no typed cause (a ccloop before the field: the probe cannot tell quota from any
 * other failure, so the task stays with the person).
 */
export interface ProbeVerdict { verdict: "back" | "quota" | "failed" | "aborted"; cause: string | null; detail: string | null; errorCode: string | null }

export function probeVerdictOf(facts: { outcome: "complete" | "aborted" | "failed"; failureCause: { cause: string; detail: string | null } | null }, failure: string | null): ProbeVerdict {
  const cause = facts.failureCause?.cause ?? null, detail = facts.failureCause?.detail ?? null;
  if (facts.outcome === "complete" || failure === "single-call-output-invalid") return { verdict: "back", cause: null, detail: null, errorCode: failure };
  if (facts.outcome === "aborted") return { verdict: "aborted", cause, detail, errorCode: failure };
  return { verdict: cause === "quota" ? "quota" : "failed", cause, detail, errorCode: failure };
}

/** What the probe's run keeps of its verdict: the verdict, when it ended, and a quota cause as installationRests reads it. */
function verdictFields(verdict: ProbeVerdict, at: number): { run: Record<string, unknown>; drive: Partial<DriveRecord> } {
  return {
    run: { probeVerdict: verdict, endedAt: at },
    drive: verdict.cause === null ? {} : { failureCause: { cause: verdict.cause, phase: null, retries: 0, detail: verdict.detail } },
  };
}

function isProbeVerdict(value: unknown): value is ProbeVerdict {
  return typeof value === "object" && value !== null && typeof (value as { verdict?: unknown }).verdict === "string";
}

/** The unused grant back to the probe's group (usage booking already took what the call spent out of `reserved`). */
export function interruptQuotaProbe(store: ControlStore, run: StoppedSingleCallRun): void {
  const group = readGroup(store, run.groupId);
  group.reserved = subtract(group.reserved, run.remaining.work);
  syncWebBudget(store, group, null);
  saveGroup(store, group);
}

export const QUOTA_PROBE_HANDLER: SingleCallHandler = {
  purpose: "quota-probe",
  async prepare() {
    return { prompt: QUOTA_PROBE_PROMPT, responseSchema: { ...QUOTA_PROBE_SCHEMA }, maxOutputTokens: QUOTA_PROBE_MAX_OUTPUT_TOKENS };
  },
  async evaluate(_deps, _run, _rawOutput, failure = null, facts) {
    return probeVerdictOf(facts ?? { outcome: failure === null ? "complete" : "failed", failureCause: null }, failure ?? null);
  },
  classify: () => null,
  complete(deps, runRow, settled, commitTerminal, failure = null) {
    const release = deps.admissionGate?.enter();
    try { deps.store.transaction(() => QUOTA_PROBE_HANDLER.completeInTransaction!(deps.store, runRow, settled, commitTerminal, failure)); }
    finally { release?.(); }
  },
  completeInTransaction(store, runRow, settled, commitTerminal, failure = null) {
    const receiptId = `single-call-result:${runRow.groupId}:${runRow.runId}`;
    if (store.db.prepare("SELECT id FROM outbox WHERE id=? AND kind='single-call-result'").get(receiptId)) return;
    commitTerminal();
    const row = store.db.prepare("SELECT id,active,body FROM runs WHERE id=?").get(runRow.runId);
    if (!row) throw new ControlError("run-not-found");
    const run = verifyStoppedSingleCall(store, row, { groupId: runRow.groupId, workItemId: runRow.workItemId, workGrant: QUOTA_PROBE_GRANT }, "quota-probe-ledger");
    assertCallUsageBooked(readGroup(store, run.groupId) as unknown as Parameters<typeof assertCallUsageBooked>[0], run, QUOTA_PROBE_USAGE_UNKNOWN);
    interruptQuotaProbe(store, run);
    const verdict = isProbeVerdict(settled) ? settled : probeVerdictOf({ outcome: failure === null ? "complete" : "failed", failureCause: null }, failure);
    const kept = verdictFields(verdict, store.now());
    const body = { ...run, ...kept.run, drive: { ...(run as { drive?: DriveRecord }).drive, ...kept.drive } };
    store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), run.runId);
    closeSingleCall(store, run.runId, { id: receiptId, kind: "single-call-result", body: { groupId: run.groupId, runId: run.runId } });
  },
  blockedRunFields(settled, at) {
    return isProbeVerdict(settled) ? verdictFields(settled, at) : { run: {}, drive: {} };
  },
  usageUnknownReason: QUOTA_PROBE_USAGE_UNKNOWN,
};

/** §2 Booking: why a group cannot fund the probe -- the first dimension the grant does not fit, or the spend cap; null when it can. */
export function probeUnfunded(store: ControlStore, groupId: string, at: number): string | null {
  const group = readGroup(store, groupId) as unknown as { used: Amount; reserved: Amount; limit: Record<string, number | null> };
  const reserved = add(group.reserved, QUOTA_PROBE_GRANT);
  const dimension = dimensions.find((d) => group.limit[d] != null && group.used[d] + reserved[d] > group.limit[d]!);
  if (dimension !== undefined) return dimension;
  return claimCapBlocking(store, groupId, QUOTA_PROBE_GRANT.tokens, at) === null ? null : "spend-cap";
}

/**
 * §2 Where / Booking: the probe's run on `taskId`'s frozen work agent, reserved on its group, in the caller's transaction.
 * The profile is the failed run's own execution profile (the plan's binding: the profile the person confirmed for the
 * task's work on this installation). Null when the group cannot fund it (`unfunded` says why) or the task's agent moved.
 */
export function claimQuotaProbeInTransaction(store: ControlStore, input: { groupId: string; taskId: string; installation: string; restRunId: string; failedRunId: string; at: number }): { runId: string } | { unfunded: string } | null {
  const { groupId, taskId, installation, restRunId } = input;
  const workItemId = quotaProbeWorkItemId(installation, restRunId);
  if (store.db.prepare("SELECT 1 FROM runs WHERE work_item_id=? AND active=1").get(workItemId) !== undefined) return null;
  const work = frozenWorkAgent(readWork(store, groupId, taskId));
  if (work.agent.agent !== installation) return null;
  const failed = JSON.parse(String(store.db.prepare("SELECT body FROM runs WHERE id=?").get(input.failedRunId)?.body ?? "{}")) as { executionProfile?: { profileId?: unknown; profileHash?: unknown } };
  if (typeof failed.executionProfile?.profileId !== "string" || typeof failed.executionProfile.profileHash !== "string") return null;
  const unfunded = probeUnfunded(store, groupId, input.at);
  if (unfunded !== null) return { unfunded };
  const profile = { profileId: failed.executionProfile.profileId, profileHash: failed.executionProfile.profileHash };
  const attempt = Number(store.db.prepare("SELECT count(*) AS n FROM runs WHERE work_item_id=?").get(workItemId)!.n) + 1;
  const contract = { schema: "orca-quota-probe-call-contract-v1", groupId, workItemId, installation, restRunId, forTaskId: taskId, attempt,
    prompt: QUOTA_PROBE_PROMPT, responseSchema: QUOTA_PROBE_SCHEMA, maxOutputTokens: QUOTA_PROBE_MAX_OUTPUT_TOKENS,
    grant: { work: { ...QUOTA_PROBE_GRANT }, handoff: zero() }, profile, configHash: work.configHash };
  const contractHash = sha256Canonical(contract);
  writeCanonicalRecord(store, groupId, contractHash, canonicalBytes(contract).toString("utf8"));
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1) ON CONFLICT(id) DO UPDATE SET body=excluded.body").run(`single-call-contract:${groupId}:${workItemId}`, "single-call-contract",
    canonicalBytes({ groupId, workItemId, contractHash }).toString("utf8"));
  const group = readGroup(store, groupId);
  const runId = `run-${randomUUID()}`;
  const slot = { selection: work.agent, configHash: work.configHash, timeoutMs: work.timeoutMs, killGraceMs: work.killGraceMs, capabilities: work.agentCapabilities, partial: {}, provenance: work.agentProvenance };
  const { envelopeHash } = insertSingleCallRun(store, {
    groupId, workItemId, runId, ownerToken: randomUUID(), purpose: "quota-probe", identity: { quotaProbe: { installation, restRunId, forTaskId: taskId } },
    graphVersion: group.graphVersion, targetVersion: attempt, commandId: workItemId, slot: slot as never, agentCapabilities: work.agentCapabilities,
    workGrant: { ...QUOTA_PROBE_GRANT }, profile, claimIdentity: `single-call:${groupId}:${workItemId}:${attempt}`, derivedContractHash: contractHash,
  });
  const claimRow = singleCallClaimRowOf("single-call", groupId, workItemId, runId);
  store.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1)").run(claimRow.id, claimRow.kind, canonicalBytes({ groupId, workItemId, runId, envelopeHash }).toString("utf8"));
  group.reserved = add(group.reserved, QUOTA_PROBE_GRANT);
  syncWebBudget(store, group, null);
  saveGroup(store, group);
  return { runId };
}

/** The probe run's identity, for the stop path and the view. */
export function isQuotaProbeRun(run: { phase?: unknown; purpose?: unknown }): boolean {
  return run.phase === "single-call" && run.purpose === "quota-probe";
}

/**
 * §2: what the runs on a probe work item say -- `pending` while one is active; `done` with the latest verdict that is an
 * outcome (back, quota, failed); a run blocked without a verdict (A2, record or prompt check) is `failed` by its block
 * reason; `none` when every run there was stopped (aborted is not an outcome: the key stays free) or there is none.
 */
export type ProbeState = { kind: "none" } | { kind: "pending" } | { kind: "done"; runId: string; groupId: string; verdict: ProbeVerdict; endedAt: number };

export function probeStateOf(store: ControlStore, workItemId: string): ProbeState {
  let state: ProbeState = { kind: "none" };
  for (const row of store.db.prepare("SELECT id, group_id, active, body FROM runs WHERE work_item_id=? ORDER BY rowid").all(workItemId)) {
    if (Number(row.active) === 1 && !String(row.body).includes("\"state\":\"blocked\"")) return { kind: "pending" };
    const body = JSON.parse(String(row.body)) as { state?: string; endedAt?: unknown; probeVerdict?: unknown; drive?: { blockedReason?: string | null } };
    const endedAt = typeof body.endedAt === "number" ? body.endedAt : 0;
    if (isProbeVerdict(body.probeVerdict) && body.probeVerdict.verdict !== "aborted") state = { kind: "done", runId: String(row.id), groupId: String(row.group_id), verdict: body.probeVerdict, endedAt };
    else if (body.state === "blocked") state = { kind: "done", runId: String(row.id), groupId: String(row.group_id), verdict: { verdict: "failed", cause: null, detail: null, errorCode: body.drive?.blockedReason ?? null }, endedAt };
  }
  return state;
}
