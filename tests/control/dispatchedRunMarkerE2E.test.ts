import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { ccloopWorlds, noBlocked, realBinary, startGroup, until, workRuns, type World } from "./fixtures/ccloopWorld.js";

/**
 * CLI v2 spec §15.4 (plan Task 8): every process Orca starts for work carries ORCA_DISPATCHED_RUN=<runId> and an
 * ORCA_PERSON_DIR pointed at the panel's empty `dispatched-person` directory. Each agent kind's fake CLI is started
 * through a shell wrapper that prints both variables as its own shell sees them, so what is measured is what reached
 * the agent's process through ccloop -- not what Orca meant to send. Fakes only (claude, codex, omp from the
 * ORCA_CCLOOP_BIN build); no real agent is claimed.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-marker-e2e-", epochPrefix: "epoch-marker-e2e-" });
afterAll(removeRoots);

/**
 * Replace an installation's command with a one-word wrapper (ccloop's omp entry takes exactly one element) that logs
 * `<run> <person dir> <work|probe>` and then execs the original command, its own arguments first, unchanged. `work` is
 * a phase call (codex `exec`, claude and omp `-p`); `probe` is ccloop asking the installation about itself (`--version`,
 * models, features, mcp list) while resolving a selection -- a call about no run, which no run id can name.
 */
async function wrap(w: World, installation: string): Promise<string> {
  const log = join(w.root, `${installation}-env.log`);
  const wrapper = join(w.root, `${installation}-wrapper.sh`);
  const entry = w.agentsTable.installations[installation]!;
  const original = (entry.command as string[]).map((arg) => `'${arg}'`).join(" ");
  await writeFile(wrapper, `#!/bin/sh\nkind=probe\nfor arg in "$@"; do case "$arg" in exec|-p) kind=work;; esac; done\nprintf '%s %s %s\\n' "\${ORCA_DISPATCHED_RUN-unset}" "\${ORCA_PERSON_DIR-unset}" "$kind" >> '${log}'\nexec ${original} "$@"\n`, { mode: 0o755 });
  entry.command = [wrapper];
  await writeFile(w.table, JSON.stringify(w.agentsTable), { mode: 0o600 });
  return log;
}

const workStatus = (runtime: ControlRuntime, taskId: string): string =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body)).status;

async function measure(w: World, installation: string): Promise<void> {
  const log = await wrap(w, installation);
  const runtime = await w.boot();
  try {
    await startGroup(runtime, w.repoId);
    runtime.startPump(50);
    await until(() => { noBlocked(runtime); return workStatus(runtime, "a") === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true); }, 240_000, "a to settle");
    const lines = readFileSync(log, "utf8").trim().split("\n").map((line) => line.split(" ") as [string, string, string]);
    const work = lines.filter(([, , kind]) => kind === "work");
    // Plan, execute and verify each started the agent's CLI.
    expect(work.length).toBeGreaterThanOrEqual(3);
    // Every phase call saw the work run's own id and the panel's empty person directory.
    expect(new Set(work.map(([run, person]) => `${run} ${person}`))).toEqual(new Set([`${workRuns(runtime)[0]!.runId} ${join(runtime.store.stateDir, "dispatched-person")}`]));
    expect(await runtime.shutdown()).toBe(true);
  } finally { await w.teardown(); }
}

describe("the dispatched-run marker reaches every agent kind's process (spec §15.4)", { timeout: 300_000 }, () => {
  relocateHome("orca-marker-e2e-home-");
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });

  it("codex", async () => {
    await measure(await world([{ taskId: "a", targetPaths: ["a.txt"] }], { a: { files: { "a.txt": "A\n" } } }), "codex");
  });

  it("claude", async () => {
    await measure(await world([{ taskId: "a", targetPaths: ["a.txt"], agent: { agent: "claude" } }], {}, { claudeScript: { a: { files: { "a.txt": "A\n" } } } }), "claude");
  });

  it("omp", async (ctx) => {
    const fakeOmp = resolve(dirname(realBinary!), "..", "tests", "fixtures", "fake-omp.mjs");
    if (!existsSync(fakeOmp)) ctx.skip();
    const w = await world([{ taskId: "a", targetPaths: ["answer.txt"], agent: { agent: "omp" },
      loop: { plan: "bugfix", goal: "write answer.txt", successCondition: "answer.txt holds 42", targetPaths: ["answer.txt"], checks: ["true"] } }], {});
    // As ompSkillsE2E.test.ts: the fake behind a one-word shell command.
    const omp = join(w.root, "omp");
    await writeFile(omp, `#!/bin/sh\nexec '${process.execPath}' '${fakeOmp}' '${join(w.root, "omp-marker")}' "$@"\n`, { mode: 0o755 });
    w.agentsTable.installations.omp = { kind: "omp", command: [omp], version: "18.10.1", configDir: null, timeoutMs: 120_000, killGraceMs: 2_000, defaultModel: "gateway/model-a", profile: null };
    await measure(w, "omp");
  });
});
