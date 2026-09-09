import { METRICS_FIELDS } from "./types.js";
import type { MetricsReport } from "./types.js";

/**
 * spec §6 item 1: serialization order comes from METRICS_FIELDS, never from the
 * object's own key order. Without a written-down order there is no byte-exact
 * golden to diff against, and `readdir` order differs between APFS and ext4 —
 * so a golden built by JSON.stringify(report) would be green only on the
 * machine that wrote it.
 *
 * ⚠️ The whitelist is also why the scan duration cannot leak into --json by
 * accident: a field that is not in METRICS_FIELDS is simply not rendered.
 */
export function renderJson(report: MetricsReport): string {
  const ordered: Record<string, unknown> = {};
  for (const field of METRICS_FIELDS) {
    ordered[field] = report[field];
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

/**
 * The human view. A' §4.4 says the correction rate must never be read on its
 * own, so every caveat the computation attached is printed next to the number
 * rather than tucked into the JSON where a person reading a terminal would
 * never see it.
 */
export function renderTable(report: MetricsReport): string {
  const lines: string[] = [];
  lines.push(`as of ${report.as_of} (${report.as_of_mode})`);
  lines.push("");
  lines.push(
    `correction rate (stale excluded from the numerator): ` +
      `${report.correction_rate.numerator_corrections_excluding_stale}` +
      `/${report.correction_rate.denominator_decisions} = ` +
      `${pct(report.correction_rate.rate_excluding_stale)}`,
  );
  lines.push(
    `  corrections including stale: ${report.correction_rate.corrections_total_including_stale}`,
  );
  for (const caveat of report.correction_rate.caveats) lines.push(`  ⚠️ ${caveat}`);
  lines.push("");
  lines.push(
    `repair rate (stale kept in the denominator): ` +
      `${report.repair_rate.numerator_overturned}` +
      `/${report.repair_rate.denominator_corrections_including_stale} = ${pct(report.repair_rate.rate)}`,
  );
  lines.push(
    `  stale only: ${report.repair_rate.stale_only.numerator_overturned}` +
      `/${report.repair_rate.stale_only.denominator_corrections} = ` +
      `${pct(report.repair_rate.stale_only.rate)} — ${report.repair_rate.stale_only.known_bias}`,
  );
  lines.push("");
  lines.push(
    `backlog: ${report.backlog.open_corrections} open, oldest ` +
      `${report.backlog.oldest_age_ms === null ? "n/a" : `${report.backlog.oldest_age_ms} ms`}`,
  );
  lines.push("");
  lines.push(`repositories: ${report.repos.length}`);
  for (const repo of report.repos) lines.push(`  ${repo.projectKey}: ${repo.decisions} decision(s)`);
  if (report.unkeyable_repos.length > 0) {
    lines.push(`skipped, could not derive a projectKey: ${report.unkeyable_repos.length}`);
    for (const r of report.unkeyable_repos) lines.push(`  ${r.path}`);
  }
  if (report.unresolved_decisions.length > 0) {
    lines.push(
      `corrections whose decision was not scanned: ${report.unresolved_decisions.length} ` +
        `(--all would also scan archive/)`,
    );
  }
  if (report.malformed_lines.length > 0) {
    lines.push(`malformed lines: ${report.malformed_lines.length}`);
    for (const m of report.malformed_lines) {
      lines.push(`  ${m.file}:${m.line} (${m.bytes} bytes)${m.torn ? " — torn tail, a write may be in flight" : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * spec §4.1 / §6 item 3: the scan duration varies every run, so it goes to
 * stderr and never into --json. The caller writes it; this only formats it.
 */
export function renderTiming(ms: number): string {
  return `scanned in ${ms.toFixed(1)} ms\n`;
}
