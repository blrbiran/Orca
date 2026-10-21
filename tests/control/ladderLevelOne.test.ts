import { describe, expect, it } from "vitest";
import { writeArtifact } from "../../src/control/archive.js";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { boundLastFailure } from "../../src/control/driveRecord.js";
import { replenishStartWakes } from "../../src/control/executionDriver.js";
import { buildPriorFailures, headBytes, predecessorPriorFailures, priorFailureOf, priorFailuresAtPrepare } from "../../src/control/priorFailures.js";
import { startEnvelopeSchema } from "../../src/control/schema.js";
import { readCanonicalRecord, writeCanonicalRecord } from "../../src/control/snapshot.js";
import { saveTaskResultState } from "../../src/control/taskResultStore.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import { readWebGroup, WebControlService } from "../../src/control/webService.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Kanban spec §6 level 1, ccloop priorFailures spec 2026-10-21 §3: a started group's task whose run ended failed is first
 * re-dispatched once as orca-auto, and that fresh run's envelope carries what Orca stored about the earlier failed runs of
 * the task -- category, command, cause, and evidence only from the collector's stored copy that matches the fingerprint.
 */
const CAUSE = { cause: "required-check-failed", phase: "verify" as const, retries: 0, detail: null };
const LAST = { rejectCategory: "required-check-failed", failingCommand: "node check.js", primaryTargetPaths: ["src/a.js"] };

async function levelOneWorld(failure: () => { failureCause?: typeof CAUSE | { cause: string; phase: null; retries: number; detail: null }; lastFailure?: typeof LAST } | undefined) {
  let failing = true;
  const t = await driverHarness([{ taskId: "a" }], { behaviour: () => (failing ? "failed" : "succeed"), failure });
  const limit = readWebGroup(t.h.store, "g").ledger.groupLimit;
  const raised = t.service.setLimit(t.h.command("set-limit", { limit: { ...limit, attempts: limit.attempts + 10, sessions: limit.sessions + 10 } }));
  if ("error" in raised) throw new Error(`set-limit refused: ${JSON.stringify(raised.error)}`);
  const service = new WebControlService({ ...t.h.deps, knownRepository: (repoId: string) => repoId === "repo", resolveRepository: () => t.repo });
  const driver = t.driver();
  const blockedRun = async (runId: string) => { await t.until(driver, () => t.body(runId).state === "blocked", 120); return runId; };
  const redispatched = async (): Promise<string> => {
    replenishStartWakes({ store: t.h.store, admissionGate: t.h.deps.admissionGate });
    const delivered = await deliverScheduledStart(t.dispatch, "g");
    if (delivered.kind !== "claimed") throw new Error(`claim refused: ${JSON.stringify(delivered)}`);
    await t.until(driver, () => t.body(delivered.runId).drive?.prepared === true, 120);
    return delivered.runId;
  };
  const envelopeWork = (runId: string) => (JSON.parse(readCanonicalRecord(t.h.store, t.body(runId).drive.envelopeHash)) as { work: Record<string, unknown> }).work;
  return { t, service, driver, blockedRun, redispatched, envelopeWork, succeedNext: () => { failing = false; } };
}

describe("ladder level 1: one re-dispatch carrying the earlier failures (kanban spec §6, priorFailures spec §3)", { timeout: 180_000 }, () => {
  it("re-dispatches the failed task once as orca-auto, and the fresh run's envelope names the failed run", async () => {
    const w = await levelOneWorld(() => ({ failureCause: CAUSE, lastFailure: LAST })); const { t } = w; try {
      const first = await w.blockedRun(await t.claim());
      // The first run carried nothing: there was no earlier failure (absent keeps the envelope's bytes).
      expect("priorFailures" in w.envelopeWork(first)).toBe(false);
      const pass = await w.service.systemDebugPass();
      // mutation: skip level 1 (open the ladder group at once) -> redispatched [] and opened [ladder], red
      expect([pass.redispatched, pass.opened]).toEqual([["g:a"], []]);
      const row = t.h.store.db.prepare("SELECT actor_id FROM commands WHERE group_id='g' AND id='orca-auto-ladder-l1-a'").get();
      expect(row?.actor_id).toBe("orca-auto");
      // A second pass while the re-dispatch is pending does nothing more.
      expect((await w.service.systemDebugPass()).redispatched).toEqual([]);
      const second = await w.redispatched();
      // mutation: A2 never builds priorFailures -> key absent, red
      expect(w.envelopeWork(second).priorFailures).toEqual([
        { runId: first, rejectCategory: "required-check-failed", failingCommand: "node check.js", evidence: null, failureCause: "required-check-failed" },
      ]);
    } finally { await t.h.dispose(); }
  });

  it("does not re-dispatch a task whose run failed on auth (the person's, failure-cause spec §5)", async () => {
    const w = await levelOneWorld(() => ({ failureCause: { cause: "auth", phase: null, retries: 0, detail: null } })); const { t } = w; try {
      await w.blockedRun(await t.claim());
      expect((await w.service.systemDebugPass()).redispatched).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("a run that failed without a rejection is named by its cause, or as unknown", async () => {
    const w = await levelOneWorld(() => undefined); const { t } = w; try {
      const first = await w.blockedRun(await t.claim());
      await w.service.systemDebugPass();
      const second = await w.redispatched();
      // mutation: a run without lastFailure is skipped -> [], red
      expect(w.envelopeWork(second).priorFailures).toEqual([{ runId: first, rejectCategory: "run-failed:unknown", failingCommand: null, evidence: null }]);
    } finally { await t.h.dispose(); }
  });
});

describe("priorFailures.ts: what an earlier failed run contributes (priorFailures spec §2.1, §3)", () => {
  it("headBytes keeps at most the bound in UTF-8 bytes, cut on a code point, with the omitted count", () => {
    const text = "中".repeat(2000); // 6000 bytes
    const cut = headBytes(text, 4096);
    // mutation: count UTF-16 units (text.length) -> 2000 <= 4096, returned whole, red
    expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(4096);
    expect(cut).toMatch(/^(中)+…\[\d+ bytes omitted\]$/);
    const kept = Buffer.byteLength(cut.slice(0, cut.indexOf("…")), "utf8");
    expect(cut).toContain(`…[${6000 - kept} bytes omitted]`);
    expect(headBytes("short", 4096)).toBe("short");
  });

  it("takes evidence only from a stored verification whose fingerprint matches, and only once the collector settled", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" }); try {
      const store = t.h.store;
      const verification = (paths: string[]) => Buffer.from(JSON.stringify({ approved: false, rejectCategory: "required-check-failed", primaryTargetPaths: paths, failingCommand: "node check.js", safeToRetry: false, evidence: ["stdout=boom", ""], pauseSignals: [], stopSignals: [] }));
      const match = await writeArtifact(store, "verify-match", verification(["src/a.js"]));
      const other = await writeArtifact(store, "verify-other", verification(["src/b.js"]));
      const manifest = (attempt: number, ref: { artifactId: string; hash: string }) => ({ manifestRef: ref, manifest: { attempt, stage: "verification", verificationRef: ref }, verification: "failed" });
      const save = (status: string, observations: unknown[]) => saveTaskResultState(store, "run-x", "g", { schema: "orca-task-result-store-v1", identity: { runId: "run-x" } as never, revision: 1, sourceRevision: 1, currentAttempt: 2, observations: observations as never, status: status as never, reason: null });
      const run = { runId: "run-x", drive: { failureCause: CAUSE, lastFailure: LAST } as never };
      // The latest attempt does not match; an earlier one does.
      save("available", [manifest(1, match), manifest(2, other)]);
      // mutation: drop the fingerprint test -> attempt 2's copy taken; mutation: keep empty entries -> ["stdout=boom", ""], red
      expect((await priorFailureOf(store, run)).evidence).toEqual(["stdout=boom"]);
      save("stale", [manifest(1, match)]);
      // mutation: ignore the collector's status -> evidence taken, red
      expect((await priorFailureOf(store, run)).evidence).toBeNull();
      save("available", [manifest(1, match)]);
      // A last rejection recorded without its paths (an older record) matches nothing.
      expect((await priorFailureOf(store, { runId: "run-x", drive: { lastFailure: { rejectCategory: LAST.rejectCategory, failingCommand: LAST.failingCommand } } as never })).evidence).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("the stored last rejection keeps its whole fingerprint, or none of the paths", () => {
    // mutation: boundLastFailure drops primaryTargetPaths -> the evidence match can never succeed, red
    expect(boundLastFailure({ rejectCategory: "c", failingCommand: null, primaryTargetPaths: ["a", "b"] })).toEqual({ rejectCategory: "c", failingCommand: null, primaryTargetPaths: ["a", "b"] });
    // A fingerprint that does not fit is dropped whole, never cut (a cut one would match the wrong copy).
    // mutation: slice to the first 64 paths -> 64 kept, red
    expect("primaryTargetPaths" in boundLastFailure({ rejectCategory: "c", failingCommand: null, primaryTargetPaths: Array.from({ length: 65 }, (_, i) => `p${i}`) })).toBe(false);
  });

  it("carries the latest three earlier failed runs of the same task, oldest first", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" }); try {
      const store = t.h.store;
      const body = (runId: string, taskId: string, failed: boolean) => JSON.stringify({ runId, taskId, state: failed ? "blocked" : "settled", drive: { blockedAt: failed ? "C" : null, outcome: failed ? "failed" : "succeeded" } });
      const insert = store.db.prepare("INSERT INTO runs(id, group_id, work_item_id, generation, active, body) VALUES (?, 'g', 'a', 1, 0, ?)");
      for (const [runId, taskId, failed] of [["r1", "a", true], ["r2", "b", true], ["r3", "a", true], ["r4", "a", false], ["r5", "a", true], ["r6", "a", true]] as const) insert.run(runId, body(runId, taskId, failed));
      // mutation: newest first -> [r6, r5, r3], red; mutation: no cap -> four entries, red; mutation: any task -> r2 included, red
      expect((await buildPriorFailures(store, "g", "a", "now"))?.map((entry) => entry.runId)).toEqual(["r3", "r5", "r6"]);
      // The run being prepared is never its own earlier failure, and a task with none gets none (no key on the wire).
      expect(await buildPriorFailures(store, "g", "c", "now")).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("a continuation copies its predecessor's frozen entries byte for byte", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "failed" }); try {
      const store = t.h.store;
      const entries = [{ runId: "r1", rejectCategory: "run-failed:stalled", failingCommand: null, evidence: null, failureCause: "stalled" }];
      const work = { kind: "loop", priorFailures: entries };
      const canonical = canonicalBytes({ work }).toString("utf8");
      const hash = sha256Canonical({ work });
      writeCanonicalRecord(store, "g", hash, canonical);
      store.db.prepare("INSERT INTO runs(id, group_id, work_item_id, generation, active, body) VALUES ('pred', 'g', 'a', 1, 0, ?)").run(JSON.stringify({ runId: "pred", drive: { envelopeHash: hash } }));
      // mutation: rebuild instead of copy (or drop on successor) -> undefined, red
      expect(predecessorPriorFailures(store, "pred")).toEqual(entries);
      // At A2 (priorFailuresAtPrepare): a continuation copies, a saved-result recovery carries none, a fresh run builds.
      // mutation: A2 ignores the predecessor (always builds) -> undefined (task "a" has no failed run here), red
      expect(await priorFailuresAtPrepare(store, { groupId: "g", taskId: "a", runId: "now" }, { recovery: false, predecessorRunId: "pred" })).toEqual(entries);
      // mutation: a recovery copies too -> entries, red
      expect(await priorFailuresAtPrepare(store, { groupId: "g", taskId: "a", runId: "now" }, { recovery: true, predecessorRunId: "pred" })).toBeUndefined();
    } finally { await t.h.dispose(); }
  });

  it("the start envelope refuses them with a saved-result recovery, and bounds them in UTF-8 bytes", () => {
    const hx = (v: string) => v.repeat(64);
    const amount = (n: number) => ({ tokens: n, activeMs: n, attempts: n, sessions: n });
    const claim = {
      groupId: "g", workItemId: "w", taskId: "a", runId: "run-1", generation: 1, graphVersion: 1, targetVersion: 1, commandId: "c",
      configHash: hx("a"), agent: { agent: "claude", model: "claude-opus-5-5", contextWindow: 1_000_000 }, grant: { work: amount(5), handoff: amount(0) }, ownerToken: "owner",
    };
    const entry = { runId: "r1", rejectCategory: "required-check-failed", failingCommand: null, evidence: null };
    const envelope = (priorFailures: unknown, extra: Record<string, unknown> = {}) => ({ protocol: 3, claim, contractHash: hx("b"), inputCheckpoint: null, ...extra,
      work: { kind: "loop", contract: {}, targetRepo: "/r", base: "b", sourceDir: "/s", priorFailures } });
    const ok = (value: unknown) => startEnvelopeSchema.safeParse(value).success;
    expect(ok(envelope([entry]))).toBe(true);
    expect(ok(envelope([]))).toBe(false);
    expect(ok(envelope([entry, entry, entry, entry]))).toBe(false);
    // 1366 × "中" is 1366 UTF-16 units but 4098 UTF-8 bytes. mutation: .max(4096) instead of the byte refine -> accepted, red
    expect(ok(envelope([{ ...entry, evidence: ["中".repeat(1366)] }]))).toBe(false);
    expect(ok(envelope([{ ...entry, evidence: ["中".repeat(1365)] }]))).toBe(true);
    // A saved-result recovery builds no prompt: ccloop refuses them there. mutation: drop the refusal -> accepted, red
    const recovery = { mode: "verify-saved-result", protocol: 4, savedResultRecovery: { packagePath: "/p", packageHash: hx("c"), admissionHash: hx("d"), recoveryOf: { sourceRunId: "r0", sourceAttempt: 1, capsuleHash: hx("e"), snapshotHash: hx("f"), normalizedExecutionHash: hx("1") } } };
    expect(ok({ ...envelope(undefined, recovery), work: { kind: "loop", contract: {}, targetRepo: "/r", base: "b", sourceDir: "/s" } })).toBe(true);
    expect(ok(envelope([entry], recovery))).toBe(false);
  });
});
