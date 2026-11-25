/**
 * Tester #468 (spec 2026-11-24-artifact-reclamation-design.md, "Human rulings and implementation notes (session
 * 5d3d0c09)"; the integrity spec's review findings). `orca gc --include-artifacts` plans an artifact only when a retired
 * holder names it and nothing live does, through artifact contents, failing closed; the panel deletes. Rule 17: every
 * store here is a temp directory; nothing reads or writes the real ~/.orca.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openTestStore } from "./fixtures/store.js";
import { ARTIFACT_HOLDER_TABLES, applyArtifactReclaim, dryRunArtifactReclaim, keysIn, type ArtifactPlanInput } from "../../src/control/artifactReclaim.js";
import { publishedArtifactIds, readArtifact, writeArtifact } from "../../src/control/archive.js";
import type { ControlStore } from "../../src/control/store.js";
import { formatGc } from "../../src/commands/local/gc.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);
const OLD = NOW - 90 * DAY;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

type Ref = { artifactId: string; hash: string };

/** An artifact as the store holds one: its directory, its `data` file and its row (no publish, so nothing is pinned). */
function seedArtifact(store: ControlStore, id: string, bytes: string | Buffer): Ref {
  const dir = join(store.stateDir, "artifacts", id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "data"), bytes, { mode: 0o600 });
  store.db.prepare("INSERT INTO artifacts(id,hash,body) VALUES (?,?,?)").run(id, sha(bytes), JSON.stringify({ path: `artifacts/${id}/data` }));
  return { artifactId: id, hash: sha(bytes) };
}
const blob = (store: ControlStore, text: string): Ref => seedArtifact(store, `sha256-${sha(text)}`, text);

function seedGroup(store: ControlStore, id: string, archivedAt: number | null) {
  const body = { status: "done", ...(archivedAt === null ? {} : { archived: { at: archivedAt, actor: "human" } }) };
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,?,?,?)").run(id, 1, 1, JSON.stringify(body));
}
function seedRun(store: ControlStore, groupId: string, runId: string, extra: Record<string, unknown> = {}) {
  store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,?,?)")
    .run(runId, groupId, "T1", 1, 0, JSON.stringify({ state: "settled", endedAt: OLD, ...extra }));
}
function setRunBody(store: ControlStore, runId: string, extra: Record<string, unknown>) {
  store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ state: "settled", endedAt: OLD, ...extra }), runId);
}

/**
 * One open group with an old settled run (live: its group is not archived), one group archived 90 days ago with an old
 * settled run (retired). `control` is named only by the retired run: the plan must take it, or a "kept" below is empty.
 */
async function world() {
  const h = await openTestStore();
  const store = h.store;
  seedGroup(store, "g-live", null);
  seedRun(store, "g-live", "run-live");
  seedGroup(store, "g-old", OLD);
  seedRun(store, "g-old", "run-old");
  const control = blob(store, "retired only");
  const plan = (extra: Partial<ArtifactPlanInput> = {}) =>
    dryRunArtifactReclaim({ db: store.db, stateDir: store.stateDir, now: NOW, ...extra });
  return { h, store, control, plan };
}
const planned = (result: ReturnType<typeof dryRunArtifactReclaim>) => result.planned.map((item) => item.artifactId);
const skipOf = (result: ReturnType<typeof dryRunArtifactReclaim>, id: string) => result.skipped.find((skip) => skip.artifactId === id);

/**
 * Each holder kind, alone, keeps an artifact the retired run also names. `name(x)` writes the live holder; `reason` is
 * the skip it must report. Mutation per row: stop reading that holder (or read its owner as retired) -> x is planned, red.
 */
const HOLDERS: Array<{ kind: string; reason: string; name(store: ControlStore, x: Ref): void }> = [
  { kind: "a live run's body", reason: "group-not-archived", name: (s, x) => setRunBody(s, "run-live", { artifacts: [x] }) },
  { kind: "a checkpoint of a live run", reason: "group-not-archived", name: (s, x) => s.db.prepare("INSERT INTO checkpoints(id,run_id,hash,body) VALUES (?,?,?,?)").run("cp-1", "run-live", sha("cp"), JSON.stringify({ snapshot: x })) },
  { kind: "a usage event of a live run", reason: "group-not-archived", name: (s, x) => s.db.prepare("INSERT INTO usage_events(run_id,seq,payload_hash,body) VALUES (?,?,?,?)").run("run-live", 1, sha("u"), JSON.stringify({ proof: x })) },
  { kind: "attempt evidence of a live run", reason: "group-not-archived", name: (s, x) => s.db.prepare("INSERT INTO attempt_evidence(run_id,generation,phase,provider_attempt_ordinal,kind,body) VALUES (?,?,?,?,?,?)").run("run-live", 1, "work", 1, "adapter-stop-proof", JSON.stringify({ ref: x })) },
  { kind: "a decision of a live group", reason: "group-not-archived", name: (s, x) => s.db.prepare("INSERT INTO pending_decisions(id,group_id,run_id,ledger_run,entry_index,state,body) VALUES (?,?,?,?,?,?,?)").run("d1", "g-live", "run-live", "run-live", 0, "pending", JSON.stringify({ evidence: [x.artifactId] })) },
  { kind: "a command result of a live group", reason: "group-not-archived", name: (s, x) => s.db.prepare("INSERT INTO commands(group_id,id,payload_hash,result) VALUES (?,?,?,?)").run("g-live", "c1", sha("c"), JSON.stringify({ evidence: x })) },
  { kind: "a command's response bytes (BLOB) of a live group", reason: "group-not-archived", name: (s, x) => s.db.prepare("INSERT INTO commands(group_id,id,payload_hash,result,response_bytes) VALUES (?,?,?,?,?)").run("g-live", "c2", sha("c2"), "{}", Buffer.from(`{"ref":"${x.artifactId}"}`)) },
  { kind: "a live group's body", reason: "group-not-archived", name: (s, x) => s.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ status: "running", requirement: { attachment: x } }), "g-live") },
  { kind: "an undelivered outbox row, whoever it is for", reason: "outbox-undelivered", name: (s, x) => s.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,0)").run(`archive:${x.artifactId}`, "archive", JSON.stringify({ runId: "run-old", artifacts: [x] })) },
  { kind: "a delivered report row keyed by a live run (body names no run)", reason: "group-not-archived", name: (s, x) => s.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1)").run("report:run-live", "report", JSON.stringify({ source: x })) },
  { kind: "a delivered acceptance row of a live run", reason: "group-not-archived", name: (s, x) => s.db.prepare("INSERT INTO outbox(id,kind,body,delivered) VALUES (?,?,?,1)").run("acceptance:run-live", "acceptance", JSON.stringify({ runId: "run-live", accepted: true, source: x })) },
  { kind: "a flow step of a live group (owner through flow_runs)", reason: "group-not-archived", name: (s, x) => {
    s.db.prepare("INSERT INTO flow_runs(id,group_id,template_ref,template_sha256,workspace,params_sha256,pool_tokens,state,revision,body) VALUES (?,?,?,?,?,?,?,?,?,?)").run("flow-1", "g-live", "t", sha("t"), "w", sha("p"), 0, "running", 0, "{}");
    s.db.prepare("INSERT INTO step_executions(flow_run_id,step_key,seq,kind,kind_version,state,definition_hash,output_kind,output_ref,reasons,\"by\",via,created_at,updated_at,body) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("flow-1", "s1", 1, "k", 1, "done", sha("d"), "artifact", x.artifactId, "[]", "human", "web", OLD, OLD, "{}");
  } },
  { kind: "a global table (repository settings)", reason: "held-by:repository_settings", name: (s, x) => s.db.prepare("INSERT INTO repository_settings(repo_id,body) VALUES (?,?)").run("repo-1", JSON.stringify({ template: x })) },
  { kind: "a table the classification does not know", reason: "held-by:extra_holder", name: (s, x) => { s.db.exec("CREATE TABLE extra_holder(body TEXT NOT NULL) STRICT"); s.db.prepare("INSERT INTO extra_holder(body) VALUES (?)").run(`see ${x.artifactId}.`); } },
];

describe("orca gc --include-artifacts: every holder kind keeps what it names (#468)", () => {
  it.each(HOLDERS)("$kind", async ({ reason, name }) => {
    const { h, store, control, plan } = await world();
    try {
      const x = blob(store, "named by both");
      setRunBody(store, "run-old", { artifacts: [control, x] });
      name(store, x);
      const result = plan();
      expect(planned(result)).toEqual([control.artifactId]);
      expect(skipOf(result, x.artifactId)?.reason).toBe(reason);
    } finally { await h.dispose(); }
  });

  it("an id built from a live run's id (acceptance-<runId>) is kept although no row names it", async () => {
    const { h, store, control, plan } = await world();
    try {
      // mutation (drop the embedded-id rule) -> acceptance-run-live is named only by the retired run and planned, red.
      const x = seedArtifact(store, "acceptance-run-live", "{\"landing\":\"landed\"}");
      const y = seedArtifact(store, "acceptance-run-old", "{\"landing\":\"landed\"}");
      setRunBody(store, "run-old", { artifacts: [control, x] });
      const result = plan();
      expect(planned(result).sort()).toEqual([y.artifactId, control.artifactId].sort());
      expect(skipOf(result, x.artifactId)?.reason).toBe("group-not-archived");
    } finally { await h.dispose(); }
  });

  it("an id built from a hash a live row stores (checkpoint-<hash>) is kept", async () => {
    const { h, store, control, plan } = await world();
    try {
      // The id is built from a hash (resumeBundle.ts); the live checkpoint row stores only that hash.
      // mutation (index neither the row hash nor an id's 64-hex piece) -> the checkpoint artifact is planned, red.
      const bytes = "{\"checkpoint\":1}";
      const x = seedArtifact(store, `checkpoint-${sha(bytes)}`, bytes);
      setRunBody(store, "run-old", { artifacts: [control, x] });
      store.db.prepare("INSERT INTO checkpoints(id,run_id,hash,body) VALUES (?,?,?,?)").run("cp-live", "run-live", sha(bytes), "{}");
      const result = plan();
      expect(planned(result)).toEqual([control.artifactId]);
    } finally { await h.dispose(); }
  });

  it("a retired holder alone lets go, and a group archived inside --older-than keeps its runs' artifacts", async () => {
    const { h, store, control, plan } = await world();
    try {
      setRunBody(store, "run-old", { artifacts: [control] });
      seedGroup(store, "g-fresh", NOW - DAY);
      seedRun(store, "g-fresh", "run-fresh");
      const fresh = blob(store, "fresh archive");
      setRunBody(store, "run-fresh", { artifacts: [fresh] });
      const result = plan();
      expect(planned(result)).toEqual([control.artifactId]);
      // mutation (ignore the archive mark's age) -> fresh is planned, red.
      expect(skipOf(result, fresh.artifactId)?.reason).toBe("group-archived-recently");
      // nothing named at all is kept, never guessed away
      const orphan = blob(store, "named by nothing");
      expect(skipOf(plan(), orphan.artifactId)?.reason).toBe("unreferenced");
    } finally { await h.dispose(); }
  });
});

describe("the reference scan goes through artifact contents and fails closed (#468)", () => {
  it("a blob a live manifest names, two levels down, is kept", async () => {
    const { h, store, control, plan } = await world();
    try {
      const leaf = blob(store, "leaf bytes");
      const tree = seedArtifact(store, `snapshot-${sha("t")}`, JSON.stringify({ tree: [{ path: "a", ref: leaf }] }));
      const manifest = seedArtifact(store, `archive-${sha("m")}`, JSON.stringify({ snapshot: tree }));
      setRunBody(store, "run-old", { artifacts: [control, leaf, tree] });
      setRunBody(store, "run-live", { artifacts: [manifest] });
      const result = plan();
      // mutation (do not expand live contents) -> leaf and tree are named only by the retired run and planned, red.
      expect(planned(result)).toEqual([control.artifactId]);
      expect(skipOf(result, leaf.artifactId)).toMatchObject({ reason: "group-not-archived", detail: `named by ${tree.artifactId}` });
    } finally { await h.dispose(); }
  });

  it("contents that do not parse still hold what they name", async () => {
    const { h, store, control, plan } = await world();
    try {
      const x = blob(store, "inside garbage");
      // Truncated JSON with a NUL and a log line: no parser reads it, the token scan does.
      const capsule = seedArtifact(store, "evidence-capsule-1", Buffer.concat([Buffer.from(`{"artifacts":{"normalization":"${x.artifactId}`), Buffer.from([0, 255, 10]), Buffer.from("log: wrote ok")]));
      setRunBody(store, "run-old", { artifacts: [control, x] });
      setRunBody(store, "run-live", { capsule: capsule.artifactId });
      // mutation (JSON.parse contents, skip on failure) -> x is planned, red.
      expect(planned(plan())).toEqual([control.artifactId]);
    } finally { await h.dispose(); }
  });

  it("a held artifact whose contents cannot be read stops the whole plan", async () => {
    const { h, store, control, plan } = await world();
    try {
      setRunBody(store, "run-old", { artifacts: [control] });
      const held = blob(store, "held, then replaced");
      setRunBody(store, "run-live", { artifacts: [held] });
      expect(planned(plan())).toEqual([control.artifactId]);
      // Its data becomes a symbolic link: what it names can no longer be known.
      const data = join(store.stateDir, "artifacts", held.artifactId, "data");
      rmSync(data);
      symlinkSync(join(store.stateDir, "artifacts", control.artifactId, "data"), data);
      const result = plan();
      // mutation (skip an unreadable held artifact as if it named nothing) -> control is still planned, red.
      expect(planned(result)).toEqual([]);
      expect(result.scan.incomplete).toBe(`${held.artifactId} (data-symlink)`);
      expect(skipOf(result, control.artifactId)?.reason).toBe("reference-scan-incomplete");
      // bytes that are gone name nothing a reader could reach: the plan stands again
      rmSync(join(store.stateDir, "artifacts", held.artifactId), { recursive: true });
      expect(planned(plan())).toEqual([control.artifactId]);
    } finally { await h.dispose(); }
  });

  it("matches ids at separator boundaries, never inside a run of letters", () => {
    const index = new Set(["sha256-abc", "run-1", "abc"]);
    const out = new Set<string>();
    keysIn("x:sha256-abc.txt artifacts/run-1/data zabc", index, out);
    // "zabc" is not "abc"; "sha256-abc.txt" holds "sha256-abc" and "abc"
    expect([...out].sort()).toEqual(["abc", "run-1", "sha256-abc"]);
  });
});

describe("the holder classification covers the store (#468)", () => {
  it("every table and column of a fresh store is classified, and nothing else is", async () => {
    const h = await openTestStore();
    try {
      // mutation (a migration adds a table or a column, or an entry is dropped from ARTIFACT_HOLDER_TABLES) -> red: decide
      // who owns its rows before gc may free what it names.
      const tables = (h.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
      const actual = Object.fromEntries(tables.map((table) => [table, (h.store.db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name).sort()]));
      const classified = Object.fromEntries(Object.entries(ARTIFACT_HOLDER_TABLES).map(([table, spec]) => [table, [...spec.columns].sort()]));
      expect(classified).toEqual(actual);
      // and nothing besides sqlite's own tables and views holds data the scan does not read
      expect(h.store.db.prepare("SELECT name, type FROM sqlite_master WHERE type NOT IN ('table','index','trigger')").all()).toEqual([]);
    } finally { await h.dispose(); }
  });
});

describe("the dry run says what holds the space (#468)", () => {
  it("totals kept bytes by reason with the groups behind them, names the next step, and removes nothing", async () => {
    const { h, store, control, plan } = await world();
    try {
      seedGroup(store, "g-live-2", null);
      seedRun(store, "g-live-2", "run-live-2");
      const a = blob(store, "a".repeat(1000));
      const b = blob(store, "b".repeat(3000));
      setRunBody(store, "run-live", { artifacts: [a] });
      setRunBody(store, "run-live-2", { artifacts: [b] });
      setRunBody(store, "run-old", { artifacts: [control] });
      const result = plan();
      // mutation (count without bytes, or count runs instead of distinct groups) -> red.
      expect(result.skippedByReason).toEqual([{ reason: "group-not-archived", count: 2, groups: 2, bytes: 4000 }]);
      expect(result.bytes).toBe("retired only".length);
      expect(result.heldBytes).toBe(4000);
      const text = formatGc({ dryRun: true, planned: [], removed: [], skipped: [], skippedByReason: [], bytes: 0, unregisterPlanned: [], unregistered: [], artifacts: result });
      expect(text).toContain("artifacts: 1 planned, 0 removed, 2 kept; would free 12B; 3.9K kept");
      expect(text).toContain("kept by reason: group-not-archived 2 (3.9K, 2 groups)");
      expect(text).toContain("next: 3.9K held by 2 groups not archived; archive them first: orca group archive <groupId>");
      expect(text).toContain(`would remove artifact ${control.artifactId}`);
      expect(existsSync(join(store.stateDir, "artifacts", control.artifactId, "data"))).toBe(true);
      expect(store.db.prepare("SELECT id FROM artifacts WHERE id=?").get(control.artifactId)).toBeDefined();
    } finally { await h.dispose(); }
  });
});

describe("the panel deletes, and a write of the same content id is serialized with it (#468)", () => {
  it("apply removes the directory and the row of a planned artifact; a live one stays readable", async () => {
    const { h, store, control } = await world();
    try {
      const kept = blob(store, "live");
      setRunBody(store, "run-old", { artifacts: [control] });
      setRunBody(store, "run-live", { artifacts: [kept] });
      const result = applyArtifactReclaim(store, { now: NOW, pinned: new Set() });
      expect(result.removed.map((item) => item.artifactId)).toEqual([control.artifactId]);
      expect(existsSync(join(store.stateDir, "artifacts", control.artifactId))).toBe(false);
      expect(store.db.prepare("SELECT id FROM artifacts WHERE id=?").get(control.artifactId)).toBeUndefined();
      expect((await readArtifact(store, kept)).toString()).toBe("live");
    } finally { await h.dispose(); }
  });

  it("an id a writer is publishing when the panel deletes is kept, and the write succeeds", async () => {
    const { h, store } = await world();
    try {
      // The retired run names the content; a live writer publishes the same bytes (a content id is shared by design).
      const bytes = Buffer.from("shared content");
      const id = `sha256-${sha(bytes)}`;
      seedArtifact(store, id, bytes);
      setRunBody(store, "run-old", { artifacts: [{ artifactId: id, hash: sha(bytes) }] });
      let during: ReturnType<typeof applyArtifactReclaim> | undefined;
      // The writer has found the existing directory and is reading it; the panel's whole delete step runs right here.
      const ref = await writeArtifact(store, id, bytes, { beforeDuplicateRead: async () => { during = applyArtifactReclaim(store, { now: NOW, pinned: publishedArtifactIds() }); } });
      // mutation (publish() does not note the id) -> the step deletes it under the writer, whose write then fails with
      // ENOENT (a live run's write) -- red here, before the assertions.
      expect(during?.removed).toEqual([]);
      expect(during?.skipped.find((skip) => skip.artifactId === id)?.reason).toBe("published-since-panel-start");
      expect((await readArtifact(store, ref)).equals(bytes)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("a write after the delete publishes the content afresh", async () => {
    const { h, store } = await world();
    try {
      const bytes = Buffer.from("deleted, then written again");
      const id = `report-run-old-${sha(bytes)}`;
      seedArtifact(store, id, bytes);
      setRunBody(store, "run-old", { artifacts: [{ artifactId: id, hash: sha(bytes) }] });
      expect(applyArtifactReclaim(store, { now: NOW, pinned: new Set() }).removed.map((item) => item.artifactId)).toEqual([id]);
      const ref = await writeArtifact(store, id, bytes);
      expect((await readArtifact(store, ref)).equals(bytes)).toBe(true);
    } finally { await h.dispose(); }
  });
});
