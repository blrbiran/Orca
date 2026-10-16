/**
 * Spec 2026-10-15 §5 (part C, R3, R4): the port's `listModels` asks the shipped ccloop's `control models` and passes
 * its answer through Orca's strict schema. The table's one installation is the build's fake codex, whose catalog lists
 * two models; the second read is served by ccloop's own file cache (CCLOOP_CACHE_DIR, relocated by the vitest setup),
 * so Orca keeps no cache of its own. RF5: an installation the table does not hold is ccloop's named refusal.
 */
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { versionOf } from "./fixtures/ccloopWorld.js";

const realBinary = process.env.ORCA_CCLOOP_BIN;
const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

async function realTable(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-models-")));
  roots.push(root);
  const command = [process.execPath, resolve(dirname(realBinary!), "..", "tests", "fixtures", "fake-codex.mjs"), "integration", join(root, "codex-marker.json")];
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: {
    codex: { kind: "codex", command, version: versionOf(command), configDir: null, timeoutMs: 120_000, killGraceMs: 5_000, sandbox: "workspace-write", budgetMode: "soft" },
  } }), { mode: 0o600 });
  return table;
}

describe("the port lists an installation's models through the shipped ccloop (spec 2026-10-15 §5)", () => {
  it.skipIf(!realBinary)("answers the fake codex's listed models, then ccloop's cache, and names a missing installation", async () => {
    const port = createCcloopExecutionPort({ binary: await realpath(realBinary!), agentsTablePath: await realTable(), timeoutMs: 15_000 });
    const models = [
      { model: "gpt-6-luna", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" },
      { model: "gpt-6-sol", contextWindowTokens: 272000, maxOutputTokens: null, singleCallExecution: "v1-soft" },
    ];
    expect(await port.listModels!("codex", false)).toEqual({ installation: "codex", kind: "codex", source: "probe", observedAt: expect.any(String), models });
    // R4: no Orca-side cache -- the second answer is ccloop's file cache, which says so.
    expect(await port.listModels!("codex", false)).toEqual({ installation: "codex", kind: "codex", source: "cache", observedAt: expect.any(String), models });
    // RF5: ccloop's refusal arrives under its own name (named()), not as an anonymous peer exit.
    await expect(port.listModels!("gone", false)).rejects.toMatchObject({ code: "agent-installation-missing" });
  }, 60_000);
});
