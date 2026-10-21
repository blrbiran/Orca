import { describe, expect, it, vi } from "vitest";

// CLI v2 plan Task 1, Review Focus 1: a registry command loads its handler on demand. `orca status` reads the panel over
// the socket and must not pull in the control plane's modules (the panel side of the socket: routes, service, store).
// Its own file, not a case in cliLazy.test.ts: vi.mock is file-wide, and these mocks would break that file's panel case,
// which loads the panel server (and so controlApi) on purpose.
vi.mock("../../src/panel/controlApi.js", () => { throw new Error("panel/controlApi.js loaded"); });
vi.mock("../../src/control/webService.js", () => { throw new Error("control/webService.js loaded"); });
vi.mock("../../src/control/store.js", () => { throw new Error("control/store.js loaded"); });
const { main } = await import("../../src/cli.js");

// Not tests/scheduler/sandbox.ts's captureStreams: that helper's own imports load the control plane.
async function captureStdout(fn: () => Promise<number>): Promise<{ result: number; stdout: string }> {
  const out: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => { out.push(chunk.toString()); return true; }) as typeof process.stdout.write;
  try { return { result: await fn(), stdout: out.join("") }; } finally { process.stdout.write = original; }
}

describe("orca status loads no control-plane module (CLI v2 plan Task 1)", () => {
  it("answers without importing src/panel/controlApi, src/control/webService or src/control/store", async () => {
    const { result, stdout } = await captureStdout(() => main(["status", "--control-state-dir", "/nonexistent/orca-state"]));
    expect(result).toBe(1);
    expect(stdout).toContain("fail panel:");
    // The control: the mocks are live -- importing a mocked module directly throws.
    await expect(import("../../src/control/webService.js")).rejects.toThrow();
  });
});
