import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ccmemRootDiff, ccmemRootNames } from "../setup/ccmemRoot.js";

/**
 * Spec §6.2 layer 3 as corrected by §10 (D2, D3). The guard sees the changes Orca could cause and a live ccmem
 * would not: a migration backup appearing, the database disappearing, a data root created from nothing. It must stay
 * quiet about what ccmem's own daemon and SQLite do on their own (a wake file, the WAL and SHM files coming and going),
 * or it goes red with no Orca involvement. This criterion never points at the real data root.
 */
let dirs: string[] = [];
afterEach(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); dirs = []; });
const root = (...names: string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), "orca-ccmem-root-"));
  dirs.push(dir);
  for (const name of names) writeFileSync(join(dir, name), "");
  return dir;
};

describe("the ccmem data-root guard (spec §6.2 layer 3, §10 D2/D3)", () => {
  it("lists names sorted, and null for a root that does not exist", () => {
    const dir = root("global.db", "config.json");
    expect(ccmemRootNames(dir)).toEqual(["config.json", "global.db"]);
    expect(ccmemRootNames(join(dir, "absent"))).toBeNull();
  });

  it("flags a new migration backup of the database and of its WAL", () => {
    const before = ["global.db"];
    expect(ccmemRootDiff(before, ["global.db", "global.db.bak.1"])).toEqual(["new migration backup: global.db.bak.1"]);
    expect(ccmemRootDiff(before, ["global.db", "global.db-wal.bak.1"])).toEqual(["new migration backup: global.db-wal.bak.1"]);
  });

  it("flags the database disappearing and a data root created from nothing", () => {
    expect(ccmemRootDiff(["global.db", "metrics.jsonl"], ["metrics.jsonl"])).toEqual(["global.db disappeared"]);
    expect(ccmemRootDiff(null, ["global.db"])).toEqual(["data root created where there was none"]);
  });

  it("ignores what ccmem's own daemon and SQLite add and remove", () => {
    const before = ["daemon.wake", "global.db", "global.db-shm", "global.db-wal", "global.db.bak.1"];
    expect(ccmemRootDiff(before, ["global.db", "global.db.bak.1", "metrics.jsonl"])).toEqual([]);
    expect(ccmemRootDiff(null, null)).toEqual([]);
  });
});
