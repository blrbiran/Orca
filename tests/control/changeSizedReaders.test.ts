import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { latestRunSnapshot } from "../../src/control/acceptAttempt.js";
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
