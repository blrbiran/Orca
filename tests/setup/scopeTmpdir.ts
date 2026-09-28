import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

/**
 * Every test file gets a temp root of its own, and the root is removed when the file is done.
 *
 * Measured before this existed (2026-09-28, TMPDIR relocated to an empty directory): one full run
 * left 364 entries behind in $TMPDIR, and the real $TMPDIR held tens of thousands of `orca-*`
 * directories from earlier runs. Pointing TMPDIR at a scoped root covers every `mkdtemp` in the
 * suite, and every child process the file spawns, because `os.tmpdir()` reads TMPDIR on each call
 * and children inherit the environment.
 *
 * Listed before `relocateUserData.ts` so that its relocated control directory lands in here too.
 * ⚠️ A child spawned with an env object that does not carry TMPDIR still writes to the outer temp
 * directory. `scripts/check-tmp-leak.mjs` is the guard that would show it.
 * ⚠️ Keep the prefix short: tsx puts its IPC socket at `$TMPDIR/tsx-<uid>/<pid>.pipe`, and macOS
 * caps a socket path at 104 bytes.
 */
const outer = process.env.TMPDIR;
const scoped = mkdtempSync(join(tmpdir(), "orca-tmp-"));
process.env.TMPDIR = scoped;

afterAll(() => {
  if (outer === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = outer;
  // Retries cover a child that is still writing while the file's own teardown has already returned.
  rmSync(scoped, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
