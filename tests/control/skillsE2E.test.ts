import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { ccloopWorlds, g, noBlocked, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

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
