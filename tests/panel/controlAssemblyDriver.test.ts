import { copyFile, chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { controlRepoKey, resolveControlOptions } from "../../src/panel/controlOptions.js";

// Execution driver spec §2.1: the driver exists only with a configured port; without one the panel is
// byte-for-byte what it was, which includes creating no run or workspace directories.
const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function assembled(configured: boolean) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-assembly-driver-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control") };
  if (configured) {
    // Any executable file and any regular config satisfy the port's construction; nothing is spawned here.
    const binary = join(root, "ccloop");
    await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary);
    await chmod(binary, 0o700);
    // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): the port's second half is
    // the agents table (ORCA_AGENTS_TABLE, spec §6.6); any regular file still satisfies construction.
    const table = join(root, "agents.json");
    await writeFile(table, "{}", { mode: 0o600 });
    Object.assign(env, { ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: table });
  }
  const { rejection, ...control } = resolveControlOptions([], env, [{ projectKey: "proj", path: repo }]);
  expect(rejection).toBe(null);
  const runtime = await assembleControlRuntime({ control, repos: [{ projectKey: "proj", path: repo }], epoch: "epoch-driver", env });
  if (runtime === null) throw new Error("no runtime");
  return runtime;
}

describe("the execution driver in the panel's assembly (spec §2.1)", () => {
  it("is absent without an execution port, and no run or workspace directory is created", async () => {
    const runtime = await assembled(false); try {
      expect(runtime.driver).toBe(null);
      expect(existsSync(`${runtime.store.stateDir}.runs`)).toBe(false);
      expect(existsSync(`${runtime.store.stateDir}.workspaces`)).toBe(false);
    } finally { runtime.close(); }
  });

  // Fix round 1 (controller ruling, spec §2.1): the repository a workspace mode is set on is known only
  // to a panel with a configured port. Unconfigured, set-workspace-mode refuses every repository, as
  // before this slice.
  it.each([false, true])("knows its own repository for set-workspace-mode only with a configured port (configured=%s)", async (configured) => {
    const runtime = await assembled(configured); try {
      const repoId = controlRepoKey("proj");
      expect(runtime.service.repositoryKnown(repoId)).toBe(configured);
      const set = await runtime.service.setWorkspaceMode({
        schema: "orca-raw-command-v1", commandId: "mode", actorId: "human", verb: "set-workspace-mode",
        target: { kind: "repository", repoId }, expectedRevision: 0, payload: { workspaceMode: "clone" },
      } as never);
      if (configured) expect(set).toMatchObject({ result: { kind: "workspace-mode-set", repoId, workspaceMode: "clone" } });
      else expect(set).toMatchObject({ error: { code: "control-target-not-allowed" } });
    } finally { runtime.close(); }
  });

  it("is present with a configured port, with its roots created 0700 beside the store directory, and shuts down cleanly", async () => {
    const runtime = await assembled(true);
    expect(runtime.driver).not.toBe(null);
    expect(statSync(`${runtime.store.stateDir}.runs`).mode & 0o777).toBe(0o700);
    expect(statSync(`${runtime.store.stateDir}.workspaces`).mode & 0o777).toBe(0o700);
    expect(runtime.startPump(1_000)).toBe(true);
    expect(await runtime.shutdown()).toBe(true);
    expect(await runtime.shutdown()).toBe(false);
    // Controller ruling P10: the shutdown already stopped the driver and waited for it, so closing
    // afterwards starts no second, un-awaited stop.
    const stop = vi.spyOn(runtime.driver!, "stop");
    runtime.close();
    expect(stop).not.toHaveBeenCalled();
  });

  it("stops the driver on a close with no shutdown before it, and a stopped driver stays stopped (ruling P10)", async () => {
    const runtime = await assembled(true);
    const driver = runtime.driver!;
    const stop = vi.spyOn(driver, "stop");
    runtime.close();
    expect(stop).toHaveBeenCalledTimes(1);
    // Idempotent: a second stop resolves, and nothing restarts a stopped driver.
    await expect(driver.stop()).resolves.toBeUndefined();
    expect(driver.start(1_000)).toBe(false);
  });
});
