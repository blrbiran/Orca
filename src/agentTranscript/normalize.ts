/**
 * Live transcript spec §5.1 / §10.3: one runtime's line to its normalized events. The runtime is the listing path's first
 * segment (ccloop `transcripts.ts`: `<kind>/<attempt>/<phase>/<call>/transcript.jsonl`). ccloop's own marker lines
 * (`ccloop.transcript-truncated`, claude's `ccloop.line-dropped`, spec §10.2.1-§10.2.2) map the same for every runtime.
 * A line no mapper knows is `unknown` and renders as collapsed text; a line that does not parse is decoded by the
 * streaming unescaper (C6) and served as `unknown` text.
 */
import { event, str, type Mapper, type RawEvent } from "./events.js";
import { claudeMapper } from "./runtimes/claude.js";
import { codexMapper } from "./runtimes/codex.js";
import { ompMapper } from "./runtimes/omp.js";
import { decodeAll } from "./unescape.js";

export type Runtime = "claude" | "codex" | "omp";
export const RUNTIMES: readonly Runtime[] = ["claude", "codex", "omp"];
const MAPPERS: Record<Runtime, Mapper> = { claude: claudeMapper, codex: codexMapper, omp: ompMapper };

/** Spec §10.4.2: a line over this is never parsed. */
export const PARSE_LIMIT = 1024 * 1024;

/** The test seam for "JSON.parse is never called on an oversized line" (T3): every parse of a line goes through here. */
export const lineParser = { parse: (text: string): unknown => JSON.parse(text) };

export function normalizeLine(runtime: Runtime, bytes: Buffer): RawEvent[] {
  if (bytes.length > PARSE_LIMIT) throw new Error("normalizeLine called on an oversized line");
  let parsed: unknown;
  try { parsed = lineParser.parse(bytes.toString("utf8")); }
  catch { return [event("unknown", { fields: { raw: { plain: decodeAll(bytes) } } })]; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [event("unknown", { fields: { raw: { composite: parsed } } })];
  const line = parsed as Record<string, unknown>;
  const type = str(line.type);
  if (type === "ccloop.transcript-truncated") return [event("notice", { meta: { notice: "truncated" }, num: { atBytes: typeof line.atBytes === "number" ? line.atBytes : undefined } })];
  if (type === "ccloop.line-dropped") return [event("notice", { meta: { notice: "line-dropped" }, num: { bytes: typeof line.bytes === "number" ? line.bytes : undefined } })];
  return MAPPERS[runtime](line);
}
