import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { ccloopWorlds, g, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Ruling review R3 (human ruling 2026-09-27) on the way out that final review I-2 (a) relies on, which spec §13.6 only
 * cited from final review m-2 and never measured: a CLI upgrading itself under a confirmed group makes the dispatch
 * gate refuse new work as `claim-capability-unavailable` (agent-version-drift), a group recovery-retry does not help
 * until the table records the version the CLI now answers, and once it does, the same frozen configHash resolves,
 * the run is accepted and lands. Real ccloop build (ORCA_CCLOOP_BIN), its fake codex behind a wrapper whose
 * `--version` answer the criterion changes; HOME and the XDG roots are relocated.
 *
 * *** REWRITTEN 2026-10-20 (agent version auto-refresh spec 2026-10-20; human ruling, session 308b874c: 「组跑到一半遇到
 * agent 升级 => 直接用新版本继续」, 「静默更新就行」; changing the necessary tests authorized that session): the refusal
 * and the "recovery-retry does not help" above are no longer the behaviour. Orca's ccloop port now answers the drift
 * itself -- ccloop re-probes the installation, Orca records the version in the table (only that field) and asks
 * once more -- so the start and the next dispatch go on under the new version with no person editing the table.
 * What R3 measured still holds and is still asserted: the frozen configHash resolves after the version changes, and
 * the sealed config records which version each run ran under. ***
 */
const VERSION_WRAPPER = resolve("tests/control/fixtures/version-wrapper.mjs");
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-upgrade-e2e-", epochPrefix: "epoch-upgrade-" });
afterAll(removeRoots);

const blockerCodes = (runtime: ControlRuntime): string[] =>
  runtime.store.db.prepare("SELECT code FROM recovery_blockers WHERE group_id='g' AND scope='group' ORDER BY id").all().map((row) => String(row.code));
const workItem = (runtime: ControlRuntime, taskId: string): Record<string, any> =>
  JSON.parse(String(runtime.store.db.prepare("SELECT body FROM work_items WHERE group_id='g' AND id=?").get(taskId)!.body));
/** Every `config.json` ccloop sealed at accept under this runtime's runs directory. */
const sealedConfigs = (runtime: ControlRuntime): Array<Record<string, any>> => {
  const root = `${runtime.store.stateDir}.runs`;
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((rel) => rel.endsWith(join("control", "config.json")))
    .map((rel) => JSON.parse(readFileSync(join(root, rel), "utf8")));
};

describe.skipIf(!realBinary)("an agent CLI upgraded in place under a confirmed group (ruling review R3)", { timeout: 300_000 }, () => {
  relocateHome("orca-upgrade-e2e-home-");

  /** A world whose codex answers `--version` from a file the criterion rewrites; the table says `1.0.0-before`. */
  async function upgradable(tasks: Parameters<typeof world>[0], script: Parameters<typeof world>[1]) {
    const w = await world(tasks, script);
    const versionFile = join(w.root, "codex-version.txt");
    writeFileSync(versionFile, "1.0.0-before\n");
    const codex = w.agentsTable.installations.codex!;
    codex.command = [process.execPath, VERSION_WRAPPER, versionFile, ...(codex.command as string[]).slice(1)];
    codex.version = "1.0.0-before";
    writeFileSync(w.table, JSON.stringify(w.agentsTable), { mode: 0o600 });
    const upgrade = (): void => writeFileSync(versionFile, "1.0.1-after\n");
    return { w, upgrade };
  }

  it("starts on the upgraded CLI under the frozen hash, the table recording the new version by itself", async () => {
    const { w, upgrade } = await upgradable([{ taskId: "a", targetPaths: ["a.txt"] }], { a: { files: { "a.txt": "A\n" } } });
    const runtime = await w.boot(); try {
      let frozen = "";
      await startGroup(runtime, w.repoId, 0, async () => {
        frozen = String(workItem(runtime, "a").configHash);
        upgrade(); // the installed CLI upgrades itself between confirmation and start
      }); // startGroup's own start must answer "started" (fixtures/ccloopWorld.ts), not the drift refusal
      expect(frozen).toMatch(/^[0-9a-f]{64}$/);
      // Only the version changed in the table; the command (the wrapper) is the one the criterion wrote.
      const table = JSON.parse(readFileSync(w.table, "utf8")) as { installations: { codex: { version: string; command: string[] } } };
      expect(table.installations.codex.version).toBe("1.0.1-after");
      expect(table.installations.codex.command).toEqual(w.agentsTable.installations.codex!.command);
      runtime.startPump(50);
      await until(() => workItem(runtime, "a").status === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true), 180_000, "the task to land");
      expect(g(w.repo, "show", "refs/heads/orca/g:a.txt")).toBe("A");
      expect(workItem(runtime, "a").configHash).toBe(frozen);
      expect(sealedConfigs(runtime).map((config) => config.installation.version)).toEqual(["1.0.1-after"]);
    } finally { await w.teardown(); }
  });

  it("dispatches the next task of a started group on the CLI that upgraded under it, with no blocker and the frozen hashes", async () => {
    // a runs long enough for the CLI to upgrade under it; b waits on a, so its dispatch comes after the upgrade.
    const { w, upgrade } = await upgradable(
      [{ taskId: "a", targetPaths: ["a.txt"] }, { taskId: "b", dependsOn: ["a"], targetPaths: ["b.txt"] }],
      { a: { files: { "a.txt": "A\n" }, delayMs: { execute: 3_000 } }, b: { files: { "b.txt": "B\n" } } },
    );
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      const frozen = { a: String(workItem(runtime, "a").configHash), b: String(workItem(runtime, "b").configHash) };
      runtime.startPump(50);
      await until(() => w.calls().includes("plan"), 60_000, "a to be accepted and planning");
      upgrade(); // accepted runs never read the table again; only new work meets the new version
      await until(() => workItem(runtime, "b").status === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true), 180_000, "b to land");
      expect(blockerCodes(runtime)).toEqual([]);
      expect(workRuns(runtime).map((run) => run.body.state)).toEqual(["settled", "settled"]);
      expect(g(w.repo, "show", "refs/heads/orca/g:b.txt")).toBe("B");
      expect({ a: workItem(runtime, "a").configHash, b: workItem(runtime, "b").configHash }).toEqual(frozen);
      // What ran is on record: a under the old version, b under the new one, both under the hashes frozen before.
      expect(sealedConfigs(runtime).map((config) => config.installation.version).sort()).toEqual(["1.0.0-before", "1.0.1-after"]);
    } finally { await w.teardown(); }
  });
});
