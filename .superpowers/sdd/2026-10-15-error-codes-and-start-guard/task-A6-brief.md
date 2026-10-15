### Task A6: A human retry recomputes the bound (spec A §4.8; criterion 7; correction K5)

**Files:**
- Modify: `src/control/stopIntent.ts:440` (`applyRecoveryRetry` signature), `:455` (`retryGroup` call), `:497-504` (`retryGroup`), `:513-547` (`retryRequirementInTransaction`)
- Modify: `src/control/webService.ts:579-581` (`recoveryRetry`), new private method, imports
- Modify (fixture): `tests/control/fixtures/requirementHarness.ts` (`queuedPort`: `setResolveAgent`, `baseResolveAgent`)
- Test (create): `tests/control/requirementRetryBound.test.ts`

**Interfaces:**
- Consumes: `singleCallOutputBound(preflightMaxOutputTokens, resolution)` (`src/control/estimator.ts:61-63`); A3's `probeFailureCode` (ccloop's code); `describeError` (A4).
- Produces: `export function applyRecoveryRetry(deps: StopDeps, command: RecoveryRetryCommand, outputBound: number | null = null): StopCommandResult`; `retryRequirementInTransaction(store, groupId, revision, outputBound: number | null)` stores `group.requirement.maxOutputTokens = outputBound` only when it re-queues; one stderr line `orca-control: recovery-retry <groupId>: output bound kept at <n>: <reason>\n` when the bound cannot be recomputed. Fixture: `queuedPort(...)` returns `{ port, calls, setResolveAgent(fn: ((partial: PartialSelection) => Promise<AgentResolution>) | null): void, baseResolveAgent }`.

- [ ] **Step 1: Fixture** — in `requirementHarness.ts` `queuedPort`: after `const resolveAgent = fixtureResolveAgent(…);` add `let resolveOverride: ((partial: PartialSelection) => Promise<AgentResolution>) | null = null;`; the port's `resolveAgent: async (partial) => resolveAgent(partial),` becomes `resolveAgent: async (partial) => (resolveOverride ?? resolveAgent)(partial),` (a closure, so the router's `bind` at creation still sees later overrides); the `return { port, calls };` becomes `return { port, calls, baseResolveAgent: resolveAgent, setResolveAgent: (fn: ((partial: PartialSelection) => Promise<AgentResolution>) | null) => { resolveOverride = fn; } };`. Add `import type { AgentResolution, PartialSelection } from "../../../src/control/agentSelection.js";`.

- [ ] **Step 2: Write the failing test** — create `tests/control/requirementRetryBound.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { readRequirementGroup } from "../../src/control/requirementRecords.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { ROUND_ONE } from "./fixtures/requirementOutputs.js";

// ccloop error codes spec (2026-10-15) §4.8, criterion 7: a call refused for its frozen output bound is not retried
// automatically (§4.5); a person's group retry recomputes that requirement's bound from the current catalog -- for the
// selection its calls run (plan correction K5) -- and if the agent cannot be asked, the retry behaves exactly as before.
const CAP_REFUSED = { purpose: "clarify" as const, output: null, outcome: "failed" as const, tokens: 0, errorCode: "omp-single-call-cap-exceeded" };

describe("a human group retry recomputes the output bound (spec A §4.8)", () => {
  it("stores the bound recomputed from the frozen selection's current cap, and the next call is sent with it", async () => {
    const x = await requirementHarness({ answers: [CAP_REFUSED, { purpose: "clarify", output: ROUND_ONE }] });
    try {
      await x.until(() => x.round(1).state === "failed");
      const asked: unknown[] = [];
      x.fake.setResolveAgent(async (partial) => { asked.push(partial); return { ...(await x.fake.baseResolveAgent(partial)), singleCallOutputCap: 100_000 }; });
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect(readRequirementGroup(x.store, "r").requirement.maxOutputTokens).toBe(100_000);
      expect(asked).toEqual([{ agent: "codex", model: "fixture-model", contextWindow: "agent-default" }]);
      await x.until(() => x.round(1).state === "awaiting-answers");
      expect(x.fake.calls.accept.map((sent) => (sent.work.kind === "single-call" ? sent.work.maxOutputTokens : null))).toEqual([64_000, 100_000]);
    } finally { await x.dispose(); }
  });

  it("with a failing probe the retry re-queues under the frozen bound and one log line names why", async () => {
    const x = await requirementHarness({ answers: [CAP_REFUSED, { purpose: "clarify", output: ROUND_ONE }] });
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true; });
    try {
      await x.until(() => x.round(1).state === "failed");
      x.fake.setResolveAgent(async () => { throw new ControlError("control-peer-exit", "2:omp-model-catalog-unavailable: spawn ENOENT"); });
      expect(await x.service.recoveryRetry(x.command("recovery-retry", { scope: "group", groupId: "r" }))).toMatchObject({ result: { kind: "recovery-observed", resolved: true } });
      expect([readRequirementGroup(x.store, "r").requirement.maxOutputTokens, x.round(1).state]).toEqual([64_000, "drafting"]);
      expect(lines.filter((line) => line.startsWith("orca-control: recovery-retry r:"))).toEqual(["orca-control: recovery-retry r: output bound kept at 64000: omp-model-catalog-unavailable\n"]);
    } finally { spy.mockRestore(); await x.dispose(); }
  });
});
```

- [ ] **Step 3: Run red** — to `a6-red.log`. Expected red: test 1 at `maxOutputTokens` (`64000`); test 2 at the log line (`[]` received); its first two assertions are green today (they pin "exactly as before").

- [ ] **Step 4: Implement**
  - `stopIntent.ts`: `export function applyRecoveryRetry(deps: StopDeps, command: RecoveryRetryCommand, outputBound: number | null = null): StopCommandResult {`; line 455 `          : retryGroup(store, groupId, context, outputBound);`; `function retryGroup(store: ControlStore, groupId: string, context: WebCommandContext, outputBound: number | null): ObservedRecovery {` and its call `? retryRequirementInTransaction(store, groupId, context.nextCommandRevision, outputBound)`; `function retryRequirementInTransaction(store: ControlStore, groupId: string, revision: number, outputBound: number | null)`; its line `    if (requeue) { wakeIds.push(queueRequirementCall(store, groupId, \`recovery-${revision}\`)); resolved = true; }` becomes
    ```ts
        // Spec 2026-10-15 ccloop error codes §4.8: a human retry sends the call with the bound recomputed before this
        // transaction (webService.ts recoveryRetry); null keeps the frozen one. Automatic retries never pass one.
        if (requeue && outputBound !== null) group.requirement.maxOutputTokens = outputBound;
        if (requeue) { wakeIds.push(queueRequirementCall(store, groupId, `recovery-${revision}`)); resolved = true; }
    ```
  - `webService.ts`: imports — add `singleCallOutputBound` to the `./estimator.js` import (line 13); add `hasRequirementBlock, latestDraft, latestRound, readRequirementGroup` to the `./requirementRecords.js` import (line 54); add `describeError` to the `./executionDriver.js` import (line 1). Replace `recoveryRetry` (lines 579-581) with:
    ```ts
      async recoveryRetry(command: RecoveryRetryCommand): Promise<WebCommandResult> {
        const replay = preflightWebCommand<WebCommandResult>(this.store, command); if (replay) return replay.body;
        const outputBound = command.target.kind === "group" ? await this.retryOutputBound(command.target.groupId) : null;
        return applyRecoveryRetry(this.stopDeps(), command, outputBound) as WebCommandResult;
      }
      /**
       * Spec 2026-10-15 ccloop error codes §4.8: for a clarifying requirement whose latest round or draft failed or was
       * interrupted, the output bound its calls would be sent with now -- asked of the frozen selection (plan correction K5)
       * through the requirement's own profile. Null, with one log line, when it cannot be asked: the retry is as before.
       */
      private async retryOutputBound(groupId: string): Promise<number | null> {
        const row = this.store.db.prepare("SELECT body FROM groups WHERE id=?").get(groupId);
        if (row === undefined || !hasRequirementBlock(JSON.parse(String(row.body)) as { requirement?: unknown })) return null;
        const group = readRequirementGroup(this.store, groupId);
        if (group.status !== "clarifying") return null;
        const step = group.requirement.consensus === null ? latestRound(this.store, groupId) : latestDraft(this.store, groupId);
        if (step === null || (step.state !== "failed" && step.state !== "interrupted")) return null;
        const kept = (reason: string): null => { process.stderr.write(`orca-control: recovery-retry ${groupId}: output bound kept at ${group.requirement.maxOutputTokens}: ${reason}\n`); return null; };
        let profile: ReturnType<ExecutionProfileRouter["resolve"]>;
        try { profile = this.deps.profileRouter.resolve("budget-estimate", group.requirement.profile.profileId, group.requirement.profile.profileHash); }
        catch (error) { return kept(describeError(error)); }
        const preflight = profile.snapshot.profile.estimatorPreflight;
        if (preflight === null) return kept("estimator-preflight-missing");
        const observation = await this.deps.profileRouter.probe(profile, group.requirement.agentSlot.selection);
        if (observation.resolution === null) return kept(observation.probeFailureCode ?? "probe-failed");
        return singleCallOutputBound(preflight.maxOutputTokens, observation.resolution);
      }
    ```
    (`ExecutionProfileRouter` is the type of `this.deps.profileRouter`; import it as a type from `./profiles.js` if it is not already in scope — check with `grep -n "ExecutionProfileRouter" src/control/webService.ts` and redirect.)

- [ ] **Step 5: Run green** — `tests/control/requirementRetryBound.test.ts tests/control/requirementRecovery.test.ts tests/control/stopIntent.test.ts tests/control/driverRequirementClarify.test.ts tests/control/driverRequirementSplit.test.ts tests/control/requirementGuards.test.ts` (drop any that does not exist and say so) to `a6-green.log`; typecheck.

- [ ] **Step 6: Commit** — `src/control/stopIntent.ts src/control/webService.ts tests/control/fixtures/requirementHarness.ts tests/control/requirementRetryBound.test.ts`; message `feat(control): recompute a requirement's output bound on a human group retry`.

- [ ] **Step 7 (reviewer, clone `a6`): mutations** — test `tests/control/requirementRetryBound.test.ts`:
  - `A6a` skip the store: `src/control/stopIntent.ts` `{"from": "    if (requeue && outputBound !== null) group.requirement.maxOutputTokens = outputBound;\n", "to": ""}` — red: test 1 (`64000`).
  - `A6b` probe failure refuses: `src/control/webService.ts` `{"from": "if (observation.resolution === null) return kept(observation.probeFailureCode ?? \"probe-failed\");", "to": "if (observation.resolution === null) throw new ControlError(\"recovery-blocked\", \"retry-bound\");"}` — red: test 2 (the retry rejects).
  - `A6c` probe today's preferences instead of the frozen selection: same file `{"from": "this.deps.profileRouter.probe(profile, group.requirement.agentSlot.selection)", "to": "this.deps.profileRouter.probe(profile, group.requirement.agentSlot.partial)"}` — red: test 1 at `asked` (the partial `{ agent: "codex" }` received).

---

