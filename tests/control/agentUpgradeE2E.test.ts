import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ControlRuntime } from "../../src/panel/controlAssembly.js";
import { ccloopWorlds, g, raw, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Ruling review R3 (human ruling 2026-09-27) on the way out that final review I-2 (a) relies on, which spec §13.6 only
 * cited from final review m-2 and never measured: a CLI upgrading itself under a confirmed group makes the dispatch
 * gate refuse new work as `claim-capability-unavailable` (agent-version-drift), a group recovery-retry does not help
 * until the table records the version the CLI now answers, and once it does, the same frozen configHash resolves,
 * the run is accepted and lands. Real ccloop build (ORCA_CCLOOP_BIN), its fake codex behind a wrapper whose
 * `--version` answer the criterion changes; HOME and the XDG roots are relocated.
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
    const recordNewVersion = (): void => {
      codex.version = "1.0.1-after";
      writeFileSync(w.table, JSON.stringify(w.agentsTable), { mode: 0o600 });
    };
    return { w, upgrade, recordNewVersion };
  }

  it("refuses start on the drift, then starts under the frozen hash once the table records the new version", async () => {
    const { w, upgrade, recordNewVersion } = await upgradable([{ taskId: "a", targetPaths: ["a.txt"] }], { a: { files: { "a.txt": "A\n" } } });
    const runtime = await w.boot(); try {
      let frozen = "";
      await startGroup(runtime, w.repoId, 0, async () => {
        frozen = String(workItem(runtime, "a").configHash);
        upgrade(); // the installed CLI upgrades itself between confirmation and start
        const refused = await runtime.service.start(raw(runtime, "start-drifted", "start", {}));
        expect(refused).toMatchObject({ error: { code: "control-capability-unsupported", retryable: false } });
        expect(w.calls()).toEqual([]);
        recordNewVersion();
      });
      expect(frozen).toMatch(/^[0-9a-f]{64}$/);
      runtime.startPump(50);
      await until(() => workItem(runtime, "a").status === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true), 180_000, "the task to land");
      expect(g(w.repo, "show", "refs/heads/orca/g:a.txt")).toBe("A");
      expect(workItem(runtime, "a").configHash).toBe(frozen);
      expect(sealedConfigs(runtime).map((config) => config.installation.version)).toEqual(["1.0.1-after"]);
    } finally { await w.teardown(); }
  });

  it("blocks the next dispatch of a started group on the drift, stays blocked after a retry until the table records the new version, then lands it", async () => {
    // a runs long enough for the CLI to upgrade under it; b waits on a, so its dispatch comes after the upgrade.
    const { w, upgrade, recordNewVersion } = await upgradable(
      [{ taskId: "a", targetPaths: ["a.txt"] }, { taskId: "b", dependsOn: ["a"], targetPaths: ["b.txt"] }],
      { a: { files: { "a.txt": "A\n" }, delayMs: { execute: 3_000 } }, b: { files: { "b.txt": "B\n" } } },
    );
    const runtime = await w.boot(); try {
      await startGroup(runtime, w.repoId);
      const frozen = { a: String(workItem(runtime, "a").configHash), b: String(workItem(runtime, "b").configHash) };
      runtime.startPump(50);
      await until(() => w.calls().includes("plan"), 60_000, "a to be accepted and planning");
      upgrade(); // accepted runs never read the table again; only new work is gated
      await until(() => workItem(runtime, "a").status === "done", 180_000, "a to land despite the upgrade");
      await until(() => blockerCodes(runtime).includes("claim-capability-unavailable"), 60_000, "the drift to block b's dispatch");
      expect(workRuns(runtime).map((run) => run.task)).toEqual(["a"]);

      // A retry before the table knows the new version clears the blocker, and the next delivery puts it back.
      const early = await runtime.service.recoveryRetry(raw(runtime, "retry-early", "recovery-retry", { scope: "group", groupId: "g" }));
      expect(early).toMatchObject({ result: { kind: "recovery-observed", resolved: true, blockerCodes: ["claim-capability-unavailable"] } });
      expect(blockerCodes(runtime)).toEqual([]);
      await until(() => blockerCodes(runtime).includes("claim-capability-unavailable"), 60_000, "the drift to block b again");
      expect(workRuns(runtime).map((run) => run.task)).toEqual(["a"]);

      // The person records the version the CLI answers now; nothing else in the installation changes.
      recordNewVersion();
      const retried = await runtime.service.recoveryRetry(raw(runtime, "retry-after-table", "recovery-retry", { scope: "group", groupId: "g" }));
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      await until(() => workItem(runtime, "b").status === "done" && workRuns(runtime).every((run) => run.body.drive?.cleanedUp === true), 180_000, "b to land");

      expect(workRuns(runtime).map((run) => run.body.state)).toEqual(["settled", "settled"]);
      expect(g(w.repo, "show", "refs/heads/orca/g:b.txt")).toBe("B");
      expect({ a: workItem(runtime, "a").configHash, b: workItem(runtime, "b").configHash }).toEqual(frozen);
      // What ran is on record: a under the old version, b under the new one, both under the hashes frozen before.
      expect(sealedConfigs(runtime).map((config) => config.installation.version).sort()).toEqual(["1.0.0-before", "1.0.1-after"]);
    } finally { await w.teardown(); }
  });
});
