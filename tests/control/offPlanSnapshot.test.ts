/**
 * Off-plan writes (#346) spec W1/W2, plan Task 3. Confirm freezes each v4 task's parallel siblings' claims into the
 * execution snapshot (`offPlan`), and every derivation of that task's contract denies them: the primary repository's
 * claims in `safetyPolicy.denylistPaths`, an extra repository's in its own `denylistPaths`, all of them in one constraint
 * line. A snapshot with no v4 task keeps the bytes it had before the key existed. Replacing one task's entry leaves every
 * other task's derived contract alone.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import {
  deriveContract, offPlanEntryOf, prepareExecutionSnapshot, readConfirmedTaskExecution, replaceTaskInSnapshot, type ConfirmedProposal,
} from "../../src/control/executionSnapshot.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { controlPlanSchema, executionSnapshotSchema } from "../../src/control/webProtocol.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { taskContractSchema } from "../../src/scheduler/planFile.js";
import { ownWritesDenied } from "../../src/control/parallelClaims.js";
import { readBudgetProposal } from "../../src/control/queries.js";
import { readCanonicalRecord, writeCanonicalRecord } from "../../src/control/snapshot.js";
import { saveWebAuthority } from "../../src/control/estimateSettlement.js";
import { openTestStore } from "./fixtures/store.js";
import { change, errorOf, loop, snapshotOf } from "./fixtures/taskLoop.js";
import { webFixture } from "./fixtures/web.js";

const SIBLING_LINE = "Other tasks of this group change these paths at the same time; do not modify them: ";
const hash = (letter: string) => letter.repeat(64);
const amount = (tokens: number, activeMs: number, attempts: number, sessions: number) => ({ tokens, activeMs, attempts, sessions });
const provenance = (kind: "human" | "system" = "human") => ({
  tokens: { provenance: kind, estimateId: null }, activeMs: { provenance: kind, estimateId: null },
  attempts: { provenance: kind, estimateId: null }, sessions: { provenance: kind, estimateId: null },
} as const);
const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const WORK = amount(1_000, 40_000, 2, 2), HANDOFF = amount(100, 5_000, 0, 0), LIMIT = amount(10_000, 1_000_000, 50, 50);
const CAPABILITIES = { usageObservation: "realtime", budgetEnforcement: "bounded", contextObservation: "unavailable", handoffControl: "durable",
  handoffExecution: "mechanical-in-run-v1", contextWindowTokens: null, requestBoundProof: null } as const;

interface TaskSpec {
  taskId: string; deps?: string[]; targetPaths: string[]; allowlist?: string[]; repoPath?: string;
  repoKey?: string; additionalRepos?: Array<{ key: string; repoPath: string; targetPaths: string[]; allowlistPaths?: string[]; denylistPaths?: string[] }>;
}

function contractOf(spec: TaskSpec) {
  return taskContractSchema.parse({
    objective: { taskId: spec.taskId, goal: "ship", successCondition: "passes", nonGoals: [] },
    context: { repoPath: spec.repoPath ?? "/repo", targetPaths: spec.targetPaths, relevantDocs: [], buildTestCommands: ["true"], constraints: ["keep it small"],
      ...(spec.additionalRepos === undefined ? {} : { repoKey: spec.repoKey, additionalRepos: spec.additionalRepos }) },
    executionPolicy: { autonomyLevel: "L2", maxAttempts: 9, perAttemptTimeoutMs: 60_000, totalRuntimeBudgetMs: 90_000, tokenBudget: 99_000, worktreeRequired: true, partialOutcomeRecoveryWindowMs: 30_000 },
    safetyPolicy: { allowlistPaths: spec.allowlist ?? [], denylistPaths: ["secrets/**"], maxFilesTouched: 1, humanGateConditions: [] },
    verification: { verifierType: "command", requiredChecks: ["true"], rejectOn: ["failure"], evidenceRequired: [] },
    escalationAndExit: { escalationTargets: [], pauseOn: [], stopOn: [], terminalStates: ["succeeded", "blocked_waiting_human", "exhausted", "cancelled", "failed"] },
  });
}

let harness: Awaited<ReturnType<typeof openTestStore>>;
beforeEach(async () => { harness = await openTestStore(); });
afterEach(async () => { await harness.dispose(); });

/** The store authority a confirmation is checked against (archived plan, editable proposal), and the confirmation itself. */
function confirmation(specs: TaskSpec[], unreadable?: string): ConfirmedProposal {
  // `unreadable`: that task's archived contract carries a key the closed contract schema refuses.
  const contracts: unknown[] = specs.map(spec => spec.taskId === unreadable ? { ...contractOf(spec), unknownKey: true } : contractOf(spec));
  const plan = controlPlanSchema.parse({
    schema: "orca-control-plan-v1", repoId: "repo", planId: "plan", goal: "ship", successConditions: ["passes"],
    tasks: specs.map((spec, index) => ({ taskId: spec.taskId, dependencyTaskIds: [...(spec.deps ?? [])].sort(compare), targetVersion: 1,
      originalContractHash: sha256Canonical(contracts[index]), originalContractCanonicalJson: canonicalBytes(contracts[index]).toString("utf8") })),
  });
  const planHash = sha256Canonical(plan);
  const allocations = [
    ...specs.flatMap(spec => [
      { ownerKind: "task", ownerId: spec.taskId, bucket: "work", amount: WORK, fieldProvenance: provenance() },
      { ownerKind: "task", ownerId: spec.taskId, bucket: "handoff", amount: HANDOFF, fieldProvenance: provenance() },
    ]),
    { ownerKind: "goal-review", ownerId: "g:goal-review", bucket: "review", amount: amount(1, 1, 1, 1), fieldProvenance: provenance() },
    { ownerKind: "reserve", ownerId: "g:reserve", bucket: "reserve", amount: amount(1, 1, 1, 1), fieldProvenance: provenance("system") },
  ].sort((l, r) => compare(`${l.ownerKind}\0${l.ownerId}\0${l.bucket}`, `${r.ownerKind}\0${r.ownerId}\0${r.bucket}`)) as ConfirmedProposal["allocations"];
  const group = {
    groupId: "g", graphVersion: 1, planHash, plan: { repoId: "repo", planId: "plan", planHash, goal: "ship", successConditions: ["passes"] },
    proposal: { state: "editable", proposalVersion: 2, planHash, budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
    ledger: { groupLimit: LIMIT },
  };
  harness.store.db.prepare("INSERT INTO groups(id,revision,graph_version,projection_seq,body) VALUES ('g',1,1,1,?)").run(JSON.stringify(group));
  writeCanonicalRecord(harness.store, "g", planHash, canonicalBytes(plan).toString("utf8"));
  for (const task of plan.tasks) writeCanonicalRecord(harness.store, "g", task.originalContractHash, task.originalContractCanonicalJson);
  const proposal = { proposalVersion: 2, state: "editable", planHash, groupLimit: LIMIT, explicitUnallocatedReserve: amount(1, 1, 1, 1),
    allocations: allocations.map(a => ({ ...a, state: "draft-encumbered" })), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null };
  harness.store.db.prepare("INSERT INTO budget_proposals(group_id,proposal_version,body) VALUES ('g',2,?)").run(canonicalBytes(proposal).toString("utf8"));
  const selection = { agent: "fixture-agent", model: "m", contextWindow: "agent-default" } as const;
  return {
    store: harness.store, groupId: "g", planHash, graphVersion: 1, proposalVersion: 2, groupLimit: LIMIT, budgetMode: "strict",
    proposalIdentity: { groupId: "g", planHash, proposalVersion: 2 }, contextPolicy: { handoffAtContextTokens: null },
    profiles: { estimator: { profileId: "e", profileHash: hash("b") }, worker: { profileId: "w", profileHash: hash("c") }, handoff: { profileId: "h", profileHash: hash("d") }, goalReview: { profileId: "r", profileHash: hash("e") } },
    allocations,
    tasks: plan.tasks.map(task => ({ taskId: task.taskId, originalContractHash: task.originalContractHash, originalContractCanonicalJson: task.originalContractCanonicalJson, work: WORK, handoff: HANDOFF })),
    agents: {
      tasks: specs.map(spec => ({ taskId: spec.taskId, agent: selection, agentProvenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" },
        configHash: hash("9"), timeoutMs: 1_800_000, killGraceMs: 5_000, agentCapabilities: CAPABILITIES })),
      reconcile: { partial: { agent: "fixture-agent" }, provenance: { agent: "operator", model: "descriptor", contextWindow: "descriptor" },
        selection, configHash: hash("9"), timeoutMs: 1_800_000, killGraceMs: 5_000, capabilities: CAPABILITIES },
    },
  } as ConfirmedProposal;
}

type Prepared = ReturnType<typeof prepareExecutionSnapshot>;
const contractIn = (prepared: Prepared, taskId: string) =>
  taskContractSchema.parse(JSON.parse(prepared.derivedContracts.find(entry => entry.taskId === taskId)!.contractCanonicalJson));
const plainDerivation = (input: ConfirmedProposal, taskId: string) => deriveContract(input.tasks.find(task => task.taskId === taskId)!, input.proposalVersion);

// a -> {b, c} -> d, b and c disjoint: b and c run at the same time, a and d have no sibling.
const DIAMOND: TaskSpec[] = [
  { taskId: "a", targetPaths: ["src/a.ts"] },
  { taskId: "b", deps: ["a"], targetPaths: ["src/b/**"] },
  { taskId: "c", deps: ["a"], targetPaths: ["src/c.ts"] },
  { taskId: "d", deps: ["b", "c"], targetPaths: ["src/d.ts"] },
];

describe("confirm freezes a v4 task's parallel claims (#346 W2)", () => {
  it("a confirmed diamond freezes B's and C's siblings and derives their denylists and constraint line", () => {
    const input = confirmation(DIAMOND);
    const prepared = prepareExecutionSnapshot(input);
    expect(prepared.snapshot.offPlan).toEqual([
      { taskId: "b", siblings: [{ siblingId: "c", claims: [{ repoKey: null, path: "src/c.ts" }] }] },
      { taskId: "c", siblings: [{ siblingId: "b", claims: [{ repoKey: null, path: "src/b/**" }] }] },
    ]);
    expect(offPlanEntryOf(prepared.snapshot, "b")).toEqual([{ siblingId: "c", claims: [{ repoKey: null, path: "src/c.ts" }] }]);
    expect(offPlanEntryOf(prepared.snapshot, "a")).toEqual([]);
    const b = contractIn(prepared, "b"), c = contractIn(prepared, "c");
    // mutation: drop the primary denylist union -> red
    expect(b.safetyPolicy.denylistPaths).toEqual(["secrets/**", "src/c.ts"]);
    expect(c.safetyPolicy.denylistPaths).toEqual(["secrets/**", "src/b/**"]);
    // mutation: drop the constraint line -> red
    expect(b.context.constraints).toEqual(["keep it small", `${SIBLING_LINE}src/c.ts.`]);
    expect(c.context.constraints).toEqual(["keep it small", `${SIBLING_LINE}src/b/**.`]);
    // a and d have no sibling: their derived records are exactly what a derivation without siblings gives.
    for (const taskId of ["a", "d"]) {
      expect(prepared.derivedContracts.find(entry => entry.taskId === taskId)!.canonicalJson).toBe(plainDerivation(input, taskId).canonicalJson);
    }
    // The snapshot's reference is the derivation with the frozen siblings.
    const bTask = input.tasks.find(task => task.taskId === "b")!;
    expect(prepared.snapshot.derivedContracts.find(entry => entry.taskId === "b")!.derivedContractHash)
      .toBe(deriveContract(bTask, input.proposalVersion, offPlanEntryOf(prepared.snapshot, "b")).derivedContractHash);
  });

  it("an order that exists only through an implicit write-set edge is not parallel (spec W1)", () => {
    // x and y both write shared.ts: buildGraph orders them x -> y. z depends on y, so z runs after x too.
    const prepared = prepareExecutionSnapshot(confirmation([
      { taskId: "x", targetPaths: ["shared.ts", "x.ts"] },
      { taskId: "y", targetPaths: ["shared.ts"] },
      { taskId: "z", deps: ["y"], targetPaths: ["z.ts"] },
    ]));
    // mutation: build the dependencies from dependencyTaskIds alone -> x and z become siblings -> red
    expect(prepared.snapshot.offPlan).toBeUndefined();
    expect(Object.keys(prepared.snapshot)).not.toContain("offPlan");
  });

  it("denies an extra repository's claims in that repository's entry, keyed in the constraint line, and drops claimless siblings", () => {
    const input = confirmation([
      { taskId: "p", targetPaths: ["src/p.ts"], repoKey: "app", additionalRepos: [{ key: "lib", repoPath: "/lib", targetPaths: ["src/p-lib.ts"], allowlistPaths: [] }] },
      { taskId: "q", repoPath: "/lib", targetPaths: ["src/q.ts"] },
      { taskId: "r", repoPath: "/other", targetPaths: ["r.ts"] },
    ]);
    const prepared = prepareExecutionSnapshot(input);
    // r writes only /other, which neither p nor q writes: it is no task's sibling entry and has none of its own.
    // mutation: keep siblings with no claims -> p gets {siblingId: "r", claims: []}, r gets an entry -> red
    expect(prepared.snapshot.offPlan).toEqual([
      { taskId: "p", siblings: [{ siblingId: "q", claims: [{ repoKey: "lib", path: "src/q.ts" }] }] },
      { taskId: "q", siblings: [{ siblingId: "p", claims: [{ repoKey: null, path: "src/p-lib.ts" }] }] },
    ]);
    const p = contractIn(prepared, "p");
    // mutation: drop the extra-repo denylist -> red
    expect(p.context.additionalRepos).toEqual([{ key: "lib", repoPath: "/lib", targetPaths: ["src/p-lib.ts"], allowlistPaths: [], denylistPaths: ["src/q.ts"] }]);
    expect(p.safetyPolicy.denylistPaths).toEqual(["secrets/**"]);
    expect(p.context.constraints).toEqual(["keep it small", `${SIBLING_LINE}lib:src/q.ts.`]);
    expect(contractIn(prepared, "q").safetyPolicy.denylistPaths).toEqual(["secrets/**", "src/p-lib.ts"]);
    expect(prepared.derivedContracts.find(entry => entry.taskId === "r")!.canonicalJson).toBe(plainDerivation(input, "r").canonicalJson);
  });

  it("refuses a claim keyed to a repository the contract does not have", () => {
    const input = confirmation(DIAMOND);
    const b = input.tasks.find(task => task.taskId === "b")!;
    expect(() => deriveContract(b, 2, [{ siblingId: "c", claims: [{ repoKey: "lib", path: "x" }] }])).toThrow("execution-policy-unrepresentable");
    // Empty siblings, or siblings without claims, derive exactly what no siblings derive.
    expect(deriveContract(b, 2, []).canonicalJson).toBe(deriveContract(b, 2).canonicalJson);
    expect(deriveContract(b, 2, [{ siblingId: "c", claims: [] }]).canonicalJson).toBe(deriveContract(b, 2).canonicalJson);
  });

  it("an unreadable contract is refused, never confirmed without its siblings frozen", () => {
    // Fix round 1 (minor 2): frozenOffPlan has no silent answer for a contract it cannot read. The archived plan's
    // reader refuses one first (readArchivedPlan, through verifyPlanAuthority); were that check gone, frozenOffPlan's own
    // parse would throw a ZodError, not this code. mutation: readArchivedPlan's contract parse no longer refuses -> red
    expect(() => prepareExecutionSnapshot(confirmation(DIAMOND, "c"))).toThrow("recovery-blocked");
  });

  it("names the frozen claims a contract's own write set meets, per repository and keyed as the receiver keys them", () => {
    const contract = contractOf({ taskId: "p", targetPaths: ["src/**"], repoKey: "app",
      additionalRepos: [{ key: "lib", repoPath: "/lib", targetPaths: ["x.ts"], allowlistPaths: [] }] });
    expect(ownWritesDenied(contract, [
      { siblingId: "q", claims: [{ repoKey: null, path: "src/q.ts" }, { repoKey: null, path: "docs/q.md" }, { repoKey: "lib", path: "**" }] },
      { siblingId: "r", claims: [{ repoKey: "lib", path: "y.ts" }, { repoKey: "nowhere", path: "src/q.ts" }] },
    ])).toEqual(["lib:**", "src/q.ts"]);
    expect(ownWritesDenied(contract, [])).toEqual([]);
  });
});

/**
 * GOLDEN_V3_DIAMOND_HASH was captured at HEAD 16b6ef4b, where src/control/executionSnapshot.ts and webProtocol.ts are
 * byte-identical to main (`/usr/bin/git diff main HEAD -- src/control/executionSnapshot.ts src/control/webProtocol.ts`
 * printed nothing): prepareExecutionSnapshot(confirmation(V3_DIAMOND)).snapshotHash, before the offPlan key existed.
 */
const GOLDEN_V3_DIAMOND_HASH = "9e55e957f64c145f34e61096b688e9ac2c1efc8626834ee0e47d10d183ceb0c6";
const V3_DIAMOND = DIAMOND.map(spec => ({ ...spec, allowlist: spec.targetPaths }));

describe("groups without a v4 task", () => {
  it("a snapshot with no v4 task has the bytes it had before", () => {
    const prepared = prepareExecutionSnapshot(confirmation(V3_DIAMOND));
    expect(prepared.snapshotHash).toBe(GOLDEN_V3_DIAMOND_HASH);
    expect(Object.keys(prepared.snapshot)).not.toContain("offPlan");
  });
});

describe("replacing one task's entry", () => {
  it("replacing one task's entry leaves its sibling's derived contract hash unchanged", () => {
    const prepared = prepareExecutionSnapshot(confirmation(DIAMOND));
    const snapshot = prepared.snapshot;
    const refOf = (s: typeof snapshot, taskId: string) => s.derivedContracts.find(entry => entry.taskId === taskId)!.derivedContractHash;
    const rows = (taskId: string) => ({
      work: snapshot.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "work")!,
      handoff: snapshot.allocations.find(a => a.ownerKind === "task" && a.ownerId === taskId && a.bucket === "handoff")!,
    });
    // b is ordered after c now: its entry goes; c keeps its entry and its derived contract.
    const removed = replaceTaskInSnapshot(snapshot, "b", hash("f"), rows("b"), null, []);
    expect(removed.snapshot.offPlan).toEqual([{ taskId: "c", siblings: [{ siblingId: "b", claims: [{ repoKey: null, path: "src/b/**" }] }] }]);
    expect(refOf(removed.snapshot, "c")).toBe(refOf(snapshot, "c"));
    expect(refOf(removed.snapshot, "b")).toBe(hash("f"));
    // Removing every entry drops the key.
    const none = replaceTaskInSnapshot(removed.snapshot, "c", refOf(snapshot, "c"), rows("c"), null, []);
    expect(Object.keys(none.snapshot)).not.toContain("offPlan");
    // An entry is added back in taskId order; a sibling without claims is not frozen.
    const added = replaceTaskInSnapshot(none.snapshot, "d", refOf(snapshot, "d"), rows("d"), null,
      [{ siblingId: "a", claims: [] }, { siblingId: "c", claims: [{ repoKey: null, path: "src/c.ts" }] }]);
    expect(added.snapshot.offPlan).toEqual([{ taskId: "d", siblings: [{ siblingId: "c", claims: [{ repoKey: null, path: "src/c.ts" }] }] }]);
    // Without the argument the entries are copied as they are.
    const kept = replaceTaskInSnapshot(snapshot, "b", refOf(snapshot, "b"), rows("b"), null);
    expect(kept.snapshotHash).toBe(prepared.snapshotHash);
  });

  it("the schema refuses entries out of order, for an unknown task, or without siblings or claims", () => {
    const snapshot = prepareExecutionSnapshot(confirmation(DIAMOND)).snapshot;
    const entry = (taskId: string, siblingId = "z") => ({ taskId, siblings: [{ siblingId, claims: [{ repoKey: null, path: "p" }] }] });
    const paths = (offPlan: unknown) => {
      const parsed = executionSnapshotSchema.safeParse({ ...snapshot, offPlan });
      return parsed.success ? [] : parsed.error.issues.map(issue => issue.path[0]);
    };
    expect(paths([entry("a"), entry("b")])).toEqual([]);
    for (const offPlan of [[entry("b"), entry("a")], [entry("a"), entry("a")], [entry("missing")], [], [{ taskId: "a", siblings: [] }],
      [{ taskId: "a", siblings: [{ siblingId: "b", claims: [] }] }], [{ taskId: "a", siblings: [{ siblingId: "b", claims: [{ repoKey: null, path: "" }] }] }],
      [{ taskId: "a", siblings: [{ siblingId: "c", claims: [{ repoKey: null, path: "p" }] }, { siblingId: "b", claims: [{ repoKey: null, path: "p" }] }] }]]) {
      expect(paths(offPlan)).toContain("offPlan");
    }
  });
});

describe("a confirmed group reads its frozen entries back (A2)", () => {
  async function confirmed(tasks: Parameters<typeof webFixture>[1]) {
    const h = await webFixture(undefined, tasks);
    const service = new WebControlService(h.deps);
    const answer = await service.confirm(h.command("confirm", await h.confirmPayload()));
    if ("error" in answer) { await h.dispose(); throw new Error(JSON.stringify(answer)); }
    return { h, service };
  }

  it("readConfirmedTaskExecution re-derives the frozen entry and accepts it", async () => {
    const { h } = await confirmed([
      { taskId: "a", targetPaths: ["src/a.ts"] },
      { taskId: "b", targetPaths: ["src/b.ts"], dependsOn: ["a"] },
      { taskId: "c", targetPaths: ["src/c/**"], dependsOn: ["a"] },
    ]);
    try {
      expect(snapshotOf(h).offPlan).toEqual([
        { taskId: "b", siblings: [{ siblingId: "c", claims: [{ repoKey: null, path: "src/c/**" }] }] },
        { taskId: "c", siblings: [{ siblingId: "b", claims: [{ repoKey: null, path: "src/b.ts" }] }] },
      ]);
      // mutation: derive without the frozen entry in readConfirmedTaskExecution -> recovery-blocked -> red
      const b = readConfirmedTaskExecution(h.store, "g", "b");
      expect(b.contract.safetyPolicy.denylistPaths).toEqual(["src/c/**"]);
      expect(b.contract.context.constraints).toEqual([`${SIBLING_LINE}src/c/**.`]);
      const a = readConfirmedTaskExecution(h.store, "g", "a");
      expect(a.contract.safetyPolicy.denylistPaths).toEqual([]);
      expect(a.contract.context.constraints).toEqual([]);
      // mutation: re-derive without the frozen entry in the panel's snapshot check -> derived-contract-forged -> red
      expect(readControlGroup(h.store, "epoch", "g").workItems.find(item => item.taskId === "b")!.derivedContractHash).toBe(b.derivedContractHash);
    } finally { await h.dispose(); }
  });

  it("a confirmed set-task-loop re-derives the changed task with its frozen entry and keeps it", async () => {
    const { h, service } = await confirmed([{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const before = snapshotOf(h);
      expect(before.offPlan).toEqual([
        { taskId: "a", siblings: [{ siblingId: "b", claims: [{ repoKey: null, path: "b" }] }] },
        { taskId: "b", siblings: [{ siblingId: "a", claims: [{ repoKey: null, path: "a" }] }] },
      ]);
      // mutation: derive without the frozen entry in setTaskLoop -> its own A2 read refuses (recovery-blocked) -> red
      expect(await service.setTaskLoop(change(h, "a", { inputs: { goal: "write a, changed" } }))).toMatchObject({ result: { kind: "task-loop-set" } });
      const a = readConfirmedTaskExecution(h.store, "g", "a");
      expect(a.contract.objective.goal).toBe("write a, changed");
      expect(a.contract.safetyPolicy.denylistPaths).toEqual(["b"]);
      expect(snapshotOf(h).offPlan).toEqual(before.offPlan);
    } finally { await h.dispose(); }
  });

  it("refuses a confirmed set-task-loop whose new targets meet the task's own frozen sibling claims, and writes nothing", async () => {
    // Fix round 1 ruling (Task 3 review): a frozen denylist must never forbid the task's own target.
    const { h, service } = await confirmed([{ taskId: "a", loop: loop("a") }, { taskId: "b", loop: loop("b") }]);
    try {
      const hash = readBudgetProposal(h.store, "g").executionSnapshotHash;
      const before = readConfirmedTaskExecution(h.store, "g", "a");
      // mutation: drop the refusal -> the change succeeds with targetPaths [a, b] and denylist [b] -> red
      const answer = await service.setTaskLoop(change(h, "a", { inputs: { targetPaths: ["a", "b"] } }));
      expect(errorOf(answer)).toMatchObject({ code: "off-plan-claims-overlap", message: "off-plan-claims-overlap:b" });
      expect(readBudgetProposal(h.store, "g").executionSnapshotHash).toBe(hash);
      expect(readConfirmedTaskExecution(h.store, "g", "a")).toEqual(before);
      // A path no sibling claims is allowed; it is not added to the sibling's frozen denylist (recorded limit).
      expect(await service.setTaskLoop(change(h, "a", { inputs: { targetPaths: ["a", "c"] } }))).toMatchObject({ result: { kind: "task-loop-set" } });
      expect(readConfirmedTaskExecution(h.store, "g", "a").contract.context.targetPaths).toEqual(["a", "c"]);
      expect(readConfirmedTaskExecution(h.store, "g", "b").contract.safetyPolicy.denylistPaths).toEqual(["a"]);
    } finally { await h.dispose(); }
  });

  it("the panel reads a frozen claim keyed to a repository the contract does not have as a forged derived contract", async () => {
    const { h } = await confirmed([
      { taskId: "a", targetPaths: ["src/a.ts"] },
      { taskId: "b", targetPaths: ["src/b.ts"], dependsOn: ["a"] },
      { taskId: "c", targetPaths: ["src/c/**"], dependsOn: ["a"] },
    ]);
    try {
      const proposal = readBudgetProposal(h.store, "g");
      const snapshot = executionSnapshotSchema.parse(JSON.parse(readCanonicalRecord(h.store, proposal.executionSnapshotHash!)));
      snapshot.offPlan![0]!.siblings[0]!.claims = [{ repoKey: "nowhere", path: "src/c/**" }];
      const forged = executionSnapshotSchema.parse(snapshot);
      writeCanonicalRecord(h.store, "g", sha256Canonical(forged), canonicalBytes(forged).toString("utf8"));
      proposal.executionSnapshotHash = sha256Canonical(forged);
      saveWebAuthority(h.store, readWebGroup(h.store, "g"), proposal);
      // mutation: let the shared helper's own error through -> execution-policy-unrepresentable -> red
      expect(() => readControlGroup(h.store, "epoch", "g")).toThrow("recovery-blocked:derived-contract-forged");
    } finally { await h.dispose(); }
  });
});
