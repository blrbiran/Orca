import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Ruling (session 4de777f4, 2026-10-17, human-authorized): every gate since 2026-10-13 lost 8-17 criteria to the
    // 5 s default under machine load, each green 3/3 alone (docs/handoff/known-load-flakes.md), and a new file joined
    // the list most rounds. No criterion uses this default as a speed bound; ones that need a bound set their own.
    testTimeout: 20_000,
    // #338 (tester), same reasoning as testTimeout: the setup and afterAll hooks of tests/setup/relocateUserData.ts snapshot
    // the real ~/.orca (Rule 17); on a 4.6 GB / 410k-file ~/.orca one snapshot took ~12 s and the 10 s hook default failed
    // every file. The snapshot is now bounded (run state by top-level entry), and no criterion uses this default as a
    // speed bound; hooks that need a bound set their own.
    hookTimeout: 60_000,
    // Human ruling 2026-11-24 (test time): vitest re-transformed every module on every run -- 65-71% of a small file's
    // run at load ~85 (tests/metrics/cli.test.ts: 15.5 s cold, 4.3-6.3 s with this cache warm). The cache lives under
    // node_modules/.vitest-cache, keyed by file content and config, and goes away with a reinstall.
    fsModuleCache: true,
    // CLAUDE.md Rule 17, mechanically: no test process may run with ORCA_CONTROL_DIR unset, because
    // the shipped default for it is a real home directory. See the file for what this prevents.
    // relocateCcmem.ts does the same for ccmem's data root (memory tab spec §6.2).
    // relocateCcloopCache.ts does the same for ccloop's agent-catalog cache and CODEX_HOME (spec 2026-10-15 §4.2).
    setupFiles: ["tests/setup/scopeTmpdir.ts", "tests/setup/relocateCcloopCache.ts", "tests/setup/relocateUserData.ts", "tests/setup/relocateCcmem.ts"],
  },
});
