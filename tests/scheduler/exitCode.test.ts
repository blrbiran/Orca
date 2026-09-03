import { describe, expect, it } from "vitest";
import { reduceExitCode } from "../../src/scheduler/exitCode.js";

// spec §6.3's precedence, 3 > 2 > 1 > 0, as its own testable unit: run.ts used
// to inline this as `contributions.reduce(Math.max, 0)`, which is faithful
// only by accident — it happens to agree with 3 > 2 > 1 > 0 because the codes
// are ordered integers, not because Math.max encodes any precedence. Mutation
// M-EXIT (invert the 3 > 2 ordering) has to redden the first test below
// without touching the numeric values at all, which Math.max could never do.
describe("reduceExitCode (spec 6.3)", () => {
  it("is 3 whenever anything escalated, even alongside a failure", () => {
    // Written down because otherwise "a failure and an escalation in the same
    // run" is undefined. 2 means "this path is dead, read the log"; 3 means
    // "a person has to come back and do something". Demoting 3 to 2 makes that
    // errand vanish into a pile of failures; the reverse just reminds twice.
    expect(reduceExitCode([2, 3, 0])).toBe(3);
    expect(reduceExitCode([3, 2])).toBe(3);
  });

  it("is 2 when something failed and nothing escalated", () => {
    expect(reduceExitCode([0, 2, 0])).toBe(2);
  });

  it("has no mode in which a task failed and the run still exits 0", () => {
    // nextflow's IGNORE strategy exits 0 by default and needs an opt-in flag
    // to do otherwise. There is no --ignore-failures here, not one.
    expect(reduceExitCode([0, 2])).not.toBe(0);
  });

  it("is 0 only when everything succeeded and landed", () => {
    expect(reduceExitCode([0, 0])).toBe(0);
  });

  it("is 0 on an empty contribution list, the vacuous case Math.max needed a seed for", () => {
    // Math.max's own seed (`reduce((worst, code) => Math.max(worst, code), 0)`)
    // made this true by construction; spelled out here so the replacement is
    // held to the same fact rather than assumed to inherit it.
    expect(reduceExitCode([])).toBe(0);
  });
});
