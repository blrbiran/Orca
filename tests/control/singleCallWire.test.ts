import { mkdtemp, readFile, realpath, writeFile, chmod, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { startEnvelopeSchema } from "../../src/control/schema.js";
import { toSingleCallEnvelope, toStartEnvelope } from "../../src/control/startEnvelope.js";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { dispatchEnvelopeSchema } from "../../src/control/webProtocol.js";
import { readEstimateRecord } from "../../src/control/queries.js";
import { readConfirmedReconcileSlot } from "../../src/control/executionSnapshot.js";
import { WebControlService } from "../../src/control/webService.js";
import { webFixture } from "./fixtures/web.js";

// Single-call estimate spec §4.1 (human ruling S7) and §4.4: the start envelope is protocol 3 only, with a loop or a
// single call as its work, and ccloop's single-call capability travels beside -- never inside -- the seven-key view.
const hx = (v: string) => v.repeat(64);
const amount = (n: number) => ({ tokens: n, activeMs: n, attempts: n, sessions: n });
const zero = { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 };
const claim = {
  groupId: "g", workItemId: "w", taskId: null, runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c",
  configHash: hx("a"), agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }, grant: { work: amount(5), handoff: zero }, ownerToken: "owner",
};
const RESPONSE = { type: "object", properties: {}, required: [], additionalProperties: false };
const loop = { protocol: 3, claim, contractHash: hx("b"), inputCheckpoint: null, work: { kind: "loop", contract: { objective: "ship" }, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" } };
const single = { protocol: 3, claim, contractHash: hx("b"), inputCheckpoint: null, work: { kind: "single-call", prompt: "estimate", responseSchema: RESPONSE, maxOutputTokens: 64_000, sourceDir: "/tmp/src" } };

describe("start envelope protocol 3 (single-call estimate spec §4.1)", () => {
  it("parses a loop and a single call, and nothing else", () => {
    expect(startEnvelopeSchema.safeParse(loop).success).toBe(true);
    expect(startEnvelopeSchema.safeParse(single).success).toBe(true);
    const refused: Array<[string, unknown]> = [
      ["protocol 2, the shape before this round", { ...loop, protocol: 2, work: { contract: { objective: "ship" }, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" } }],
      ["a loop without its kind", { ...loop, work: { contract: {}, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" } }],
      ["an extra key on a loop", { ...loop, work: { ...loop.work, extra: 1 } }],
      ["an extra key on a single call", { ...single, work: { ...single.work, extra: 1 } }],
      ["a single call carrying a contract", { ...single, work: { ...single.work, contract: {} } }],
      ["a response schema whose top is not an object", { ...single, work: { ...single.work, responseSchema: { type: "array" } } }],
      ["no output cap", { ...single, work: { ...single.work, maxOutputTokens: 0 } }],
      ["a single call that resumes a checkpoint", { ...single, inputCheckpoint: { predecessorRunId: "run-0", checkpointId: "cp", checkpointHash: hx("c"), bundlePath: "/tmp/b" } }],
    ];
    for (const [label, value] of refused) expect(startEnvelopeSchema.safeParse(value).success, label).toBe(false);
  });

  it("builds a single-call envelope from an estimate claim: the ledger's contract hash, no checkpoint, the work as given", () => {
    const dispatch = dispatchEnvelopeSchema.parse({
      schema: "orca-dispatch-envelope-v1", phase: "estimate", groupId: "g", workItemId: "w", runId: "run-1", generation: 1, claimIdentity: "estimate:g:w",
      ownerTokenHash: hx("d"), continuationIntentId: null, claimOrdinal: null, derivedContractHash: hx("b"), grants: { work: amount(5), handoff: zero },
      profiles: { estimator: { profileId: "all", profileHash: hx("9") }, worker: null, handoff: null },
    });
    const run = { ...claim, state: "start-pending", estimateId: "w" };
    const built = toSingleCallEnvelope(dispatch, run, { sourceDir: "/tmp/src", prompt: "estimate", responseSchema: RESPONSE, maxOutputTokens: 64_000 });
    expect(built).toEqual(single);
    // A work claim is never turned into a single call.
    const work = dispatchEnvelopeSchema.parse({ ...dispatch, phase: "work", claimOrdinal: 1, profiles: { estimator: null, worker: { profileId: "w", profileHash: hx("9") }, handoff: { profileId: "h", profileHash: hx("9") } } });
    expect(() => toSingleCallEnvelope(work, run, { sourceDir: "/tmp/src", prompt: "estimate", responseSchema: RESPONSE, maxOutputTokens: 64_000 })).toThrow(expect.objectContaining({ code: "start-envelope-conflict", detail: "phase:work" }));
    // And an estimate claim is never turned into a loop.
    expect(() => toStartEnvelope(dispatch, run, { sourceDir: "/tmp/src", targetRepo: "/tmp/repo", base: "v1" }, {})).toThrow(expect.objectContaining({ code: "start-envelope-conflict", detail: "phase:estimate" }));
  });
});

async function peer(extra: Record<string, unknown>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-single-call-wire-")));
  const binary = join(root, "ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), ...extra }), { mode: 0o600 });
  return createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 });
}

describe("singleCallExecution beside the capability view (single-call estimate spec §4.4)", () => {
  it("returns ccloop's answer as given, and refuses an answer without the field", async () => {
    expect((await (await peer({ singleCallExecution: "v1" })).resolveAgent({ agent: "claude" })).singleCallExecution).toBe("v1");
    expect((await (await peer({})).resolveAgent({ agent: "codex" })).singleCallExecution).toBeNull();
    await expect((await peer({ omitSingleCall: true })).resolveAgent({ agent: "codex" })).rejects.toThrow("control-response-invalid");
    // The seven-key view is unchanged: the field is not inside it.
    expect(Object.keys((await (await peer({ singleCallExecution: "v1" })).resolveAgent({ agent: "claude" })).capabilities).sort())
      .toEqual(["budgetEnforcement", "contextObservation", "contextWindowTokens", "handoffControl", "handoffExecution", "requestBoundProof", "usageObservation"]);
  });

  it("never writes it into a frozen slot: not the estimate's (import) and not the reconcile slot (confirm)", async () => {
    const h = await webFixture(); try {
      // planImport.ts froze this slot from a resolution that answered singleCallExecution "v1" (fixtures/agents.ts).
      expect(Object.keys(readEstimateRecord(h.store, "g", h.estimateId).estimatorSlot!).sort())
        .toEqual(["capabilities", "configHash", "killGraceMs", "partial", "provenance", "selection", "timeoutMs"]);
      const confirmed = await new WebControlService(h.deps).confirm(h.command("confirm", await h.confirmPayload()));
      expect("error" in confirmed ? confirmed.error : "confirmed").toBe("confirmed");
      expect(Object.keys(readConfirmedReconcileSlot(h.store, "g")).sort())
        .toEqual(["capabilities", "configHash", "killGraceMs", "partial", "provenance", "selection", "timeoutMs"]);
    } finally { await h.dispose(); }
  });
});
