import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { schemaVersion } from "../../src/control/migrations.js";
import { openControlStore, type ControlStore } from "../../src/control/store.js";
import { emptyIntakeBody, IntakeBody } from "../../src/flow/feedback/intakeSchema.js";
import {
  appendMessage, getIntake, insertFlowRun, insertIntake, listIntakes, listRunsWithOpenWork, moveIntake, putPlan, setFlowRunState,
  type IntakeState,
} from "../../src/flow/store.js";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * Gaps spec §12 and criterion G13: schema 18 adds `flow_feedback`. Every pre-existing table is left byte-equal, one
 * backup of the version-17 store precedes the step, and an intake's state never moves backward except the one named edge
 * `ready -> needs-location`. Temp stores only (Rule 17).
 */
const ALL_STATES: IntakeState[] = ["locating", "needs-location", "triaging", "clarifying", "restating", "ready", "planned", "withdrawn", "failed"];

async function temp(): Promise<{ root: string; dir: string }> {
  const root = await mkdtemp(join(tmpdir(), "s18-"));
  return { root, dir: join(root, "s") };
}

const run = (id: string, state = "running") => ({
  id, groupId: `g-${id}`, templateRef: "t@1", templateSha256: "a".repeat(64), workspace: {}, vaultId: null, paramsSha256: "b".repeat(64),
  poolTokens: 10, poolDrawn: 0, state, revision: 0, body: {},
});

/** A flow run `id` with `messages` run-level feedback messages (seq 1..messages). */
function seedRun(store: ControlStore, id: string, messages: number, state = "running"): void {
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,0,1,'{}')").run(`g-${id}`);
  insertFlowRun(store, run(id, state));
  for (let n = 1; n <= messages; n++) {
    appendMessage(store, { flowRunId: id, requestId: `r${n}`, kind: "feedback", target: "run", body: { text: "x" }, by: "human", via: "cli", state: "accepted", reason: null, at: 1 });
  }
}

const tableSql = (db: InstanceType<typeof DatabaseSync>) =>
  db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string }[];

/** A populated version-17 store (everything the current schema has except `flow_feedback`), closed, with its table SQL and rows. */
async function v17Store() {
  const { root, dir } = await temp();
  const first = await openControlStore({ stateDir: dir, now: () => 1000 });
  seedRun(first, "fr1", 2);
  putPlan(first, { flowRunId: "fr1", planNo: 1, state: "proposed", candidates: { list: [] }, proposal: null, chosen: null, by: "orca", via: "kernel" });
  first.close();
  const raw = new DatabaseSync(join(dir, "control.sqlite"));
  raw.exec("DROP TABLE flow_feedback");
  raw.prepare("UPDATE meta SET value='17' WHERE key='schemaVersion'").run();
  const sql = tableSql(raw);
  const rows = Object.fromEntries(sql.map(({ name }) => [name, raw.prepare(`SELECT * FROM "${name}"`).all()]));
  raw.close();
  return { root, dir, sql, rows };
}

describe("schema 18: flow_feedback", () => {
  it("is the current schema and a fresh store has the table, with no backup (nothing to back up)", async () => {
    const { root, dir } = await temp();
    const store = await openControlStore({ stateDir: dir });
    try {
      expect(schemaVersion).toBe("21");
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("21");
      expect((await readdir(dir)).filter((name) => name.includes(".pre-"))).toEqual([]);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("has the §12 table: STRICT, the state CHECK, the composite key and both foreign keys", async () => {
    const { root, dir } = await temp();
    const store = await openControlStore({ stateDir: dir });
    try {
      const sql = String(store.db.prepare("SELECT sql FROM sqlite_master WHERE name='flow_feedback'").get()!.sql).replace(/\s+/g, " ");
      expect(sql).toContain("PRIMARY KEY(flow_run_id, message_seq)");
      expect(sql).toContain("FOREIGN KEY(flow_run_id, message_seq) REFERENCES flow_messages(flow_run_id, seq)");
      expect(sql).toContain("REFERENCES flow_runs(id)");
      expect(sql).toContain("CHECK(message_seq > 0)");
      expect(sql.trimEnd().endsWith("STRICT")).toBe(true);
      expect(sql).toContain("state TEXT NOT NULL CHECK(state IN ('locating','needs-location','triaging','clarifying','restating','ready','planned','withdrawn','failed'))");

      seedRun(store, "fr1", 1);
      const put = (run: string, seq: unknown, state: string, body: unknown = "{}") =>
        store.db.prepare("INSERT INTO flow_feedback(flow_run_id,message_seq,state,body,updated_at) VALUES (?,?,?,?,1)").run(run, seq as number, state, body as string);
      expect(() => put("fr1", 1, "bogus")).toThrow(/CHECK/);
      expect(() => put("fr1", 0, "locating")).toThrow(/CHECK/);
      expect(() => put("fr1", 2, "locating")).toThrow(/FOREIGN KEY/);              // no such message
      expect(() => put("nope", 1, "locating")).toThrow(/FOREIGN KEY/);             // no such run
      expect(() => put("fr1", "one", "locating")).toThrow(/datatype mismatch|cannot store/); // STRICT
      put("fr1", 1, "locating");
      expect(() => put("fr1", 1, "ready")).toThrow(/UNIQUE|PRIMARY/);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("17 -> 18 leaves every pre-existing table's SQL and rows byte-equal and adds the table empty", async () => {
    const { root, dir, sql, rows } = await v17Store();
    const store = await openControlStore({ stateDir: dir, now: () => 2000 });
    try {
      const after = tableSql(store.db);
      expect(after.filter((t) => t.name === "flow_feedback")).toHaveLength(1);
      expect(after.filter((t) => t.name !== "flow_feedback")).toEqual(sql);
      for (const { name } of sql) {
        const now = store.db.prepare(`SELECT * FROM "${name}"`).all();
        expect(name === "meta" ? now.filter((r) => r.key !== "schemaVersion") : now).toEqual(name === "meta" ? rows[name]!.filter((r) => (r as { key: string }).key !== "schemaVersion") : rows[name]);
      }
      expect(store.db.prepare("SELECT COUNT(*) AS n FROM flow_feedback").get()!.n).toBe(0);
      expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("21");
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("writes one backup of the version-17 store, 0600, before the step touched it", async () => {
    const { root, dir, sql, rows } = await v17Store();
    const store = await openControlStore({ stateDir: dir, now: () => 2000 });
    try {
      const names = (await readdir(dir)).filter((name) => name.startsWith("control.sqlite.pre-"));
      expect(names).toEqual(["control.sqlite.pre-v17-2000"]);
      const file = join(dir, names[0]!);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      const backup = new DatabaseSync(file, { readOnly: true });
      try {
        // The backup is the store as it was before the step: version 17, no flow_feedback, every table as it was.
        expect(backup.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("17");
        expect(tableSql(backup)).toEqual(sql);
        for (const { name } of sql) expect(backup.prepare(`SELECT * FROM "${name}"`).all()).toEqual(rows[name]);
      } finally { backup.close(); }
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });

  it("a second open of the migrated store writes no further backup", async () => {
    const { root, dir } = await v17Store();
    try {
      (await openControlStore({ stateDir: dir, now: () => 2000 })).close();
      (await openControlStore({ stateDir: dir, now: () => 3000 })).close();
      expect((await readdir(dir)).filter((name) => name.startsWith("control.sqlite.pre-"))).toEqual(["control.sqlite.pre-v17-2000"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("the backup before a migration", () => {
  const downgrade = (dir: string) => {
    const raw = new DatabaseSync(join(dir, "control.sqlite"));
    raw.exec("DROP TABLE flow_feedback");
    raw.prepare("UPDATE meta SET value='17' WHERE key='schemaVersion'").run();
    raw.close();
  };

  it("never skips when the name is taken: two downgrade-and-reopen cycles under one fixed clock leave two backups", async () => {
    const { root, dir } = await v17Store();
    try {
      (await openControlStore({ stateDir: dir, now: () => 2000 })).close();
      downgrade(dir);
      (await openControlStore({ stateDir: dir, now: () => 2000 })).close();
      const names = (await readdir(dir)).filter((name) => name.startsWith("control.sqlite.pre-")).sort();
      expect(names).toEqual(["control.sqlite.pre-v17-2000", "control.sqlite.pre-v17-2000-1"]);
      for (const name of names) {
        const copy = new DatabaseSync(join(dir, name), { readOnly: true });
        try { expect(copy.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("17"); } finally { copy.close(); }
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("a backup that cannot be written stops the open: the store stays at 17 and the owner lock is released", async () => {
    const { root, dir } = await v17Store();
    try {
      // A name longer than the file system allows makes VACUUM INTO fail before anything migrates.
      await expect(openControlStore({ stateDir: dir, now: () => "9".repeat(400) as unknown as number })).rejects.toThrow();
      const raw = new DatabaseSync(join(dir, "control.sqlite"));
      try {
        expect(raw.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("17");
        expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='flow_feedback'").get()).toBeUndefined();
      } finally { raw.close(); }
      expect((await readdir(dir)).filter((name) => name.startsWith("service-lock"))).toEqual([]);
      const store = await openControlStore({ stateDir: dir, now: () => 3000 });   // not control-writer-active
      try { expect(store.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()!.value).toBe("21"); } finally { store.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe("flow_feedback intake store", () => {
  async function withIntake(state: IntakeState, fn: (store: ControlStore) => void): Promise<void> {
    const { root, dir } = await temp();
    const store = await openControlStore({ stateDir: dir });
    try {
      seedRun(store, "fr1", 1);
      insertIntake(store, { flowRunId: "fr1", messageSeq: 1, state, body: emptyIntakeBody(), at: 5 });
      fn(store);
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  }

  it("round-trips the body and refuses an unknown body key", async () => {
    await withIntake("locating", (store) => {
      const body = { ...emptyIntakeBody(), anchors: [{ quote: "hello world" }], flags: ["triage-defaulted"], reusedFrom: 1 };
      moveIntake(store, "fr1", 1, "locating", "needs-location", body, 9);
      expect(getIntake(store, "fr1", 1)).toEqual({ flowRunId: "fr1", messageSeq: 1, state: "needs-location", body, updatedAt: 9 });
      expect(listIntakes(store, "fr1")).toHaveLength(1);
      expect(getIntake(store, "fr1", 2)).toBeNull();
      expect(() => moveIntake(store, "fr1", 1, "needs-location", "triaging", { ...body, extra: 1 } as never, 10)).toThrow();
      expect(IntakeBody.safeParse({ ...emptyIntakeBody(), extra: 1 }).success).toBe(false);
    });
  });

  // The order is the contract: a write to an earlier state is refused, whatever the pair.
  const LIVE = ALL_STATES.slice(0, 7);
  for (const from of ALL_STATES) {
    for (const to of ALL_STATES) {
      const allowed = (() => {
        // §4.8: a planned intake whose plan is still open is replaced (Ruling: 这次批准改写所有必要的判据 (0e13a9b7)).
        if (from === "planned" && to === "withdrawn") return true;
        if (["planned", "withdrawn", "failed"].includes(from)) return false;
        if (to === "withdrawn" || to === "failed") return true;
        if (from === "ready" && to === "needs-location") return true;
        return LIVE.indexOf(to) >= LIVE.indexOf(from);
      })();
      it(`${from} -> ${to} is ${allowed ? "allowed" : "refused flow-intake-backward"}`, async () => {
        await withIntake(from, (store) => {
          if (allowed) {
            moveIntake(store, "fr1", 1, from, to, emptyIntakeBody(), 6);
            expect(getIntake(store, "fr1", 1)!.state).toBe(to);
          } else {
            expect(() => moveIntake(store, "fr1", 1, from, to, emptyIntakeBody(), 6)).toThrow(/^flow-intake-backward:/);
            expect(getIntake(store, "fr1", 1)).toMatchObject({ state: from, updatedAt: 5 });
          }
        });
      });
    }
  }

  it("compares on `from`: a lost race is flow-intake-stale and writes nothing", async () => {
    await withIntake("triaging", (store) => {
      expect(() => moveIntake(store, "fr1", 1, "locating", "triaging", { ...emptyIntakeBody(), flags: ["x"] }, 6)).toThrow(/^flow-intake-stale:/);
      expect(getIntake(store, "fr1", 1)).toMatchObject({ state: "triaging", body: emptyIntakeBody(), updatedAt: 5 });
    });
  });

  it("listRunsWithOpenWork: running, open intake, open plan, pending question -- and not a done run with none", async () => {
    const { root, dir } = await temp();
    const store = await openControlStore({ stateDir: dir });
    try {
      const plan = (id: string, planNo: number, state: "proposed" | "chosen" | "running" | "done" | "abandoned", chosen: unknown) =>
        putPlan(store, { flowRunId: id, planNo, state, candidates: {}, proposal: null, chosen, by: "orca", via: "kernel" });
      seedRun(store, "run-running", 0, "running");
      seedRun(store, "done-none", 0, "done");
      seedRun(store, "done-intake-open", 1, "done");
      insertIntake(store, { flowRunId: "done-intake-open", messageSeq: 1, state: "needs-location", body: emptyIntakeBody(), at: 1 });
      seedRun(store, "done-intake-planned", 3, "done");
      for (const [seq, state] of [[1, "planned"], [2, "withdrawn"], [3, "failed"]] as const) insertIntake(store, { flowRunId: "done-intake-planned", messageSeq: seq, state, body: emptyIntakeBody(), at: 1 });
      seedRun(store, "done-plan-proposed", 0, "done"); plan("done-plan-proposed", 1, "proposed", null);
      seedRun(store, "done-plan-running", 0, "done"); plan("done-plan-running", 1, "running", null);
      seedRun(store, "done-plan-finished", 0, "done"); plan("done-plan-finished", 1, "done", { pending: [{ stepKey: "a", answer: null }] }); plan("done-plan-finished", 2, "abandoned", null);
      seedRun(store, "done-chosen-pending", 0, "done"); plan("done-chosen-pending", 1, "chosen", { pending: [{ stepKey: "a", answer: "run" }, { stepKey: "b", answer: null }] });
      seedRun(store, "done-chosen-answered", 0, "done"); plan("done-chosen-answered", 1, "chosen", { pending: [{ stepKey: "a", answer: "run" }] });
      seedRun(store, "done-chosen-nopending", 0, "done"); plan("done-chosen-nopending", 1, "chosen", { pending: [], accepted: [] });
      seedRun(store, "stopped-plan", 0, "stopped"); plan("stopped-plan", 1, "proposed", null);
      expect(listRunsWithOpenWork(store)).toEqual(["done-chosen-pending", "done-intake-open", "done-plan-proposed", "done-plan-running", "run-running", "stopped-plan"]);
      setFlowRunState(store, "done-none", "done", "running");
      expect(listRunsWithOpenWork(store)).toContain("done-none");
    } finally { store.close(); await rm(root, { recursive: true, force: true }); }
  });
});
