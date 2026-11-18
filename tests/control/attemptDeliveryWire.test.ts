import { chmod, copyFile, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { createCcloopExecutionPort } from "../../src/control/ccloopPort.js";
import { startEnvelopeSchema } from "../../src/control/schema.js";
import { toStartEnvelope } from "../../src/control/startEnvelope.js";
import { dispatchEnvelopeSchema } from "../../src/control/webProtocol.js";

/**
 * Change-sized runs spec 2026-11-19 §6.2 (P0), O6, review I4: Orca's `featuresSchema` and `loopWorkSchema` are strict.
 * A ccloop that advertises `attemptRef` (P1) would make every features probe fail with control-response-invalid, and a
 * stored envelope carrying `work.attemptDelivery` (P2, or a rollback from it) would fail Orca's own parse. So P0 teaches
 * Orca both keys -- and nothing sends the key yet, so every envelope Orca builds keeps its exact bytes and hash.
 */
const hx = (v: string) => v.repeat(64);
const amount = (n: number) => ({ tokens: n, activeMs: n, attempts: n, sessions: n });
const ledger = () => dispatchEnvelopeSchema.parse({
  schema: "orca-dispatch-envelope-v1", phase: "work", groupId: "g1", workItemId: "w1", runId: "run-1", generation: 2,
  claimIdentity: "claim-identity-1", ownerTokenHash: hx("a"), continuationIntentId: null, claimOrdinal: 1, derivedContractHash: hx("b"),
  grants: { work: amount(5), handoff: amount(3) }, profiles: { estimator: null, worker: { profileId: "worker", profileHash: hx("9") }, handoff: { profileId: "handoff", profileHash: hx("9") } },
});
const runRow = {
  groupId: "g1", workItemId: "w1", taskId: "t1", runId: "run-1", generation: 2, graphVersion: 4, targetVersion: 7, commandId: "start-g1-w1",
  configHash: hx("c"), agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }, grant: { work: amount(5), handoff: amount(3) }, ownerToken: "owner-token-1",
};
const work = { sourceDir: "/tmp/src", targetRepo: "/tmp/repo", base: "v1" };
const FEATURES = { protocol: 1, tokenPolicy: "optional-v1", savedResultRecovery: "v1", agentInstallationUpdate: "v1", transcripts: "v1" };
const RECOVERY = { packagePath: "/p", packageHash: hx("c"), admissionHash: hx("d"), recoveryOf: { sourceRunId: "r0", sourceAttempt: 1, capsuleHash: hx("e"), snapshotHash: hx("f"), normalizedExecutionHash: hx("1") } };

async function port(features: Record<string, unknown>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "orca-attempt-delivery-")));
  const binary = join(root, "fake-ccloop");
  await copyFile(resolve("tests/control/fixtures/fake-ccloop-control.mjs"), binary); await chmod(binary, 0o700);
  const table = join(root, "agents.json");
  await writeFile(table, JSON.stringify({ mode: "ok", record: join(root, "record.json"), features }), { mode: 0o600 });
  return createCcloopExecutionPort({ binary, agentsTablePath: table, timeoutMs: 10_000 });
}
const messages = (result: ReturnType<typeof startEnvelopeSchema.safeParse>) => result.success ? [] : result.error.issues.map((issue) => issue.message);

describe("features: attemptRef v1 (change-sized runs §6.2, O6)", () => {
  // M1.1: drop attemptRef from featuresSchema -> the P1 answer is refused (control-response-invalid), red
  it("readFeatures accepts a ccloop that advertises attemptRef v1, and refuses the whole answer for any other value", async () => {
    const advertised = { ...FEATURES, attemptRef: "v1" };
    expect(await (await port(advertised)).readFeatures?.()).toEqual(advertised);
    await expect((await port({ ...FEATURES, attemptRef: "v2" })).readFeatures?.()).rejects.toThrow("control-response-invalid");
    // The dd491c1 answer has no key, and reading it adds none.
    const pinned = await (await port(FEATURES)).readFeatures?.();
    expect(pinned).toEqual(FEATURES);
    expect(Object.hasOwn(pinned ?? {}, "attemptRef")).toBe(false);
  });
});

describe("work.attemptDelivery on the start envelope (change-sized runs §6.2, review I4)", () => {
  // M1.2: `.default("ref-v1")` -> the parsed envelope gains the key and its hash moves, red
  it("a protocol-4 loop envelope with attemptDelivery ref-v1 parses, and parsing never adds the key", () => {
    const built = toStartEnvelope(ledger(), runRow, work, { objective: "ship" });
    expect(Object.hasOwn(built.work, "attemptDelivery")).toBe(false);
    const parsed = startEnvelopeSchema.parse(built);
    expect(parsed).toEqual(built);
    expect(Object.hasOwn(parsed.work, "attemptDelivery")).toBe(false);
    expect(sha256Canonical(parsed)).toBe(sha256Canonical(built));
    const v4 = { ...built, protocol: 4, work: { ...built.work, attemptDelivery: "ref-v1" } };
    const keyed = startEnvelopeSchema.safeParse(v4);
    expect(messages(keyed)).toEqual([]);
    expect(keyed.success && keyed.data).toEqual(v4);
  });

  // M1.3 drop the protocol-4 issue; M1.4 drop the mode issue; M1.5 z.string() instead of the literal -- each red here
  it("attemptDelivery is refused on protocol 3, beside mode verify-saved-result, and with any other value", () => {
    const built = toStartEnvelope(ledger(), runRow, work, { objective: "ship" });
    const onProtocol3 = startEnvelopeSchema.safeParse({ ...built, protocol: 3, work: { ...built.work, attemptDelivery: "ref-v1" } });
    expect(onProtocol3.success).toBe(false);
    expect(messages(onProtocol3)).toContain("attempt-delivery-requires-protocol4");
    const recovery = { ...built, protocol: 4, mode: "verify-saved-result", savedResultRecovery: RECOVERY };
    expect(startEnvelopeSchema.safeParse(recovery).success).toBe(true);
    const besideMode = startEnvelopeSchema.safeParse({ ...recovery, work: { ...recovery.work, attemptDelivery: "ref-v1" } });
    expect(besideMode.success).toBe(false);
    expect(messages(besideMode)).toContain("attempt-delivery-with-saved-result");
    const otherValue = startEnvelopeSchema.safeParse({ ...built, protocol: 4, work: { ...built.work, attemptDelivery: "ref-v2" } });
    expect(otherValue.success).toBe(false);
    expect(otherValue.success ? [] : otherValue.error.issues.map((issue) => issue.code)).toContain("invalid_literal");
  });
});
