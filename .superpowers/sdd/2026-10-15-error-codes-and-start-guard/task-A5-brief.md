### Task A5: Single-call failures carry the record's `errorCode` (spec A §4.5; criterion 6; corrections K3, K4)

**Files:**
- Modify: `src/control/executionDriver.ts:640-648` (after `singleCallRecordSchema`), `:695-706` (`stepCSingleCall`)
- Modify: `src/control/singleCallPurposes.ts:30`, `:34` (interface), `:53-55` (`ESTIMATE.complete`)
- Modify: `src/control/webService.ts:1106-1110` (`completeEstimateInStore` signature), `:1136` (`reasonCode`)
- Modify: `src/control/requirementCalls.ts:13` (comment-free import is unchanged), `:191-207` (`recordClarify`), `:257-259` (`CLARIFY_HANDLER.complete`), `:293-309` (`recordSplit`), `:322-324` (`SPLIT_HANDLER.complete`)
- Modify (fixtures): `tests/control/fixtures/estimateHarness.ts:20-27` (`SingleCallOptions`), `:63`; `tests/control/fixtures/requirementHarness.ts:30` (`QueuedAnswer`), `:67`
- Modify (named rewrites): `tests/control/driverEstimate.test.ts:86`, `:136`; `tests/control/driverRequirementSplit.test.ts:57`
- Test (create): `tests/control/singleCallErrorCode.test.ts`

**Interfaces:**
- Produces: `export function normalizeSingleCallErrorCode(errorCode: string | null): string | null` (`executionDriver.ts`); `export const PRE_SPAWN_REFUSALS: ReadonlySet<string>` (`requirementCalls.ts`); `SingleCallHandler.evaluate?(deps, run, rawOutput, failure?: string | null)`; `SingleCallHandler.complete(deps, run, rawOutput, commitTerminal, failure?: string | null)`; `completeEstimateInStore(deps, id, estimateId, rawOutput, commitTerminal?, classify = classifyEstimateOutput, callFailure: string | null = null)`. Estimate `reasonCode` `estimate-call-failed:<code>`; call record `{ outcome: "failed", reason: <code> }`; blocked reason `<usageUnknownReason>:<code>`.
- Fixture options: `SingleCallOptions.errorCode?: string | null`, `QueuedAnswer.errorCode?: string | null` (absent ⇒ `"single-call-output-invalid"` for a failed call, as today).

- [ ] **Step 1: Fixtures** (default-preserving; listed for the human)
  - `estimateHarness.ts` `SingleCallOptions`: add `  /** ccloop error codes spec §4.5: the failed call's record errorCode (absent: single-call-output-invalid, as before). */\n  errorCode?: string | null;`; line 63 `outcome, outputRef, errorCode: outcome === "failed" ? (options.errorCode === undefined ? "single-call-output-invalid" : options.errorCode) : null,`.
  - `requirementHarness.ts:30` `QueuedAnswer` gains `; errorCode?: string | null` before the closing `}`; line 67 `outcome, outputRef, errorCode: outcome === "failed" ? (answer.errorCode === undefined ? "single-call-output-invalid" : answer.errorCode) : null };`.

- [ ] **Step 2: Write the failing test** — create `tests/control/singleCallErrorCode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeSingleCallErrorCode } from "../../src/control/executionDriver.js";
import { readDraft } from "../../src/control/requirementRecords.js";
import { estimateHarness } from "./fixtures/estimateHarness.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

// ccloop error codes spec (2026-10-15) §4.5, criterion 6: ccloop's single-call record names why a call failed. Orca now
// stores that code where it stores the failure, never ccloop's free text; and a call ccloop refused before spawning (its
// catalog cap or model changed) is not retried automatically, because the same envelope would be refused again.
const preSpawn = (purpose: "clarify" | "split", errorCode: string) => ({ purpose, output: null, outcome: "failed" as const, tokens: 0, errorCode });

describe("the record's errorCode, normalised (spec A §4.5)", () => {
  it("keeps a code, cuts at the first colon, and makes anything else unknown (plan correction K4)", () => {
    expect([null, "omp-single-call-cap-exceeded", "omp-single-call-stop:length", "x:y\n<script>", "<b>x</b>:y\n", "X-Y", "a".repeat(65), ""].map(normalizeSingleCallErrorCode))
      .toEqual([null, "omp-single-call-cap-exceeded", "omp-single-call-stop", "x", "unknown", "unknown", "unknown", "unknown"]);
  });
});

describe("where a failed call is stored (spec A §4.5)", () => {
  it("estimate: a failed call's reason carries ccloop's code; a hostile one is stored as unknown", async () => {
    for (const [errorCode, reasonCode] of [["omp-single-call-cap-exceeded", "estimate-call-failed:omp-single-call-cap-exceeded"], ["<b>x</b>:y\n", "estimate-call-failed:unknown"]]) {
      const x = await estimateHarness({ outcome: "failed", tokens: 0, errorCode }); try {
        await x.rounds(() => x.estimate().state !== "running");
        expect(x.estimate()).toMatchObject({ state: "failed", reasonCode });
      } finally { await x.h.dispose(); }
    }
  });

  it("usage unknown: the block reason appends ccloop's code", async () => {
    const x = await estimateHarness({ outcome: "failed", tokens: null, errorCode: "omp-single-call-unavailable" }); try {
      await x.rounds(() => x.body().state === "blocked");
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown:omp-single-call-unavailable" });
    } finally { await x.h.dispose(); }
  });

  it("clarify: a pre-spawn refusal fails the round at once, its one call recorded failed with the code, lastInvalidReason still no-output", async () => {
    const x = await requirementHarness({ answers: [1, 2, 3].map(() => preSpawn("clarify", "omp-single-call-cap-exceeded")) });
    try {
      await x.until(() => x.round(1).state === "failed");
      expect(x.round(1)).toMatchObject({ state: "failed", retries: 0, reasonCode: "clarify-output-invalid", lastInvalidReason: "no-output" });
      expect(x.round(1).calls.map((call) => [call.outcome, call.reason])).toEqual([["failed", "omp-single-call-cap-exceeded"]]);
      expect(x.fake.calls.accept).toHaveLength(1);
    } finally { await x.dispose(); }
  });

  it("clarify: any other failed call keeps its automatic retry, recorded failed with its code, and the next prompt says no-output", async () => {
    const x = await requirementHarness({ answers: [preSpawn("clarify", "<b>x</b>:y\n"), { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.round(1).calls.map((call) => [call.outcome, call.reason])).toEqual([["failed", "unknown"], ["valid", null]]);
      expect(x.round(1).retries).toBe(1);
      const second = x.fake.calls.accept[1]!;
      expect(second.work.kind === "single-call" && second.work.prompt).toContain("no-output");
    } finally { await x.dispose(); }
  });

  it("split: a pre-spawn refusal fails the draft at once, its call recorded failed with the code", async () => {
    const x = await requirementHarness({ answers: [1, 2, 3].map(() => preSpawn("split", "omp-single-call-unavailable")), startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "failed");
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "failed", autoRetry: 0, reasonCode: "split-output-invalid", calls: [{ outcome: "failed", reason: "omp-single-call-unavailable" }] });
      expect(x.fake.calls.accept).toHaveLength(1);
    } finally { await x.dispose(); }
  });
});
```

Named rewrites (each keeps its title; add the comment line shown above the changed assertion):
- `tests/control/driverEstimate.test.ts:86`: old `      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown" });` → new
  ```ts
      // Rewritten for the ccloop error codes spec (2026-10-15; its §5 names this criterion): this now encodes that the
      // named block also carries ccloop's code for the failed call (the harness's failed calls name single-call-output-invalid).
      expect(x.body().drive).toMatchObject({ blockedAt: "C", blockedReason: "estimate-usage-unknown:single-call-output-invalid" });
  ```
- `tests/control/driverEstimate.test.ts:136`: old `    ["a call that failed", { outcome: "failed" as const }, "estimate-call-failed"],` → new
  ```ts
    // Rewritten for the ccloop error codes spec (2026-10-15; §5): a failed call's reason now carries ccloop's code.
    ["a call that failed", { outcome: "failed" as const }, "estimate-call-failed:single-call-output-invalid"],
  ```
- `tests/control/driverRequirementSplit.test.ts:57`: old `      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "invalid", output: null, calls: [{ outcome: "invalid" }] });` → new
  ```ts
      // Rewritten for the ccloop error codes spec (2026-10-15; §5): this now encodes that the failed call is recorded as
      // failed with ccloop's code, and still uses one of the two automatic retries.
      expect(readDraft(x.store, "r", 1)).toMatchObject({ state: "invalid", output: null, calls: [{ outcome: "failed", reason: "single-call-output-invalid" }] });
  ```

- [ ] **Step 3: Run red** — `tests/control/singleCallErrorCode.test.ts tests/control/driverEstimate.test.ts tests/control/driverRequirementSplit.test.ts` to `a5-red.log`. Expected red: the normaliser test (`not a function`), every "where a failed call is stored" test, and the three rewritten assertions. `driverEstimate.test.ts:27` stays green (K3).

- [ ] **Step 4: Implement**
  - `executionDriver.ts`, after the `singleCallRecordSchema` declaration (`}).strict();` at line 648):
    ```ts
    /**
     * Spec 2026-10-15 ccloop error codes §4.5: the record's errorCode as Orca stores it -- the part before the first `:`
     * (ccloop prints `omp-single-call-stop:<reason>`) when it is a code, else `unknown`; null stays null.
     */
    export function normalizeSingleCallErrorCode(errorCode: string | null): string | null {
      if (errorCode === null) return null;
      const head = errorCode.split(":", 1)[0]!;
      return /^[a-z][a-z0-9-]{0,63}$/.test(head) ? head : "unknown";
    }
    ```
    In `stepCSingleCall` replace line 695 with
    ```ts
      // §4.5: "the call failed" means outcome !== complete; the handler is told ccloop's (normalised) code, rawOutput is unchanged.
      const failure = record.outcome === "complete" ? null : normalizeSingleCallErrorCode(record.errorCode);
      const settled = handler.evaluate === undefined ? rawOutput : await handler.evaluate(deps, run, rawOutput, failure);
    ```
    append `, failure` as the last argument of the `handler.complete(…)` call (its closing `});` at line 703 becomes `}, failure);`), and line 706's block reason becomes `failure === null ? handler.usageUnknownReason : \`${handler.usageUnknownReason}:${failure}\``.
  - `singleCallPurposes.ts`: line 30 `  evaluate?(deps: SingleCallPrepareDeps, run: SingleCallRunRow, rawOutput: unknown, failure?: string | null): Promise<unknown>;`; line 34 `  complete(deps: { store: ControlStore; admissionGate?: AdmissionGate }, run: SingleCallRunRow, rawOutput: unknown, commitTerminal: () => void, failure?: string | null): void;`; lines 53-55:
    ```ts
      complete(deps: { store: ControlStore; admissionGate?: AdmissionGate }, run: SingleCallRunRow, rawOutput: unknown, commitTerminal: () => void, failure: string | null = null): void {
        completeEstimateInStore(deps, run.groupId, String(run.estimateId), rawOutput, commitTerminal, ESTIMATE.classify, failure);
      },
    ```
  - `webService.ts` `completeEstimateInStore`: after the `classify` parameter (line 1109) add `  // Spec 2026-10-15 ccloop error codes §4.5: ccloop's code for a failed call (driver-normalised); the service method passes none.\n  callFailure: string | null = null,`; line 1136 becomes
    ```ts
          let reasonCode: string | null = classified.ok ? null
            : classified.reasonCode === "estimate-call-failed" && callFailure !== null ? `estimate-call-failed:${callFailure}` : classified.reasonCode;
    ```
  - `requirementCalls.ts`: after the imports add
    ```ts
    /** Spec 2026-10-15 ccloop error codes §4.5: ccloop refused before spawning (books 0); the same envelope would be refused again. */
    export const PRE_SPAWN_REFUSALS: ReadonlySet<string> = new Set(["omp-single-call-cap-exceeded", "omp-single-call-unavailable"]);
    ```
    `recordClarify` gains a last parameter `failure: string | null`; line 196 becomes
    ```ts
      round.calls = [...round.calls, failure !== null ? callOf(run, "failed", failure) : callOf(run, classified.ok ? "valid" : "invalid", classified.ok ? null : classified.reason)];
    ```
    and line 200 `  } else if (round.retries < MAX_AUTO_RETRIES && (failure === null || !PRE_SPAWN_REFUSALS.has(failure))) {` (line 201's `lastInvalidReason: classified.reason` is unchanged — `no-output`). `CLARIFY_HANDLER.complete(deps, run, rawOutput, commitTerminal, failure = null) { settleRequirementCall(deps, run, commitTerminal, (store, group, target, settled) => recordClarify(store, group, target, settled, rawOutput, failure)); },`.
    `recordSplit` gains `failure: string | null`; line 296 becomes
    ```ts
      draft.calls = [...draft.calls, failure !== null ? callOf(run, "failed", failure) : callOf(run, ev.ok ? "valid" : "invalid", ev.ok ? null : ev.reasons.join("; "))];
    ```
    and line 299 `  else if (draft.autoRetry < MAX_AUTO_RETRIES && (failure === null || !PRE_SPAWN_REFUSALS.has(failure))) {` (the failed branch's `reasonCode` already answers `split-output-invalid` for a schema-invalid evaluation). `SPLIT_HANDLER.complete(deps, run, evaluation, commitTerminal, failure = null) { settleRequirementCall(deps, run, commitTerminal, (store, group, target, settled) => recordSplit(store, group, target, settled, evaluation as SplitEvaluation, failure)); },`.

- [ ] **Step 5: Run green** — `tests/control/singleCallErrorCode.test.ts tests/control/driverEstimate.test.ts tests/control/driverRequirementSplit.test.ts tests/control/driverRequirementClarify.test.ts tests/control/estimateOutcome.test.ts tests/control/requirementCommands.test.ts tests/control/singleCallOutputCap.test.ts` to `a5-green.log`; typecheck. All pass, 0 skipped.

- [ ] **Step 6: Commit** — the five src files, the two fixtures, the three test files and the new test; message `feat(control): carry a single call's errorCode into its estimate, call record and block reason`.

- [ ] **Step 7 (reviewer, clone `a5`): mutations** (test `tests/control/singleCallErrorCode.test.ts` unless named)
  - `A5a` normaliser: `src/control/executionDriver.ts` `{"from": "  return /^[a-z][a-z0-9-]{0,63}$/.test(head) ? head : \"unknown\";\n", "to": "  return errorCode;\n"}` — red: the normaliser test and the estimate test's hostile row.
  - `A5b` estimate suffix: `src/control/webService.ts` `{"from": "classified.reasonCode === \"estimate-call-failed\" && callFailure !== null ? `estimate-call-failed:${callFailure}` : classified.reasonCode", "to": "classified.reasonCode"}` — red: "estimate: …"; second run `A5b2` with test `tests/control/driverEstimate.test.ts` — red: the rewritten `:136` row only.
  - `A5c` usage-unknown suffix: `src/control/executionDriver.ts` `{"from": "failure === null ? handler.usageUnknownReason : `${handler.usageUnknownReason}:${failure}`", "to": "handler.usageUnknownReason"}` — red: "usage unknown…"; `A5c2` on `tests/control/driverEstimate.test.ts` — red: the rewritten `:86` test only.
  - `A5d` clarify record: `src/control/requirementCalls.ts` `{"from": "failure !== null ? callOf(run, \"failed\", failure) : callOf(run, classified.ok", "to": "callOf(run, classified.ok"}` — red: both clarify tests at the `calls` assertion.
  - `A5e` clarify re-queue: same file `{"from": "round.retries < MAX_AUTO_RETRIES && (failure === null || !PRE_SPAWN_REFUSALS.has(failure))", "to": "round.retries < MAX_AUTO_RETRIES"}` — red: "clarify: a pre-spawn refusal…" (`retries` 2, three calls).
  - `A5f` split record: same file `{"from": "failure !== null ? callOf(run, \"failed\", failure) : callOf(run, ev.ok", "to": "callOf(run, ev.ok"}` — red: "split: …"; `A5f2` on `tests/control/driverRequirementSplit.test.ts` — red: the rewritten `:57` test.
  - `A5g` split re-queue: same file `{"from": "draft.autoRetry < MAX_AUTO_RETRIES && (failure === null || !PRE_SPAWN_REFUSALS.has(failure))", "to": "draft.autoRetry < MAX_AUTO_RETRIES"}` — red: "split: …" (`state: "invalid"`, draft 2 exists).

---

