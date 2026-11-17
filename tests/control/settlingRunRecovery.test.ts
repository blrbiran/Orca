import { describe, expect, it } from "vitest";
import { driverHarness } from "./fixtures/driverHarness.js";

/**
 * Tester #332: a debug task's run landed, then sat `landed` and active for five minutes while its settle (archive,
 * checkpoint, publish) ran on the driver's one settle lane. Meanwhile `recovery retry` answered `resolved:false` with no
 * reason and `archive` refused with only `<run> landed`, so the tester read it as a deadlock. Both now say a landed run is
 * settling and that nothing needs doing but waiting.
 */
describe("a landed run still settling (#332)", () => {
  it("recovery retry answers waitingOn settle, and archive names the settling run with what to do", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let entered = false;
    try {
      const runId = await t.claim();
      t.deps.beforeSettle = async (id: string) => { if (id === runId) { entered = true; await held; } };
      const driver = t.driver();
      for (let i = 0; i < 60 && !entered; i += 1) { void driver.round(); await new Promise((resolve) => setTimeout(resolve, 100)); }
      expect(entered).toBe(true);
      expect(t.body(runId).state).toBe("landed");

      const retried = await t.service.recoveryRetry(t.h.command("recovery-retry", { scope: "group", groupId: "g" }));
      // mutation: drop the settling check in retryGroup -> no waitingOn, red
      expect(retried).toMatchObject({ result: { kind: "recovery-observed", resolved: false, waitingOn: "settle" } });

      const archived = t.service.archiveGroup(t.h.command("archive-group", {})) as { error?: { code: string; message: string } };
      // mutation: drop the landed branch in activeRunRef -> no next for the run, red
      expect(archived.error?.code).toBe("archive-run-active");
      expect(archived.error?.message).toContain(`${runId} landed (wait: it landed and is settling; orca run show ${runId})`);
    } finally { release(); await t.h.dispose(); }
  }, 120000);
});
