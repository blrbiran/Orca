import type { DatabaseSync } from "node:sqlite";

export const schemaVersion = "5";
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

export const initialSchema = legacySchema + schema1To2 + schema2To3 + schema3To4 + schema4To5;

export function migrateSchema(store: DatabaseSync, fromVersion: string): void {
  if (fromVersion === "1") store.exec(schema1To2 + schema2To3 + schema3To4 + schema4To5);
  else if (fromVersion === "2") store.exec(schema2To3 + schema3To4 + schema4To5);
  else if (fromVersion === "3") store.exec(schema3To4 + schema4To5);
  else if (fromVersion === "4") store.exec(schema4To5);
  else throw new Error("control-schema-unsupported");
  store.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(schemaVersion);
}
