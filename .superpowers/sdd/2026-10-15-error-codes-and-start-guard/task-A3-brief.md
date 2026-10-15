### Task A3: Stored codes keep ccloop's code (spec A §4.3; criteria 3, 4)

**Files:**
- Modify: `src/control/profiles.ts:1` (import), `:25` (`probeFailureCode` type), `:135-137` (`probeFailureCode()`)
- Modify: `src/control/planImport.ts:41` (`EstimatorSlotOutcome` rejected `code`), `:147` (`rejectedEstimatorRequest`)
- Modify: `src/control/agentFreeze.ts:132` (+ import)
- Modify: `src/panel/controlViews.ts:1191` (+ import)
- Modify: `src/control/webService.ts:675`, `:682` (`recoverAgentUpdates`, `observeAgentUpdates`) (+ import `peerCode` beside A2's `peerFailure`)
- Modify: `src/control/savedResultRecovery.ts:104` (+ import)
- Test (create): `tests/control/peerCodeStored.test.ts`; append one test to `tests/control/savedResultUnmeteredLineage.test.ts` (new `it` inside its `describe`, plus `import { ControlError } from "../../src/control/errors.js";`)

**Interfaces:**
- Consumes: Task A1's `peerCode(error: ControlError): string`.
- Produces: `ObservedProfile.probeFailureCode: string | null`; `function probeFailureCode(error: unknown): string`; `EstimatorSlotOutcome` rejected `code: string`; `export function rejectedEstimatorRequest(code: string): FrozenEstimateRequest`. Classification in `resolveGroupSelections` and `rolePreview` stays on `error.code`.

- [ ] **Step 1: Write the failing tests** — create `tests/control/peerCodeStored.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyAgentUpdate } from "../../src/control/agentUpdates.js";
import { resolveGroupSelections } from "../../src/control/agentFreeze.js";
import { ControlError } from "../../src/control/errors.js";
import type { ExecutionPort } from "../../src/control/executionPort.js";
import { estimatorSlotFor } from "../../src/control/planImport.js";
import { WebControlService } from "../../src/control/webService.js";
import { readSelectionPreview } from "../../src/panel/controlViews.js";
import { webFixture } from "./fixtures/web.js";

// ccloop error codes spec (2026-10-15) §4.3, criteria 3 and 4: where Orca reduces a ccloop failure to a code it keeps
// ccloop's code, so the estimator, the preview and the installation panel say why -- while the choice between "refused"
// and "try again" still reads Orca's own classification of the error, so a transient exit is never frozen as a refusal.
const CATALOG = () => new ControlError("control-peer-exit", "2:omp-model-catalog-unavailable: spawn ENOENT");
const open = { schema: "orca-raw-command-v1", commandId: "open-r", actorId: "human", expectedRevision: 0, verb: "requirement-open", target: { kind: "group", groupId: "r" },
  payload: { groupId: "r", repoId: "repo", idea: "Let people export their notes as Markdown." } } as never;
const apply = { schema: "orca-raw-command-v1", commandId: "update-1", expectedRevision: 0, actorId: "human", verb: "apply-agent-update",
  target: { kind: "operator", operatorId: "human" }, payload: { previewId: "preview-1", baseTableHash: "a".repeat(64), acceptedChangeIds: ["change-1"] } } as never;
const observation = { schema: "orca-agent-detection-observation-v1", baseTableHash: "a".repeat(64), observedAt: "2026-10-15T00:00:00.000Z", installed: [] };

describe("stored codes keep ccloop's code (spec A §4.3)", () => {
  it("F1: the profile probe, every estimator slot built on it and requirement-open name ccloop's code", async () => {
    const h = await webFixture(); try {
      h.resolveAgent.mockImplementation(async () => { throw CATALOG(); });
      expect((await h.deps.profileRouter.probe(h.frozen, { agent: "codex" })).probeFailureCode).toBe("omp-model-catalog-unavailable");
      expect((await estimatorSlotFor({ store: h.store, profileRouter: h.deps.profileRouter }, "human", {}, h.frozen)).outcome)
        .toMatchObject({ kind: "rejected", code: "omp-model-catalog-unavailable" });
      const service = new WebControlService({ ...h.deps, knownRepository: (id: string) => id === "repo" });
      expect(await service.openRequirement(open)).toMatchObject({ error: { code: "agent-selection-rejected", message: "agent-selection-rejected:estimator:omp-model-catalog-unavailable" } });
      h.resolveAgent.mockImplementation(async () => { throw new ControlError("control-peer-exit", "1:Error: lost"); });
      expect((await h.deps.profileRouter.probe(h.frozen, { agent: "codex" })).probeFailureCode).toBe("control-peer-exit");
    } finally { await h.dispose(); }
  });

  it("F2: a transient peer exit in a preview is still unavailable and carries ccloop's code; confirm still rethrows it", async () => {
    const h = await webFixture(); try {
      h.resolveAgent.mockImplementation(async () => { throw CATALOG(); });
      const preview = await resolveGroupSelections({ store: h.store, port: h.deps.port }, "g", "human", "preview");
      expect(preview.slots.map((slot) => [slot.key, slot.outcome])).toEqual([
        ["reconcile", { kind: "unavailable", code: "omp-model-catalog-unavailable" }],
        ["task:a", { kind: "unavailable", code: "omp-model-catalog-unavailable" }],
      ]);
      await expect(resolveGroupSelections({ store: h.store, port: h.deps.port }, "g", "human", "confirm")).rejects.toMatchObject({ code: "control-peer-exit" });
      expect((await readSelectionPreview(h.store, h.deps.port, "human", "g")).rolePreviews).toEqual({
        worker: { kind: "unavailable", code: "omp-model-catalog-unavailable" }, estimator: { kind: "unavailable", code: "omp-model-catalog-unavailable" },
      });
    } finally { await h.dispose(); }
  });

  it("F3: an installation observation and a reconciliation that fail name ccloop's code; a non-ControlError is control-internal-error", async () => {
    const h = await webFixture(); try {
      const base = h.deps.port as unknown as Record<string, unknown>;
      const observing = new WebControlService({ ...h.deps, port: { ...base, observeAgentInstallations: async () => { throw new ControlError("control-peer-exit", "2:agent-config-invalid: bad table"); } } as unknown as ExecutionPort });
      await observing.observeAgentUpdates();
      expect(observing.agentUpdateView("human").failureCode).toBe("agent-config-invalid");
      const crashing = new WebControlService({ ...h.deps, port: { ...base, observeAgentInstallations: async () => { throw new Error("socket hang up"); } } as unknown as ExecutionPort });
      await crashing.observeAgentUpdates();
      expect(crashing.agentUpdateView("human").failureCode).toBe("control-internal-error");
      // A pending operation (ccloop died during apply), reconciled at startup against a ccloop that fails again.
      const dying = { applyAgentInstallations: async () => { throw new ControlError("control-peer-exit", "2:agent-installation-apply-failed: disk full"); } } as unknown as ExecutionPort;
      await expect(applyAgentUpdate({ store: h.store, port: dying }, apply, { client: "web", principal: "user:owner" })).rejects.toMatchObject({ code: "control-peer-exit" });
      const reconciling = new WebControlService({ ...h.deps, port: { ...base, applyAgentInstallations: dying.applyAgentInstallations, observeAgentInstallations: async () => observation } as unknown as ExecutionPort });
      await reconciling.recoverAgentUpdates();
      expect(reconciling.agentUpdateView("human").failureCode).toBe("agent-installation-apply-failed");
    } finally { await h.dispose(); }
  });
});
```
Append inside the `describe` of `tests/control/savedResultUnmeteredLineage.test.ts` (after its last `it`), reusing its `world()` and `release()`:

```ts
  // ccloop error codes spec (2026-10-15) §4.3, criterion 4: the saved-result `unavailable` reason names ccloop's code.
  it("names ccloop's code when the saved-result eligibility read fails with a peer exit", async () => {
    const { t, service } = await world(); const driver = t.driver(); try {
      const source = await t.claim();
      await t.until(driver, () => t.body(source).state === "blocked");
      expect(await release(t, service, source)).not.toHaveProperty("error");
      const failing = { ...(t.fake.port as object), readFeatures: async () => { throw new ControlError("control-peer-exit", "2:control-features-failed: lost"); } };
      const failingService = new WebControlService({ ...(t.service as any).deps, profileRouter: createExecutionProfileRouter([resolveProfile(profileSnapshot(), failing as never)]) });
      expect(await failingService.savedResultEligibility(source)).toEqual({ status: "unavailable", reason: "control-features-failed" });
    } finally { await driver.stop(); await t.h.dispose(); }
  }, 30_000);
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/error-codes-start-guard && ./node_modules/.bin/vitest run tests/control/peerCodeStored.test.ts tests/control/savedResultUnmeteredLineage.test.ts > /private/tmp/oec/logs/a3-red.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/a3-red.log
```
Read it whole. Expected red: F1 at the first assertion (`"control-peer-exit"` received), F2 at the slots (`code: "control-peer-exit"`), F3 at the first `failureCode` (`"control-peer-exit"`), the saved-result test (`reason: "control-peer-exit"`). The `confirm` rejection inside F2 and the `"1:Error: lost"` line inside F1 are green today (they pin what must not move).

- [ ] **Step 3: Implement**
  - `profiles.ts`: add `import { peerCode } from "./ccloopPort.js";`; line 25 `readonly probeFailureCode: string | null;`; lines 135-137:
    ```ts
    function probeFailureCode(error: unknown): string {
      // Spec 2026-10-15 ccloop error codes §4.3: a peer exit is stored as ccloop's own code.
      return error instanceof ControlError ? peerCode(error) : "control-capability-probe-failed";
    }
    ```
  - `planImport.ts:41` `| { kind: "rejected"; partial: PartialSelection | null; code: string };` and `:147` `export function rejectedEstimatorRequest(code: string): FrozenEstimateRequest {` (leave `KnownControlErrorCode` in its import even if unused; the build has no unused-import check).
  - `agentFreeze.ts`: add `import { peerCode } from "./ccloopPort.js";`; line 132 `        slots.push({ ...identity, outcome: { kind: "unavailable", code: peerCode(error) } });` (line 131's `if (mode === "confirm") throw error;` and line 129's classification on `error.code` are unchanged).
  - `controlViews.ts`: add `import { peerCode } from "../control/ccloopPort.js";`; line 1191 `        ? { kind: "unavailable" as const, code: peerCode(error) }`.
  - `webService.ts`: extend A2's import to `import { peerCode, peerFailure } from "./ccloopPort.js";`; line 675 `    catch (error) { reconcileFailure = error instanceof ControlError ? peerCode(error) : "control-internal-error"; }`; line 682 `    catch (error) { this.installationObservation = null; this.installationFailure = error instanceof ControlError ? peerCode(error) : "control-internal-error"; }`.
  - `savedResultRecovery.ts`: add `import { peerCode } from "./ccloopPort.js";`; in line 104 replace `error instanceof ControlError?error.code:` with `error instanceof ControlError?peerCode(error):`.

- [ ] **Step 4: Run green** — the two test files plus `tests/control/agentFreeze.test.ts tests/control/planImport.test.ts tests/control/estimatorCompatibility.test.ts tests/control/requirementCommands.test.ts tests/control/agentUpdates.test.ts tests/panel/agentSelectionApi.test.ts tests/panel/controlConfig.test.ts` to `/private/tmp/oec/logs/a3-green.log`; typecheck to `a3-tc.log`. All pass, 0 skipped; `rc=0`. (If `tests/panel/controlConfig.test.ts` does not exist, drop it and say so.)

- [ ] **Step 5: Commit** — `git add src/control/profiles.ts src/control/planImport.ts src/control/agentFreeze.ts src/panel/controlViews.ts src/control/webService.ts src/control/savedResultRecovery.ts tests/control/peerCodeStored.test.ts tests/control/savedResultUnmeteredLineage.test.ts`; message `feat(control): store ccloop's own code where a peer exit is reduced to a code`.

- [ ] **Step 6 (reviewer, clone `a3`): mutations** (test `tests/control/peerCodeStored.test.ts` unless named)
  - `A3a` profile probe stores `error.code`: `src/control/profiles.ts` `{"from": "return error instanceof ControlError ? peerCode(error) : \"control-capability-probe-failed\";", "to": "return error instanceof ControlError ? error.code : \"control-capability-probe-failed\";"}` — red: F1 only.
  - `A3b` preview slot stores `error.code`: `src/control/agentFreeze.ts` `{"from": "outcome: { kind: \"unavailable\", code: peerCode(error) } });", "to": "outcome: { kind: \"unavailable\", code: error.code } });"}` — red: F2 at the slots.
  - `A3c` classify on `peerCode` (criterion 3): `src/control/agentFreeze.ts` `{"from": "(nonDurableControlErrorClassifications as Record<string, string>)[error.code] === \"transient\"", "to": "(nonDurableControlErrorClassifications as Record<string, string>)[peerCode(error)] === \"transient\""}` — red: F2 (slots `rejected`; confirm resolves instead of rejecting).
  - `A3d` role preview stores `error.code`: `src/panel/controlViews.ts` `{"from": "? { kind: \"unavailable\" as const, code: peerCode(error) }", "to": "? { kind: \"unavailable\" as const, code: error.code }"}` — red: F2 at `rolePreviews`.
  - `A3e` observation: `src/control/webService.ts` `{"from": "this.installationFailure = error instanceof ControlError ? peerCode(error) : \"control-internal-error\";", "to": "this.installationFailure = error instanceof ControlError ? error.code : \"control-internal-error\";"}` — red: F3 first assertion.
  - `A3f` non-ControlError back to a false peer exit: same file `{"from": "this.installationFailure = error instanceof ControlError ? peerCode(error) : \"control-internal-error\";", "to": "this.installationFailure = error instanceof ControlError ? peerCode(error) : \"control-peer-exit\";"}` — red: F3 second assertion.
  - `A3g` reconciliation: same file `{"from": "reconcileFailure = error instanceof ControlError ? peerCode(error) : \"control-internal-error\";", "to": "reconcileFailure = error instanceof ControlError ? error.code : \"control-internal-error\";"}` — red: F3 last assertion.
  - `A3h` saved result: `src/control/savedResultRecovery.ts` `{"from": "error instanceof ControlError?peerCode(error):", "to": "error instanceof ControlError?error.code:"}`, test `tests/control/savedResultUnmeteredLineage.test.ts -t "names ccloop's code"` — red.

---

