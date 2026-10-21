import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCheckState } from "../../src/control/checks/state.js";
import { INTEGRATION_CHECK_MIN_INTERVAL_MS } from "../../src/control/integrationCheck.js";
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
  // Ruling: 这次批准改写所有必要的判据 (b37f7ce9): the integration-check setter is removed; set-check-settings writes the same fields (checks spec §4.4).
  const setCheck = (enabled: boolean, command: string | null) => service.setCheckSettings(h.rawCommand(`check-${++sequence}`, revision(), "set-check-settings", { kind: "repository", repoId: "repo" }, { kind: "integration-check", set: { enabled, command }, clear: [] }) as never);
  /** One pass, then wait for the check it started. */
  // Ruling: 这次批准改写所有必要的判据 (b37f7ce9): the check runs on the check model (checks spec 2026-10-22 §5):
  // checksPass, a watermark per (project, kind, target), and real commits per landed group (a range is W..H).
  const pass = async () => { const out = await service.checksPass(); await service.checksSettled(); return { started: out.started }; };
  /** A commit on main, then the group landed at it. */
  const commitLand = async (groupId: string): Promise<string> => { g(repo, "commit", "-q", "--allow-empty", "-m", `land ${groupId}`); const commit = g(repo, "rev-parse", "main"); land(groupId, commit); return commit; };
  const state = () => readCheckState(h.store, "repo", "integration-check", "main");
  return { h, repo, service, land, commitLand, state, setCheck, pass, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe("the integration check (kanban spec §7 layer 1)", () => {
  it("is off until an owner turns it on, and keeps its setting when the integration scheme changes", async () => {
    const w = await world(); const { h } = w; try {
      w.land("g"); w.land("g2");
      // mutation: the default setting enabled -> evaluated (a state row), red
      expect(await w.pass()).toEqual({ started: [] });
      expect(w.state()).toBeNull();
      // Ruling: 这次批准改写所有必要的判据 (b37f7ce9): set-check-settings answers the layer it wrote (spec §4.4).
      expect(w.setCheck(true, "test -f base.txt")).toMatchObject({ result: { kind: "check-settings-set", repoId: "repo", checks: { integrationCheck: { enabled: true, command: "test -f base.txt" } } } });
      expect(w.setCheck(true, "test -f base.txt")).toMatchObject({ error: { code: "no-op-command" } });
      const scheme = w.service.setIntegrationScheme(h.rawCommand(`scheme-${++sequence}`, readRepositorySettingsBody(h.store, "repo")!.revision, "set-integration-scheme", { kind: "repository", repoId: "repo" },
        { integration: { delivery: "local", trigger: "task", method: "merge", target: "main" } }) as never);
      expect(await scheme).toMatchObject({ result: { kind: "integration-scheme-set" } });
      // mutation: set-integration-scheme rewrites the body without the check -> undefined, red
      expect(readRepositorySettingsBody(h.store, "repo")?.checks?.integrationCheck).toEqual({ enabled: true, command: "test -f base.txt" });
    } finally { await h.dispose(); }
  });

  it("waits for two landed groups, and for an idle project or 6 h since the last check", async () => {
    const w = await world(); const { h } = w; try {
      w.setCheck(true, "true");
      w.land("old");
      // The first evaluation only sets the watermark (checks spec §5.3).
      expect(await w.pass()).toEqual({ started: [] });
      await w.commitLand("g");
      // mutation: one landed group is enough -> started, red
      expect(await w.pass()).toEqual({ started: [] });
      await w.commitLand("g2");
      expect(await w.pass()).toEqual({ started: ["repo"] });
      expect(w.state()?.last).toMatchObject({ state: "passed", groups: ["g", "g2"] });
      // The same landed commits are not checked again.
      expect(await w.pass()).toEqual({ started: [] });
      // Two more land while another group of the project runs: not until 6 h after the last check.
      await w.commitLand("g3"); await w.commitLand("g4");
      h.importDeferred("busy");
      const busy = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='busy'").get()!.body)) as Record<string, unknown>;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='busy'").run(JSON.stringify({ ...busy, status: "running" }));
      // mutation: drop the idle test (always idle) -> started, red
      expect(await w.pass()).toEqual({ started: [] });
      w.advance(INTEGRATION_CHECK_MIN_INTERVAL_MS);
      expect(await w.pass()).toEqual({ started: ["repo"] });
      expect(w.state()?.last).toMatchObject({ state: "passed", groups: ["g3", "g4"] });
    } finally { await h.dispose(); }
  });

  it("runs the command at the target's head in a worktree it removes, and a red check opens a system debug group", async () => {
    const w = await world(); const { h } = w; try {
      w.setCheck(true, "test -f base.txt && test -f missing.txt");
      w.land("old"); // an earlier landing names the target; the first evaluation only sets the watermark
      await w.pass();
      await w.commitLand("g"); await w.commitLand("g2");
      expect(await w.pass()).toEqual({ started: ["repo"] });
      const last = w.state()!.last!;
      expect(last).toMatchObject({ state: "failed", to: g(w.repo, "rev-parse", "main"), groups: ["g", "g2"], detail: "test -f base.txt && test -f missing.txt" });
      expect(last.debugGroupIds).toHaveLength(1);
      const debugGroupId = last.debugGroupIds[0]!;
      expect(debugGroupId).toMatch(/^sysdebug-integration-check-[a-f0-9]{16}$/);
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(debugGroupId)!.body));
      expect(readSystemDebugMark(body)).toMatchObject({ source: { kind: "integration-check", groupId: "g2", taskId: null }, stackOn: null, settled: null });
      const contract = JSON.parse(readArchivedPlan(h.store, debugGroupId).plan.tasks[0]!.originalContractCanonicalJson) as { objective: { goal: string }; verification: { requiredChecks: string[] } };
      expect(contract.verification.requiredChecks).toEqual(["test -f base.txt && test -f missing.txt"]);
      expect(contract.objective.goal).toContain("after groups g, g2 were merged into it");
      // The worktree is gone (only the repository's own remains).
      expect(g(w.repo, "worktree", "list", "--porcelain").split("\n").filter((line) => line.startsWith("worktree ")).length).toBe(1);
      // Once its work is done, a debug group that is not a ladder's is settled `done` (nothing to fold back).
      h.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify({ ...body, status: "running" }), debugGroupId);
      const work = JSON.parse(String(h.store.db.prepare("SELECT body FROM work_items WHERE group_id=? AND id='debug'").get(debugGroupId)!.body));
      h.store.db.prepare("UPDATE work_items SET body=? WHERE group_id=? AND id='debug'").run(JSON.stringify({ ...work, status: "done" }), debugGroupId);
      // mutation: a non-ladder group falls through to the fold -> nothing settled, red
      expect((await w.service.systemDebugPass()).settled).toEqual([debugGroupId]);
      expect(readSystemDebugMark(JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id=?").get(debugGroupId)!.body)))?.settled?.state).toBe("done");
    } finally { await h.dispose(); }
  });

  // CLI v2 spec §15.3-§15.4 (review M1, session b37f7ce9): the check's command runs as a run Orca dispatched -- the
  // check's id as the marker and the panel state's empty `dispatched-person` directory as ORCA_PERSON_DIR.
  it("runs the command with the check's marker and the panel's dispatched-person directory", async () => {
    const w = await world(); const { h } = w; try {
      w.land("g"); w.land("g2");
      const seen = join(h.root, "seen.txt");
      w.setCheck(true, `printf '%s %s' "\${ORCA_DISPATCHED_RUN-unset}" "\${ORCA_PERSON_DIR-unset}" > '${seen}'`);
      expect(await w.pass()).toEqual({ started: ["repo"] });
      // Mutation "webService passes another directory" (or none) -> red.
      expect(readFileSync(seen, "utf8")).toMatch(new RegExp(`^integration-check-[0-9a-f]{12}-\\d+ ${join(h.store.stateDir, "dispatched-person")}$`));
    } finally { await h.dispose(); }
  });

  it("with no command, runs the landed groups' own required checks; a passing check opens nothing", async () => {
    const w = await world(); const { h } = w; try {
      w.setCheck(true, null);
      w.land("old"); // an earlier landing names the target; the first evaluation only sets the watermark
      await w.pass();
      await w.commitLand("g"); await w.commitLand("g2");
      await w.pass();
      // The fixture's tasks are held to `true`.
      expect(w.state()?.last).toMatchObject({ state: "passed", debugGroupIds: [] });
      expect(h.store.db.prepare("SELECT COUNT(*) AS n FROM groups WHERE substr(id,1,9)='sysdebug-'").get()?.n).toBe(0);
    } finally { await h.dispose(); }
  });

  it("a target it cannot read is an error that covers nothing, and a check cut off by a stop is forgotten", async () => {
    const w = await world(); const { h } = w; try {
      w.setCheck(true, "true");
      w.land("old"); // an earlier landing names the target; the first evaluation only sets the watermark
      await w.pass();
      await w.commitLand("g"); await w.commitLand("g2");
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g2'").get()!.body)) as { integration: { scheme: { target: string } } };
      body.integration.scheme.target = "no-such-branch";
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g2'").run(JSON.stringify(body));
      const watermark = w.state()!.watermark;
      await w.pass();
      // The unreadable target is its own state, errored; the readable one covers nothing new (one group there).
      expect(readCheckState(h.store, "repo", "integration-check", "no-such-branch")?.last).toMatchObject({ state: "errored", detail: "target unreadable: no-such-branch" });
      expect(w.state()!.watermark).toBe(watermark);
      // A `running` state this process did not start (Orca stopped mid-check) does not block the next one.
      body.integration.scheme.target = "main";
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g2'").run(JSON.stringify(body));
      h.store.db.prepare("UPDATE check_state SET body=? WHERE repo_id='repo' AND kind='integration-check' AND target='main'").run(JSON.stringify({ ...w.state()!, lastStartAt: 1, last: { state: "running", at: 1, from: watermark, to: null, groups: [], detail: null, reviewGroupId: null, debugGroupIds: [], recordHash: null } }));
      expect(await w.pass()).toEqual({ started: ["repo"] });
    } finally { await h.dispose(); }
  });
});
