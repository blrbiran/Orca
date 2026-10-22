/**
 * Flow engine spec §5.3 [IR-C3] and §6.5: base composition and the flow head.
 *
 * The base of step S is composed by code: start from the run's import commit; for each step earlier than S in template
 * order that has an ACTIVE output (`step_heads`, never "all executions", never a branch tip), merge that output's change
 * (its commit against its own parent) into the accumulated tree with `git merge-tree --write-tree`; `commit-tree` the
 * result on the import. A merge that conflicts names the step whose output no longer merges (`compose-conflict`).
 *
 * The flow head `refs/orca/<flowRunId>/head` holds the composition of every active output and moves only by
 * compare-and-swap from the value read; a failed swap (a sibling moved it) recomposes and tries again.
 */
import { ORCA_IDENTITY } from "../../scheduler/gitExec.js";
import { vaultGit, type Vault } from "./vault.js";

export interface StepOutput { stepKey: string; commit: string; parent: string }
export interface ExecutionOutput extends StepOutput { seq: number }

export const headRef = (flowRunId: string): string => `refs/orca/${flowRunId}/head`;

/**
 * The active output of every step before `beforeStep` (all steps when it is null), in template order. A `suppressed`
 * step (gaps spec §6.2: skipped or deferred by the person) is left out as a step with no head is; its head stays.
 */
export function activeOutputs(executions: readonly ExecutionOutput[], heads: Readonly<Record<string, number>>, order: readonly string[], beforeStep: string | null, suppressed: ReadonlySet<string> = new Set()): StepOutput[] {
  const end = beforeStep === null ? order.length : order.indexOf(beforeStep);
  if (end === -1) throw new Error(`flow-step-not-found: ${beforeStep}`);
  const out: StepOutput[] = [];
  for (const stepKey of order.slice(0, end)) {
    const seq = heads[stepKey];
    if (seq === undefined || suppressed.has(stepKey)) continue;
    const exec = executions.find((e) => e.stepKey === stepKey && e.seq === seq);
    if (exec === undefined) throw new Error(`orca: step ${stepKey} points at execution ${seq}, which has no output`);
    out.push({ stepKey, commit: exec.commit, parent: exec.parent });
  }
  return out;
}

export async function compose(vault: Vault, base: string, outputs: readonly StepOutput[]): Promise<{ tree: string; commit: string } | { conflict: string }> {
  let tree = (await vaultGit(vault, ["rev-parse", `${base}^{tree}`])).trim();
  for (const output of outputs) {
    let written: string;
    try {
      written = await vaultGit(vault, ["merge-tree", "--write-tree", "--no-messages", `--merge-base=${output.parent}`, tree, output.commit]);
    } catch (error) {
      // Exit 1 is a conflicted merge; anything else is git failing and is thrown as it is.
      if ((error as { code?: unknown }).code === 1) return { conflict: output.stepKey };
      throw error;
    }
    tree = written.split("\n", 1)[0]!.trim();
  }
  const commit = (await vaultGit(vault, [...ORCA_IDENTITY, "commit-tree", tree, "-p", base, "-m", "orca: compose"])).trim();
  return { tree, commit };
}

/** The base of `stepKey`'s next execution: the import plus every earlier active output (C4). */
export function composeBase(vault: Vault, importCommit: string, executions: readonly ExecutionOutput[], heads: Readonly<Record<string, number>>, order: readonly string[], stepKey: string): Promise<{ tree: string; commit: string } | { conflict: string }> {
  return compose(vault, importCommit, activeOutputs(executions, heads, order, stepKey));
}

/** CAS on the flow head: from `expected` (null = the head does not exist yet) to `next`. False when it moved. */
export async function advanceHead(vault: Vault, flowRunId: string, expected: string | null, next: string): Promise<boolean> {
  try {
    await vaultGit(vault, ["update-ref", headRef(flowRunId), next, expected ?? ""]);
    return true;
  } catch (error) {
    // Refused because the head is somewhere else now: lost the race. Any other refusal is git's to name.
    if (await readHead(vault, flowRunId) !== expected) return false;
    throw error;
  }
}

export async function readHead(vault: Vault, flowRunId: string): Promise<string | null> {
  try { return (await vaultGit(vault, ["rev-parse", "--verify", "-q", `${headRef(flowRunId)}^{commit}`])).trim(); }
  catch { return null; }
}

/** Read the head, compose the next one from it, swap; a sibling that moved it first makes this recompose. */
export async function advanceHeadWithRetry(vault: Vault, flowRunId: string, composeNext: (current: string | null) => Promise<string>, maxTries = 5): Promise<string> {
  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    const current = await readHead(vault, flowRunId);
    const next = await composeNext(current);
    if (await advanceHead(vault, flowRunId, current, next)) return next;
  }
  throw new Error(`orca: the flow head of ${flowRunId} kept moving; ${maxTries} compositions lost the race`);
}
