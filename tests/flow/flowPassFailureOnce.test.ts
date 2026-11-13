/**
 * Tester follow-up I: a real panel's log held ~260 lines `orca-control: flow pass failed: control-peer-exit:ENOENT`, one
 * per pump pass, while the ccloop file its execution port starts (node_modules/ccloop/dist/cli.js) was missing -- every
 * pass lists the agents through ccloop first, flow runs or not. The line said neither what was missing nor stopped
 * repeating. Now the failure names the path ccloop could not be started from, is logged once until it changes or a pass
 * succeeds, and an open flow run shows it on its page (lastError). All state lives in a temp dir (Rule 17).
 */
import { copyFile, chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFlowRun, insertFlowRun } from "../../src/flow/store.js";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { resolveControlOptions } from "../../src/panel/controlOptions.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function runtimeWithPort() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-flow-once-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  const binary = join(root, "ccloop");
  const install = async () => { await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700); };
  await install();
  const table = join(root, "agents.json");
  await writeFile(table, "{}", { mode: 0o600 });
  const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_VAULT_DIR: join(root, "vaults"), ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: table };
  const { rejection, ...control } = resolveControlOptions([], env, [{ projectKey: "proj", path: repo }]);
  expect(rejection).toBe(null);
  const runtime = (await assembleControlRuntime({ control, repos: [{ projectKey: "proj", path: repo }], epoch: "epoch-flow-once", env }))!;
  return { runtime, binary, install };
}

/** `n` pump passes; the stderr lines the flow pass wrote. */
async function passes(runtime: Awaited<ReturnType<typeof runtimeWithPort>>["runtime"], n: number): Promise<string[]> {
  const written: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { written.push(String(chunk)); return true; });
  try { for (let i = 0; i < n; i += 1) await runtime.pump(); } finally { spy.mockRestore(); }
  return written.filter((line) => line.startsWith("orca-control: flow pass failed"));
}

describe("a flow pass that fails the same way every pass (tester follow-up I)", () => {
  it("ccloop's file gone: one line naming its path over ten passes; again once after a pass that succeeded", async () => {
    const { runtime, binary, install } = await runtimeWithPort();
    try {
      expect(await passes(runtime, 2)).toEqual([]);
      await rm(binary);
      const lines = await passes(runtime, 10);
      // mutation F1: the old per-pass write in the flow pass's catch -> ten lines, red
      expect(lines).toHaveLength(1);
      // mutation F2: drop the spawn-failure detail in ccloopPort -> `control-peer-exit:ENOENT` alone, red
      expect(lines[0]).toBe(`orca-control: flow pass failed: the agents could not be listed: control-peer-exit:ENOENT:${binary}: ccloop could not be started (ENOENT)\n`);
      await install();
      expect(await passes(runtime, 2)).toEqual([]);
      await rm(binary);
      // mutation F3: never clear the remembered failure after a clean pass -> the second outage is silent, red
      expect(await passes(runtime, 3)).toHaveLength(1);
    } finally { runtime.close(); }
  });

  it("an open flow run shows why it cannot advance (lastError), once the agents cannot be listed", async () => {
    const { runtime, binary } = await runtimeWithPort();
    try {
      runtime.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('flow-parent-1',0,1,'{}')").run();
      insertFlowRun(runtime.store, { id: "flow-run-1", groupId: "flow-parent-1", templateRef: "builtin/x@1", templateSha256: "a".repeat(64), workspace: { kind: "dir" },
        vaultId: null, paramsSha256: "b".repeat(64), poolTokens: 0, poolDrawn: 0, state: "running", revision: 1, body: {} });
      await rm(binary);
      await passes(runtime, 3);
      // mutation F4: drop the lastError write for open runs -> undefined, red
      expect((getFlowRun(runtime.store, "flow-run-1")!.body as { lastError?: { message: string } }).lastError?.message)
        .toBe(`the agents could not be listed: control-peer-exit:ENOENT:${binary}: ccloop could not be started (ENOENT)`);
    } finally { runtime.close(); }
  });
});
