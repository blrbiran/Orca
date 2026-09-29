# Task A4 review (b97e88a..1fc5271)

### Spec Compliance
- ✅ Spec compliant. Every listed file has its hunk: webProtocol.ts (import + `loop: loopRecipeSchema.optional()` after `labels`, no default), planImport.ts (`...(task.loop ? { loop: task.loop } : {})` after the labels spread), fixtures/web.ts (additive `loop?` field and first-branch loop task), and the new loopPlanImport.test.ts with the 3 criteria. P7 is applied (the self-equality assertion is dropped, with a comment). P3 is applied (MA4-3 schema deletion and MA4-4 fixture-branch deletion added, both reported red with evidence files). The commit trailer matches P8 (checked in the report only; the message was not re-read).
- ⚠️ Not verifiable from the diff: the reported RED/GREEN/mutation results (a4/*.txt evidence files). I did not re-run them. `planFile.ts` (A3) supplying `task.loop` to the normalizer is unchanged code; the report cites planFile.ts:315.

### Strengths
- The change is minimal and mirrors the existing `labels` pattern exactly: optional, never defaulted, conditionally spread. This keeps hand-written archives and planHash byte-identical.
- The recipe is re-validated by the strict `controlPlanSchema` parse after normalization.
- Test 1 ties the archived recipe to the stored contract through `expandRecipe`, so it checks the real invariant (the stored contract is the recipe's expansion).
- MA4-2 covers the "written for every task" branch, and the guard test's red comes from the strict schema.

### Issues
#### Critical
None.
#### Important
None.
#### Minor
- tests/control/loopPlanImport.test.ts:176-183. After P7 the planHash test only asserts `hash(planWithoutLoop) !== planHash`. It goes red if the recipe is dropped (MA4-1/3/4). It stays green if planHash were computed over something unrelated to the plan. The dropped `sha256Canonical(archived.plan) === archived.planHash` was in fact a real check (the stored hash against a recomputation), not a pure self-read. The controller ruling P7 mandated the drop, so this is not the implementer's defect. Consider keeping it as a non-vacuous assertion if the human agrees.
- tests/control/fixtures/web.ts:100-102. The interface line is reflowed (1-line deletion). It is harmless and additive in effect.
- Test 1 does not pin `chosenBy: "labels"` against an explicit-plan variant. That is A3's territory, not A4's.

### Assessment
**Task quality:** Approved

**Reasoning:** A minimal, convention-matching change. Every new branch has a deletion mutation reported red (MA4-1 to MA4-4). The only weakness is the P7-mandated thinner planHash assertion.
