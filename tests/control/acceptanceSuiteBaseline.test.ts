import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { openControlStore } from "../../src/control/store.js";

const key = {
  repoId: "repo",
  base: "base-sha",
  command: "npm test",
  setupDigest: "setup-sha",
  reporter: "node-test-tap-v1" as const,
};

async function withStore(run: (store: Awaited<ReturnType<typeof openControlStore>>) => void | Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "orca-suite-baseline-"));
  const store = await openControlStore({ stateDir: root });
  try { await run(store); } finally { store.close(); await rm(root, { recursive: true, force: true }); }
}

function insertLegacyIdentity(store: Awaited<ReturnType<typeof openControlStore>>, identity: string, tests: number | null, exit: string | null, at: number): void {
  store.db.prepare(`INSERT INTO acceptance_failure_baselines
    (repo_id,base,command,setup_digest,reporter,identity,file,test_path_json,diagnostic_hash,source,group_id,run_id,first_seen_at,last_seen_at,tests,exit)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      key.repoId, key.base, key.command, key.setupDigest, key.reporter, identity, "test.js", "[]", "hash", "group-acceptance", "g", "r", at, at, tests, exit,
    );
}

describe("acceptance suite-count baseline", () => {
  it("stores and reads a count only for the exact repository, base, command, setup, and reporter", async () => {
    const baselineUrl = new URL("../../src/control/acceptanceSuiteBaseline.js", import.meta.url).href;
    const baselineModule = await import(baselineUrl).catch(() => null);
    expect(baselineModule).not.toBeNull();
    if (baselineModule === null) return;
    await withStore((store) => {
      baselineModule.recordSuiteCountBaseline(store, { ...key, state: "counted", tests: 552, exit: "0", source: "base-suite", observedAt: 123 });
      baselineModule.recordSuiteCountBaseline(store, { ...key, state: "counted", tests: 552, exit: "0", source: "base-suite", observedAt: 123 });
      expect(baselineModule.readSuiteCountBaseline(store, key)).toEqual({ state: "counted", tests: 552, exit: "0", source: "base-suite", observedAt: 123 });
      expect(baselineModule.readSuiteCountBaseline(store, { ...key, repoId: "other-repo" })).toBeNull();
      expect(baselineModule.readSuiteCountBaseline(store, { ...key, base: "other-base" })).toBeNull();
      expect(baselineModule.readSuiteCountBaseline(store, { ...key, command: "npm run test:full" })).toBeNull();
      expect(baselineModule.readSuiteCountBaseline(store, { ...key, setupDigest: "other-setup" })).toBeNull();
    });
  });

  it("keeps a completed unavailable observation instead of inventing a test count", async () => {
    const baselineUrl = new URL("../../src/control/acceptanceSuiteBaseline.js", import.meta.url).href;
    const baselineModule = await import(baselineUrl).catch(() => null);
    expect(baselineModule).not.toBeNull();
    if (baselineModule === null) return;
    await withStore((store) => {
      baselineModule.recordSuiteCountBaseline(store, { ...key, state: "unavailable", tests: null, exit: "0", source: "base-suite", observedAt: 124 });
      expect(baselineModule.readSuiteCountBaseline(store, key)).toEqual({ state: "unavailable", tests: null, exit: "0", source: "base-suite", observedAt: 124 });
    });
  });

  it("does not replace a completed observation with a contradictory result", async () => {
    const baselineUrl = new URL("../../src/control/acceptanceSuiteBaseline.js", import.meta.url).href;
    const baselineModule = await import(baselineUrl).catch(() => null);
    expect(baselineModule).not.toBeNull();
    if (baselineModule === null) return;
    await withStore((store) => {
      baselineModule.recordSuiteCountBaseline(store, { ...key, state: "counted", tests: 552, exit: "0", source: "base-suite", observedAt: 123 });
      expect(() => baselineModule.recordSuiteCountBaseline(store, { ...key, state: "counted", tests: 1, exit: "0", source: "base-suite", observedAt: 124 })).toThrow();
      expect(baselineModule.readSuiteCountBaseline(store, key)).toMatchObject({ state: "counted", tests: 552, observedAt: 123 });
    });
  });

  it("reuses legacy identity counts only when every exact-key row agrees", async () => {
    const baselineUrl = new URL("../../src/control/acceptanceSuiteBaseline.js", import.meta.url).href;
    const baselineModule = await import(baselineUrl).catch(() => null);
    expect(baselineModule).not.toBeNull();
    if (baselineModule === null) return;
    await withStore((store) => {
      insertLegacyIdentity(store, "a", 552, "0", 100);
      insertLegacyIdentity(store, "b", 552, "0", 120);
      expect(baselineModule.readSuiteCountBaseline(store, key)).toEqual({ state: "counted", tests: 552, exit: "0", source: "failure-baseline", observedAt: 120 });
    });
  });

  it("does not combine conflicting legacy identity counts into a suite baseline", async () => {
    const baselineUrl = new URL("../../src/control/acceptanceSuiteBaseline.js", import.meta.url).href;
    const baselineModule = await import(baselineUrl).catch(() => null);
    expect(baselineModule).not.toBeNull();
    if (baselineModule === null) return;
    await withStore((store) => {
      insertLegacyIdentity(store, "a", 552, "0", 100);
      insertLegacyIdentity(store, "b", 79, "0", 120);
      expect(baselineModule.readSuiteCountBaseline(store, key)).toBeNull();
    });
  });

  it("coalesces concurrent cache misses into one base-suite load", async () => {
    const baselineUrl = new URL("../../src/control/acceptanceSuiteBaseline.js", import.meta.url).href;
    const baselineModule = await import(baselineUrl).catch(() => null);
    expect(baselineModule).not.toBeNull();
    if (baselineModule === null) return;
    expect(typeof baselineModule.loadSuiteCountBaselineOnce).toBe("function");
    if (typeof baselineModule.loadSuiteCountBaselineOnce !== "function") return;
    await withStore(async (store) => {
      let loads = 0;
      const load = async () => {
        loads += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { state: "counted" as const, tests: 552, exit: "0", source: "base-suite" as const, observedAt: 125 };
      };
      const results = await Promise.all(Array.from({ length: 5 }, () => baselineModule.loadSuiteCountBaselineOnce(store, key, load)));
      expect(loads).toBe(1);
      expect(results.filter((result) => result.loaded)).toHaveLength(1);
      expect(results.map((result) => result.baseline?.tests)).toEqual([552, 552, 552, 552, 552]);
    });
  });

  it("does not cache a base load that failed before a completed observation", async () => {
    const baselineUrl = new URL("../../src/control/acceptanceSuiteBaseline.js", import.meta.url).href;
    const baselineModule = await import(baselineUrl).catch(() => null);
    expect(baselineModule).not.toBeNull();
    if (baselineModule === null) return;
    expect(typeof baselineModule.loadSuiteCountBaselineOnce).toBe("function");
    if (typeof baselineModule.loadSuiteCountBaselineOnce !== "function") return;
    await withStore(async (store) => {
      let loads = 0;
      const failed = await baselineModule.loadSuiteCountBaselineOnce(store, key, async () => { loads += 1; return null; });
      const succeeded = await baselineModule.loadSuiteCountBaselineOnce(store, key, async () => {
        loads += 1;
        return { state: "counted", tests: 552, exit: "0", source: "base-suite", observedAt: 126 };
      });
      expect(failed).toMatchObject({ baseline: null, loaded: true });
      expect(succeeded.baseline).toMatchObject({ state: "counted", tests: 552 });
      expect(loads).toBe(2);
    });
  });
});

