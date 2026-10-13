import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { ccloopWorlds, g, noBlocked, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * OMP skill injection (spec docs/superpowers/specs/2026-10-13-omp-skill-injection-design.md, session 808feb6a): a loop
 * task with a frozen skill set runs on an omp installation against the real ccloop build (ORCA_CCLOOP_BIN, which must
 * contain ccloop's ompSkillsDir change and its tests/fixtures/fake-omp.mjs), with a fake syncskill doing the inject.
 * The envelope carries the snapshot's skills directory as ompSkillsDir; every OMP phase was shown the frozen SKILL.md
 * (the fake reads each listed path); the landed tree holds no snapshot file; the snapshot goes with the workspace.
 * Honest claim: fake omp and fake syncskill only; nothing here shows a real OMP model reading a skill.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-omp-skills-e2e-", epochPrefix: "epoch-omp-skills-e2e-" });
const FAKE_SYNCSKILL = resolve("tests/skills/fixtures/fake-syncskill.mjs");
const extra: string[] = [];
afterAll(async () => {
  await removeRoots();
  for (const dir of extra) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;
// ccloop's fake omp writes and reports answer.txt on every execute, so the loop plan's allowlist names it; bugfix
// has an agent verifier, so all three OMP phases run.
const loopWithSkills = { plan: "bugfix", goal: "write answer.txt", successCondition: "answer.txt holds 42", targetPaths: ["answer.txt"], checks: ["true"], skills: { names: ["alpha"] } };

describe("an OMP run with skills against real ccloop", { timeout: 300_000 }, () => {
  relocateHome("orca-omp-skills-e2e-home-");
  // Gated at run time, never with describe.skipIf (tests/setup/scopeTmpdir.ts ERRATUM 2026-09-29); the fake omp only
  // exists in a ccloop build that has the OMP skill injection.
  beforeEach((ctx) => {
    if (!realBinary || !existsSync(resolve(dirname(realBinary), "..", "tests", "fixtures", "fake-omp.mjs"))) ctx.skip();
  });

  it("hands ompSkillsDir to ccloop, shows the frozen skill to every phase, and lands only the answer", async () => {
    const fakeDir = await realpath(await mkdtemp(join(tmpdir(), "orca-omp-skills-e2e-fakes-")));
    extra.push(fakeDir);
    const syncskill = join(fakeDir, "syncskill");
    await writeFile(syncskill, `#!/bin/sh\nexec '${process.execPath}' '${FAKE_SYNCSKILL}' "$@"\n`, { mode: 0o755 });
    const w = await world([{ taskId: "a", targetPaths: ["answer.txt"], agent: { agent: "omp" }, loop: loopWithSkills }], {}, {
      env: { ORCA_SYNCSKILL_BIN: syncskill, FAKE_SYNCSKILL_MODE: "inject-ok", FAKE_SYNCSKILL_LOG: join(fakeDir, "syncskill.jsonl") },
    });
    const fakeOmp = resolve(dirname(realBinary!), "..", "tests", "fixtures", "fake-omp.mjs");
    const marker = join(fakeDir, "omp-marker");
    const omp = join(fakeDir, "omp");
    await writeFile(omp, `#!/bin/sh\nexec '${process.execPath}' '${fakeOmp}' '${marker}' "$@"\n`, { mode: 0o755 });
    w.agentsTable.installations.omp = { kind: "omp", command: [omp], version: "18.10.1", configDir: null, timeoutMs: 120_000, killGraceMs: 2_000, defaultModel: "gateway/model-a", profile: null };
    await writeFile(w.table, JSON.stringify(w.agentsTable), { mode: 0o600 });
    const runtime = await w.boot();
    try {
      await startGroup(runtime, w.repoId);
      runtime.startPump(50);
      await until(() => { noBlocked(runtime); return workStatus(runtime, "a") === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "the OMP run to settle");
      const [run] = workRuns(runtime);
      const drive = run!.body.drive;
      const envelope = JSON.parse(readCanonicalRecord(runtime.store, drive.envelopeHash));
      expect(envelope.claim.agent.agent).toBe("omp");
      expect(envelope.work.ompSkillsDir).toBe(join(drive.skills.dir, "skills"));
      expect(envelope.work).not.toHaveProperty("skillPluginDir");
      expect(envelope.work).not.toHaveProperty("codexSkillsDir");
      expect(readFileSync(`${marker}.calls`, "utf8").trim().split("\n")).toEqual(["plan", "execute", "verify"]);
      expect(readFileSync(`${marker}.skills`, "utf8")).toBe("# alpha\n".repeat(3));
      const tree = g(w.repo, "ls-tree", "-r", "--name-only", drive.landedCommit).split("\n");
      expect(tree).toContain("answer.txt");
      expect(tree.filter((path) => path.includes("SKILL.md") || path.includes("syncskill-lock.json"))).toEqual([]);
      expect(g(w.repo, "show", `${drive.landedCommit}:answer.txt`)).toBe("42");
      expect(existsSync(drive.skills.dir)).toBe(false);
      expect(await runtime.shutdown()).toBe(true);
    } finally {
      await w.teardown();
    }
  });
});
