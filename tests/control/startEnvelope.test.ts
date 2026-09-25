import { describe, expect, it } from "vitest";
import { toStartEnvelope } from "../../src/control/startEnvelope.js";
import { dispatchEnvelopeSchema, type DispatchEnvelopeV1 } from "../../src/control/webProtocol.js";
import { ControlError } from "../../src/control/errors.js";

/**
 * Assembly plan Task 4. The ledger's frozen `DispatchEnvelopeV1` is what a dispatch is charged
 * against; the port speaks `StartEnvelope`. These judge the translation between them field by
 * field against what the ledger wrote, never by round-tripping through the same function.
 */

const hx = (v: string) => v.repeat(64);
const amount = (n: number) => ({ tokens: n, activeMs: n, attempts: n, sessions: n });
const binding = (id: string) => ({ profileId: id, profileHash: hx("9") });

function ledgerEnvelope(over: Partial<DispatchEnvelopeV1> = {}): DispatchEnvelopeV1 {
  return dispatchEnvelopeSchema.parse({
    schema: "orca-dispatch-envelope-v1",
    phase: "work",
    groupId: "g1",
    workItemId: "w1",
    runId: "run-1",
    generation: 2,
    claimIdentity: "claim-identity-1",
    ownerTokenHash: hx("a"),
    continuationIntentId: null,
    claimOrdinal: 1,
    derivedContractHash: hx("b"),
    grants: { work: amount(5), handoff: amount(3) },
    profiles: { estimator: null, worker: binding("worker"), handoff: binding("handoff") },
    ...over,
  });
}

/** A run row as the store writes it, extra fields and all -- the translator must tolerate those. */
const runRow = (over: Record<string, unknown> = {}) => ({
  groupId: "g1", workItemId: "w1", taskId: "t1", runId: "run-1", generation: 2,
  graphVersion: 4, targetVersion: 7, commandId: "start-g1-w1", configHash: hx("c"),
  agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 },
  grant: { work: amount(5), handoff: amount(3) }, ownerToken: "owner-token-1",
  state: "running", recoverable: false, highWater: 0,
  ...over,
});

const work = { sourceDir: "/tmp/src", targetRepo: "/tmp/repo", base: "v1" };
const contract = { objective: "ship" };

describe("translating a frozen dispatch envelope into a start envelope", () => {
  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): StartEnvelopeV2 -- protocol 2,
  // and the run's frozen selection travels in the claim (spec §4.6).
  it("copies the claim from the run row and the contract hash from the ledger, field by field", () => {
    const built = toStartEnvelope(ledgerEnvelope(), runRow(), work, contract);
    expect(built.protocol).toBe(2);
    expect(built.claim).toEqual({
      groupId: "g1", workItemId: "w1", taskId: "t1", runId: "run-1", generation: 2,
      graphVersion: 4, targetVersion: 7, commandId: "start-g1-w1", configHash: hx("c"),
      agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 },
      grant: { work: amount(5), handoff: amount(3) }, ownerToken: "owner-token-1",
    });
    // Named separately from the deep-equal above: this is the one field that comes from the ledger
    // rather than the run, and it is the one a recomputation would quietly change.
    expect(built.contractHash).toBe(hx("b"));
    expect(built.inputCheckpoint).toBe(null);
    expect(built.work).toEqual({ contract, targetRepo: "/tmp/repo", base: "v1", sourceDir: "/tmp/src" });
  });

  // Rewritten for agent selection (2026-09-26, human ruling: "同意修改几个仓库的现有test"): `agent` is a claim field now.
  it("drops the run row's own extra columns instead of smuggling them onto the wire", () => {
    const built = toStartEnvelope(ledgerEnvelope(), runRow(), work, contract);
    expect(Object.keys(built.claim).sort()).toEqual(
      ["agent", "commandId", "configHash", "generation", "grant", "graphVersion", "groupId", "ownerToken", "runId", "targetVersion", "taskId", "workItemId"],
    );
  });

  it("translates a handoff-phase envelope with the same claim and the same ledger hash", () => {
    const handoff = ledgerEnvelope({ phase: "handoff", continuationIntentId: null, profiles: { estimator: null, worker: null, handoff: binding("handoff") } });
    const built = toStartEnvelope(handoff, runRow(), work, contract);
    expect(built.contractHash).toBe(hx("b"));
    expect(built.claim.runId).toBe("run-1");
  });

  it("carries a continuation's ledger hash rather than the predecessor's", () => {
    const continued = ledgerEnvelope({ continuationIntentId: "intent-1", derivedContractHash: hx("d") });
    expect(toStartEnvelope(continued, runRow(), work, contract).contractHash).toBe(hx("d"));
  });
});

describe("the translation refuses before anything is dispatched", () => {
  const codeOf = (fn: () => unknown): string => {
    try { fn(); return "<resolved>"; } catch (error) { return error instanceof ControlError ? `${error.code}|${error.detail}` : String(error); }
  };

  it("refuses a stored envelope whose phase and profile slots disagree, naming the schema", () => {
    // Built past the schema on purpose: this is a ledger row that no longer parses, and the point
    // is that it is refused rather than dispatched because it parsed once.
    const broken = { ...ledgerEnvelope(), profiles: { estimator: binding("est"), worker: null, handoff: null } } as DispatchEnvelopeV1;
    expect(codeOf(() => toStartEnvelope(broken, runRow(), work, contract))).toMatch(/^start-envelope-conflict\|schema:/);
  });

  it("refuses a run row missing a claim field, rather than dispatching the string \"undefined\"", () => {
    const { ownerToken, ...without } = runRow();
    expect(ownerToken).toBe("owner-token-1");
    expect(codeOf(() => toStartEnvelope(ledgerEnvelope(), without, work, contract))).toBe("start-envelope-conflict|run:ownerToken");
  });

  it("refuses a run row with no frozen selection, naming the field, rather than dispatching a claim without one", () => {
    // Plan P23 m2: no assertion reads back the agent this test itself wrote into runRow().
    const { agent: _agent, ...without } = runRow();
    expect(codeOf(() => toStartEnvelope(ledgerEnvelope(), without, work, contract))).toBe("start-envelope-conflict|run:agent");
    // A partial selection is not a frozen one: ccloop would fill the rest, and the claim would no longer say what ran.
    expect(codeOf(() => toStartEnvelope(ledgerEnvelope(), runRow({ agent: { agent: "claude" } }), work, contract))).toMatch(/^start-envelope-conflict\|run:agent/);
  });

  it("refuses when the envelope and the run name different runs", () => {
    expect(codeOf(() => toStartEnvelope(ledgerEnvelope(), runRow({ runId: "run-2" }), work, contract)))
      .toBe("start-envelope-conflict|identity:run-1");
  });

  it("refuses when they disagree about the generation, not only the run id", () => {
    // A stale generation is the same claim's earlier life; charging this dispatch to it is how work
    // lands against a grant that was already settled.
    expect(codeOf(() => toStartEnvelope(ledgerEnvelope(), runRow({ generation: 1 }), work, contract)))
      .toBe("start-envelope-conflict|identity:run-1");
  });

  it("touches no port: the refusals above are pure, so nothing can have been sent", () => {
    // The strongest form available for a pure function -- it takes no port, so there is no call to
    // count. Named so that a later signature change that hands it one is judged, not assumed.
    expect(toStartEnvelope.length).toBe(4);
  });
});
