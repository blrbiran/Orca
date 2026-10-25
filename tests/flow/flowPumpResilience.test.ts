/**
 * Flow engine spec §8.2, §5.3 (review finding C2): the panel's pump advances flow runs before the auto-start pass of every
 * group. One run's error must not stop the other runs, nor the auto-start of every other group: it is recorded on that
 * run and the next pass tries again. A composition conflict is not an error at all (§5.3): the step does not start (no
 * child is opened), the earlier step whose output no longer merges is flagged red and becomes a candidate of the next plan.
 */
import { copyFile, chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRun } from "../../src/flow/kernel.js";
import type { FlowChildPort } from "../../src/flow/kinds/work.js";
import { childGroupIdOf } from "../../src/flow/kinds/work.js";
import { currentCandidates } from "../../src/flow/rerun.js";
import { getFlowRun, listExecutions } from "../../src/flow/store.js";
import { assembleControlRuntime } from "../../src/panel/controlAssembly.js";
import { resolveControlOptions } from "../../src/panel/controlOptions.js";
import { fakeChildPort } from "./fixtures/childPort.js";
import { flowWorld } from "./fixtures/flowWorld.js";

const WORK = { yaml: `format: orca-flow-v1
id: w
workspace: {kind: dir}
steps:
  - {id: write, kind: work, prompt: p.md}
`, assets: { "p.md": "Write.\n" } };
const DRAFT = { yaml: `format: orca-flow-v1
id: d
workspace: {kind: dir}
steps:
  - {id: draft, kind: draft, prompt: d.md}
`, assets: { "d.md": "Draft.\n" } };
const PARALLEL = { yaml: `format: orca-flow-v1
id: p
workspace: {kind: dir}
steps:
  - {id: a, kind: work, prompt: p.md}
  - {id: b, kind: work, prompt: p.md, parallelWith: a}
  - {id: c, kind: work, prompt: p.md}
`, assets: { "p.md": "Write.\n" } };

const lastError = (w: Awaited<ReturnType<typeof flowWorld>>, id: string) => (getFlowRun(w.store, id)!.body as { lastError?: { message: string } }).lastError;

describe("one flow run's error stays with that run (C2)", () => {
  it("a run whose step throws records the error; the other run still advances; a clean pass clears it", async () => {
    let broken = true;
    const fake = fakeChildPort();
    const children = (store: Parameters<typeof fake.port>[0]): FlowChildPort => {
      const port = fake.port(store);
      return { open: async (request) => { if (broken) throw new Error("git: EACCES on the vault"); await port.open(request); }, status: port.status,
        attemptTimeoutMs: port.attemptTimeoutMs, stop: port.stop, stopState: port.stopState, resume: port.resume };
    };
    const w = await flowWorld({ w: WORK, d: DRAFT }, { children }); try {
      const failing = await w.start({ templateRef: "builtin/w" });
      const fine = await w.start({ templateRef: "builtin/d" });
      await expect(w.advance()).resolves.toBeUndefined();
      expect(lastError(w, failing.flowRunId)?.message).toBe("git: EACCES on the vault");
      expect(w.calls.map((c) => c.key.flowRunId)).toEqual([fine.flowRunId]);
      expect(lastError(w, fine.flowRunId)).toBeUndefined();
      broken = false;
      await w.advance();
      expect(lastError(w, failing.flowRunId)).toBeUndefined();
      expect(w.latest(failing.flowRunId, "write")).toMatchObject({ state: "running", childGroupId: childGroupIdOf(failing.flowRunId, "write", 1) });
    } finally { await w.dispose(); }
  });

  it("a compose conflict: the later step opens no child and fails compose-conflict; the step that no longer merges is flagged and is a candidate", async () => {
    const children = fakeChildPort();
    const w = await flowWorld({ p: PARALLEL }, { children: children.port, files: { "a.md": "x\n" } }); try {
      const { flowRunId } = await w.start({ templateRef: "builtin/p" });
      await w.advance();
      expect(children.counts().dispatches).toBe(2);
      children.land(childGroupIdOf(flowRunId, "a", 1), { "a.md": "from a\n" });
      children.land(childGroupIdOf(flowRunId, "b", 1), { "a.md": "from b\n" });
      await expect(w.advance()).resolves.toBeUndefined();
      expect(lastError(w, flowRunId)).toBeUndefined();
      expect(children.counts().dispatches).toBe(2);
      expect(w.latest(flowRunId, "c")).toMatchObject({ state: "failed", childGroupId: null, body: expect.objectContaining({ failure: "compose-conflict:b" }) });
      const active = (step: string) => listExecutions(w.store, flowRunId).find((e) => e.stepKey === step && e.state === "done")!;
      expect((active("b").body as { flags?: string[] }).flags).toContain("compose-conflict");
      expect((active("a").body as { flags?: string[] }).flags ?? []).not.toContain("compose-conflict");
      const list = currentCandidates(w.deps, loadRun(w.store, flowRunId), []);
      expect(list.find((c) => c.stepKey === "b")?.reasons).toContain("compose-conflict");
      expect(list.find((c) => c.stepKey === "a")).toBeUndefined();
    } finally { await w.dispose(); }
  });
});

describe("the pump's auto-start runs whatever the flow pass does (C2)", () => {
  const roots: string[] = [];
  afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

  it("a flow pass that throws is logged and autoStart still runs", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-flow-pump-")));
    roots.push(root);
    const repo = join(root, "repo");
    await mkdir(repo);
    const binary = join(root, "ccloop");
    await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary);
    await chmod(binary, 0o700);
    const table = join(root, "agents.json");
    await writeFile(table, "{}", { mode: 0o600 });
    const env: NodeJS.ProcessEnv = { ORCA_CONTROL_DIR: join(root, "control"), ORCA_VAULT_DIR: join(root, "vaults"), ORCA_CCLOOP_BIN: binary, ORCA_AGENTS_TABLE: table };
    const { rejection, ...control } = resolveControlOptions([], env, [{ projectKey: "proj", path: repo }]);
    expect(rejection).toBe(null);
    const runtime = (await assembleControlRuntime({ control, repos: [{ projectKey: "proj", path: repo }], epoch: "epoch-flow-pump", env }))!;
    try {
      expect(runtime.flow).not.toBe(null);
      vi.spyOn(runtime.flow!, "refreshAgents").mockRejectedValue(new Error("ccloop agents probe failed"));
      const autoStart = vi.spyOn(runtime.service, "autoStart");
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try { await runtime.pump(); } finally { stderr.mockRestore(); }
      expect(autoStart).toHaveBeenCalledTimes(1);
    } finally { runtime.close(); }
  });
});
