# Task 3 review (847a7a6..60a0eb0)

### Spec Compliance
- Spec compliant, with one deviation to judge (C2 error surface, Minor-1 below).
- Cannot verify from diff: the Web import path through webProtocol.ts/planFile.ts was not changed; the new Web-door test (loopPlanSkills.test.ts:270) exercises it. Mutation table in the report is the implementer's claim; not re-run.

### Strengths
- Conditional spread (loopPlans.ts:127) and no-default `.optional()` on both schemas keep no-skills bytes; golden captured at 847a7a6 pins recipe bytes, plan-entry bytes, planHash, contract hash (test :199-207).
- skills sits on recipe beside inputs, not in loopInputsSchema; contract builder untouched, test :219 proves contract bytes equal with/without skills.
- normalizeLoopSkills re-runs the schema, so a runtime value (Task 5) gets "skills-shape" rather than a throw; normalization inside expandLoopPlan means every door gets it.
- Mutation list covers every new branch; the recipe-schema mutation that first survived led to an added test. No existing test modified.

### Issues
#### Critical
None.
#### Important
None.
#### Minor
1. C2 error surface (planFile.ts:366-371, loopPlans.ts:47-50): both keys, `names: []`, bad profile and unknown key are rejected by loopPlanFileSchema, so a person importing such a plan sees `malformed` with message `tasks.N.loop.skills: Invalid input` (zod union error, no mention of skills-shape or why), not `loop-plan-invalid:<task>:skills-shape`. It is fail-closed and tested, so I judge C2's intent (refuse, never archive) met; the literal "refused skills-shape" is met only for name-rule violations. Name-rule failures and shape failures therefore give two different codes for the same field. Fix if wanted: make loopPlanFileSchema.skills a permissive z.unknown()-ish shape (or a custom union message) and let expandLoopPlan produce skills-shape; or document the split in the spec.
2. loopRecipeSchema (loopPlans.ts:89) does not apply the name rule, so an archived/amendment recipe with `names: ["a,b"]` parses; only expansion validates. Fine while every write goes through expandLoopPlan; Task 5/consumers re-reading a recipe should treat names as untrusted or re-normalize.
3. "contract has no skills" test passes trivially at HEAD (implementer admits); it is a guard only. `not.toContain("skills")` could false-fail if a future plan text mentions "skills"; compare against the no-skills expansion only (already done).

### Assessment
**Task quality:** Approved
**Reasoning:** Byte-stability, normalization and refusal paths are correct and each branch has a seen-red mutation; the only gap is that shape errors surface as an opaque zod `malformed` rather than `skills-shape`.
