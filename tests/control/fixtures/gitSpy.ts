import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Change-sized runs P2 review: every git child this test process starts, recorded. A `git` placed first on PATH appends
 * its working directory and argv as one record (one write, so concurrent children do not interleave) and then runs the
 * real git. Needed where a criterion must see WHICH git call ran, not only its effect: `git fetch <path> <oid>:<ref>`
 * never connects to `<path>` when `<oid>` is already in the repository and connected (fetch's quickfetch: every refspec
 * source is an exact object id, so no ref listing; `rev-list --objects --not --all` finds nothing missing), so a fetch
 * from a result copy that does not exist succeeds exactly like the `update-ref` that replaced it. Lives in the test's own
 * temporary directory (Rule 17); `restore()` puts PATH back.
 */
export function spyOnGit(): { calls(): Array<{ cwd: string; args: string[] }>; restore(): void } {
  const real = execFileSync("/bin/sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const dir = mkdtempSync(join(tmpdir(), "orca-git-spy-"));
  const log = join(dir, "calls.log");
  writeFileSync(join(dir, "git"), [
    "#!/bin/sh",
    "us=$(printf '\\037')",
    "line=\"$PWD\"",
    "for a in \"$@\"; do line=\"$line$us$a\"; done",
    `printf '%s\\036' "$line" >> '${log}'`,
    `exec '${real}' "$@"`,
    "",
  ].join("\n"));
  chmodSync(join(dir, "git"), 0o700);
  const outer = process.env.PATH;
  process.env.PATH = `${dir}:${outer ?? ""}`;
  return {
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").split("\x1e").filter(Boolean) : []).map((record) => {
      const [cwd, ...args] = record.split("\x1f");
      return { cwd: cwd!, args };
    }),
    restore: () => { if (outer === undefined) delete process.env.PATH; else process.env.PATH = outer; },
  };
}
