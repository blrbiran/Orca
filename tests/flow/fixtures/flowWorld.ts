/**
 * Flow engine plan Tasks 8-9: a control store, a built-in template root and a person's folder under one temporary root,
 * every ORCA_* path redirected there (Rule 17), and the flow kernel over a call port that only records what it is asked
 * (the driver-backed port is Task 10's). A criterion answers a call with `answer(n, output)`, the seam the driver's
 * single-call settlement uses.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { advanceFlowRuns, completeFlowCall, startFlowRun, type AgentCandidate, type FlowCallRequest, type FlowDeps, type StartFlowInput } from "../../../src/flow/kernel.js";
import { listExecutions, type ExecutionRow } from "../../../src/flow/store.js";
import type { FlowChildPort, KindRegistry } from "../../../src/flow/kinds/registry.js";
import type { ControlStore } from "../../../src/control/store.js";
import { openTestStore } from "../../control/fixtures/store.js";

export interface WorldTemplate { yaml: string; assets?: Record<string, string> }

export async function flowWorld(templates: Record<string, WorldTemplate>, opts: {
  agents?: AgentCandidate[]; files?: Record<string, string>; registry?: KindRegistry; runCommand?: FlowDeps["runCommand"]; children?: FlowChildPort | ((store: ControlStore) => FlowChildPort);
} = {}) {
  const h = await openTestStore();
  const builtinRoot = join(h.root, "builtin");
  for (const [id, tpl] of Object.entries(templates)) {
    const write = (rel: string, text: string) => { mkdirSync(dirname(join(builtinRoot, id, rel)), { recursive: true }); writeFileSync(join(builtinRoot, id, rel), text); };
    write("template.yaml", tpl.yaml);
    for (const [rel, text] of Object.entries(tpl.assets ?? {})) write(rel, text);
  }
  const folder = join(h.root, "articles");
  mkdirSync(folder);
  for (const [rel, text] of Object.entries(opts.files ?? {})) { mkdirSync(dirname(join(folder, rel)), { recursive: true }); writeFileSync(join(folder, rel), text); }
  const calls: FlowCallRequest[] = [];
  let clock = 1_000;
  const deps: FlowDeps = {
    store: h.store, now: () => (clock += 1), builtinRoot,
    env: { ORCA_VAULT_DIR: join(h.root, "vaults") },
    calls: { request: (req) => { calls.push(structuredClone(req)); } },
    agents: () => opts.agents ?? [{ agent: "claude", model: "opus", tier: "high" }, { agent: "codex", model: "gpt", tier: "high" }],
    ...(opts.registry === undefined ? {} : { registry: opts.registry }),
    ...(opts.runCommand === undefined ? {} : { runCommand: opts.runCommand }),
    ...(opts.children === undefined ? {} : { children: typeof opts.children === "function" ? opts.children(h.store) : opts.children }),
  };
  const start = (input: Partial<StartFlowInput> & { templateRef: string }) =>
    startFlowRun(deps, { dir: folder, params: {}, by: "ann", via: "cli:test", ...input });
  const execs = (flowRunId: string, stepKey?: string): ExecutionRow[] =>
    listExecutions(h.store, flowRunId).filter((e) => stepKey === undefined || e.stepKey === stepKey);
  const latest = (flowRunId: string, stepKey: string): ExecutionRow | undefined => execs(flowRunId, stepKey).at(-1);
  /** Settle call n (0-based) with this output, or with a failure code; then let the kernel advance. */
  const answer = async (n: number, output: unknown, failure: string | null = null) => {
    const call = calls[n];
    if (call === undefined) throw new Error(`flowWorld: no call ${n} (have ${calls.length})`);
    await completeFlowCall(deps, call.key, output, failure);
    await advanceFlowRuns(deps);
  };
  return { ...h, deps, calls, folder, builtinRoot, start, execs, latest, answer, advance: () => advanceFlowRuns(deps) };
}
