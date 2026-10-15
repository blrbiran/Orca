### Task A8: A log line for the paths left as "unknown" (spec A §4.9)

**Files:**
- Modify: `src/control/executionDriver.ts:466-477` (stepB catch), `:486-488` (stepBPrime), `:552` (saved-result evidence catch); imports (add `peerFailureLogLine`)
- Modify: `src/control/driverHandoff.ts:146-148` (`inspectUnderStop`), `:188-192` (`deliverAndCollect`); import
- Modify: `src/control/dispatch.ts:42-46` (`send`), `:76` (`reconcileStart`); import
- Modify: `src/control/stopIntent.ts:654` (model-assisted handoff probe)
- Test (create): `tests/control/peerFailureLog.test.ts`

**Interfaces:** Consumes A1's `peerFailureLogLine(runId, error)`. Produces stderr lines `orca-driver: <runId>: ccloop <code|unknown>[: <detail>]\n`; for the handoff probe `orca-driver: <runId>: ccloop <probeFailureCode>\n`. Control flow on every path is unchanged.

Spec A §5 names no criterion for §4.9. Two are added (stepB, stepB′); the other six call sites (`executionDriver.ts:552`, `driverHandoff.ts:148,192`, `dispatch.ts:43,76`, `stopIntent.ts:654`) get the same one-line call and are **registered as uncovered by a criterion** in the checkpoint (Rule 12), not claimed tested.

- [ ] **Step 1: Write the failing test** — create `tests/control/peerFailureLog.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.9: paths that turn a ccloop failure into "unknown" and try again keep doing so,
// but each names ccloop's failure on stderr once per occurrence, so `orca panel logs` says why a run went unknown.
describe("unknown-path log lines (spec A §4.9)", () => {
  it("names the accept and the inspect failures a run went unknown on", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    try {
      const port = t.fake.port as unknown as Record<string, unknown>;
      port.accept = async () => { throw new ControlError("control-peer-exit", "1:Error: accept lost"); };
      port.inspect = async () => { throw new ControlError("control-peer-exit", "1:Error: inspect lost"); };
      t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedReason: "inspect-unknown" });
      expect([...new Set(lines.filter((line) => line.startsWith(`orca-driver: ${runId}: ccloop`)))]).toEqual([
        `orca-driver: ${runId}: ccloop unknown: Error: accept lost\n`, `orca-driver: ${runId}: ccloop unknown: Error: inspect lost\n`,
      ]);
    } finally { spy.mockRestore(); await t.h.dispose(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run red** — to `a8-red.log`. Expected red at the last assertion (`[]`). If the run does not reach `blocked` with `inspect-unknown`, read the log and the run body and report: the premise (ten unknown inspections block the run, `executionDriver.ts:482` doc) is then wrong for this harness.

- [ ] **Step 3: Implement** — each site keeps its control flow; e.g. `executionDriver.ts` line 476 `    status = { kind: "unknown" };` becomes `    const line = peerFailureLogLine(runId, error); if (line !== null) process.stderr.write(line);\n    status = { kind: "unknown" };`; line 488 `  catch { status = { kind: "unknown" }; }` becomes `  catch (error) { const line = peerFailureLogLine(runId, error); if (line !== null) process.stderr.write(line); status = { kind: "unknown" }; }`; line 552 `}catch{write(` becomes `}catch(error){const line=peerFailureLogLine(runId,error);if(line!==null)process.stderr.write(line);write(`; `driverHandoff.ts:148` and `:192` the same shape with `run.runId`; `dispatch.ts:43` `catch {` → `catch (error) { const line = peerFailureLogLine(input.claim.runId, error); if (line !== null) process.stderr.write(line);` and `:76` the same with `runId`; `stopIntent.ts` after line 654's `if (observed.probeFailureCode !== null || …) {` insert `        if (observed.probeFailureCode !== null) process.stderr.write(\`orca-driver: ${run.runId}: ccloop ${observed.probeFailureCode}\\n\`);` (check the run variable's name at that line first).

- [ ] **Step 4: Run green** — `tests/control/peerFailureLog.test.ts tests/control/executionDriver.test.ts tests/control/driverHandoff.test.ts tests/control/dispatch.test.ts tests/control/handoffGuards.test.ts` (drop missing ones, say so) to `a8-green.log`; typecheck.

- [ ] **Step 5: Commit** — the four src files and the test; message `feat(control): name ccloop's failure on the paths that treat it as unknown`.

- [ ] **Step 6 (reviewer, clone `a8`): mutations** — test `tests/control/peerFailureLog.test.ts`, file `src/control/executionDriver.ts`:
  - `A8a` stepB silent: `{"from": "    const line = peerFailureLogLine(runId, error); if (line !== null) process.stderr.write(line);\n    status = { kind: \"unknown\" };", "to": "    status = { kind: \"unknown\" };"}` — red (accept line missing).
  - `A8b` stepB′ silent: `{"from": "  catch (error) { const line = peerFailureLogLine(runId, error); if (line !== null) process.stderr.write(line); status = { kind: \"unknown\" }; }", "to": "  catch { status = { kind: \"unknown\" }; }"}` — red (inspect line missing).

---

