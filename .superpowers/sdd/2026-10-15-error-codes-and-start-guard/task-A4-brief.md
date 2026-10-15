### Task A4: Stored run reasons are cut (spec A §4.4; criterion 5)

**Files:**
- Modify: `src/control/executionDriver.ts:124-127` (`describeError`), `:473` (`accept-refused`), imports (add `peerExitText, peerFailure` from `./ccloopPort.js`)
- Test (create): `tests/control/peerReasonCut.test.ts`

**Interfaces:**
- Consumes: Task A1's `peerFailure`, `peerExitText`.
- Produces: `describeError(peerExit)` = `control-peer-exit:<peerExitText>` (or `control-peer-exit` when empty); `drive.blockedReason` of an accept refusal = `accept-refused:<peerExitText>`.

- [ ] **Step 1: Write the failing test** — create `tests/control/peerReasonCut.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { describeError } from "../../src/control/executionDriver.js";
import { createExecutionProfileRouter, resolveProfile } from "../../src/control/profiles.js";
import { driverHarness } from "./fixtures/driverHarness.js";
import { profileSnapshot } from "./fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.4, criterion 5: a blocked run's reason used to keep ccloop's whole stderr (up to
// 24 MiB) and the panel showed it raw. It is stored as `<exit>:<code>: <detail>` with the detail cut to 512 units.
describe("stored peer-exit reasons are cut (spec A §4.4)", () => {
  it("describeError stores the cut form", () => {
    expect([
      describeError(new ControlError("control-peer-exit", `2:agent-config-invalid: ${"x".repeat(2048)}`)),
      describeError(new ControlError("control-peer-exit", "2:control-config-hash-mismatch")),
      describeError(new ControlError("control-peer-exit")),
      describeError(new ControlError("control-peer-timeout")),
    ]).toEqual([`control-peer-exit:2:agent-config-invalid: ${"x".repeat(511)}…`, "control-peer-exit:2:control-config-hash-mismatch", "control-peer-exit", "control-peer-timeout"]);
  });

  it("an accept refusal with a 2 KiB stderr is stored in its cut form", async () => {
    const t = await driverHarness([{ taskId: "a" }]);
    try {
      (t.fake.port as unknown as Record<string, unknown>).accept = async () => { throw new ControlError("control-peer-exit", `2:agent-config-invalid: ${"y".repeat(2048)}`); };
      t.deps.router = createExecutionProfileRouter([resolveProfile(profileSnapshot(), t.fake.port)]);
      const runId = await t.claim();
      await t.until(t.driver(), () => t.body(runId).state === "blocked");
      expect(t.body(runId).drive).toMatchObject({ blockedAt: "B", blockedReason: `accept-refused:2:agent-config-invalid: ${"y".repeat(511)}…` });
    } finally { await t.h.dispose(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run red** — `./node_modules/.bin/vitest run tests/control/peerReasonCut.test.ts > /private/tmp/oec/logs/a4-red.log 2>&1`. Expected red: both tests (the whole 2 KiB stderr received).

- [ ] **Step 3: Implement** — `executionDriver.ts`: add `import { peerExitText, peerFailure } from "./ccloopPort.js";` beside the other imports; `describeError` becomes:

```ts
export function describeError(error: unknown): string {
  // Spec 2026-10-15 ccloop error codes §4.4: a peer exit is stored cut -- `control-peer-exit:<exit>:<code>: <detail≤512>`.
  const peer = peerFailure(error);
  if (peer !== null) { const text = peerExitText(peer); return text === "" ? "control-peer-exit" : `control-peer-exit:${text}`; }
  if (error instanceof ControlError) return error.detail ? `${error.code}:${error.detail}` : error.code;
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}
```
Line 473: `      blockRun(deps, runId, "B", \`accept-refused:${peerExitText(peerFailure(error)!)}\`);`

- [ ] **Step 4: Run green** — `tests/control/peerReasonCut.test.ts tests/control/executionDriver.test.ts tests/control/driverHandoff.test.ts tests/control/skillsE2E.test.ts` (the last two are long; `skillsE2E` may need `ORCA_CCLOOP_BIN` — if it skips, say so) to `a4-green.log`; typecheck. `executionDriver.test.ts:134` (`accept-refused:2:control-config-hash-mismatch`) stays green.

- [ ] **Step 5: Commit** — `src/control/executionDriver.ts tests/control/peerReasonCut.test.ts`; message `feat(control): store a peer exit's run reason cut to its code and 512-unit detail`.

- [ ] **Step 6 (reviewer, clone `a4`): mutations** — file `src/control/executionDriver.ts`, test `tests/control/peerReasonCut.test.ts`:
  - `A4a` drop the cut in `describeError`: `{"from": "  if (peer !== null) { const text = peerExitText(peer); return text === \"\" ? \"control-peer-exit\" : `control-peer-exit:${text}`; }\n", "to": ""}` — red: "describeError stores the cut form" (whole stderr).
  - `A4b` store `error.detail` again: `{"from": "`accept-refused:${peerExitText(peerFailure(error)!)}`", "to": "`accept-refused:${error.detail}`"}` — red: "an accept refusal…".

---

