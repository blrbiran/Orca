import { describe, expect, it } from "vitest";
import { autoConfirmStep } from "../../src/panel/controlAssembly.js";

/**
 * Review M1 (tester round 2 §7.2): the pump's automatic-confirm step never rejects, so a failing pass cannot skip the
 * auto-start and integration-conflict passes chained after it; it writes what happened instead.
 */
describe("the pump's automatic-confirm step", () => {
  it("logs a failing pass and resolves, so the passes after it still run", async () => {
    const lines: string[] = [];
    await expect(autoConfirmStep({ autoConfirmUnlimitedPass: async () => { throw new Error("boom"); } }, line => lines.push(line))).resolves.toBeUndefined();
    expect(lines).toEqual(["orca-control: automatic confirm pass failed: boom\n"]);
  });
  it("writes one line per refused group", async () => {
    const lines: string[] = [];
    await autoConfirmStep({ autoConfirmUnlimitedPass: async () => ({ confirmed: ["a"], refused: [{ groupId: "g", code: "handoff-grant-insufficient" }] }) }, line => lines.push(line));
    expect(lines).toEqual(["orca-control: automatic confirm of g refused: handoff-grant-insufficient\n"]);
  });
});
