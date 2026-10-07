import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverSocketPath } from "../../src/entry/discovery.js";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  while (servers.length) await new Promise<void>((done) => servers.pop()!.close(() => done()));
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});
async function listenAt(dir: string) {
  await mkdir(dir, { recursive: true });
  const server = createServer();
  await new Promise<void>((done) => server.listen(join(dir, "control.sock"), done));
  servers.push(server);
}
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
    // Human review 2026-10-07: discovery now lists the control root, so the ~/.orca default is read under a stubbed
    // HOME -- against the real home it would find whatever panel the person has running (Rule 17).
    vi.stubEnv("HOME", r);
    expect(homedir()).toBe(r);
    expect(discoverSocketPath({ env: { ORCA_PROJECTS_FILE: join(r, "missing.json") } })).toBe(join(homedir(), ".orca", "control", "panel", "control.sock"));
    vi.unstubAllEnvs();
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

  // Human review 2026-10-07: a panel started in legacy --repo mode keeps its socket under <control root>/<repo key>,
  // which none of the four steps named, so `orca control` could not find the human's own panel.
  it("with nothing at the default path, finds the one socket under the control root and names every one when there are several", async () => {
    const r = await root();
    const ctl = join(r, "ctl");
    const env = { ORCA_PROJECTS_FILE: join(r, "missing.json"), ORCA_CONTROL_DIR: ctl };
    await mkdir(join(ctl, "no-socket-here"), { recursive: true });
    expect(discoverSocketPath({ env })).toBe(join(ctl, "panel", "control.sock"));
    await listenAt(join(ctl, "orca-aaaa"));
    expect(discoverSocketPath({ env })).toBe(join(ctl, "orca-aaaa", "control.sock"));
    await listenAt(join(ctl, "orca-bbbb"));
    expect(() => discoverSocketPath({ env })).toThrow(expect.objectContaining({
      code: "control-socket-ambiguous",
      message: expect.stringMatching(/orca-aaaa[\s\S]*orca-bbbb/),
    }));
    await listenAt(join(ctl, "panel"));
    expect(discoverSocketPath({ env })).toBe(join(ctl, "panel", "control.sock"));
  });
});
