import { describe, expect, it, vi } from "vitest";
import { captureStreams } from "../scheduler/sandbox.js";

// Plan D2: plain `orca panel` must not depend on the service modules loading. If src/cli.ts imported them for every
// panel argv, this broken module would turn the foreground panel's own refusal into a crash.
vi.mock("../../src/service/command.js", () => { throw new Error("service/command.js loaded"); });
const { main } = await import("../../src/cli.js");

describe("orca panel without a service word (plan D2)", () => {
  it("never loads src/service/command.js", async () => {
    for (const argv of [["panel", "run", "--port", "0"], ["panel", "--port", "0"]]) {
      const { result, stderr } = await captureStreams(() => main(argv));
      expect([result, stderr.includes("no-viewer-identity")]).toEqual([1, true]);
    }
    // The control: a service word does load it, so the mock is live (vitest wraps the factory's error).
    await expect(main(["panel", "status"])).rejects.toThrow();
  });
});
