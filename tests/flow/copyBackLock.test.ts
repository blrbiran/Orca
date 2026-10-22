/**
 * Flow engine spec §5.4 (review finding I3): copy-back into the person's folder is serialised per folder, across runs.
 * Two runs on one folder whose steps land at the same time must never write it concurrently: each copy-back decides
 * add / modify / merge / delete from the folder's bytes, and a write interleaved with that read makes the decision stale.
 * Copy-backs into different folders still run side by side.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { advanceRun } from "../../src/flow/kernel.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { withDirLock } from "../../src/flow/vault/dirLock.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const live = new Map<string, number>();
const peak = new Map<string, number>();
vi.mock("../../src/flow/vault/copyBack.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/flow/vault/copyBack.js")>();
  return {
    ...real,
    copyBack: async (...args: Parameters<typeof real.copyBack>) => {
      const dir = args[1];
      live.set(dir, (live.get(dir) ?? 0) + 1);
      peak.set(dir, Math.max(peak.get(dir) ?? 0, live.get(dir)!));
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return await real.copyBack(...args);
      } finally { live.set(dir, live.get(dir)! - 1); }
    },
  };
});

const ONE = { one: { yaml: `format: orca-flow-v1
id: one
workspace: {kind: dir}
steps:
  - {id: write, kind: work, prompt: p.md}
`, assets: { "p.md": "Write.\n" } } };

describe("copy-back is serialised per folder (I3)", () => {
  it("two runs on one folder landing at once copy back one after the other; both files arrive", async () => {
    const children = fakeChildPort();
    const w = await flowWorld(ONE, { children: children.port, files: { "notes.txt": "n\n" } }); try {
      const a = await w.start({ templateRef: "builtin/one" });
      const b = await w.start({ templateRef: "builtin/one" });
      await w.advance();
      children.land(childGroupIdOf(a.flowRunId, "write", 1), { "a.md": "from a\n" });
      children.land(childGroupIdOf(b.flowRunId, "write", 1), { "b.md": "from b\n" });
      peak.clear();
      await Promise.all([advanceRun(w.deps, a.flowRunId), advanceRun(w.deps, b.flowRunId)]);
      expect([...peak.values()]).toEqual([1]);
      expect(readFileSync(join(w.folder, "a.md"), "utf8")).toBe("from a\n");
      expect(readFileSync(join(w.folder, "b.md"), "utf8")).toBe("from b\n");
    } finally { await w.dispose(); }
  });

  it("the lock orders one folder's work and leaves other folders free", async () => {
    const order: string[] = [];
    const step = (name: string, ms: number) => async () => { order.push(`${name}+`); await new Promise((r) => setTimeout(r, ms)); order.push(`${name}-`); };
    await Promise.all([withDirLock("/x", step("x1", 60)), withDirLock("/x", step("x2", 1)), withDirLock("/y", step("y1", 1))]);
    expect(order.indexOf("x2+")).toBeGreaterThan(order.indexOf("x1-"));
    expect(order.indexOf("y1-")).toBeLessThan(order.indexOf("x1-"));
  });
});
