import type { DatabaseSync } from "node:sqlite";
import { canonicalBytes } from "./canonicalJson.js";
import { mirrorWebAuthority, reopenProposalBodies, type Body } from "./proposalReopen.js";

export const schemaVersion = "19";
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

// Issue-fixes spec §5.2 (ruling H5): Orca's own wall-clock record of what happened in a group (activity.ts writes it).
// The spec's table, in the repo's style (STRICT, REFERENCES). IF NOT EXISTS for the reason schema5To6 gives: the older
// steps' downgrade criteria drop only their own tables, so a re-run chain meets this one already there.
export const schema8To9 = `CREATE TABLE IF NOT EXISTS activity(seq INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL REFERENCES groups(id), task_id TEXT, run_id TEXT, at INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS activity_group_seq ON activity(group_id,seq);
CREATE INDEX IF NOT EXISTS activity_run_seq ON activity(run_id,seq);
`;

// Token policy spec §4: derived policy rows leave all historical body/hash bytes intact.
export const schema10To11 = `CREATE TABLE IF NOT EXISTS token_policies(group_id TEXT NOT NULL REFERENCES groups(id), work_item_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('finite-legacy','optional-v1')), tokens INTEGER CHECK(tokens IS NULL OR (tokens >= 0 AND tokens <= 9007199254740991)), PRIMARY KEY(group_id,work_item_id)) STRICT;
CREATE TABLE IF NOT EXISTS funded_allowances(run_id TEXT PRIMARY KEY REFERENCES runs(id), group_id TEXT NOT NULL REFERENCES groups(id), work_item_id TEXT NOT NULL, body TEXT NOT NULL) STRICT;
INSERT OR IGNORE INTO token_policies SELECT id,'','finite-legacy',json_extract(body,'$.limit.tokens') FROM groups;
INSERT OR IGNORE INTO token_policies SELECT group_id,id,'finite-legacy',json_extract(body,'$.grant.work.tokens') FROM work_items;
`;

// Installation updates have their own operator revision. The existing preference revision and frozen
// selection documents are never advanced by a table update. A pending row is the durable dispatch outbox.
export const schema12To13 = `CREATE TABLE IF NOT EXISTS agent_update_state(operator_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision >= 0 AND revision <= 9007199254740991)) STRICT;
CREATE TABLE IF NOT EXISTS agent_update_outbox(operator_id TEXT NOT NULL, command_id TEXT NOT NULL, raw_hash TEXT NOT NULL, raw_command_json TEXT NOT NULL, request_json TEXT NOT NULL, principal TEXT NOT NULL, client TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','complete')), receipt_json TEXT, PRIMARY KEY(operator_id,command_id)) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_agent_update ON agent_update_outbox(operator_id) WHERE state='pending';
`;

// Decisions an agent proposed that Orca held back for a human. run_id is the control run that landed the work;
// ledger_run is the ledger file's run id (run_id or reconcile-<run_id>). body is the PendingEntry JSON, plus the
// settled outcome (approvedId or correctionId). Existing rows are untouched; the table starts empty.
export const schema13To14 = `CREATE TABLE IF NOT EXISTS pending_decisions(id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id),
  run_id TEXT NOT NULL REFERENCES runs(id), ledger_run TEXT NOT NULL, entry_index INTEGER NOT NULL CHECK(entry_index >= 0),
  state TEXT NOT NULL CHECK(state IN ('pending','approved','rejected')), body TEXT NOT NULL, UNIQUE(ledger_run, entry_index)) STRICT;
CREATE INDEX IF NOT EXISTS pending_decisions_group ON pending_decisions(group_id, state);
`;

// Kanban and group orchestration spec 2026-10-20 (plan 2026-10-21, one step for all slices): a landed decision Orca flags
// for a person (§9a, "land, then flag"; ratify clears it), a group's start-on-confirm record, the person's edges between
// groups (from lands before to starts) and the global orchestration settings. Existing rows are untouched; all start empty.
export const schema14To15 = `CREATE TABLE IF NOT EXISTS flagged_decisions(decision_id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES groups(id), run_id TEXT,
  source TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('flagged','ratified')), body TEXT NOT NULL) STRICT;
CREATE INDEX IF NOT EXISTS flagged_decisions_group ON flagged_decisions(group_id, state);
CREATE TABLE IF NOT EXISTS group_orchestration(group_id TEXT PRIMARY KEY REFERENCES groups(id), body TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS group_edges(from_group TEXT NOT NULL REFERENCES groups(id), to_group TEXT NOT NULL REFERENCES groups(id),
  body TEXT NOT NULL, PRIMARY KEY(from_group, to_group), CHECK(from_group <> to_group)) STRICT;
CREATE TABLE IF NOT EXISTS orchestration_settings(singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision >= 0), body TEXT NOT NULL) STRICT;
`;

// Checks spec 2026-10-22 §5.1: one record per (project, check kind, target) -- the "reviewed up to" watermark and the
// check's run state. Created empty; the integration check's old `meta` row is converted lazily by code (it needs git).
export const schema15To16 = `CREATE TABLE IF NOT EXISTS check_state(repo_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(repo_id, kind, target)) STRICT;
`;

// Flow engine spec 2026-10-22 §6.1: the flow journal. STRICT, JSON bodies; created empty. `step_executions`,
// `flow_messages`, `flow_decisions` are append-only and `effect_records` changes only `state`, forward (src/flow/store.ts
// enforces both); `step_heads` is the one mutable pointer. Times are epoch milliseconds.
export const schema16To17 = `CREATE TABLE IF NOT EXISTS flow_runs(id TEXT PRIMARY KEY, group_id TEXT NOT NULL UNIQUE REFERENCES groups(id),
  template_ref TEXT NOT NULL, template_sha256 TEXT NOT NULL, workspace TEXT NOT NULL, vault_id TEXT, params_sha256 TEXT NOT NULL,
  pool_tokens INTEGER NOT NULL CHECK(pool_tokens >= 0 AND pool_tokens <= 9007199254740991),
  pool_drawn INTEGER NOT NULL DEFAULT 0 CHECK(pool_drawn >= 0 AND pool_drawn <= 9007199254740991),
  state TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 0), body TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS step_executions(flow_run_id TEXT NOT NULL REFERENCES flow_runs(id), step_key TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK(seq > 0), kind TEXT NOT NULL, kind_version INTEGER NOT NULL CHECK(kind_version > 0),
  state TEXT NOT NULL CHECK(state IN ('queued','running','done','failed','skipped','needs-person','parked','staged')),
  definition_hash TEXT NOT NULL, base_commit TEXT, ran_on TEXT, fingerprint TEXT,
  output_kind TEXT CHECK(output_kind IS NULL OR output_kind IN ('commit','artifact','none')), output_ref TEXT, output_hash TEXT,
  read_set_hash TEXT, reasons TEXT NOT NULL, plan_no INTEGER, child_group_id TEXT REFERENCES groups(id), "by" TEXT NOT NULL, via TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(flow_run_id, step_key, seq)) STRICT;
CREATE TABLE IF NOT EXISTS step_heads(flow_run_id TEXT NOT NULL REFERENCES flow_runs(id), step_key TEXT NOT NULL,
  active_seq INTEGER NOT NULL CHECK(active_seq > 0), PRIMARY KEY(flow_run_id, step_key)) STRICT;
CREATE TABLE IF NOT EXISTS flow_messages(flow_run_id TEXT NOT NULL REFERENCES flow_runs(id), seq INTEGER NOT NULL CHECK(seq > 0),
  request_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL CHECK(target IN ('run','step','execution','round','effect')),
  body TEXT NOT NULL, "by" TEXT NOT NULL, via TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('accepted','applied','rejected','excluded')),
  reason TEXT, at INTEGER NOT NULL, PRIMARY KEY(flow_run_id, seq), UNIQUE(flow_run_id, request_id)) STRICT;
CREATE TABLE IF NOT EXISTS rerun_plans(flow_run_id TEXT NOT NULL REFERENCES flow_runs(id), plan_no INTEGER NOT NULL CHECK(plan_no > 0),
  state TEXT NOT NULL CHECK(state IN ('proposed','chosen','running','done','abandoned')), candidates TEXT NOT NULL, proposal TEXT,
  chosen TEXT, "by" TEXT NOT NULL, via TEXT NOT NULL, PRIMARY KEY(flow_run_id, plan_no)) STRICT;
CREATE TABLE IF NOT EXISTS effect_records(id TEXT PRIMARY KEY, flow_run_id TEXT NOT NULL REFERENCES flow_runs(id), step_key TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK(seq > 0), effect_kind TEXT NOT NULL, class TEXT NOT NULL, level TEXT NOT NULL, policy TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('staged','confirmed','applied','discarded','failed')), payload_hash TEXT NOT NULL, remote_ref TEXT,
  "by" TEXT NOT NULL, via TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS flow_decisions(flow_run_id TEXT NOT NULL REFERENCES flow_runs(id), seq INTEGER NOT NULL CHECK(seq > 0),
  grade TEXT NOT NULL CHECK(grade IN ('major','minor')), step_key TEXT NOT NULL, body TEXT NOT NULL, "by" TEXT NOT NULL,
  PRIMARY KEY(flow_run_id, seq)) STRICT;
CREATE TABLE IF NOT EXISTS flow_templates(layer TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
  sha256 TEXT NOT NULL, path TEXT NOT NULL, published_by TEXT NOT NULL, published_at INTEGER NOT NULL, PRIMARY KEY(layer, id, version)) STRICT;
`;

// Gaps spec 2026-10-22 §12: one run-level feedback intake per message. STRICT, JSON body; created empty. State moves
// forward only (src/flow/store.ts enforces it, with the one named backward edge `ready` -> `needs-location`).
export const schema17To18 = `CREATE TABLE IF NOT EXISTS flow_feedback(
  flow_run_id TEXT NOT NULL REFERENCES flow_runs(id), message_seq INTEGER NOT NULL CHECK(message_seq > 0),
  state TEXT NOT NULL CHECK(state IN ('locating','needs-location','triaging','clarifying','restating','ready','planned','withdrawn','failed')),
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(flow_run_id, message_seq),
  FOREIGN KEY(flow_run_id, message_seq) REFERENCES flow_messages(flow_run_id, seq)) STRICT;
`;

// Flow engine spec §10.1: `requirement_rounds` keyed by step execution. Rebuilt -- create, copy, drop, rename -- inside
// the migration's one transaction (store.ts); every existing row is the dev flow's ('clarify', 1), other columns as stored.
const requirementRoundsKeyed = `CREATE TABLE requirement_rounds_keyed(group_id TEXT NOT NULL REFERENCES groups(id), step_key TEXT NOT NULL,
  exec_seq INTEGER NOT NULL CHECK(exec_seq > 0), round_no INTEGER NOT NULL CHECK(round_no > 0 AND round_no <= 9007199254740991),
  state TEXT NOT NULL CHECK(state IN ('drafting','awaiting-answers','answered','interrupted','failed')), body TEXT NOT NULL,
  PRIMARY KEY(group_id, step_key, exec_seq, round_no)) STRICT;
INSERT INTO requirement_rounds_keyed(group_id, step_key, exec_seq, round_no, state, body)
  SELECT group_id, 'clarify', 1, round_no, state, body FROM requirement_rounds ORDER BY group_id, round_no;
DROP TABLE requirement_rounds;
ALTER TABLE requirement_rounds_keyed RENAME TO requirement_rounds;
`;

/** Re-keys `requirement_rounds` once: a store whose table already has `step_key` (a fresh one, or a re-run step) is left as it is. */
function rekeyRequirementRounds(store: DatabaseSync): void {
  if (store.prepare("PRAGMA table_info(requirement_rounds)").all().some((row) => row.name === "step_key")) return;
  store.exec(requirementRoundsKeyed);
}

// A fresh store has no groups, so the pre-ledger insert adds nothing.
export const initialSchema = legacySchema + schema1To2 + schema2To3 + schema3To4 + schema4To5 + schema5To6 + schema6To7 + schema7To8 + schema8To9 + schema10To11 + schema12To13 + schema13To14 + schema14To15 + schema15To16
  + requirementRoundsKeyed + schema16To17 + schema17To18;

/**
 * Checks spec 2026-10-22 §4.1 "Migration (no aliases, P1)": each repository settings body's `integrationCheck
 * {enabled, command}` moves to `checks.integrationCheck {enabled, command}` (the same meaning) and the old field goes.
 * Canonical bytes as the body's single writer stores them; the body's revision is not moved (nobody changed a setting).
 */
function migrateSettings15To16(store: DatabaseSync): void {
  for (const row of store.prepare("SELECT repo_id, body FROM repository_settings ORDER BY repo_id").all()) {
    const body = JSON.parse(String(row.body)) as Record<string, unknown>;
    if (!Object.hasOwn(body, "integrationCheck")) continue;
    const { integrationCheck, ...rest } = body as { integrationCheck: { enabled: unknown; command: unknown } } & Record<string, unknown>;
    const checks = { ...(rest.checks as Record<string, unknown> | undefined), integrationCheck: { enabled: integrationCheck.enabled, command: integrationCheck.command } };
    store.prepare("UPDATE repository_settings SET body=? WHERE repo_id=?").run(canonicalBytes({ ...rest, checks }).toString("utf8"), String(row.repo_id));
  }
}

/** 16 → 17 (flow engine spec §6.1, §10.1): the flow journal tables and the `requirement_rounds` re-key. */
function migrate16To17(store: DatabaseSync): void {
  rekeyRequirementRounds(store);
  store.exec(schema16To17);
}

/** 17 → 18 (gaps spec §12): the `flow_feedback` intake table. */
function migrate17To18(store: DatabaseSync): void {
  store.exec(schema17To18);
}

/**
 * 18 → 19 (tester round 2 spec §4.3, ruling H1): a one-time data repair, no DDL. A Web group stuck `blocked` whose only
 * blocking-capable breach is an estimate run's, and that never started, goes back to `draft`; a confirmed proposal is
 * reopened exactly as `reopenProposal` does (proposalReopen.ts) and its `group_orchestration` row deleted. Never throws
 * (round 2 N1): every new body is computed before any write, and a group any of whose bodies cannot be read or reopened
 * is left as it is. The group's revision is not moved (as migrateSettings15To16 does not move a settings revision).
 */
export function repairEstimateBreachedGroups(store: DatabaseSync, now: () => number): void {
  for (const row of store.prepare("SELECT id, body FROM groups ORDER BY rowid").all()) {
    const groupId = String(row.id);
    try {
      const planned = repairOf(store, groupId, JSON.parse(String(row.body)) as Body, now);
      if (planned === null) continue;
      for (const write of planned) write();
    } catch { /* left as it is: not repaired, not thrown */ }
  }
}

function repairOf(store: DatabaseSync, groupId: string, group: Body, now: () => number): Array<() => void> | null {
  if (typeof group !== "object" || group === null || group.status !== "blocked" || !Object.hasOwn(group, "planHash")) return null;
  const estimateBreaches: string[] = [];
  for (const runRow of store.prepare("SELECT id, body FROM runs WHERE group_id=?").all(groupId)) {
    const run = JSON.parse(String(runRow.body)) as Body;
    // Condition 5: the group never started.
    if (run.phase === "work" || run.phase === "handoff") return null;
    if (!Array.isArray(run.breaches) || run.breaches.length === 0) continue;
    if (run.phase === "estimate") { estimateBreaches.push(String(runRow.id)); continue; }
    // Review I1: a clarify or split call ran while the group was clarifying, where DR18 records a breach without blocking.
    if (run.phase === "single-call" && (run.purpose === "clarify" || run.purpose === "split")) continue;
    return null; // condition 4: a blocking-capable breach
  }
  if (estimateBreaches.length === 0) return null; // condition 3
  const proposalRow = store.prepare("SELECT body FROM budget_proposals WHERE group_id=?").get(groupId);
  if (proposalRow === undefined) return null;
  const proposal = JSON.parse(String(proposalRow.body)) as Body;
  if (typeof proposal !== "object" || proposal === null || typeof proposal.state !== "string") return null;
  const reopened = proposal.state === "confirmed";
  const writes: Array<() => void> = [];
  if (reopened) {
    const works = store.prepare("SELECT id, body FROM work_items WHERE group_id=?").all(groupId).map(work => ({ id: String(work.id), body: JSON.parse(String(work.body)) as Body }));
    // The reservation is kept (committedRemaining unchanged); the reserve and deficit come from budgetBalance.
    reopenProposalBodies(group, proposal, works.map(work => work.body), group.ledger.committedRemaining);
    mirrorWebAuthority(group, proposal);
    const proposalJson = canonicalBytes(proposal).toString("utf8");
    writes.push(() => store.prepare("UPDATE budget_proposals SET proposal_version=?, body=? WHERE group_id=?").run(proposal.proposalVersion, proposalJson, groupId));
    for (const work of works) if (work.body.kind === "task") { const json = JSON.stringify(work.body); writes.push(() => store.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(json, groupId, work.id)); }
    // saveWebAuthority's token-policy writes, with the values the rows hold (only rows that exist; their mode kept).
    const policy = store.prepare("SELECT mode FROM token_policies WHERE group_id=? AND work_item_id=''").get(groupId);
    if (policy !== undefined) {
      const limitTokens = (proposal.groupLimit as { tokens: number | null }).tokens;
      writes.push(() => store.prepare("UPDATE token_policies SET tokens=? WHERE group_id=? AND work_item_id=''").run(limitTokens, groupId));
      if (policy.mode === "optional-v1") for (const allocation of proposal.allocations as Body[]) if (allocation.ownerKind === "task" && allocation.bucket === "work") {
        const tokens = (allocation.amount as { tokens: number | null }).tokens;
        writes.push(() => store.prepare("UPDATE token_policies SET tokens=? WHERE group_id=? AND work_item_id=?").run(tokens, groupId, String(allocation.ownerId)));
      }
    }
    writes.push(() => store.prepare("DELETE FROM group_orchestration WHERE group_id=?").run(groupId));
  }
  group.status = "draft";
  const statusRepairs = Array.isArray(group.statusRepairs) ? group.statusRepairs : [];
  group.statusRepairs = [...statusRepairs, { from: "blocked", to: "draft", reopened, cause: "estimate-breach", runIds: [...estimateBreaches].sort(), by: "migration-18-to-19", at: now() }];
  const groupJson = JSON.stringify(group);
  writes.push(() => store.prepare("UPDATE groups SET body=? WHERE id=?").run(groupJson, groupId));
  return writes;
}

/** The steps every older version ends with: 15 → 16, 16 → 17, 17 → 18, 18 → 19, then the version marker. */
function finishMigration(store: DatabaseSync, now: () => number): void {
  store.exec(schema15To16);
  migrateSettings15To16(store);
  migrate16To17(store);
  migrate17To18(store);
  repairEstimateBreachedGroups(store, now);
  store.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(schemaVersion);
}

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

export function migrateSchema(store: DatabaseSync, fromVersion: string, now: () => number = Date.now): void {
  // Saved recovery's 11→12 marker fenced older owners. The current 11/12→13 upgrade also
  // adds installation-update revision/outbox tables; it leaves old policy and accounting rows intact.
  if (fromVersion === "18") {
    repairEstimateBreachedGroups(store, now);
    store.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(schemaVersion);
    return;
  }
  if (fromVersion === "17") {
    migrate17To18(store);
    repairEstimateBreachedGroups(store, now);
    store.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(schemaVersion);
    return;
  }
  if (fromVersion === "16") {
    migrate16To17(store);
    migrate17To18(store);
    repairEstimateBreachedGroups(store, now);
    store.prepare("UPDATE meta SET value=? WHERE key='schemaVersion'").run(schemaVersion);
    return;
  }
  if (fromVersion === "15") {
    finishMigration(store, now);
    return;
  }
  if (fromVersion === "14") {
    store.exec(schema14To15);
    finishMigration(store, now);
    return;
  }
  if (fromVersion === "13") {
    store.exec(schema13To14 + schema14To15);
    finishMigration(store, now);
    return;
  }
  if (fromVersion === "12") {
    store.exec(schema12To13 + schema13To14 + schema14To15);
    finishMigration(store, now);
    return;
  }
  if (fromVersion === "11") {
    store.exec(schema12To13 + schema13To14 + schema14To15);
    finishMigration(store, now);
    return;
  }
  if (fromVersion === "1") store.exec(schema1To2 + schema2To3 + schema3To4 + schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "2") store.exec(schema2To3 + schema3To4 + schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "3") store.exec(schema3To4 + schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "4") store.exec(schema4To5 + schema5To6 + schema6To7);
  else if (fromVersion === "5") store.exec(schema5To6 + schema6To7);
  else if (fromVersion === "6") store.exec(schema6To7);
  else if (fromVersion !== "7" && fromVersion !== "8" && fromVersion !== "9" && fromVersion !== "10") throw new Error("control-schema-unsupported");
  // Every version before 8 goes through 7 to 8 first; 8 itself only gains the activity table (spec §5.2).
  if (fromVersion !== "8" && fromVersion !== "9" && fromVersion !== "10") migrate7To8(store);
  store.exec(schema8To9 + schema10To11 + schema12To13 + schema13To14 + schema14To15);
  finishMigration(store, now);
}
