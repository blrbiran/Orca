### Task D1: The port keeps ccloop's stop reason for every terminal, bounded

**Files:**
- Modify: `src/control/driveRecord.ts` (after `driveStepSchema`/`DriveStep`, lines 14–16)
- Modify: `src/control/ccloopPort.ts` (imports lines 1–12; `collect`, line 125)
- Test: `tests/control/ccloopPort.test.ts` (append after the last `it`, line 214–217)

**Interfaces:**
- Produces: `export const STOP_REASON_MAX = 500;` and `export function boundStopReason(reason: string): string` in
  `driveRecord.ts`; `ExecutionReport.terminal.stopReason` is now set for every terminal that carries a non-empty reason.

- [ ] **Step 1: Write the failing test.** Append to `tests/control/ccloopPort.test.ts`:

```ts
// Issue fixes spec §4.2(1) (issue 15): the port kept ccloop's reason only for a codex-skills failure, so
// codex-result-invalid never reached the store. Every terminal's reason is kept now, its first 500 UTF-16 units.
const FAILED_TERMINAL = { status: "failed", currentAttempt: 1, attemptsUsed: 1, lastTransitionAt: "2026-10-08T00:00:00Z", waitingOnHuman: false, stopReason: null as string | null,
  budgetSnapshot: { attemptsRemaining: 0, timeRemainingMs: 100, tokenBudgetRemaining: 100 }, recentFailures: [] };
it("keeps ccloop's stop reason for any terminal, not only a skills failure", async () => {
  const reason = "Error: codex-result-invalid: /runs/r/attempt-1/execute-result.json";
  const h = await fixture("ok", { terminal: { ...FAILED_TERMINAL, stopReason: reason } });
  expect((await h.port.collect(h.envelope, 0)).terminal).toMatchObject({ outcome: "failed", stopReason: reason });
});
it("keeps only the first 500 UTF-16 units of a longer stop reason", async () => {
  const h = await fixture("ok", { terminal: { ...FAILED_TERMINAL, stopReason: `${"x".repeat(499)}中文 and the rest` } });
  expect((await h.port.collect(h.envelope, 0)).terminal!.stopReason).toBe(`${"x".repeat(499)}中`);
});
it("states no stop reason when ccloop gave none", async () => {
  const h = await fixture("ok", { terminal: { ...FAILED_TERMINAL, stopReason: null } });
  expect("stopReason" in (await h.port.collect(h.envelope, 0)).terminal!).toBe(false);
});
```

- [ ] **Step 2: Run it, expect FAIL.** `./node_modules/.bin/vitest run tests/control/ccloopPort.test.ts > $S/d1.txt 2>&1; echo rc=$?`
  → rc=1; "keeps ccloop's stop reason for any terminal" fails (`stopReason` missing from the terminal) and "keeps only the
  first 500" fails (`undefined` ≠ the 500-unit string). "states no stop reason" passes already.
- [ ] **Step 3: Implement.** In `src/control/driveRecord.ts`, after `export type DriveStep = z.infer<typeof driveStepSchema>;`:

```ts
/**
 * Issue fixes spec §4.2(1): the most of ccloop's terminal `stopReason` Orca keeps, in UTF-16 code units. ccloop states
 * the reason first and the evidence path after it, so the cut keeps what the panel explains.
 */
export const STOP_REASON_MAX = 500;
export function boundStopReason(reason: string): string {
  return reason.length > STOP_REASON_MAX ? reason.slice(0, STOP_REASON_MAX) : reason;
}
```

  In `src/control/ccloopPort.ts` add the import after `import { byModelSchema } from "./usageLedger.js";`:

```ts
import { boundStopReason } from "./driveRecord.js";
```

  and in `collect` (line 125) replace exactly
  `...(response.terminal.stopReason?.includes("codex-skills-")?{stopReason:response.terminal.stopReason}:{})`
  with
  `...(response.terminal.stopReason?{stopReason:boundStopReason(response.terminal.stopReason)}:{})`.
- [ ] **Step 4: Run, expect PASS.** Same command → rc=0, the whole file green (the skills-reason `it` included).
- [ ] **Step 5: Mutation.** (a) In the clone, put back `?.includes("codex-skills-")?…:{}` (the old condition) → "keeps
  ccloop's stop reason for any terminal" red. (b) Replace `boundStopReason(response.terminal.stopReason)` with
  `response.terminal.stopReason` → "keeps only the first 500 UTF-16 units" red. (c) Replace the whole spread with
  `stopReason:response.terminal.stopReason` → "states no stop reason when ccloop gave none" red.
- [ ] **Step 6: Commit.** `git -C $W add src/control/driveRecord.ts src/control/ccloopPort.ts tests/control/ccloopPort.test.ts`;
  message `fix(control): keep ccloop's stop reason for every terminal report, bounded to 500 units`.

---

