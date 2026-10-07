import type { DatabaseSync } from "node:sqlite";

export const schemaVersion = "8";
export const legacySchema = `CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE groups(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, graph_version INTEGER NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE work_items(group_id TEXT NOT NULL REFERENCES groups(id), id TEXT NOT NULL, target_version INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(group_id,id)) STRICT;
CREATE TABLE commands(group_id TEXT NOT NULL, id TEXT NOT NULL, payload_hash TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(group_id,id)) STRICT;
CREATE TABLE runs(id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), work_item_id TEXT NOT NULL, generation INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)), body TEXT NOT NULL) STRICT;
CREATE UNIQUE INDEX one_active_work ON runs(group_id,work_item_id) WHERE active=1;
CREATE TABLE usage_events(run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, payload_hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id,seq)) STRICT;
CREATE TABLE artifacts(id TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE checkpoints(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), hash TEXT NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE outbox(id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0) STRICT;
`;

export const schema1To2 = `ALTER TABLE groups ADD COLUMN projection_seq INTEGER NOT NULL DEFAULT 0 CHECK(projection_seq >= 0 AND projection_seq <= 9007199254740991);
ALTER TABLE commands ADD COLUMN ledger_version INTEGER;
ALTER TABLE commands ADD COLUMN scope_kind TEXT;
ALTER TABLE commands ADD COLUMN scope_id TEXT;
ALTER TABLE commands ADD COLUMN actor_id TEXT;
ALTER TABLE commands ADD COLUMN verb TEXT;
ALTER TABLE commands ADD COLUMN target_json TEXT;
ALTER TABLE commands ADD COLUMN expected_revision INTEGER;
ALTER TABLE commands ADD COLUMN raw_request_json TEXT;
ALTER TABLE commands ADD COLUMN raw_request_hash TEXT;
ALTER TABLE commands ADD COLUMN effective_payload_json TEXT;
ALTER TABLE commands ADD COLUMN effective_payload_hash TEXT;
ALTER TABLE commands ADD COLUMN authority_command_json TEXT;
ALTER TABLE commands ADD COLUMN authority_command_hash TEXT;
ALTER TABLE commands ADD COLUMN original_status INTEGER;
ALTER TABLE commands ADD COLUMN body_json TEXT;
ALTER TABLE commands ADD COLUMN response_bytes BLOB;
ALTER TABLE commands ADD COLUMN command_revision INTEGER;
ALTER TABLE commands ADD COLUMN projection_seq INTEGER;
CREATE INDEX commands_scope_lookup ON commands(scope_kind,scope_id,id);
CREATE TABLE projection_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1), change_seq INTEGER NOT NULL CHECK(change_seq >= 0 AND change_seq <= 9007199254740991), oldest_retained_seq INTEGER NOT NULL CHECK(oldest_retained_seq >= 0 AND oldest_retained_seq <= 9007199254740991)) STRICT;
CREATE TABLE projection_journal(change_seq INTEGER NOT NULL CHECK(change_seq > 0 AND change_seq <= 9007199254740991), group_id TEXT NOT NULL REFERENCES groups(id), projection_seq INTEGER NOT NULL CHECK(projection_seq > 0 AND projection_seq <= 9007199254740991), PRIMARY KEY(change_seq,group_id)) STRICT;
CREATE INDEX projection_journal_group ON projection_journal(group_id,change_seq);
CREATE TABLE budget_proposals(group_id TEXT PRIMARY KEY REFERENCES groups(id), proposal_version INTEGER NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE estimates(group_id TEXT NOT NULL REFERENCES groups(id), id TEXT NOT NULL, estimate_version INTEGER NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(group_id,id), UNIQUE(group_id,estimate_version)) STRICT;
CREATE TABLE execution_snapshots(hash TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), body TEXT NOT NULL) STRICT;
CREATE TABLE stop_intents(group_id TEXT PRIMARY KEY REFERENCES groups(id), mode TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE recovery_blockers(id TEXT PRIMARY KEY, group_id TEXT, run_id TEXT, scope TEXT NOT NULL, code TEXT NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE scheduler_wakes(id TEXT PRIMARY KEY, group_id TEXT, kind TEXT NOT NULL, body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0 CHECK(delivered IN (0,1))) STRICT;
CREATE TABLE handoff_requests(id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), run_id TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL) STRICT;
CREATE TABLE handoff_request_joins(request_id TEXT NOT NULL REFERENCES handoff_requests(id), joined_request_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(request_id,joined_request_id)) STRICT;
UPDATE groups SET projection_seq=1;
INSERT INTO projection_state(singleton,change_seq,oldest_retained_seq)
  SELECT 1, CASE WHEN EXISTS(SELECT 1 FROM groups) THEN 1 ELSE 0 END, CASE WHEN EXISTS(SELECT 1 FROM groups) THEN 1 ELSE 0 END;
INSERT INTO projection_journal(change_seq,group_id,projection_seq) SELECT 1,id,1 FROM groups;
`;

// One canonical record per evidence kind per (runId,generation,phase,providerAttemptOrdinal):
// a byte-identical repeat is idempotent, a divergent second record is contradictory evidence.
export const schema2To3 = `CREATE TABLE attempt_evidence(run_id TEXT NOT NULL REFERENCES runs(id), generation INTEGER NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('estimate','work','handoff')), provider_attempt_ordinal INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('proof-accepted','provider-start','no-start','adapter-terminal-observation','adapter-stop-proof')), body TEXT NOT NULL, PRIMARY KEY(run_id,generation,phase,provider_attempt_ordinal,kind)) STRICT;
CREATE TABLE context_observations(run_id TEXT NOT NULL REFERENCES runs(id), generation INTEGER NOT NULL, sequence INTEGER NOT NULL CHECK(sequence > 0), body TEXT NOT NULL, PRIMARY KEY(run_id,generation,sequence)) STRICT;
CREATE TABLE context_latches(run_id TEXT NOT NULL REFERENCES runs(id), generation INTEGER NOT NULL, reason TEXT NOT NULL CHECK(reason IN ('context-threshold-crossed','context-observation-gap')), request_id TEXT, PRIMARY KEY(run_id,generation)) STRICT;
`;

// Execution driver spec §3.2: the per-repository workspace mode. No row means "worktree".
export const schema3To4 = `CREATE TABLE repository_settings(repo_id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
`;

// Agent selection spec §6.2 layer 1: one preference document per operator, under its own revision.
export const schema4To5 = `CREATE TABLE agent_preferences(operator_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0 AND revision <= 9007199254740991), doc_json TEXT NOT NULL) STRICT;
`;

// N1 spec §4.2: a requirement's rounds and split drafts, each keyed by group_id like `estimates`. The state column mirrors
// the body's state (requirementRecords.ts checks both on every read). IF NOT EXISTS: the version-3/4 migration criteria of
// agentPreferences/workspaceSettings downgrade a current store by dropping only their own table, so the 5-to-6 step meets tables already there.
export const schema5To6 = `CREATE TABLE IF NOT EXISTS requirement_rounds(group_id TEXT NOT NULL REFERENCES groups(id), round_no INTEGER NOT NULL CHECK(round_no > 0 AND round_no <= 9007199254740991), state TEXT NOT NULL CHECK(state IN ('drafting','awaiting-answers','answered','interrupted','failed')), body TEXT NOT NULL, PRIMARY KEY(group_id,round_no)) STRICT;
CREATE TABLE IF NOT EXISTS requirement_drafts(group_id TEXT NOT NULL REFERENCES groups(id), draft_no INTEGER NOT NULL CHECK(draft_no > 0 AND draft_no <= 9007199254740991), state TEXT NOT NULL CHECK(state IN ('drafting','awaiting-review','accepted','rejected','invalid','interrupted','failed')), body TEXT NOT NULL, PRIMARY KEY(group_id,draft_no)) STRICT;
`;

// Agent entry spec §6: which client delivered a command (web, cli[:name], mcp[:name]); null for rows not from a route.
export const schema6To7 = `ALTER TABLE commands ADD COLUMN client TEXT;
`;

// Accounts spec §5.1, §5.2, §6.1, D3, D4, D5, D9: the principal that delivered a command, the usage ledger, caps, the
// calendar, the spend scope's revision and the spend-cap block of a deferred claim. Three parts so the upgrade can take each
// on its own terms (migrate7To8). IF NOT EXISTS for the reason schema5To6 gives.
export const schema7To8Principal = `ALTER TABLE commands ADD COLUMN principal TEXT;
`;
export const schema7To8Tables = `CREATE TABLE IF NOT EXISTS usage_ledger(id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, group_id TEXT NOT NULL, repo_id TEXT, run_id TEXT, source TEXT NOT NULL CHECK(source IN ('run-work','run-handoff','estimate','clarify','split','pre-ledger')), model TEXT, input INTEGER, output INTEGER, cache_read INTEGER, cache_write INTEGER, tokens INTEGER NOT NULL CHECK(tokens >= 0), quality TEXT NOT NULL CHECK(quality IN ('reported','unattributed','breakdown-mismatch'))) STRICT;
CREATE INDEX IF NOT EXISTS usage_ledger_at ON usage_ledger(applied_at);
CREATE INDEX IF NOT EXISTS usage_ledger_repo_at ON usage_ledger(repo_id,applied_at);
CREATE TABLE IF NOT EXISTS spend_caps(scope TEXT NOT NULL, period TEXT NOT NULL CHECK(period IN ('total','week','month')), tokens INTEGER NOT NULL CHECK(tokens > 0), updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY(scope,period)) STRICT;
CREATE TABLE IF NOT EXISTS usage_calendar(singleton INTEGER PRIMARY KEY CHECK(singleton=1), time_zone TEXT NOT NULL, week_start INTEGER NOT NULL CHECK(week_start BETWEEN 1 AND 7)) STRICT;
CREATE TABLE IF NOT EXISTS spend_settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision >= 0)) STRICT;
CREATE TABLE IF NOT EXISTS spend_cap_blocks(group_id TEXT PRIMARY KEY REFERENCES groups(id), body TEXT NOT NULL) STRICT;
`;
// Each group's existing usage as one pre-ledger row, applied_at 0, so it counts in totals and in no week or month. The
// repository is groupRepoIdOf's (usageLedger.ts): the first of plan.repoId, requirement.repoId, projectKey that is a
// non-empty string, so a pre-ledger row and a later row of the same group never name two repositories.
const repoPath = (path: string) => `NULLIF(CASE json_type(body,'${path}') WHEN 'text' THEN json_extract(body,'${path}') END, '')`;
export const schema7To8PreLedger = `INSERT INTO usage_ledger(applied_at,group_id,repo_id,run_id,source,model,input,output,cache_read,cache_write,tokens,quality)
  SELECT 0, id, COALESCE(${repoPath("$.plan.repoId")}, ${repoPath("$.requirement.repoId")}, ${repoPath("$.projectKey")}), NULL, 'pre-ledger', NULL, NULL, NULL, NULL, NULL, COALESCE(json_extract(body,'$.used.tokens'), 0), 'unattributed' FROM groups;
`;
export const schema7To8 = schema7To8Principal + schema7To8Tables + schema7To8PreLedger;

// A fresh store has no groups, so the pre-ledger insert adds nothing.
export const initialSchema = legacySchema + schema1To2 + schema2To3 + schema3To4 + schema4To5 + schema5To6 + schema6To7 + schema7To8;

/**
 * Accounts spec §9: idempotent on a store a criterion downgraded by dropping only its own column or table (the 6-to-7 and
 * version-3/4/5 criteria keep principal and the five tables). The pre-ledger rows are booked only when the ledger is new,
 * so a repeated step never counts a group's usage twice. Runs inside the store's migration transaction.
 */
function migrate7To8(store: DatabaseSync): void {
  const hasPrincipal = store.prepare("PRAGMA table_info(commands)").all().some((row) => row.name === "principal");
  const ledgerExisted = store.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='usage_ledger'").get() !== undefined;
  if (!hasPrincipal) store.exec(schema7To8Principal);
  store.exec(schema7To8Tables);
  if (!ledgerExisted) store.exec(schema7To8PreLedger);
}

export function migrateSchema(store: DatabaseSync, fromVersion: string): void {
  if (fromVersion === "1") store.exec(schema1To2 + schema2To3 + schema3To4 + schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "2") store.exec(schema2To3 + schema3To4 + schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "3") store.exec(schema3To4 + schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "4") store.exec(schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "5") store.exec(schema5To6 + schema6To7);
  else if (fromVersion === "6") store.exec(schema6To7);
  else if (fromVersion !== "7") throw new Error("control-schema-unsupported");
  migrate7To8(store);
  store.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(schemaVersion);
}
