import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";
import { versionOf } from "./fixtures/ccloopWorld.js";

// Wave-2 review I-1 (2026-09-26), against the real ccloop build ORCA_CCLOOP_BIN points at: ccloop lets a deleted agents
// table block nothing but capabilities and accept (ccloop T5 fix I-1, spec §12 I4). That only holds end to end if Orca's
// port can still be built over the deleted path -- the panel builds it once, at assembly. So: accept a run over a table,
// delete the table, build a NEW port over the same (now missing) path, and that port must still inspect and collect the
// run to its end, while capabilities is refused by ccloop as agents-table-invalid.
const realBinary = process.env.ORCA_CCLOOP_BIN;
const roots: string[] = [];
afterAll(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" }).trim();
const amount = (tokens: number, activeMs: number, attempts: number, sessions: number) => ({ tokens, activeMs, attempts, sessions });

describe.skipIf(!realBinary)("the ccloop port over a deleted agents table (real ccloop)", () => {
  it("still inspects and collects an accepted run, and capabilities is refused as agents-table-invalid", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-port-missing-table-")));
    roots.push(root);
    const target = join(root, "target"), sourceDir = join(root, "run");
    await mkdir(target);
    await mkdir(sourceDir, { mode: 0o700 });
    git(target, "init", "-q", "-b", "main");
    await writeFile(join(target, "answer.txt"), "0\n");
    git(target, "add", "answer.txt");
    git(target, "commit", "-qm", "base");
    // The scripted fake codex that ships with the ccloop build (never the real codex).
    const fakeCodex = resolve(dirname(await realpath(realBinary!)), "..", "tests", "fixtures", "fake-codex.mjs");
    const command = [process.execPath, fakeCodex, "integration", join(root, "codex-marker")];
    const table = join(root, "agents.json");
    await writeFile(table, JSON.stringify({ schema: "ccloop-agents-table-v1", installations: {
      codex: { kind: "codex", command, version: versionOf(command), configDir: null, timeoutMs: 60_000, killGraceMs: 1_000, sandbox: "workspace-write", budgetMode: "soft" },
    } }), { mode: 0o600 });

    const before = createCcloopExecutionPort({ binary: await realpath(realBinary!), agentsTablePath: table, timeoutMs: 30_000 });
    const resolution = await before.resolveAgent({ agent: "codex" });
    const contract = {
      objective: { taskId: "T1", goal: "Set answer.txt to 42", successCondition: "answer is 42", nonGoals: [] },
      context: { repoPath: target, targetPaths: ["answer.txt"], relevantDocs: [], buildTestCommands: ["true"], constraints: [] },
      executionPolicy: { autonomyLevel: "L2", maxAttempts: 1, perAttemptTimeoutMs: 30_000, totalRuntimeBudgetMs: 60_000, tokenBudget: 1_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 100 },
      safetyPolicy: { allowlistPaths: ["answer.txt"], denylistPaths: [], maxFilesTouched: 2, humanGateConditions: [] },
      verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
      escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
    };
    const envelope = {
      protocol: 2,
      claim: { groupId: "g", workItemId: "T1", taskId: "T1", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c1",
        configHash: resolution.configHash, agent: resolution.selection, grant: { work: amount(1_000, 60_000, 3, 3), handoff: amount(100, 10_000, 1, 1) }, ownerToken: "owner" },
      contractHash: "b".repeat(64), inputCheckpoint: null,
      work: { contract, targetRepo: target, base: git(target, "rev-parse", "HEAD"), sourceDir },
    } as unknown as StartEnvelope;
    const accepted = await before.accept(envelope);
    expect(accepted.kind).toBe("accepted");

    await unlink(table);
    const after = createCcloopExecutionPort({ binary: await realpath(realBinary!), agentsTablePath: table, timeoutMs: 30_000 });
    const inspected = await after.inspect(envelope);
    expect(["accepted", "stopped"]).toContain(inspected.kind);
    if (accepted.kind === "accepted" && inspected.kind === "accepted") expect(inspected.executionId).toBe(accepted.executionId);
    let report = await after.collect(envelope, 0);
    for (let i = 0; i < 400 && report.terminal === null; i += 1) {
      await new Promise((done) => setTimeout(done, 50));
      report = await after.collect(envelope, 0);
    }
    expect(report.terminal?.outcome).toBe("succeeded");
    await expect(after.resolveAgent({ agent: "codex" })).rejects.toMatchObject({ name: "ControlError", code: "agents-table-invalid" });
    await expect(after.listAgents()).rejects.toMatchObject({ name: "ControlError", code: "agents-table-invalid" });
  }, 60_000);
});
