/**
 * Flow engine spec §9.6, §21 C16 effect part (BC-B4): an effect-classed step runs once. Its derived contract has
 * `maxAttempts: 1` (an upload retried by a loop would upload twice), no default "changed a path" gate (an upload may
 * change no file), template gates still apply, and the prompt carries the effect record id as the idempotency key and
 * as `--confirmed-by-orca '<id>'` -- without it the agent stops before the side effect (§4.3 rule 2).
 */
import { describe, expect, it } from "vitest";
import { buildFlowStepPlanSource, DEFAULT_CHANGED_GATE, NO_OP_GATE } from "../../src/control/flowStepPlan.js";
import { deriveContract } from "../../src/control/executionSnapshot.js";
import { childWorkAmount } from "../../src/flow/pool.js";
import { flowStepSchema, type FlowStep } from "../../src/flow/template/schema.js";

const effectStep = (extra: Record<string, unknown> = {}): FlowStep => flowStepSchema.parse({ id: "upload", kind: "work", prompt: "p.md", effect: "wechat-draft", ...extra });
const build = (step: FlowStep, gates: string[] = [], effectRecordId: string | null = "eff-42") => buildFlowStepPlanSource({
  flowRunId: "fr-1", step, seq: 3, baseCommit: "b".repeat(40), vaultPath: "/vault/x.git", promptEnvelope: "Upload the draft.\n", gates, effectRecordId,
});

describe("effect steps execute once (C16)", () => {
  it("the contract and the derived contract have maxAttempts 1", () => {
    const task = build(effectStep()).tasks[0]!;
    expect(JSON.parse(task.originalContractCanonicalJson).executionPolicy.maxAttempts).toBe(1);
    const work = childWorkAmount(effectStep(), 100_000);
    expect(work.attempts).toBe(1);
    const derived = deriveContract({ ...task, work, handoff: { tokens: 0, activeMs: 1, attempts: 0, sessions: 0 } } as never, 1);
    expect(JSON.parse(derived.contractCanonicalJson).executionPolicy.maxAttempts).toBe(1);
  });
  it("a plain work step keeps today's attempts", () => {
    const plain = flowStepSchema.parse({ id: "w", kind: "work", prompt: "p.md" });
    expect(JSON.parse(build(plain, [], null).tasks[0]!.originalContractCanonicalJson).executionPolicy.maxAttempts).toBeGreaterThan(1);
    expect(childWorkAmount(plain, 100_000).attempts).toBeGreaterThan(1);
  });
  it("has no default changed-path gate: the no-op gate when the template has none, the template's gates otherwise", () => {
    const none = JSON.parse(build(effectStep()).tasks[0]!.originalContractCanonicalJson);
    expect(none.verification.requiredChecks).toEqual([NO_OP_GATE]);
    expect(none.verification.requiredChecks).not.toContain(DEFAULT_CHANGED_GATE("b".repeat(40)));
    const gated = JSON.parse(build(effectStep(), ["test -f sent.json"]).tasks[0]!.originalContractCanonicalJson);
    expect(gated.verification.requiredChecks).toEqual(["test -f sent.json"]);
  });
  it("the prompt carries the record id as idempotency key and as --confirmed-by-orca", () => {
    const goal = JSON.parse(build(effectStep()).tasks[0]!.originalContractCanonicalJson).objective.goal as string;
    expect(goal).toContain("--confirmed-by-orca 'eff-42'");
    expect(goal).toContain("idempotency key");
    // T18: an effect that did not happen is reported as such (no flow.effect), never replaced by a stand-in.
    expect(goal).toContain("report no flow.effect");
  });
  it("an effect step without a record id is refused, not run unconfirmed", () => {
    expect(() => build(effectStep(), [], null)).toThrow(/effect-record-missing/);
  });
});
