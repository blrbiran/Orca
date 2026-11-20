import type { ControlStore } from "./store.js";

/**
 * #369 (owner ruling 2026-11-21: historical failures, not active probing): a model that an upstream
 * provider retired still appears in an agent's catalog. The run history knows: the latest run that
 * failed with a health-relevant cause names its model here, so `orca agent models` can mark it. The
 * three causes are the ones that say the model could not be served (404 / provider failure / quota);
 * a failed verify or a bad answer says nothing about the model's availability.
 */
export interface ModelFailure { cause: string; at: string | null; detail: string | null }

const HEALTH_CAUSES = new Set(["model-unavailable", "provider-error", "quota"]);
const DETAIL_CHARS = 200;
/** How many of the newest runs to inspect. A health note is advisory; this bounds the read on a large store. */
const SCAN_LIMIT = 500;

export function modelFailureHistory(store: ControlStore, installation: string): Map<string, ModelFailure> {
  const rows = store.db.prepare(
    "SELECT body FROM runs WHERE json_extract(body, '$.agent.agent') = ? ORDER BY rowid DESC LIMIT ?"
  ).all(installation, SCAN_LIMIT) as Array<{ body: string }>;
  const latest = new Map<string, ModelFailure>();
  for (const row of rows) {
    let body: { agent?: { model?: unknown }; drive?: { failureCause?: { cause?: unknown; detail?: unknown } }; endedAt?: unknown; startedAt?: unknown };
    try { body = JSON.parse(String(row.body)) as typeof body; } catch { continue; }
    const model = body.agent?.model;
    const cause = body.drive?.failureCause?.cause;
    if (typeof model !== "string" || model === "" || typeof cause !== "string" || !HEALTH_CAUSES.has(cause)) continue;
    if (latest.has(model)) continue;
    const at = typeof body.endedAt === "string" ? body.endedAt : typeof body.startedAt === "string" ? body.startedAt : null;
    const detail = typeof body.drive?.failureCause?.detail === "string" ? body.drive.failureCause.detail.slice(0, DETAIL_CHARS) : null;
    latest.set(model, { cause, at, detail });
  }
  return latest;
}