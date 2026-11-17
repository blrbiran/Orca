import { z } from "zod";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { refTip } from "./integrationGit.js";
import { verifyHistoryChain } from "./historyIntegration.js";
import { listPendingDecisions } from "./pendingDecisions.js";
import { readGroup, saveGroup } from "./queries.js";
import { readCanonicalRecord, writeCanonicalRecord } from "./snapshot.js";
import { workBranchRef } from "./workspace.js";
import { groupRepoIdOf } from "./usageLedger.js";
import { recordActivity } from "./activity.js";
import type { ControlStore } from "./store.js";

const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const historyAcceptanceEvidenceSchema = z.object({
  schema: z.literal("orca-history-acceptance-v1"), groupId: z.string().min(1), contractHash: hash,
  chainHash: hash, groupTip: sha, targetTip: sha,
  merges: z.array(z.object({ taskId: z.string().min(1), runId: z.string().min(1), sourceRef: z.string().min(1),
    sourceSha: sha, commit: sha }).strict()).min(1), artifactPaths: z.array(z.string().min(1)), at: z.number().int().nonnegative().safe(),
}).strict();
export const historyAcceptanceRecordSchema = z.object({ hash, chainHash: hash, groupTip: sha, targetTip: sha,
  at: z.number().int().nonnegative().safe() }).strict();
export type HistoryAcceptanceRecord = z.infer<typeof historyAcceptanceRecordSchema>;

/** A DB-only completion gate; the driver refreshes its Git observation before each done pass. */
// Tester #327 review: `body` is the group's body when the caller already read it (the panel summary), so it is not read again.
export function historySatisfied(store: ControlStore, groupId: string, body?: unknown): boolean {
  try {
    let group = body as { integration?: unknown; historyAcceptance?: unknown } | undefined;
    if (group === undefined) {
      const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
      if (!row) return false;
      group = JSON.parse(String(row.body)) as { integration?: unknown; historyAcceptance?: unknown };
    }
    const integration = readGroupIntegration(group);
    if (integration?.scheme.delivery !== "local" || !integration.scheme.historyExpectation) return true;
    const chain = integration.historyPublished, parsed = historyAcceptanceRecordSchema.safeParse(group.historyAcceptance);
    const expectedTarget = integration.historyReconciledTargetTip ?? chain?.targetTip;
    if (!chain || !parsed.success || integration.state !== "idle" || integration.pending !== null || integration.conflict !== null
      || integration.lastIntegrated !== chain.groupTip || integration.integratedCommit !== chain.targetTip
      || parsed.data.chainHash !== sha256Canonical(chain) || parsed.data.groupTip !== chain.groupTip || parsed.data.targetTip !== expectedTarget
      || chain.contractHash !== integration.schemeHash || listPendingDecisions(store, groupId).some(decision => decision.state === "pending")) return false;
    if (chain.merges.length !== integration.scheme.historyExpectation.sourceRefs.length) return false;
    for (let i = 0; i < chain.merges.length; i++) {
      const merge = chain.merges[i]!, source = integration.scheme.historyExpectation.sourceRefs[i]!;
      if (merge.taskId !== source.taskId || merge.sourceRef !== source.ref || !integration.historyBindings?.some(binding =>
        binding.taskId === merge.taskId && binding.runId === merge.runId && binding.sourceSha === merge.sourceSha
        && binding.sourceRef === merge.sourceRef && binding.contractHash === integration.schemeHash)) return false;
    }
    const evidence = historyAcceptanceEvidenceSchema.parse(JSON.parse(readCanonicalRecord(store, parsed.data.hash)));
    return sha256Canonical(evidence) === parsed.data.hash && evidence.groupId === groupId
      && evidence.contractHash === integration.schemeHash && evidence.chainHash === parsed.data.chainHash
      && evidence.groupTip === chain.groupTip && evidence.targetTip === expectedTarget
      && canonicalBytes(evidence.merges).equals(canonicalBytes(chain.merges.map(({ taskId, runId, sourceRef, sourceSha, commit }) =>
        ({ taskId, runId, sourceRef, sourceSha, commit }))))
      && canonicalBytes(evidence.artifactPaths).equals(canonicalBytes(chain.artifactPaths));
  } catch { return false; }
}

export interface HistoryAcceptanceDeps {
  store: ControlStore;
  repoPathOf(repoId: string): string;
  now(): number;
  write<T>(action: () => T): T;
}

/** Fresh Git proof after integration, before the done pass; a moved target revokes yesterday's completion. */
export async function refreshHistoryAcceptance(deps: HistoryAcceptanceDeps): Promise<string[]> {
  const moved: string[] = [];
  for (const row of deps.store.db.prepare("SELECT id,body FROM groups ORDER BY id").all()) {
    const groupId = String(row.id);
    let group: Record<string, unknown>;
    try { group = JSON.parse(String(row.body)) as Record<string, unknown>; } catch { continue; }
    let integration: ReturnType<typeof readGroupIntegration>;
    try { integration = readGroupIntegration(group); } catch { continue; }
    if (integration?.scheme.delivery !== "local" || !integration.scheme.historyExpectation) continue;
    const expectation = integration.scheme.historyExpectation;
    const chain = integration.historyPublished;
    let reason: string | null = null;
    let repo: string | null = null;
    try {
      const repoId = groupRepoIdOf(group);
      if (repoId === null) reason = "history-repository-missing";
      else repo = deps.repoPathOf(repoId);
      if (reason === null && repo !== null) {
        const target = await refTip(repo, expectation.targetRef);
        const groupTip = await refTip(repo, workBranchRef(groupId));
        if (chain === undefined || integration.state !== "idle" || integration.pending !== null || integration.conflict !== null)
          reason = "history-integration-pending";
        else if (target !== (integration.historyReconciledTargetTip ?? chain.targetTip)) reason = "history-target-moved";
        else if (groupTip !== chain.groupTip) reason = "history-group-tip-moved";
        else if (chain.contractHash !== integration.schemeHash || chain.merges.length !== expectation.sourceRefs.length
          || chain.merges.some((merge, index) => merge.taskId !== expectation.sourceRefs[index]?.taskId
            || merge.sourceRef !== expectation.sourceRefs[index]?.ref
            || !integration.historyBindings?.some(binding => binding.taskId === merge.taskId && binding.runId === merge.runId
              && binding.sourceRef === merge.sourceRef && binding.sourceSha === merge.sourceSha && binding.contractHash === integration.schemeHash)))
          reason = "history-source-binding-invalid";
        else if (listPendingDecisions(deps.store, groupId).some(decision => decision.state === "pending")) reason = "history-decision-pending";
        else if (!(await verifyHistoryChain(repo, chain))) reason = "history-parent-invalid";
      }
    } catch { reason = "history-proof-unreadable"; }
    if (reason !== null) {
      if (group.historyAcceptance !== undefined || group.status === "done") {
        deps.write(() => {
          const current = readGroup(deps.store, groupId);
          const had = Object.hasOwn(current, "historyAcceptance"), wasDone = current.status === "done";
          if (!had && !wasDone) return;
          delete (current as unknown as Record<string, unknown>).historyAcceptance;
          if (wasDone) current.status = "review";
          saveGroup(deps.store, current);
          recordActivity(deps.store, { groupId, kind: "integration", body: { state: "blocked", reason: `history-acceptance-revoked:${reason}` } });
          moved.push(groupId);
        });
      }
      continue;
    }
    if (historySatisfied(deps.store, groupId)) continue;
    const proved = chain!;
    const acceptedTarget = integration.historyReconciledTargetTip ?? proved.targetTip;
    const evidence = historyAcceptanceEvidenceSchema.parse({ schema: "orca-history-acceptance-v1", groupId,
      contractHash: integration.schemeHash, chainHash: sha256Canonical(proved), groupTip: proved.groupTip,
      targetTip: acceptedTarget, merges: proved.merges.map(({ taskId, runId, sourceRef, sourceSha, commit }) =>
        ({ taskId, runId, sourceRef, sourceSha, commit })), artifactPaths: proved.artifactPaths, at: deps.now() });
    const hash = sha256Canonical(evidence), canonical = canonicalBytes(evidence).toString("utf8");
    deps.write(() => {
      const current = readGroup(deps.store, groupId), live = readGroupIntegration(current);
      if (live?.schemeHash !== integration.schemeHash || !live.historyPublished
        || sha256Canonical(live.historyPublished) !== evidence.chainHash || live.state !== "idle" || live.pending !== null) return;
      writeCanonicalRecord(deps.store, groupId, hash, canonical);
      Object.assign(current, { historyAcceptance: historyAcceptanceRecordSchema.parse({ hash, chainHash: evidence.chainHash,
        groupTip: evidence.groupTip, targetTip: evidence.targetTip, at: evidence.at }) });
      saveGroup(deps.store, current);
      moved.push(groupId);
    });
  }
  return moved;
}
