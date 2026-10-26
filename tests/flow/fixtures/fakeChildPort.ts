/**
 * Live transcript spec §10.5.1 (plan T2): a child port for the flow pause/note tests (T4–T6). It models each child's stop
 * state, records every stop and resume, and lets a criterion land a child or fail a resume by code.
 */
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

  const port: FlowChildPort = {
    async open(_request: FlowChildOpen) {},
    async status(childGroupId) {
      return statuses.get(childGroupId) ?? { state: "running" };
    },
    attemptTimeoutMs: () => opts.timeoutMs ?? 3_600_000,
    stop(childGroupId, input) {
      stops.push({ childGroupId, acceptedAt: input.acceptedAt, deadlineAt: input.deadlineAt, flowStop: input.flowStop });
      stopStates.set(childGroupId, "handoff-pending");
      markers.set(childGroupId, input.flowStop);
    },
    stopState: stateOf,
    resume(children) {
      const result = children.map((child) => {
        const failure = resumeFailures.get(child.childGroupId);
        if (failure !== undefined) throw new FlowRefusal(failure, child.childGroupId);
        const state = stateOf(child.childGroupId, child.flowStop);
        return { childGroupId: child.childGroupId, pendingRunId: state.state === "resumable" && state.recoverable ? `run-${child.childGroupId}` : null };
      });
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
