/**
 * Project filtering spec §11 R1: a recovery retry belongs to its blocker's own group. The button remembers only which
 * blocker it was rendered for; the command is built when it is pressed, from that group's current summary revision --
 * never from whichever group happens to be open -- and is not built at all when that summary, the epoch, a complete
 * re-read or the blocker itself says the evidence on screen is no longer the server's.
 */
import type { ControlAction } from "./controlApi.js";
import type { ControlClientState } from "./controlState.js";

export interface RecoveryTarget {
  source: "recovery" | "group-view";
  /** The recovery view's (or group view's) epoch the button was rendered from. */
  epoch: string;
  groupId: string;
  runId: string | null;
  /** The blocker's code, to find it again. */
  code: string;
}

/** Spec §11 R1: the command, built now from the target's own current summary -- or null when it must not be sent. */
export function recoveryRetryAction(state: ControlClientState, target: RecoveryTarget): ControlAction | null {
  if (target.groupId === "" || state.refetchRequired || state.epoch === null || state.epoch !== target.epoch) return null;
  const listed = target.source === "recovery"
    ? state.recovery?.epoch === target.epoch && state.recovery.blockers.some((b) => b.groupId === target.groupId && b.runId === target.runId && b.code === target.code)
    : (state.canonical[target.groupId]?.recoveryBlockers ?? []).some((b) => b.runId === target.runId && b.code === target.code);
  if (!listed) return null;
  const summary = state.groups[target.groupId];
  if (summary === undefined) return null;
  const payload = target.runId === null ? { scope: "group" as const, groupId: target.groupId } : { scope: "run" as const, runId: target.runId };
  return { verb: "recovery-retry", groupId: target.groupId, expectedRevision: summary.commandRevision, payload };
}
