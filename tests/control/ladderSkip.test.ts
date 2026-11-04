import { describe, expect, it } from "vitest";
import { couldNotRun } from "../../src/control/ladderSkip.js";

/**
 * Task setup and check retry spec 2026-11-04 §4.7: the ladder leaves out a run whose failing required check could not run
 * at all -- another try of the same contract fails the same way. Decided by code on the raw stored rejection, and only on
 * the one evidence entry ccloop wrote for the failing command (ccloop runLoop.ts buildRequiredCheckEvidence: segments
 * joined by " | ": "command output", "required check passed|failed: <cmd>", optional stdout=, optional stderr=, then for a
 * failed check one of exit= / signal= / error=).
 */
const failed = (command: string, parts: { stdout?: string; stderr?: string; end: string }): string =>
  ["command output", `required check failed: ${command}`, ...(parts.stdout === undefined ? [] : [`stdout=${parts.stdout}`]), ...(parts.stderr === undefined ? [] : [`stderr=${parts.stderr}`]), parts.end].join(" | ");
const passed = (command: string, stdout: string): string => ["command output", `required check passed: ${command}`, `stdout=${stdout}`].join(" | ");

describe("couldNotRun: the failing check never ran (spec §4.7)", () => {
  it("exit 127 or 126 on the failing entry, or a missing npm script in its stderr, could not run", () => {
    // mutation: drop the exit-code test -> false, red
    expect(couldNotRun("npx vitest run", [failed("npx vitest run", { stderr: "sh: npx: not here", end: "exit=127" })])).toBe(true);
    expect(couldNotRun("./check.sh", [failed("./check.sh", { end: "exit=126" })])).toBe(true);
    // mutation: drop the stderr test -> false, red
    expect(couldNotRun("npm test", [failed("npm test", { stderr: 'npm error Missing script: "test"', end: "exit=1" })])).toBe(true);
    expect(couldNotRun("make check", [failed("make check", { stderr: "sh: make: command not found", end: "exit=1" })])).toBe(true);
  });

  it("finds the failing entry among others, and reads its stderr even when its output holds the separator", () => {
    const evidence = [
      passed("npm run lint", "ok"),
      failed("npm test", { stdout: "a | b", stderr: 'x | npm error Missing script: "test"', end: "exit=1" }),
    ];
    expect(couldNotRun("npm test", evidence)).toBe(true);
    // A command that itself holds the separator still names its own entry.
    expect(couldNotRun("npm test | tee log", [failed("npm test | tee log", { end: "exit=127" })])).toBe(true);
  });

  it("ENOENT or command not found elsewhere does not count", () => {
    // In a passed entry (another check), and in the failing entry's stdout -- only its own stderr and exit code speak.
    expect(couldNotRun("npm test", [
      passed("npm run gen", "sh: protoc: command not found"),
      failed("npm test", { stderr: "AssertionError: expected 1 to be 2", end: "exit=1" }),
    ])).toBe(false);
    // An entry for another failing command does not count either.
    // mutation A5-M1: match any evidence entry -> the e2e entry's exit 127 counts, true, red
    expect(couldNotRun("npm test", [failed("npm run e2e", { end: "exit=127" }), failed("npm test", { end: "exit=1" })])).toBe(false);
    expect(couldNotRun("npm test", [failed("npm test", { stdout: "sh: foo: command not found ENOENT", stderr: "AssertionError", end: "exit=1" })])).toBe(false);
  });

  it("an ordinary failure is not could-not-run", () => {
    expect(couldNotRun("npm test", [failed("npm test", { stderr: "AssertionError: expected 1 to be 2", end: "exit=1" })])).toBe(false);
    // exit=1270 is not exit=127; a signal is not a missing program.
    expect(couldNotRun("npm test", [failed("npm test", { end: "exit=1270" })])).toBe(false);
    expect(couldNotRun("npm test", [failed("npm test", { end: "signal=SIGKILL" })])).toBe(false);
    // A verifier rejection names no command: nothing to match.
    expect(couldNotRun(null, [failed("npm test", { end: "exit=127" })])).toBe(false);
    expect(couldNotRun("npm test", [])).toBe(false);
  });
});
