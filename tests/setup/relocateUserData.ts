import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect } from "vitest";

/**
 * 🔴 CLAUDE.md Rule 17, enforced mechanically rather than remembered.
 *
 * `orca panel` mounts the control plane by default (ruling R1) and its state lives under
 * `~/.orca/control/<repoKey>` unless `ORCA_CONTROL_DIR` says otherwise (ruling R2). Both are right
 * for a shipped binary and both are unacceptable in a criterion, and relying on every criterion to
 * remember the variable is not a guard: it was measured failing. Booting the panel from the
 * existing `tests/panel` criteria created `~/.orca/control/{proj,known,github.com}` in a real home
 * directory, which is exactly the outcome Rule 17 names as unacceptable.
 *
 * So the variable is set here, for every test file, before any of them runs. A criterion that wants
 * a specific directory still sets its own and wins; a criterion that forgets lands in a temp
 * directory instead of someone's home.
 *
 * ⚠️ This does not replace relocating explicitly. A criterion that asserts *where* the store went
 * must still name its own root -- this only guarantees that forgetting is not destructive.
 */
const relocated = mkdtempSync(join(tmpdir(), "orca-test-control-"));
process.env.ORCA_CONTROL_DIR = relocated;
// Project registry spec §12 C1: the real `orca panel` reads ~/.orca/projects.json unless told otherwise. A criterion
// that boots the CLI with no --repo gets a file inside the relocated root instead (which does not exist: no projects).
process.env.ORCA_PROJECTS_FILE = join(relocated, "projects.json");
// Panel service plan Task 2: the service's own paths, for the same reason. A criterion that forgets lands here.
process.env.ORCA_PANEL_DIR = join(relocated, "panel");
process.env.ORCA_LAUNCH_AGENTS_DIR = join(relocated, "LaunchAgents");
process.env.ORCA_SYSTEMD_USER_DIR = join(relocated, "systemd-user");
process.env.ORCA_SERVICE_LABEL = "dev.orca.panel.test";
process.env.ORCA_SERVICE_UNIT = "orca-panel-test";

/**
 * ⚠️ The relocation above is NOT a guard on its own, and saying it was is how this got missed once.
 * It only moves `process.env`, and a criterion that hands `parsePanelArgs` an env object of its own
 * never reads `process.env` at all -- which is exactly what the panel criteria do. This is the guard:
 * a snapshot of the real ~/.orca, compared after every test file. If anything in this suite reaches
 * a person's user data, the file that did it goes red, by name, with the difference printed.
 */
function userDataSnapshot(): string[] {
  const root = join(homedir(), ".orca");
  if (!existsSync(root)) return [];
  const walk = (dir: string, prefix: string): string[] => readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { return [`${prefix}${entry}:unreadable`]; }
    return stat.isDirectory() ? walk(full, `${prefix}${entry}/`) : [`${prefix}${entry}:${stat.size}`];
  });
  try { return walk(root, "").sort(); } catch { return ["<unreadable>"]; }
}

const userDataBefore = userDataSnapshot();

/** The real plist and unit, by stat: their absence or bytes must not change during a test file. */
function realServiceDefinitions(): string[] {
  return [join(homedir(), "Library", "LaunchAgents", "dev.orca.panel.plist"), join(homedir(), ".config", "systemd", "user", "orca-panel.service")]
    .map((path) => { try { const s = statSync(path); return `${path}:${s.size}:${s.mtimeMs}`; } catch { return `${path}:absent`; } });
}
const definitionsBefore = realServiceDefinitions();

afterAll(() => {
  rmSync(relocated, { recursive: true, force: true });
  expect(userDataSnapshot(), "this test file wrote into the real ~/.orca (CLAUDE.md Rule 17)").toEqual(userDataBefore);
  expect(realServiceDefinitions(), "this test file touched the real service definition (CLAUDE.md Rule 17)").toEqual(definitionsBefore);
});
