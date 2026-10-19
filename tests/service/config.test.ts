import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServiceConfig, checkDist } from "../../src/service/config.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

/** A checkout whose dist/cli.js is newer than every src file. */
async function checkout(opts: { dist?: boolean; srcNewer?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "sc-"));
  roots.push(root);
  await mkdir(join(root, "src", "panel"), { recursive: true });
  await writeFile(join(root, "src", "panel", "a.ts"), "export {};\n");
  await utimes(join(root, "src", "panel", "a.ts"), new Date("2026-01-01"), new Date("2026-01-01"));
  if (opts.dist !== false) {
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist", "cli.js"), "\n");
    await utimes(join(root, "dist", "cli.js"), new Date("2026-02-01"), new Date("2026-02-01"));
  }
  if (opts.srcNewer === true) await utimes(join(root, "src", "panel", "a.ts"), new Date("2026-03-01"), new Date("2026-03-01"));
  return root;
}

// The human's launcher, ~/.orca/panel.sh as written 2026-10-03, with $HOME expanded as the shell would.
const PANEL_SH_ARGS = ["--by", "biran", "--port", "7777", "--repo", "orca=/Users/biran/code/orca/orca-web",
  "--profile", "/Users/biran/.orca/profile.json", "--estimator-profile", "all", "--estimate-mode", "soft"];
const PANEL_SH_ENV = {
  ORCA_AGENTS_TABLE: "/Users/biran/.orca/agents.json",
  ORCA_CCMEM_BIN: "/usr/local/bin/ccmem",
  ORCA_SYNCSKILL_BIN: "/Users/biran/.nvm/versions/node/v22.13.1/bin/syncskill",
};
const NVM_NODE = "/Users/biran/.nvm/versions/node/v22.13.1/bin/node";

const input = async (over: Partial<Parameters<typeof buildServiceConfig>[0]> = {}) => ({
  args: PANEL_SH_ARGS, env: { ...PANEL_SH_ENV, SHELL: "/bin/zsh", ORCA_UNRELATED: "x", EDITOR: "vim" },
  execPath: NVM_NODE, checkout: await checkout(), home: "/Users/biran", panelDir: "/Users/biran/.orca/panel",
  // Issue #72: install reads the agents table ORCA_AGENTS_TABLE names. PANEL_SH_ENV names the human's real one, so
  // these criteria read an empty table instead; the agent PATH criteria below hand in a real one under mkdtemp.
  isDirectory: () => true, readTable: () => EMPTY_TABLE, ...over,
});
const EMPTY_TABLE = JSON.stringify({ schema: "ccloop-agents-table-v1", installations: {} });

describe("service.json (spec §3)", () => {
  it("reproduces the human's launcher one-to-one: same panel args, only the named variables, plus HOME/PATH/NODE_OPTIONS", async () => {
    const i = await input();
    const { config } = buildServiceConfig(i);
    expect(config).toEqual({
      schema: "orca-panel-service-v1",
      node: NVM_NODE,
      entry: join(i.checkout, "dist", "cli.js"),
      args: PANEL_SH_ARGS,
      env: {
        HOME: "/Users/biran", NODE_OPTIONS: "",
        ORCA_AGENTS_TABLE: "/Users/biran/.orca/agents.json", ORCA_CCMEM_BIN: "/usr/local/bin/ccmem",
        ORCA_PANEL_DIR: "/Users/biran/.orca/panel",
        ORCA_SYNCSKILL_BIN: "/Users/biran/.nvm/versions/node/v22.13.1/bin/syncskill",
        PATH: "/Users/biran/.nvm/versions/node/v22.13.1/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      },
    });
    expect(Object.keys(config.env)).toEqual([...Object.keys(config.env)].sort());
  });

  it("puts only existing directories on PATH, node's own first", async () => {
    const { config } = buildServiceConfig(await input({ execPath: "/usr/local/bin/node", isDirectory: (p) => p !== "/opt/homebrew/bin" }));
    expect(config.env.PATH).toBe("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("warns when node lives under a version manager, and not otherwise", async () => {
    expect(buildServiceConfig(await input()).warnings.join("\n")).toContain("version manager");
    expect(buildServiceConfig(await input({ execPath: "/usr/local/bin/node" })).warnings).toEqual([]);
  });

  it("captures the relocation variables (plan D3) when the installing shell sets them", async () => {
    const { config } = buildServiceConfig(await input({ env: { ...PANEL_SH_ENV, ORCA_CONTROL_DIR: "/t/c", ORCA_CORRECTIONS_DIR: "/t/k", ORCA_PROJECTS_FILE: "/t/p.json" } }));
    expect([config.env.ORCA_CONTROL_DIR, config.env.ORCA_CORRECTIONS_DIR, config.env.ORCA_PROJECTS_FILE]).toEqual(["/t/c", "/t/k", "/t/p.json"]);
  });

  it("refuses a relative path in a panel flag or a captured variable (plan D6)", async () => {
    const flag = await input({ args: ["--by", "a", "--repo", "x=rel/repo"] });
    expect(() => buildServiceConfig(flag)).toThrow(expect.objectContaining({ code: "service-path-not-absolute" }));
    const variable = await input({ env: { ...PANEL_SH_ENV, ORCA_AGENTS_TABLE: "agents.json" } });
    expect(() => buildServiceConfig(variable)).toThrow(expect.objectContaining({ code: "service-path-not-absolute" }));
    const panelDir = await input({ panelDir: "rel/panel" });
    expect(() => buildServiceConfig(panelDir)).toThrow(expect.objectContaining({ code: "service-path-not-absolute" }));
    // --plan <planId>=<repoId>=<path>: only the third part is a path, so an absolute one is carried as given.
    const plan = await input({ args: [...PANEL_SH_ARGS, "--plan", "p=orca=/abs/plan.md"] });
    expect(buildServiceConfig(plan).config.args).toEqual([...PANEL_SH_ARGS, "--plan", "p=orca=/abs/plan.md"]);
    const relativePlan = await input({ args: [...PANEL_SH_ARGS, "--plan", "p=orca=rel/plan.md"] });
    expect(() => buildServiceConfig(relativePlan)).toThrow(expect.objectContaining({ code: "service-path-not-absolute" }));
  });

  it("refuses arguments the panel itself would refuse, before writing anything (plan D7)", async () => {
    const i = await input({ args: ["--port", "7777"] });
    expect(() => buildServiceConfig(i)).toThrow(expect.objectContaining({ code: "service-panel-args-invalid" }));
    const reserved = await input({ args: [...PANEL_SH_ARGS, "--service"] });
    expect(() => buildServiceConfig(reserved)).toThrow(expect.objectContaining({ code: "service-argument-reserved" }));
  });

  it("refuses a missing or stale dist (spec §3)", async () => {
    const missing = await checkout({ dist: false });
    const stale = await checkout({ srcNewer: true });
    expect(() => checkDist(missing)).toThrow(expect.objectContaining({ code: "service-dist-missing" }));
    expect(() => checkDist(stale)).toThrow(expect.objectContaining({ code: "service-dist-stale" }));
    const fresh = await checkout();
    expect(checkDist(fresh)).toBe(join(fresh, "dist", "cli.js"));
  });
});

/**
 * Issue #72: omp is `#!/usr/bin/env bun` under ~/.bun/bin, and the service PATH (node's dir plus the system dirs) had
 * neither directory, so every omp run under the service died with `env: bun: No such file or directory` (exit 127).
 * Install adds each absolute agent command's directory and, for a `#!/usr/bin/env <name>` script, the directory the
 * installing shell resolves <name> to: never the shell's whole PATH, which would make the service depend on whatever
 * the installing terminal happened to have.
 */
describe("agent directories on the service PATH (issue #72)", () => {
  async function machine() {
    const root = await mkdtemp(join(tmpdir(), "sp-"));
    roots.push(root);
    const dir = (name: string) => join(root, name);
    for (const name of ["omp-bin", "bun-bin", "node-bin", "unrelated-bin", "missing-bin"]) await mkdir(dir(name));
    const exe = async (path: string, text: string) => { await writeFile(path, text); await chmod(path, 0o755); };
    // omp and its bun live apart here (on the human's machine both are ~/.bun/bin) so that the command's own directory
    // cannot stand in for the interpreter's: mutation A1 (drop the interpreter directory) survived when they shared one.
    await exe(join(dir("omp-bin"), "omp"), "#!/usr/bin/env bun\nconsole.log('omp')\n");
    await exe(join(dir("bun-bin"), "bun"), "\0binary");
    await exe(join(dir("node-bin"), "claude"), "#!/usr/bin/env node\n");
    await exe(join(dir("node-bin"), "node"), "\0binary");
    await exe(join(dir("missing-bin"), "ghost"), "#!/usr/bin/env no-such-interpreter\n");
    await exe(join(dir("unrelated-bin"), "bun"), "\0a later bun the shell would not pick");
    const table = (installations: Record<string, unknown>) => {
      const path = join(root, "agents.json");
      return { path, text: JSON.stringify({ schema: "ccloop-agents-table-v1", installations }) };
    };
    return { root, dir, table };
  }
  const SYSTEM = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

  it("adds the agent command's directory and its env interpreter's directory, after node's and before the system dirs", async () => {
    const m = await machine();
    const t = m.table({
      claude: { kind: "claude", command: [join(m.dir("node-bin"), "claude"), "--permission-mode", "acceptEdits"] },
      omp: { kind: "omp", command: [join(m.dir("omp-bin"), "omp")] },
    });
    await writeFile(t.path, t.text);
    const shellPath = ["/no/such/dir", m.dir("omp-bin"), m.dir("bun-bin"), m.dir("node-bin"), m.dir("unrelated-bin"), "/usr/bin"].join(":");
    const { config, warnings } = buildServiceConfig(await input({
      execPath: join(m.dir("node-bin"), "node"),
      env: { ...PANEL_SH_ENV, ORCA_AGENTS_TABLE: t.path, PATH: shellPath },
      readTable: undefined, // the real reader, over the mkdtemp table
    }));
    // node-bin once (node's own dir, claude's dir, and claude's `env node` all name it), then omp's dir, then the dir
    // its `env bun` resolves to. unrelated-bin (a later bun) and /no/such/dir are on the shell's PATH but nothing
    // resolves through them: they stay out.
    expect(config.env.PATH).toBe(`${m.dir("node-bin")}:${m.dir("omp-bin")}:${m.dir("bun-bin")}:${SYSTEM}`);
    expect(warnings).toEqual([]);
  });

  it("leaves an interpreter the installing shell cannot resolve out of PATH and says so", async () => {
    const m = await machine();
    const ghost = join(m.dir("missing-bin"), "ghost");
    const t = m.table({ ghost: { kind: "omp", command: [ghost] } });
    await writeFile(t.path, t.text);
    const { config, warnings } = buildServiceConfig(await input({
      execPath: "/usr/local/bin/node",
      env: { ...PANEL_SH_ENV, ORCA_AGENTS_TABLE: t.path, PATH: `${m.dir("bun-bin")}:/usr/bin` },
      readTable: undefined,
    }));
    expect(config.env.PATH).toBe(`/usr/local/bin:${m.dir("missing-bin")}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`);
    expect(warnings.join("\n")).toContain(`ghost: ${ghost} starts with #!/usr/bin/env no-such-interpreter`);
  });

  it("reads no table when ORCA_AGENTS_TABLE is unset: the service then runs no agents", async () => {
    const { ORCA_AGENTS_TABLE: _unset, ...env } = PANEL_SH_ENV;
    const { config } = buildServiceConfig(await input({
      execPath: "/usr/local/bin/node", env,
      readTable: () => { throw new Error("read a table the service will not use"); },
    }));
    expect(config.env.PATH).toBe("/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("warns, and adds nothing, when the named table cannot be read", async () => {
    const { config, warnings } = buildServiceConfig(await input({ execPath: "/usr/local/bin/node", readTable: () => null }));
    expect(config.env.PATH).toBe("/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    expect(warnings.join("\n")).toContain("/Users/biran/.orca/agents.json");
  });
});
