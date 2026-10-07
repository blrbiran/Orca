import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
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
  isDirectory: () => true, ...over,
});

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
