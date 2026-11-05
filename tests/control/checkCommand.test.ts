import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { firstFailingSetup, runAsCheck } from "../../src/control/checkCommand.js";

// Human ruling 2026-11-05 (session e2ad4802): every command Orca runs itself as a check -- the criteria base run, the
// reproduce-first check and the integration check, setup and checks alike -- goes through one runner, so a failure reads
// the same everywhere: the exit (or the bound that killed it), the output's tail, and nothing after the first failed setup.
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const workdir = async (): Promise<string> => { const dir = await mkdtemp(join(tmpdir(), "orca-check-command-")); dirs.push(dir); return dir; };

describe("runAsCheck", () => {
  it("an exit 0 is no failure; a non-zero exit is answered with its code and the output's last 2048 characters", async () => {
    const dir = await workdir();
    expect(await runAsCheck(dir, "true", 10_000, { runId: "run-c" })).toBeNull();
    const failure = await runAsCheck(dir, "printf 'x%.0s' $(seq 1 3000); printf 'END' >&2; exit 7", 10_000, { runId: "run-c" });
    expect(failure).toMatchObject({ command: expect.stringContaining("exit 7"), exit: "7" });
    expect(failure!.tail).toHaveLength(2048);
    expect(failure!.tail.endsWith("END")).toBe(true);
  });

  it("a command past its bound is a failure named by the bound, with no tail", async () => {
    const dir = await workdir();
    expect(await runAsCheck(dir, "sleep 5", 200, { runId: "run-c" })).toEqual({ command: "sleep 5", exit: "timeout 200 ms", tail: "" });
  });

  it("runs as the dispatched run", async () => {
    const dir = await workdir();
    expect(await runAsCheck(dir, 'printf "%s" "$ORCA_DISPATCHED_RUN" > who.txt', 10_000, { runId: "run-who" })).toBeNull();
    expect(await readFile(join(dir, "who.txt"), "utf8")).toBe("run-who");
  });
});

describe("firstFailingSetup", () => {
  it("runs in order and stops at the first failure, answering it whole", async () => {
    const dir = await workdir();
    expect(await firstFailingSetup(dir, ["touch one", "echo broke; exit 3", "touch three"], 10_000, { runId: "run-c" }))
      .toEqual({ command: "echo broke; exit 3", exit: "3", tail: "broke" });
    expect(existsSync(join(dir, "one"))).toBe(true);
    expect(existsSync(join(dir, "three"))).toBe(false);
    expect(await firstFailingSetup(dir, [], 10_000, { runId: "run-c" })).toBeNull();
  });
});
