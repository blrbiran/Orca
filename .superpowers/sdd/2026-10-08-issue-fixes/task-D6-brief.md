### Task D6: The facts the panel decides a failed run by (pure web helpers)

**Files:**
- Create: `web/src/runFacts.ts`
- Create: `web/tests/runFacts.test.ts`

**Interfaces:**
- Produces: `isTerminalFailure(run: RunViewV1): boolean`; `reasonCode(reason: string): string`;
  `runReasonText(run: RunViewV1): string | null`; `taskRunNumber(view: GroupViewV1, taskId: string): number`. No React, no
  i18n imports (type-only), so `tests/control/*.test.ts` can import it under the root tsconfig.

- [ ] **Step 1: Write the failing test.** Create `web/tests/runFacts.test.ts`:

```ts
/**
 * Issue fixes spec §4.2(5): which runs get "Retry task", which reason a run shows, and the task's run number (the count
 * of its lineage runs that reached the provider, i.e. not failed-before-provider).
 */
import { describe, expect, it } from "vitest";
import type { Amount, GroupViewV1, RunViewV1, WorkItemViewV1 } from "../src/controlTypes.js";
import { isTerminalFailure, reasonCode, runReasonText, taskRunNumber } from "../src/runFacts.js";

const amount = (tokens: number): Amount => ({ tokens, activeMs: tokens * 10, attempts: 1, sessions: 1 });
const run = (over: Partial<RunViewV1>): RunViewV1 => ({
  runId: "run-a", taskId: "a", estimateId: null, generation: 1, state: "running", phase: "work", claimOrdinal: 1, providerAttemptOrdinal: 1,
  profile: { profileId: "all", profileHash: "b".repeat(64) }, used: amount(10), remaining: amount(90), failureCode: null, evidenceIds: [], ...over,
});
const item = (over: Partial<WorkItemViewV1>): WorkItemViewV1 => ({
  taskId: "a", status: "active", dependencyTaskIds: [], targetVersion: 1, configHash: "d".repeat(64), originalContractHash: "e".repeat(64),
  derivedContractHash: "f".repeat(64), currentRunId: null, pendingRunId: null, lineageRunIds: [], ...over,
});
const viewOf = (workItems: WorkItemViewV1[], runs: RunViewV1[]): GroupViewV1 => ({ workItems, runs } as unknown as GroupViewV1);

describe("run facts (spec §4.2(5))", () => {
  it("calls a run a terminal failure only when it is blocked with an outcome other than succeeded", () => {
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed" }))).toBe(true);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "Error: codex-skills-cleanup-failed:EACCES", outcome: "failed" }))).toBe(true);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "out-of-bounds:x", outcome: "succeeded" }))).toBe(false);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "control-peer-timeout", outcome: null }))).toBe(false);
    expect(isTerminalFailure(run({ state: "blocked", blockedReason: "control-peer-timeout" }))).toBe(false);
    expect(isTerminalFailure(run({ state: "settled-failed", outcome: "failed" }))).toBe(false);
  });

  it("reads ccloop's reason code through the Error: prefix its phase errors carry", () => {
    expect(reasonCode("Error: codex-result-invalid: /runs/x")).toBe("codex-result-invalid: /runs/x");
    expect(reasonCode("terminal:failed")).toBe("terminal:failed");
  });

  it("shows ccloop's reason for a failed or settled-failed run, else the blocked reason, else nothing", () => {
    expect(runReasonText(run({ state: "blocked", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-result-invalid: /x" }))).toBe("Error: codex-result-invalid: /x");
    expect(runReasonText(run({ state: "blocked", blockedReason: "terminal:exhausted", outcome: "exhausted", stopReason: null }))).toBe("terminal:exhausted");
    expect(runReasonText(run({ state: "settled-failed", blockedReason: "terminal:failed", outcome: "failed", stopReason: "Error: codex-event-error" }))).toBe("Error: codex-event-error");
    expect(runReasonText(run({ state: "blocked", blockedReason: "reconcile-budget", outcome: "succeeded", stopReason: null }))).toBe("reconcile-budget");
    expect(runReasonText(run({ state: "running" }))).toBe(null);
  });

  it("numbers a task's runs by those of its lineage that reached the provider", () => {
    const runs = [run({ runId: "r1", state: "settled-failed" }), run({ runId: "r2", state: "failed-before-provider" }), run({ runId: "r3", state: "starting" }), run({ runId: "rb", taskId: "b" })];
    expect(taskRunNumber(viewOf([item({ lineageRunIds: ["r1", "r2", "r3"] }), item({ taskId: "b", lineageRunIds: ["rb"] })], runs), "a")).toBe(2);
    expect(taskRunNumber(viewOf([item({ lineageRunIds: [] })], []), "a")).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.** `cd $W/web && ../node_modules/.bin/vitest run tests/runFacts.test.ts > $S/d6.txt 2>&1; echo rc=$?`
  → rc=1, "Failed to resolve import ../src/runFacts.js".
- [ ] **Step 3: Implement.** Create `web/src/runFacts.ts`:

```ts
/**
 * Issue fixes spec §4.2(5): the facts the runs table and the task detail decide a run's reason and button by. Pure (type
 * imports only, no React or i18n), so the server's criteria compute the same run number the panel shows
 * (tests/control/retryTask.test.ts).
 */
import type { GroupViewV1, RunViewV1 } from "./controlTypes.js";

/** A blocked run whose ccloop run ended with an outcome other than `succeeded`: its button is "Retry task". */
export function isTerminalFailure(run: RunViewV1): boolean {
  return run.state === "blocked" && run.outcome != null && run.outcome !== "succeeded";
}

/**
 * ccloop's phase failures reach Orca as `String(error)` (ccloop runLoop.ts PhaseExecutionError), so the reason code follows
 * an `Error: ` prefix; the explanation tables are keyed by the code.
 */
const ERROR_PREFIX = "Error: ";
export function reasonCode(reason: string): string {
  return reason.startsWith(ERROR_PREFIX) ? reason.slice(ERROR_PREFIX.length) : reason;
}

/** The reason a run shows: ccloop's own for a failed or settled-failed run when it gave one, else the driver's blocked reason. */
export function runReasonText(run: RunViewV1): string | null {
  if (isTerminalFailure(run) || run.state === "settled-failed") return run.stopReason ?? run.blockedReason ?? null;
  return run.state === "blocked" ? run.blockedReason ?? null : null;
}

/** Spec §4.2(2): a task's run number is the count of its lineage runs that reached the provider. */
export function taskRunNumber(view: GroupViewV1, taskId: string): number {
  const lineage = new Set(view.workItems.find((item) => item.taskId === taskId)?.lineageRunIds ?? []);
  return view.runs.filter((run) => lineage.has(run.runId) && run.state !== "failed-before-provider").length;
}
```

- [ ] **Step 4: Run, expect PASS.** The Step 2 command → rc=0; web typecheck rc=0.
- [ ] **Step 5: Mutation.** (a) `isTerminalFailure`: drop `&& run.outcome !== "succeeded"` → first `it` red (out-of-bounds
  line). (b) `reasonCode`: return `reason` unchanged → second `it` red. (c) `runReasonText`: drop the first branch → third
  `it` red (first expectation). (d) `taskRunNumber`: drop `&& run.state !== "failed-before-provider"` → fourth `it` red (3 ≠ 2).
- [ ] **Step 6: Commit.** `git -C $W add web/src/runFacts.ts web/tests/runFacts.test.ts`;
  message `feat(web): decide a run's retry button, reason and run number from the run view`.

---

