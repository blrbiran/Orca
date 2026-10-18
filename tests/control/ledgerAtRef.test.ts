import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findDecision, integrationTargetRef, ledgerSources, readLedgerAtRef } from "../../src/control/ledgerAtRef.js";
import { newGroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import type { ControlStore } from "../../src/control/store.js";
import { unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { webFixture } from "./fixtures/web.js";

// Control run decisions plan Task 8: a ledger read from git objects at a ref, and the order the group's decisions view
// asks its sources in. Each assertion reads what the code under test returned for a repository built here.
const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...unsetInheritedGitEnv(), ...options.env } }).trim();

/** integrationGit.test.ts's `commitOn`: a commit on `ref` whose tree is its parent's with `files` written, by plumbing. */
function commitOn(repo: string, ref: string, files: Record<string, string>, message: string, from = ref): string {
  const parent = g(repo, ["rev-parse", from]);
  const env = { GIT_INDEX_FILE: join(repo, ".git", `orca-test-index-${process.pid}`) };
  g(repo, ["read-tree", parent], { env });
  for (const [path, text] of Object.entries(files)) {
    const blob = g(repo, ["hash-object", "-w", "--stdin"], { input: text });
    g(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`], { env });
  }
  const tree = g(repo, ["write-tree"], { env });
  const commit = g(repo, ["commit-tree", tree, "-p", parent, "-m", message]);
  g(repo, ["update-ref", ref, commit]);
  return commit;
}

async function repository() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ledger-at-ref-")));
  const repo = join(root, "repo");
  g(root, ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "base.txt"), "base\n");
  g(repo, ["add", "base.txt"]); g(repo, ["commit", "-qm", "base"]);
  return { repo, dispose: () => rm(root, { recursive: true, force: true }) };
}

const line = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ev: "decision", id, ...extra });

describe("readLedgerAtRef (control run decisions Task 8)", () => {
  it("reads ledger lines at a ref that is not checked out, archives included", async () => {
    const r = await repository(); try {
      commitOn(r.repo, "refs/heads/side", {
        ".decisions/r1.jsonl": `${line("r1/agent-0")}\nnot json\n${line("r1/agent-1")}\n`,
        ".decisions/archive/2026/old.jsonl": `${line("old/1")}\n`,
        ".decisions/notes.txt": "not a ledger\n",
        "elsewhere.jsonl": `${line("x/1")}\n`,
      }, "side", "main");
      expect(g(r.repo, ["symbolic-ref", "HEAD"])).toBe("refs/heads/main");
      const lines = await readLedgerAtRef(r.repo, "refs/heads/side");
      expect(lines).toEqual([
        { path: ".decisions/archive/2026/old.jsonl", value: { ev: "decision", id: "old/1" } },
        { path: ".decisions/r1.jsonl", value: { ev: "decision", id: "r1/agent-0" } },
        { path: ".decisions/r1.jsonl", value: { ev: "decision", id: "r1/agent-1" } },
      ]);
    } finally { await r.dispose(); }
  });

  it("returns null for a ref that does not exist", async () => {
    const r = await repository(); try {
      expect(await readLedgerAtRef(r.repo, "refs/heads/nowhere")).toBeNull();
      // A ref that exists but holds no ledger is an empty read, not a missing ref.
      expect(await readLedgerAtRef(r.repo, "refs/heads/main")).toEqual([]);
    } finally { await r.dispose(); }
  });

  it("labels an id by the first source holding it", async () => {
    const r = await repository(); try {
      g(r.repo, ["update-ref", "refs/heads/orca/g", "HEAD"]);
      commitOn(r.repo, "refs/heads/orca/g", { ".decisions/r1.jsonl": `${line("r1/agent-0", { chose: "branch" })}\n${line("r1/agent-1")}\n` }, "land");
      // The target holds r1/agent-0 only (as after an integration that a later landing has not reached yet).
      commitOn(r.repo, "refs/heads/target", { ".decisions/r1.jsonl": `${line("r1/agent-0", { chose: "target" })}\n` }, "integrate", "main");
      const sources = [
        { where: "working-tree" as const, ref: null },
        { where: "target" as const, ref: "refs/heads/target" },
        { where: "group-branch" as const, ref: "refs/heads/orca/g" },
      ];
      expect(await findDecision(r.repo, sources, "r1/agent-0")).toEqual({ where: "target", value: { ev: "decision", id: "r1/agent-0", chose: "target" } });
      expect(await findDecision(r.repo, sources, "r1/agent-1")).toEqual({ where: "group-branch", value: { ev: "decision", id: "r1/agent-1" } });
      expect(await findDecision(r.repo, sources, "r1/agent-9")).toBeNull();
      // The working tree is asked first: a checkout holding the line wins over both refs.
      g(r.repo, ["checkout", "-q", "target"]);
      expect((await findDecision(r.repo, sources, "r1/agent-0"))?.where).toBe("working-tree");
    } finally { await r.dispose(); }
  });
});

describe("the group's ledger sources (control run decisions Task 8, cross-plan resolution 4)", () => {
  const setScheme = (store: ControlStore, scheme: IntegrationScheme) => {
    const body = JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
    store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...body, integration: newGroupIntegration(scheme) }));
  };

  it("asks the working tree, then the integration target, then the group branch", async () => {
    const h = await webFixture(); try {
      expect(await integrationTargetRef(h.store, "g")).toBeNull();
      expect(await ledgerSources(h.store, "/unused", "g")).toEqual([
        { where: "working-tree", ref: null }, { where: "group-branch", ref: "refs/heads/orca/g" },
      ]);
      setScheme(h.store, { delivery: "local", trigger: "task", method: "merge", target: "main" });
      expect(await integrationTargetRef(h.store, "g")).toBe("refs/heads/main");
      expect(await ledgerSources(h.store, "/unused", "g")).toEqual([
        { where: "working-tree", ref: null }, { where: "target", ref: "refs/heads/main" }, { where: "group-branch", ref: "refs/heads/orca/g" },
      ]);
      setScheme(h.store, { delivery: "push-target", trigger: "task", method: "merge", target: "trunk", remote: "up" });
      expect(await integrationTargetRef(h.store, "g")).toBe("refs/remotes/up/trunk");
      setScheme(h.store, { delivery: "github-pr", trigger: "task", target: "main", remote: "origin" });
      expect(await integrationTargetRef(h.store, "g")).toBe("refs/remotes/origin/main");
    } finally { await h.dispose(); }
  });
});
