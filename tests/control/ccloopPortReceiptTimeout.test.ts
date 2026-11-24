// Tester #439: under load a worker took 1735 ms to write its receipt and ccloop's control accept waited only 2000 ms, so
// runs were blocked `launch-never-claimed`. ccloop dc8f8cd made the wait settable (CCLOOP_WORKER_RECEIPT_TIMEOUT_MS,
// unset = 2000 ms). Why it matters: unless Orca passes a longer wait, production still gets 2000 ms; and a person who
// set their own value in the panel's environment must get that value, not Orca's. Observed where it counts: in the
// environment the spawned ccloop process itself reads.
import { chmod, copyFile, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import type { StartEnvelope } from "../../src/control/executionPort.js";

async function fixture(env: NodeJS.ProcessEnv) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-receipt-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json"), recordEnv = join(root, "env.json");
  await writeFile(table, JSON.stringify({ mode: "ok", recordEnv }), { mode: 0o600 });
  const port = createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000, env });
  const envelope: StartEnvelope = { protocol: 3, claim: { groupId: "g", workItemId: "w", taskId: "t", runId: "r", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c", configHash: "a".repeat(64), agent: { agent: "codex", model: "fixture-model", contextWindow: "agent-default" }, grant: { work: { tokens: 1, activeMs: 1, attempts: 1, sessions: 1 }, handoff: { tokens: 1, activeMs: 1, attempts: 0, sessions: 0 } }, ownerToken: "owner" }, contractHash: "b".repeat(64), inputCheckpoint: null, work: { kind: "loop", contract: { objective: "ship", scope: { allowedPaths: ["src/**"] }, acceptance: { commands: ["true"] } }, targetRepo: root, base: "HEAD", sourceDir: root } };
  const seen = async () => (JSON.parse(await readFile(recordEnv, "utf8")) as { receiptTimeout: string | null }).receiptTimeout;
  return { port, envelope, seen };
}

/** The panel's environment without the variable, whatever the machine running this test has set. */
function withoutVariable(): NodeJS.ProcessEnv {
  const { CCLOOP_WORKER_RECEIPT_TIMEOUT_MS: _dropped, ...rest } = process.env;
  return rest;
}

describe("every ccloop control process gets a 10 s worker receipt wait unless the panel's environment names one (#439)", () => {
  it("unset: accept (the call that launches the worker) and a call about no run both start ccloop with 10000", async () => {
    const h = await fixture(withoutVariable());
    // mutation: drop the default from the port's child env -> null here, red.
    await h.port.accept(h.envelope);
    expect(await h.seen()).toBe("10000");
    // mutation: add it only for calls about a run (the old env===undefined branch) -> null here, red.
    await h.port.resolveAgent({ agent: "codex" });
    expect(await h.seen()).toBe("10000");
  });

  it("set by the person: their value passes through unchanged, on both kinds of call", async () => {
    const h = await fixture({ ...withoutVariable(), CCLOOP_WORKER_RECEIPT_TIMEOUT_MS: "25000" });
    // mutation: always write 10000 -> "10000" here, red.
    await h.port.accept(h.envelope);
    expect(await h.seen()).toBe("25000");
    await h.port.resolveAgent({ agent: "codex" });
    expect(await h.seen()).toBe("25000");
  });

  it("set but empty counts as unset (ccloop would read it as 2000 ms), so Orca's 10000 applies", async () => {
    const h = await fixture({ ...withoutVariable(), CCLOOP_WORKER_RECEIPT_TIMEOUT_MS: "" });
    // mutation: `?? "10000"` instead of treating "" as unset -> "" here, red.
    await h.port.accept(h.envelope);
    expect(await h.seen()).toBe("10000");
  });
});
