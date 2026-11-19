// Working-tree delivery spec 2026-11-19 §4.3-§4.4, §7, §10.1 WT-1..WT-17 (#365): a complete, accepted group's change is
// written into the registered checkout, uncommitted, under a per-path guard. Real git in a temporary registered
// repository (never a real one, Rule 17); the pass is driven directly; no agent runs.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { integratePendingGroups, type IntegrationDeps } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration, type GroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import { labelDecisions, ledgerSources } from "../../src/control/ledgerAtRef.js";
import type { ControlStore } from "../../src/control/store.js";
import { sweepWorkingTreeStaging } from "../../src/control/workingTreeDelivery.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { webFixture } from "./fixtures/web.js";

const WT: IntegrationScheme = { delivery: "working-tree" };
const LOCAL: IntegrationScheme = { delivery: "local", trigger: "group", method: "merge", target: "main" };

// core.protectHFS/NTFS off for the test's own plumbing only, so a `.GIT` path can be committed to be refused (WT-9).
const gRaw = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "-c", "core.protectHFS=false", "-c", "core.protectNTFS=false", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...unsetInheritedGitEnv(), ...options.env } });
const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string => gRaw(cwd, args, options).trim();

type Op = string | { text: string; mode?: "100644" | "100755" | "120000" | "160000" } | null;
/** A commit on `ref` whose tree is `parent`'s with `ops` applied (null deletes), made with plumbing (no checkout). */
function commitOn(repo: string, ref: string, ops: Record<string, Op>, parentRef = ref): string {
  const parent = g(repo, ["rev-parse", parentRef]);
  const env = { GIT_INDEX_FILE: join(repo, ".git", `wt-test-index-${process.pid}`) };
  g(repo, ["read-tree", parent], { env });
  for (const [path, op] of Object.entries(ops)) {
    if (op === null) { g(repo, ["update-index", "--force-remove", "--", path], { env }); continue; }
    const { text, mode = "100644" } = typeof op === "string" ? { text: op } : op;
    const oid = mode === "160000" ? text : g(repo, ["hash-object", "-w", "--stdin"], { input: text });
    g(repo, ["update-index", "--add", "--cacheinfo", `${mode},${oid},${path}`], { env });
  }
  const tree = g(repo, ["write-tree"], { env });
  const commit = g(repo, ["commit-tree", tree, "-p", parent, "-m", "land"]);
  g(repo, ["update-ref", ref, commit]);
  return commit;
}

const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");
/** Every file of the checkout (not .git) with its sha256 or link target, for byte-equal before/after. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), rel = relative(root, path);
      if (rel === ".git") continue;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) out[rel] = `link:${readlinkSync(path)}`;
      else if (stat.isDirectory()) { out[`${rel}/`] = "dir"; walk(path); }
      else out[rel] = `${(stat.mode & 0o777).toString(8)}:${sha(path)}`;
    }
  };
  walk(root);
  return out;
}

async function world(scheme: IntegrationScheme = WT) {
  const h = await webFixture();
  const repo = join(h.root, "checkout");
  mkdirSync(repo);
  g(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "a.txt"), "one\n");
  writeFileSync(join(repo, "d.txt"), "gone\n");
  mkdirSync(join(repo, "sub")); writeFileSync(join(repo, "sub", "only.txt"), "x\n");
  mkdirSync(join(repo, "keep")); writeFileSync(join(repo, "keep", "k1.txt"), "1\n"); writeFileSync(join(repo, "keep", "k2.txt"), "2\n");
  writeFileSync(join(repo, ".gitignore"), "*.log\n");
  g(repo, ["add", "-A"]); g(repo, ["commit", "-qm", "base"]);
  const base = g(repo, ["rev-parse", "HEAD"]);
  g(repo, ["update-ref", "refs/heads/orca/g", base]);
  const groupBody = (id = "g"): Record<string, unknown> => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id)!.body)) as Record<string, unknown>;
  const writeBody = (body: Record<string, unknown>, id = "g") => h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), id);
  writeBody({ ...groupBody(), integration: { ...newGroupIntegration(scheme)!, frozen: true } });
  // The first work run's base is the group's base (groupBaseCommit).
  h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-a','g','a',1,0,?)")
    .run(JSON.stringify({ runId: "run-a", groupId: "g", workItemId: "a", taskId: "a", phase: "work", state: "settled", drive: { base } }));
  const record = (id = "g"): GroupIntegration => readGroupIntegration(groupBody(id))!;
  const setRecord = (integration: GroupIntegration, id = "g") => writeBody({ ...groupBody(id), integration }, id);
  /** The group as the driver leaves it finished: its task done, accepted (nothing to run). */
  const finish = (id = "g") => {
    for (const row of h.store.db.prepare("SELECT id, body FROM work_items WHERE group_id=?").all(id))
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), status: "done" }), id, String(row.id));
    writeBody({ ...groupBody(id), status: "done", acceptance: { tip: null, result: "not-needed", why: "single-landing", commands: [], at: 1, fullSuite: { command: null, suggestion: null, exits: [], flaky: false } } }, id);
  };
  const deps = (extra: Partial<IntegrationDeps> = {}): IntegrationDeps => ({
    store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), admissionGate: h.deps.admissionGate, repoPathOf: () => repo,
    now: () => 1_000_000, ghBin: "/nonexistent/gh", stopped: () => false, ...extra,
  });
  return {
    ...h, repo, base, groupBody, writeBody, record, setRecord, finish,
    land: (ops: Record<string, Op>, ref = "refs/heads/orca/g") => commitOn(repo, ref, ops),
    pass: (extra: Partial<IntegrationDeps> = {}) => integratePendingGroups(deps(extra)),
    status: () => gRaw(repo, ["status", "--porcelain=v1", "--untracked-files=all"]).replace(/\n$/, ""),
    indexSha: () => sha(join(repo, ".git", "index")),
    heads: () => g(repo, ["for-each-ref", "refs/heads"]),
    staging: () => join(repo, ".git", "orca", "deliver-g"),
    sql: (text: string, ...args: unknown[]) => (h.store as ControlStore).db.prepare(text).run(...(args as never[])),
  };
}
type World = Awaited<ReturnType<typeof world>>;
afterEach(() => { vi.unstubAllEnvs(); });

const at = (w: World, path: string) => join(w.repo, path);
const text = (w: World, path: string) => readFileSync(at(w, path), "utf8");

describe("working-tree delivery (spec §4.4)", { timeout: 60_000 }, () => {
  it("WT-1: an added-only group's files appear untracked; HEAD, every branch and the live index are byte-equal", async () => {
    const w = await world(); try {
      w.land({ "docs/X.md": "x\n", "new.txt": "n\n" });
      w.finish();
      const head = g(w.repo, ["rev-parse", "HEAD"]), heads = w.heads(), index = w.indexSha();
      // mutations: write through the live index (index sha differs) or commit the result (HEAD differs) -> red here
      expect(await w.pass()).toBe(true);
      expect(w.status()).toBe("?? docs/X.md\n?? new.txt");
      expect(g(w.repo, ["rev-parse", "HEAD"])).toBe(head);
      expect(w.heads()).toBe(heads);
      expect(w.indexSha()).toBe(index);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: g(w.repo, ["rev-parse", "orca/g"]), integratedCommit: null, pending: null });
      expect(existsSync(w.staging())).toBe(false);
    } finally { await w.dispose(); }
  });

  it("WT-2: modify, delete, binary, symlink and an executable-bit flip land as the tip; other mode bits are kept", async () => {
    const w = await world(); try {
      // The person's a.txt is 0640; the group adds its executable bit.
      chmodSync(at(w, "a.txt"), 0o640);
      g(w.repo, ["config", "core.fileMode", "true"]);
      const bin = "\u0000\u0001binaryÿ";
      w.land({ "a.txt": { text: "one\n", mode: "100755" }, "d.txt": null, "sub/only.txt": null, "keep/k1.txt": null, "b.bin": bin, "link": { text: "a.txt", mode: "120000" }, "x.sh": { text: "#!/bin/sh\n", mode: "100755" } });
      w.finish();
      expect(await w.pass()).toBe(true);
      expect(w.record().state).toBe("idle");
      // mutation: chmod from the git mode alone (0755) -> 0755 here, red
      expect((statSync(at(w, "a.txt")).mode & 0o777).toString(8)).toBe("750");
      expect(existsSync(at(w, "d.txt"))).toBe(false);
      expect(readFileSync(at(w, "b.bin"), "utf8")).toBe(bin);
      expect(readlinkSync(at(w, "link"))).toBe("a.txt");
      expect((statSync(at(w, "x.sh")).mode & 0o777).toString(8)).toBe("755");
      // The emptied parent is removed; a non-empty one is kept.
      expect(existsSync(at(w, "sub"))).toBe(false);
      expect(existsSync(at(w, "keep/k2.txt"))).toBe(true);
      expect(text(w, "a.txt")).toBe("one\n");
    } finally { await w.dispose(); }
  });

  it("WT-3: a touched path the person edited is a conflict and every file of the checkout is byte-equal", async () => {
    const w = await world(); try {
      w.land({ "a.txt": "theirs\n", "new.txt": "n\n" });
      w.finish();
      // The person committed nothing; they edited a.txt in place (HEAD:a.txt is still `from`'s).
      writeFileSync(at(w, "a.txt"), "mine\n");
      const before = snapshot(w.repo);
      // mutations: drop the `have ∈ was` comparison, or compare against HEAD:a.txt instead of the checkout -> red here
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-working-tree-conflict:a.txt", pending: null });
      expect(snapshot(w.repo)).toEqual(before);
    } finally { await w.dispose(); }
  });

  it("WT-4: an untracked and an ignored file where a new file goes are conflicts, untouched", async () => {
    for (const name of ["n.txt", "n.log"]) {
      const w = await world(); try {
        w.land({ [name]: "group\n" });
        w.finish();
        writeFileSync(at(w, name), "person\n");
        // mutation: treat "absent at from" as writable without reading the checkout -> overwritten, red
        expect(await w.pass()).toBe(true);
        expect(w.record().reason).toBe(`integration-working-tree-conflict:${name}`);
        expect(text(w, name)).toBe("person\n");
      } finally { await w.dispose(); }
    }
  });

  it("WT-5: unrelated dirty edits and staged work survive byte-for-byte and stay staged", async () => {
    const w = await world(); try {
      w.land({ "new.txt": "n\n" });
      w.finish();
      writeFileSync(at(w, "keep/k1.txt"), "dirty\n");
      writeFileSync(at(w, "keep/k2.txt"), "staged\n"); g(w.repo, ["add", "keep/k2.txt"]);
      writeFileSync(at(w, "scratch.txt"), "mine\n");
      expect(await w.pass()).toBe(true);
      expect(text(w, "keep/k1.txt")).toBe("dirty\n");
      expect(text(w, "scratch.txt")).toBe("mine\n");
      expect(w.status().split("\n").sort()).toEqual([" M keep/k1.txt", "?? new.txt", "?? scratch.txt", "M  keep/k2.txt"].sort());
    } finally { await w.dispose(); }
  });

  it("WT-6: a crash after the first rename re-enters and finishes; a tip moved since keeps the crashed paths writable", async () => {
    const w = await world(); try {
      const first = w.land({ "a.txt": "A1\n", "n1.txt": "1\n", "n2.txt": "2\n" });
      w.finish();
      let renames = 0;
      const crash = (point: string) => { if (point === "wt-after-rename" && ++renames === 1) throw new Error("died"); };
      await expect(w.pass({ crash })).rejects.toThrow("died");
      expect(w.record().pending).toMatchObject({ tip: first, new: first });
      // mutation: drop the `have == want` => done branch -> the renamed path is a conflict, red
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: first, pending: null });
      expect([text(w, "a.txt"), text(w, "n1.txt"), text(w, "n2.txt")]).toEqual(["A1\n", "1\n", "2\n"]);
    } finally { await w.dispose(); }
    // Second case: crash, then the tip moves before the re-entry; a path renamed to pending.tip is writable.
    const v = await world(); try {
      const first = v.land({ "a.txt": "A1\n", "n1.txt": "1\n" });
      v.finish();
      let renames = 0;
      await expect(v.pass({ crash: (point) => { if (point === "wt-after-rename" && ++renames === 2) throw new Error("died"); } })).rejects.toThrow("died");
      expect(v.record().pending?.tip).toBe(first);
      const second = v.land({ "a.txt": "A2\n", "n1.txt": "1b\n" });
      // mutation: drop pending.tip from `was` -> the paths at the first tip are conflicts, red
      expect(await v.pass()).toBe(true);
      expect(v.record()).toMatchObject({ state: "idle", lastIntegrated: second, pending: null });
      expect([text(v, "a.txt"), text(v, "n1.txt")]).toEqual(["A2\n", "1b\n"]);
    } finally { await v.dispose(); }
  });

  it("WT-7: a moved tip is delivered incrementally after the person committed the first delivery; an edited one conflicts", async () => {
    const w = await world(); try {
      w.land({ "n1.txt": "1\n" });
      w.finish();
      expect(await w.pass()).toBe(true);
      g(w.repo, ["add", "n1.txt"]); g(w.repo, ["commit", "-qm", "person commits"]);
      w.land({ "n2.txt": "2\n" });
      expect(await w.pass()).toBe(true);
      expect(w.status()).toBe("?? n2.txt");
      writeFileSync(at(w, "n2.txt"), "edited\n");
      w.land({ "n2.txt": "2b\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record().reason).toBe("integration-working-tree-conflict:n2.txt");
      expect(text(w, "n2.txt")).toBe("edited\n");
    } finally { await w.dispose(); }
  });

  it("WT-8: an archived and a closed group are never written", async () => {
    // A closed group carries the same terminal mark with kind "closed" (#355); close is refused while a delivery is owed,
    // so the mark is written directly, as a group closed before it owed one would carry it.
    for (const mark of [{ at: 1, actor: "human" }, { at: 1, actor: "human", kind: "closed" }]) {
      const w = await world(); try {
        w.land({ "n.txt": "n\n" });
        w.finish();
        w.writeBody({ ...w.groupBody(), archived: mark });
        // mutation: delete the archived skip (integrationPass.ts) -> n.txt is written, red
        expect(await w.pass()).toBe(false);
        expect(existsSync(at(w, "n.txt"))).toBe(false);
        expect(w.record().lastIntegrated).toBeNull();
      } finally { await w.dispose(); }
    }
  });

  it("WT-10: a path edited between the guard and the re-check is a conflict, nothing written", async () => {
    const w = await world(); try {
      w.land({ "a.txt": "theirs\n", "n.txt": "n\n" });
      w.finish();
      // mutation: drop the step-9 re-check -> a.txt is overwritten and n.txt written, red
      expect(await w.pass({ crash: (point) => { if (point === "wt-before-recheck") writeFileSync(at(w, "a.txt"), "mine\n"); } })).toBe(true);
      expect(w.record().reason).toBe("integration-working-tree-conflict:a.txt");
      expect(text(w, "a.txt")).toBe("mine\n");
      expect(existsSync(at(w, "n.txt"))).toBe(false);
    } finally { await w.dispose(); }
  });

  it("WT-11: ENOSPC from a rename and a failing checkout-index block write-failed with what was written, never a backoff", async () => {
    const w = await world(); try {
      w.land({ "n1.txt": "1\n", "n2.txt": "2\n" });
      w.finish();
      let renames = 0;
      const rename = (from: string, to: string) => {
        if (++renames === 2) throw Object.assign(new Error("no space"), { code: "ENOSPC" });
        renameSync(from, to);
      };
      // mutation: remove the catch -> the pass backs off (retryAfter set), red
      expect(await w.pass({ workingTree: { rename } })).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", retryAfter: null, reason: "integration-working-tree-write-failed:n2.txt:ENOSPC:written 1 (n1.txt)" });
      expect(w.record().pending).not.toBeNull();
      expect(existsSync(w.staging())).toBe(false);
    } finally { await w.dispose(); }
    const v = await world(); try {
      // A required smudge filter that fails: checkout-index exits non-zero.
      g(v.repo, ["config", "filter.bad.smudge", "false"]); g(v.repo, ["config", "filter.bad.required", "true"]);
      writeFileSync(at(v, ".gitattributes"), "*.dat filter=bad\n");
      v.land({ "x.dat": "d\n" });
      v.finish();
      expect(await v.pass()).toBe(true);
      expect(v.record()).toMatchObject({ state: "blocked", retryAfter: null, reason: "integration-working-tree-write-failed:checkout-index:checkout-index:written 0" });
      expect(existsSync(at(v, "x.dat"))).toBe(false);
    } finally { await v.dispose(); }
  });

  it("WT-12: an incomplete group and a complete but not-yet-accepted group write nothing", async () => {
    const w = await world(); try {
      w.land({ "n.txt": "n\n" });
      // mutation: drop the groupComplete line of the dispatch -> n.txt is written, red
      expect(await w.pass()).toBe(false);
      w.finish();
      // Every task done, but the acceptance on the final tip failed: not accepted.
      w.writeBody({ ...w.groupBody(), acceptance: { ...(w.groupBody().acceptance as object), result: "failed" } });
      expect(await w.pass()).toBe(false);
      expect(existsSync(at(w, "n.txt"))).toBe(false);
      expect(w.record().lastIntegrated).toBeNull();
    } finally { await w.dispose(); }
  });

  it("WT-13: a dependent sorting before its working-tree prerequisite waits a round; a keep prerequisite blocks it", async () => {
    const w = await world(); try {
      // Prerequisite "z" (sorts after "g"): its branch adds z.txt; "g" stacks on it and adds g.txt.
      w.sql("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('z',1,1,0,?)", JSON.stringify({ ...w.groupBody(), groupId: "z", integration: { ...newGroupIntegration(WT)!, frozen: true } }));
      w.sql("INSERT INTO group_edges(from_group,to_group,body) VALUES ('z','g','{}')");
      const zTip = commitOn(w.repo, "refs/heads/orca/z", { "z.txt": "z\n" }, "refs/heads/main");
      w.sql("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-z','z','a',1,0,?)", JSON.stringify({ runId: "run-z", groupId: "z", workItemId: "a", taskId: "a", phase: "work", state: "settled", drive: { base: w.base } }));
      w.finish("z");
      w.sql("UPDATE runs SET body=? WHERE id='run-a'", JSON.stringify({ runId: "run-a", groupId: "g", workItemId: "a", taskId: "a", phase: "work", state: "settled", drive: { base: zTip } }));
      commitOn(w.repo, "refs/heads/orca/g", { "g.txt": "g\n" }, zTip);
      w.finish();
      // mutation: drop step 1 -> round 1 writes g.txt before z.txt, red
      expect(await w.pass()).toBe(true);
      expect(existsSync(at(w, "z.txt"))).toBe(true);
      expect(existsSync(at(w, "g.txt"))).toBe(false);
      expect(await w.pass()).toBe(true);
      expect(text(w, "g.txt")).toBe("g\n");
      // A keep prerequisite: the dependent blocks by name.
      const body = w.groupBody("z"); delete body.integration; w.writeBody(body, "z");
      w.setRecord({ ...newGroupIntegration(WT)!, frozen: true });
      expect(await w.pass()).toBe(true);
      expect(w.record().reason).toBe("integration-working-tree-prerequisite:z");
    } finally { await w.dispose(); }
  });

  it("WT-14: a crash between the unlink and the rmdir; the next pass removes the empty parent", async () => {
    const w = await world(); try {
      w.land({ "sub/only.txt": null, "n.txt": "n\n" });
      w.finish();
      await expect(w.pass({ crash: (point) => { if (point === "wt-after-unlink") throw new Error("died"); } })).rejects.toThrow("died");
      expect(existsSync(at(w, "sub"))).toBe(true);
      expect(existsSync(at(w, "sub/only.txt"))).toBe(false);
      expect(await w.pass()).toBe(true);
      expect(existsSync(at(w, "sub"))).toBe(false);
      expect(text(w, "n.txt")).toBe("n\n");
    } finally { await w.dispose(); }
  });

  it("WT-15: staging is 0700, absent after success and after a refusal, a stale one replaced; the panel-start sweep", async () => {
    const w = await world(); try {
      w.land({ "n.txt": "n\n" });
      w.finish();
      mkdirSync(join(w.staging(), "tree"), { recursive: true });
      writeFileSync(join(w.staging(), "tree", "stale.txt"), "old\n");
      let mode = -1;
      expect(await w.pass({ crash: (point) => { if (point === "wt-before-recheck") mode = statSync(w.staging()).mode & 0o777; } })).toBe(true);
      expect(mode.toString(8)).toBe("700");
      expect(existsSync(join(w.staging(), "tree", "stale.txt"))).toBe(false);
      expect(existsSync(w.staging())).toBe(false);
      w.land({ "n.txt": "n2\n" });
      writeFileSync(at(w, "n.txt"), "mine\n");
      expect(await w.pass()).toBe(true);
      expect(w.record().state).toBe("blocked");
      expect(existsSync(w.staging())).toBe(false);
      // The sweep: two registered repositories' deliver-* removed, a third whose path is gone logged.
      const second = join(w.root, "second");
      mkdirSync(second); g(second, ["init", "-q"]);
      for (const repo of [w.repo, second]) mkdirSync(join(repo, ".git", "orca", "deliver-x", "tree"), { recursive: true });
      mkdirSync(join(w.repo, ".git", "orca", "other"), { recursive: true });
      const lines: string[] = [];
      // mutation: skip the sweep -> the deliver-x directories remain, red
      await sweepWorkingTreeStaging([w.repo, second, join(w.root, "gone")], (line) => lines.push(line));
      expect(existsSync(join(w.repo, ".git", "orca", "deliver-x"))).toBe(false);
      expect(existsSync(join(second, ".git", "orca", "deliver-x"))).toBe(false);
      expect(existsSync(join(w.repo, ".git", "orca", "other"))).toBe(true);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(join(w.root, "gone"));
    } finally { await w.dispose(); }
  });

  it("WT-16: delivered .decisions/ rows read as working-tree decisions (O2, pinned)", async () => {
    const w = await world(); try {
      w.land({ ".decisions/g.jsonl": `${JSON.stringify({ ev: "decision", id: "d1" })}\n` });
      w.finish();
      expect(await w.pass()).toBe(true);
      const { first } = await labelDecisions(w.repo, await ledgerSources(w.store, w.repo, "g"));
      expect(first.get("d1")?.where).toBe("working-tree");
    } finally { await w.dispose(); }
  });

  it("WT-17: a local group whose target is checked out blocks integration-worktree-dirty on a delivered untracked file (O7)", async () => {
    const w = await world(); try {
      w.land({ "n.txt": "n\n" });
      w.finish();
      expect(await w.pass()).toBe(true);
      w.setRecord({ ...newGroupIntegration(LOCAL)!, frozen: true });
      w.land({ "m.txt": "m\n" });
      expect(await w.pass()).toBe(true);
      expect(w.record().reason).toBe("integration-worktree-dirty");
    } finally { await w.dispose(); }
  });
});

describe("working-tree delivery guard clauses (spec §4.4 steps 3-6, WT-9)", { timeout: 60_000 }, () => {
  const blockedWith = async (setup: (w: World) => void, ops: Record<string, Op>, reason: string | RegExp, extra: Partial<IntegrationDeps> = {}) => {
    const w = await world(); try {
      w.land(ops);
      w.finish();
      setup(w);
      const before = snapshot(w.repo);
      await w.pass(extra);
      if (typeof reason === "string") expect(w.record().reason).toBe(reason); else expect(w.record().reason).toMatch(reason);
      expect(snapshot(w.repo)).toEqual(before);
      return w;
    } finally { await w.dispose(); }
  };

  it("only the executable bit changed by the person is a conflict; with core.fileMode=false it is unchanged and kept", async () => {
    await blockedWith((w) => { g(w.repo, ["config", "core.fileMode", "true"]); chmodSync(at(w, "a.txt"), 0o755); }, { "a.txt": "two\n" }, "integration-working-tree-conflict:a.txt");
    const w = await world(); try {
      g(w.repo, ["config", "core.fileMode", "false"]);
      chmodSync(at(w, "a.txt"), 0o755);
      w.land({ "a.txt": "two\n" });
      w.finish();
      expect(await w.pass()).toBe(true);
      expect(w.record().state).toBe("idle");
      expect(text(w, "a.txt")).toBe("two\n");
      expect((statSync(at(w, "a.txt")).mode & 0o777).toString(8)).toBe("755");
    } finally { await w.dispose(); }
  });

  it("a symlink where the tip has a file, and a file where the tip has a symlink, are conflicts both ways", async () => {
    // mutation: hash with `hash-object <path>` (follows the link) -> the link to a file holding the tip's bytes passes, red
    await blockedWith((w) => { writeFileSync(at(w, "target.txt"), "tipbytes\n"); symlinkSync("target.txt", at(w, "n.txt")); }, { "n.txt": "tipbytes\n" }, "integration-working-tree-conflict:n.txt");
    await blockedWith((w) => { writeFileSync(at(w, "l"), "a.txt"); }, { "l": { text: "a.txt", mode: "120000" } }, "integration-working-tree-conflict:l");
  });

  it("a directory where the tip has a file is unsupported:dir", async () => {
    await blockedWith((w) => { mkdirSync(at(w, "n.txt")); }, { "n.txt": "n\n" }, "integration-working-tree-unsupported:dir:n.txt");
  });

  it("each busy marker blocks busy:<op>; index.lock is a backoff", async () => {
    const markers: Array<[string, string, boolean]> = [["MERGE_HEAD", "merge", false], ["CHERRY_PICK_HEAD", "cherry-pick", false], ["REVERT_HEAD", "revert", false],
      ["rebase-merge", "rebase", true], ["rebase-apply", "rebase", true], ["sequencer", "sequencer", true], ["BISECT_LOG", "bisect", false]];
    for (const [marker, op, dir] of markers) {
      await blockedWith((w) => { if (dir) mkdirSync(join(w.repo, ".git", marker)); else writeFileSync(join(w.repo, ".git", marker), "x\n"); }, { "n.txt": "n\n" }, `integration-working-tree-busy:${op}`);
    }
    const w = await world(); try {
      w.land({ "n.txt": "n\n" });
      w.finish();
      writeFileSync(join(w.repo, ".git", "index.lock"), "");
      expect(await w.pass()).toBe(false);
      expect(w.record()).toMatchObject({ state: "idle", transient: 1 });
      expect(w.record().retryAfter).not.toBeNull();
      expect(existsSync(at(w, "n.txt"))).toBe(false);
    } finally { await w.dispose(); }
  });

  it("a symlinked, a regular-file and a nested-repository leading component, and a .GIT component, are unsafe paths", async () => {
    await blockedWith((w) => { mkdirSync(join(w.root, "elsewhere")); symlinkSync(join(w.root, "elsewhere"), at(w, "docs")); }, { "docs/n.md": "n\n" }, "integration-working-tree-unsafe-path:docs/n.md");
    await blockedWith((w) => { writeFileSync(at(w, "docs"), "file\n"); }, { "docs/n.md": "n\n" }, "integration-working-tree-unsafe-path:docs/n.md");
    await blockedWith((w) => { mkdirSync(at(w, "docs")); g(at(w, "docs"), ["init", "-q"]); }, { "docs/n.md": "n\n" }, "integration-working-tree-unsafe-path:docs/n.md");
    // git's own index refuses a `.GIT` path, so the tip's tree is built with mktree (as a hostile branch could carry it).
    const w = await world(); try {
      const blob = g(w.repo, ["hash-object", "-w", "--stdin"], { input: "evil\n" });
      const hooks = g(w.repo, ["mktree"], { input: `100644 blob ${blob}\tpost-checkout\n` });
      const dotGit = g(w.repo, ["mktree"], { input: `040000 tree ${hooks}\thooks\n` });
      const x = g(w.repo, ["mktree"], { input: `040000 tree ${dotGit}\t.GIT\n` });
      const root = g(w.repo, ["mktree"], { input: `${g(w.repo, ["ls-tree", w.base])}\n040000 tree ${x}\tx\n` });
      g(w.repo, ["update-ref", "refs/heads/orca/g", g(w.repo, ["commit-tree", root, "-p", w.base, "-m", "evil"])]);
      w.finish();
      expect(await w.pass()).toBe(true);
      expect(w.record().reason).toBe("integration-working-tree-unsafe-path:x/.GIT/hooks/post-checkout");
      expect(existsSync(at(w, "x"))).toBe(false);
    } finally { await w.dispose(); }
  });

  it("a gitlink is unsupported:gitlink; a case-only rename is unsupported:case-rename; another device is unsupported:cross-device", async () => {
    await blockedWith(() => undefined, { "mod": { text: "0123456789012345678901234567890123456789", mode: "160000" } }, "integration-working-tree-unsupported:gitlink:mod");
    await blockedWith(() => undefined, { "a.txt": null, "A.txt": "one\n" }, /^integration-working-tree-unsupported:case-rename:a?A?\.txt$/i);
    // The git directory on another device (a `.git` file pointing to another volume), injected through the device seam.
    await blockedWith(() => undefined, { "n.txt": "n\n" }, "integration-working-tree-unsupported:cross-device",
      { workingTree: { devOf: (path) => (path.endsWith(".git") ? 2 : 1) } });
  });
});
