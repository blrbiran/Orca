# Task A3 review (d40eed2..b97e88a)

### Spec Compliance
- ✅ Spec compliant. Every brief file has its hunk (planFile.ts, graph.ts, run.ts, service.ts lines 50 and 60, both new tests). Interfaces match the brief verbatim. The departures are ruled: P2 added the investigate-max-files import criterion, and P3 added the runProfiled criterion and the extra mutations. run.ts:201 is untouched, per P10.
- Checked by grep that every `loadPlan` and `loadRound` consumer is covered: cli.ts:228, run.ts:622, service.ts:49 and :59 all go through the refusing `loadRound`. planFile.ts:288 (`readSchedulerControlPlanSource`) is the expanding one.

### Strengths
- The exactly-one refinement is at the input door. The loop-form hunks in the diff (`planFile.ts` from about line 175 on, `run.ts` from about line 370 on) are minimal and match the brief.
- Contract path checks are gated on `task.contract !== undefined`.
- The CLI refusal runs before any contract read, so a loop task is never silently dropped.
- Mutations were run for every new branch, including the P3 extras. The un-killable one (MA3-11) is disclosed honestly rather than hidden.
- Tests encode why the behaviour matters (import uses the file's labels; the CLI refuses by name).

### Issues
#### Critical
None.
#### Important
None.
#### Minor
- run.ts:377 (diff line): the `.filter(!isLoopPlanTask)` after the refusal never removes anything at runtime. MA3-11 shows no criterion can go red on it, and a cast would behave identically. Under Rule 9 it is a branch with no seen-red mutation. Either keep it as type-narrowing defence and say so in a comment, or replace it with a cast plus a comment. The implementer flagged it, and I judge it Minor.
- loopPlanCli.test.ts:412-413: `expect(result).toBe(1)` for `orca run` is also satisfied without the refusal, because a missing adapter-config exits 1. The `stderr` assertion carries the discrimination and does go red (MA3-5). Fine, but the first assertion is weak.
- planFileLoop.test.ts:482-483: the "contract task beside it is still checked" half has no mutation of its own. It is covered by the pre-existing planFile.test.ts.
- planFile.ts (`loadedTask`): `loop!` non-null assertion; safe given the superRefine. MA3-10 is red only under typecheck, because Zod adds no keys, so `loadedTask` is a type-level projection. Acceptable.

### Assessment
**Task quality:** Approved

**Reasoning:** The implementation matches the brief and rulings, covers all consumers, and has a seen-red mutation for every behavioural branch. The one exception is a documented, harmless type-narrowing filter.
