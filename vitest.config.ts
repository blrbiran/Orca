import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // CLAUDE.md Rule 17, mechanically: no test process may run with ORCA_CONTROL_DIR unset, because
    // the shipped default for it is a real home directory. See the file for what this prevents.
    // relocateCcmem.ts does the same for ccmem's data root (memory tab spec §6.2).
    setupFiles: ["tests/setup/scopeTmpdir.ts", "tests/setup/relocateUserData.ts", "tests/setup/relocateCcmem.ts"],
  },
});
