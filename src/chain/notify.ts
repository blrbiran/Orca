import { execFile } from "node:child_process";
import { chainRecordRelPath } from "./paths.js";
import type { ChainRecord } from "./recordSchema.js";

/** Sum of what claude reported; null as soon as one session reported nothing (Rule 14: never estimated). */
export function totalCostUsd(r: ChainRecord): number | null {
  let total = 0;
  for (const s of r.sessions) {
    if (s.costUsd === null) return null;
    total += s.costUsd;
  }
  return Number(total.toFixed(6));
}

/** D-launch spec §1 R6: the terminal summary. */
export function summaryText(r: ChainRecord): string {
  const cost = totalCostUsd(r);
  const lines = [
    r.stop === null ? `orca chain ${r.chainId} is running` : `orca chain ${r.chainId} stopped: ${r.stop.reason} (${r.stop.category})`,
    `goal: ${r.goal}`,
    `sessions: ${r.sessions.length}; cost: ${cost === null ? "unreadable (a session reported no total_cost_usd)" : `${cost} USD, as reported by claude`}`,
  ];
  if (r.stop?.detail) lines.push(`detail: ${r.stop.detail}`);
  if (r.stop !== null && r.stop.awaitingHuman.length > 0) lines.push("awaiting a human:", ...r.stop.awaitingHuman.map((a) => `  - ${a}`));
  lines.push(`record: ${chainRecordRelPath(r.chainId)}`);
  return `${lines.join("\n")}\n`;
}

/** Spec §5.3: resolves to a warning (never rejects); a failure changes neither the exit code nor the record. */
export function macNotify(title: string, body: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", "on run argv", "-e", "display notification (item 1 of argv) with title (item 2 of argv)", "-e", "end run", body, title],
      { env, timeout: 10_000 },
      (err) => resolve(err === null ? null : err.message.trim()),
    );
  });
}
