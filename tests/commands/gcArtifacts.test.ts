/**
 * Tester #468 (human ruling 2026-11-25, session 5d3d0c09): `orca gc --include-artifacts` -- the dry run reads the store in
 * the CLI, `--apply` asks the panel, which deletes. End to end through the CLI and a panel PROCESS (spawned, as an installed
 * panel runs). Rule 17: the store, the projects file, HOME and the socket are this criterion's temp root, never ~/.orca.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";
import { cli } from "./fixtures/fakePanel.js";

const DAY = 86_400_000;
const OLD = Date.now() - 90 * DAY;
const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const roots: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    const closed = new Promise((resolve) => child.once("close", resolve));
    child.kill("SIGTERM");
    await closed;
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A store with one archived group (archived and ended 90 days ago: retired) and one open group. `retired` is named only by
 * the archived group's run, `live` by the open group's run, which also names `manifest`, whose contents name `nested`
 * (the retired run names `nested` too). The archived run also has a `.runs` directory gc's run pass would remove.
 */
async function world() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "gca-")));
  roots.push(root);
  const state = join(root, "s");
  const store = await openControlStore({ stateDir: state });
  const artifact = (id: string, text: string) => {
    mkdirSync(join(state, "artifacts", id), { recursive: true, mode: 0o700 });
    writeFileSync(join(state, "artifacts", id, "data"), text, { mode: 0o600 });
    store.db.prepare("INSERT INTO artifacts(id,hash,body) VALUES (?,?,?)").run(id, sha(text), JSON.stringify({ path: `artifacts/${id}/data` }));
    return { artifactId: id, hash: sha(text) };
  };
  const retired = artifact(`sha256-${sha("retired")}`, "retired");
  const live = artifact(`sha256-${sha("live")}`, "live");
  const nested = artifact(`sha256-${sha("nested")}`, "nested");
  const manifest = artifact(`archive-${sha("m")}`, JSON.stringify({ logs: [{ path: "x.log", ref: nested }] }));
  const body = (artifacts: unknown[]) => JSON.stringify({ state: "settled", endedAt: OLD, drive: { cleanedUp: true }, artifacts });
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,?,?,?)").run("g-old", 1, 1, JSON.stringify({ status: "done", archived: { at: OLD, actor: "human" } }));
  store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,?,?,?)").run("g-open", 1, 1, JSON.stringify({ status: "done" }));
  store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,?,?)").run("run-old", "g-old", "T1", 1, 0, body([retired, nested]));
  store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,?,?)").run("run-open", "g-open", "T1", 1, 0, body([live, manifest]));
  store.close();
  const runDir = join(`${state}.runs`, "run-old");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "payload.bin"), "x");
  utimesSync(runDir, OLD / 1000, OLD / 1000);
  const home = join(root, "home");
  mkdirSync(join(home, ".orca"), { recursive: true });
  const projects = join(home, "projects.json");
  writeFileSync(projects, JSON.stringify({ version: 1, projects: [] }));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, ORCA_CONTROL_DIR: join(root, "control"), ORCA_CORRECTIONS_DIR: join(root, "corrections"), ORCA_PROJECTS_FILE: projects, ORCA_AGENTS_TABLE: join(home, ".orca", "agents.json"), ORCA_CCLOOP_BIN: "" };
  delete env.ORCA_DISPATCHED_RUN;
  const present = (id: string) => existsSync(join(state, "artifacts", id)) && rowOf(state, id);
  return { root, state, env, projects, retired, live, nested, manifest, runDir, present };
}

function rowOf(state: string, id: string): boolean {
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { db.exec("PRAGMA busy_timeout=5000"); return db.prepare("SELECT id FROM artifacts WHERE id=?").get(id) !== undefined; }
  finally { db.close(); }
}

/** The panel as a process of its own (`orca panel`), on this criterion's store; resolves once its socket is listening. */
async function spawnPanel(w: Awaited<ReturnType<typeof world>>): Promise<ChildProcess> {
  const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
  // The Web build is not this criterion's subject: a one-page dist stands in for it.
  const dist = join(w.root, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>orca</title>");
  const child = spawn(tsx, ["src/cli.ts", "panel", "--by", "tester", "--port", "0", "--dist", dist, "--control-state-dir", w.state, "--projects-file", w.projects], { cwd: process.cwd(), env: w.env });
  children.push(child);
  let stderr = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no socket line: ${stderr}`)), 90_000);
    child.stderr!.on("data", (chunk) => { stderr += chunk; if (/orca-panel: control socket .*control\.sock\n/.test(stderr)) { clearTimeout(timer); resolve(); } });
    child.once("close", (code) => { clearTimeout(timer); reject(new Error(`panel exited ${code}: ${stderr}`)); });
  });
  return child;
}

const run = (w: Awaited<ReturnType<typeof world>>, argv: string[]) => cli(argv, w.state, { env: w.env });

describe("orca gc --include-artifacts (tester #468)", { timeout: 180_000 }, () => {
  it("without the flag the body carries no artifacts section", async () => {
    const w = await world();
    const out = await run(w, ["gc", "--json"]);
    expect(out.code).toBe(0);
    // mutation (always plan artifacts) -> the key is there, red: today's gc output must stay byte-identical without the flag.
    expect(Object.hasOwn(out.json().body, "artifacts")).toBe(false);
  });

  it("the dry run plans the retired artifact, keeps the rest by reason with bytes, and touches nothing", async () => {
    const w = await world();
    const out = await run(w, ["gc", "--include-artifacts", "--json"]);
    expect(out.code).toBe(0);
    const artifacts = out.json().body.artifacts;
    expect(artifacts.dryRun).toBe(true);
    expect(artifacts.planned.map((item: { artifactId: string }) => item.artifactId)).toEqual([w.retired.artifactId]);
    // `nested` is named by the retired run AND by the live manifest's contents: kept.
    expect(artifacts.skippedByReason).toEqual([{ reason: "group-not-archived", count: 3, groups: 1, bytes: "live".length + "nested".length + JSON.stringify({ logs: [{ path: "x.log", ref: w.nested }] }).length }]);
    for (const ref of [w.retired, w.live, w.nested, w.manifest]) expect(w.present(ref.artifactId)).toBe(true);
    const text = await run(w, ["gc", "--include-artifacts"]);
    expect(text.stdout).toContain("next: ");
    expect(text.stdout).toContain("held by 1 group not archived; archive them first: orca group archive <groupId>");
  });

  it("with no panel running, --apply refuses by name and removes nothing, the run trees included", async () => {
    const w = await world();
    const out = await run(w, ["gc", "--include-artifacts", "--apply", "--json"]);
    // mutation (run the run pass first, or delete in the CLI) -> the run directory or the artifact is gone, red.
    expect(out.code).toBe(1);
    expect(out.json().body.error.code).toBe("panel-not-running");
    expect(out.json().body.error.message).toContain("nothing was removed");
    expect(existsSync(w.runDir)).toBe(true);
    expect(w.present(w.retired.artifactId)).toBe(true);
  });

  it("--apply through a running panel process deletes the retired artifact; every kept one still reads back", async () => {
    const w = await world();
    await spawnPanel(w);
    const out = await run(w, ["gc", "--include-artifacts", "--apply", "--json"]);
    expect(out.code, out.stderr + out.stdout).toBe(0);
    const body = out.json().body;
    expect(body.artifacts.dryRun).toBe(false);
    expect(body.artifacts.removed.map((item: { artifactId: string }) => item.artifactId)).toEqual([w.retired.artifactId]);
    expect(w.present(w.retired.artifactId)).toBe(false);
    for (const ref of [w.live, w.nested, w.manifest]) expect(w.present(ref.artifactId)).toBe(true);
    // the run pass ran after the panel answered
    expect(existsSync(w.runDir)).toBe(false);
    // Every id a surviving row names still reads back with its row's hash (readArtifact's check; the panel holds the
    // store, so it is read here without opening a second writer), and the store is intact.
    const db = new DatabaseSync(join(w.state, "control.sqlite"), { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout=5000");
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
      for (const ref of [w.live, w.nested, w.manifest]) {
        expect(db.prepare("SELECT hash FROM artifacts WHERE id=?").get(ref.artifactId)).toEqual({ hash: ref.hash });
        expect(sha(readFileSync(join(w.state, "artifacts", ref.artifactId, "data"), "utf8"))).toBe(ref.hash);
      }
    } finally { db.close(); }
    // A second apply finds nothing more to do.
    const again = await run(w, ["gc", "--include-artifacts", "--apply", "--json"]);
    expect(again.json().body.artifacts.removed).toEqual([]);
  });
});
