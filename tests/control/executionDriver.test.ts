import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCanonicalRecord } from "../../src/control/snapshot.js";
import { stepA1, type CrashPoint, DriverCrash, createExecutionDriver } from "../../src/control/executionDriver.js";
import { applySetWorkspaceMode } from "../../src/control/workspaceSettings.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { driverHarness, git } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// Execution driver spec §2.2, steps A1 to C, against a synthetic ccloop. Criteria R2 and a synthetic T1
// live here; the real-ccloop T1 is in executionDriverE2E.test.ts.
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

describe("A1: one provider attempt, reserved once (spec §2.2)", () => {
  it("reserves exactly one attempt and records where the run will live, even when asked twice", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      expect(stepA1(t.deps, runId)).toBe(true);
      expect(stepA1(t.deps, runId)).toBe(false);
      const run = t.body(runId);
      expect(run.providerAttemptOrdinal).toBe(1);
      expect(run.state).toBe("start-pending");
      expect(run.drive).toMatchObject({ workspaceMode: "worktree", sourceDir: `${t.h.store.stateDir}.runs/${runId}`, workspacePath: `${t.h.store.stateDir}.workspaces/${runId}`, prepared: false });
    } finally { await t.h.dispose(); }
  });

  it("blocks a strict group's run before any provider attempt", async () => {
    const t = await driverHarness([{ taskId: "a" }], { budgetMode: "strict" }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await driver.round(); await driver.round();
      expect(t.body(runId)).toMatchObject({ state: "blocked", providerAttemptOrdinal: 0, drive: { blockedAt: "A1", blockedReason: "strict-proof-unimplemented" } });
      expect(t.fake.calls.accept).toHaveLength(0);
    } finally { await t.h.dispose(); }
  });

  it("takes the repository's workspace mode as it is when A1 runs (W1)", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      applySetWorkspaceMode({ store: t.h.store, knownRepository: () => true }, { schema: "orca-raw-command-v1", commandId: "mode", expectedRevision: 0, actorId: "human", verb: "set-workspace-mode", target: { kind: "repository", repoId: "repo" }, payload: { workspaceMode: "clone" } });
      stepA1(t.deps, runId);
      expect(t.body(runId).drive.workspaceMode).toBe("clone");
    } finally { await t.h.dispose(); }
  });
});

describe("A2: the workspace and the whole start envelope (spec §2.2, §3)", () => {
  it("builds the workspace at orca/<group>'s tip and stores the rewritten envelope, leaving the person's checkout alone", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const head = git(t.repo, "rev-parse", "HEAD");
      const index = sha256(join(t.repo, ".git", "index"));
      const runId = await t.claim();
      const driver = t.driver();
      await t.until(driver, () => t.body(runId).drive?.prepared === true);
      const drive = t.body(runId).drive;
      expect(drive.base).toBe(head);
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(head);
      expect(git(t.repo, "worktree", "list", "--porcelain").split("\n")).toContain(`worktree ${drive.workspacePath}`);
      const envelope = JSON.parse(readCanonicalRecord(t.h.store, drive.envelopeHash));
      expect(envelope.work).toMatchObject({ targetRepo: t.repo, base: head, sourceDir: drive.sourceDir });
      expect(envelope.work.contract.context.repoPath).toBe(drive.workspacePath);
      expect(git(t.repo, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
      expect(git(t.repo, "rev-parse", "HEAD")).toBe(head);
      expect(sha256(join(t.repo, ".git", "index"))).toBe(index);
    } finally { await t.h.dispose(); }
  });

  it("ends the driver like a death when a crash hook fires, and a new driver finishes A2 on the same workspace", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      const point: CrashPoint = "A2-after-workspace";
      const crashing = createExecutionDriver({ ...t.deps, crash: (at) => { if (at === point) throw new DriverCrash(at); } });
      await crashing.round(); await crashing.round();
      expect(crashing.crashed).toBe(point);
      expect(await crashing.round()).toBe(false);
      expect(t.body(runId)).toMatchObject({ state: "start-pending", drive: { prepared: false } });
      await t.until(t.driver(), () => t.body(runId).drive?.prepared === true);
      expect(t.body(runId).state).toBe("start-pending");
    } finally { await t.h.dispose(); }
  });
});

describe("B and B': the frozen bytes, and every answer the port can give (spec §2.2)", () => {
  it("sends the stored envelope and records the execution", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      const drive = t.body(runId).drive;
      expect(t.fake.calls.accept).toHaveLength(1);
      expect(t.fake.calls.accept[0]).toEqual(JSON.parse(readCanonicalRecord(t.h.store, drive.envelopeHash)));
      expect(t.body(runId).executionId).toBe(`execution-${runId}`);
    } finally { await t.h.dispose(); }
  });

  it("R2: blocks the run after ten unknown inspections, spending one accept and leaving dispatch open", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "unknown" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "B'", blockedReason: "inspect-unknown", inspectUnknown: 10 });
      expect(t.fake.calls.inspect).toBe(10);
      expect(t.fake.calls.accept).toHaveLength(1);
      expect(t.h.store.dispatchBlocked).toBe(false);
    } finally { await t.h.dispose(); }
  });

  it("re-sends the same bytes when an inspection finds nothing was accepted", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "forget-first-accept" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      expect(t.fake.calls.accept).toHaveLength(2);
      expect(JSON.stringify(t.fake.calls.accept[1])).toBe(JSON.stringify(t.fake.calls.accept[0]));
      expect(t.fake.calls.inspect).toBe(1);
    } finally { await t.h.dispose(); }
  });

  it("D4: moves on to collection when an inspection proves the execution stopped", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "lost-accept" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => ["collected", "blocked"].includes(t.body(runId).state));
      expect(t.body(runId)).toMatchObject({ state: "collected", executionId: `execution-${runId}` });
      expect(t.fake.calls.accept).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("D5: blocks a deterministic refusal by name instead of re-sending it", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "refuse" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "B", blockedReason: "accept-refused:2:control-config-hash-mismatch" });
      expect(t.fake.calls.accept).toHaveLength(1);
      expect(t.fake.calls.inspect).toBe(0);
    } finally { await t.h.dispose(); }
  });

  it("blocks an execution whose config hash is not the claim's", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "wrong-config" }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId)).toMatchObject({ executionId: null, drive: { blockedAt: "B", blockedReason: "config-hash-mismatch" } });
    } finally { await t.h.dispose(); }
  });

  it("stops the round without blocking anyone while the admission gate drains", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      t.h.deps.admissionGate.beginDrain();
      expect(await t.driver().round()).toBe(false);
      expect(t.body(runId)).toMatchObject({ state: "starting", providerAttemptOrdinal: 0 });
    } finally { await t.h.dispose(); }
  });

  it("stop() waits for a provider call in flight before it resolves", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const t = await driverHarness([{ taskId: "a" }], { delayAccept: () => held }); try {
      const runId = await t.claim();
      const driver = t.driver();
      await driver.round(); await driver.round();
      const inFlight = driver.round();
      let stopped = false;
      const stopping = driver.stop().then(() => { stopped = true; });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(stopped).toBe(false);
      release();
      await Promise.all([inFlight, stopping]);
      expect(stopped).toBe(true);
      expect(t.body(runId).state).toBe("accepted");
    } finally { await t.h.dispose(); }
  });
});

describe("C: collect, then decide from the terminal (spec §2.2, §3.3, §5.2)", () => {
  it("T1 (synthetic): blocks a terminal other than succeeded and leaves orca/<group> where it was", async () => {
    const t = await driverHarness([{ taskId: "a" }], { behaviour: () => "exhausted" }); try {
      const head = git(t.repo, "rev-parse", "HEAD");
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "terminal:exhausted", outcome: "exhausted" });
      expect(git(t.repo, "rev-parse", "refs/heads/orca/g")).toBe(head);
      expect(git(t.repo, "for-each-ref", "--format=%(refname)", "refs/orca/")).toBe("");
    } finally { await t.h.dispose(); }
  });

  it("turns a succeeded result into an attempt commit on top of base and holds it as collected", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "collected");
      const drive = t.body(runId).drive;
      const result = join(drive.sourceDir, "repo");
      expect(git(result, "rev-parse", `${drive.attemptSha}^`)).toBe(drive.base);
      expect(git(result, "show", `${drive.attemptSha}:a`)).toBe("a");
      expect(drive.outcome).toBe("succeeded");
      expect(t.body(runId)).toMatchObject({ highWater: 2, cumulative: { work: { tokens: 10 } } });
    } finally { await t.h.dispose(); }
  });

  it("skips landing for a result that changed nothing", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({}) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => ["landed", "blocked"].includes(t.body(runId).state));
      const drive = t.body(runId).drive;
      expect(t.body(runId).state).toBe("landed");
      expect(drive.landedCommit).toBe(null);
      expect(drive.attemptSha).toBe(drive.base);
    } finally { await t.h.dispose(); }
  });

  it("blocks a result that wrote outside the task's paths, by the path", async () => {
    const t = await driverHarness([{ taskId: "a" }], { files: () => ({ "elsewhere.txt": "x\n" }) }); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "C", blockedReason: "out-of-bounds:elsewhere.txt" });
    } finally { await t.h.dispose(); }
  });
});

describe("P7 (controller ruling 2026-09-25): a settled run stays settled", () => {
  it("does not block a run that settled underneath a step that was already in flight for it", async () => {
    const t = await driverHarness([{ taskId: "a" }]); try {
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "accepted");
      // Simulates the race Task 7 introduces: some other write settles the run while C is still
      // collecting for it. The generic per-run error handler must find it settled and leave it alone.
      const settlingPort: ExecutionPort = {
        ...t.fake.port,
        async collect() {
          const body = JSON.parse(String(t.h.store.db.prepare("SELECT body FROM runs WHERE id=?").get(runId)!.body));
          body.state = "settled";
          t.h.store.db.prepare("UPDATE runs SET body=? WHERE id=?").run(JSON.stringify(body), runId);
          throw new Error("collect-boom");
        },
      };
      const raced = { ...t.deps, router: createExecutionProfileRouter([resolveProfile(profileSnapshot(), settlingPort)]) };
      await createExecutionDriver(raced).round();
      expect(t.body(runId).state).toBe("settled");
    } finally { await t.h.dispose(); }
  });
});
