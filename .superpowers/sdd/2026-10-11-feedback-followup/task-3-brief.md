### Task 3: ccloop optional token policy and negotiated protocol4

**Files:** ccloop `src/contract/schema.ts`, `src/state/types.ts`, `src/control/{protocol,command,accept,worker}.ts`, `src/controller/{runLoop,resumeLoop}.ts`; create `src/budget/tokenPolicy.ts`; tests controller/control/contract plus new `tests/controller/optionalTokens.test.ts` and `tests/control/protocol4.test.ts`.
**Interfaces:** Produces exported `BudgetAmount` (nullable tokens), finite usage Amount, `remainingBudget(limit:BudgetAmount,used:Amount):BudgetAmount`, `budgetFits(used:Amount,limit:BudgetAmount):boolean`; independent control `features` response optional feature keys. Protocol4 normal starts/nullable contract and grant; protocol3 finite remains exact.
- [ ] Step1: RED controller consumes >3M tokens under null token ceiling without exhausted; finite active/attempt/session caps still exhaust, null usage/Infinity/extra schema rejected. Old v3 input/hash/snapshot tests unchanged; v4 null negotiated.
- [ ] Step2: Implement centralized nullable-ceiling arithmetic and all direct cumulative token checks/state snapshots/control routing; preserve finite observations and legacy contracts/hash verification. Advertise only tokenPolicy at this stage, not unimplemented features.
- [ ] Step3: RED/implement resumable allowance depletion classification distinct from authored token exhaustion and carry inherited non-token consumption without new run replay increment; no synthetic snapshot. Expose typed waiting cause to consumer.
- [ ] Step4: Full ccloop build/type/tests/native control criteria, clone mutations for null check/finite dimension/usage rejection/v3 boundary. Commit `feat(budget): support optional token ceilings in ccloop`; report actual skips/failures.

