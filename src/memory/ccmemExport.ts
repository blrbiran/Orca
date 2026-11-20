import { z } from "zod";
import { MemoryError, type MemoryRecord } from "./adapter.js";

/**
 * Memory tab spec §3.6. Closed sets copied from ccmem `scripts/migrations/001_initial.sql` (read at ccmem `ef1667a`).
 * Strict on purpose: a column or an enum value ccmem adds makes the Memory section fail loudly with
 * ccmem-output-invalid instead of silently dropping data (Rule 12). Cross-repo vocabulary drift is a recorded,
 * recurring root cause between ccmem and Orca.
 */
const MAX_DATE_MS = 8_640_000_000_000_000; // spec §10 D11: the ECMAScript Date range
const epochMs = z.number().int().min(0).max(MAX_DATE_MS);

const rowSchema = z.object({
  id: z.number().int().positive(),
  scope: z.enum(["global", "project"]),
  project_key: z.string().nullable(),
  type: z.enum(["rule", "fact", "episode", "consolidated"]),
  content: z.string(),
  pinned: z.union([z.literal(0), z.literal(1)]),
  source: z.enum(["user_explicit", "tool_output", "auto_inferred", "cron_consolidated", "cerebrum_import", "external"]),
  trust_score: z.number(),
  tags: z.string().nullable(),
  created_at: epochMs,
  updated_at: epochMs,
}).strict();

const exportSchema = z.object({
  version: z.literal("0.7"),
  exported_at: z.number().int(),
  memories: z.array(rowSchema),
}).strict();

/**
 * Issue #418: the supported read query. A new contract (version 1) rather than an export change, so the
 * panel runs one process per request instead of two full exports. `score` is null on a plain list and
 * present whenever retrieval ran.
 */
const scoreSchema = z.object({
  fused: z.number(),
  fts: z.number(),
  jaccard: z.number(),
  semantic: z.number(),
}).strict();

const readRowSchema = z.object({
  ...rowSchema.shape,
  score: scoreSchema.nullable(),
}).strict();

const listSchema = z.object({
  version: z.literal(1),
  query: z.string().nullable(),
  scope: z.string(),
  project_key: z.string().nullable(),
  total: z.number().int().nonnegative(),
  memories: z.array(readRowSchema),
}).strict();

const showSchema = z.object({
  version: z.literal(1),
  project_key: z.string().nullable(),
  memory: readRowSchema.nullable(),
}).strict();

type CcmemRow = z.infer<typeof rowSchema>;
type ReadRow = z.infer<typeof readRowSchema>;
export type CcmemScope = "global" | "project";
export type CcmemScore = z.infer<typeof scoreSchema>;

export interface CcmemScoredRecord {
  readonly record: MemoryRecord;
  readonly score: CcmemScore | null;
}

export interface CcmemList {
  readonly query: string | null;
  readonly total: number;
  readonly rows: CcmemScoredRecord[];
}

/** One `ccmem export --json --scope <scope>` stdout, checked and mapped. Throws ccmem-output-invalid naming the first problem. */
export function parseCcmemExport(stdout: string, scope: CcmemScope): MemoryRecord[] {
  const invalid = (what: string): MemoryError => new MemoryError("ccmem-output-invalid", `ccmem export --scope ${scope}: ${what}`);
  let raw: unknown;
  try { raw = JSON.parse(stdout); } catch (err) { throw invalid(`stdout is not JSON (${(err as Error).message})`); }
  const parsed = exportSchema.safeParse(raw);
  if (!parsed.success) throw invalid(describeIssue(raw, parsed.error.issues[0]!));
  return parsed.data.memories.map((row) => {
    if (row.scope !== scope) throw invalid(`row id ${row.id}: asked for --scope ${scope}, got scope ${row.scope}`);
    return toRecord(row, invalid);
  });
}

/** One `ccmem list ... --json` stdout. Project rows must belong to the key ccmem resolved from the cwd. */
export function parseCcmemList(stdout: string): CcmemList {
  const invalid = (what: string): MemoryError => new MemoryError("ccmem-output-invalid", `ccmem list: ${what}`);
  let raw: unknown;
  try { raw = JSON.parse(stdout); } catch (err) { throw invalid(`stdout is not JSON (${(err as Error).message})`); }
  const parsed = listSchema.safeParse(raw);
  if (!parsed.success) throw invalid(describeIssue(raw, parsed.error.issues[0]!));
  const projectKey = parsed.data.project_key;
  return {
    query: parsed.data.query,
    total: parsed.data.total,
    rows: parsed.data.memories.map((row) => ({
      record: toRecord(row, invalid, projectKey),
      score: row.score,
    })),
  };
}

/** One `ccmem show <id> --json` stdout; null when ccmem does not expose that memory in this scope. */
export function parseCcmemShow(stdout: string): MemoryRecord | null {
  const invalid = (what: string): MemoryError => new MemoryError("ccmem-output-invalid", `ccmem show: ${what}`);
  let raw: unknown;
  try { raw = JSON.parse(stdout); } catch (err) { throw invalid(`stdout is not JSON (${(err as Error).message})`); }
  const parsed = showSchema.safeParse(raw);
  if (!parsed.success) throw invalid(describeIssue(raw, parsed.error.issues[0]!));
  if (parsed.data.memory === null) return null;
  return toRecord(parsed.data.memory, invalid, parsed.data.project_key);
}

function describeIssue(raw: unknown, issue: z.ZodIssue): string {
  const where = issue.path.length === 0 ? "<root>" : issue.path.join(".");
  const index = issue.path[0] === "memories" && typeof issue.path[1] === "number" ? issue.path[1] : null;
  const id = index === null ? undefined : (raw as { memories?: Array<{ id?: unknown }> }).memories?.[index]?.id;
  return `${where}${id === undefined ? "" : ` (row id ${String(id)})`}: ${issue.message}`;
}

function toRecord(row: ReadRow | CcmemRow, invalid: (what: string) => MemoryError, requestedProjectKey?: string | null): MemoryRecord {
  // ccmem does not validate --scope; a wrong value exports every project's rows (spec §3.1). This is the check that sees it.
  // The read query has no --scope, so its equivalent is the project_key ccmem resolved from the cwd.
  if (requestedProjectKey !== undefined && row.scope === "project" && (requestedProjectKey === null || row.project_key !== requestedProjectKey)) {
    throw invalid(`row id ${row.id}: project row belongs to ${JSON.stringify(row.project_key)}, not ${JSON.stringify(requestedProjectKey)}`);
  }
  if (row.scope === "project" && (row.project_key === null || row.project_key === "")) throw invalid(`row id ${row.id}: a project row without project_key`);
  return {
    ref: String(row.id),
    scope: row.scope,
    projectKey: row.project_key,
    kind: row.type,
    content: row.content,
    tags: parseTags(row, invalid),
    pinned: row.pinned === 1,
    source: row.source,
    trust: row.trust_score,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** ccmem stores tags as JSON text (`save.mjs`); old rows may be NULL. A bad value is refused, never read as [] (ccmem's import does that silently). */
function parseTags(row: ReadRow | CcmemRow, invalid: (what: string) => MemoryError): string[] {
  if (row.tags === null) return [];
  let value: unknown;
  try { value = JSON.parse(row.tags); } catch { throw invalid(`row id ${row.id}: tags is not JSON`); }
  if (!Array.isArray(value) || !value.every((tag) => typeof tag === "string")) throw invalid(`row id ${row.id}: tags is not a JSON array of strings`);
  return value;
}
