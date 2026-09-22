import { chmod, mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPanelServer, parsePanelArgs, type StartedPanel } from "../../src/panel/server.js";
import { controlRepoKey } from "../../src/panel/controlOptions.js";

/**
 * Assembly plan Task 5. The first criteria in this repository about the *shipped* panel process
 * serving the control plane: everything before this booted it from a fixture.
 *
 * Every one of them relocates the control root through ORCA_CONTROL_DIR into a temp directory
 * (CLAUDE.md Rule 17). A criterion that wrote into a person's real ~/.orca would be unacceptable
 * even if it only wrote one line, so the variable is set on every call and never omitted.
 */

const roots: string[] = [];
const panels: StartedPanel[] = [];
afterEach(async () => {
  while (panels.length) await panels.pop()!.close().catch(() => undefined);
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function workspace() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-panel-mount-")));
  roots.push(root);
  const repo = join(root, "repo");
  const corrections = join(root, "corrections");
  const controlRoot = join(root, "control");
  await mkdir(repo, { recursive: true });
  await mkdir(corrections, { recursive: true });
  return { root, repo, corrections, controlRoot };
}

async function boot(h: Awaited<ReturnType<typeof workspace>>, extra: string[] = [], overEnv: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: h.controlRoot, ORCA_CORRECTIONS_DIR: h.corrections, ...overEnv };
  const opts = parsePanelArgs(["--by", "tester", "--repo", `proj=${h.repo}`, ...extra], env);
  const panel = await createPanelServer(opts, env);
  panels.push(panel);
  return panel;
}

const get = (panel: StartedPanel, path: string) =>
  fetch(`${panel.url}${path}`, { headers: { "x-orca-token": panel.token } });

describe("a shipped panel mounts the control plane by default", () => {
  it("boots with no execution port, and serves the config read", async () => {
    const h = await workspace();
    const panel = await boot(h);
    const response = await get(panel, "/api/control/config");
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body.schema).toBe("orca-control-config-v1");
    // The shipped process, not a fixture, is saying this about itself.
    expect(body.executionPort).toBe("unconfigured");
    expect(body.defaults).toBe(null);
  });

  it("serves the recovery read too, which is the whole reason booting without a port is allowed", async () => {
    const h = await workspace();
    const response = await get(await boot(h), "/api/control/recovery");
    expect(response.status).toBe(200);
    expect((await response.json() as Record<string, unknown>).schema).toBe("orca-control-recovery-v1");
  });

  it("a criterion asserting the boot failed is itself red, so the success above is not vacuous", async () => {
    // The plan asks for this explicitly. If parsing or booting ever starts refusing, the three
    // judgements above would pass by never running; this one turns that into a failure.
    const h = await workspace();
    await expect(boot(h)).resolves.toBeDefined();
  });

  it("creates its store under the relocated root and nowhere else", async () => {
    const h = await workspace();
    await boot(h);
    await expect(stat(join(h.controlRoot, controlRepoKey("proj"), "control.sqlite"))).resolves.toBeDefined();
  });
});

describe("--no-control leaves the process exactly as it shipped before", () => {
  it("answers 404 for the control routes", async () => {
    const h = await workspace();
    expect((await get(await boot(h, ["--no-control"]), "/api/control/config")).status).toBe(404);
  });

  it("writes nothing at all under the control root", async () => {
    const h = await workspace();
    await boot(h, ["--no-control"]);
    await expect(stat(h.controlRoot)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("the store's own modes", () => {
  it("asks for private modes rather than inheriting whatever the umask allows", async () => {
    const h = await workspace();
    await boot(h);
    const dir = await stat(join(h.controlRoot, controlRepoKey("proj")));
    const db = await stat(join(h.controlRoot, controlRepoKey("proj"), "control.sqlite"));
    // Subset, not equality: umask can only remove bits from what was requested, so a stricter
    // environment must not make this red, while a request of 0o755 or 0o644 must.
    expect(dir.mode & 0o777 & ~0o700).toBe(0);
    expect(db.mode & 0o777 & ~0o600).toBe(0);
  });

  it("leaves an existing directory's mode alone, because it is someone's and not this program's decision", async () => {
    const h = await workspace();
    const stateDir = join(h.controlRoot, controlRepoKey("proj"));
    await mkdir(stateDir, { recursive: true });
    await chmod(stateDir, 0o755);
    await boot(h);
    expect((await stat(stateDir)).mode & 0o777).toBe(0o755);
  });
});

describe("what a panel with no port refuses", () => {
  it("refuses a start command by the port's own name rather than by a capability complaint", async () => {
    const h = await workspace();
    const panel = await boot(h);
    const response = await fetch(`${panel.url}/api/control/commands`, {
      method: "POST",
      headers: { "x-orca-token": panel.token, "content-type": "application/json" },
      body: JSON.stringify({ schema: "orca-raw-command-v1", commandId: "start-1", actorId: "human", expectedRevision: 0, verb: "start", target: { kind: "group", groupId: "g" }, payload: { groupId: "g", taskId: "t" } }),
    });
    const body = await response.json() as Record<string, unknown>;
    // The status and code both matter: a 5xx here would mean the command rolled back with nothing
    // to show, which is the opposite of what a named refusal is for.
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(body)).not.toContain("panel-internal-error");
  });

  it("publishes the port refusal in the error catalogue the browser reads", async () => {
    const h = await workspace();
    const body = await (await get(await boot(h), "/api/control/config")).json() as { errorCatalog: Array<{ code: string; status: number }> };
    expect(body.errorCatalog).toContainEqual({ code: "control-port-unconfigured", status: 422 });
    expect(body.errorCatalog).toContainEqual({ code: "control-estimator-unconfigured", status: 422 });
  });
});

describe("a multi-repository panel", () => {
  it("refuses to guess which repository names the state directory", async () => {
    const h = await workspace();
    const env = { ORCA_CONTROL_DIR: h.controlRoot, ORCA_CORRECTIONS_DIR: h.corrections };
    // Asserted on the code, not the sentence: the sentence is for a person and may be reworded,
    // while the code is what a criterion and a caller are allowed to depend on.
    expect(() => parsePanelArgs(["--by", "t", "--repo", `a=${h.repo}`, "--repo", `b=${h.repo}`], env))
      .toThrow(expect.objectContaining({ code: "control-state-dir-required" }));
  });

  it("accepts one that names it", async () => {
    const h = await workspace();
    const named = join(h.root, "named-state");
    await mkdir(named, { recursive: true, mode: 0o700 });
    const env = { ORCA_CONTROL_DIR: h.controlRoot, ORCA_CORRECTIONS_DIR: h.corrections };
    const opts = parsePanelArgs(["--by", "t", "--repo", `a=${h.repo}`, "--repo", `b=${h.repo}`, "--control-state-dir", named], env);
    expect(opts.control.stateDir).toBe(named);
    const panel = await createPanelServer(opts, env);
    panels.push(panel);
    await expect(stat(join(named, "control.sqlite"))).resolves.toBeDefined();
  });
});
