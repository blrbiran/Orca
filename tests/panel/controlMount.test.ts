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

  // Agent selection plan T14 (W6-10): the agents view asks the port the shipped process assembled. With no port
  // configured the answer is that port's own refusal by name -- a panel that did not hand its port to the read
  // routes would answer route-not-found instead, and the settings page would have nothing to say why.
  it("answers the agents view from the assembled port, which with no port configured refuses by name", async () => {
    const h = await workspace();
    const response = await get(await boot(h), "/api/control/agents");
    expect((await response.json() as { error: { code: string } }).error.code).toBe("control-port-unconfigured");
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
  it("refuses a plan import by the estimator's own name, on the route that actually exists", async () => {
    // ⚠️ The first version of this judgement posted to /api/control/commands, which is not a route.
    // It answered 404 and the assertion -- "status >= 400 and not panel-internal-error" -- passed.
    // A criterion that cannot tell a missing route from a named refusal is not judging anything, so
    // it now names the route from the table in controlApi.ts and asserts the code itself.
    const h = await workspace();
    const panel = await boot(h);
    const response = await fetch(`${panel.url}/api/control/groups/import-plan`, {
      method: "POST",
      headers: { "x-orca-token": panel.token, "content-type": "application/json" },
      // The envelope the route parses is strict and carries only these three: the verb, the actor
      // and the target come from the route and the store, never from the browser.
      body: JSON.stringify({ commandId: "import-1", expectedRevision: 0, payload: { groupId: "g", repoId: "proj", planId: "plan" } }),
    });
    const body = await response.json() as { error?: { code?: string } };
    expect(response.status).not.toBe(404);
    expect(body.error?.code).toBe("control-estimator-unconfigured");
  });

  it("does not answer a real mutation route with route-not-found, which is how the above went vacuous", async () => {
    const h = await workspace();
    const panel = await boot(h);
    const response = await fetch(`${panel.url}/api/control/groups/g/start`, {
      method: "POST",
      headers: { "x-orca-token": panel.token, "content-type": "application/json" },
      body: JSON.stringify({ commandId: "start-1", expectedRevision: 0, payload: { groupId: "g" } }),
    });
    const body = await response.json() as { error?: { code?: string } };
    // What this is for: the route is registered and validates. Which named refusal it reaches
    // depends on the payload, and pinning that would make this a criterion about the start payload
    // schema instead of about the mount -- which is what the vacuous version got wrong.
    expect(body.error?.code).not.toBe("route-not-found");
    expect(body.error?.code).toBeTypeOf("string");
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
