import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateAgentTimeouts, timeoutMigrationMarkerOf } from "../../src/agents/timeoutMigration.js";

// Tester #116 (human ruling, session 4ed8eb65, Q2): a 30-minute wall clock was killing long execute phases, so installations
// still on that old default move to 2 hours. The table is the person's data (Rule 17): a limit they chose stays, and once the
// move has happened it never happens again, or setting 30 minutes back by hand would be undone at every restart.

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

const TABLE = {
  schema: "ccloop-agents-table-v1",
  installations: {
    omp: { kind: "omp", command: ["/opt/omp"], version: "1.0.0", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000 },
    codex: { kind: "codex", command: ["/opt/codex"], version: "1.0.0", configDir: null, timeoutMs: 900_000, killGraceMs: 5_000 },
  },
};

async function world(bytes: string | null, mode = 0o640) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-timeout-migration-")));
  roots.push(root);
  const table = join(root, "agents.json");
  if (bytes !== null) await writeFile(table, bytes, { mode });
  return { table, env: { ORCA_AGENTS_TABLE: table } };
}
const timeouts = async (table: string) => Object.fromEntries(Object.entries((JSON.parse(await readFile(table, "utf8")) as typeof TABLE).installations).map(([id, row]) => [id, row.timeoutMs]));

describe("the one move from the old 30-minute default to 2 hours", () => {
  it("moves the old default only, keeps the file's layout and mode, and keeps the previous bytes in a private copy", async () => {
    const original = `${JSON.stringify(TABLE, null, 4)}\n`;
    const w = await world(original);
    expect(await migrateAgentTimeouts(w.env)).toEqual(["omp"]);
    expect(await timeouts(w.table)).toEqual({ omp: 7_200_000, codex: 900_000 });
    expect(await readFile(w.table, "utf8")).toBe(original.replace("1800000", "7200000"));
    expect((await lstat(w.table)).mode & 0o777).toBe(0o640);
    const marker = timeoutMigrationMarkerOf(w.table);
    expect(await readFile(marker, "utf8")).toBe(original);
    expect((await lstat(marker)).mode & 0o777).toBe(0o600);
  });

  it("does not undo a person who sets 30 minutes back afterwards", async () => {
    const w = await world(JSON.stringify(TABLE));
    await migrateAgentTimeouts(w.env);
    await writeFile(w.table, JSON.stringify(TABLE));
    expect(await migrateAgentTimeouts(w.env)).toEqual([]);
    expect((await timeouts(w.table)).omp).toBe(1_800_000);
  });

  it("marks a table with nothing to move as done, so a later hand-set 30 minutes stays", async () => {
    const w = await world(JSON.stringify({ ...TABLE, installations: { codex: TABLE.installations.codex } }));
    expect(await migrateAgentTimeouts(w.env)).toEqual([]);
    await writeFile(w.table, JSON.stringify(TABLE));
    expect(await migrateAgentTimeouts(w.env)).toEqual([]);
    expect((await timeouts(w.table)).omp).toBe(1_800_000);
  });

  it("creates nothing when there is no table yet, so a table made later is still moved", async () => {
    const w = await world(null);
    expect(await migrateAgentTimeouts(w.env)).toEqual([]);
    await expect(lstat(timeoutMigrationMarkerOf(w.table))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a table it cannot parse and leaves it and the marker alone", async () => {
    const w = await world("{ not json");
    await expect(migrateAgentTimeouts(w.env)).rejects.toThrow();
    expect(await readFile(w.table, "utf8")).toBe("{ not json");
    await expect(lstat(timeoutMigrationMarkerOf(w.table))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
