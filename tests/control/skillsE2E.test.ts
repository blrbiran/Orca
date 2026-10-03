import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { readArchivedPlan, readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { controlWorkspaceRoots } from "../../src/control/workspace.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { ccloopWorlds, g, noBlocked, raw, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Syncskill integration spec §10.8 C9 (plan Task 6), a smoke with no mutation: a loop task with a frozen skill set runs
 * under ccloop's CLI-level fake claude against the real ccloop build (ORCA_CCLOOP_BIN, which must contain ccloop's
 * skillPluginDir change), with a fake syncskill doing the inject. The run lands; the landed tree carries no `.claude/`
 * path and no `syncskill-lock.json` (the snapshot lives beside the workspace, never in it); every claude call was given
 * `--plugin-dir <the run's snapshot>`; and once the run settles its snapshot is gone with its workspace.
 * Honest claim: fake claude and fake syncskill only; nothing here shows a real claude loading the plugin.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-skills-e2e-", epochPrefix: "epoch-skills-e2e-" });
const FAKE_SYNCSKILL = resolve("tests/skills/fixtures/fake-syncskill.mjs");
const extra: string[] = [];
afterAll(async () => {
  await removeRoots();
  for (const dir of extra) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;
// ccloop's fake claude reports answer.txt as changed on every execute (tests/fixtures/fake-claude-cli.mjs), so a loop
// plan's allowlist (its targetPaths) names it too, as loopPlanE2E.test.ts explains.
const loopWithSkills = { plan: "standard", goal: "write shared.txt", successCondition: "shared.txt holds the scripted text", targetPaths: ["shared.txt", "answer.txt"], checks: ["true"], skills: { names: ["alpha"] } };

describe("a run with skills against real ccloop (syncskill integration spec §10.8 C9)", { timeout: 300_000 }, () => {
  relocateHome("orca-skills-e2e-home-");
  // Gated at run time, never with describe.skipIf (tests/setup/scopeTmpdir.ts ERRATUM 2026-09-29).
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });

  it("lands, with no .claude/ and no syncskill-lock.json in the landed tree, and every claude call given the run's plugin dir", async () => {
    const fakeDir = await realpath(await mkdtemp(join(tmpdir(), "orca-skills-e2e-syncskill-")));
    extra.push(fakeDir);
    const bin = join(fakeDir, "syncskill");
    await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_SYNCSKILL}' "$@"\n`, { mode: 0o755 });
    const log = join(fakeDir, "calls.jsonl");
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt", "answer.txt"], agent: { agent: "claude" }, loop: loopWithSkills }], {}, {
      claudeScript: { a: { files: { "shared.txt": "A\n" } } },
      env: { ORCA_SYNCSKILL_BIN: bin, FAKE_SYNCSKILL_MODE: "inject-ok", FAKE_SYNCSKILL_LOG: log },
    });
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return workStatus(runtime, "a") === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "the run to settle");
      const [run] = workRuns(runtime);
      const drive = run!.body.drive;
      const dir = drive.skills.dir as string;
      expect(dir).toBe(join(`${runtime.store.stateDir}.workspaces`, `skills-${run!.runId}`));
      expect(JSON.parse(readCanonicalRecord(runtime.store, drive.envelopeHash)).work.skillPluginDir).toBe(dir);
      // Every claude call (plan, execute, verify) was handed the snapshot.
      const argv = w.argv("claude");
      expect(argv.length).toBeGreaterThan(0);
      for (const args of argv) expect(args[args.indexOf("--plugin-dir") + 1]).toBe(dir);
      expect(w.argv("codex")).toEqual([]);
      // The landed tree: the scripted change, and nothing of the snapshot.
      const landed = g(w.repo, "ls-tree", "-r", "--name-only", drive.landedCommit).split("\n");
      // Printed for the task report's C9 evidence (the full `git ls-tree -r` of the landed commit).
      console.log(`C9 landed tree of ${drive.landedCommit}:\n${g(w.repo, "ls-tree", "-r", drive.landedCommit)}`);
      expect(g(w.repo, "show", "refs/heads/orca/g:shared.txt")).toBe("A");
      expect(landed.filter((path) => path.startsWith(".claude/") || path.split("/").includes("syncskill-lock.json"))).toEqual([]);
      expect(readFileSync(log, "utf8").split("\n").filter((line) => line !== "")).toHaveLength(1);
      // Settled: the snapshot went with the workspace.
      expect(existsSync(dir)).toBe(false);
      expect(readdirSync(`${runtime.store.stateDir}.workspaces`)).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});

/**
 * Final review I1 pinned that a codex task with skills was accepted by Orca and blocked by ccloop at run start
 * (`accept-refused:2:skills-unsupported-agent`), after which the task could be neither changed nor re-dispatched and only
 * stopping the group ended it. Human ruling 2026-10-03 (session 9d95e6c8) moves the refusal to confirm, by the kind the
 * real ccloop build reports for the installation (listAgents); this criterion is rewritten to pin that instead. ccloop's
 * acceptStart refusal stays, for a table changed after confirm. Honest claim: fake codex and fake syncskill.
 */
describe("a codex task with skills is refused at confirm, by the kind real ccloop reports", { timeout: 300_000 }, () => {
  relocateHome("orca-skills-e2e-codex-home-");
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });

  it("answers skills-unsupported-agent:a:codex:codex, leaving the group unconfirmed, with no syncskill call, no run and no snapshot", async () => {
    const fakeDir = await realpath(await mkdtemp(join(tmpdir(), "orca-skills-e2e-codex-syncskill-")));
    extra.push(fakeDir);
    const bin = join(fakeDir, "syncskill");
    await writeFile(bin, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_SYNCSKILL}' "$@"\n`, { mode: 0o755 });
    const log = join(fakeDir, "calls.jsonl");
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt", "answer.txt"], agent: { agent: "codex" }, loop: loopWithSkills }],
      { a: { files: { "shared.txt": "A\n" } } },
      { env: { ORCA_SYNCSKILL_BIN: bin, FAKE_SYNCSKILL_MODE: "inject-ok", FAKE_SYNCSKILL_LOG: log } });
    const runtime = await w.boot();
    try {
      // startGroup's steps up to confirm (ccloopWorld.ts), which here must refuse.
      expect(await runtime.service.importPlan(raw(runtime, "import", "import-plan", { groupId: "g", repoId: w.repoId, planId: "plan" }))).toMatchObject({ result: { kind: "imported" } });
      const preferences = await runtime.service.setAgentPreferences(raw(runtime, "preferences", "set-agent-preferences", { preferences: { defaultAgent: "codex", perAgent: {} } }, { kind: "operator", operatorId: "human" }));
      expect("error" in preferences ? preferences.error : "set").toBe("set");
      const selections = await resolveGroupSelections({ store: runtime.store, port: runtime.port }, "g", "human");
      const hash = runtime.router.list()[0]!.profileHash;
      const confirmed = await runtime.service.confirm(raw(runtime, "confirm", "confirm", {
        planHash: readArchivedPlan(runtime.store, "g").planHash, proposalVersion: readBudgetProposal(runtime.store, "g").proposalVersion, budgetMode: "soft",
        profileIds: { estimator: "all", worker: "all", handoff: "all", goalReview: "all" }, profileHashes: { estimator: hash, worker: hash, handoff: hash, goalReview: hash },
        contextPolicy: { handoffAtContextTokens: null }, selectionsHash: selections.selectionsHash,
      }));
      expect(confirmed).toMatchObject({ error: { code: "skills-unsupported-agent", message: "skills-unsupported-agent:a:codex:codex" } });
      expect(readBudgetProposal(runtime.store, "g").state).toBe("editable");
      // Names need no profile lookup, and nothing was injected or run.
      expect(existsSync(log)).toBe(false);
      expect(workRuns(runtime)).toEqual([]);
      expect(w.argv("codex")).toEqual([]);
      expect(w.calls()).toEqual([]);
      const roots = controlWorkspaceRoots(runtime.store.stateDir);
      expect(existsSync(roots.workspacesRoot) ? readdirSync(roots.workspacesRoot) : []).toEqual([]);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
