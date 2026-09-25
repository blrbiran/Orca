import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Canonical } from "../../src/control/canonicalJson.js";
import { INSPECT_UNKNOWN_LIMIT, blockRun, createExecutionDriver, stepA1, stepA2 } from "../../src/control/executionDriver.js";
import { HANDOFF_EXTRA_GRACE_MS } from "../../src/control/driverHandoff.js";
import { readControlGroup } from "../../src/panel/controlViews.js";
import { exportResumeBundle } from "../../src/control/resumeBundle.js";
import { handoffRequestFromOutbox, readHandoffRequest, readStopIntent } from "../../src/control/stopIntent.js";
import { deliverScheduledStart } from "../../src/control/webDispatch.js";
import type { FakeBehaviour } from "./fixtures/driverPort.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { active, allocation, committedAndUsed, crashingAt, requestBody, requestOf, requestState, stop, work } from "./fixtures/handoffHarness.js";

// Handoff delivery spec §3 (with §11 C1-C4, I1-I5, I9; §12(2); §13.1 C-5; §13.2 C-1, I-1..I-3, I-10): the
// driver's step H against the synthetic ccloop. A stop always ends in a settled request (or outcome-unknown),
// a run's change is either landed whole or parked whole in a checkpoint, and nothing is landed half-way.

// Every scenario drives real git through many rounds; under a loaded machine the vitest default of 5 s is not a
// bound on correctness (the execution driver round saw the same, tests/control/driverSettle.test.ts).

describe("a running run under handoff-stop (spec §3 accepted row, §11 C2/C3, §13.2 C-1, I-1, I-10)", { timeout: 60_000 }, () => {
  it("delivers one request rebuilt from the outbox, H-settles a partial checkpoint, parks the task held and lands nothing", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const ledgerBefore = committedAndUsed(t);
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
      expect(t.fake.calls.handoff).toEqual([handoffRequestFromOutbox(t.h.store, requestId!)]);
      expect(t.fake.calls.handoff[0]).toMatchObject({ reason: "human", deadlineAt: readStopIntent(t.h.store, "g")!.deadlineAt });
      const run = t.body(runId);
      expect(run).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(active(t, runId)).toBe(0);
      // spec §11 C2: the commitment is parked, not released -- reserved + used is what it was before the stop.
      expect(work(t, "a")).toMatchObject({ status: "held", currentRunId: runId });
      expect(allocation(t, "a")).toMatchObject({ state: "held", amount: run.remaining.work });
      expect(committedAndUsed(t)).toEqual(ledgerBefore);
      const row = t.h.store.db.prepare("SELECT hash,body FROM checkpoints WHERE id=?").get(run.checkpointId)!;
      const checkpoint = JSON.parse(String(row.body));
      expect(String(row.hash)).toBe(sha256Canonical(checkpoint));
      expect(checkpoint).toMatchObject({ result: "partial", missing: [], unresolvedRequestIds: [], terminalOutcome: "executing" });
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(tip);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
      // The re-amounted held allocation is the ledger's own settlement: the panel's read model still reads the group
      // (plan deviation D-SNAP; without it the whole group is refused as execution-snapshot-identity).
      expect(readControlGroup(t.h.store, "epoch-test", "g").runs.map((view) => view.state)).toEqual(["settled-recoverable"]);
    } finally { await t.h.dispose(); }
  });

  it("leaves a checkpoint both continuation readers accept: exportResumeBundle and resume-from-handoff (spec §13.2 C-1)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
      const checkpointId = t.body(runId).checkpointId as string;
      const exported = await exportResumeBundle(t.h.store, { predecessorRunId: runId, newSourceDir: join(t.h.root, "bundle-probe") });
      expect(exported.checkpointHash).toBe(String(t.h.store.db.prepare("SELECT hash FROM checkpoints WHERE id=?").get(checkpointId)!.hash));
      const resumed = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [{ taskId: "a", predecessorRunId: runId, checkpointId }] }));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
    } finally { await t.h.dispose(); }
  });

  it("settles unrecoverable, by name, a stop whose aborted phase never reported its usage (Web spec §6.2 usage-unsettled; §13.1 C-3)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable-usage-unknown" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-unrecoverable");
      // A null usage is never read as zero: the checkpoint exists, but it is not one a continuation may start from.
      expect(requestBody(t, requestId!).failureCode).toBe("usage-unsettled");
      expect(t.body(runId)).toMatchObject({ state: "settled-unrecoverable", recoverable: false, failureCode: "usage-unsettled" });
      expect(t.h.store.db.prepare("SELECT id FROM checkpoints WHERE id=?").get(t.body(runId).checkpointId)).toBeDefined();
      expect(active(t, runId)).toBe(0);
      expect(work(t, "a").status).toBe("blocked");
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-partial");
    } finally { await t.h.dispose(); }
  });

  it("lands a run that finished before the stop took effect, instead of parking it (spec §3: a terminal goes back through C)", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable" && t.body(runId).drive.cleanedUp === true);
      // The request did reach ccloop (the run was accepted), but the execution's own terminal came first.
      expect(t.fake.calls.handoff).toHaveLength(1);
      expect(t.body(runId).state).toBe("settled");
      expect(work(t, "a").status).toBe("done");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).not.toBe(tip);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
    } finally { await t.h.dispose(); }
  });
});

describe("a proved stop with no terminal and no request (spec §3, X1)", { timeout: 60_000 }, () => {
  it("is blocked by name at C instead of being waited on forever", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "orphan-candidate" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "candidate-without-terminal", outcome: null });
    } finally { await t.h.dispose(); }
  });

  it("does not block a run whose stop arrived while C was collecting: the stop owns it, and H settles it", async () => {
    let armed = false;
    let requestId: string | null = null;
    const t = await driverHarness([{ taskId: "a" }], {
      behaviour: () => "orphan-candidate",
      duringCollect: async () => { if (armed && requestId === null) [requestId] = await stop(t); },
    }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "accepted");
      armed = true;
      await driver.round();
      expect(requestId).not.toBeNull();
      expect(t.body(runId).state).toBe("accepted");
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
      expect(t.body(runId)).toMatchObject({ state: "settled-recoverable", recoverable: true });
    } finally { await t.h.dispose(); }
  });
});

describe("a run that provably never started (spec §11 C4, I9; §13.2 I-3; H4)", { timeout: 60_000 }, () => {
  it("restarts a starting run: no provider call, the task is ready, and an empty resume claims it afresh", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      const [requestId] = await stop(t);
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-restartable");
      expect(t.fake.calls.accept).toHaveLength(0);
      expect(t.body(runId).state).toBe("settled-restartable");
      expect(work(t, "a").status).toBe("ready");
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
      const resumed = await t.service.resumeFromHandoff(t.h.command("resume-from-handoff", { selections: [] }));
      expect("error" in resumed ? resumed.error : resumed.result.kind).toBe("resumed-from-handoff");
      const claimed = await deliverScheduledStart(t.dispatch, "g");
      expect(claimed).toMatchObject({ kind: "claimed" });
      expect((claimed as { runId: string }).runId).not.toBe(runId);
      expect(t.body((claimed as { runId: string }).runId).state).toBe("starting");
    } finally { await t.h.dispose(); }
  });

  it("restarts a prepared run ccloop never saw (inspect absent) and removes the workspace A2 made", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      expect(stepA1(t.deps, runId)).toBe(true);
      expect(await stepA2(t.deps, runId)).toBe(true);
      const workspace = t.body(runId).drive.workspacePath as string;
      expect(existsSync(workspace)).toBe(true);
      const [requestId] = await stop(t);
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-restartable");
      expect(t.fake.calls.accept).toHaveLength(0);
      expect(t.fake.calls.inspect).toBeGreaterThan(0);
      expect(existsSync(workspace)).toBe(false);
      expect(work(t, "a").status).toBe("ready");
    } finally { await t.h.dispose(); }
  });

  it("restarts a run ccloop refused before writing anything (B accept-refused, Minor h), without asking ccloop again", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "refuse" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      const [requestId] = await stop(t);
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-restartable");
      expect(work(t, "a").status).toBe("ready");
      // A deterministic refusal (exit 2) is already the proof: whether ccloop answers an inspect now is irrelevant.
      expect(t.fake.calls.inspect).toBe(0);
    } finally { await t.h.dispose(); }
  });

  it("does not restart a prepared run whose accept reached ccloop before a death (B-after-accept under stop): it is stopped and parked", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      const crashing = crashingAt(t, "B-after-accept");
      await t.until(crashing, () => crashing.crashed !== null);
      expect(t.body(runId)).toMatchObject({ state: "start-pending", executionId: null });
      const [requestId] = await stop(t);
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-recoverable");
      expect(t.fake.calls.accept).toHaveLength(1);
      expect(work(t, "a").status).toBe("held");
    } finally { await t.h.dispose(); }
  });
});

describe("a run whose start ccloop cannot confirm under a stop (plan deviation D-STOPINSPECT)", { timeout: 60_000 }, () => {
  it("counts unknown inspections as B' does and, at the limit, turns the request outcome-unknown and leaves the run alone", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "unknown" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "unknown");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "outcome-unknown");
      expect(requestBody(t, requestId!).failureCode).toBe("inspect-unknown");
      expect(t.fake.calls.inspect).toBe(INSPECT_UNKNOWN_LIMIT);
      // Blocking the run (what B' does at the limit) means nothing under a stop; the request is what must close.
      expect(t.body(runId)).toMatchObject({ state: "unknown", drive: { blockedAt: null, inspectUnknown: INSPECT_UNKNOWN_LIMIT } });
      expect(active(t, runId)).toBe(1);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-unresolved");
    } finally { await t.h.dispose(); }
  });
});

describe("a run already landing is not interrupted (spec §3, §11 C1; H5)", { timeout: 60_000 }, () => {
  it("lands and settles as usual, then its request settles on its own; the task is done, not held", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "collected");
      const tip = git(t.repo, "rev-parse", "refs/heads/orca/g");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable" && t.body(runId).drive.cleanedUp === true);
      expect(t.fake.calls.handoff).toHaveLength(0);
      expect(t.body(runId).state).toBe("settled");
      expect(work(t, "a").status).toBe("done");
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).not.toBe(tip);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
    } finally { await t.h.dispose(); }
  });

  it("settles the request after a death between the run's settle and the request's (R-H H-between-commit-and-settle)", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "collected");
      const [requestId] = await stop(t);
      const crashing = crashingAt(t, "H-between-commit-and-settle");
      await t.until(crashing, () => crashing.crashed !== null);
      expect(t.body(runId).state).toBe("settled");
      expect(requestState(t, requestId!)).toBe("request-pending");
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-recoverable");
      expect(work(t, "a").status).toBe("done");
    } finally { await t.h.dispose(); }
  });
});

describe("nothing arrives (spec §3 grace, §11 I3)", { timeout: 60_000 }, () => {
  it("turns the request outcome-unknown past deadline + grace, keeps collecting without killing, and H-settles a late candidate", async () => {
    let behaviour: FakeBehaviour = "stoppable-silent";
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => behaviour }); try {
      const runId = await t.claim();
      let now = Date.now();
      const driver = createExecutionDriver({ ...t.deps, now: () => new Date(now) });
      await t.until(driver, () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      await t.until(driver, () => requestState(t, requestId!) === "collecting");
      await driver.round();
      expect(requestState(t, requestId!)).toBe("collecting");
      // The deadline alone is not the bound: ccloop is given its kill grace plus the extra minute to answer.
      const deadline = Date.parse(readHandoffRequest(t.h.store, "g", requestId!).request.deadlineAt);
      now = deadline + HANDOFF_EXTRA_GRACE_MS;
      await driver.round();
      expect(requestState(t, requestId!)).toBe("collecting");
      now = deadline + HANDOFF_EXTRA_GRACE_MS + 1;
      await t.until(driver, () => requestState(t, requestId!) === "outcome-unknown");
      expect(t.body(runId).state).toBe("accepted");
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-unresolved");
      behaviour = "stoppable";
      await t.until(driver, () => requestState(t, requestId!) === "settled-recoverable");
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
    } finally { await t.h.dispose(); }
  });
});

describe("blocked runs under a stop (spec §11 I1, §13.1 C-5, §13.2 I-3; H8)", { timeout: 60_000 }, () => {
  it("closes a run blocked after its execution ended from its collected result, beside a running run", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }], { behaviour: (id) => id === "a" ? "exhausted" : "stoppable" }); try {
      const [a, b] = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await t.until(driver, () => t.body(a!).state === "blocked" && t.body(b!).state === "accepted");
      expect(t.body(a!).drive).toMatchObject({ blockedAt: "C", outcome: "exhausted" });
      await stop(t);
      await t.until(driver, () => [a!, b!].every((runId) => requestState(t, requestOf(t, runId)) === "settled-recoverable"));
      expect([t.body(a!).state, t.body(b!).state]).toEqual(["settled-recoverable", "settled-recoverable"]);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-complete");
    } finally { await t.h.dispose(); }
  });

  it("parks a run whose conflict the group cannot afford as held with a partial checkpoint (human ruling §13.1 C-5)", async () => {
    const t = await driverHarness([{ taskId: "a", targetPaths: ["shared.txt"] }, { taskId: "b", targetPaths: ["shared.txt"] }],
      { files: (id) => ({ "shared.txt": id === "a" ? "A\n" : "B\n" }) }); try {
      const ids = [await t.claim(), await t.claim()];
      const driver = t.driver();
      await t.until(driver, () => ids.some((id) => t.body(id).drive?.blockedReason === "reconcile-budget"), 120);
      const parked = ids.find((id) => t.body(id).drive?.blockedReason === "reconcile-budget")!;
      await stop(t);
      await t.until(driver, () => requestState(t, requestOf(t, parked)) === "settled-recoverable", 120);
      expect(t.body(parked)).toMatchObject({ state: "settled-recoverable", recoverable: true });
      expect(active(t, parked)).toBe(0);
      expect(work(t, t.body(parked).taskId).status).toBe("held");
      expect(JSON.parse(String(t.h.store.db.prepare("SELECT body FROM checkpoints WHERE id=?").get(t.body(parked).checkpointId)!.body)).result).toBe("partial");
    } finally { await t.h.dispose(); }
  });

  it("leaves a blocked run whose change already landed to a person: its request stays open (plan deviation D-LANDED)", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).state === "landed");
      const landedCommit = t.body(runId).drive.landedCommit as string;
      expect(landedCommit).not.toBeNull();
      // E's own block (a settle that did not complete) leaves the landed change on orca/g.
      blockRun(t.deps, runId, "E", "settle-incomplete");
      const [requestId] = await stop(t);
      for (let i = 0; i < 5; i += 1) await driver.round();
      // Parking it held would have a continuation land the same change a second time (spec §3's one principle).
      expect(requestState(t, requestId!)).toBe("request-pending");
      expect(t.body(runId)).toMatchObject({ state: "blocked", drive: { blockedAt: "E", landedCommit } });
      expect(t.fake.calls.handoff).toHaveLength(0);
      expect(Number(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(runId)!.n)).toBe(0);
      expect(readStopIntent(t.h.store, "g")!.state).toBe("handoff-pending");
    } finally { await t.h.dispose(); }
  });
});

describe("deaths inside H (spec §9.2 R-H)", { timeout: 60_000 }, () => {
  it("re-delivers the identical request after a death between delivery and its record (H-after-deliver); ccloop runs it once", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      const crashing = crashingAt(t, "H-after-deliver");
      await t.until(crashing, () => crashing.crashed !== null);
      expect(requestState(t, requestId!)).toBe("request-pending");
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-recoverable");
      expect(t.fake.calls.handoff).toHaveLength(2);
      expect(t.fake.calls.handoff[1]).toEqual(t.fake.calls.handoff[0]);
      expect(t.fake.calls.accept).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("settles once after a death between reading the candidate and settling (H-after-candidate)", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "stoppable" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const [requestId] = await stop(t);
      const crashing = crashingAt(t, "H-after-candidate");
      await t.until(crashing, () => crashing.crashed !== null);
      expect(requestState(t, requestId!)).toBe("collecting");
      await t.until(t.driver(), () => requestState(t, requestId!) === "settled-recoverable");
      expect(Number(t.h.store.db.prepare("SELECT COUNT(*) AS n FROM checkpoints WHERE run_id=?").get(runId)!.n)).toBe(1);
    } finally { await t.h.dispose(); }
  });
});
