// Delivery tail spec 2026-11-17 (tester #333/#336, human rulings 1-3 of session 2026-11-17): the integration record says
// what a backoff waits on and which tip a delivered commit was made for, and a running requirement review does not hold
// the group's integration. Real git, as integrationGit.test.ts; each case names its spec section.
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGroupActivity } from "../../src/control/activity.js";
import { groupComplete, integratePendingGroups, type IntegrationDeps } from "../../src/control/integrationPass.js";
import { newGroupIntegration, readGroupIntegration, type GroupIntegration, type IntegrationScheme } from "../../src/control/integrationScheme.js";
import type { ControlStore } from "../../src/control/store.js";
import { controlWorkspaceRoots, unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { acceptDeliveries } from "../../src/control/deliveredAcceptance.js";
import { deliveredAcceptanceSatisfied, deliveredAcceptanceTarget } from "../../src/control/groupAcceptanceRecord.js";
import { webFixture } from "./fixtures/web.js";
import { reviewWorld } from "./fixtures/reviewWorld.js";

const g = (cwd: string, args: string[], options: { input?: string; env?: NodeJS.ProcessEnv } = {}): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: "pipe", input: options.input, env: { ...process.env, ...unsetInheritedGitEnv(), ...options.env } }).trim();
const groupBody = (store: ControlStore): Record<string, unknown> => JSON.parse(String(store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as Record<string, unknown>;
const setRecord = (store: ControlStore, integration: GroupIntegration) => store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...groupBody(store), integration }));
const LOCAL_MERGE: IntegrationScheme = { delivery: "local", trigger: "task", method: "merge", target: "main" };

function commitOn(repo: string, ref: string, files: Record<string, string>, message: string): string {
  const parent = g(repo, ["rev-parse", ref]);
  const env = { GIT_INDEX_FILE: join(repo, ".git", `orca-test-index-${process.pid}`) };
  g(repo, ["read-tree", parent], { env });
  for (const [path, text] of Object.entries(files)) g(repo, ["update-index", "--add", "--cacheinfo", `100644,${g(repo, ["hash-object", "-w", "--stdin"], { input: text })},${path}`], { env });
  const commit = g(repo, ["commit-tree", g(repo, ["write-tree"], { env }), "-p", parent, "-m", message]);
  g(repo, ["update-ref", ref, commit, parent]);
  return commit;
}

/** The fixture's group "g" with a frozen local-merge integration; `target`'s main holds f.txt; orca/g from its HEAD. */
async function world() {
  const h = await webFixture();
  const repo = join(h.root, "target");
  g(h.root, ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "f.txt"), "one\n");
  g(repo, ["add", "f.txt"]); g(repo, ["commit", "-qm", "base"]);
  g(repo, ["checkout", "-q", "-b", "other"]);
  g(repo, ["update-ref", "refs/heads/orca/g", "main"]);
  setRecord(h.store, { ...newGroupIntegration(LOCAL_MERGE)!, frozen: true });
  let clock = 1_000_000;
  const deps = (extra: Partial<IntegrationDeps> = {}): IntegrationDeps => ({
    store: h.store, roots: controlWorkspaceRoots(h.store.stateDir), admissionGate: h.deps.admissionGate, repoPathOf: () => repo,
    now: () => clock, ghBin: "/nonexistent/gh", stopped: () => false, ...extra,
  });
  return { ...h, repo, pass: (extra: Partial<IntegrationDeps> = {}) => integratePendingGroups(deps(extra)),
    record: () => readGroupIntegration(groupBody(h.store))!, land: (files: Record<string, string>) => commitOn(repo, "refs/heads/orca/g", files, "land"),
    setClock: (at: number) => { clock = at; } };
}

describe("the integration record's delivery facts (delivery tail spec D5, Correction 1.3)", { timeout: 60_000 }, () => {
  it("a transient failure records its message and when it is retried, and writes an integration-backoff activity row", async () => {
    const w = await world(); try {
      w.land({ "a.txt": "a\n" });
      // The repository path that does not resolve this round is a transient failure of the pass (its handler backs off).
      expect(await w.pass({ repoPathOf: () => { throw new Error("the volume is not mounted"); } })).toBe(false);
      // mutation: drop transientReason from the transient settle -> undefined, red
      expect(w.record()).toMatchObject({ state: "idle", transient: 1, retryAfter: 1_030_000, transientReason: "the volume is not mounted" });
      // mutation: drop the backoff activity row -> none, red
      expect(readGroupActivity(w.store, "g", 50).filter((row) => row.kind === "integration-backoff").map((row) => row.body))
        .toEqual([{ message: "the volume is not mounted", retryAfter: 1_030_000, transient: 1 }]);
      const view = readControlGroup(w.store, "e", "g").integration!;
      expect(view).toMatchObject({ state: "idle", retryAfter: 1_030_000, transient: 1, transientReason: "the volume is not mounted" });
      // A success clears both.
      w.setClock(2_000_000);
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ transient: 0, retryAfter: null, transientReason: null });
    } finally { await w.dispose(); }
  });

  it("integratedFor names the tip a published commit was made for, and stays when the target already held the next tip", async () => {
    const w = await world(); try {
      const first = w.land({ "a.txt": "a\n" });
      expect(await w.pass()).toBe(true);
      const merged = g(w.repo, ["rev-parse", "main"]);
      // mutation: drop integratedFor from the done settle -> undefined, red
      expect(w.record()).toMatchObject({ lastIntegrated: first, integratedCommit: merged, integratedFor: first });
      // The person fast-forwards main past a new landing themselves: nothing to carry, integratedCommit stays the old one.
      const second = w.land({ "b.txt": "b\n" });
      g(w.repo, ["update-ref", "refs/heads/main", second]);
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ lastIntegrated: second, integratedCommit: merged, integratedFor: first });
    } finally { await w.dispose(); }
  });

  it("a finished local group with nothing to carry records its tip as delivered, so it can be done (Correction 3)", async () => {
    const w = await world(); try {
      const tip = g(w.repo, ["rev-parse", "refs/heads/orca/g"]);
      // Tasks not done yet: nothing is recorded. mutation: drop the groupComplete requirement -> lastIntegrated set, red
      expect(await w.pass()).toBe(false);
      expect(w.record()).toMatchObject({ lastIntegrated: null, integratedCommit: null });
      w.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status','done') WHERE group_id='g'").run();
      w.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...groupBody(w.store), acceptance: { tip, result: "not-needed", why: "single-landing", commands: [], at: 0 } }));
      // mutation: keep returning null for nothing landed -> lastIntegrated null, red
      expect(await w.pass()).toBe(true);
      expect(w.record()).toMatchObject({ state: "idle", lastIntegrated: tip, integratedCommit: null, integratedFor: null, pending: null });
      expect(g(w.repo, ["rev-parse", "main"])).toBe(tip); // the target is untouched: no commit was made
      // The delivered acceptance names it already in the target and does not run a command; the done gate is then met.
      const deps = { store: w.store, roots: controlWorkspaceRoots(w.store.stateDir), resolveRepository: () => w.repo, write: <T>(action: () => T) => action(), stopped: () => false };
      expect(await acceptDeliveries(deps, new Map())).toBe(true);
      expect(groupBody(w.store).deliveredAcceptance).toMatchObject({ tip, commit: tip, result: "not-needed", why: "already-in-target" });
      expect(deliveredAcceptanceSatisfied(groupBody(w.store))).toBe(true);
      // Caught up: the next pass has nothing to do.
      expect(await w.pass()).toBe(false);
    } finally { await w.dispose(); }
  });
});

describe("the delivered acceptance's own gate (review 2026-11-17 findings 1-3)", { timeout: 60_000 }, () => {
  it("does not check a delivery while tasks are not done or no acceptance is recorded for the tip; does once both hold", async () => {
    const w = await world(); try {
      const tip = w.land({ "a.txt": "a\n" });
      setRecord(w.store, { ...w.record(), lastIntegrated: tip, integratedCommit: tip, integratedFor: tip });
      const deps = { store: w.store, roots: controlWorkspaceRoots(w.store.stateDir), resolveRepository: () => w.repo, write: <T>(action: () => T) => action(), stopped: () => false };
      // mutation: drop the tasks-done / recorded-acceptance gate -> a not-needed record for an intermediate delivery, red
      expect(await acceptDeliveries(deps, new Map())).toBe(false);
      expect(groupBody(w.store).deliveredAcceptance).toBeUndefined();
      w.store.db.prepare("UPDATE work_items SET body=json_set(body,'$.status','done') WHERE group_id='g'").run();
      w.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...groupBody(w.store), acceptance: { tip, result: "not-needed", why: "single-landing", commands: [], at: 0 } }));
      expect(await acceptDeliveries(deps, new Map())).toBe(true);
      expect(groupBody(w.store).deliveredAcceptance).toMatchObject({ tip, commit: tip, result: "not-needed", why: "same-tree" });
    } finally { await w.dispose(); }
  });

  it("names a delivery made before integratedFor existed, and an archived prerequisite does not wait for a check", () => {
    const integration = { scheme: LOCAL_MERGE, frozen: true, state: "idle", pending: null, lastIntegrated: "a".repeat(40), integratedCommit: "b".repeat(40) };
    // mutation: treat an absent integratedFor as already-in-target -> commit a..., red
    expect(deliveredAcceptanceTarget({ integration })).toEqual({ tip: "a".repeat(40), commit: "b".repeat(40), madeForTip: false, beforeRecord: true });
    // mutation: drop the archived exemption -> false, red
    expect(deliveredAcceptanceSatisfied({ status: "review", archived: { at: 1, actor: "x" }, integration: { ...integration, integratedFor: "a".repeat(40) } })).toBe(true);
    expect(deliveredAcceptanceSatisfied({ status: "review", integration: { ...integration, integratedFor: "a".repeat(40) } })).toBe(false);
  });
});

describe("a running requirement review does not hold integration (ruling 1, D1)", () => {
  it("groupComplete is true while the review's own call is the only active run", async () => {
    const seen: boolean[] = [];
    const holder: { w?: Awaited<ReturnType<typeof reviewWorld>> } = {};
    const w = await reviewWorld({ answer: () => {
      seen.push(groupComplete(holder.w!.t.h.store, "g"));
      return { outcome: "complete", output: { criteria: [{ id: "AC1", verdict: "met", evidence: [{ path: "a", line: 1 }], missing: null, fixableBy: "work" }, { id: "AC2", verdict: "met", evidence: [{ path: "b", line: 1 }], missing: null, fixableBy: "work" }], summary: "ok" } };
    } });
    holder.w = w;
    try {
      await w.runAll();
      await w.t.until(w.driver, () => w.review()?.state === "passed", 120);
      // The review's run was active when the answer was asked for. mutation: count it in groupComplete -> [false], red
      expect(seen).toEqual([true]);
    } finally { await w.t.h.dispose(); }
  }, 180000);
});
