/**
 * Flow engine plan Task 10 (end to end, Task 8 deferral (b)): a scripted three-step run -- `draft` → `work` → `check` --
 * from startFlowRun through the panel's own pump, the real execution driver and the pinned ccloop build with its fake
 * agents, to `completed`. The draft is a single call on the parent drawn from the pool; the work step a hidden child on
 * the vault; the check runs on the composition. At the end the outputs are on the flow head and in the person's folder,
 * the run's decisions are in `flow_decisions`, and every draw is settled (what was not spent is back in the pool).
 * Nothing here is a fake port of Orca's: if the production wiring breaks anywhere, the run does not complete.
 */
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getFlowRun, listExecutions } from "../../src/flow/store.js";
import { ccloopWorlds, realBinary, until } from "../control/fixtures/ccloopWorld.js";
import { flowGit, flowRunWorld } from "./fixtures/flowCcloopWorld.js";

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-flow-e2e-", epochPrefix: "epoch-flow-e2e-" });
afterAll(removeRoots);

const TEMPLATE = {
  yaml: `format: orca-flow-v1
id: three
workspace: {kind: dir}
roles:
  writer: {tier: low, suggest: {agent: codex}}
steps:
  - {id: outline, kind: draft, prompt: prompts/outline.md}
  - {id: write, kind: work, role: writer, prompt: prompts/write.md}
  - id: verify
    kind: check
    acceptance:
      checks:
        - {run: "test -f answer.txt", role: gate}
`,
  assets: { "prompts/outline.md": "Outline the answer file.\n", "prompts/write.md": "Write answer.txt from the outline.\n" },
};
const DECISION = {
  question: "Where does the answer go?", chose: "answer.txt", alternatives: [{ option: "README.md", why_not: "the folder's own" }], because: "the outline says so",
  undo: { how: `git revert --no-edit ${"b".repeat(40)}`, cost: "small", blast_radius: "answer.txt" }, scope: "file", kind: "implementation", importance: "minor",
};

describe("a scripted flow run end to end through the pump (plan Task 10)", { timeout: 420_000 }, () => {
  relocateHome("orca-flow-e2e-home-");
  beforeEach((ctx) => { if (!realBinary) ctx.skip(); });

  it("draft → work → check completes: outputs on the flow head and in the folder, flow_decisions written, the pool settled", async () => {
    const vaults = await realpath(await mkdtemp(join(tmpdir(), "orca-flow-e2e-vaults-")));
    const w = await world([], {}, { claudeScript: {}, declaredContextWindowTokens: 1_000_000, env: { ORCA_VAULT_DIR: vaults } });
    const f = await flowRunWorld(w, {
      templates: { three: TEMPLATE }, folder: { "notes.md": "the person's notes\n" },
      claudeQueue: [{ match: "Outline the answer file.", output: { content: "1. write 42 to answer.txt" } }], decisions: [DECISION],
    });
    const { runtime, flowRunId } = await f.start("builtin/three");
    try {
      runtime.startPump(50);
      await until(() => {
        const failed = listExecutions(runtime.store, flowRunId).find((e) => e.state === "failed" || e.state === "parked");
        if (failed !== undefined) throw new Error(`${failed.stepKey}#${failed.seq} ${failed.state}: ${JSON.stringify(failed.body)}`);
        return getFlowRun(runtime.store, flowRunId)!.state === "done";
      }, 180_000, "the run to complete", 100);
      const executions = ["outline", "write", "verify"].map((key) => listExecutions(runtime.store, flowRunId).find((e) => e.stepKey === key)!);
      expect(executions.map((e) => [e.stepKey, e.seq, e.state, e.outputKind])).toEqual([
        ["outline", 1, "done", "artifact"], ["write", 1, "done", "commit"], ["verify", 1, "done", "artifact"],
      ]);
      // The work step's output is the child's landing in the vault, on the flow head and copied into the folder.
      const run = getFlowRun(runtime.store, flowRunId)!;
      const vault = join(vaults, `${run.vaultId}.git`);
      const head = flowGit(vaults, "--git-dir", vault, "rev-parse", `refs/orca/${flowRunId}/head`);
      expect(flowGit(vaults, "--git-dir", vault, "show", `${head}:answer.txt`)).toBe("42");
      expect(flowGit(vaults, "--git-dir", vault, "show", `${head}:notes.md`)).toBe("the person's notes");
      expect(readFileSync(join(f.folder, "answer.txt"), "utf8")).toBe("42\n");
      expect(existsSync(join(f.folder, ".decisions"))).toBe(false);
      // The decision the work agent reported, in flow_decisions; the draft's single call ran on the parent.
      expect(runtime.store.db.prepare("SELECT grade, step_key FROM flow_decisions WHERE flow_run_id=?").all(flowRunId).map((r) => [String(r.grade), String(r.step_key)])).toEqual([["minor", "write"]]);
      const parentRuns = runtime.store.db.prepare("SELECT body FROM runs WHERE group_id=?").all(run.groupId).map((r) => JSON.parse(String(r.body)));
      expect(parentRuns.map((r) => [r.phase, r.purpose])).toEqual([["single-call", "flow-draft"]]);
      // Every draw settled: what is still drawn is what was spent.
      const draws = Object.values((run.body as { draws: Record<string, { drawn: number; returned: number | null }> }).draws);
      expect(draws.length).toBe(2);
      expect(draws.every((d) => d.returned !== null)).toBe(true);
      expect(run.poolDrawn).toBe(draws.reduce((sum, d) => sum + d.drawn - d.returned!, 0));
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
