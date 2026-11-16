import { sha256Canonical } from "./canonicalJson.js";
import { ControlError } from "./errors.js";
import { historyBindingSchema, historySourceObservationSchema, type HistorySourceObservation } from "./historyExpectation.js";
import { readGroupIntegration } from "./integrationScheme.js";
import { recordProjectionChange } from "./projectionJournal.js";
import type { ControlStore } from "./store.js";
import { git } from "../scheduler/gitExec.js";

const groupBody = (store: ControlStore, groupId: string): Record<string, unknown> => {
  const row = store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
  if (!row) throw new ControlError("recovery-blocked", "history-group-missing");
  return JSON.parse(String(row.body)) as Record<string, unknown>;
};

/** A private ref keeps a bound object available even if the person's branch later moves or disappears. */
export const historySourcePinRef = (groupId: string, taskId: string, runId: string): string =>
  `refs/orca/history/${sha256Canonical({ groupId, taskId, runId })}`;

export async function observeHistorySource(store: ControlStore, repo: string, groupId: string, taskId: string, runId: string,
  staged: HistorySourceObservation | undefined): Promise<{ observation: HistorySourceObservation | null; missing: string | null }> {
  const integration = readGroupIntegration(groupBody(store, groupId));
  if (integration?.scheme.delivery !== "local" || !integration.frozen || !integration.scheme.historyExpectation)
    return { observation: null, missing: null };
  const entry = integration.scheme.historyExpectation.sourceRefs.find(item => item.taskId === taskId);
  if (!entry) return { observation: null, missing: null };
  const pin = historySourcePinRef(groupId, taskId, runId);
  if (staged) {
    if (staged.taskId !== taskId || staged.sourceRef !== entry.ref || staged.contractHash !== integration.schemeHash)
      throw new ControlError("recovery-blocked", "history-source-staged-invalid");
    const pinned = await git(repo, ["rev-parse", "--verify", "--quiet", pin]).then(value => value.trim(), () => null);
    if (pinned !== staged.sourceSha) throw new ControlError("recovery-blocked", "history-source-pin-invalid");
    return { observation: staged, missing: null };
  }
  const sha = await git(repo, ["rev-parse", "--verify", "--quiet", `${entry.ref}^{commit}`]).then(value => value.trim(), () => null);
  if (sha === null) return { observation: null, missing: entry.ref };
  const observation = historySourceObservationSchema.parse({ taskId, sourceRef: entry.ref, sourceSha: sha, contractHash: integration.schemeHash });
  const existing = await git(repo, ["rev-parse", "--verify", "--quiet", pin]).then(value => value.trim(), () => null);
  if (existing === null) {
    await git(repo, ["update-ref", pin, sha, "0".repeat(sha.length)]).catch(async error => {
      const after = await git(repo, ["rev-parse", "--verify", "--quiet", pin]).then(value => value.trim(), () => null);
      if (after !== sha) throw error;
    });
  } else if (existing !== sha) throw new ControlError("recovery-blocked", "history-source-pin-conflict");
  return { observation, missing: null };
}

/** Called inside the same store transaction that marks the run landed and its task ready to settle. */
export function recordHistoryBinding(store: ControlStore, groupId: string, taskId: string | null, runId: string,
  landedCommit: string | null, staged: HistorySourceObservation | undefined, noChange = false): void {
  const group = groupBody(store, groupId), integration = readGroupIntegration(group);
  if (integration?.scheme.delivery !== "local" || !integration.frozen || !integration.scheme.historyExpectation) return;
  const source = integration.scheme.historyExpectation.sourceRefs.find(entry => entry.taskId === taskId);
  if (!source) return;
  if (landedCommit === null || !staged || staged.taskId !== taskId || staged.sourceRef !== source.ref || staged.contractHash !== integration.schemeHash)
    throw new ControlError("recovery-blocked", "history-source-landing-invalid");
  const binding = historyBindingSchema.parse({ ...staged, runId, landedCommit, ...(noChange ? { noChange: true } : {}) });
  const prior = integration.historyBindings?.find(entry => entry.taskId === taskId);
  if (prior) {
    if (JSON.stringify(prior) !== JSON.stringify(binding)) throw new ControlError("recovery-blocked", "history-source-already-bound");
    return;
  }
  group.integration = { ...integration, historyBindings: [...(integration.historyBindings ?? []), binding] };
  store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(group), groupId);
  recordProjectionChange(store, [groupId]);
}
