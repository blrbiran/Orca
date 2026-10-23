import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schema5To6, schemaVersion } from "../../src/control/migrations.js";
import { newRound, readRounds } from "../../src/control/requirementRecords.js";
import { openControlStore } from "../../src/control/store.js";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * Flow engine spec §6.1 and §10.1 (plan Task 4, C10 part): schema 17 adds the flow journal and re-keys
 * `requirement_rounds` by step execution. Every dev round a person already answered must survive the upgrade byte for
 * byte, keyed as the dev flow's ('clarify', 1), and the rebuild is all-or-nothing: an upgrade that fails half-way
 * leaves the version-16 store exactly as it was. Temp stores only (Rule 17).
 */
const FLOW_TABLES = ["flow_feedback", "flow_runs", "step_executions", "step_heads", "flow_messages", "rerun_plans", "effect_records", "flow_decisions", "flow_templates"];
const roundBody = (roundNo: number, note: string) => JSON.stringify({ ...newRound(roundNo), lastInvalidReason: note });

/** A version-16 store: no flow tables, `requirement_rounds` in its old shape, holding 3 rounds of 2 groups. */
async function v16Store() {
  const root = await mkdtemp(join(tmpdir(), "s17-")), dir = join(root, "s");
  (await openControlStore({ stateDir: dir })).close();
  const raw = new DatabaseSync(join(dir, "control.sqlite"));
  raw.exec("PRAGMA foreign_keys=ON");
  for (const table of FLOW_TABLES) raw.exec(`DROP TABLE ${table}`);
  raw.exec("DROP TABLE requirement_rounds");
  raw.exec(schema5To6);
  raw.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('a',0,1,'{}'),('b',0,1,'{}')").run();
  const insert = raw.prepare("INSERT INTO requirement_rounds(group_id,round_no,state,body) VALUES (?,?,?,?)");
  insert.run("a", 1, "drafting", roundBody(1, "a1"));
  insert.run("a", 2, "drafting", roundBody(2, "a2"));
  insert.run("b", 1, "drafting", roundBody(1, "b1"));
  raw.prepare("UPDATE meta SET value='16' WHERE key='schemaVersion'").run();
  const before = raw.prepare("SELECT group_id,round_no,state,body FROM requirement_rounds ORDER BY group_id,round_no").all();
  raw.close();
  return { root, dir, before };
}

describe("schema 17: flow journal tables and requirement_rounds keyed by step execution", () => {
  it("keeps every round byte-equal as ('clarify', 1), creates the flow tables empty, and moves the version to the current schema", async () => {
    const { root, dir, before } = await v16Store();
    const store = await openControlStore({ stateDir: dir });
    try {
      expect(schemaVersion).toBe("19");
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("19");
      const after = store.db.prepare("SELECT group_id,step_key,exec_seq,round_no,state,body FROM requirement_rounds ORDER BY group_id,round_no").all();
      expect(after).toHaveLength(3);
      expect(after.map(({ step_key, exec_seq, ...rest }) => { expect([step_key, exec_seq]).toEqual(["clarify", 1]); return rest; })).toEqual(before);
      // The dev host reads them as before.
      expect(readRounds(store, "a").map((round) => round.lastInvalidReason)).toEqual(["a1", "a2"]);
      expect(store.db.prepare("SELECT sql FROM sqlite_master WHERE name='requirement_rounds'").get()!.sql).toContain("PRIMARY KEY(group_id, step_key, exec_seq, round_no)");
      for (const table of FLOW_TABLES) expect(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n).toBe(0);
      expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name='requirement_rounds_keyed'").get()).toBeUndefined();
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("a re-run step (a store downgraded to 15 by older criteria) leaves an already keyed table and its keys alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "s17r-")), dir = join(root, "s");
    (await openControlStore({ stateDir: dir })).close();
    const raw = new DatabaseSync(join(dir, "control.sqlite"));
    raw.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,'{}')").run();
    raw.prepare("INSERT INTO requirement_rounds(group_id,step_key,exec_seq,round_no,state,body) VALUES ('g','brief',2,1,'drafting',?)").run(roundBody(1, "flow"));
    raw.exec("DROP TABLE check_state");
    raw.prepare("UPDATE meta SET value='15' WHERE key='schemaVersion'").run();
    raw.close();
    const store = await openControlStore({ stateDir: dir });
    try {
      expect(store.db.prepare("SELECT step_key,exec_seq,round_no FROM requirement_rounds").all()).toEqual([{ step_key: "brief", exec_seq: 2, round_no: 1 }]);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("refuses an execution seq of 0 and a missing step key", async () => {
    const root = await mkdtemp(join(tmpdir(), "s17k-"));
    const store = await openControlStore({ stateDir: join(root, "s") });
    try {
      store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('g',0,1,'{}')").run();
      const insert = (stepKey: string | null, execSeq: number) => store.db.prepare("INSERT INTO requirement_rounds(group_id,step_key,exec_seq,round_no,state,body) VALUES ('g',?,?,1,'drafting','{}')").run(stepKey, execSeq);
      expect(() => insert("clarify", 0)).toThrow(/CHECK/);
      expect(() => insert(null, 1)).toThrow(/NOT NULL/);
      insert("clarify", 1);
      // A second execution of the same step keeps its own round 1.
      insert("clarify", 2);
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM requirement_rounds WHERE group_id='g' AND round_no=1").get()!.n).toBe(2);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("an upgrade that fails after the copy leaves the version-16 store as it was (one transaction)", async () => {
    const { root, dir, before } = await v16Store();
    // Fault injection: a view on the old table makes the final RENAME fail, after create, copy and drop have run.
    const raw = new DatabaseSync(join(dir, "control.sqlite"));
    raw.exec("CREATE VIEW rounds_probe AS SELECT round_no FROM requirement_rounds");
    raw.close();
    await expect(openControlStore({ stateDir: dir })).rejects.toThrow(/rounds_probe|no such table/);
    const check = new DatabaseSync(join(dir, "control.sqlite"));
    try {
      expect(check.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("16");
      expect(check.prepare("SELECT group_id,round_no,state,body FROM requirement_rounds ORDER BY group_id,round_no").all()).toEqual(before);
      expect(check.prepare("SELECT name FROM sqlite_master WHERE name IN ('requirement_rounds_keyed','flow_runs')").all()).toEqual([]);
    } finally { check.close(); await rm(root, { recursive: true, force: true }); }
  });
});
