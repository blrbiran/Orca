import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdmissionGate } from "../../src/control/admissionGate.js";
import { createExecutionDriver } from "../../src/control/executionDriver.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// Orca backlog #3 (2026-09-29; Orca handoff §9.0 挂账 "replenishStartWakes 或 blockRun 抛错会中止整轮（所有组）"):
// one group's failure no longer stops every other group's work in the same round, and it is still named on stderr --
// the driver's record for a failure it cannot pin on a run (executionDriver.ts, the `orca-driver:` lines).
const lines: string[] = [];
afterEach(() => { vi.restoreAllMocks(); lines.splice(0); });
const captureStderr = () => vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; }) as typeof process.stderr.write);

describe("a round goes on past one group's failure (backlog #3)", () => {
  it("arms the next start wake for a healthy group while another group's row cannot be read, and names that group", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      const runId = await t.claim();
      // A group row that sorts before `g` and does not parse. Before this fix its JSON.parse threw out of the one
      // transaction replenishStartWakes runs, and the whole round -- every group's wake and every run -- with it.
      t.h.store.db.prepare("INSERT INTO groups(id,revision,graph_version,body) VALUES ('a-broken',0,0,'{')").run();
      captureStderr();
      await t.driver().round();
      expect(t.h.store.db.prepare("SELECT id FROM scheduler_wakes WHERE group_id='g' AND kind='start' AND delivered=0").all()).toEqual([{ id: "drive:g:1" }]);
      expect(t.body(runId).state).toBe("start-pending");
      expect(lines.filter((line) => line.startsWith("orca-driver: group a-broken: "))).toHaveLength(1);
    } finally { await t.h.dispose(); }
  });

  it("fails the round with the real cause when a group's write takes the whole transaction down, and leaves no wake", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      await t.claim();
      // Plan B final review (2026-09-29): SQLITE_FULL inside one group's INSERT rolls back the whole transaction, not
      // just the statement. Before the per-group savepoint the catch above swallowed it as that group's failure, and the
      // round then died on a COMMIT/ROLLBACK with "no transaction is active" instead of the full disk. The database is
      // capped at its current size and the scheduler_wakes pages filled with tiny rows, so the wake cannot fit. Filler
      // ids sort beside `drive:g:` but do not match `drive:g:%`, so the wake's ordinal is unchanged.
      const db = t.h.store.db;
      db.exec(`PRAGMA max_page_count=${Number(db.prepare("PRAGMA page_count").get()!.page_count)}`);
      const fill = db.prepare("INSERT INTO scheduler_wakes(id,group_id,kind,body,delivered) VALUES (?,NULL,'filler','',1)");
      let full = "";
      for (let n = 0; full === "" && n < 100_000; n += 1) {
        try { fill.run(`drive:g!${String(n).padStart(6, "0")}`); } catch (error) { full = (error as Error).message; }
      }
      expect(full).toBe("database or disk is full");
      captureStderr();
      await t.driver().round();
      const failed = lines.filter((line) => line.startsWith("orca-driver: round failed: "));
      expect(failed).toEqual(["orca-driver: round failed: database or disk is full\n"]);
      expect(lines.filter((line) => line.startsWith("orca-driver: group "))).toEqual([]);
      expect(db.prepare("SELECT id FROM scheduler_wakes WHERE id LIKE 'drive:%' AND kind='start'").all()).toEqual([]);
    } finally { await t.h.dispose(); }
  });

  it("names a run whose failure it could not record, and still moves the next run in the same round", async () => {
    const t = await driverHarness([{ taskId: "a" }, { taskId: "b" }]); try {
      const a = await t.claim();
      const b = await t.claim();
      await t.until(t.driver(), () => t.body(a).state === "accepted" && t.body(b).state === "accepted");
      const [first, second] = [a, b].sort();
      // `first` fails at C, and the write that would block it for that fails too: the admission gate refuses exactly
      // the next entry after the collect error, which is blockRun's. Before this fix the second error left the loop,
      // so `second` -- visited after `first` -- was not collected in this round.
      let armed = false;
      const port: ExecutionPort = {
        ...t.fake.port,
        async collect(input, afterSeq) {
          if (input.claim.runId === first) { armed = true; throw new Error("collect-boom"); }
          return t.fake.port.collect(input, afterSeq);
        },
      };
      const gate = t.h.deps.admissionGate;
      const faulty: AdmissionGate = {
        get draining() { return gate.draining; },
        beginDrain: () => gate.beginDrain(),
        enter: () => {
          if (armed) { armed = false; throw new Error("gate-boom"); }
          return gate.enter();
        },
      };
      captureStderr();
      await createExecutionDriver({ ...t.deps, admissionGate: faulty, router: createExecutionProfileRouter([resolveProfile(profileSnapshot(), port)]) }).round();
      expect(t.body(second).state).toBe("collected");
      expect(t.body(first).state).toBe("accepted");
      expect(lines).toContain(`orca-driver: ${first}: collect-boom; recording it failed: gate-boom\n`);
    } finally { await t.h.dispose(); }
  });
});
