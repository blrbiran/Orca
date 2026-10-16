import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { buildEstimatePrompt, estimateTaskIds } from "../../src/control/estimatePrompt.js";
import { decideEstimateRetry, retryPromptFits, type RetryInput } from "../../src/control/estimateRetry.js";
import { ESTIMATE_GRANT, readEstimateContract } from "../../src/control/estimator.js";
import { stepA1 } from "../../src/control/executionDriver.js";
import { readBudgetProposal, readEstimateRecord, type EstimateRecord } from "../../src/control/queries.js";
import { writeCanonicalRecord } from "../../src/control/snapshot.js";
import { recordUsage } from "../../src/control/usage.js";
import { completeEstimateInStore, readWebGroup } from "../../src/control/webService.js";
import { estimateExecutionContractSchema } from "../../src/control/webProtocol.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { estimateHarness, estimateOutput } from "./fixtures/estimateHarness.js";

// Estimate usable-answer spec §4.3: an estimate whose answer could not be used -- not one whose transport failed --
// gets exactly one automatic retry that tells the model what was wrong, decided by code inside the failed estimate's
// settlement. Every condition that rules the retry out is recorded by name on the failed estimate, and the settlement
// still commits: a decision that threw would leave the estimate `running`, re-driven (and re-paid) every round.
type Harness = Awaited<ReturnType<typeof estimateHarness>>;
type Options = Parameters<typeof estimateHarness>[0];

/** An answer repair cannot save: it is about task b only, so the plan's task a is missing (estimate-output-invalid). */
const missingTask = (planHash: string) => ({ ...estimateOutput(planHash), tasks: [{ ...estimateOutput(planHash).tasks[0], taskId: "b" }] });

/** Each call answers with the next entry (the last one repeats): the first call is the failed estimate, the second its retry. */
async function harness(answers: Array<(planHash: string) => unknown>, extra: Options = {}): Promise<Harness> {
  let x: Harness | undefined;
  x = await estimateHarness({ ...extra, output: planHash => answers[Math.min((x?.fake.calls.accept.length ?? 1) - 1, answers.length - 1)]!(planHash) });
  return x;
}
const settle = async (x: Harness) => { await x.rounds(() => x.estimate().state !== "running"); return x.estimate(); };
const estimates = (x: Harness): EstimateRecord[] =>
  x.h.store.db.prepare("SELECT id FROM estimates WHERE group_id='g' ORDER BY estimate_version").all().map(row => readEstimateRecord(x.h.store, "g", String(row.id)));
const estimateWakes = (x: Harness) => x.h.store.db.prepare("SELECT id,body,delivered FROM scheduler_wakes WHERE group_id='g' AND kind='budget-estimate' ORDER BY rowid").all()
  .map(row => ({ id: String(row.id), body: JSON.parse(String(row.body)), delivered: Number(row.delivered) }));
/** Pending wakes other than the import's own (the harness claims that estimate directly, so its wake stays pending). */
const undeliveredWakes = (x: Harness) => estimateWakes(x).filter(wake => wake.delivered === 0 && wake.body.estimateId !== x.h.estimateId);
const expectedRetryId = (failedId: string) => `estimate-${sha256Canonical({ groupId: "g", retryOf: failedId }).slice(0, 24)}`;

/** Claims the queued retry as the wake would, then drives the driver until it settles. */
async function driveRetry(x: Harness, retryId: string): Promise<EstimateRecord> {
  const run = await x.service.claimEstimate("g", retryId);
  if (run === null) throw new Error("the retry was not claimed");
  const retry = () => readEstimateRecord(x.h.store, "g", retryId);
  for (let i = 0; i < 30 && ["queued", "running"].includes(retry().state); i += 1) await x.driver.round();
  return retry();
}

/** Settles the claimed estimate directly (as Ce does) with this raw answer, after A1 and booked usage. */
function settleDirect(x: Harness, raw: unknown, options: { classify?: Parameters<typeof completeEstimateInStore>[5]; callFailure?: string | null; prepared?: boolean } = {}): void {
  if (!options.prepared) {
    expect(stepA1(x.deps, x.runId)).toBe(true);
    recordUsage(x.h.store, { runId: x.runId, generation: 1, eventSeq: 1, bucket: "work", cumulative: { tokens: 1_234, activeMs: 50, attempts: 1, sessions: 1 }, source: { artifactId: "usage-retry", hash: "e".repeat(64) } });
  }
  completeEstimateInStore({ store: x.h.store, admissionGate: x.h.deps.admissionGate }, "g", x.h.estimateId, raw, () => {
    const row = x.body(); row.state = "settled-restartable";
    x.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(row), x.runId);
  }, options.classify, options.callFailure ?? null);
}

/** Replaces the estimate's frozen contract with a patched copy (a profile frozen with another tokenizer or window). */
function rewriteContract(x: Harness, patch: Record<string, unknown>): void {
  const contract = estimateExecutionContractSchema.parse({ ...readEstimateContract(x.h.store, "g", x.h.estimateId), ...patch });
  const contractHash = sha256Canonical(contract);
  writeCanonicalRecord(x.h.store, "g", contractHash, canonicalBytes(contract).toString("utf8"));
  const id = `estimate-contract:g:${x.h.estimateId}`;
  const binding = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM outbox WHERE id=?").get(id)!.body));
  x.h.store.db.prepare("UPDATE outbox SET body=? WHERE id=?").run(canonicalBytes({ ...binding, contractHash }).toString("utf8"), id);
}

/** Raises the group limit and its unallocated reserve by two grants in every dimension (a group imported with a larger limit). */
function widenBudget(x: Harness): void {
  const proposal = readBudgetProposal(x.h.store, "g");
  const group = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
  const reserveRow = proposal.allocations.find(a => a.ownerKind === "reserve")!;
  for (const d of ["tokens", "activeMs", "attempts", "sessions"] as const) {
    const more = 2 * ESTIMATE_GRANT[d];
    proposal.groupLimit[d]! += more; proposal.explicitUnallocatedReserve[d]! += more; reserveRow.amount[d]! += more;
    group.limit[d] += more; group.ledger.groupLimit[d] += more; group.ledger.explicitUnallocatedReserve[d] += more;
  }
  x.h.store.db.prepare("UPDATE budget_proposals SET body=? WHERE group_id='g'").run(canonicalBytes(proposal).toString("utf8"));
  x.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(group));
}

/** The settlement committed, the estimate failed with the skip recorded, and no retry row or wake was written. */
function expectSkipped(x: Harness, code: string): void {
  expect(x.estimate()).toMatchObject({ state: "failed", retrySkipped: code });
  expect(x.estimate().retriedAs).toBeUndefined();
  expect(estimates(x).map(e => e.estimateId)).toEqual([x.h.estimateId]);
  expect(undeliveredWakes(x)).toEqual([]);
  expect(x.h.store.db.prepare("SELECT id FROM outbox WHERE id=?").get(`estimate-result:g:${x.h.estimateId}`)).toBeDefined();
}

describe("the automatic estimate retry (estimate usable-answer spec §4.3)", () => {
  it("queues one retry for an unrepairable answer, and a retry that fails again gets no third call", async () => {
    const x = await harness([missingTask]); try {
      const failed = await settle(x);
      const retryId = expectedRetryId(x.h.estimateId);
      expect(failed).toMatchObject({ state: "failed", reasonCode: "estimate-output-invalid", retriedAs: retryId });
      expect(failed.retrySkipped).toBeUndefined();
      const [, retry] = estimates(x);
      expect(retry).toMatchObject({ estimateId: retryId, estimateVersion: 2, state: "queued", request: failed.request, requestHash: failed.requestHash,
        profile: failed.profile, mode: failed.mode, estimatorSlot: failed.estimatorSlot, proposalVersion: 1, grant: ESTIMATE_GRANT, origin: { kind: "auto-retry", of: x.h.estimateId } });
      expect(retry!.origin!.problems.length).toBeGreaterThan(0);
      expect(retry!.origin!.problems).toContain("task-missing:a");
      expect(retry!.retriedAs).toBeUndefined();
      // Exactly one new wake, for the retry. Its grant is reserved like any queued estimate's: the claim below re-checks
      // that the group's reserved amount is exactly its commitments (assertKnownConservation), the retry's grant included.
      expect(undeliveredWakes(x)).toEqual([{ id: `scheduler-wake:g:estimate:${retryId}`, body: { groupId: "g", estimateId: retryId, planHash: failed.request!.planHash }, delivered: 0 }]);
      // The retry's contract is the old one plus the problems; nothing else changes.
      const { retryProblems, ...rest } = readEstimateContract(x.h.store, "g", retryId);
      expect(retryProblems).toEqual(retry!.origin!.problems);
      expect(rest).toEqual(readEstimateContract(x.h.store, "g", x.h.estimateId));

      const settled = await driveRetry(x, retryId);
      expect(settled).toMatchObject({ state: "failed", reasonCode: "estimate-output-invalid" });
      expect(settled.retriedAs).toBeUndefined();
      expect(settled.retrySkipped).toBeUndefined();
      // Two single calls, not three: a retry is never retried (anti-goal A2).
      expect(x.fake.calls.accept).toHaveLength(2);
      expect(estimates(x)).toHaveLength(2);
      // No new wake: only the retry's own (claimed directly above, so still marked pending) remains.
      expect(undeliveredWakes(x).map(wake => wake.body.estimateId)).toEqual([retryId]);
      for (let i = 0; i < 3; i += 1) await x.driver.round();
      expect(x.fake.calls.accept).toHaveLength(2);
    } finally { await x.h.dispose(); }
  });

  it("tells the model what was wrong: the retry's prompt carries the feedback paragraph with the problems", async () => {
    const x = await harness([missingTask, estimateOutput]); try {
      const failed = await settle(x);
      const retry = estimates(x)[1]!;
      await driveRetry(x, retry.estimateId);
      const problems = retry.origin!.problems;
      const prompt = (x.fake.calls.accept[1]!.work as { prompt: string }).prompt;
      expect(prompt).toBe(buildEstimatePrompt("1", canonicalBytes(failed.request).toString("utf8"), { taskIds: estimateTaskIds(failed.request!), retryProblems: problems }));
      expect(prompt).toContain(`\n\nYour previous answer was rejected for these problems:\n${problems.join("\n")}\nAnswer again with one JSON object that fixes all of them.`);
      // The first call's prompt had no feedback.
      expect((x.fake.calls.accept[0]!.work as { prompt: string }).prompt).not.toContain("Your previous answer was rejected");
    } finally { await x.h.dispose(); }
  });

  it("settles a good second answer ready, and the panel's current (newest) estimate is the retry", async () => {
    const x = await harness([missingTask, estimateOutput]); try {
      await settle(x);
      const retryId = estimates(x)[1]!.estimateId;
      expect(await driveRetry(x, retryId)).toMatchObject({ state: "ready", reasonCode: null, origin: { of: x.h.estimateId } });
      const view = readControlGroup(x.h.store, "epoch", "g");
      const newest = view.estimates.reduce((a, b) => (b.estimateVersion > a.estimateVersion ? b : a));
      expect(newest).toMatchObject({ estimateId: retryId, state: "ready", origin: { kind: "auto-retry", of: x.h.estimateId } });
      expect(view.estimates.find(e => e.estimateId === x.h.estimateId)).toMatchObject({ state: "failed", retriedAs: retryId });
      expect(x.fake.calls.accept).toHaveLength(2);
    } finally { await x.h.dispose(); }
  });

  it("retries a call ccloop read no JSON object from, with no-json-object and the cut-off hint", async () => {
    const x = await harness([estimateOutput], { outcome: "failed", errorCode: "single-call-output-invalid" }); try {
      const failed = await settle(x);
      expect(failed).toMatchObject({ state: "failed", reasonCode: "estimate-call-failed:single-call-output-invalid", retriedAs: expectedRetryId(x.h.estimateId) });
      const retry = estimates(x)[1]!;
      expect(retry.origin!.problems).toEqual(["no-json-object"]);
      await driveRetry(x, retry.estimateId);
      expect((x.fake.calls.accept[1]!.work as { prompt: string }).prompt).toContain("no-json-object\nAnswer again with one JSON object that fixes all of them. Your answer may have been cut off");
    } finally { await x.h.dispose(); }
  });

  it.each(["codex-rate-limited", "single-call-timeout"])("never retries a transport failure (%s) and records no skip", async errorCode => {
    const x = await harness([estimateOutput], { outcome: "failed", errorCode }); try {
      const failed = await settle(x);
      expect(failed).toMatchObject({ state: "failed", reasonCode: `estimate-call-failed:${errorCode}` });
      expect(failed.retriedAs).toBeUndefined();
      expect(failed.retrySkipped).toBeUndefined();
      expect(estimates(x)).toHaveLength(1);
      expect(undeliveredWakes(x)).toEqual([]);
    } finally { await x.h.dispose(); }
  });

  it("carries the classifier's refusal of a repaired answer as the problems (field issues, or output-not-canonical)", async () => {
    const x = await estimateHarness(); try {
      const planHash = readBudgetProposal(x.h.store, "g").planHash;
      // A negative zero passes the schema but cannot be hashed: invalid, with output-not-canonical.
      settleDirect(x, { ...estimateOutput(planHash), goalReviewReserve: { tokens: -0, activeMs: 100, attempts: 1, sessions: 1 } });
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode: "estimate-output-invalid" });
      const retry = estimates(x)[1]!;
      expect(retry.origin!.problems).toContain("output-not-canonical");
    } finally { await x.h.dispose(); }
    const y = await estimateHarness(); try {
      const planHash = readBudgetProposal(y.h.store, "g").planHash;
      // Repair passes an empty group rationale through; the classifier refuses it by field.
      settleDirect(y, { ...estimateOutput(planHash), groupRationale: "" });
      expect(y.estimate()).toMatchObject({ state: "failed", reasonCode: "estimate-output-invalid" });
      expect(estimates(y)[1]!.origin!.problems.some(p => p.startsWith("field-invalid:groupRationale"))).toBe(true);
    } finally { await y.h.dispose(); }
  });

  it("names a repaired answer the classifier finds about another plan plan-mismatch, and retries it", async () => {
    const x = await estimateHarness(); try {
      const planHash = readBudgetProposal(x.h.store, "g").planHash;
      settleDirect(x, estimateOutput(planHash), { classify: () => ({ ok: false, reasonCode: "estimate-output-plan-mismatch" }) });
      expect(x.estimate()).toMatchObject({ state: "failed", reasonCode: "estimate-output-plan-mismatch", retriedAs: expectedRetryId(x.h.estimateId) });
      expect(estimates(x)[1]!.origin!.problems).toEqual(["plan-mismatch"]);
    } finally { await x.h.dispose(); }
  });

  it("writes exactly one retry when the settlement is replayed (the receipt returns early), under the id derived from the failed estimate", async () => {
    const x = await estimateHarness(); try {
      const planHash = readBudgetProposal(x.h.store, "g").planHash;
      settleDirect(x, missingTask(planHash));
      settleDirect(x, missingTask(planHash), { prepared: true });
      const all = estimates(x);
      expect(all.map(e => e.estimateId)).toEqual([x.h.estimateId, expectedRetryId(x.h.estimateId)]);
      expect(all[0]!.retriedAs).toBe(expectedRetryId(x.h.estimateId));
      expect(undeliveredWakes(x)).toHaveLength(1);
    } finally { await x.h.dispose(); }
  });
});

describe("each condition that rules the retry out is recorded on the failed estimate (spec §4.3 Never throws)", () => {
  // A soft overrun past the group limit leaves a deficit -- and, like any breach of a grant, blocks the group (usage.ts),
  // which the spec's order names first. What this pins is that the decision did not throw: the settlement committed,
  // the estimate is failed (not running, re-driven every round), and no retry was queued. budget-deficit by itself is
  // pinned by the decideEstimateRetry criteria below.
  it("a soft overrun past the group limit (a deficit) still commits the settlement, failed and not running, with no retry", async () => {
    const x = await harness([missingTask], { tokens: 50_000_000 }); try {
      await settle(x);
      expect(readWebGroup(x.h.store, "g").ledger.budgetDeficit.tokens).toBeGreaterThan(0);
      expect(readWebGroup(x.h.store, "g").status).toBe("blocked");
      expectSkipped(x, "group-not-prestart");
      expect(x.body().state).toBe("settled-restartable");
    } finally { await x.h.dispose(); }
  });

  it("proposal-changed: the person edited the proposal while the call ran", async () => {
    let x!: Harness;
    x = await harness([missingTask], { duringCollect: async () => {
      expect(x.service.editProposal(x.h.command("proposal-edit", { baseProposalVersion: 1, operations: [{ target: { scope: "goal-review", dimension: "tokens" }, value: 900_000, provenance: "human" }] })))
        .toMatchObject({ result: { proposalVersion: 2 } });
    } }); try {
      await settle(x);
      expectSkipped(x, "proposal-changed");
    } finally { await x.h.dispose(); }
  });

  it("reserve-insufficient: the reserve left after settlement cannot hold another grant", async () => {
    let x!: Harness;
    x = await harness([missingTask], { duringCollect: async () => {
      const reserve = readBudgetProposal(x.h.store, "g").explicitUnallocatedReserve.tokens!;
      const review = readBudgetProposal(x.h.store, "g").allocations.find(a => a.ownerKind === "goal-review")!.amount.tokens!;
      expect(x.service.editProposal(x.h.command("proposal-edit", { baseProposalVersion: 1, operations: [{ target: { scope: "goal-review", dimension: "tokens" }, value: review + reserve, provenance: "human" }] })))
        .toMatchObject({ result: { proposalVersion: 2 } });
    } }); try {
      await settle(x);
      // The settlement returned only the call's unused grant, which is less than a whole grant.
      expect(readBudgetProposal(x.h.store, "g").explicitUnallocatedReserve.tokens).toBeLessThan(ESTIMATE_GRANT.tokens);
      expectSkipped(x, "reserve-insufficient");
    } finally { await x.h.dispose(); }
  });

  it("superseded: the person's newer estimate is already queued", async () => {
    let x!: Harness;
    x = await harness([missingTask], { duringCollect: async () => {
      // A group whose reserve holds two more grants, so the person's estimate leaves room for a retry (reserve is checked first).
      widenBudget(x);
      expect(await x.service.createEstimate(x.h.command("estimate", { proposalVersion: 1, estimatorProfileId: "all", estimatorProfileHash: x.h.frozen.profileHash, estimateMode: "soft" })))
        .toMatchObject({ result: { kind: "estimate-created", estimateVersion: 2, estimateState: "queued" } });
    } }); try {
      await settle(x);
      expect(x.estimate()).toMatchObject({ state: "failed", retrySkipped: "superseded" });
      expect(estimates(x).map(e => e.origin)).toEqual([undefined, undefined]);
    } finally { await x.h.dispose(); }
  });

  it("proposal-unknown: an estimate row written before proposalVersion existed", async () => {
    const x = await harness([missingTask]); try {
      const row = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(x.h.estimateId)!.body));
      delete row.proposalVersion;
      x.h.store.db.prepare("UPDATE estimates SET body=? WHERE group_id='g' AND id=?").run(canonicalBytes(row).toString("utf8"), x.h.estimateId);
      await settle(x);
      expectSkipped(x, "proposal-unknown");
    } finally { await x.h.dispose(); }
  });

  it("tokenizer-unavailable: a profile frozen with an exact tokenizer (the settlement has no token counter)", async () => {
    const x = await harness([missingTask]); try {
      rewriteContract(x, { tokenizer: { kind: "exact", tokenizerId: "t", tokenizerVersion: "1" } });
      await settle(x);
      expectSkipped(x, "tokenizer-unavailable");
    } finally { await x.h.dispose(); }
  });

  it("input-too-large: the prompt with the feedback no longer fits the frozen window", async () => {
    const x = await harness([missingTask]); try {
      const contract = readEstimateContract(x.h.store, "g", x.h.estimateId), request = x.estimate().request!;
      const { numerator, denominator } = contract.tokenizer as { numerator: number; denominator: number };
      const bytes = Buffer.byteLength(buildEstimatePrompt(contract.instructionVersion, canonicalBytes(request).toString("utf8"), { taskIds: estimateTaskIds(request) }), "utf8");
      // A window that holds the first call's prompt exactly and nothing more.
      const window = Math.ceil(bytes * numerator / denominator) + contract.framingTokenOverhead + contract.maxOutputTokens;
      rewriteContract(x, { estimatorCapabilities: { ...contract.estimatorCapabilities, contextWindowTokens: window } });
      expect(retryPromptFits({ ...contract, estimatorCapabilities: { ...contract.estimatorCapabilities, contextWindowTokens: window } }, request, [])).toBe(true);
      await settle(x);
      expectSkipped(x, "input-too-large");
    } finally { await x.h.dispose(); }
  });

  it("group-not-prestart: the group was stopped", async () => {
    let x!: Harness;
    x = await harness([missingTask], { duringCollect: async () => {
      const group = JSON.parse(String(x.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
      x.h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...group, stopped: true }));
    } }); try {
      await settle(x);
      expectSkipped(x, "group-not-prestart");
    } finally { await x.h.dispose(); }
  });
});

describe("decideEstimateRetry is total and ordered (spec §4.3)", () => {
  const base = async () => {
    const x = await harness([missingTask]);
    const estimate = { ...x.estimate(), proposalVersion: 1 };
    const input: RetryInput = { estimate, contract: readEstimateContract(x.h.store, "g", x.h.estimateId),
      failure: { reasonCode: "estimate-output-invalid", problems: ["task-missing:a"] }, group: readWebGroup(x.h.store, "g"),
      proposalVersion: 1, newestEstimateVersion: 1, reserveAfterSettlement: { tokens: null, activeMs: 10_000_000, attempts: 10, sessions: 10 }, dispatchBlocked: false };
    return { x, input };
  };

  it("retries by default and answers none for no failure, a non-retryable code, empty problems or a retry", async () => {
    const { x, input } = await base(); try {
      expect(decideEstimateRetry(input)).toEqual({ kind: "retry", problems: ["task-missing:a"] });
      expect(decideEstimateRetry({ ...input, failure: null })).toEqual({ kind: "none" });
      expect(decideEstimateRetry({ ...input, failure: { reasonCode: "estimate-call-failed:codex-rate-limited", problems: [] } })).toEqual({ kind: "none" });
      expect(decideEstimateRetry({ ...input, failure: { reasonCode: "estimate-call-failed", problems: [] } })).toEqual({ kind: "none" });
      // The trigger is the reason code: a transport failure is never retried, whatever problems it would carry.
      expect(decideEstimateRetry({ ...input, failure: { reasonCode: "estimate-call-failed:codex-rate-limited", problems: ["no-json-object"] } })).toEqual({ kind: "none" });
      expect(decideEstimateRetry({ ...input, failure: { reasonCode: "estimate-output-invalid", problems: [] } })).toEqual({ kind: "none" });
      expect(decideEstimateRetry({ ...input, estimate: { ...input.estimate, origin: { kind: "auto-retry", of: "estimate-x", problems: ["p"] } } })).toEqual({ kind: "none" });
    } finally { await x.h.dispose(); }
  });

  it("names usage-unknown, dispatch-blocked and an archived or past-pre-start group, in order", async () => {
    const { x, input } = await base(); try {
      const ledger = input.group.ledger;
      expect(decideEstimateRetry({ ...input, group: { ...input.group, ledger: { ...ledger, usageUnknown: true } } })).toEqual({ kind: "skip", code: "usage-unknown" });
      expect(decideEstimateRetry({ ...input, dispatchBlocked: true })).toEqual({ kind: "skip", code: "dispatch-blocked" });
      expect(decideEstimateRetry({ ...input, group: { ...input.group, archived: { at: 1, actor: "human" } } })).toEqual({ kind: "skip", code: "group-not-prestart" });
      expect(decideEstimateRetry({ ...input, group: { ...input.group, status: "running" } })).toEqual({ kind: "skip", code: "group-not-prestart" });
      // A null dimension fits; a finite one short of the grant does not.
      expect(decideEstimateRetry({ ...input, reserveAfterSettlement: { ...input.reserveAfterSettlement, sessions: 0 } })).toEqual({ kind: "skip", code: "reserve-insufficient" });
      // Order: a stopped group with a deficit is named for the group first; a deficit before unknown usage.
      expect(decideEstimateRetry({ ...input, group: { ...input.group, stopped: true, ledger: { ...ledger, budgetDeficit: { ...ledger.budgetDeficit, tokens: 1 } } } })).toEqual({ kind: "skip", code: "group-not-prestart" });
      expect(decideEstimateRetry({ ...input, dispatchBlocked: true, group: { ...input.group, ledger: { ...ledger, usageUnknown: true, budgetDeficit: { ...ledger.budgetDeficit, tokens: 1 } } } })).toEqual({ kind: "skip", code: "budget-deficit" });
    } finally { await x.h.dispose(); }
  });

  it("caps the problems a retry carries and still sizes the prompt with them", async () => {
    const { x, input } = await base(); try {
      const problems = Array.from({ length: 20 }, (_, i) => `task-missing:${String(i).padStart(3, "0")}:${"x".repeat(180)}`);
      expect(decideEstimateRetry({ ...input, failure: { reasonCode: "estimate-output-invalid", problems } })).toEqual({ kind: "retry", problems });
      const tight = { ...input.contract, estimatorCapabilities: { ...input.contract.estimatorCapabilities, contextWindowTokens: 1 } };
      expect(decideEstimateRetry({ ...input, contract: tight })).toEqual({ kind: "skip", code: "input-too-large" });
    } finally { await x.h.dispose(); }
  });
});
