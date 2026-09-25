import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HANDOFF_EXTRA_GRACE_MS } from "../../src/control/driverHandoff.js";
import { handoffGraceMsOf } from "../../src/panel/controlAssembly.js";

// Handoff delivery spec §3 (controller decision) and §10: a delivered request that yields nothing turns
// outcome-unknown only past deadline + the adapter's killGraceMs + 60 s. ccloop itself waits killGraceMs
// before it kills a phase, so a grace shorter than that would call a stop "unknown" while ccloop is still
// legitimately finishing it. The wiring into the running driver is measured by handoffE2E.test.ts (G).
const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function config(text: string | null): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-assembly-grace-")));
  roots.push(root);
  const path = join(root, "adapter.json");
  if (text !== null) await writeFile(path, text, { mode: 0o600 });
  return path;
}

describe("the handoff grace the assembly hands the driver (spec §3)", () => {
  it("is the adapter's killGraceMs plus the fixed extra, and only the fixed extra when killGraceMs is unusable", async () => {
    expect(HANDOFF_EXTRA_GRACE_MS).toBe(60_000);
    expect(handoffGraceMsOf(await config(JSON.stringify({ command: ["codex"], killGraceMs: 5_000 })))).toBe(65_000);
    expect(handoffGraceMsOf(await config(JSON.stringify({ killGraceMs: 0 })))).toBe(60_000);
    // Never shorter than the fixed part, whatever the file says or fails to say.
    for (const text of [JSON.stringify({}), JSON.stringify({ killGraceMs: -1 }), JSON.stringify({ killGraceMs: 1.5 }),
      JSON.stringify({ killGraceMs: "5000" }), "null", "not json", null]) {
      expect(handoffGraceMsOf(await config(text))).toBe(60_000);
    }
  });
});
