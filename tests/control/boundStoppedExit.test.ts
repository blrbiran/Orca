import { describe, expect, it } from "vitest";
import { isBoundStoppedRun } from "../../src/control/driveRecord.js";
import { readWork } from "../../src/control/queries.js";
import { readControlRecovery } from "../../src/panel/controlViews.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { en } from "../../web/src/locales/en.js";
import { zh } from "../../web/src/locales/zh.js";

/**
 * Salvage narrow fix (plan 2026-11-18 tester batch D, D5; review-salvage-accept.md §1 "Shape B is a dead end", §3; human
 * ruling: give Orca-boundary-stopped runs a close/retry exit and a recovery-list row). A run whose ccloop attempt
 * succeeded but whose result Orca's own harvest bound refused (`blocked` at C, outcome `succeeded`, `out-of-bounds:<paths>`)
 * could not be retried (`outcome:succeeded`), closed (`run-closure-not-terminal`) or accepted, and was not listed in
 * `recovery list`: only archiving the group or abandoning ended it. Now it is listed with its paths, closed by close-run
 * and retried by task retry -- `--after <sibling>` named when the path is a parallel sibling's frozen claim.
 */

/** A v3-shaped task (allowlist = its target) whose attempt also wrote outside it: ccloop let it through, Orca's bound did not. */
async function outsideWrite() {
  const t = await driverHarness([{ taskId: "a", safetyPolicy: { allowlistPaths: ["a"] } }], { files: () => ({ a: "a\n", "elsewhere.txt": "x\n" }), sealedOwnerProof: true });
  const runId = await t.claim();
  const driver = t.driver();
  await t.until(driver, () => t.body(runId).state === "blocked");
  expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", outcome: "succeeded", blockedReason: "out-of-bounds:elsewhere.txt" });
  return { t, driver, runId };
}

const run = (t: Awaited<ReturnType<typeof driverHarness>>, runId: string) => t.body(runId);
const active = (t: Awaited<ReturnType<typeof driverHarness>>, runId: string) => Number(t.h.store.db.prepare("SELECT active FROM runs WHERE id=?").get(runId)!.active);

describe("a run Orca's own bound stopped can be seen, closed and retried (salvage narrow fix)", { timeout: 120_000 }, () => {
  it("is listed in recovery list with its out-of-bounds paths, and close-run then task retry end it", async () => {
    const { t, runId } = await outsideWrite();
    try {
      expect(isBoundStoppedRun(run(t, runId))).toBe(true);
      // mutation: terminalRunRows keeps skipping a succeeded outcome -> no row, red here.
      expect(readControlRecovery(t.h.store, "e").terminalRuns).toEqual([{ groupId: "g", taskId: "a", runId, outcome: "succeeded", next: "close-run", outOfBounds: ["elsewhere.txt"] }]);
      // mutation: drop isBoundStoppedRun from close-run -> run-closure-not-terminal, red here.
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ result: { kind: "run-closed", alreadyClosed: false } });
      expect([active(t, runId), run(t, runId).state, readWork(t.h.store, "g", "a").status]).toEqual([0, "settled-failed", "blocked"]);
      expect(isBoundStoppedRun(run(t, runId))).toBe(true);
      expect(readControlRecovery(t.h.store, "e").terminalRuns ?? []).toEqual([]);
      // A second close is the same closure, answered as such.
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ result: { kind: "run-closed", alreadyClosed: true } });
      // mutation: drop isBoundStoppedRun from retry-task (or from validTerminalClosure) -> task-not-retryable, red here.
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }))).toMatchObject({ result: { kind: "task-retried", taskId: "a", fromRunId: runId } });
      expect(readWork(t.h.store, "g", "a").status).toBe("ready");
    } finally { await t.h.dispose(); }
  });

  it("task retry works on it directly, without closing it first", async () => {
    const { t, runId } = await outsideWrite();
    try {
      // mutation: drop isBoundStoppedRun from retry-task -> task-not-retryable outcome:succeeded, red here.
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }))).toMatchObject({ result: { kind: "task-retried", taskId: "a", fromRunId: runId } });
      expect([active(t, runId), run(t, runId).state, readWork(t.h.store, "g", "a").status]).toEqual([0, "settled-failed", "ready"]);
    } finally { await t.h.dispose(); }
  });

  it("names the sibling to retry after when the path is a parallel sibling's frozen claim", async () => {
    // a and b are v4 tasks with no order between them: each one's target is the other's frozen claim (Orca's bound denies it).
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { files: (id): Record<string, string> => (id === "a" ? { a: "a\n", b: "from a\n" } : { b: "b\n" }), sealedOwnerProof: true });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      expect(t.body(runId).taskId).toBe("a");
      await t.until(driver, () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ outcome: "succeeded", blockedReason: "out-of-bounds:b" });
      expect(readControlRecovery(t.h.store, "e").terminalRuns).toEqual([{ groupId: "g", taskId: "a", runId, outcome: "succeeded", next: "close-run", outOfBounds: ["b"], retryAfter: "b" }]);
    } finally { await t.h.dispose(); }
  });

  it("a succeeded run that landed is still refused by close-run and task retry", async () => {
    const t = await driverHarness([{ taskId: "a" }], { sealedOwnerProof: true });
    try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).drive?.cleanedUp === true);
      expect(isBoundStoppedRun(run(t, runId))).toBe(false);
      expect(t.service.closeRun(t.h.command("close-run", { runId }))).toHaveProperty("error");
      expect(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }))).toHaveProperty("error");
      expect(readControlRecovery(t.h.store, "e").terminalRuns ?? []).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  // Review I5: the exit is Orca's harvest bound's alone. A run blocked at C with outcome succeeded for another reason --
  // executionDriver.ts step C's `multi-dir-writes-missing` (a multi-directory run with no directory record) -- keeps no exit.
  it("a succeeded run blocked at C for another reason (multi-dir-writes-missing) is still refused by task retry and close-run", async () => {
    const { t, runId } = await outsideWrite();
    try {
      const body = t.body(runId);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, drive: { ...body.drive, blockedReason: "multi-dir-writes-missing" } }), runId);
      // mutation: drop the OUT_OF_BOUNDS_BLOCK prefix check from isBoundStoppedRun -> true, both accepted, red here.
      expect.soft(isBoundStoppedRun(run(t, runId))).toBe(false);
      expect.soft(t.service.retryTask(t.h.command("retry-task", { taskId: "a", runId }))).toMatchObject({ error: { code: "task-not-retryable" } });
      expect.soft(t.service.closeRun(t.h.command("close-run", { runId }))).toMatchObject({ error: { code: "run-closure-not-terminal" } });
      expect.soft(readControlRecovery(t.h.store, "e").terminalRuns ?? []).toEqual([]);
      expect([active(t, runId), run(t, runId).state]).toEqual([1, "blocked"]);
    } finally { await t.h.dispose(); }
  });

  // Minor (review of D5): a multi-directory run's reason is `out-of-bounds:<key>:<paths>;<key2>:<paths>` (step C); each path
  // is listed with its directory, not split at the colon or the comma into bare fragments.
  it("a multi-directory run's out-of-bounds paths keep their directory", async () => {
    const { t, runId } = await outsideWrite();
    try {
      const body = t.body(runId);
      t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify({ ...body, drive: { ...body.drive, blockedReason: "out-of-bounds:repo:a.txt,b.txt;extra:c.txt", dirs: [{ key: "repo" }, { key: "extra" }] } }), runId);
      // mutation: split the reason at ";" and "," only -> ["repo:a.txt", "b.txt", "extra:c.txt"], red here.
      expect(readControlRecovery(t.h.store, "e").terminalRuns).toEqual([expect.objectContaining({ runId, outOfBounds: ["repo:a.txt", "repo:b.txt", "extra:c.txt"] })]);
    } finally { await t.h.dispose(); }
  });

  it("the run's fallback next step names the two commands that end it, not \"an offered recovery action\"", () => {
    for (const text of [en.control.diagnosis.next.unknown, zh.control.diagnosis.next.unknown]) {
      expect(text).toContain("orca task retry");
      expect(text).toContain("orca group close-run");
    }
  });
});
