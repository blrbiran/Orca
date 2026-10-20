import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";

// Agent version auto-refresh spec 2026-10-20 §3.2 (human ruling, session 308b874c: 「组跑到一半遇到 agent 升级 =>
// 直接用新版本继续」). The port is where every ccloop control call goes through, so it is where an agent-version-drift
// refusal turns into: record the version ccloop's probe observes, then ask once more. The stand-in ccloop below keeps
// ccloop's contract -- it refuses a selection whose table version differs from the installed one, and answers
// `agent-installation-observe` from the same installed version -- over a real table file in a temporary directory
// (Rule 17), so the criterion sees what the table holds afterwards and how many times each method was asked.

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

const CAPS = { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null };

async function world(knobs: { observe?: "same" | "none" | "unsupported" | "elsewhere" } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-drift-retry-")));
  roots.push(root);
  const table = join(root, "agents.json"), installed = join(root, "installed.txt"), calls = join(root, "calls.log"), binary = join(root, "ccloop");
  await writeFile(table, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: { codex: { kind: "codex", command: ["/opt/codex"], version: "0.40.0", configDir: null, timeoutMs: 1_800_000, killGraceMs: 5_000 } } }), { mode: 0o600 });
  await writeFile(installed, "0.40.0");
  await writeFile(binary, `#!${process.execPath}
const fs = require("node:fs"), crypto = require("node:crypto");
const knobs = ${JSON.stringify(knobs)};
const [, method, , table] = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, method + "\\n");
let stdin = ""; process.stdin.on("data", (x) => { stdin += x; }); process.stdin.on("end", () => {
  const bytes = fs.readFileSync(table, "utf8"), row = JSON.parse(bytes).installations.codex;
  const installed = fs.readFileSync(${JSON.stringify(installed)}, "utf8");
  const drift = () => { if (row.version !== installed) { process.stderr.write("agent-version-drift: codex: table " + row.version + ", observed " + installed + "\\n"); process.exit(2); } };
  if (method === "features") return process.stdout.write(JSON.stringify(knobs.observe === "unsupported" ? { protocol: 1 } : { protocol: 1, agentInstallationUpdate: "v1" }));
  if (method === "agent-installation-observe") {
    const seen = knobs.observe === "none" ? null : knobs.observe === "same" ? row.version : knobs.observe === "elsewhere" ? installed + "-elsewhere" + fs.readFileSync(${JSON.stringify(calls)}, "utf8").split("\\n").filter((m) => m === "agent-installation-observe").length : installed;
    return process.stdout.write(JSON.stringify({ schema: "orca-agent-detection-observation-v1", baseTableHash: crypto.createHash("sha256").update(bytes).digest("hex"), observedAt: new Date().toISOString(),
      installed: [{ id: "codex", kind: "codex", command: row.command, recordedVersion: row.version, observedVersion: seen, realpath: seen === null ? null : "/opt/codex", status: seen === null ? "unavailable" : seen === row.version ? "current" : "changed" }] }));
  }
  if (method === "capabilities") { drift(); return process.stdout.write(JSON.stringify({ protocol: 3, selection: { agent: "codex", model: "m", contextWindow: "agent-default" }, configHash: "e".repeat(64), timeoutMs: 1800000, killGraceMs: 5000, capabilities: ${JSON.stringify(CAPS)}, singleCallExecution: null })); }
  if (method === "accept") { drift(); return process.stdout.write(JSON.stringify({ kind: "accepted", executionId: "x", configHash: "e".repeat(64) })); }
  process.stderr.write("control-command-invalid\\n"); process.exit(2);
});
`, { mode: 0o700 });
  const logged: string[] = [];
  const port = createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000, log: (line) => { logged.push(line); } });
  const upgrade = (version: string) => writeFile(installed, version);
  const version = async () => (JSON.parse(await readFile(table, "utf8")) as { installations: { codex: { version: string } } }).installations.codex.version;
  const asked = async () => (await readFile(calls, "utf8").catch(() => "")).split("\n").filter(Boolean);
  return { root, table, port, upgrade, version, asked, logged };
}

const envelope = (root: string): StartEnvelope => ({ protocol: 3, claim: { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c", configHash: "e".repeat(64), agent: { agent: "codex", model: "m", contextWindow: "agent-default" }, grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 } }, ownerToken: "o" }, contractHash: "b".repeat(64), inputCheckpoint: null, work: { kind: "loop", contract: { objective: "x", scope: { allowedPaths: ["**"] }, acceptance: { commands: ["true"] } }, targetRepo: root, base: "HEAD", sourceDir: root } });

describe("an agent-version-drift refusal (agent version auto-refresh spec §3.2)", () => {
  it("records the upgraded version and resolves the selection on the one retry", async () => {
    const w = await world();
    await w.upgrade("0.41.0");
    await expect(w.port.resolveAgent({ agent: "codex" })).resolves.toMatchObject({ configHash: "e".repeat(64) });
    expect(await w.version()).toBe("0.41.0");
    expect(await w.asked()).toEqual(["capabilities", "features", "agent-installation-observe", "capabilities"]);
    expect(w.logged).toEqual([expect.stringContaining("codex 0.40.0 -> 0.41.0")]);
  });

  it("lets a start go on under the same configHash once the version is recorded", async () => {
    const w = await world();
    await w.upgrade("0.41.0");
    await expect(w.port.accept(envelope(w.root))).resolves.toEqual({ kind: "accepted", executionId: "x", configHash: "e".repeat(64) });
    expect(await w.version()).toBe("0.41.0");
    expect((await w.asked()).filter((method) => method === "accept")).toHaveLength(2);
  });

  it("keeps the refusal, without a retry, when the probe observes the version the table already has", async () => {
    const w = await world({ observe: "same" });
    await w.upgrade("0.41.0");
    await expect(w.port.resolveAgent({ agent: "codex" })).rejects.toMatchObject({ code: "agent-version-drift" });
    expect(await w.version()).toBe("0.40.0");
    expect((await w.asked()).filter((method) => method === "capabilities")).toHaveLength(1);
  });

  it("keeps the refusal and the table when the probe observes nothing", async () => {
    const w = await world({ observe: "none" });
    await w.upgrade("0.41.0");
    await expect(w.port.resolveAgent({ agent: "codex" })).rejects.toMatchObject({ code: "agent-version-drift" });
    expect(await w.version()).toBe("0.40.0");
    expect((await readdir(w.root)).sort()).toEqual(["agents.json", "calls.log", "ccloop", "installed.txt"]);
    expect(w.logged).toEqual([]);
    expect((await w.asked()).filter((method) => method === "capabilities")).toHaveLength(1);
  });

  it("keeps the refusal when the peer cannot observe installations", async () => {
    const w = await world({ observe: "unsupported" });
    await w.upgrade("0.41.0");
    await expect(w.port.resolveAgent({ agent: "codex" })).rejects.toMatchObject({ code: "agent-version-drift" });
    expect(await w.version()).toBe("0.40.0");
  });

  it("asks once more at most: a retry that drifts again is refused, not looped", async () => {
    // The probe answers a version capabilities never agrees with -- a new one at every observation -- so the retry
    // drifts as well, and a port that refreshed again on it would never stop asking.
    const w = await world({ observe: "elsewhere" });
    await w.upgrade("0.41.0");
    await expect(w.port.resolveAgent({ agent: "codex" })).rejects.toMatchObject({ code: "agent-version-drift" });
    expect(await w.version()).toBe("0.41.0-elsewhere1");
    expect((await w.asked()).filter((method) => method === "capabilities")).toHaveLength(2);
  });
});
