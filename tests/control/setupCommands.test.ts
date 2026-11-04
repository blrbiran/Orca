import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runSetup } from "../../src/control/debugRepro.js";
import { setupCommandsOf, unionSetup } from "../../src/control/setupUnion.js";

/**
 * Task setup spec 2026-11-04 §4.6: Orca's own check runs install a task's setup first. runSetup is what the criteria base
 * run and the reproduce-first check call; unionSetup is how several tasks' setup becomes one list (the integration check,
 * the conflict-resolution contracts). Every assertion reads a file the commands wrote or the value answered.
 */
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("runSetup (spec §4.6)", () => {
  it("runs each command in order in the directory, and stops at the first that fails, naming it", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-setup-")));
    dirs.push(dir);
    const log = join(dir, "log.txt");
    expect(await runSetup(dir, ["printf 'one\\n' >> log.txt", "printf 'two\\n' >> log.txt"], 10_000, { runId: "run-t" })).toEqual({ ok: true });
    // Relative paths: the commands ran in `dir`, in the order given.
    expect(readFileSync(log, "utf8")).toBe("one\ntwo\n");
    // A failure stops the list: the command after it never runs.
    expect(await runSetup(dir, ["printf 'three\\n' >> log.txt", "exit 4", "touch after.txt"], 10_000, { runId: "run-t" })).toEqual({ ok: false, command: "exit 4" });
    expect(readFileSync(log, "utf8")).toBe("one\ntwo\nthree\n");
    expect(existsSync(join(dir, "after.txt"))).toBe(false);
  });

  it("a command that outlives its bound is a failure, not a hang", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "orca-setup-")));
    dirs.push(dir);
    expect(await runSetup(dir, ["sleep 5"], 200, { runId: "run-t" })).toEqual({ ok: false, command: "sleep 5" });
  });
});

describe("unionSetup (spec §4.6)", () => {
  it("is the tasks' setup in first-seen order, each command once; undefined when no task has any", () => {
    expect(unionSetup([["npm ci"], undefined, ["npm ci", "make gen"], ["make gen", "pip install -e ."]])).toEqual(["npm ci", "make gen", "pip install -e ."]);
    expect(unionSetup([undefined, [], undefined])).toBeUndefined();
    expect(unionSetup([])).toBeUndefined();
  });

  it("reads a contract's setup defensively", () => {
    expect(setupCommandsOf({ context: { setupCommands: ["npm ci", 3] } })).toEqual(["npm ci"]);
    expect(setupCommandsOf({ context: {} })).toBeUndefined();
    expect(setupCommandsOf(null)).toBeUndefined();
  });
});
