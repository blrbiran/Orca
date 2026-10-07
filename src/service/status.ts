import type { Identity } from "./identify.js";
import type { ManagerState } from "./manager.js";

/** Spec §4: the manager's view and a real request, never the manager's exit code alone. Exit 0 only when answered. */
export function statusLines(kind: string, state: ManagerState, identity: Identity, errTail: string[], errLog: string): { lines: string[]; code: 0 | 1 } {
  const lines = [`manager: ${kind} ${state.loaded ? state.state : "not loaded"} pid=${state.pid ?? "-"}`];
  if (identity.answering) {
    const p = identity.panel;
    lines.push(`panel: answering at ${p.url} (socket ${p.socketPath ?? "none"}, pid ${p.pid}, version ${p.version})`);
    if (state.pid !== null && state.pid !== p.pid) lines.push(`note: the manager's pid ${state.pid} is not panel.json's pid ${p.pid}`);
    return { lines, code: 0 };
  }
  lines.push(`panel: not answering: ${identity.reason}`);
  if (errTail.length > 0) lines.push(`last lines of ${errLog}:`, ...errTail.map((line) => `  ${line}`));
  return { lines, code: 1 };
}
