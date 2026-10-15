import { describe, expect, it, vi } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.9: paths that turn a ccloop failure into "unknown" and try again keep doing so,
// but each names ccloop's failure on stderr once per occurrence, so `orca panel logs` says why a run went unknown.
describe("unknown-path log lines (spec A §4.9)", () => {
  it("names the accept and the inspect failures a run went unknown on", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    try {
      const port = t.fake.port as unknown as Record<string, unknown>;
      port.accept = async () => { throw new ControlError("control-peer-exit", "1:Error: accept lost"); };
      port.inspect = async () => { throw new ControlError("control-peer-exit", "1:Error: inspect lost"); };
      t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedReason: "inspect-unknown" });
      expect([...new Set(lines.filter((line) => line.startsWith(`orca-driver: ${runId}: ccloop`)))]).toEqual([
        `orca-driver: ${runId}: ccloop unknown: Error: accept lost\n`, `orca-driver: ${runId}: ccloop unknown: Error: inspect lost\n`,
      ]);
    } finally { spy.mockRestore(); await t.h.dispose(); }
  }, 30_000);
});
