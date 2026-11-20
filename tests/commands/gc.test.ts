/**
 * Issue #366 (the retention/GC half): `orca gc` is a dry run by default and reclaims only what it can prove is safe --
 * a run whose group carries a terminal mark (archived/closed), whose own state is terminal, that is inactive and already
 * cleaned up, older than --older-than (or beyond --keep-last), and whose registered worktree is clean (git removes it,
 * never --force). Rule 17: every path here is a temp state dir; nothing reads or writes the real ~/.orca.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openTestStore } from "../control/fixtures/store.js";
import { gcControl } from "../../src/control/gc.js";
import { runGc } from "../../src/commands/local/gc.js";
import { runStatus } from "../../src/commands/status.js";
import type { CommandIo, ParsedArgs } from "../../src/commands/types.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);
const OLD = NOW - 90 * DAY;
const roots: string[] = [];
afterAll(() => { for (const root of roots) rm(root, { recursive: true, force: true }); });

async function caseDir() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-gc-")));
  roots.push(root);
  const h = await openTestStore();
  return { root, h, stateDir: h.store.stateDir, runsRoot: `${h.store.stateDir}.runs`, workspacesRoot: `${h.store.stateDir}.workspaces` };
}

function seedGroup(h: Awaited<ReturnType<typeof openTestStore>>, id: string, archived = true) {
  const body = { status: "done", ...(archived ? { archived: { at: NOW, actor: "human" } } : {}) };
  h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES (?,?,?,?)").run(id, 1, 1, JSON.stringify(body));
}

function seedRun(
  h: Awaited<ReturnType<typeof openTestStore>>, groupId: string, runId: string,
  options: { state?: string; active?: number; endedAt?: number; drive?: Record<string, unknown> } = {},
) {
  const body = {
    state: options.state ?? "settled",
    ...(options.endedAt === undefined ? {} : { endedAt: options.endedAt }),
    ...(options.drive === undefined ? {} : { drive: options.drive }),
  };
  h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES (?,?,?,?,?,?)")
    .run(runId, groupId, "T1", 1, options.active ?? 0, JSON.stringify(body));
}

async function makeRunDir(path: string, bytes: number, touchedAt: number) {
  await mkdir(path, { recursive: true });
  await writeFile(join(path, "payload.bin"), Buffer.alloc(bytes, 7));
  // The top directory's mtime is a backstop for old records with no endedAt; the walk does not descend for age.
  await utimes(path, touchedAt / 1000, touchedAt / 1000);
}

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "GC Test", GIT_AUTHOR_EMAIL: "gc@example.invalid", GIT_COMMITTER_NAME: "GC Test", GIT_COMMITTER_EMAIL: "gc@example.invalid" },
  });
}

async function repoWithCommit(root: string): Promise<string> {
  const repo = join(root, "target");
  await mkdir(repo, { recursive: true });
  git(repo, "init", "-q");
  await writeFile(join(repo, "tracked.txt"), "base\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "base");
  return repo;
}

const reasonOf = (result: Awaited<ReturnType<typeof gcControl>>, runId: string) => result.skipped.find((entry) => entry.runId === runId)?.reason;

describe("orca gc (#366)", () => {
  it("is a dry run: it reports the plans and removes nothing", async () => {
    const { h, stateDir, runsRoot, workspacesRoot } = await caseDir();
    try {
      seedGroup(h, "g-archived");
      seedRun(h, "g-archived", "run-a", { endedAt: OLD, drive: { cleanedUp: true, targetRepo: null } });
      await makeRunDir(join(runsRoot, "run-a"), 4096, OLD);
      await makeRunDir(join(workspacesRoot, "run-a"), 1024, OLD);

      const result = await gcControl({ stateDir, now: NOW });
      // mutation (apply unless asked) -> the directories below are gone, red.
      expect(result.dryRun).toBe(true);
      expect(result.removed).toEqual([]);
      expect(result.planned.map((entry) => entry.kind).sort()).toEqual(["runs", "workspaces"]);
      expect(result.bytes).toBeGreaterThanOrEqual(4096 + 1024);
      expect(existsSync(join(runsRoot, "run-a"))).toBe(true);
      expect(existsSync(join(workspacesRoot, "run-a"))).toBe(true);
    } finally { await h.dispose(); }
  });

  it("never deletes an active run or a run whose group is not terminal", async () => {
    const { h, stateDir, runsRoot, workspacesRoot } = await caseDir();
    try {
      seedGroup(h, "g-archived");
      seedGroup(h, "g-open", false);
      seedRun(h, "g-archived", "run-active", { active: 1, endedAt: OLD, drive: { cleanedUp: true } });
      seedRun(h, "g-open", "run-open", { endedAt: OLD, drive: { cleanedUp: true } });
      // The driver still retries a failed publish, so a settled run with one is not the GC's.
      seedRun(h, "g-archived", "run-publish", { endedAt: OLD, drive: { cleanedUp: true, publishError: "projection unavailable" } });
      for (const id of ["run-active", "run-open", "run-publish"]) {
        await makeRunDir(join(runsRoot, id), 512, OLD);
        await makeRunDir(join(workspacesRoot, id), 512, OLD);
      }

      const result = await gcControl({ stateDir, now: NOW, apply: true });
      // mutation (ignore active) -> run-active's directories are removed, red here.
      expect(reasonOf(result, "run-active")).toBe("run-active");
      // mutation (ignore the group mark) -> run-open's directories are removed, red here.
      expect(reasonOf(result, "run-open")).toBe("group-not-archived");
      // mutation (drop the publish guard) -> run-publish's directories are removed, red here.
      expect(reasonOf(result, "run-publish")).toBe("publish-pending");
      for (const id of ["run-active", "run-open", "run-publish"]) {
        expect(existsSync(join(runsRoot, id))).toBe(true);
        expect(existsSync(join(workspacesRoot, id))).toBe(true);
      }
    } finally { await h.dispose(); }
  });

  it("removes an archived, old, terminal run's directories with --apply, and nothing beside them", async () => {
    const { h, stateDir, runsRoot, workspacesRoot } = await caseDir();
    try {
      seedGroup(h, "g-archived");
      seedRun(h, "g-archived", "run-old", { endedAt: OLD, drive: { cleanedUp: true } });
      await makeRunDir(join(runsRoot, "run-old"), 4096, OLD);
      await makeRunDir(join(workspacesRoot, "run-old"), 2048, OLD);
      await mkdir(join(stateDir, "artifacts", "sha256-x"), { recursive: true });
      await writeFile(join(stateDir, "artifacts", "sha256-x", "data"), "keep me\n");
      await mkdir(join(stateDir, "staging"), { recursive: true });
      await writeFile(join(stateDir, "staging", "temp"), "keep me\n");

      const result = await gcControl({ stateDir, now: NOW, apply: true });
      // mutation (plan but never remove) -> both directories remain, red.
      expect(result.removed.map((entry) => entry.kind).sort()).toEqual(["runs", "workspaces"]);
      expect(result.planned.length).toBe(2);
      expect(result.skipped).toEqual([]);
      expect(result.bytes).toBeGreaterThanOrEqual(4096 + 2048);
      expect(existsSync(join(runsRoot, "run-old"))).toBe(false);
      expect(existsSync(join(workspacesRoot, "run-old"))).toBe(false);
      // mutation (scan the state dir itself) -> artifacts/staging/control.sqlite disappear, red.
      expect(existsSync(join(stateDir, "artifacts", "sha256-x", "data"))).toBe(true);
      expect(existsSync(join(stateDir, "staging", "temp"))).toBe(true);
      expect(existsSync(join(stateDir, "control.sqlite"))).toBe(true);
    } finally { await h.dispose(); }
  });

  it("--group limits the plan to one group's runs", async () => {
    const { h, stateDir, runsRoot } = await caseDir();
    try {
      seedGroup(h, "g-one");
      seedGroup(h, "g-two");
      for (const id of ["run-one", "run-two"]) seedRun(h, id === "run-one" ? "g-one" : "g-two", id, { endedAt: OLD, drive: { cleanedUp: true } });
      await makeRunDir(join(runsRoot, "run-one"), 128, OLD);
      await makeRunDir(join(runsRoot, "run-two"), 128, OLD);
      const result = await gcControl({ stateDir, now: NOW, apply: true, groupId: "g-one" });
      // mutation (ignore --group) -> run-two is removed too, red.
      expect(result.removed.map((entry) => entry.runId)).toEqual(["run-one"]);
      expect(existsSync(join(runsRoot, "run-one"))).toBe(false);
      expect(existsSync(join(runsRoot, "run-two"))).toBe(true);
    } finally { await h.dispose(); }
  });

  it("keeps a run that was touched within --older-than", async () => {
    const { h, stateDir, runsRoot } = await caseDir();
    try {
      seedGroup(h, "g-archived");
      seedRun(h, "g-archived", "run-recent", { endedAt: NOW - DAY, drive: { cleanedUp: true } });
      await makeRunDir(join(runsRoot, "run-recent"), 512, NOW - DAY);
      const result = await gcControl({ stateDir, now: NOW, apply: true });
      // mutation (drop the age check) -> the directory is removed, red.
      expect(reasonOf(result, "run-recent")).toBe("too-recent");
      expect(existsSync(join(runsRoot, "run-recent"))).toBe(true);
    } finally { await h.dispose(); }
  });

  it("--keep-last keeps the newest runs regardless of age", async () => {
    const { h, stateDir, runsRoot } = await caseDir();
    try {
      seedGroup(h, "g-archived");
      seedRun(h, "g-archived", "run-newer", { endedAt: OLD + 10 * DAY, drive: { cleanedUp: true } });
      seedRun(h, "g-archived", "run-older", { endedAt: OLD, drive: { cleanedUp: true } });
      await makeRunDir(join(runsRoot, "run-newer"), 256, OLD + 10 * DAY);
      await makeRunDir(join(runsRoot, "run-older"), 256, OLD);

      const result = await gcControl({ stateDir, now: NOW, apply: true, keepLast: 1 });
      // mutation (keep the oldest, or ignore keep-last) -> run-newer is removed, red.
      expect(reasonOf(result, "run-newer")).toBe("keep-last");
      expect(result.removed.map((entry) => entry.runId)).toEqual(["run-older"]);
      expect(existsSync(join(runsRoot, "run-newer"))).toBe(true);
      expect(existsSync(join(runsRoot, "run-older"))).toBe(false);
    } finally { await h.dispose(); }
  });

  it("skips a dirty registered worktree by name and removes a clean one", async () => {
    const { root, h, stateDir, workspacesRoot } = await caseDir();
    try {
      const repo = await repoWithCommit(root);
      seedGroup(h, "g-archived");
      const clean = join(workspacesRoot, "run-clean");
      const dirty = join(workspacesRoot, "run-dirty");
      await mkdir(workspacesRoot, { recursive: true });
      git(repo, "worktree", "add", "--detach", clean, "HEAD");
      git(repo, "worktree", "add", "--detach", dirty, "HEAD");
      await writeFile(join(dirty, "tracked.txt"), "uncommitted work\n");
      await utimes(clean, OLD / 1000, OLD / 1000);
      await utimes(dirty, OLD / 1000, OLD / 1000);
      seedRun(h, "g-archived", "run-clean", { endedAt: OLD, drive: { cleanedUp: true, targetRepo: repo } });
      seedRun(h, "g-archived", "run-dirty", { endedAt: OLD, drive: { cleanedUp: true, targetRepo: repo } });

      const result = await gcControl({ stateDir, now: NOW, apply: true });
      // mutation (add --force) -> the dirty worktree is removed, red here and below.
      expect(reasonOf(result, "run-dirty")).toBe("worktree-dirty");
      expect(existsSync(dirty)).toBe(true);
      expect(await readFile(join(dirty, "tracked.txt"), "utf8")).toBe("uncommitted work\n");
      expect(result.removed.map((entry) => entry.runId)).toEqual(["run-clean"]);
      expect(existsSync(clean)).toBe(false);
      // registered only while it existed: git no longer lists the clean worktree
      expect(git(repo, "worktree", "list", "--porcelain")).not.toContain(`worktree ${clean}\n`);
    } finally { await h.dispose(); }
  });

  it("ignores non-run directory names and directory traversal", async () => {
    const { h, stateDir, runsRoot, workspacesRoot } = await caseDir();
    try {
      seedGroup(h, "g-archived");
      await mkdir(join(workspacesRoot, "landing-run-x"), { recursive: true });
      await mkdir(join(workspacesRoot, "skills-run-y"), { recursive: true });
      await mkdir(join(workspacesRoot, "not-a-run"), { recursive: true });
      await mkdir(join(runsRoot, "check-run-z"), { recursive: true });
      await utimes(join(workspacesRoot, "landing-run-x"), OLD / 1000, OLD / 1000);
      const stray = join(runsRoot, "..", "outside-run");
      await mkdir(stray, { recursive: true });
      await utimes(stray, OLD / 1000, OLD / 1000);

      const result = await gcControl({ stateDir, now: NOW, apply: true });
      // mutation (treat every child as a run) -> these appear in the plan, red.
      expect(result.planned).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(existsSync(join(workspacesRoot, "landing-run-x"))).toBe(true);
      expect(existsSync(join(workspacesRoot, "not-a-run"))).toBe(true);
      expect(existsSync(stray)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("names a directory whose run is not in the store, and one whose run is not terminal", async () => {
    const { h, stateDir, runsRoot } = await caseDir();
    try {
      seedGroup(h, "g-archived");
      seedRun(h, "g-archived", "run-open", { state: "landed", endedAt: OLD, drive: { cleanedUp: true } });
      await makeRunDir(join(runsRoot, "run-orphan"), 128, OLD);
      await makeRunDir(join(runsRoot, "run-open"), 128, OLD);
      const result = await gcControl({ stateDir, now: NOW, apply: true });
      // mutation (skip only when the row is missing) -> run-open is removed, red.
      expect(reasonOf(result, "run-orphan")).toBe("run-not-found");
      expect(reasonOf(result, "run-open")).toBe("run-not-terminal:landed");
      expect(existsSync(join(runsRoot, "run-orphan"))).toBe(true);
      expect(existsSync(join(runsRoot, "run-open"))).toBe(true);
    } finally { await h.dispose(); }
  });
});

function parsed(flags: Record<string, string | number | boolean>, stateDir: string): ParsedArgs {
  return { positionals: {}, flags, global: { json: false, quiet: false, verbose: false, help: false, asPerson: false, controlStateDir: stateDir } };
}
function capture(): { io: CommandIo; out: () => string; err: () => string } {
  let out = "", err = "";
  return {
    // process.env, not {}: the vitest setup relocates ORCA_PROJECTS_FILE away from the person's real ~/.orca (Rule 17).
    io: { stdout: (text) => { out += text; }, stderr: (text) => { err += text; }, env: process.env, cwd: process.cwd(), stdinIsTTY: false },
    out: () => out, err: () => err,
  };
}

describe("orca gc --json (#366)", () => {
  it("prints one body with planned, removed, skipped and bytes, and removes nothing without --apply", async () => {
    const { h, stateDir, runsRoot } = await caseDir();
    try {
      seedGroup(h, "g-archived");
      seedRun(h, "g-archived", "run-a", { endedAt: OLD, drive: { cleanedUp: true } });
      await makeRunDir(join(runsRoot, "run-a"), 512, OLD);
      const { io, out } = capture();
      const args = parsed({ json: true }, stateDir);
      args.global.json = true;
      expect(await runGc(args, io)).toBe(0);
      const line = JSON.parse(out().trim()) as { status: number; body: { planned: Array<{ runId: string }>; removed: unknown[]; skipped: unknown[]; bytes: number } };
      expect(line.status).toBe(200);
      expect(line.body.planned.map((entry) => entry.runId)).toEqual(["run-a"]);
      expect(line.body.removed).toEqual([]);
      expect(line.body.skipped).toEqual([]);
      expect(line.body.bytes).toBeGreaterThanOrEqual(512);
      expect(existsSync(join(runsRoot, "run-a"))).toBe(true);
    } finally { await h.dispose(); }
  });
});

describe("orca status --disk (#366)", () => {
  it("adds the disk section only when --disk is given", async () => {
    const { h, stateDir, runsRoot } = await caseDir();
    try {
      await makeRunDir(join(runsRoot, "run-big"), 8192, NOW);
      const plain = capture();
      const plainArgs = parsed({}, stateDir);
      plainArgs.global.json = true;
      expect(await runStatus(plainArgs, plain.io, [])).toBe(0);
      expect((JSON.parse(plain.out().trim()) as { body: { checks: unknown[] } }).body.checks).toEqual([]);

      const disk = capture();
      const args = parsed({ disk: true }, stateDir);
      args.global.json = true;
      expect(await runStatus(args, disk.io, [])).toBe(0);
      const checks = (JSON.parse(disk.out().trim()) as { body: { checks: Array<{ subject: string; fact: string }> } }).body.checks;
      // mutation (always include the section) -> the first, plain run has checks, red.
      expect(checks.map((check) => check.subject)).toEqual(["disk", "disk-top"]);
      expect(checks[0]!.fact).toContain("runs ");
      expect(checks[1]!.fact).toContain("run-big");
    } finally { await h.dispose(); }
  });
});