### Task 7 (Orca): The resolution schema and `AgentResolution` accept `singleCallOutputCap` (criterion 10)

**Files:**
- Modify: `src/control/ccloopPort.ts:43-45`
- Modify: `src/control/agentSelection.ts:34-37`
- Test: `tests/control/singleCallOutputCap.test.ts` (new; Task 8 adds to it)

**Interfaces:**
- Consumes: nothing from ccloop code (Orca reads the wire only).
- Produces: `AgentResolution.singleCallOutputCap?: number | null`; `FrozenSlot` omits it; `ccloopResolutionSchema` accepts it (optional, nullable, positive safe integer); `ccloopPort.resolveAgent` passes it through.

- [ ] **Step 1: Write the failing test** — `tests/control/singleCallOutputCap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { frozenSlotOf, type AgentResolution } from "../../src/control/agentSelection.js";
import { ccloopResolutionSchema } from "../../src/control/ccloopPort.js";

// OMP single call (spec 2026-10-14-omp-single-call-design.md §4, criterion 10): ccloop now states the cap an agent's single
// call runs under. Orca must accept it (or the strict schema refuses every omp resolution once ccloop is repinned), refuse
// a value that could not be a cap, keep refusing keys it does not know, and never freeze it into a slot.
const answer = (extra: Record<string, unknown> = {}) => ({
  protocol: 3, selection: { agent: "omp", model: "gateway/model-a", contextWindow: "agent-default" }, configHash: "d".repeat(64), timeoutMs: 120_000, killGraceMs: 5_000,
  capabilities: { usageObservation: "phase-end", budgetEnforcement: "soft", contextObservation: "unavailable", handoffControl: "durable", handoffExecution: "mechanical-in-run-v1", contextWindowTokens: 200_000, requestBoundProof: null },
  singleCallExecution: "v1", ...extra,
});

describe("singleCallOutputCap on the resolution (criterion 10)", () => {
  it("C10: accepts a positive safe integer, null, or no field", () => {
    for (const extra of [{ singleCallOutputCap: 8_192 }, { singleCallOutputCap: Number.MAX_SAFE_INTEGER }, { singleCallOutputCap: null }, {}]) {
      expect([extra, ccloopResolutionSchema.safeParse(answer(extra)).success]).toEqual([extra, true]);
    }
  });

  it("C10: refuses 0, a negative, a fraction, a string and an unsafe integer, and still refuses an unknown key", () => {
    for (const value of [0, -1, 1.5, "8192", 2 ** 53]) {
      expect([value, ccloopResolutionSchema.safeParse(answer({ singleCallOutputCap: value })).success]).toEqual([value, false]);
    }
    expect(ccloopResolutionSchema.safeParse(answer({ singleCallOutputCap: 8_192, outputCap: 8_192 })).success).toBe(false);
  });

  it("is never frozen into a slot", () => {
    const { protocol: _protocol, ...parsed } = ccloopResolutionSchema.parse(answer({ singleCallOutputCap: 8_192 }));
    const slot = frozenSlotOf(parsed as AgentResolution, { agent: "omp" }, { agent: "operator", model: "descriptor", contextWindow: "descriptor" });
    expect(Object.keys(slot).sort()).toEqual(["capabilities", "configHash", "killGraceMs", "partial", "provenance", "selection", "timeoutMs"]);
  });
});
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts > /private/tmp/osc/logs/t7-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t7-red.log
```
Read it whole (its `RUN` line names the Orca worktree). Expected red: "C10: accepts…" (`8192` and `MAX_SAFE_INTEGER` and `null` refused as an unknown key; `{}` passes) and "is never frozen" (`parse` throws). "C10: refuses…" may be green already (strict refuses any unknown key) — its red is mutation `M10`'s complement and is not claimed here.

- [ ] **Step 3: Implement**

`src/control/ccloopPort.ts` — replace lines 43-45 with:

```ts
// Single-call estimate spec §4.4: a selection's resolution also answers singleCallExecution, beside the view, never in it.
// Accounts D8: `usageBreakdown` is accepted beside it when ccloop states it; Orca consumes no behavior from it.
// OMP single call (spec 2026-10-14 §4): `singleCallOutputCap`, when ccloop states it, is the cap the agent's call runs
// under; optional (an older ccloop omits it), nullable, never frozen (frozenSlotOf copies field by field).
const agentResolutionSchema=z.object({protocol:z.literal(3),selection:agentSelectionSchema,configHash:z.string().regex(/^[a-f0-9]{64}$/),timeoutMs:safeInteger.positive().max(2_147_483_647),killGraceMs:safeInteger.max(60_000),capabilities:capabilityViewSchema,singleCallExecution:z.enum(["v1"]).nullable(),singleCallOutputCap:safeInteger.positive().nullable().optional(),usageBreakdown:z.enum(["per-model","unavailable"]).optional()}).strict();
```

`src/control/agentSelection.ts` — replace lines 34-37 with:

```ts
/** Single-call estimate spec §4.4: `singleCallExecution` sits beside the seven-key view, like timeoutMs/killGraceMs. */
// OMP single call (spec 2026-10-14 §4): so does `singleCallOutputCap` when ccloop states it; null or absent = the call honours the request's cap.
export interface AgentResolution { selection: AgentSelection; configHash: string; timeoutMs: number; killGraceMs: number; capabilities: CapabilityViewV1; singleCallExecution: "v1" | null; singleCallOutputCap?: number | null }
/** What confirmation and import freeze; `singleCallExecution` is never frozen (spec §4.4: no persisted schema changes). */
// OMP single call (spec 2026-10-14 §4): nor is `singleCallOutputCap`.
export interface FrozenSlot extends Omit<AgentResolution, "singleCallExecution" | "singleCallOutputCap"> { partial: PartialSelection; provenance: Record<Field, ProvenanceSource> }
```

- [ ] **Step 4: Run green, with the port's and freezing criteria**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts tests/control/ccloopPort.test.ts tests/control/usageLedger.test.ts tests/control/profiles.test.ts tests/control/planImport.test.ts tests/control/agentPlanImport.test.ts > /private/tmp/osc/logs/t7-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t7-green.log
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t7-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t7-tc.log
```
Read both whole. Expected: all pass, 0 skipped; typecheck `rc=0`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add src/control/ccloopPort.ts src/control/agentSelection.ts tests/control/singleCallOutputCap.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t7-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
feat(control): accept ccloop's single-call output cap beside the resolution

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

