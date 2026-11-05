/**
 * Quota failover spec 2026-11-03 §3 "Remember", D3, D4 (human rulings §8, session e2ad4802): an installation whose quota
 * ran out rests, for every group, until its vendor's reset time when the CLI's own error text names one, else 15 minutes
 * doubling per consecutive quota failure, capped at 8 hours. Code only (Rule 5). Derived from the runs already stored
 * (ccloop's typed `quota` cause and its `detail`, the CLI's error row): no table of its own, so nothing to keep in step.
 * A run on the installation that succeeded after the quota failures ends the rest.
 */
import type { ControlStore } from "./store.js";

export const REST_DEFAULT_MS = 15 * 60_000;
export const REST_CAP_MS = 8 * 60 * 60_000;
/**
 * `since`: the first quota failure of the streak the rest comes from; `detail`: the CLI's own error text of the last one
 * (ccloop's `failureCause.detail`), for the agents page (session 3cfc2e73, batch FB).
 */
export interface InstallationRest { installation: string; until: number; source: "vendor" | "default"; runId: string; since: number; detail: string | null }

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * The reset time a codex quota error names, in the machine's local time (the CLI prints local time), or null.
 * Shapes seen on this machine: "try again at Oct 22nd, 2026 2:13 PM" and "try again at 16:12" (the next 16:12 after
 * the failure). Anything else is null: the default rest applies, never a guess.
 */
export function parseResetAt(detail: string | null, at: number): number | null {
  if (detail === null) return null;
  const dated = /try again at ([A-Z][a-z]{2})[a-z]* (\d{1,2})(?:st|nd|rd|th)?,? (\d{4}),? (\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(detail);
  if (dated !== null) {
    const month = MONTHS.indexOf(dated[1]!.toLowerCase());
    let hour = Number(dated[4]);
    const meridiem = dated[6]?.toUpperCase();
    if (month < 0 || hour > 23 || Number(dated[5]) > 59 || (meridiem !== undefined && (hour < 1 || hour > 12))) return null;
    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    const value = new Date(Number(dated[3]), month, Number(dated[2]), hour, Number(dated[5])).getTime();
    return Number.isFinite(value) ? value : null;
  }
  const timeOnly = /try again at (\d{1,2}):(\d{2})\s*([AP]M)?(?![\d,])/i.exec(detail);
  if (timeOnly !== null) {
    let hour = Number(timeOnly[1]);
    const meridiem = timeOnly[3]?.toUpperCase();
    if (hour > 23 || Number(timeOnly[2]) > 59 || (meridiem !== undefined && (hour < 1 || hour > 12))) return null;
    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    const day = new Date(at);
    let value = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, Number(timeOnly[2])).getTime();
    if (value <= at) value = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, hour, Number(timeOnly[2])).getTime();
    return value;
  }
  return null;
}

/**
 * Quota failover spec §8, D6: the installations a task on `current` may move to now -- the failover order's entries that
 * are another installation, are listed by the agents table and are not resting (failoverPass, retry-task --agent auto).
 */
export function failoverTargets(order: readonly string[], listed: readonly string[], rests: ReadonlyMap<string, InstallationRest>, current: string): string[] {
  return order.filter((id) => id !== current && listed.includes(id) && !rests.has(id));
}

interface RunRow { runId: string; installation: string; at: number; quota: boolean; succeeded: boolean; detail: string | null }

/** Every installation resting at `now`, from the task runs in store order. */
export function installationRests(store: ControlStore, now: number): Map<string, InstallationRest> {
  const rows: RunRow[] = [];
  for (const row of store.db.prepare("SELECT id, body FROM runs WHERE json_extract(body,'$.drive.failureCause.cause')='quota' OR json_extract(body,'$.drive.outcome')='succeeded' ORDER BY rowid").all()) {
    let body: { agent?: { agent?: unknown }; endedAt?: unknown; drive?: { outcome?: unknown; failureCause?: { cause?: unknown; detail?: unknown } } };
    try { body = JSON.parse(String(row.body)); } catch { continue; }
    const installation = body.agent?.agent;
    if (typeof installation !== "string") continue;
    const quota = body.drive?.failureCause?.cause === "quota", succeeded = body.drive?.outcome === "succeeded";
    if (!quota && !succeeded) continue;
    const ended = typeof body.endedAt === "number" ? body.endedAt : Number(store.db.prepare("SELECT MAX(at) AS at FROM activity WHERE run_id=?").get(String(row.id))?.at ?? 0);
    const detail = typeof body.drive?.failureCause?.detail === "string" ? body.drive.failureCause.detail : null;
    rows.push({ runId: String(row.id), installation, at: ended, quota, succeeded, detail });
  }
  const rests = new Map<string, InstallationRest>();
  const byInstallation = new Map<string, RunRow[]>();
  for (const row of rows) byInstallation.set(row.installation, [...(byInstallation.get(row.installation) ?? []), row]);
  for (const [installation, list] of byInstallation) {
    list.sort((left, right) => left.at - right.at);
    // The quota failures since the installation's last success, oldest first.
    const lastSuccess = list.map((row) => row.succeeded).lastIndexOf(true);
    const streak = list.slice(lastSuccess + 1).filter((row) => row.quota);
    const last = streak.at(-1);
    if (last === undefined) continue;
    const vendor = parseResetAt(last.detail, last.at);
    const until = vendor ?? last.at + Math.min(REST_CAP_MS, REST_DEFAULT_MS * 2 ** Math.min(streak.length - 1, 10));
    if (until > now) rests.set(installation, { installation, until, source: vendor === null ? "default" : "vendor", runId: last.runId, since: streak[0]!.at, detail: last.detail });
  }
  return rests;
}
