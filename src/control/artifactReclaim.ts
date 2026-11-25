import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, rmSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { archivedMarkOf } from "./archivedMark.js";
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { runDirectories } from "./diskUsage.js";
import { basicSkip, GcRefusal, type GroupRow, type RunRow } from "./gc.js";
import { idSchema } from "./schema.js";
import type { ControlStore } from "./store.js";

/**
 * Tester #468 (spec 2026-11-24-artifact-reclamation-design.md, approach A; integrity spec's "Review and revisions"; human
 * ruling 2026-11-25, session 5d3d0c09: the panel deletes). `orca gc --include-artifacts` reclaims `<stateDir>/artifacts/<id>`
 * and its `artifacts` row, run-scoped: an artifact is eligible only when something retired names it and nothing live does.
 *
 * The reference scan is computed from the store and fails closed:
 *  - holders: EVERY column of EVERY table except the `artifacts` index itself is read as text, and every token that names
 *    an artifact counts -- the id, the row hash, a 64-hex piece of the id (`checkpoint-<hash>` is built from a hash at
 *    read time), and a run or group id the artifact id embeds (`acceptance-<runId>` is built from the run id). A holder
 *    is retired only when its owner (a run, a group, a flow's group: ARTIFACT_HOLDER_TABLES) is; a table the map does not
 *    know, an owner that does not resolve, an undelivered outbox row and every global table hold for good.
 *  - transitive: artifacts name artifacts (snapshot trees, capsules, packets, manifests). The contents of every held
 *    artifact are read and tokenized the same way -- no parse, so content that is not JSON still holds what it names. A
 *    held artifact whose contents cannot be read (anything but "the bytes are gone") stops the whole plan:
 *    `reference-scan-incomplete`, nothing is removed.
 *  - tokens are matched at separator boundaries (`-`, `_`, `.`, or any character an id cannot hold), never inside a run
 *    of letters and digits: a reader that built an id by gluing it to other letters would not be seen. None does today.
 *
 * Deletion is the panel's (applyArtifactReclaim): in one synchronous step under its admission gate it re-plans from the
 * store, skips every id this panel process has published or re-published since it started (an in-flight writer may hold
 * that ref only in memory), removes each directory and then deletes the rows in one transaction. A crash between the two
 * leaves rows whose data is gone -- the state #469's reads already degrade around and its write path repairs.
 */

const DAY_MS = 86_400_000;
const MAX_ID = 200;
const HEX64 = /^[a-f0-9]{64}$/;

/** Who owns a holder row: the first non-null owner column decides; with `all`, every non-null one must be retired. */
type Owner = { kind: "run" | "group" | "flow"; column: string };
export type HolderTable =
  | { kind: "artifact-index"; columns: readonly string[] }
  | { kind: "global"; columns: readonly string[] }
  | { kind: "owned"; owners: readonly Owner[]; all?: boolean; columns: readonly string[] }
  | { kind: "outbox"; columns: readonly string[] };

const run = (column: string): Owner => ({ kind: "run", column });
const group = (column: string): Owner => ({ kind: "group", column });
const flow = (column: string): Owner => ({ kind: "flow", column });

/**
 * Every table of the control store and the columns it has, classified by who owns a row (the structural criterion compares
 * this with a fresh store's sqlite_master and goes red on a table or column that is not here). At run time a table that is
 * not here is still scanned, as a global holder -- it holds what it names for good.
 */
export const ARTIFACT_HOLDER_TABLES: Readonly<Record<string, HolderTable>> = {
  artifacts: { kind: "artifact-index", columns: ["id", "hash", "body"] },
  activity: { kind: "owned", owners: [run("run_id"), group("group_id")], columns: ["seq", "group_id", "task_id", "run_id", "at", "kind", "body"] },
  agent_preferences: { kind: "global", columns: ["operator_id", "revision", "doc_json"] },
  agent_update_outbox: { kind: "global", columns: ["operator_id", "command_id", "raw_hash", "raw_command_json", "request_json", "principal", "client", "state", "receipt_json"] },
  agent_update_state: { kind: "global", columns: ["operator_id", "revision"] },
  attempt_evidence: { kind: "owned", owners: [run("run_id")], columns: ["run_id", "generation", "phase", "provider_attempt_ordinal", "kind", "body"] },
  base_check_results: { kind: "owned", owners: [run("run_id"), group("group_id")], columns: ["repo_id", "base", "command", "result", "tail", "why", "group_id", "task_id", "run_id", "requested_at", "at", "attempts"] },
  budget_proposals: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "proposal_version", "body"] },
  check_state: { kind: "global", columns: ["repo_id", "kind", "target", "body"] },
  checkpoints: { kind: "owned", owners: [run("run_id")], columns: ["id", "run_id", "hash", "body"] },
  commands: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "id", "payload_hash", "result", "ledger_version", "scope_kind", "scope_id", "actor_id", "verb", "target_json", "expected_revision", "raw_request_json", "raw_request_hash", "effective_payload_json", "effective_payload_hash", "authority_command_json", "authority_command_hash", "original_status", "body_json", "response_bytes", "command_revision", "projection_seq", "client", "principal", "person_principal"] },
  context_latches: { kind: "owned", owners: [run("run_id")], columns: ["run_id", "generation", "reason", "request_id"] },
  context_observations: { kind: "owned", owners: [run("run_id")], columns: ["run_id", "generation", "sequence", "body"] },
  effect_records: { kind: "owned", owners: [flow("flow_run_id")], columns: ["id", "flow_run_id", "step_key", "seq", "effect_kind", "class", "level", "policy", "state", "payload_hash", "remote_ref", "by", "via", "created_at", "updated_at"] },
  estimates: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "id", "estimate_version", "state", "body"] },
  execution_snapshots: { kind: "owned", owners: [group("group_id")], columns: ["hash", "group_id", "body"] },
  flagged_decisions: { kind: "owned", owners: [run("run_id"), group("group_id")], columns: ["decision_id", "group_id", "run_id", "source", "state", "body"] },
  flow_decisions: { kind: "owned", owners: [flow("flow_run_id")], columns: ["flow_run_id", "seq", "grade", "step_key", "body", "by"] },
  flow_feedback: { kind: "owned", owners: [flow("flow_run_id")], columns: ["flow_run_id", "message_seq", "state", "body", "updated_at"] },
  flow_messages: { kind: "owned", owners: [flow("flow_run_id")], columns: ["flow_run_id", "seq", "request_id", "kind", "target", "body", "by", "via", "state", "reason", "at"] },
  flow_runs: { kind: "owned", owners: [group("group_id")], columns: ["id", "group_id", "template_ref", "template_sha256", "workspace", "vault_id", "params_sha256", "pool_tokens", "pool_drawn", "state", "revision", "body"] },
  flow_templates: { kind: "global", columns: ["layer", "id", "version", "sha256", "path", "published_by", "published_at"] },
  funded_allowances: { kind: "owned", owners: [run("run_id")], columns: ["run_id", "group_id", "work_item_id", "body"] },
  group_edges: { kind: "owned", owners: [group("from_group"), group("to_group")], all: true, columns: ["from_group", "to_group", "body"] },
  group_orchestration: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "body"] },
  groups: { kind: "owned", owners: [group("id")], columns: ["id", "revision", "graph_version", "body", "projection_seq"] },
  handoff_request_joins: { kind: "global", columns: ["request_id", "joined_request_id", "body"] },
  handoff_requests: { kind: "owned", owners: [run("run_id")], columns: ["id", "group_id", "run_id", "state", "body"] },
  meta: { kind: "global", columns: ["key", "value"] },
  orchestration_settings: { kind: "global", columns: ["singleton", "revision", "body"] },
  outbox: { kind: "outbox", columns: ["id", "kind", "body", "delivered"] },
  pending_decisions: { kind: "owned", owners: [run("run_id"), group("group_id")], columns: ["id", "group_id", "run_id", "ledger_run", "entry_index", "state", "body"] },
  plan_library: { kind: "global", columns: ["id", "project_id", "name", "state", "body"] },
  plan_library_versions: { kind: "global", columns: ["entry_id", "version", "sha256", "doc", "origin", "by", "via", "at"] },
  projection_journal: { kind: "owned", owners: [group("group_id")], columns: ["change_seq", "group_id", "projection_seq"] },
  projection_state: { kind: "global", columns: ["singleton", "change_seq", "oldest_retained_seq"] },
  recovery_blockers: { kind: "owned", owners: [run("run_id"), group("group_id")], columns: ["id", "group_id", "run_id", "scope", "code", "body"] },
  repository_settings: { kind: "global", columns: ["repo_id", "body"] },
  requirement_drafts: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "draft_no", "state", "body"] },
  requirement_rounds: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "step_key", "exec_seq", "round_no", "state", "body"] },
  rerun_plans: { kind: "owned", owners: [flow("flow_run_id")], columns: ["flow_run_id", "plan_no", "state", "candidates", "proposal", "chosen", "by", "via"] },
  runs: { kind: "owned", owners: [run("id")], columns: ["id", "group_id", "work_item_id", "generation", "active", "body"] },
  schedule_fires: { kind: "owned", owners: [flow("flow_run_id"), group("group_id")], columns: ["schedule_id", "seq", "slot", "at", "outcome", "reason", "flow_run_id", "group_id", "by", "via", "body"] },
  scheduler_wakes: { kind: "owned", owners: [group("group_id")], columns: ["id", "group_id", "kind", "body", "delivered"] },
  schedules: { kind: "global", columns: ["id", "project_id", "kind", "revision", "removed", "body"] },
  spend_cap_blocks: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "body"] },
  spend_caps: { kind: "global", columns: ["scope", "period", "tokens", "updated_at", "updated_by"] },
  spend_settings: { kind: "global", columns: ["singleton", "revision"] },
  sqlite_sequence: { kind: "global", columns: ["name", "seq"] },
  step_executions: { kind: "owned", owners: [flow("flow_run_id")], columns: ["flow_run_id", "step_key", "seq", "kind", "kind_version", "state", "definition_hash", "base_commit", "ran_on", "fingerprint", "output_kind", "output_ref", "output_hash", "read_set_hash", "reasons", "plan_no", "child_group_id", "by", "via", "created_at", "updated_at", "body"] },
  step_heads: { kind: "owned", owners: [flow("flow_run_id")], columns: ["flow_run_id", "step_key", "active_seq"] },
  stop_intents: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "mode", "revision", "body"] },
  token_policies: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "work_item_id", "mode", "tokens"] },
  usage_calendar: { kind: "global", columns: ["singleton", "time_zone", "week_start"] },
  usage_events: { kind: "owned", owners: [run("run_id")], columns: ["run_id", "seq", "payload_hash", "body"] },
  usage_ledger: { kind: "owned", owners: [run("run_id"), group("group_id")], columns: ["id", "applied_at", "group_id", "repo_id", "run_id", "source", "model", "input", "output", "cache_read", "cache_write", "tokens", "quality", "reasoning", "cache_write_5m", "cache_write_1h", "requests", "max_request_input", "phase", "task_id", "agent_kind", "installation_id", "basis"] },
  work_grant_top_ups: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "work_item_id", "from_run_id", "body"] },
  work_items: { kind: "owned", owners: [group("group_id")], columns: ["group_id", "id", "target_version", "body"] },
};

export interface ArtifactReclaimOptions {
  /** Default 30: a run that ended, or a group archived, at or after `now - days` keeps what it names. */
  olderThanDays?: number;
  /** The newest N runs keep what they name whatever their age (0: none). */
  keepLast?: number;
  /** As `orca gc --include-uncleaned`: a run whose driver never wrote `cleanedUp` may retire. */
  includeUncleaned?: boolean;
  /** Only what this group's holders retire is planned; every other holder counts as live. */
  groupId?: string;
  /** The clock, ms since the epoch (tests). */
  now?: number;
}

export interface ArtifactItem { artifactId: string; bytes: number; dataMissing?: true }
export interface ArtifactSkip { artifactId: string; reason: string; bytes: number; groupId?: string; detail?: string }
export interface ArtifactSkipReason { reason: string; count: number; groups: number; bytes: number }
export interface ArtifactReclaimResult {
  dryRun: boolean;
  planned: ArtifactItem[];
  removed: ArtifactItem[];
  skipped: ArtifactSkip[];
  /** `skipped` grouped by reason with the bytes each reason holds, largest first: what keeps the space and why. */
  skippedByReason: ArtifactSkipReason[];
  /** Bytes the plan would free (dry run) or that were freed. */
  bytes: number;
  /** Bytes every skip holds together. */
  heldBytes: number;
  scan: {
    artifacts: number;
    holderRows: number;
    contentsRead: number;
    /** Tables the classification does not know (scanned as global holders) and columns it does not list. */
    unclassified: string[];
    /** The held artifact whose contents could not be read; non-null means nothing was planned. */
    incomplete: string | null;
  };
}

/** What one artifact's contents name: the matched index keys, or why they could not be read. */
export type ContentScan = { keys: readonly string[] } | { missing: true } | { unreadable: string };

export interface CachedContent { hash: string; scan: ContentScan }

/** Why a holder keeps what it names (null: retired, so what it names may go). */
interface Hold { reason: string; groupId?: string; detail?: string }

const SEP = new Set([45, 46, 95]); // - . _
const alnum = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const TOKEN = /[A-Za-z0-9_.-]+/g;

/** Every substring of `token` that starts on a letter or digit and is bounded by the token's edges or a separator. */
function boundedPieces(token: string, visit: (piece: string) => void): void {
  const starts: number[] = [];
  const ends = new Set<number>([token.length]);
  if (alnum(token.charCodeAt(0))) starts.push(0);
  for (let i = 0; i < token.length; i += 1) {
    if (!SEP.has(token.charCodeAt(i))) continue;
    ends.add(i); ends.add(i + 1);
    if (i + 1 < token.length && alnum(token.charCodeAt(i + 1))) starts.push(i + 1);
  }
  const sortedEnds = [...ends].sort((a, b) => a - b);
  for (const start of starts) {
    for (const end of sortedEnds) {
      if (end <= start) continue;
      if (end - start > MAX_ID + 64) break;
      visit(token.slice(start, end));
    }
  }
}

/** The index keys `text` names (see the header: separator-bounded tokens only). */
export function keysIn(text: string, index: { has(key: string): boolean }, out: Set<string>): void {
  for (const match of text.matchAll(TOKEN)) boundedPieces(match[0], (piece) => { if (index.has(piece)) out.add(piece); });
}

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("latin1");
  return null;
}

function parseBody(text: unknown): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(String(text)) as unknown;
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

/** The store's artifacts, runs, groups and flows, and the key index built from them. */
export interface Universe {
  artifacts: Map<string, { hash: string }>;
  runs: Map<string, RunRow>;
  groups: Map<string, GroupRow>;
  flowGroup: Map<string, string>;
  /**
   * index key -> the artifact ids it names: the id, the row hash, a 64-hex piece of the id, and a run or group id the id
   * embeds (a reader builds `acceptance-<runId>` from the run id; that run's own row names its id, so it holds them).
   */
  index: Map<string, string[]>;
}

function tableNames(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: unknown }>).map((row) => String(row.name));
}

export function readUniverse(db: DatabaseSync): Universe {
  const tables = new Set(tableNames(db));
  const artifacts = new Map<string, { hash: string }>();
  for (const row of db.prepare("SELECT id, hash FROM artifacts").all() as Array<{ id: unknown; hash: unknown }>) artifacts.set(String(row.id), { hash: String(row.hash) });
  const runs = new Map<string, RunRow>();
  for (const row of db.prepare("SELECT id, group_id, active, body FROM runs").all() as Array<{ id: unknown; group_id: unknown; active: unknown; body: unknown }>) {
    runs.set(String(row.id), { groupId: String(row.group_id), active: Number(row.active) === 1, body: parseBody(row.body) ?? {} });
  }
  const groups = new Map<string, GroupRow>();
  for (const row of db.prepare("SELECT id, body FROM groups").all() as Array<{ id: unknown; body: unknown }>) {
    // A body that does not parse keeps the group live: its mark cannot be read (groupRetirement's `invalid`).
    const body = parseBody(row.body);
    groups.set(String(row.id), { body: body ?? { archived: "unreadable" } });
  }
  const flowGroup = new Map<string, string>();
  if (tables.has("flow_runs")) for (const row of db.prepare("SELECT id, group_id FROM flow_runs").all() as Array<{ id: unknown; group_id: unknown }>) flowGroup.set(String(row.id), String(row.group_id));

  const index = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    const list = index.get(key);
    if (list === undefined) index.set(key, [id]);
    else if (!list.includes(id)) list.push(id);
  };
  for (const [id, { hash }] of artifacts) {
    add(id, id);
    if (hash.length > 0) add(hash, id);
    boundedPieces(id, (piece) => {
      if (piece === id) return;
      if (HEX64.test(piece)) add(piece, id);
      if (runs.has(piece) || groups.has(piece)) add(piece, id);
    });
  }
  return { artifacts, runs, groups, flowGroup, index };
}

/** Reads one artifact's contents and resolves what they name. Never follows a symbolic link. */
export function scanContentSync(stateDir: string, id: string, index: { has(key: string): boolean }): ContentScan {
  if (!idSchema.safeParse(id).success) return { unreadable: "id-invalid" };
  const dir = join(stateDir, "artifacts", id);
  try {
    const stat = lstatSync(dir);
    if (!stat.isDirectory()) return { unreadable: stat.isSymbolicLink() ? "directory-symlink" : "not-a-directory" };
    const data = lstatSync(join(dir, "data"));
    if (!data.isFile()) return { unreadable: data.isSymbolicLink() ? "data-symlink" : "data-not-regular" };
    const fd = openSync(join(dir, "data"), constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try { if (!fstatSync(fd).isFile()) return { unreadable: "data-not-regular" }; bytes = readFileSync(fd); }
    finally { closeSync(fd); }
    const keys = new Set<string>();
    keysIn(bytes.toString("latin1"), index, keys);
    return { keys: [...keys] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { missing: true };
    return { unreadable: (error as NodeJS.ErrnoException).code ?? (error as Error).message };
  }
}

/** The same read without blocking: the panel scans every artifact this way before its synchronous re-plan. */
export async function scanContent(stateDir: string, id: string, index: { has(key: string): boolean }): Promise<ContentScan> {
  if (!idSchema.safeParse(id).success) return { unreadable: "id-invalid" };
  const dir = join(stateDir, "artifacts", id);
  try {
    const stat = await lstat(dir);
    if (!stat.isDirectory()) return { unreadable: stat.isSymbolicLink() ? "directory-symlink" : "not-a-directory" };
    const data = await lstat(join(dir, "data"));
    if (!data.isFile()) return { unreadable: data.isSymbolicLink() ? "data-symlink" : "data-not-regular" };
    const handle = await open(join(dir, "data"), constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try { if (!(await handle.stat()).isFile()) return { unreadable: "data-not-regular" }; bytes = await handle.readFile(); }
    finally { await handle.close(); }
    const keys = new Set<string>();
    keysIn(bytes.toString("latin1"), index, keys);
    return { keys: [...keys] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { missing: true };
    return { unreadable: (error as NodeJS.ErrnoException).code ?? (error as Error).message };
  }
}

export interface ArtifactPlanInput extends ArtifactReclaimOptions {
  db: DatabaseSync;
  stateDir: string;
  /** Ids this panel process has published since it started: always live (published-since-panel-start). */
  pinned?: ReadonlySet<string>;
  /** Contents already read (immutable per id+hash); what is missing here is read synchronously. */
  contents?: ReadonlyMap<string, CachedContent>;
  /** A run's directory mtime, for a run with no `endedAt` (gc's own fallback). */
  runTouched?: ReadonlyMap<string, number>;
}

export interface ArtifactPlan {
  planned: ArtifactItem[];
  skipped: ArtifactSkip[];
  hashes: Map<string, string>;
  scan: ArtifactReclaimResult["scan"];
}

function dataBytes(stateDir: string, id: string): { bytes: number; missing: boolean; unsafe: string | null } {
  if (!idSchema.safeParse(id).success) return { bytes: 0, missing: false, unsafe: "id-invalid" };
  const dir = join(stateDir, "artifacts", id);
  try {
    const stat = lstatSync(dir);
    if (!stat.isDirectory()) return { bytes: 0, missing: false, unsafe: stat.isSymbolicLink() ? "directory-symlink" : "not-a-directory" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bytes: 0, missing: true, unsafe: null };
    return { bytes: 0, missing: false, unsafe: (error as NodeJS.ErrnoException).code ?? "unreadable" };
  }
  try {
    const data = lstatSync(join(dir, "data"));
    if (!data.isFile()) return { bytes: 0, missing: false, unsafe: data.isSymbolicLink() ? "data-symlink" : "data-not-regular" };
    return { bytes: data.size, missing: false, unsafe: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { bytes: 0, missing: true, unsafe: null };
    return { bytes: 0, missing: false, unsafe: (error as NodeJS.ErrnoException).code ?? "unreadable" };
  }
}

/**
 * The plan, synchronously, from the store as it is now. Pure reads: the CLI's dry run calls it on a read-only connection,
 * the panel inside its admission gate right before it deletes.
 */
export function planArtifactReclaim(input: ArtifactPlanInput): ArtifactPlan {
  const now = input.now ?? Date.now();
  const cutoff = now - (input.olderThanDays ?? 30) * DAY_MS;
  const keepLast = Math.max(0, input.keepLast ?? 0);
  const { db, stateDir } = input;
  const u = readUniverse(db);

  // --- who is retired -------------------------------------------------------------------------------------------
  const groupHold = new Map<string, Hold | null>();
  const markAt = (groupId: string): number | null => {
    try { return archivedMarkOf(u.groups.get(groupId)?.body)?.at ?? null; } catch { return null; }
  };
  const runBasic = new Map<string, Hold | null>();
  const touched = new Map<string, number>();
  for (const [runId, row] of u.runs) {
    const group = u.groups.get(row.groupId);
    const skip = basicSkip(row, group, input.includeUncleaned === true);
    if (skip !== undefined) { runBasic.set(runId, { reason: skip.reason, groupId: row.groupId, ...(skip.detail === undefined ? {} : { detail: skip.detail }) }); continue; }
    const endedAt = typeof row.body.endedAt === "number" && Number.isFinite(row.body.endedAt) ? row.body.endedAt : null;
    const at = endedAt ?? input.runTouched?.get(runId) ?? null;
    if (at === null) { runBasic.set(runId, { reason: "run-age-unknown", groupId: row.groupId }); continue; }
    touched.set(runId, at);
    runBasic.set(runId, null);
  }
  const kept = new Set([...touched.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, keepLast).map(([runId]) => runId));
  const runHold = new Map<string, Hold | null>();
  for (const [runId, row] of u.runs) {
    const basic = runBasic.get(runId)!;
    if (basic !== null) { runHold.set(runId, basic); continue; }
    if (kept.has(runId)) { runHold.set(runId, { reason: "keep-last", groupId: row.groupId }); continue; }
    if (touched.get(runId)! >= cutoff) { runHold.set(runId, { reason: "too-recent", groupId: row.groupId }); continue; }
    const at = markAt(row.groupId);
    if (at === null || at >= cutoff) { runHold.set(runId, { reason: "group-archived-recently", groupId: row.groupId }); continue; }
    runHold.set(runId, null);
  }
  const runsOfGroup = new Map<string, string[]>();
  for (const [runId, row] of u.runs) runsOfGroup.set(row.groupId, [...(runsOfGroup.get(row.groupId) ?? []), runId]);
  for (const [groupId, row] of u.groups) {
    let terminal: "yes" | "no" | "invalid";
    try { terminal = archivedMarkOf(row.body) === null ? "no" : "yes"; } catch { terminal = "invalid"; }
    if (terminal === "no") { groupHold.set(groupId, { reason: "group-not-archived", groupId }); continue; }
    if (terminal === "invalid") { groupHold.set(groupId, { reason: "group-archived-invalid", groupId }); continue; }
    const at = markAt(groupId);
    if (at === null || at >= cutoff) { groupHold.set(groupId, { reason: "group-archived-recently", groupId }); continue; }
    const held = (runsOfGroup.get(groupId) ?? []).map((runId) => runHold.get(runId)).find((hold) => hold !== null && hold !== undefined);
    groupHold.set(groupId, held === undefined ? null : { ...held, groupId });
  }
  const scoped = (hold: Hold | null, groupId: string | undefined): Hold | null => {
    if (hold !== null || input.groupId === undefined || groupId === input.groupId) return hold;
    return { reason: "outside-group", ...(groupId === undefined ? {} : { groupId }) };
  };
  const ofRun = (runId: string): Hold | null => {
    const row = u.runs.get(runId);
    if (row === undefined) return { reason: "holder-run-unknown", detail: runId };
    return scoped(runHold.get(runId)!, row.groupId);
  };
  const ofGroup = (groupId: string): Hold | null => {
    if (!u.groups.has(groupId)) return { reason: "holder-group-unknown", detail: groupId };
    return scoped(groupHold.get(groupId)!, groupId);
  };
  const ofOwner = (owner: Owner, value: string): Hold | null => {
    if (owner.kind === "run") return ofRun(value);
    if (owner.kind === "group") return ofGroup(value);
    const groupId = u.flowGroup.get(value);
    return groupId === undefined ? { reason: "holder-flow-unknown", detail: value } : ofGroup(groupId);
  };

  // --- roots: every holder row ------------------------------------------------------------------------------------
  const live = new Map<string, Hold>();
  const retired = new Set<string>();
  const queue: string[] = [];
  const hold = (key: string, by: Hold | null) => {
    for (const id of u.index.get(key) ?? []) {
      if (by === null) { retired.add(id); continue; }
      if (!live.has(id)) { live.set(id, by); queue.push(id); }
    }
  };
  for (const id of input.pinned ?? []) if (u.artifacts.has(id) && !live.has(id)) { live.set(id, { reason: "published-since-panel-start" }); queue.push(id); }

  const unclassified: string[] = [];
  let holderRows = 0;
  for (const table of tableNames(db)) {
    const spec = ARTIFACT_HOLDER_TABLES[table];
    if (spec?.kind === "artifact-index") continue;
    if (spec === undefined) unclassified.push(table);
    const quoted = `"${table.replaceAll('"', '""')}"`;
    const statement = db.prepare(`SELECT * FROM ${quoted}`);
    let checkedColumns = false;
    for (const raw of statement.iterate() as Iterable<Record<string, unknown>>) {
      holderRows += 1;
      if (!checkedColumns && spec !== undefined) {
        checkedColumns = true;
        for (const column of Object.keys(raw)) if (!spec.columns.includes(column)) unclassified.push(`${table}.${column}`);
      }
      let by: Hold | null;
      if (spec === undefined || spec.kind === "global") by = { reason: `held-by:${table}` };
      else if (spec.kind === "outbox") by = outboxHold(raw, u, ofRun, ofGroup);
      else by = ownedHold(spec, raw, ofOwner, table);
      const keys = new Set<string>();
      for (const value of Object.values(raw)) {
        const text = textOf(value);
        if (text !== null) keysIn(text, u.index, keys);
      }
      for (const key of keys) hold(key, by);
    }
  }

  // --- transitive, through contents --------------------------------------------------------------------------------
  let contentsRead = 0;
  const contentOf = (id: string): ContentScan => {
    // Only a read that found the bytes is reused, and only for the same row hash: a missing or unreadable one is read
    // again (a publish since may have restored it), and so is anything this process published since (pinned).
    const cached = input.contents?.get(id);
    if (cached !== undefined && cached.hash === u.artifacts.get(id)?.hash && "keys" in cached.scan && !(input.pinned?.has(id) ?? false)) return cached.scan;
    contentsRead += 1;
    return scanContentSync(stateDir, id, u.index);
  };
  let incomplete: string | null = null;
  for (let next = 0; next < queue.length; next += 1) {
    const id = queue[next]!;
    const by = live.get(id)!;
    const content = contentOf(id);
    if ("unreadable" in content) { incomplete ??= `${id} (${content.unreadable})`; continue; }
    if ("missing" in content) continue; // the bytes are gone: no reader can reach through them
    for (const key of content.keys) {
      for (const child of u.index.get(key) ?? []) {
        if (!live.has(child)) { live.set(child, { reason: by.reason, ...(by.groupId === undefined ? {} : { groupId: by.groupId }), detail: `named by ${id}` }); queue.push(child); }
      }
    }
  }
  const retiredQueue = [...retired].filter((id) => !live.has(id));
  const reached = new Set(retiredQueue);
  for (let next = 0; next < retiredQueue.length; next += 1) {
    const id = retiredQueue[next]!;
    const content = contentOf(id);
    if (!("keys" in content)) continue; // its children stay unreached: kept as unreferenced, never deleted on a guess
    for (const key of content.keys) for (const child of u.index.get(key) ?? []) {
      if (live.has(child) || reached.has(child)) continue;
      reached.add(child); retiredQueue.push(child);
    }
  }

  // --- classify every row ------------------------------------------------------------------------------------------
  const planned: ArtifactItem[] = [];
  const skipped: ArtifactSkip[] = [];
  const hashes = new Map<string, string>();
  for (const [id, { hash }] of [...u.artifacts].sort((a, b) => a[0].localeCompare(b[0]))) {
    const size = dataBytes(stateDir, id);
    const by = live.get(id);
    if (by !== undefined) { skipped.push({ artifactId: id, bytes: size.bytes, ...by }); continue; }
    if (!reached.has(id)) { skipped.push({ artifactId: id, bytes: size.bytes, reason: "unreferenced" }); continue; }
    if (incomplete !== null) { skipped.push({ artifactId: id, bytes: size.bytes, reason: "reference-scan-incomplete", detail: incomplete }); continue; }
    if (size.unsafe !== null) { skipped.push({ artifactId: id, bytes: size.bytes, reason: "artifact-path-unsafe", detail: size.unsafe }); continue; }
    planned.push({ artifactId: id, bytes: size.bytes, ...(size.missing ? { dataMissing: true as const } : {}) });
    hashes.set(id, hash);
  }
  return { planned, skipped, hashes, scan: { artifacts: u.artifacts.size, holderRows, contentsRead, unclassified, incomplete } };
}

function ownedHold(spec: Extract<HolderTable, { kind: "owned" }>, row: Record<string, unknown>, ofOwner: (owner: Owner, value: string) => Hold | null, table: string): Hold | null {
  const present = spec.owners.filter((owner) => typeof row[owner.column] === "string" && row[owner.column] !== "");
  if (present.length === 0) return { reason: `held-by:${table}` };
  if (!spec.all) return ofOwner(present[0]!, String(row[present[0]!.column]));
  for (const owner of present) {
    const by = ofOwner(owner, String(row[owner.column]));
    if (by !== null) return by;
  }
  return null;
}

/**
 * An outbox row holds until delivered; then its owner is the run or group its body names, else the run or group its
 * `kind:<id>:…` key names (a report row's body is only `{source}`), else nobody -- held for good.
 */
function outboxHold(row: Record<string, unknown>, u: Universe, ofRun: (runId: string) => Hold | null, ofGroup: (groupId: string) => Hold | null): Hold | null {
  if (Number(row.delivered) !== 1) return { reason: "outbox-undelivered" };
  const body = parseBody(row.body);
  if (typeof body?.runId === "string") return ofRun(body.runId);
  if (typeof body?.groupId === "string") return ofGroup(body.groupId);
  for (const segment of String(row.id).split(":")) {
    if (u.runs.has(segment)) return ofRun(segment);
    if (u.groups.has(segment)) return ofGroup(segment);
  }
  return { reason: "held-by:outbox" };
}

export function summarizeArtifactSkips(skipped: readonly ArtifactSkip[]): ArtifactSkipReason[] {
  const reasons = new Map<string, { count: number; groups: Set<string>; bytes: number }>();
  for (const skip of skipped) {
    const entry = reasons.get(skip.reason) ?? { count: 0, groups: new Set<string>(), bytes: 0 };
    entry.count += 1;
    entry.bytes += skip.bytes;
    if (skip.groupId !== undefined && skip.groupId !== "") entry.groups.add(skip.groupId);
    reasons.set(skip.reason, entry);
  }
  return [...reasons.entries()]
    .map(([reason, entry]) => ({ reason, count: entry.count, groups: entry.groups.size, bytes: entry.bytes }))
    .sort((a, b) => b.bytes - a.bytes || b.count - a.count || a.reason.localeCompare(b.reason));
}

function resultOf(plan: ArtifactPlan, dryRun: boolean, removed: ArtifactItem[], extraSkips: ArtifactSkip[] = []): ArtifactReclaimResult {
  const skipped = [...plan.skipped, ...extraSkips];
  const bytes = (dryRun ? plan.planned : removed).reduce((sum, item) => sum + item.bytes, 0);
  return { dryRun, planned: plan.planned, removed, skipped, skippedByReason: summarizeArtifactSkips(skipped), bytes, heldBytes: skipped.reduce((sum, skip) => sum + skip.bytes, 0), scan: plan.scan };
}

/** The CLI's dry run: a plan, nothing removed. */
export function dryRunArtifactReclaim(input: ArtifactPlanInput): ArtifactReclaimResult {
  return resultOf(planArtifactReclaim(input), true, []);
}

/**
 * The CLI's dry run on the store at `stateDir`, opened read-only with gc's busy timeout (the panel may be writing). Reads
 * only: nothing under `artifacts/` and no row is touched.
 */
export async function dryRunArtifactsAt(stateDirPath: string, options: ArtifactReclaimOptions): Promise<ArtifactReclaimResult> {
  let stateDir: string;
  try { stateDir = realpathSync(stateDirPath); }
  catch (error) { throw new GcRefusal("control-state-dir-missing", `${stateDirPath}: ${(error as Error).message}`); }
  const dbPath = join(stateDir, "control.sqlite");
  if (!existsSync(dbPath)) throw new GcRefusal("control-store-missing", `no control store at ${dbPath}; is the panel installed?`);
  const runTouched = new Map<string, number>();
  for (const root of [`${stateDir}.runs`, `${stateDir}.workspaces`]) for (const dir of await runDirectories(root)) runTouched.set(dir.name, Math.max(runTouched.get(dir.name) ?? 0, dir.mtimeMs));
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  let db: DatabaseSync;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); }
  catch (error) { throw new GcRefusal("control-store-unreadable", `${dbPath}: ${(error as Error).message}`); }
  try {
    db.exec("PRAGMA busy_timeout=5000");
    return dryRunArtifactReclaim({ ...options, db, stateDir, runTouched });
  } catch (error) {
    if (error instanceof GcRefusal) throw error;
    throw new GcRefusal("control-store-unreadable", `${dbPath}: ${(error as Error).message}`);
  } finally { db.close(); }
}

/**
 * The panel's half, called inside its admission gate: re-plan from the store as it is now (synchronously, so no write of
 * this process interleaves), then remove each planned directory and, after them, its row. A directory that does not go is
 * a skip and keeps its row.
 */
export function applyArtifactReclaim(store: ControlStore, input: Omit<ArtifactPlanInput, "db" | "stateDir">): ArtifactReclaimResult {
  const plan = planArtifactReclaim({ ...input, db: store.db, stateDir: store.stateDir });
  const root = join(store.stateDir, "artifacts");
  const removed: ArtifactItem[] = [];
  const failed: ArtifactSkip[] = [];
  for (const item of plan.planned) {
    const dir = join(root, item.artifactId);
    if (dirname(dir) !== root) { failed.push({ artifactId: item.artifactId, bytes: item.bytes, reason: "artifact-path-unsafe", detail: "not a direct child of artifacts/" }); continue; }
    try { rmSync(dir, { recursive: true, force: true }); removed.push(item); }
    catch (error) { failed.push({ artifactId: item.artifactId, bytes: item.bytes, reason: "remove-failed", detail: (error as Error).message }); }
  }
  if (removed.length > 0) {
    store.transaction(() => {
      const statement = store.db.prepare("DELETE FROM artifacts WHERE id=? AND hash=?");
      for (const item of removed) statement.run(item.artifactId, plan.hashes.get(item.artifactId)!);
    });
  }
  return resultOf(plan, false, removed, failed);
}

/** The panel's pre-read, off the event loop's critical path: every artifact's contents, keyed as the store is now. */
export async function prescanArtifactContents(store: ControlStore): Promise<Map<string, CachedContent>> {
  const u = readUniverse(store.db);
  const contents = new Map<string, CachedContent>();
  for (const [id, { hash }] of u.artifacts) contents.set(id, { hash, scan: await scanContent(store.stateDir, id, u.index) });
  return contents;
}
