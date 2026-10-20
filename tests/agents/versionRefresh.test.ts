import { chmod, lstat, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordObservedVersions } from "../../src/agents/versionRefresh.js";
import type { AgentObservation } from "../../src/control/agentInstallationProtocol.js";

// Agent version auto-refresh spec 2026-10-20 §3.1, §4 (human ruling, session 308b874c: 「组跑到一半遇到 agent 升级 =>
// 直接用新版本继续」, 「静默更新就行」). The core records what ccloop's own probe observed into the user's agents table,
// which is user data outside any repository (Rule 17): every criterion writes a table in a temporary directory.
// What matters to the user: only the upgraded installation's `version` changes (the hash-covered fields and the
// command stay as they were, so a frozen group resolves to the same configHash), the file keeps the mode and the
// layout its owner gave it, a failed probe changes nothing, and the previous bytes stay recoverable in one backup.

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

const TABLE = {
  schema: "ccloop-agents-table-v1",
  installations: {
    claude: { kind: "claude", command: ["/opt/claude"], version: "2.1.282", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000 },
    codex: { kind: "codex", command: ["/opt/codex", "--x"], version: "0.40.0", configDir: "/cfg/codex", timeoutMs: 1_800_000, killGraceMs: 5_000 },
  },
};

async function world(bytes: string, mode = 0o640) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-version-refresh-")));
  roots.push(root);
  const table = join(root, "agents.json");
  await writeFile(table, bytes);
  await chmod(table, mode);
  return { root, table };
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
function observation(bytes: string, observed: Record<string, string | null>): AgentObservation {
  const parsed = JSON.parse(bytes) as typeof TABLE;
  return {
    schema: "orca-agent-detection-observation-v1", baseTableHash: sha(bytes), observedAt: "2026-10-20T00:00:00.000Z",
    installed: Object.entries(parsed.installations).map(([id, row]) => {
      const seen = Object.hasOwn(observed, id) ? observed[id]! : row.version;
      return { id, kind: row.kind, command: row.command, recordedVersion: row.version, observedVersion: seen, realpath: seen === null ? null : row.command[0]!, status: seen === null ? "unavailable" as const : seen === row.version ? "current" as const : "changed" as const };
    }),
  };
}
const modeOf = async (path: string): Promise<number> => (await lstat(path)).mode & 0o777;

describe("recordObservedVersions (agent version auto-refresh spec §3.1)", () => {
  it("rewrites only the upgraded installation's version, keeps the one-line layout, the mode, and backs up the old bytes 0600", async () => {
    const before = `${JSON.stringify(TABLE)}\n`;
    const w = await world(before);
    const result = await recordObservedVersions(w.table, observation(before, { codex: "0.41.0" }));
    const after = await readFile(w.table, "utf8");
    const expected = structuredClone(TABLE);
    expected.installations.codex.version = "0.41.0";
    // Byte-for-byte: still one line with its trailing newline, same key order, nothing else touched.
    expect(after).toBe(`${JSON.stringify(expected)}\n`);
    expect(await modeOf(w.table)).toBe(0o640);
    expect(await readFile(`${w.table}.bak-auto`, "utf8")).toBe(before);
    expect(await modeOf(`${w.table}.bak-auto`)).toBe(0o600);
    expect(result.rows).toEqual([
      { id: "claude", recorded: "2.1.282", observed: "2.1.282", outcome: "unchanged" },
      { id: "codex", recorded: "0.40.0", observed: "0.41.0", outcome: "updated" },
    ]);
    // The observation the caller keeps describes the table as it is now, not the one it replaced.
    expect(result.observation.baseTableHash).toBe(sha(after));
    expect(result.observation.installed.find((row) => row.id === "codex")).toMatchObject({ recordedVersion: "0.41.0", observedVersion: "0.41.0", status: "current" });
    expect((await readdir(w.root)).sort()).toEqual(["agents.json", "agents.json.bak-auto"]);
  });

  it("keeps a pretty-printed table pretty-printed with its own indent", async () => {
    const before = `${JSON.stringify(TABLE, null, 4)}\n`;
    const w = await world(before);
    await recordObservedVersions(w.table, observation(before, { claude: "2.1.300" }));
    const expected = structuredClone(TABLE);
    expected.installations.claude.version = "2.1.300";
    expect(await readFile(w.table, "utf8")).toBe(`${JSON.stringify(expected, null, 4)}\n`);
  });

  it("leaves the table untouched and writes no backup when the probe observed no version, or no x.y.z", async () => {
    const before = JSON.stringify(TABLE);
    const w = await world(before);
    const result = await recordObservedVersions(w.table, observation(before, { claude: null, codex: "1.2" }));
    expect(await readFile(w.table, "utf8")).toBe(before);
    expect(await readdir(w.root)).toEqual(["agents.json"]);
    expect(result.rows).toEqual([
      { id: "claude", recorded: "2.1.282", observed: null, outcome: "unavailable" },
      { id: "codex", recorded: "0.40.0", observed: null, outcome: "unavailable" },
    ]);
  });

  it("with an installation named, changes that one only even when another one also drifted", async () => {
    const before = JSON.stringify(TABLE);
    const w = await world(before);
    const result = await recordObservedVersions(w.table, observation(before, { claude: "2.1.300", codex: "0.41.0" }), "codex");
    const parsed = JSON.parse(await readFile(w.table, "utf8")) as typeof TABLE;
    expect([parsed.installations.claude.version, parsed.installations.codex.version]).toEqual(["2.1.282", "0.41.0"]);
    expect(result.rows).toEqual([{ id: "codex", recorded: "0.40.0", observed: "0.41.0", outcome: "updated" }]);
  });

  it("keeps one rolling backup: a second change replaces it and leaves no temporary files", async () => {
    const first = JSON.stringify(TABLE);
    const w = await world(first);
    await recordObservedVersions(w.table, observation(first, { codex: "0.41.0" }));
    const second = await readFile(w.table, "utf8");
    await recordObservedVersions(w.table, observation(second, { codex: "0.42.0" }));
    expect(await readFile(`${w.table}.bak-auto`, "utf8")).toBe(second);
    expect((await readdir(w.root)).sort()).toEqual(["agents.json", "agents.json.bak-auto"]);
  });

  it("starts over on the bytes another writer left, keeping that writer's change", async () => {
    const before = JSON.stringify(TABLE);
    const w = await world(before);
    let raced = false;
    const result = await recordObservedVersions(w.table, observation(before, { codex: "0.41.0" }), undefined, {
      beforeRename: async () => {
        if (raced) return;
        raced = true;
        const other = structuredClone(TABLE);
        other.installations.claude.timeoutMs = 60_000;
        await writeFile(w.table, JSON.stringify(other));
      },
    });
    const parsed = JSON.parse(await readFile(w.table, "utf8")) as typeof TABLE;
    expect([parsed.installations.claude.timeoutMs, parsed.installations.codex.version]).toEqual([60_000, "0.41.0"]);
    expect(result.rows.find((row) => row.id === "codex")?.outcome).toBe("updated");
  });

  it("reports unchanged, and writes nothing, when another writer already recorded the observed version", async () => {
    const before = JSON.stringify(TABLE);
    const w = await world(before);
    const done = structuredClone(TABLE);
    done.installations.codex.version = "0.41.0";
    const recorded = JSON.stringify(done);
    const result = await recordObservedVersions(w.table, observation(before, { codex: "0.41.0" }), "codex", {
      beforeRename: async () => { await writeFile(w.table, recorded); },
    });
    expect(await readFile(w.table, "utf8")).toBe(recorded);
    expect(await readdir(w.root)).toEqual(["agents.json"]);
    expect(result.rows).toEqual([{ id: "codex", recorded: "0.41.0", observed: "0.41.0", outcome: "unchanged" }]);
  });

  it("serializes refreshes of one table in this process, so two installations refreshed at once both keep their version", async () => {
    // The panel resolves several selections at once; two drift refusals arriving together must not lose one update.
    const before = JSON.stringify(TABLE);
    const w = await world(before);
    const seen = observation(before, { claude: "2.1.300", codex: "0.41.0" });
    await Promise.all([recordObservedVersions(w.table, seen, "claude"), recordObservedVersions(w.table, seen, "codex")]);
    const parsed = JSON.parse(await readFile(w.table, "utf8")) as typeof TABLE;
    expect([parsed.installations.claude.version, parsed.installations.codex.version]).toEqual(["2.1.300", "0.41.0"]);
  });
});
