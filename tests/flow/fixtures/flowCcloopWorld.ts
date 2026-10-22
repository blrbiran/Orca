/**
 * Flow engine plan Task 10 (C14 and the scripted end-to-end run): a flow run through the assembled panel -- its pump,
 * the real execution driver and the pinned ccloop build (ORCA_CCLOOP_BIN) with ccloop's CLI-level fakes. Single calls
 * (`draft`, ...) go to fake claude's queue; `work` children to fake codex in mode `reported`, which writes `answer.txt`
 * and reports the decisions given here. The person's folder, the vault root and the built-in template root are under the
 * world's own temporary root; ORCA_VAULT_DIR is redirected there (Rule 17).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { startFlowRun } from "../../../src/flow/kernel.js";
import type { ControlRuntime } from "../../../src/panel/controlAssembly.js";
import { raw, type World } from "../../control/fixtures/ccloopWorld.js";
import type { WorldTemplate } from "./flowWorld.js";

export const flowGit = (cwd: string, ...args: string[]): string =>
  execFileSync("/usr/bin/git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();

export async function flowRunWorld(w: World, opts: {
  templates: Record<string, WorldTemplate>; folder: Record<string, string>; gitFolder?: boolean;
  claudeQueue?: Array<{ match: string; output: unknown }>; decisions?: unknown[];
}) {
  // Fake codex in mode `reported`: its execute writes answer.txt and reports these decisions (ccloop tests/fixtures).
  const codex = w.agentsTable.installations.codex!;
  const command = codex.command as string[];
  const marker = command[3]!;
  codex.command = [command[0]!, command[1]!, "reported", marker];
  writeFileSync(w.table, JSON.stringify(w.agentsTable), { mode: 0o600 });
  writeFileSync(`${marker}.reported.json`, JSON.stringify({ decisions: opts.decisions ?? [] }));
  writeFileSync(w.claudeScriptPath, JSON.stringify({ "single-call-queue": opts.claudeQueue ?? [] }));
  const builtinRoot = join(w.root, "builtin");
  for (const [id, tpl] of Object.entries(opts.templates)) {
    const write = (rel: string, text: string) => { mkdirSync(dirname(join(builtinRoot, id, rel)), { recursive: true }); writeFileSync(join(builtinRoot, id, rel), text); };
    write("template.yaml", tpl.yaml);
    for (const [rel, text] of Object.entries(tpl.assets ?? {})) write(rel, text);
  }
  const folder = join(w.root, "articles");
  mkdirSync(folder);
  for (const [rel, text] of Object.entries(opts.folder)) { mkdirSync(dirname(join(folder, rel)), { recursive: true }); writeFileSync(join(folder, rel), text); }
  if (opts.gitFolder === true) { flowGit(folder, "init", "-q", "-b", "main"); flowGit(folder, "add", "-A"); flowGit(folder, "commit", "-qm", "the person's own history"); }
  /** Boot the panel, set the person's agents (codex works, claude answers single calls) and start a run of `templateRef`. */
  const start = async (templateRef: string): Promise<{ runtime: ControlRuntime; flowRunId: string; groupId: string }> => {
    const runtime = await w.boot();
    const prefs = await runtime.service.setAgentPreferences(raw(runtime, "prefs", "set-agent-preferences",
      { preferences: { defaultAgent: "codex", perAgent: {}, estimator: { agent: "claude", contextWindow: 1_000_000 } } }, { kind: "operator", operatorId: "human" }));
    if ("error" in prefs) throw new Error(`preferences refused: ${JSON.stringify(prefs.error)}`);
    if (runtime.flow === null) throw new Error("the panel assembled no flow ports");
    await runtime.flow.refreshAgents();
    const started = await startFlowRun({ ...runtime.flow.deps, builtinRoot }, { templateRef, dir: folder, params: {}, by: "human", via: "cli:test" });
    return { runtime, ...started };
  };
  return { folder, builtinRoot, marker, start };
}
