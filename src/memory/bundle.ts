import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { MemoryRecord } from "./adapter.js";
import { parseCcmemExport, type CcmemScope } from "./ccmemExport.js";

/**
 * Memory in runs spec (`2026-11-20-memory-in-runs-and-read-api-design.md` §4.1 and the §9 decisions): Orca produces
 * one bounded, deterministic bundle at A2 and freezes it into the run's envelope. ccloop verifies the sha256 and puts
 * the text into plan and execute only.
 *
 * The rules that matter here:
 * - the selection is a pure function of ccmem's answer (pinned, trust, updated_at, id), so a retry inside the run is
 *   byte-identical and two runs of the same task on the same store agree;
 * - `retrieval_only` rows stay out, except an `orca-correction` row ("do not do that again" is exactly what the run
 *   needs);
 * - over the size cap the bundle is **dropped** with an error on the run, never truncated and never a refused envelope;
 * - a ccmem failure is recorded, never thrown: memory is an amplifier, not a prerequisite.
 */
export const MEMORY_BUNDLE_MAX_BYTES = 8192;
export const MEMORY_DEFAULT_BUDGET_TOKENS = 1200;
const CCMEM_TIMEOUT_MS = 30_000;
const CCMEM_MAX_BUFFER = 64 * 1024 * 1024;
const HEADER = "## ccmem context\n";

export interface MemoryBundle {
  format: "ccloop-memory-v1";
  sha256: string;
  tokens: number;
  ids: number[];
  text: string;
}

export interface MemoryBundleOutcome { bundle: MemoryBundle | null; error?: string }

/** The producer's own estimate (ccloop never re-tokenizes): ASCII ≈ 4 chars/token, every other code point 1 token. */
export function estimateMemoryTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4) + other;
}

function renderRow(record: MemoryRecord): string {
  return `- (${record.kind}) ${record.content}`;
}

/** The ranking: pinned first, then trust, then the most recently updated, then the numeric id (ties are stable). */
export function selectMemoryRows(rows: readonly MemoryRecord[], budgetTokens: number): MemoryRecord[] {
  const seen = new Set<string>();
  const ranked = rows
    .filter((record) => !record.tags.includes("retrieval_only") || record.tags.includes("orca-correction"))
    .filter((record) => (seen.has(record.ref) ? false : (seen.add(record.ref), true)))
    .sort((a, b) =>
      Number(b.pinned) - Number(a.pinned)
      || (b.trust ?? 0) - (a.trust ?? 0)
      || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
      || Number(a.ref) - Number(b.ref));
  const selected: MemoryRecord[] = [];
  for (const record of ranked) {
    const next = [...selected, record];
    if (estimateMemoryTokens(HEADER + next.map(renderRow).join("\n") + "\n") > budgetTokens) continue;
    selected.push(record);
  }
  return selected;
}

/** The bundle for one ccmem answer, or the named reason there is none. */
export function memoryBundleOf(rows: readonly MemoryRecord[], budgetTokens = MEMORY_DEFAULT_BUDGET_TOKENS): MemoryBundleOutcome {
  const selected = selectMemoryRows(rows, budgetTokens);
  if (selected.length === 0) return { bundle: null };
  const text = `${HEADER}${selected.map(renderRow).join("\n")}\n`;
  // The cap is measured on the exact bytes ccloop will hash; an over-size bundle is dropped whole, never cut.
  if (Buffer.byteLength(text, "utf8") > MEMORY_BUNDLE_MAX_BYTES) return { bundle: null, error: "too-large" };
  return {
    bundle: {
      format: "ccloop-memory-v1",
      sha256: createHash("sha256").update(text, "utf8").digest("hex"),
      tokens: estimateMemoryTokens(text),
      ids: selected.map((record) => Number(record.ref)),
      text,
    },
  };
}

function exportScope(bin: string, scope: CcmemScope, cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, ["export", "--json", "--scope", scope], { cwd, env, encoding: "utf8", timeout: CCMEM_TIMEOUT_MS, maxBuffer: CCMEM_MAX_BUFFER },
      (error, stdout) => { if (error === null) resolve(stdout); else reject(error); });
  });
}

/**
 * One bundle for a run whose task lives in `cwd`. Project rows first, then global, so the dedupe keeps the project
 * copy of an id; both scopes are read one after the other (the first may migrate, and two would contend for the lock).
 */
export async function produceMemoryBundle(options: {
  ccmemBin: string; env: NodeJS.ProcessEnv; cwd: string; budgetTokens?: number; timeoutMs?: number;
}): Promise<MemoryBundleOutcome> {
  try {
    const project = parseCcmemExport(await exportScope(options.ccmemBin, "project", options.cwd, options.env), "project");
    const global = parseCcmemExport(await exportScope(options.ccmemBin, "global", options.cwd, options.env), "global");
    return memoryBundleOf([...project, ...global], options.budgetTokens ?? MEMORY_DEFAULT_BUDGET_TOKENS);
  } catch (error) {
    const code = String((error as { code?: unknown }).code ?? (error as Error).message).slice(0, 120);
    return { bundle: null, error: `ccmem-failed:${code}` };
  }
}