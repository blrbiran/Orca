import { existsSync, lstatSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
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
/**
 * #315: a running panel writes its own runtime files under `~/.orca/panel` (its rotating logs, its pid record and its
 * lock) on every driver round, so a snapshot of the whole tree called a test file red for output an external process
 * wrote. Those paths and the panel's transient per-run accept claim are excluded; durable `control/`, `person/`,
 * `vault/`, the service definitions and the rest of `panel/` stay guarded. Tests that boot the panel still relocate
 * `ORCA_PANEL_DIR`.
 */
const PANEL_RUNTIME_FILES = new Set(["panel.json", "panel.lock"]);
/**
 * #338 (tester): on a 4.6 GB / 410k-file ~/.orca one file-by-file snapshot took ~12 s, run twice per test file, and
 * the 10 s hook default failed every file. Nearly all of those files are run state a running panel keeps writing: each
 * store's `<key>.runs/` and `<key>.workspaces/` (src/control/workspace.ts) and its `artifacts/`, `checkpoints/` and
 * `projections/` (archive.ts, checkpoints.ts, projection.ts). For those directories only the top-level entries are
 * recorded (name, kind, mtime): a test that creates, removes or rewrites a run, workspace, artifact or checkpoint entry
 * still shows; a write deeper inside an existing one does not. Everything else (control.sqlite, control/ records,
 * person/, vault/, the rest of panel/, the service definitions) stays guarded file by file. This also covers #315's
 * accept-claim file: it lives under `control/panel.runs/run-<id>/control/`, below the recorded level.
 */
const RUNTIME_DIR = /^control\/[^/]+\.(runs|workspaces)$|^control\/[^/]+\/(artifacts|checkpoints|projections)$/;
function topLevel(dir: string, rel: string): string[] {
  return readdirSync(dir).map((entry) => {
    try {
      const s = lstatSync(join(dir, entry));
      return `${rel}/${entry}:${s.isDirectory() ? "dir" : s.isSymbolicLink() ? "link" : "file"}:${s.mtimeMs}`;
    } catch { return `${rel}/${entry}:unreadable`; }
  });
}
export function userDataSnapshot(root: string = join(homedir(), ".orca")): string[] {
  if (!existsSync(root)) return [];
  const walk = (dir: string, prefix: string): string[] => readdirSync(dir).flatMap((entry) => {
    if (prefix === "panel/" && (entry === "logs" || PANEL_RUNTIME_FILES.has(entry))) return [];
    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { return [`${prefix}${entry}:unreadable`]; }
    if (!stat.isDirectory()) return [`${prefix}${entry}:${stat.size}`];
    if (RUNTIME_DIR.test(`${prefix}${entry}`)) {
      try { return topLevel(full, `${prefix}${entry}`); } catch { return [`${prefix}${entry}:unreadable`]; }
    }
    return walk(full, `${prefix}${entry}/`);
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
  expect(userDataSnapshot(), "the real ~/.orca changed during this test file (CLAUDE.md Rule 17): a test wrote it, or another process did. panel runtime logs, panel.json and panel.lock are excluded, and run-state directories (<key>.runs, <key>.workspaces, artifacts, checkpoints, projections) are compared by their top-level entries only (#338)").toEqual(userDataBefore);
  expect(realServiceDefinitions(), "this test file touched the real service definition (CLAUDE.md Rule 17)").toEqual(definitionsBefore);
});
