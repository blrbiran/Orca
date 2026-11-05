// passwordStdin.ts (human ruling, session 3cfc2e73; CLI v2 spec §15.3, Correction 2): what counts as "under the real
// ~/.orca", and what one stdin line is. Pure calls on temp dirs; the real ~/.orca is only read (realOrcaDir()).
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { insideDir, passwordFromStdin, realOrcaDir, realPanelPath } from "../../src/commands/passwordStdin.js";

let base = "";
afterEach(() => { if (base) rmSync(base, { recursive: true, force: true }); });

describe("realOrcaDir", () => {
  it("is the password database's home, not $HOME", () => {
    const saved = process.env.HOME;
    process.env.HOME = "/tmp/relocated-home";
    try { expect(realOrcaDir()).toBe(join(userInfo().homedir, ".orca")); } finally { process.env.HOME = saved; }
  });
});

describe("insideDir / realPanelPath", () => {
  it("sees through symlinks and paths that do not exist yet; a sibling with a common prefix is outside", () => {
    base = mkdtempSync(join(tmpdir(), "pwstdin-"));
    const real = join(base, "real", ".orca");
    mkdirSync(join(real, "control"), { recursive: true });
    symlinkSync(join(real, "control"), join(base, "link"));
    expect(insideDir(join(real, "control", "panel", "control.sock"), real)).toBe(true);
    // Mutation "compare resolve() only" -> the link is outside -> red.
    expect(insideDir(join(base, "link", "panel", "control.sock"), real)).toBe(true);
    expect(insideDir(join(base, "real", ".orca-other", "x"), real)).toBe(false);
    expect(insideDir(join(base, "elsewhere", "state", "control.sock"), real)).toBe(false);
    expect(realPanelPath({ a: join(base, "x"), b: join(real, "person") }, real)).toEqual({ label: "b", path: join(real, "person") });
    expect(realPanelPath({ a: join(base, "x") }, real)).toBe(null);
  });
});

describe("passwordFromStdin", () => {
  it("drops one trailing newline and refuses empty, multi-line or NUL", () => {
    expect(passwordFromStdin("a long password\n")).toBe("a long password");
    expect(passwordFromStdin("a long password\r\n")).toBe("a long password");
    expect(passwordFromStdin("no newline")).toBe("no newline");
    for (const bad of ["", "\n", "a\nb", "a\n\n", "a\0b"]) expect(passwordFromStdin(bad)).toBe(null);
  });
});
