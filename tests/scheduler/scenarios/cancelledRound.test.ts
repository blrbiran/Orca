import { describe, expect, it } from "vitest";
import { captureStreams, makeSandbox, runCli, seedRunnablePlan, showFileAt, taskWorkdirs, writeFileCheck, writePlan, writeScriptedConfig } from "../sandbox.js";

// spec §6.1's `cancelled` row: the one terminal status that stops the WHOLE
// round rather than just its own descendants. Task 8 registered honestly that
// it had never produced one — the routing was covered by pure-function
// criteria only, and the P2 execution ledger carries that as a known gap.
//
// It is reachable without signalling the process group, which is what made it
// look unreachable: ccloop matches the adapter's `verification.stopSignals`
// against the contract's `escalationAndExit.stopOn` and returns `cancelled`
// ahead of evaluateStopDecision, so a scripted frame plus `verifierType:
// "agent"` produces a real one. No model is spawned; the whole round is
// scripted.
// 🔴 The shape this criterion had to be rewritten into, recorded because it
// is the trap this project keeps paying for. The first draft used T1 (cancels)
// and T2 (depends on T1) only, and it was GREEN under the named mutation
// M-ROUTE-CANCEL (delete the `cancelled` row from routeOutcome entirely):
// with a two-task chain the generic row produces the identical output —
// countsAsFailure is true for anything that is not blocked_waiting_human, and
// descendantsOf(T1) is [T2] — so nothing it asserted depended on the row it
// claimed to pin. T3 is what makes the row load-bearing: it is NOT a
// descendant of T1, so only `cancelled`'s "every other task" and stopRound
// keep it from running. --serial puts it in a later layer, which is the only
// place a not-yet-started task can be stopped.
describe("a cancelled task stops the whole round (spec §6.1)", () => {
  it("reports cancelled, blocks every other task by name including one it is not upstream of, and lands nothing", async () => {
    const s = await makeSandbox();
    try {
      const p = await seedRunnablePlan(s, [
        {
          taskId: "T1",
          contract: {
            goal: "write a.txt",
            targetPaths: ["a.txt"],
            requiredChecks: [writeFileCheck("a.txt", "a1")],
            buildTestCommands: ["true"],
            // Both halves of the route, plus the verifier that reads them.
            verifierType: "agent",
            stopOn: ["orca-stop"],
          },
        },
        {
          taskId: "T2",
          contract: {
            goal: "write b.txt",
            targetPaths: ["b.txt"],
            requiredChecks: [writeFileCheck("b.txt", "b1")],
            buildTestCommands: ["true"],
          },
          dependsOn: ["T1"],
        },
        {
          // Independent of T1 in both senses that matter: no dependsOn edge,
          // and a disjoint write set so no implicit edge either. Under any
          // routing but `cancelled`'s it would run.
          taskId: "T3",
          contract: {
            goal: "write c.txt",
            targetPaths: ["c.txt"],
            requiredChecks: [writeFileCheck("c.txt", "c1")],
            buildTestCommands: ["true"],
          },
        },
      ]);
      // The frame is shared by every spawn in the round; only a task whose own
      // contract lists the signal in stopOn is cancelled by it.
      const adapterConfig = await writeScriptedConfig(s, "round", [{ stopSignals: ["orca-stop"] }]);

      // --serial (spec §3.5) puts T3 in a layer of its own AFTER T1's, which
      // is what makes "stopped before it started" observable at all: a
      // same-layer sibling is already launched by the time T1's status is
      // read.
      const { result: rc, stdout } = await captureStreams(() =>
        runCli(["run", p.planPath, "--adapter-config", adapterConfig, "--serial"]),
      );

      // §6.1: cancelled counts as a failure (2), not an escalation (3).
      expect(rc).toBe(2);
      expect(stdout).toContain("T1: ccloop reported cancelled");
      // §6.2 by name, for the task that never started.
      expect(stdout).toContain("T2: upstream_not_run");
      // The load-bearing one: T3 is not downstream of T1, so only the
      // `cancelled` row stops it.
      expect(stdout).toContain("T3: upstream_not_run");
      // Nothing from either task reaches W: T1's work is not landed even
      // though its required check really did write the file inside the copy.
      expect(await showFileAt(s.targetRepo, p.workBranch, "a.txt")).toBeNull();
      expect(await showFileAt(s.targetRepo, p.workBranch, "b.txt")).toBeNull();
      expect(await showFileAt(s.targetRepo, p.workBranch, "c.txt")).toBeNull();
      // The control that separates "never started" from "started and cleaned
      // up": T1 has a run directory, T2 has none at all.
      const dirs = await taskWorkdirs(s);
      expect(dirs.some((d) => d.includes("-T1-"))).toBe(true);
      expect(dirs.some((d) => d.includes("-T2-"))).toBe(false);
      expect(dirs.some((d) => d.includes("-T3-"))).toBe(false);
    } finally {
      await s.cleanup();
    }
  }, 180_000);
});
