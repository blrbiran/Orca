import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { latestRunSnapshot, prepareAcceptAttempt } from "../../src/control/acceptAttempt.js";
import { readArtifact } from "../../src/control/archive.js";
import { withCommandContext } from "../../src/control/commandClient.js";
import type { ExecutionDriver } from "../../src/control/executionDriver.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { readWork } from "../../src/control/queries.js";
import { exportResumeBundle } from "../../src/control/resumeBundle.js";
import { snapshotV2Schema } from "../../src/control/snapshotV2.js";
import { toStartEnvelope } from "../../src/control/startEnvelope.js";
import { dispatchEnvelopeSchema } from "../../src/control/webProtocol.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { attemptReviewOf } from "../../src/panel/attemptReview.js";
import { persistedRunProblem } from "../../src/panel/controlViews.js";
import { WebControlService } from "../../src/control/webService.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { requestState, stop } from "./fixtures/handoffHarness.js";

/**
 * Change-sized runs spec 2026-11-19 §5.5 (P2; #363 #366): every reader of an archived run reads snapshot v2 -- accept-attempt
 * (P2-6), the Results review diff (P2-7), the continuation export (P2-8) -- and an older ccloop is refused a v2 predecessor
 * by name (P2-11).
 */
type T = Awaited<ReturnType<typeof driverHarness>>;
const OWNER = { client: "web", principal: "user:owner" };

async function closedKeyedFailure(): Promise<{ t: T; runId: string; driver: ExecutionDriver }> {
  const t = await driverHarness([{ taskId: "a", tokenBudget: 4_000_000 }], { behaviour: () => "failed", sealedOwnerProof: true, tokenPolicy: "optional-v1", attemptRef: true });
  const runId = await t.claim(), driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  const closed = t.service.closeRun(t.h.command("close-run", { runId }));
  if ("error" in closed) throw new Error(JSON.stringify(closed));
  await t.until(driver, () => t.body(runId).drive.cleanedUp === true);
  return { t, runId, driver };
}
const snapshotOf = async (t: T, runId: string) => snapshotV2Schema.parse(JSON.parse((await readArtifact(t.h.store, latestRunSnapshot(t.h.store, runId)!)).toString()));
/** Forget the attempt the way a person can: the pin and ccloop's refs deleted, then a gc that prunes now. */
const forget = (repo: string, runId: string) => {
  for (const ref of git(repo, "for-each-ref", "--format=%(refname)", "refs/orca/", "refs/ccloop/").split("\n").filter(Boolean)) git(repo, "update-ref", "-d", ref);
  void runId;
  git(repo, "reflog", "expire", "--expire=now", "--all");
  git(repo, "gc", "-q", "--prune=now");
};
const reviewOf = (t: T, runId: string) => attemptReviewOf(t.h.store, t.body(runId), readWork(t.h.store, "g", "a") as never);
async function review(t: T, runId: string) {
  for (let i = 0; i < 100; i += 1) {
    const answer = reviewOf(t, runId);
    if (answer?.diff != null) return answer;
    await new Promise((done) => setTimeout(done, 50));
  }
  return reviewOf(t, runId);
}

describe("accept-attempt and the Results review read snapshot v2 (§5.5.1, §5.5.2)", { timeout: 120_000 }, () => {
  // §5.5.1 / §8 row "base gone": a v2 snapshot cannot be landed where its base no longer is, and accept-attempt says so by
  // name before any command or landing. The person rewrote the target's history (an orphan branch, every other ref and the
  // reflogs dropped, a pruning gc), so neither the base nor the attempt is in it. Mutation: prepareAcceptAttempt answers a
  // v2 snapshot `ready` without verifying it in the target -> ready, red. (The base check in verifySnapshotInRepository is
  // doubled by `bundle verify`, which names the same failure: a redundant guard, not a criterion of its own.)
  it("refuses a v2 snapshot whose base is gone from the target: snapshot-base-unavailable", async () => {
    const { t, runId } = await closedKeyedFailure(); try {
      const snapshot = await snapshotOf(t, runId);
      expect(await prepareAcceptAttempt(t.h.store, runId)).toEqual({ kind: "ready", snapshot: latestRunSnapshot(t.h.store, runId) });
      git(t.repo, "checkout", "-q", "--orphan", "rewritten");
      git(t.repo, "commit", "-q", "-m", "rewritten history");
      for (const ref of git(t.repo, "for-each-ref", "--format=%(refname)").split("\n").filter((name) => name !== "refs/heads/rewritten")) git(t.repo, "update-ref", "-d", ref);
      git(t.repo, "reflog", "expire", "--expire=now", "--all");
      git(t.repo, "gc", "-q", "--prune=now");
      expect(() => git(t.repo, "cat-file", "-e", `${snapshot.base}^{commit}`)).toThrow();
      expect(await prepareAcceptAttempt(t.h.store, runId)).toEqual({ kind: "refused", code: "accept-attempt-snapshot-partial", detail: "snapshot-base-unavailable" });
    } finally { await t.h.dispose(); }
  });

  // P2-7. Mutation: drop the v2 dispatch in readDiff -> the v1 rebuild cannot parse a v2 snapshot, diff stays null, red.
  it("reads the review diff in the target, with the numbers git gives there (the v1 rebuild cannot read v2)", async () => {
    const { t, runId } = await closedKeyedFailure(); try {
      const snapshot = await snapshotOf(t, runId);
      expect(snapshot).toMatchObject({ version: 2, source: "ccloop-published" });
      const answer = await review(t, runId);
      expect(answer?.diff?.shortstat).toBe(git(t.repo, "diff", "--shortstat", snapshot.base, snapshot.attempt));
      expect(answer?.diff?.stat.at(-1)?.trim()).toBe(git(t.repo, "diff", "--shortstat", snapshot.base, snapshot.attempt));
    } finally { await t.h.dispose(); }
  });

  // P2-7. Mutation: answer the diff from an alternates rebuild of the bundle -> a diff, red.
  it("answers diff null when the target no longer holds the attempt", async () => {
    const { t, runId } = await closedKeyedFailure(); try {
      const snapshot = await snapshotOf(t, runId);
      forget(t.repo, runId);
      expect(() => git(t.repo, "cat-file", "-e", `${snapshot.attempt}^{commit}`)).toThrow();
      await new Promise((done) => setTimeout(done, 300));
      reviewOf(t, runId);
      await new Promise((done) => setTimeout(done, 500));
      expect(reviewOf(t, runId)?.diff).toBeNull();
    } finally { await t.h.dispose(); }
  });

  // P2-6. Mutations: skip the bundle fetch (pin from the target's object only) -> attempt missing, refused, red; a forced
  // pin over another value -> the ref moves, red (attemptPin.test.ts measures that one directly).
  it("re-pins the attempt from the bundle after a person deleted every ref and pruned, then lands it", async () => {
    const { t, runId, driver } = await closedKeyedFailure(); try {
      const snapshot = await snapshotOf(t, runId);
      forget(t.repo, runId);
      const command = t.h.command("accept-attempt", { taskId: "a", runId, note: "the checks decide" }, "acc-1");
      const answer = await withCommandContext(command.commandId, OWNER, () => t.service.acceptAttempt(command));
      expect("error" in answer ? answer : null).toBeNull();
      const deadline = Date.now() + 60_000;
      while (!["landed", "refused"].includes(t.body(runId).operatorAcceptance?.state) && Date.now() < deadline) { await driver.round(); await new Promise((done) => setTimeout(done, 50)); }
      const accepted = t.body(runId).operatorAcceptance;
      expect(accepted?.reason ?? null).toBeNull();
      expect(accepted?.state).toBe("landed");
      expect(git(t.repo, "rev-parse", `refs/orca/runs/${runId}`)).toBe(snapshot.attempt);
      expect(git(t.repo, "rev-parse", `${accepted.landedCommit}^2`)).toBe(snapshot.attempt);
    } finally { await t.h.dispose(); }
  });
});

/** A predecessor stopped mid-run and settled recoverable; `features` answers attemptRef iff `reads.v2`. */
async function parkedPredecessor(reads: { v2: boolean }) {
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable",
    wrapPort: (port: ExecutionPort) => ({ ...port, readFeatures: async () => (reads.v2 ? { protocol: 1 as const, attemptRef: "v1" as const } : { protocol: 1 as const }) }) });
  const predecessor = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(predecessor).state === "accepted");
  const [requestId] = await stop(t as never);
  await t.until(driver, () => requestState(t as never, requestId!) === "settled-recoverable");
  return { t, predecessor, driver, checkpointId: t.body(predecessor).checkpointId as string };
}

describe("continuation of a v2 predecessor (§5.5.3, §5.8)", { timeout: 120_000 }, () => {
  // P2-8. Mutation: export v1's closure (walk the tree) -> not reachable for v2; drop the v2 parse -> snapshot-invalid, red.
  it("exports the checkpoint, its logs, snapshot v2 and the range bundle, and no blob of an unchanged file", async () => {
    const { t, predecessor } = await parkedPredecessor({ v2: true }); try {
      const snapshot = await snapshotOf(t, predecessor);
      expect(snapshot).toMatchObject({ version: 2, source: "orca-commit" });
      // The pin recorded by the archive (no step C here) keeps the run body readable by every group read (strict schema).
      // Mutation: record the archive's pin entry as it is ({key, ref, sha}) -> run-invalid, red (seen against real ccloop P1).
      expect(t.body(predecessor).drive.runRef).toEqual({ ref: `refs/orca/runs/${predecessor}`, sha: snapshot.attempt });
      expect(persistedRunProblem(t.body(predecessor))).toBeNull();
      const sourceDir = join(await realpath(await mkdtemp(join(tmpdir(), "orca-resume-"))), "run-next");
      const input = await exportResumeBundle(t.h.store, { predecessorRunId: predecessor, newSourceDir: sourceDir });
      const manifest = JSON.parse(readFileSync(join(input.bundlePath, "resume-bundle.json"), "utf8")) as { artifacts: Array<{ ref: { artifactId: string }; file: string }> };
      const ids = manifest.artifacts.map((entry) => entry.ref.artifactId);
      expect(ids).toContain(snapshot.bundle!.artifactId);
      const unchanged = readFileSync(join(t.repo, "base.txt"));
      for (const entry of manifest.artifacts) expect(readFileSync(join(input.bundlePath, entry.file)).equals(unchanged)).toBe(false);
    } finally { await t.h.dispose(); }
  });

  // P2-11. Mutation: drop the A2 refusal -> the continuation reaches its workspace and the bundle, red.
  it("is refused by name at A2, before any workspace exists, under a ccloop that does not read v2", async () => {
    const reads = { v2: true };
    const { t, predecessor, driver, checkpointId } = await parkedPredecessor(reads); try {
      expect(t.body(predecessor).drive.snapshotVersion).toBe(2);
      reads.v2 = false;
      const result = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: predecessor, checkpointId }] } as never));
      if ("error" in result) throw new Error(JSON.stringify(result.error));
      const claimed = await deliverScheduledStart(t.dispatch, "g");
      if (claimed.kind !== "claimed") throw new Error(JSON.stringify(claimed));
      await t.until(driver, () => t.body(claimed.runId).state === "blocked");
      expect(t.body(claimed.runId).drive).toMatchObject({ blockedAt: "A2", blockedReason: "resume-predecessor-snapshot-v2-unsupported" });
      expect(existsSync(t.body(claimed.runId).drive.workspacePath)).toBe(false);
      expect(existsSync(join(t.body(claimed.runId).drive.sourceDir, "input"))).toBe(false);
    } finally { await t.h.dispose(); }
  });

  // §5.2.3, §6.2: a saved-result recovery envelope never carries the key, even when its work asks for it -- the `!record`
  // gate in toStartEnvelope, measured on a recovery envelope (mode verify-saved-result, protocol 4, a token policy, so the
  // policy alone would admit the key). Mutation: drop `!record &&` -> the key lands beside `mode`, the built envelope fails
  // its own schema (start-envelope-conflict), red.
  it("never puts the key on a saved-result recovery envelope built with it (the record gate)", () => {
    const hx = (v: string) => v.repeat(64);
    const amount = (n: number) => ({ tokens: n, activeMs: n, attempts: n, sessions: n });
    const ref = (id: string) => ({ artifactId: id, hash: hx("e") });
    const ledger = dispatchEnvelopeSchema.parse({
      schema: "orca-dispatch-envelope-v1", phase: "work", groupId: "g1", workItemId: "w1", runId: "run-2", generation: 2,
      claimIdentity: "recovery:run-2", ownerTokenHash: hx("a"), continuationIntentId: null, claimOrdinal: 2, derivedContractHash: hx("b"),
      grants: { work: amount(5), handoff: amount(3) }, profiles: { estimator: null, worker: { profileId: "worker", profileHash: hx("9") }, handoff: { profileId: "handoff", profileHash: hx("9") } },
    });
    const recoveryOf = { sourceRunId: "run-1", sourceAttempt: 1, capsuleHash: hx("1"), snapshotHash: hx("2"), normalizedExecutionHash: hx("3") };
    const funding = {
      kind: "legacy-fresh-grant-v1", inheritedUsage: amount(1),
      reservation: { runId: "run-2", revision: 1, workAllocationId: "work-allocation", handoffAllocationId: "handoff-allocation" },
      historicalPolicy: { contractHash: hx("4"), authority: ref("policy"), accountingMode: "finite-legacy", authoredWork: amount(1) },
      freshGrant: { work: amount(5), handoff: amount(3) }, fundedTotal: amount(9),
    };
    const row = { groupId: "g1", workItemId: "w1", taskId: "t1", runId: "run-2", generation: 2, graphVersion: 4, targetVersion: 7, commandId: "verify-g1-w1",
      configHash: hx("c"), agent: { agent: "claude", model: "m", contextWindow: 1_000_000 }, grant: { work: amount(5), handoff: amount(3) }, ownerToken: "owner-token-2",
      tokenPolicy: { authoredTokenCeiling: null, bindingCauses: [], inheritedUsage: amount(0) },
      mode: "verify-saved-result", recoveryOf,
      savedRecovery: { recoveryOf, source: { authorityKind: "legacy-published-candidate-v2", source: ref("source"), attempt: 1 }, sourceEnvelope: ref("envelope"),
        admission: ref("admission"), funding, currentRunId: "run-1", predecessor: null, artifacts: [], revision: 1 },
      savedResultRecovery: { packagePath: "/tmp/orca-recovery", packageHash: hx("5"), admissionHash: hx("6"), recoveryOf } };
    const built = toStartEnvelope(ledger, row, { sourceDir: "/tmp/src", targetRepo: "/tmp/repo", base: "v1", attemptDelivery: "ref-v1" }, { objective: "ship" });
    expect(built).toMatchObject({ protocol: 4, mode: "verify-saved-result" });
    expect(Object.hasOwn(built.work, "attemptDelivery")).toBe(false);
  });

  // P2-11. Mutation: let toStartEnvelope add the key beside `mode` -> the built envelope fails its own schema, red.
  it("never puts the key on a saved-result recovery envelope, nor on protocol 3", () => {
    const hx = (v: string) => v.repeat(64);
    const amount = (n: number) => ({ tokens: n, activeMs: n, attempts: n, sessions: n });
    const ledger = dispatchEnvelopeSchema.parse({
      schema: "orca-dispatch-envelope-v1", phase: "work", groupId: "g1", workItemId: "w1", runId: "run-1", generation: 2,
      claimIdentity: "claim-identity-1", ownerTokenHash: hx("a"), continuationIntentId: null, claimOrdinal: 1, derivedContractHash: hx("b"),
      grants: { work: amount(5), handoff: amount(3) }, profiles: { estimator: null, worker: { profileId: "worker", profileHash: hx("9") }, handoff: { profileId: "handoff", profileHash: hx("9") } },
    });
    const row = { groupId: "g1", workItemId: "w1", taskId: "t1", runId: "run-1", generation: 2, graphVersion: 4, targetVersion: 7, commandId: "start-g1-w1",
      configHash: hx("c"), agent: { agent: "claude", model: "m", contextWindow: 1_000_000 }, grant: { work: amount(5), handoff: amount(3) }, ownerToken: "owner-token-1" };
    const work = { sourceDir: "/tmp/src", targetRepo: "/tmp/repo", base: "v1", attemptDelivery: "ref-v1" as const };
    const protocol3 = toStartEnvelope(ledger, row, work, { objective: "ship" });
    expect(protocol3.protocol).toBe(3);
    expect(Object.hasOwn(protocol3.work, "attemptDelivery")).toBe(false);
    const protocol4 = toStartEnvelope(ledger, { ...row, tokenPolicy: { authoredTokenCeiling: null, bindingCauses: [], inheritedUsage: amount(0) } }, work, { objective: "ship" });
    expect(protocol4.protocol).toBe(4);
    expect(protocol4.work.kind === "loop" && protocol4.work.attemptDelivery).toBe("ref-v1");
  });
});

/**
 * §5.5.4, §5.8 row 2 (as amended): a v2 archive's saved-result source is `legacy-published-candidate-v2` (sourceRecord), and
 * a ccloop that does not read v2 is not handed one. The source port answers features as `reads` says and records the
 * authority kind of every source package it is handed; ccloop itself is not asked whether the run is eligible.
 */
describe("the saved-result source kind of a v2 archive (§5.5.4)", { timeout: 60_000 }, () => {
  async function failedRun(options: { attemptRef: boolean; reads: { v2: boolean } }) {
    const kinds: string[] = [];
    let runId = "";
    let t: T;
    t = await driverHarness([{ taskId: "a", tokenBudget: 4_000_000 }], {
      behaviour: () => "failed", sealedOwnerProof: true, tokenPolicy: "optional-v1", attemptRef: options.attemptRef,
      // ccloop's run/loop-state.json, which sourceRecord reads from the archive's logs for the source attempt.
      duringCollect: async () => { const dir = join(t.body(runId).drive.sourceDir, "run"); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "loop-state.json"), JSON.stringify({ currentAttempt: 1 })); },
      wrapPort: (port: ExecutionPort) => ({ ...port,
        readFeatures: async () => ({ protocol: 1 as const, tokenPolicy: "optional-v1" as const, savedResultRecovery: "v1" as const, ...(options.reads.v2 ? { attemptRef: "v1" as const } : {}) }),
        savedResultSourceEligibility: async (input: { packagePath: string }) => {
          kinds.push(String(JSON.parse(readFileSync(join(input.packagePath, "package.json"), "utf8")).authorityKind));
          return { status: "unavailable" as const, reason: "source-port-asked" };
        } }) });
    runId = await t.claim();
    await t.until(t.driver(), () => t.body(runId).state === "blocked");
    // The eligibility read resolves the source's port through the service's router: the wrapped port above.
    const service = new WebControlService({ ...(t.service as unknown as { deps: object }).deps, profileRouter: t.deps.router } as never);
    return { t, runId, kinds, eligibility: () => service.savedResultEligibility(runId) };
  }

  // Mutation: sourceRecord names legacy-published-candidate-v1 whatever the snapshot's version -> red here; naming v2 for
  // every archive -> red in the v1 row below.
  it("names legacy-published-candidate-v2 for a v2 archive, and -v1 for a v1 archive", async () => {
    const v2 = await failedRun({ attemptRef: true, reads: { v2: true } }); try {
      expect(v2.t.body(v2.runId).drive.snapshotVersion).toBe(2);
      expect(await v2.eligibility()).toEqual({ status: "unavailable", reason: "source-port-asked" });
      expect(v2.kinds).toEqual(["legacy-published-candidate-v2"]);
    } finally { await v2.t.h.dispose(); }
    const v1 = await failedRun({ attemptRef: false, reads: { v2: false } }); try {
      expect(v1.t.body(v1.runId).drive.snapshotVersion).toBeUndefined();
      expect(await v1.eligibility()).toEqual({ status: "unavailable", reason: "source-port-asked" });
      expect(v1.kinds).toEqual(["legacy-published-candidate-v1"]);
    } finally { await v1.t.h.dispose(); }
  });

  // Mutation: drop the saved-result-source-v2-unsupported refusal -> the port is handed the v2 package, red.
  it("is refused by name, before the source port is asked, under a ccloop that does not read v2", async () => {
    const reads = { v2: true };
    const run = await failedRun({ attemptRef: true, reads }); try {
      reads.v2 = false;
      expect(await run.eligibility()).toEqual({ status: "unavailable", reason: "saved-result-source-v2-unsupported" });
      expect(run.kinds).toEqual([]);
    } finally { await run.t.h.dispose(); }
  });
});
