import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ESTIMATE_INSTRUCTIONS } from "../../src/control/estimatePrompt.js";
import { ESTIMATE_INSTRUCTION_VERSIONS, NEWEST_ESTIMATE_INSTRUCTION, olderEstimateInstruction } from "../../src/control/estimateInstructionAge.js";

// Tester follow-up F §4 (#173): the panel's budget editor warns about an older estimate instruction as the CLI does, so
// the check is one module both use. The browser bundle cannot ship estimatePrompt.ts (task 8 ruling K2), so the module
// lists the versions itself; this pins the list to the instructions Orca actually holds.
const shared = readFileSync(new URL("../../src/control/estimateInstructionAge.ts", import.meta.url), "utf8");

describe("the estimate instruction age check (#173)", () => {
  it("lists exactly the instruction versions estimatePrompt.ts holds", () => {
    expect([...ESTIMATE_INSTRUCTION_VERSIONS].sort()).toEqual(Object.keys(ESTIMATE_INSTRUCTIONS).sort());
    expect(NEWEST_ESTIMATE_INSTRUCTION).toBe(Math.max(...Object.keys(ESTIMATE_INSTRUCTIONS).map(Number)));
  });

  it("names a known older version, and nothing for the newest, an unknown or an unreported one", () => {
    expect(olderEstimateInstruction("1")).toBe("1");
    expect(olderEstimateInstruction(String(NEWEST_ESTIMATE_INSTRUCTION))).toBeNull();
    expect(olderEstimateInstruction("99")).toBeNull();
    expect(olderEstimateInstruction(null)).toBeNull();
    expect(olderEstimateInstruction(undefined)).toBeNull();
  });

  it("imports nothing, so the browser bundle pulls in no server module", () => {
    expect(shared.match(/^\s*(import|export\s+[^;]*\sfrom)\s/gm)).toBeNull();
    expect(shared).not.toMatch(/\brequire\(|\bimport\(/);
  });
});
