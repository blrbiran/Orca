### Task 8 (Orca): The estimate is sized and sent with the bound (criteria 8, 9)

**Files:**
- Modify: `src/control/estimator.ts:1-13` (import), `:74-115` (`buildBudgetEstimateRequest`), new export `singleCallOutputBound`
- Test: `tests/control/singleCallOutputCap.test.ts` (add)

**Interfaces:**
- Consumes: Task 7's `AgentResolution.singleCallOutputCap`.
- Produces: `export function singleCallOutputBound(preflightMaxOutputTokens: number, resolution: Pick<AgentResolution, "singleCallOutputCap"> | null): number` in `src/control/estimator.ts`. The contract's `maxOutputTokens` (and so the envelope's, `src/control/singleCallPurposes.ts:49`) is the bound; `requiredRequestTokens = inputTokens + bound`.

- [ ] **Step 1: Write the failing test** — append to `tests/control/singleCallOutputCap.test.ts` (add imports `buildBudgetEstimateRequest, ESTIMATE_GRANT, persistEstimateArtifacts, readEstimateContract, singleCallOutputBound` from `../../src/control/estimator.js`, `readArchivedPlan` from `../../src/control/queries.js`, `webFixture` from `./fixtures/web.js`):

```ts
// Criteria 8 and 9 (spec §4): omp cannot take the request's cap, so Orca sizes and sends the larger of the preflight's cap
// and the agent's own -- otherwise the estimate would book less than the call can spend, and ccloop's spawn check
// (row.maxTokens <= maxOutputTokens) would refuse every omp estimate whose catalog cap is above the preflight's.
type Fixture = Awaited<ReturnType<typeof webFixture>>;
async function build(h: Fixture, cap: number | null | undefined) {
  const plan = readArchivedPlan(h.store, "g");
  const observation = await h.deps.profileRouter.probe(h.frozen, { agent: "codex" });
  const withCap = cap === undefined ? observation : { ...observation, resolution: { ...observation.resolution!, singleCallOutputCap: cap } };
  return buildBudgetEstimateRequest({ planHash: plan.planHash, planCanonicalJson: plan.canonicalJson, profile: h.frozen, observation: withCap, mode: "strict" });
}

describe("the estimate's output bound (criteria 8 and 9)", () => {
  it("C8: a cap above the preflight value is the contract's maxOutputTokens, read back for the envelope, and sizes the request", async () => {
    const h = await webFixture(); try {
      const raised = await build(h, 100_000);
      expect(raised.state).toBe("queued");
      expect(raised.contract!.maxOutputTokens).toBe(100_000);
      expect(raised.requiredRequestTokens).toBe(raised.inputTokens! + 100_000);
      // The single-call envelope takes contract.maxOutputTokens (singleCallPurposes.ts ESTIMATE.prepare) from the persisted contract.
      persistEstimateArtifacts(h.store, "g", "estimate-cap", raised);
      expect(readEstimateContract(h.store, "g", "estimate-cap").maxOutputTokens).toBe(100_000);
    } finally { await h.dispose(); }
  });

  it("C8: no cap, a null cap or a smaller cap leaves today's numbers", async () => {
    const h = await webFixture(); try {
      for (const cap of [undefined, null, 1_000]) {
        const today = await build(h, cap);
        expect([cap, today.state, today.contract!.maxOutputTokens, today.requiredRequestTokens! - today.inputTokens!]).toEqual([cap, "queued", 64_000, 64_000]);
      }
    } finally { await h.dispose(); }
  });

  it("C9: a cap of 250 001 with a small input is input-too-large, though the input alone fits", async () => {
    const h = await webFixture(); try {
      const result = await build(h, 250_001);
      expect(result.inputTokens!).toBeLessThan(ESTIMATE_GRANT.tokens);
      expect(result).toMatchObject({ state: "input-too-large", reasonCode: "estimate-input-too-large", requiredRequestTokens: result.inputTokens! + 250_001 });
    } finally { await h.dispose(); }
  });

  it("takes the larger of the preflight cap and the agent's cap", () => {
    expect([singleCallOutputBound(64_000, null), singleCallOutputBound(64_000, {}), singleCallOutputBound(64_000, { singleCallOutputCap: null }),
      singleCallOutputBound(64_000, { singleCallOutputCap: 16_384 }), singleCallOutputBound(64_000, { singleCallOutputCap: 524_288 })]).toEqual([64_000, 64_000, 64_000, 64_000, 524_288]);
  });
});
```

- [ ] **Step 2: Run red**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts > /private/tmp/osc/logs/t8-red.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t8-red.log
```
Read it whole. Expected red: "C8: a cap above…" (`64000` received), "C9" (`queued` received), "takes the larger…" (`singleCallOutputBound is not a function`). "C8: no cap…" is green today (it pins that nothing else moves).

- [ ] **Step 3: Implement** — `src/control/estimator.ts`: add after line 11 `import type { AgentResolution } from "./agentSelection.js";`; add before `export interface EstimateInput` (line 56):

```ts
/**
 * OMP single call (spec 2026-10-14 §4): the output bound a single call is sized and sent with -- the preflight's cap, or the
 * agent's own catalog cap when that is larger (omp cannot lower its cap per call; ccloop refuses at spawn if it rose).
 */
export function singleCallOutputBound(preflightMaxOutputTokens: number, resolution: Pick<AgentResolution, "singleCallOutputCap"> | null): number {
  return Math.max(preflightMaxOutputTokens, resolution?.singleCallOutputCap ?? 0);
}
```

and replace lines 107-111 with:

```ts
  const inputTokens = safeNumber(serialized + BigInt(preflight.framingTokenOverhead));
  const bound = singleCallOutputBound(preflight.maxOutputTokens, observation.resolution);
  const requiredRequestTokens = safeNumber(BigInt(inputTokens) + BigInt(bound));
  const contract = estimateExecutionContractSchema.parse({ schema: "orca-estimate-execution-contract-v1", requestHash, grant: ESTIMATE_GRANT,
    profile: request.estimatorProfile, estimatorCapabilities: request.estimatorCapabilities, instructionVersion: preflight.instructionVersion,
    responseSchemaVersion: preflight.schemaVersion, tokenizer: preflight.tokenizer, framingTokenOverhead: preflight.framingTokenOverhead, maxOutputTokens: bound });
```

(line 112, `const tooLarge = requiredRequestTokens > observed.contextWindowTokens || requiredRequestTokens > ESTIMATE_GRANT.tokens;`, is unchanged.)

- [ ] **Step 4: Run green, with every estimate criterion**

```bash
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && ./node_modules/.bin/vitest run tests/control/singleCallOutputCap.test.ts tests/control/estimator.test.ts tests/control/estimatePrompt.test.ts tests/control/estimateSingleCallGate.test.ts tests/control/estimatorCompatibility.test.ts tests/control/driverEstimate.test.ts tests/control/planImport.test.ts > /private/tmp/osc/logs/t8-green.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t8-green.log
cd /Users/biran/code/skills/orca/Orca-wt/omp-single-call && npm run typecheck > /private/tmp/osc/logs/t8-tc.log 2>&1; echo rc=$? >> /private/tmp/osc/logs/t8-tc.log
```
Read both whole. Expected: all pass, 0 skipped; typecheck `rc=0`.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call add src/control/estimator.ts tests/control/singleCallOutputCap.test.ts
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call diff --cached > /private/tmp/osc/logs/t8-diff.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/Orca-wt/omp-single-call commit -q -F - <<'EOF'
feat(control): size and send the estimate with the agent's own output cap when larger

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NCgRiQLh17ENJdrmuJDcKL
EOF
```

---

