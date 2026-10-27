/**
 * Live transcript spec §10.5.1 (plan T2): a child port for the flow pause/note tests (T4–T6). It models each child's stop
 * state, records every stop and resume, and lets a criterion land a child or fail a resume by code.
 *
 * Modelled on the driver port (src/flow/childPort.ts) so a criterion cannot pass on behaviour the real child refuses
 * (review 7753e97d, finding 6): `stop` refuses a different existing stop (applyFlowHandoffStop's `stop-mode-conflict`) and
 * is a no-op for the same marker; a stop on a settled child freezes nothing, so it is complete at once; `resume` refuses
 * a stop that is not complete and a settled child (`continuation-predecessor-unrecoverable`), deletes the stop it lifts,
 * and runs `record` in the same all-or-nothing step (a throw lifts nothing).
 */
import { ControlError } from "../../../src/control/errors.js";
import type { FlowStopMarker } from "../../../src/control/stopIntent.js";
import { FlowRefusal } from "../../../src/flow/kernel.js";
import type { FlowChildOpen, FlowChildPort, FlowChildResume, FlowChildStatus, FlowChildStopState } from "../../../src/flow/kinds/work.js";

type StopState = "handoff-pending" | "handoff-partial" | "handoff-unresolved" | "handoff-complete";

function sameMarker(left: FlowStopMarker, right: FlowStopMarker): boolean {
  return left.flowRunId === right.flowRunId && left.stepKey === right.stepKey && left.seq === right.seq && left.reason === right.reason;
}

export function fakeChildPort(opts: { timeoutMs?: number | null } = {}) {
  const statuses = new Map<string, FlowChildStatus>();
  const stopStates = new Map<string, StopState>();
  const markers = new Map<string, FlowStopMarker>();
  const recoverable = new Map<string, boolean>();
  const resumeFailures = new Map<string, string>();
  const stops: Array<{ childGroupId: string; acceptedAt: string; deadlineAt: string; flowStop: FlowStopMarker }> = [];
  const resumes: Array<{ children: FlowChildResume[]; result: Array<{ childGroupId: string; pendingRunId: string | null }> }> = [];

  const stateOf = (childGroupId: string, flowStop: FlowStopMarker): FlowChildStopState => {
    const placed = stopStates.get(childGroupId);
    if (placed === undefined) return { state: "none" };
    const marker = markers.get(childGroupId);
    if (marker === undefined || !sameMarker(marker, flowStop)) return { state: "foreign", stopState: placed };
    if (placed === "handoff-complete") return { state: "resumable", recoverable: recoverable.get(childGroupId) ?? true };
    return { state: "not-complete", stopState: placed };
  };

  const settled = (childGroupId: string): boolean => {
    const state = statuses.get(childGroupId)?.state;
    return state === "landed" || state === "failed";
  };
  const port: FlowChildPort = {
    async open(_request: FlowChildOpen) {},
    async status(childGroupId) {
      return statuses.get(childGroupId) ?? { state: "running" };
    },
    attemptTimeoutMs: () => (opts.timeoutMs === undefined ? 3_600_000 : opts.timeoutMs),
    stop(childGroupId, input) {
      const existing = markers.get(childGroupId);
      if (existing !== undefined) {
        if (sameMarker(existing, input.flowStop)) return;
        throw new ControlError("stop-mode-conflict", childGroupId);
      }
      stops.push({ childGroupId, acceptedAt: input.acceptedAt, deadlineAt: input.deadlineAt, flowStop: input.flowStop });
      stopStates.set(childGroupId, settled(childGroupId) ? "handoff-complete" : "handoff-pending");
      if (settled(childGroupId)) recoverable.set(childGroupId, false);
      markers.set(childGroupId, input.flowStop);
    },
    stopState: stateOf,
    resume(children, record) {
      const result = children.map((child) => {
        const failure = resumeFailures.get(child.childGroupId);
        if (failure !== undefined) throw new FlowRefusal(failure, child.childGroupId);
        const state = stateOf(child.childGroupId, child.flowStop);
        if (state.state !== "resumable") throw new FlowRefusal("flow-pause-stop-incomplete", `${child.childGroupId}:${state.state === "not-complete" ? state.stopState : "foreign"}`);
        if (settled(child.childGroupId)) throw new FlowRefusal("flow-pause-resume-failed", "continuation-predecessor-unrecoverable");
        return { childGroupId: child.childGroupId, pendingRunId: state.recoverable ? `run-${child.childGroupId}` : null };
      });
      record(result);
      for (const child of children) { stopStates.delete(child.childGroupId); markers.delete(child.childGroupId); }
      resumes.push({ children, result });
      return result;
    },
  };

  return {
    port,
    stops,
    resumes,
    land(childGroupId: string, commit?: string): void {
      statuses.set(childGroupId, { state: "landed", commit: commit ?? null, spentTokens: 0 });
    },
    completeStop(childGroupId: string, opts: { recoverable?: boolean } = {}): void {
      stopStates.set(childGroupId, "handoff-complete");
      recoverable.set(childGroupId, opts.recoverable ?? true);
    },
    failResume(childGroupId: string, code: string): void {
      resumeFailures.set(childGroupId, code);
    },
    clearResumeFailure(childGroupId: string): void {
      resumeFailures.delete(childGroupId);
    },
    setStopState(childGroupId: string, state: "handoff-pending" | "handoff-partial" | "handoff-unresolved"): void {
      stopStates.set(childGroupId, state);
    },
  };
}
