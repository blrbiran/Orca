# Task A1 review (65e64a3..2ce72e2), reviewer: task-reviewer subagent, 2026-09-30

### Spec Compliance

- ✅ Spec compliant. Both listed files exist with every listed export. The verbatim values match the brief and global.md: plan ids, constraints, rejectOn, executionPolicy, the label priority table, the recipe shape, and the refusal reasons. The R-F5 English names and discipline lines match the table (`Safe refactor` for refactor). R-F15 and P2 are implemented at `src/control/loopPlans.ts:185-188`, in the order path-shape, investigate-target, investigate-max-files, design-target. P2's fixture rule is followed (`givenFor`, test:338). P7 is respected: no self-equality assertion was added.
- ⚠️ Cannot verify from the diff: the fixed-point claim against `taskContractSchema`, and `TASK_WORK` equality. Both are pinned by tests in this diff. I did not re-run them and relied on the implementer's green evidence (`green3.txt`, 85/85).

### Strengths

- Pure, dependency-light module, with the import-cycle rationale recorded in the header.
- Criterion 1 pins the expansion bytes, the recipe, and the hash. Criterion 2 is a per-plan table that covers every contract field.
- The mutation work goes beyond the plan. It has 30 named mutations, each with an apply log, red evidence and a byte-exact restore. The implementer also noticed that the `plan === null` and `isLoopPlanId` branches were unreachable by the original criteria and added a criterion (test:367-372) that kills them.
- The R-F15 criterion checks the accepted cases (1 and absent) and the check order, so it does not only test the refusal. MA1-9 shows it red alone.
- The evidence discipline is clean: redirected files, restore checks, a kept clone.

### Issues

#### Critical (Must Fix)
None.

#### Important (Should Fix)
None.

#### Minor (Nice to Have)

1. `src/control/loopPlans.ts:157`. `entry.startsWith("/") ||` is dead code. An absolute path splits to a leading `""` segment, which line 158 already refuses. This is MX-4, verified as equivalent. The brief mandates this text, so it is not the implementer's fault. Two choices: delete it, which also means editing the wording of MA1-5, or keep it as documentation of intent. I would delete it under Rule 2 and Rule 9, since a branch that cannot be seen red is unenforced. It does no harm today.
2. `src/control/loopPlans.ts:151` (MX-20b, MX-20c). `currentLoopPlanVersion`'s "newest" logic cannot be exercised while the registry holds one version per plan, and `REGISTRY` is module-private, so no test can add a second version. I accept the implementer's judgment that these are equivalent mutants today. The controller should register a follow-up: the first task that adds a v2 must add a "current version is the highest" criterion. Until then the highest-version rule is untested. It is also the rule that keeps archived recipes rendering (spec §2.2).
3. R-F15's condition (`loopPlans.ts:186`) has two sub-clauses, `!== null` and `!== 1`. MA1-9 deletes only the whole statement. The current test kills both sub-clause deletions anyway: the `{maxFilesTouched: 1}` case kills dropping `!== 1`, and the `{}` case kills dropping `!== null`. That is fine. The report could have said so.

### The implementer's three concerns, judged on the merits

- **Equivalent mutants MX-4, MX-20b, MX-20c.** The claim is valid for MX-4 and MX-20b/c. I checked the reasoning. I also read `MX-20b-tsc.txt`, which shows a clean typecheck, and `MX-20b.txt`, which shows 85/85. The report surfaces them openly, which is what Rule 12 asks for. It is Minor, not a defect. The follow-up for the v2 criterion is the useful action (Minor 2).
- **MX-2 is red only under typecheck.** This is legitimate. The guard at `loopPlans.ts:210` exists to narrow `string` to `LoopPlanId` and `number | null` to `number`, and the compiler is the enforcer. The `MX-2-tsc.txt` result was red (rc=2), which is a seen-red. Rule 9 asks that a criterion be seen red. `npm run typecheck` is one of the task's success commands (brief Step 4). No finding.
- **The env var refused by the harness.** The implementer was right not to work around it. `ECC_GATEGUARD=off DISABLE_OMC=1` turns off guard hooks. The harness rejecting it as a safety bypass is correct behavior, and the runs are unaffected because vitest ran without it. This is a controller problem, not a defect in the task. The controller should amend the global.md Scratch line, or have the human decide, before B-tasks hit the same denial. Not counted as a finding against A1.

### Assessment

**Task quality:** Approved

**Reasoning:** The implementation matches the brief and the rulings exactly. Every new branch except the three equivalent ones is seen red, and the survivors are honestly disclosed. The remaining items are minor cleanups and a follow-up registration.
