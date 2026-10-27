/**
 * Multi-directory projects spec §7.2, §11.6, through the real port against the fake ccloop: an extra directory's result
 * repository is `repos/<key>`. C reads it there by that name and never from collect's answer, so the port refuses an
 * answer that names another place instead of dropping `dirs[]` unread (review of H7, Orca session 7753e97d).
 */
import { chmod, copyFile, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";

async function port(resultRepo: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-multi-collect-port-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  const dirs = [{ key: "alpha", resultRepo, changedPaths: [], attemptSha: null }];
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), collectExtra: { dirs } }), { mode: 0o600 });
  const contract = { context: { repoPath: root, additionalRepos: [{ key: "alpha" }] } };
  const envelope = { protocol: 3, claim: { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c", configHash: "a".repeat(64), agent: { agent: "omp", model: "fixture-model", contextWindow: "agent-default" }, grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 } }, ownerToken: "owner" }, contractHash: "b".repeat(64), inputCheckpoint: null,
    work: { kind: "loop", contract, targetRepo: root, base: "HEAD", sourceDir: root, additionalRepos: [{ key: "alpha", targetRepo: join(root, "alpha"), base: "HEAD" }] } } as unknown as StartEnvelope;
  return { port: createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 }), envelope };
}

describe("an extra directory's result repository in collect's answer (§11.6)", () => {
  it("accepts repos/<key>", async () => {
    const h = await port("repos/alpha");
    await expect(h.port.collect(h.envelope, 0)).resolves.toBeDefined();
  });
  it("refuses a result repository other than repos/<key>", async () => {
    const h = await port("repos/beta");
    await expect(h.port.collect(h.envelope, 0)).rejects.toThrow("control-response-invalid");
  });
});
