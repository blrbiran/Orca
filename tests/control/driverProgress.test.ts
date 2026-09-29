import { describe, expect, it } from "vitest";
import { collectInto, readDriverRun } from "../../src/control/executionDriver.js";
import { readProjectionState } from "../../src/control/projectionJournal.js";
import type { RunProgress } from "../../src/control/schema.js";
import { progressOfRun, readControlGroup } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Labels and progress spec §2.6, §3.4, §4.1 and §8 R1-R3, R5, R10, R11, R18 (plan Task 5). The synthetic ccloop
 * (fixtures/driverPort.ts) is left exactly as it is (R5): `answerProgress` wraps the port the driver resolves to add a
 * progress answer. It wraps the router, not `t.fake.port`: the router binds the port's methods when it is built
 * (profiles.ts ownPort), so a collect replaced on the fake afterwards is never called.
 */
type Harness = Awaited<ReturnType<typeof driverHarness>>;
const progress = (status: RunProgress["status"], over: Partial<RunProgress> = {}): RunProgress => ({
  status, currentAttempt: 1, attemptsUsed: 1, attemptsRemaining: 2, lastTransitionAt: "2026-09-29T00:00:00.000Z", ...over,
});
function answerProgress(t: Harness, next: () => RunProgress | null | undefined): void {
  const router = t.deps.router;
  t.deps.router = {
    ...router,
    resolve(workKind, profileId, expectedHash) {
      const profile = router.resolve(workKind, profileId, expectedHash);
      const collect = profile.port.collect.bind(profile.port);
      return { ...profile, port: { ...profile.port, async collect(envelope, afterSeq) {
        const report = await collect(envelope, afterSeq);
        const value = next();
        return value === undefined ? report : { ...report, progress: value };
      } } };
    },
  };
}
/** Drives a claimed run to `accepted` (one driver step per round), leaving collection to the criterion. */
async function accepted(t: Harness): Promise<string> {
  const runId = await t.claim();
  await t.until(t.driver(), () => t.body(runId).state === "accepted");
  return runId;
}
const groupBody = (t: Harness) => JSON.parse(String(t.h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body));
const changeSeq = (t: Harness): number => readProjectionState(t.h.store).changeSeq;
const item = (t: Harness) => readControlGroup(t.h.store, "epoch", "g").workItems[0]!;
function patchRun(t: Harness, runId: string, patch: (body: Record<string, any>) => void): void {
  const body = t.body(runId);
  patch(body);
  t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
}
const amount = (tokens: number) => ({ tokens, activeMs: 0, attempts: 0, sessions: 0 });

describe("collectInto stores ccloop's progress (spec §3.4, §8 R2, R3, R5)", () => {
  it("R2: books exactly the usage of a collect without progress, and nothing twice", async () => {
    const plain = await driverHarness([{ taskId: "a" }]);
    const withProgress = await driverHarness([{ taskId: "a" }]);
    try {
      answerProgress(withProgress, () => progress("executing"));
      const plainRun = await accepted(plain), progressRun = await accepted(withProgress);
      await collectInto(plain.deps, readDriverRun(plain.h.store, plainRun));
      await collectInto(withProgress.deps, readDriverRun(withProgress.h.store, progressRun));
      const expected = plain.body(plainRun), actual = withProgress.body(progressRun);
      expect(actual.progress).toEqual(progress("executing"));
      expect(actual.cumulative.work.tokens).toBe(10);
      expect(actual.cumulative).toEqual(expected.cumulative);
      expect(actual.remaining).toEqual(expected.remaining);
      expect(actual.highWater).toBe(expected.highWater);
      expect(groupBody(withProgress).used).toEqual(groupBody(plain).used);
      await collectInto(withProgress.deps, readDriverRun(withProgress.h.store, progressRun));
      expect(withProgress.body(progressRun).cumulative).toEqual(expected.cumulative);
      expect(groupBody(withProgress).used).toEqual(groupBody(plain).used);
    } finally { await plain.h.dispose(); await withProgress.h.dispose(); }
  });

  it("P3: writes progress only when it changed, and each change moves changeSeq exactly once", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      let answer: RunProgress | null = progress("planning");
      answerProgress(t, () => answer);
      const runId = await accepted(t);
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      const settled = changeSeq(t);
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(changeSeq(t)).toBe(settled);
      answer = progress("executing", { lastTransitionAt: "2026-09-29T00:00:01.000Z" });
      await collectInto(t.deps, readDriverRun(t.h.store, runId));
      expect(changeSeq(t)).toBe(settled + 1);
      expect(t.body(runId).progress).toEqual(answer);
    } finally { await t.h.dispose(); }
  });

  it("P3/R1: a null answer over a run that never had progress is not a change; a port with no progress field writes nothing", async () => {
    for (const answer of [null, undefined] as const) {
      const t = await driverHarness([{ taskId: "a" }]);
      try {
        answerProgress(t, () => answer);
        const runId = await accepted(t);
        await collectInto(t.deps, readDriverRun(t.h.store, runId));
        const settled = changeSeq(t);
        await collectInto(t.deps, readDriverRun(t.h.store, runId));
        expect(changeSeq(t)).toBe(settled);
        expect("progress" in t.body(runId)).toBe(false);
      } finally { await t.h.dispose(); }
    }
  });
});

describe("a work item's progress in the group view (spec §4.1, criterion P4; §8 R1, R10, R11, R18, R19)", () => {
  it("R1/R10/R19: none without a run; a run from before progress existed reads, with nothing ccloop said yet", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      expect(item(t).progress).toBeNull();
      const runId = await t.claim();
      expect("progress" in t.body(runId)).toBe(false);
      expect(item(t).progress).toEqual({ runId, step: null, attempt: null, tokens: { used: 0, grant: t.body(runId).grant.work.tokens }, lastTransitionAt: null });
    } finally { await t.h.dispose(); }
  });

  it("R18: maps ccloop's status to the step and takes both attempt numbers from ccloop's one snapshot", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const runId = await t.claim();
      const steps = [["queued", "queued"], ["planning", "plan"], ["executing", "execute"], ["verifying", "verify"], ["succeeded", "succeeded"],
        ["blocked_waiting_human", "blocked_waiting_human"], ["exhausted", "exhausted"], ["cancelled", "cancelled"], ["failed", "failed"]] as const;
      for (const [status, step] of steps) {
        patchRun(t, runId, (body) => { body.progress = progress(status, { currentAttempt: 5, attemptsUsed: 40, attemptsRemaining: 30 }); });
        expect(item(t).progress).toMatchObject({ runId, step, attempt: { current: 5, max: 70 }, lastTransitionAt: "2026-09-29T00:00:00.000Z" });
      }
    } finally { await t.h.dispose(); }
  });

  it("R11: tokens are null -- never 0 -- when the run's usage is unknown or it overran", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      const runId = await t.claim();
      const grant = t.body(runId).grant.work.tokens;
      expect(item(t).progress?.tokens).toEqual({ used: 0, grant });
      patchRun(t, runId, (body) => { body.unknown.work = true; });
      expect(item(t).progress?.tokens).toBeNull();
      patchRun(t, runId, (body) => { body.unknown.work = false; body.breaches = [1]; });
      expect(item(t).progress?.tokens).toBeNull();
    } finally { await t.h.dispose(); }
  });

  it("R11: counts a handoff-phase run in its handoff bucket", () => {
    const run = { runId: "run-h", phase: "handoff" as const, grant: { work: amount(100), handoff: amount(10) }, cumulative: { work: amount(40), handoff: amount(3) },
      unknown: { work: true, handoff: false }, breaches: [] as number[], progress: null };
    expect(progressOfRun(run).tokens).toEqual({ used: 3, grant: 10 });
    expect(progressOfRun({ ...run, unknown: { work: false, handoff: true } }).tokens).toBeNull();
  });
});
