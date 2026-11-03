import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Session 43913afc (human ruling 「按你的建议走」 on the migration incident): the marker means "done", so it may exist only
// once the table holds the new limit. Written first, a failed table write left the marker behind and the table stayed at
// 30 minutes for good. The previous bytes must still survive: they are the person's only copy of the table as it was.

const failing = vi.hoisted(() => ({ target: null as string | null }));
vi.mock("../../src/agents/versionRefresh.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/agents/versionRefresh.js")>();
  return {
    ...original,
    replace: async (target: string, bytes: string, mode: number) => {
      if (target === failing.target) throw Object.assign(new Error("injected write failure"), { code: "EIO" });
      return original.replace(target, bytes, mode);
    },
  };
});
const { migrateAgentTimeouts, timeoutMigrationMarkerOf, timeoutMigrationPendingOf } = await import("../../src/agents/timeoutMigration.js");

const roots: string[] = [];
afterEach(async () => { failing.target = null; while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

const TABLE = { schema: "ccloop-agents-table-v1", installations: { omp: { kind: "omp", command: ["/opt/omp"], version: "1.0.0", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000 } } };
const original = `${JSON.stringify(TABLE, null, 2)}\n`;

async function world() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-timeout-retry-")));
  roots.push(root);
  const table = join(root, "agents.json");
  await writeFile(table, original, { mode: 0o600 });
  return { table, marker: timeoutMigrationMarkerOf(join(root, "agents.json")), env: { ORCA_AGENTS_TABLE: table } };
}
const ompTimeout = async (table: string) => (JSON.parse(await readFile(table, "utf8")) as typeof TABLE).installations.omp.timeoutMs;

describe("the timeout migration's marker follows the table write", () => {
  it("a table write that fails leaves no marker, so the next start moves the table and keeps the bytes from before", async () => {
    const w = await world();
    failing.target = w.table;
    await expect(migrateAgentTimeouts(w.env)).rejects.toThrow("injected write failure");
    expect(await ompTimeout(w.table)).toBe(1_800_000);
    await expect(lstat(w.marker)).rejects.toMatchObject({ code: "ENOENT" });

    failing.target = null;
    expect(await migrateAgentTimeouts(w.env)).toEqual(["omp"]);
    expect(await ompTimeout(w.table)).toBe(7_200_000);
    expect(await readFile(w.marker, "utf8")).toBe(original);
    expect((await lstat(w.marker)).mode & 0o777).toBe(0o600);
  });

  it("a start that stopped after the table write but before the marker keeps the bytes from before the move", async () => {
    const w = await world();
    // The state such a start leaves: the table moved, the previous bytes in the pending copy, no marker yet.
    await writeFile(w.table, original.replace("1800000", "7200000"));
    await writeFile(timeoutMigrationPendingOf(w.table), original, { mode: 0o600 });
    expect(await migrateAgentTimeouts(w.env)).toEqual([]);
    expect(await readFile(w.marker, "utf8")).toBe(original);
    await expect(lstat(timeoutMigrationPendingOf(w.table))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
