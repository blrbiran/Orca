import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverSocketPath } from "../../src/entry/discovery.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });
async function root() { const r = await mkdtemp(join(tmpdir(), "od-")); roots.push(r); return r; }

describe("socket discovery (spec §4.3)", () => {
  it("prefers the flag, then the projects file's controlStateDir, then ORCA_CONTROL_DIR, then ~/.orca", async () => {
    const r = await root();
    const projects = join(r, "projects.json");
    await writeFile(projects, JSON.stringify({ version: 1, controlStateDir: join(r, "fromfile"), projects: [] }), { mode: 0o600 });
    const env = { ORCA_PROJECTS_FILE: projects, ORCA_CONTROL_DIR: join(r, "ctl") };
    expect(discoverSocketPath({ stateDirFlag: join(r, "flag"), env })).toBe(join(r, "flag", "control.sock"));
    expect(discoverSocketPath({ env })).toBe(join(r, "fromfile", "control.sock"));
    expect(discoverSocketPath({ env: { ORCA_PROJECTS_FILE: join(r, "missing.json"), ORCA_CONTROL_DIR: join(r, "ctl") } })).toBe(join(r, "ctl", "panel", "control.sock"));
    expect(discoverSocketPath({ env: { ORCA_PROJECTS_FILE: join(r, "missing.json") } })).toBe(join(homedir(), ".orca", "control", "panel", "control.sock"));
  });

  it("C20: a projects file that exists but does not parse is refused by name, not guessed past", async () => {
    const r = await root();
    const projects = join(r, "projects.json");
    await writeFile(projects, "{ not json", { mode: 0o600 });
    expect(() => discoverSocketPath({ env: { ORCA_PROJECTS_FILE: projects, ORCA_CONTROL_DIR: join(r, "ctl") } })).toThrow(expect.objectContaining({ code: "control-projects-file-invalid" }));
  });

  it("a projects file path that cannot be stat'ed (its parent is a regular file: ENOTDIR) is refused by name, not thrown raw", async () => {
    const r = await root();
    const parent = join(r, "plain");
    await writeFile(parent, "", { mode: 0o600 });
    expect(() => discoverSocketPath({ env: { ORCA_PROJECTS_FILE: join(parent, "projects.json"), ORCA_CONTROL_DIR: join(r, "ctl") } }))
      .toThrow(expect.objectContaining({ code: "control-projects-file-invalid", message: expect.stringContaining("ENOTDIR") }));
  });

  it("an empty --control-state-dir is an argument error, not a fall-through to the default", async () => {
    const r = await root();
    expect(() => discoverSocketPath({ stateDirFlag: "", env: { ORCA_PROJECTS_FILE: join(r, "missing.json"), ORCA_CONTROL_DIR: join(r, "ctl") } }))
      .toThrow(expect.objectContaining({ code: "control-cli-argument-invalid" }));
  });
});
