import { afterAll, describe, expect, it, vi } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { ccloopWorlds, raw, realBinary, startGroup, until, workRuns } from "./fixtures/ccloopWorld.js";

/**
 * Tester #267 (triage D "not verified"): a machine that sleeps through a collect leaves its run blocked at C with no
 * outcome (control-peer-timeout). Before the refusals name `orca recovery retry --run <id>` as the way out, this pins
 * against the real ccloop build what that command does to such a run whose ccloop worker is still alive: the run goes
 * back to C and the next collects reach ccloop's terminal (here: succeeded, collected).
 *
 * Not pinned, measured instead (seat G5, 2026-11-12, log /private/tmp/orca-g1112/g5/267-e2e-2.log): with the worker
 * SIGKILLed while asleep, the same command puts the run back at C and it then waits there for good -- ccloop's collect
 * keeps answering a non-terminal loop state for a dead worker, and ccloop's own resume refuses an Orca control run. That
 * is a separate defect (a dead worker under a live run), reported, not fixed here.
 */
const { world, removeRoots, relocateHome } = ccloopWorlds({ rootPrefix: "orca-sleep-e2e-", epochPrefix: "epoch-sleep-" });
afterAll(removeRoots);

describe.skipIf(!realBinary)("a run blocked at C with no outcome (#267)", { timeout: 420_000 }, () => {
  relocateHome("orca-sleep-e2e-home-");

  it("recovery retry --run resumes it, and the run reaches the terminal ccloop states", async () => {
    const w = await world([{ taskId: "a", targetPaths: ["shared.txt"] }], { a: { files: { "shared.txt": "A\n" }, delayMs: { execute: 20_000 } } });
    let asleep = false;
    const wrap = (port: ExecutionPort): ExecutionPort => new Proxy(port, { get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (key !== "collect" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
      return async (...args: unknown[]) => { if (asleep) throw new ControlError("control-peer-timeout"); return (value as (...a: unknown[]) => unknown).apply(target, args); };
    } });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const runtime = await w.boot(undefined, wrap); try {
      await startGroup(runtime, w.repoId, 10_000_000);
      runtime.startPump(50);
      await until(() => workRuns(runtime)[0]?.body.state === "accepted" && w.scripted().some((line) => line.startsWith("execute ")), 240_000, "execute to start");
      const runId = workRuns(runtime)[0]!.runId;
      // The sleep: every collect times out until the run blocks.
      asleep = true;
      await until(() => workRuns(runtime)[0]!.body.state === "blocked", 120_000, "the run to block");
      const blocked = workRuns(runtime)[0]!.body;
      expect({ blockedAt: blocked.drive.blockedAt, blockedReason: blocked.drive.blockedReason, outcome: blocked.drive.outcome })
        .toEqual({ blockedAt: "C", blockedReason: "control-peer-timeout", outcome: null });
      // Awake again: the person runs the command the refusals name.
      asleep = false;
      const resumed = await runtime.service.recoveryRetry(raw(runtime, "resume", "recovery-retry", { scope: "run", runId }, { kind: "run", groupId: "g", runId }));
      expect("error" in resumed ? resumed.error : resumed.result).toMatchObject({ kind: "recovery-observed", resolved: true });
      await until(() => { const body = workRuns(runtime)[0]!.body; return body.drive.outcome !== null; }, 240_000, "the resumed run to reach a terminal");
      expect(workRuns(runtime)[0]!.body.drive.outcome).toBe("succeeded");
      expect(await runtime.shutdown()).toBe(true);
    } finally { stderr.mockRestore(); await w.teardown(); }
  });
});
