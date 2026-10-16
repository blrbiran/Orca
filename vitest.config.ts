import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Ruling (session 4de777f4, 2026-10-17, human-authorized): every gate since 2026-10-13 lost 8-17 criteria to the
    // 5 s default under machine load, each green 3/3 alone (docs/handoff/known-load-flakes.md), and a new file joined
    // the list most rounds. No criterion uses this default as a speed bound; ones that need a bound set their own.
    testTimeout: 20_000,
    // CLAUDE.md Rule 17, mechanically: no test process may run with ORCA_CONTROL_DIR unset, because
    // the shipped default for it is a real home directory. See the file for what this prevents.
    // relocateCcmem.ts does the same for ccmem's data root (memory tab spec §6.2).
    // relocateCcloopCache.ts does the same for ccloop's agent-catalog cache and CODEX_HOME (spec 2026-10-15 §4.2).
    setupFiles: ["tests/setup/scopeTmpdir.ts", "tests/setup/relocateCcloopCache.ts", "tests/setup/relocateUserData.ts", "tests/setup/relocateCcmem.ts"],
  },
});
