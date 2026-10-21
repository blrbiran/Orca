/**
 * Flow engine spec §7.2: the re-run candidate set, computed by code, conservative and pure. The kernel measures the
 * workspace (current definition hashes, the import and params identities, `when` results, compose conflicts) and
 * hands it in; nothing here reads git or the store.
 *
 * A step is a candidate if any reason holds, listed in this fixed order:
 *   definition-changed          its current definition hash differs from its active execution's
 *   upstream-changed:<key>      an earlier output (or `start` = the import, `params`) differs from what its active
 *                               execution ran on, or that earlier step is itself about to re-run. Without a complete
 *                               recorded read set every earlier change counts (unknown => include); an equal `equals`
 *                               projection, or the person's "unchanged", is no change (cutoff)
 *   feedback                    a feedback message targets it
 *   never-succeeded             it has no active `done` execution (a failed or rate-limited one is never reused)
 *   compose-conflict            its active output no longer merges into the composition
 * A step targeted by an `edit` is not a candidate (its new output is the edit); a step whose `when` is false is
 * skipped, never a candidate.
 */
export type ExecutionState = "queued" | "running" | "done" | "failed" | "skipped" | "needs-person" | "parked" | "staged";
export interface RecordedOutput { stepKey: string; outputHash: string | null; projection: string | null }
export interface Execution {
  stepKey: string;
  seq: number;
  state: ExecutionState;
  /** Why it did not succeed, when it did not (`rate-limited`, ...). */
  failure?: string | null;
  definitionHash: string;
  fingerprint: string;
  /** What `ranOn` was computed from: the import, the params, and every earlier step's active output then. */
  ranOnInputs: { start: string; params: string; earlier: RecordedOutput[] };
  outputHash: string | null;
  /** The `hints.equals` projection of its output, when the step has one. */
  projection: string | null;
  /** None in phase 1; a read set may remove an upstream reason only when complete and disjoint from the changed paths. */
  readSet: { complete: boolean; paths: string[] } | null;
}
export interface Journal { executions: readonly Execution[]; heads: Readonly<Record<string, number>> }
export type MessageTarget =
  | { kind: "run" }
  | { kind: "step"; stepKey: string }
  | { kind: "execution"; stepKey: string; seq: number }
  | { kind: "round"; stepKey: string; roundNo: number }
  | { kind: "effect"; recordId: string };
export interface FlowMessage { kind: "feedback" | "edit" | "command"; target: MessageTarget }
export interface WorkspaceState {
  definitionHashes: Readonly<Record<string, string>>;
  start: string;
  params: string;
  whenFalse: ReadonlySet<string>;
  composeConflicts: ReadonlySet<string>;
  /** Paths each changed upstream output touched (`start` for the import); used only against complete read sets. */
  changedPaths?: Readonly<Record<string, readonly string[]>>;
  /** Outputs the person accepted as unchanged (§7.4). */
  acceptedUnchanged?: ReadonlySet<string>;
}
export interface Candidate { stepKey: string; reasons: string[] }

export function activeExecution(journal: Journal, stepKey: string): Execution | null {
  const seq = journal.heads[stepKey];
  if (seq === undefined) return null;
  return journal.executions.find((e) => e.stepKey === stepKey && e.seq === seq) ?? null;
}

const targetStep = (target: MessageTarget): string | null => ("stepKey" in target ? target.stepKey : null);

export function candidates(journal: Journal, template: { steps: ReadonlyArray<{ id: string }> }, messages: readonly FlowMessage[], ws: WorkspaceState): Candidate[] {
  const feedbackOn = new Set(messages.filter((m) => m.kind === "feedback").map((m) => targetStep(m.target)).filter((k): k is string => k !== null));
  const editedOn = new Set(messages.filter((m) => m.kind === "edit").map((m) => targetStep(m.target)).filter((k): k is string => k !== null));
  const order = template.steps.map((step) => step.id);
  const result: Candidate[] = [];
  const rerunning = new Set<string>();

  for (const [index, stepKey] of order.entries()) {
    if (ws.whenFalse.has(stepKey)) continue;
    const active = activeExecution(journal, stepKey);
    const done = active !== null && active.state === "done";
    const reasons: string[] = [];
    if (done && ws.definitionHashes[stepKey] !== undefined && ws.definitionHashes[stepKey] !== active.definitionHash) reasons.push("definition-changed");
    if (done) {
      const changed = (key: string): boolean => {
        const paths = ws.changedPaths?.[key];
        const readSet = active.readSet;
        // Unknown reads (no read set, or an incomplete one) or unknown changed paths: the change counts.
        if (readSet === null || !readSet.complete || paths === undefined || rerunning.has(key)) return true;
        return paths.some((path) => readSet.paths.includes(path));
      };
      if (active.ranOnInputs.start !== ws.start && changed("start")) reasons.push("upstream-changed:start");
      if (active.ranOnInputs.params !== ws.params) reasons.push("upstream-changed:params");
      for (const earlier of order.slice(0, index)) {
        if (ws.whenFalse.has(earlier)) continue;
        if (upstreamMoved(journal, active, earlier, rerunning, ws) && changed(earlier)) reasons.push(`upstream-changed:${earlier}`);
      }
    }
    if (feedbackOn.has(stepKey)) reasons.push("feedback");
    if (!done) reasons.push("never-succeeded");
    if (ws.composeConflicts.has(stepKey)) reasons.push("compose-conflict");
    if (reasons.length === 0 || editedOn.has(stepKey)) continue;
    rerunning.add(stepKey);
    result.push({ stepKey, reasons });
  }
  return result;
}

/** Whether `earlier`'s output differs from what `active` ran on, or `earlier` is about to re-run. */
function upstreamMoved(journal: Journal, active: Execution, earlier: string, rerunning: ReadonlySet<string>, ws: WorkspaceState): boolean {
  if (rerunning.has(earlier)) return true;
  if (ws.acceptedUnchanged?.has(earlier) === true) return false;
  const now = activeExecution(journal, earlier);
  const nowHash = now !== null && now.state === "done" ? now.outputHash : null;
  const then = active.ranOnInputs.earlier.find((e) => e.stepKey === earlier) ?? null;
  if ((then?.outputHash ?? null) === nowHash) return false;
  // Cutoff by projection: both sides have one and they are equal.
  return !(now !== null && now.projection !== null && then !== null && then.projection !== null && now.projection === then.projection);
}

/** §7.4: candidates minus the person's skips plus the person's additions, always in template order (never the proposal's). */
export function chosenPlan(list: readonly Candidate[], choice: { skips: readonly string[]; add: readonly string[] }, templateOrder: readonly string[]): string[] {
  for (const key of choice.add) if (!templateOrder.includes(key)) throw new Error(`flow-step-not-found: ${key}`);
  const chosen = new Set([...list.map((c) => c.stepKey).filter((key) => !choice.skips.includes(key)), ...choice.add]);
  return templateOrder.filter((key) => chosen.has(key));
}

/** §7.5, R §4: the latest `done` execution of a step with this fingerprint; failed or rate-limited ones never count. */
export function reusable(journal: Journal, stepKey: string, fp: string): Execution | null {
  const matches = journal.executions.filter((e) => e.stepKey === stepKey && e.fingerprint === fp && e.state === "done" && (e.failure ?? null) === null);
  return matches.reduce<Execution | null>((best, e) => (best === null || e.seq > best.seq ? e : best), null);
}
