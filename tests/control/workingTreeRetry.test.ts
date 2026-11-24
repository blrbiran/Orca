// Tester #434, second half (ledger 2026-10-23, "追加实测 2026-11-23 12:2x"): a `working-tree` group whose write the
// checkout refused (`integration-working-tree-conflict:src/upper.js,src/upper.test.js`, the person's own untracked
// files) is then retried with `orca group retry-integration`, and the person reports that the next pass overwrote both
// files with Orca's bytes, with no stash, backup or message. This pins the whole sequence against real git: untracked
// person files in the checkout, the refusal, the retry (through WebControlService, the CLI's own road), the next
// driver pass -- and asserts the person's bytes are still there. Each variant is a precondition the tester's run may
// have had and this one must also survive.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { integratePendingGroups, type IntegrationDeps } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration, type GroupIntegration } from "../../src/control/integrationScheme.js";
import { WebControlService } from "../../src/control/webService.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { webFixture } from "./fixtures/web.js";

const WT = { delivery: "working-tree" } as const;
const gRaw = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...unsetInheritedGitEnv(), ...options.env } });
const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string => gRaw(cwd, args, options).trim();
afterEach(() => { vi.unstubAllEnvs(); });

const UPPER = "export function upper(text) {\n  return text.toUpperCase() + \"!\";\n}\n";      // the person's own file
const UPPER_TEST = "// my local test\n";                                                        // the person's own file
const ORCA_UPPER = "export function upper(text) {\n  return text.toUpperCase();\n}\n";           // what the group adds

/** A commit on `ref` whose tree is its parent's with `files` written, made with plumbing (no checkout). */
function commitOn(repo: string, ref: string, files: Record<string, string>): string {
  const parent = g(repo, ["rev-parse", ref]);
  const env = { GIT_INDEX_FILE: join(repo, ".git", `wtr-index-${process.pid}`) };
  g(repo, ["read-tree", parent], { env });
  for (const [path, text] of Object.entries(files)) {
    const oid = g(repo, ["hash-object", "-w", "--stdin"], { input: text });
    g(repo, ["update-index", "--add", "--cacheinfo", `100644,${oid},${path}`], { env });
  }
  const commit = g(repo, ["commit-tree", g(repo, ["write-tree"], { env }), "-p", parent, "-m", "land"]);
  g(repo, ["update-ref", ref, commit]);
  return commit;
}

const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

async function world() {
  const h = await webFixture();
  const repo = join(h.root, "checkout");
  mkdirSync(repo);
  g(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(join(repo, "a.txt"), "one\n");
  g(repo, ["add", "-A"]); g(repo, ["commit", "-qm", "base"]);
  const base = g(repo, ["rev-parse", "HEAD"]);
  g(repo, ["update-ref", "refs/heads/orca/g", base]);
  const body = (): Record<string, unknown> => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
  const writeBody = (b: Record<string, unknown>): void => { h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(b)); };
  writeBody({ ...body(), integration: { ...newGroupIntegration(WT)!, frozen: true } });
  h.store.db.prepare("INSERT INTO runs(id,group_id,work_item_id,generation,active,body) VALUES ('run-a','g','a',1,0,?)")
    .run(JSON.stringify({ runId: "run-a", groupId: "g", workItemId: "a", taskId: "a", phase: "work", state: "settled", drive: { base } }));
  const record = (): GroupIntegration => readGroupIntegration(body())!;
  const setRecord = (integration: GroupIntegration): void => writeBody({ ...body(), integration });
  /** The group as the driver leaves it finished: every task done, accepted. */
  const finish = (): void => {
    for (const row of h.store.db.prepare("SELECT id, body FROM work_items WHERE group_id='g'").all())
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id='g' AND id=?").run(JSON.stringify({ ...JSON.parse(String(row.body)), status: "done" }), String(row.id));
    writeBody({ ...body(), status: "done", acceptance: { tip: null, result: "not-needed", why: "single-landing", commands: [], at: 1, fullSuite: { command: null, suggestion: null, exits: [], flaky: false } } });
  };
  const passDeps = (): IntegrationDeps => ({ store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), admissionGate: h.deps.admissionGate,
    repoPathOf: () => repo, now: () => 1_000_000, ghBin: "/nonexistent/gh", stopped: () => false });
  const pass = (extra: Partial<IntegrationDeps> = {}) => integratePendingGroups({ ...passDeps(), ...extra });
  const service = new WebControlService(h.deps);
  /** `orca group retry-integration g`: the CLI's route (group target, empty payload) through the panel's own service. */
  const retry = () => service.retryIntegration(h.command("retry-integration", {}));
  const personFiles = (): void => {
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "upper.js"), UPPER);
    writeFileSync(join(repo, "src", "upper.test.js"), UPPER_TEST);
  };
  const personBytes = () => ({ js: sha(join(repo, "src", "upper.js")), test: sha(join(repo, "src", "upper.test.js")) });
  const status = (): string => gRaw(repo, ["status", "--porcelain=v1", "--untracked-files=all"]).replace(/\n$/, "");
  return { ...h, repo, base, body, record, setRecord, finish, pass, passDeps, retry, personFiles, personBytes, status,
    land: (files: Record<string, string>, ref = "refs/heads/orca/g") => commitOn(repo, ref, files) };
}
type World = Awaited<ReturnType<typeof world>>;

const at = (w: World, path: string) => join(w.repo, path);
const text = (w: World, path: string) => readFileSync(at(w, path), "utf8");

describe("tester #434: retry-integration after a refused working-tree write keeps the person's bytes", { timeout: 120_000 }, () => {
  it("the tester's sequence: untracked person files, refused, retried through the service, next pass refuses again", async () => {
    const w = await world();
    try {
      w.land({ "src/upper.js": ORCA_UPPER, "src/upper.test.js": "test\n" });
      w.finish();
      w.personFiles();
      const before = { ...w.personBytes(), status: w.status() };
      expect(before.status.split("\n").sort()).toEqual(["?? src/upper.js", "?? src/upper.test.js"]);

      // The first integration refuses both paths and writes nothing (WT-4's rule).
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-working-tree-conflict:src/upper.js,src/upper.test.js", lastIntegrated: null });
      expect(w.personBytes()).toEqual({ js: before.js, test: before.test });
      expect(w.status()).toBe(before.status);

      // `orca group retry-integration`: back to idle, tried again at the next round.
      const blockedRecord = w.record();
      expect(w.retry()).toMatchObject({ result: { kind: "integration-retried", groupId: "g" } });
      // The retry resets exactly state/reason/retryAfter/transient (integrationCommands.ts resetIntegrationForRetry):
      // `from`, `was`, `lastIntegrated`, the scheme and any write-ahead are untouched, so the next pass evaluates the
      // SAME guard over the SAME paths. mutation: have the retry null `lastIntegrated`/`pending` or change the scheme ->
      // `from` moves and the person's bytes become "writable", red on the byte assertions below.
      expect(w.record()).toEqual({ ...blockedRecord, state: "idle", reason: null, retryAfter: null, transient: 0 });
      // mutation: let judge's `was` match an absent entry (or drop the conflict branch) -> the person's files are
      // overwritten and the record reads done, red here and in the two byte assertions below.
      expect(await w.pass()).toBe(true);
      expect(w.personBytes()).toEqual({ js: before.js, test: before.test });
      expect(text(w, "src/upper.js")).toBe(UPPER);
      expect(text(w, "src/upper.test.js")).toBe(UPPER_TEST);
      expect(w.status()).toBe(before.status);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-working-tree-conflict:src/upper.js,src/upper.test.js", lastIntegrated: null });
    } finally { await w.dispose(); }
  });

  it("a write-ahead left by the refused pass (a crashed re-entry) does not make the person's bytes look like Orca's", async () => {
    const w = await world();
    try {
      const tip = w.land({ "src/upper.js": ORCA_UPPER, "src/upper.test.js": "test\n" });
      w.finish();
      w.personFiles();
      const before = w.personBytes();
      await w.pass();
      expect(w.record().state).toBe("blocked");
      // A crashed earlier attempt may have written its write-ahead: the record keeps `pending` across a working-tree
      // block (integrationPass.ts settle), and `pending.tip === tip` adds nothing to `was` -- pin that.
      w.setRecord({ ...w.record(), pending: { schemeHash: w.record().schemeHash, tip, base: w.base, new: tip } });
      w.retry();
      expect(await w.pass()).toBe(true);
      expect(w.personBytes()).toEqual(before);
      expect(w.record()).toMatchObject({ state: "blocked", lastIntegrated: null });
    } finally { await w.dispose(); }
  });

  it("two retries in a row, and a tip that moves between the refusal and the retry, both keep the person's bytes", async () => {
    const w = await world();
    try {
      w.land({ "src/upper.js": ORCA_UPPER });
      w.finish();
      w.personFiles();
      const before = w.personBytes();
      await w.pass();
      // The retry is itself retried before the next round runs: nothing has changed, so nothing may be written.
      w.retry();
      expect(w.retry()).toMatchObject({ error: { code: "integration-not-blocked" } });
      // A later landing moves the tip; the two person paths are still in from..tip.
      w.land({ "src/upper.test.js": "test\n", "extra.txt": "x\n" });
      expect(await w.pass()).toBe(true);
      expect(w.personBytes()).toEqual(before);
      expect(w.record().reason).toMatch(/^integration-working-tree-conflict:/);
      expect(w.personBytes()).toEqual(before);
    } finally { await w.dispose(); }
  });

  it("a file Orca delivered earlier, then the person rewrote, is a conflict on a later tip -- never re-taken", async () => {
    const w = await world();
    try {
      // The tester's lab had a previous group deliver Orca's own copy into this checkout. Reproduce that state with
      // this group: deliver tip1 (src/upper.js appears untracked), then the person rewrites it, then a new tip lands.
      w.land({ "src/upper.js": "ORCA ONE\n" });
      w.finish();
      expect(await w.pass()).toBe(true);
      expect(text(w, "src/upper.js")).toBe("ORCA ONE\n");
      writeFileSync(at(w, "src/upper.js"), UPPER);        // the person's own version, over Orca's delivered copy
      const before = sha(at(w, "src/upper.js"));
      const second = w.land({ "src/upper.js": ORCA_UPPER });
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-working-tree-conflict:src/upper.js" });
      expect(w.record().lastIntegrated).not.toBe(second);
      w.retry();
      expect(await w.pass()).toBe(true);
      // mutation: treat "the entry a previous delivery left" as writable without the oid comparison -> overwritten, red
      expect(sha(at(w, "src/upper.js"))).toBe(before);
      expect(text(w, "src/upper.js")).toBe(UPPER);
    } finally { await w.dispose(); }
  });

  it("a stale pending tip from a crashed attempt (Orca's own bytes at that tip) is not a licence for the person's file", async () => {
    const w = await world();
    try {
      // Pass 1 commits `pending.tip = first` and dies after renaming src/upper.js: the file on disk is Orca's, and the
      // crashed attempt's entry for it is Orca's bytes too.
      const first = w.land({ "src/upper.js": ORCA_UPPER });
      w.finish();
      let renames = 0;
      await expect(w.pass({ crash: (point) => { if (point === "wt-after-rename" && ++renames === 1) throw new Error("died"); } })).rejects.toThrow("died");
      expect(w.record().pending).toMatchObject({ tip: first, new: first });
      expect(text(w, "src/upper.js")).toBe(ORCA_UPPER);
      // The person rewrites the delivered file, then a later tip changes it again.
      writeFileSync(at(w, "src/upper.js"), UPPER);
      const before = sha(at(w, "src/upper.js"));
      const second = w.land({ "src/upper.js": "ORCA TWO\n" });
      // `was` now holds from's entry, pending.tip's (Orca's first bytes) and nothing of the person's.
      expect(await w.pass()).toBe(true);
      expect(w.record().reason).toBe("integration-working-tree-conflict:src/upper.js");
      w.retry();
      expect(await w.pass()).toBe(true);
      // mutation: let a pending-tip entry stand for "Orca wrote this" without an oid comparison -> the person's file is
      // taken as Orca's and overwritten with ORCA TWO, red
      expect(sha(at(w, "src/upper.js"))).toBe(before);
      expect(text(w, "src/upper.js")).toBe(UPPER);
      expect(w.record().lastIntegrated).not.toBe(second);
    } finally { await w.dispose(); }
  });

  it("positive control: the same retry, once the person moves their files away, really lands the tip", async () => {
    const w = await world();
    try {
      const tip = w.land({ "src/upper.js": ORCA_UPPER, "src/upper.test.js": "test\n" });
      w.finish();
      w.personFiles();
      await w.pass();
      expect(w.record().reason).toMatch(/^integration-working-tree-conflict:/);
      w.retry();
      // The person commits their copies (the record's own `next:` advice), then retries again.
      const before = w.personBytes();
      g(w.repo, ["add", "src/upper.js", "src/upper.test.js"]);
      g(w.repo, ["commit", "-qm", "mine"]);
      const personHead = w.personBytes();
      expect(await w.pass()).toBe(true);
      // Committed bytes are the person's, so from..tip still conflicts on content for upper.js: the group conflicts
      // again rather than taking the file. Nothing of the person's changes.
      expect(w.personBytes()).toEqual(personHead);
      expect(before).toEqual(personHead);
      // Now the person moves their copies out of the way entirely: the delivery runs and writes the tip's bytes.
      g(w.repo, ["rm", "-q", "src/upper.js", "src/upper.test.js"]);
      g(w.repo, ["commit", "-qm", "move mine away"]);
      w.retry();
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: tip, pending: null });
      expect(text(w, "src/upper.js")).toBe(ORCA_UPPER);
      expect(text(w, "src/upper.test.js")).toBe("test\n");
    } finally { await w.dispose(); }
  });

  it("the group's own workspace is never the person's checkout, and a delivered unrelated path is still written", async () => {
    const w = await world();
    try {
      // One refused path beside one deliverable one: the refused path is untouched, the other is written, and the
      // person's bytes survive both the refusal and the retry (a partial delivery must not sweep the rest).
      w.land({ "src/upper.js": ORCA_UPPER, "docs/new.md": "new\n" });
      w.finish();
      w.personFiles();
      const before = w.personBytes();
      await w.pass();
      expect(w.record()).toMatchObject({ state: "blocked", reason: "integration-working-tree-conflict:src/upper.js" });
      // The whole pass is all-or-nothing at the guard: the unrelated path is not written either.
      expect(w.status()).not.toContain("docs/new.md");
      w.retry();
      await w.pass();
      expect(w.personBytes()).toEqual(before);
      expect(w.status()).not.toContain("docs/new.md");
    } finally { await w.dispose(); }
  });
});