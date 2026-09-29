#!/usr/bin/env node
// Gate step (human ruling 2026-09-29, session 2f65a729): Orca's current source against the ccloop package installed in
// node_modules, with ORCA_CCLOOP_BIN unset, so a pin too old for what Orca now asks of ccloop turns the gate red rather
// than surfacing the first time someone runs `orca panel` without the override. It catches only what
// tests/control/ccloopDefaultE2E.test.ts exercises (the package's layout, `orca agents init/show`, a panel boot).
//
//   node scripts/verify-ccloop-pin.mjs
//
// Needs web/dist (`npm run build --workspace web`): one criterion boots a real panel.
// Exit 0 only when vitest exits 0 AND reports at least one test, every one of them passed: the E2E skips itself unless
// ORCA_CCLOOP_DEFAULT_E2E=1, and an all-skipped run exits 0 too.
// HOME, the four XDG roots and TMPDIR are relocated into a fresh directory (CLAUDE.md Rule 17), removed afterwards.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_E2E = "tests/control/ccloopDefaultE2E.test.ts";

/** Runs the default-resolution E2E (plus `extraFiles`) in `repo`; `ok` is the gate's verdict. */
export function runDefaultE2E(repo, extraFiles = []) {
  // A short name on purpose: tsx puts its IPC socket under $TMPDIR, and macOS caps a socket path at 104 bytes.
  const scratch = mkdtempSync(join(tmpdir(), "cl-"));
  const report = join(scratch, "vitest.json");
  const env = { ...process.env, ORCA_CCLOOP_DEFAULT_E2E: "1", TMPDIR: join(scratch, "t"), HOME: join(scratch, "h") };
  for (const [name, dir] of [["XDG_CONFIG_HOME", "c"], ["XDG_CACHE_HOME", "k"], ["XDG_DATA_HOME", "d"], ["XDG_STATE_HOME", "s"]]) {
    env[name] = join(scratch, dir);
  }
  for (const dir of [env.TMPDIR, env.HOME, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME]) {
    mkdirSync(dir, { mode: 0o700 });
  }
  // The override would answer every question the E2E asks, and NODE_PATH could resolve a ccloop from elsewhere.
  delete env.ORCA_CCLOOP_BIN;
  delete env.NODE_PATH;
  const run = spawnSync(
    join(repo, "node_modules", ".bin", "vitest"),
    ["run", "--reporter=default", "--reporter=json", `--outputFile.json=${report}`, DEFAULT_E2E, ...extraFiles],
    { cwd: repo, env, stdio: ["ignore", "inherit", "inherit"] },
  );
  let summary = null;
  try {
    const r = JSON.parse(readFileSync(report, "utf8"));
    summary = { total: r.numTotalTests, passed: r.numPassedTests, failed: r.numFailedTests, skipped: r.numPendingTests + r.numTodoTests };
  } catch {}
  rmSync(scratch, { recursive: true, force: true });
  const ok = run.status === 0 && summary !== null && summary.total > 0 && summary.passed === summary.total;
  return { ok, status: run.status, summary };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runDefaultE2E(join(dirname(fileURLToPath(import.meta.url)), ".."));
  console.log(`verify-ccloop-pin: vitest exit ${result.status}, ${JSON.stringify(result.summary)}`);
  process.exit(result.ok ? 0 : 1);
}
