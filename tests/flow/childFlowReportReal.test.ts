/**
 * Flow engine spec §4.3 over the real ccloop build (ORCA_CCLOOP_BIN, fbd3512 on): what a `work` step's agent reports
 * under the top-level `flow` key travels through ccloop's execute answer and collect, the driver's saved report and the
 * driver-backed child port into the kernel. Until the repin no build could deliver it, so the paths below (candidatesFrom,
 * C22's needs, C13's remote id) had only ever seen the fake child port. The agent is ccloop's fake codex in mode
 * `reported`, which puts `<marker>.reported.json` into its execute answer as given; it does not go through the
 * provider's strict wire schema, so it can carry `candidates`, which a real codex agent cannot (ccloop spec §3, F1).
 */
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getFlowRun, listExecutions } from "../../src/flow/store.js";
import { ccloopWorlds, realBinary, until } from "../control/fixtures/ccloopWorld.js";
import { flowRunWorld } from "./fixtures/flowCcloopWorld.js";

const TWO_STEPS = {
  yaml: `format: orca-flow-v1
id: titled
workspace: {kind: dir}
roles:
  writer: {tier: low, suggest: {agent: codex}}
steps:
  - {id: write, kind: work, role: writer, prompt: prompts/write.md}
  - {id: pick-title, kind: ask, form: {title: {type: text}}, candidatesFrom: {step: write, name: title}}
`,
  assets: { "prompts/write.md": "Write answer.txt and propose titles.\n" },
};
const TITLES = { items: ["Worktrees, one per agent", "Parallel agents without collisions"], recommended: 1 };

const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-child-flow-", epochPrefix: "epoch-child-flow-" });
afterAll(removeRoots);

async function runUntil(flow: unknown, settled: (state: string) => boolean) {
  const vaults = await realpath(await mkdtemp(join(tmpdir(), "orca-child-flow-vaults-")));
  const w = await world([], {}, { claudeScript: {}, declaredContextWindowTokens: 1_000_000, env: { ORCA_VAULT_DIR: vaults } });
  const f = await flowRunWorld(w, { templates: { titled: TWO_STEPS }, folder: { "notes.md": "notes\n" }, flow });
  const { runtime, flowRunId } = await f.start("builtin/titled");
  runtime.startPump(50);
  await until(() => {
    const failed = listExecutions(runtime.store, flowRunId).find((e) => e.state === "failed" || e.state === "parked");
    if (failed !== undefined) throw new Error(`${failed.stepKey}#${failed.seq} ${failed.state}: ${JSON.stringify(failed.body)}`);
    return settled(getFlowRun(runtime.store, flowRunId)!.state) || listExecutions(runtime.store, flowRunId).some((e) => e.state === "needs-person");
  }, 180_000, "the run to wait for a person", 100);
  return { w, runtime, flowRunId };
}

describe.skipIf(!realBinary)("a work step's reported flow through the real ccloop and driver (§4.3)", { timeout: 300_000 }, () => {
  relocateHome("orca-child-flow-home-");

  it("candidates and an effect's remote id reach the execution; the later ask offers the reported candidates", async () => {
    const { w, runtime, flowRunId } = await runUntil({ candidates: { title: TITLES }, effect: { remoteId: "media-42", url: "https://example.invalid/d" } }, () => false);
    try {
      const write = listExecutions(runtime.store, flowRunId).find((e) => e.stepKey === "write")!;
      expect(write.state).toBe("done");
      expect((write.body as { reported?: unknown }).reported).toEqual({ candidates: { title: TITLES }, effect: { remoteId: "media-42", url: "https://example.invalid/d" } });
      const ask = listExecutions(runtime.store, flowRunId).find((e) => e.stepKey === "pick-title")!;
      expect(ask.state).toBe("needs-person");
      expect((ask.body as { ask: unknown }).ask).toEqual({ kind: "ask", form: { title: { type: "text" } }, candidates: { title: TITLES.items }, defaults: { title: TITLES.items[1] }, freeText: true });
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });

  it("needs makes the work step wait for the person with the agent's question", async () => {
    const needs = { kind: "input", question: "Which audience?", candidates: ["engineers", "managers"] };
    const { w, runtime, flowRunId } = await runUntil({ needs }, () => false);
    try {
      const write = listExecutions(runtime.store, flowRunId).find((e) => e.stepKey === "write")!;
      expect(write.state).toBe("needs-person");
      expect((write.body as { ask: unknown }).ask).toEqual({ ...needs, unclassed: true });
      expect(listExecutions(runtime.store, flowRunId).some((e) => e.stepKey === "pick-title")).toBe(false);
      expect(await runtime.shutdown()).toBe(true);
    } finally { await w.teardown(); }
  });
});
