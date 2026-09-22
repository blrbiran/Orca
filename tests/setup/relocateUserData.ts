import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

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

afterAll(() => {
  rmSync(relocated, { recursive: true, force: true });
});
