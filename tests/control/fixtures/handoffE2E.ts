import { readdirSync } from "node:fs";
import { expect } from "vitest";
import { readArtifact } from "../../../src/control/archive.js";
import { DriverCrash, type CrashPoint } from "../../../src/control/executionDriver.js";
import type { ControlRuntime } from "../../../src/panel/controlAssembly.js";
import { readControlGroup } from "../../../src/panel/controlViews.js";
import { g, noBlocked, raw, until, workRuns, type RunRow, type ScriptEntry, type Task, type World } from "./ccloopWorld.js";
import { storeReadings } from "./handoffHarness.js";

/**
 * The helpers and scripts the handoff E2E files share (moved verbatim from handoffE2E.test.ts when it was split into
 * three files so its cases run on parallel workers; test pruning, 2026-11-17).
 */
export const isAncestor = (cwd: string, ancestor: string, descendant: string): boolean => {
  try { g(cwd, "merge-base", "--is-ancestor", ancestor, descendant); return true; } catch { return false; }
};

let commandSeq = 0;
/** The person's handoff-stop; answers the request ids it created, one per frozen run. */
export async function handoffStop(runtime: ControlRuntime, payload: { handoffDeadlineAt?: string } = {}): Promise<string[]> {
  const stopped = await runtime.service.handoffStop(raw(runtime, `stop-${++commandSeq}`, "handoff-stop", payload));
  if ("error" in stopped || stopped.result.kind !== "handoff-stopped") throw new Error(`handoff-stop refused: ${JSON.stringify(stopped)}`);
  return stopped.result.requestIds;
}

/**
 * The panel's rule (web/src/ControlGroupView.tsx `continuableRuns`, handoff delivery spec §13.1 C-4), applied
 * to the server's read model: a run the server marks continuable, with its non-unknown checkpoint.
 */
export function panelSelections(runtime: ControlRuntime): Array<{ taskId: string; predecessorRunId: string; checkpointId: string }> {
  const view = readControlGroup(runtime.store, runtime.epoch, "g");
  return view.runs.flatMap((run) => {
    if (run.taskId === null || run.continuable !== true) return [];
    const checkpoint = view.checkpoints.find((candidate) => candidate.runId === run.runId && candidate.state !== "unknown");
    return checkpoint ? [{ taskId: run.taskId, predecessorRunId: run.runId, checkpointId: checkpoint.checkpointId }] : [];
  });
}

/** One resume-from-handoff command carrying exactly the panel's selections. */
export async function resumeAsThePanelWould(runtime: ControlRuntime): Promise<Array<{ taskId: string; predecessorRunId: string; checkpointId: string }>> {
  const selections = panelSelections(runtime);
  const resumed = await runtime.service.resumeFromHandoff(raw(runtime, `resume-${++commandSeq}`, "resume-from-handoff", { selections }));
  expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
  return selections;
}

export const runsOf = (runtime: ControlRuntime, taskId: string): RunRow[] => workRuns(runtime).filter((run) => run.task === taskId);
export const work = (runtime: ControlRuntime, taskId: string) => storeReadings.work(runtime.store, taskId);
export const requestState = (runtime: ControlRuntime, requestId: string): string => storeReadings.requestState(runtime.store, requestId);
export const active = (runtime: ControlRuntime, runId: string): number => storeReadings.active(runtime.store, runId);
export const committedAndUsed = (runtime: ControlRuntime): number[] => storeReadings.committedAndUsed(runtime.store);
export const allocation = (runtime: ControlRuntime, taskId: string) => storeReadings.allocation(runtime.store, taskId);
export const stopped = (runtime: ControlRuntime): boolean => JSON.parse(String(runtime.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)).stopped;
export const checkpointOf = (runtime: ControlRuntime, checkpointId: string) =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM checkpoints WHERE id=?").get(checkpointId)!.body));
/** The snapshot a checkpoint points at (an archived artifact, src/control/snapshot.ts): its `head` is ccloop's result HEAD. */
export const snapshotHead = async (runtime: ControlRuntime, checkpoint: { snapshot: { artifactId: string; hash: string } }): Promise<string> =>
  (JSON.parse((await readArtifact(runtime.store, checkpoint.snapshot)).toString("utf8")) as { head: string }).head;
/** ccloop source directories the driver created: one per run it prepared (reconciliation runs live elsewhere). */
export const sourceDirs = (runtime: ControlRuntime): string[] => readdirSync(`${runtime.store.stateDir}.runs`).sort();

/**
 * The one-task script H1 and every R-H point share. The predecessor writes the first half while its execute
 * phase sleeps long enough for the stop to arrive in the middle of it; the continuation (ccloop C5's
 * `#continuation` key, chosen by the continuation constraint in its plan and execute prompts) writes the
 * second half. Its verify prompt carries no constraint, so that call is answered by `a` -- which has no
 * verify delay.
 */
export const HALVES: Record<string, ScriptEntry> = {
  a: { files: { "a1.txt": "A1\n" }, delayMs: { execute: 6_000 } },
  "a#continuation": { files: { "a2.txt": "A2\n" } },
};
export const HALVES_TASKS: Task[] = [{ taskId: "a", targetPaths: ["a1.txt", "a2.txt"] }];
/**
 * Stopped at the boundary after execute (ccloop stops at every phase boundary, spec §11 M1): plan and
 * execute. The continuation runs a whole attempt with the agent verifier: plan, execute, verify.
 */
export const HALVES_CALLS = ["plan", "execute", "plan", "execute", "verify"];
export const HALVES_SCRIPTED = ["plan a", "execute a", "plan a#continuation", "execute a#continuation", "verify a"];

/** Waits until the predecessor of each of `taskIds` is in its execute phase (its execute call is logged before it sleeps). */
export async function inExecute(w: World, runtime: ControlRuntime, taskIds: string[]): Promise<void> {
  await until(() => { noBlocked(runtime); return taskIds.every((id) => w.scripted().includes(`execute ${id}`)); }, 120_000, `${taskIds.join(",")} to enter execute`, 20);
}

/** Test-only fault injection (execution driver spec §7.2 R1): the driver dies at `point`, as a process death would. */
export const crashAt = (point: CrashPoint) => (at: CrashPoint): void => { if (at === point) throw new DriverCrash(at); };
