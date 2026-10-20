import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { integrationCheckDue, INTEGRATION_CHECK_MIN_INTERVAL_MS, readIntegrationCheckState } from "../../src/control/integrationCheck.js";
import { newGroupIntegration } from "../../src/control/integrationScheme.js";
import { readSystemDebugMark } from "../../src/control/systemDebug.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { WebControlService } from "../../src/control/webService.js";
import { readRepositorySettingsBody } from "../../src/control/workspaceSettings.js";
import { unsetInheritedGitEnv } from "../../src/control/workspace.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

/**
 * Kanban spec 2026-10-20 §7 layer 1 (integrationCheck.ts): after two or more groups were merged into the target, Orca
 * runs the checks again on the merged head -- only when switched on, when the project is idle or 6 h passed, and once per
 * set of landed commits. A red check opens a system debug group (system debug task spec 2026-10-21). Every assertion
 * reads the store, git or a command's answer.
 */
const g = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8", env: { ...process.env, ...unsetInheritedGitEnv() } }).trim();
let sequence = 0;

async function world() {
  let now = Date.parse("2026-10-21T00:00:00.000Z");
  const h = await webFixture(profileSnapshot(), [{ taskId: "a" }]);
  const repo = join(h.root, "repo");
  g(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "base.txt"), "base\n");
  g(repo, "add", "base.txt"); g(repo, "commit", "-qm", "base");
  const service = new WebControlService({ ...h.deps, now: () => new Date(now), knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => repo });
  /** A group merged into main at `commit` (what the integration pass records), by writing its integration record. */
  const land = (groupId: string, commit = g(repo, "rev-parse", "main")): void => {
    if (h.store.db.prepare("SELECT 1 FROM groups WHERE id=?").get(groupId) === undefined) h.importDeferred(groupId);
    const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId)!.body)) as Record<string, unknown>;
    const integration = { ...newGroupIntegration({ delivery: "local", trigger: "task", method: "merge", target: "main" })!, lastIntegrated: commit, integratedCommit: commit };
    h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, status: "done", integration }), groupId);
  };
  const revision = (): number => readRepositorySettingsBody(h.store, "repo")?.revision ?? 0;
  const setCheck = (enabled: boolean, command: string | null) => service.setIntegrationCheck(h.rawCommand(`check-${++sequence}`, revision(), "set-integration-check", { kind: "repository", repoId: "repo" }, { enabled, command }) as never);
  /** One pass, then wait for the check it started. */
  const pass = async () => { const started = service.integrationCheckPass(); await service.integrationChecksSettled(); return started; };
  return { h, repo, service, land, setCheck, pass, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe("the integration check (kanban spec §7 layer 1)", () => {
  it("is off until an owner turns it on, and keeps its setting when the integration scheme changes", async () => {
    const w = await world(); const { h } = w; try {
      w.land("g"); w.land("g2");
      // mutation: the default setting enabled -> due, red
      expect(integrationCheckDue(h.store, "repo", w.now())).toBeNull();
      expect(await w.pass()).toEqual({ started: [] });
      expect(w.setCheck(true, "test -f base.txt")).toMatchObject({ result: { kind: "integration-check-set", integrationCheck: { enabled: true, command: "test -f base.txt" } } });
      expect(w.setCheck(true, "test -f base.txt")).toMatchObject({ error: { code: "no-op-command" } });
      const scheme = w.service.setIntegrationScheme(h.rawCommand(`scheme-${++sequence}`, readRepositorySettingsBody(h.store, "repo")!.revision, "set-integration-scheme", { kind: "repository", repoId: "repo" },
        { integration: { delivery: "local", trigger: "task", method: "merge", target: "main" } }) as never);
      expect(await scheme).toMatchObject({ result: { kind: "integration-scheme-set" } });
      // mutation: set-integration-scheme rewrites the body without the check -> undefined, red
      expect(readRepositorySettingsBody(h.store, "repo")?.integrationCheck).toEqual({ enabled: true, command: "test -f base.txt" });
    } finally { await h.dispose(); }
  });

  it("waits for two landed groups, and for an idle project or 6 h since the last check", async () => {
    const w = await world(); const { h } = w; try {
      w.setCheck(true, "true");
      w.land("g");
      // mutation: one landed group is enough -> due, red
      expect(integrationCheckDue(h.store, "repo", w.now())).toBeNull();
      w.land("g2");
      expect(integrationCheckDue(h.store, "repo", w.now())?.since.map((group) => group.groupId)).toEqual(["g", "g2"]);
      await w.pass();
      expect(readIntegrationCheckState(h.store, "repo").last).toMatchObject({ state: "passed", groups: ["g", "g2"] });
      // The same landed commits are not checked again.
      expect(integrationCheckDue(h.store, "repo", w.now())).toBeNull();
      // Two more land while another group of the project runs: not until 6 h after the last check.
      g(w.repo, "commit", "-q", "--allow-empty", "-m", "next");
      w.land("g3"); w.land("g4");
      h.importDeferred("busy");
      const busy = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='busy'").get()!.body)) as Record<string, unknown>;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='busy'").run(JSON.stringify({ ...busy, status: "running" }));
      // mutation: drop the idle test (always idle) -> due, red
      expect(integrationCheckDue(h.store, "repo", w.now())).toBeNull();
      w.advance(INTEGRATION_CHECK_MIN_INTERVAL_MS);
      expect(integrationCheckDue(h.store, "repo", w.now())?.since.map((group) => group.groupId)).toEqual(["g3", "g4"]);
    } finally { await h.dispose(); }
  });

  it("runs the command at the target's head in a worktree it removes, and a red check opens a system debug group", async () => {
    const w = await world(); const { h } = w; try {
      w.land("g"); w.land("g2");
      w.setCheck(true, "test -f base.txt && test -f missing.txt");
      expect(await w.pass()).toEqual({ started: ["repo"] });
      const last = readIntegrationCheckState(h.store, "repo").last!;
      expect(last).toMatchObject({ state: "failed", commit: g(w.repo, "rev-parse", "main"), groups: ["g", "g2"], detail: "test -f base.txt && test -f missing.txt" });
      expect(last.debugGroupId).toMatch(/^sysdebug-integration-check-[a-f0-9]{16}$/);
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(last.debugGroupId!)!.body));
      expect(readSystemDebugMark(body)).toMatchObject({ source: { kind: "integration-check", groupId: "g2", taskId: null }, stackOn: null, settled: null });
      const contract = JSON.parse(readArchivedPlan(h.store, last.debugGroupId!).plan.tasks[0]!.originalContractCanonicalJson) as { objective: { goal: string }; verification: { requiredChecks: string[] } };
      expect(contract.verification.requiredChecks).toEqual(["test -f base.txt && test -f missing.txt"]);
      expect(contract.objective.goal).toContain("after groups g, g2 were merged into it");
      // The worktree is gone (only the repository's own remains).
      expect(g(w.repo, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree ")).length).toBe(1);
      // Once its work is done, a debug group that is not a ladder's is settled `done` (nothing to fold back).
      h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, status: "running" }), last.debugGroupId!);
      const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='debug'").get(last.debugGroupId!)!.body));
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id='debug'").run(JSON.stringify({ ...work, status: "done" }), last.debugGroupId!);
      // mutation: a non-ladder group falls through to the fold -> nothing settled, red
      expect((await w.service.systemDebugPass()).settled).toEqual([last.debugGroupId]);
      expect(readSystemDebugMark(JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(last.debugGroupId!)!.body)))?.settled?.state).toBe("done");
    } finally { await h.dispose(); }
  });

  it("with no command, runs the landed groups' own required checks; a passing check opens nothing", async () => {
    const w = await world(); const { h } = w; try {
      w.land("g"); w.land("g2");
      w.setCheck(true, null);
      await w.pass();
      // The fixture's tasks are held to `true`.
      expect(readIntegrationCheckState(h.store, "repo").last).toMatchObject({ state: "passed", debugGroupId: null });
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM groups WHERE substr(id,1,9)='sysdebug-'").get()?.n).toBe(0);
    } finally { await h.dispose(); }
  });

  it("a target it cannot read is an error that covers nothing, and a check cut off by a stop is forgotten", async () => {
    const w = await world(); const { h } = w; try {
      w.land("g"); w.land("g2");
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g2'").get()!.body)) as { integration: { scheme: { target: string } } };
      body.integration.scheme.target = "no-such-branch";
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g2'").run(JSON.stringify(body));
      w.setCheck(true, "true");
      await w.pass();
      // toEqual, not toMatchObject: `{}` would match any covered set.
      expect(readIntegrationCheckState(h.store, "repo").covered).toEqual({});
      expect(readIntegrationCheckState(h.store, "repo").last).toMatchObject({ state: "errored" });
      // A `running` state this process did not start (Orca stopped mid-check) does not block the next one.
      h.store.db.prepare("UPDATE meta SET value=? WHERE key='integration-check:repo'").run(JSON.stringify({ lastAt: 1, covered: {}, last: { state: "running", at: 1, commit: null, groups: [], detail: null, debugGroupId: null } }));
      expect(w.service.integrationCheckPass()).toEqual({ started: ["repo"] });
      await w.service.integrationChecksSettled();
    } finally { await h.dispose(); }
  });
});
