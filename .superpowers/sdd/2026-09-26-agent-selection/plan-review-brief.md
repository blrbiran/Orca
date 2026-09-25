# Plan review brief — agent selection (Orca controller session 75ec878e, 2026-09-26)

You are an independent reviewer of an IMPLEMENTATION PLAN written by six writers in parallel and assembled by the controller. Report in Chinese prose (identifiers English).

## Inputs
- Plan: `/Users/biran/code/skills/loop/Orca/docs/superpowers/plans/2026-09-26-agent-selection.md` (≈17.6k lines; header + Global Constraints + shared interfaces + **§0 execution order and controller rulings R1–R8, which override the part bodies** + six parts W1..W6 marked `<!-- ===== plan part Wn ===== -->`).
- Spec: `/Users/biran/code/skills/loop/Orca/docs/superpowers/specs/2026-09-26-agent-selection-design.md` (§12 wins over body).
- Ledger with every ruling and its reason: `/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-26-agent-selection/progress.md`.
- Real code: `/Users/biran/code/skills/loop/ccloop`, `/Users/biran/code/skills/loop/Orca`.

## Focus (in priority order) — the seams, not re-deriving each part
1. **Cross-task interface seams**: a name, signature, file path, schema field, error code, CLI flag, env var or file format produced by one task and consumed by another, where the two parts disagree (e.g. what T1 exports vs what T3/T5/T6 import; what T7 produces vs what T10/T11/T14/T16 consume; ccloopWorld shape T7 vs T16; fake-claude-cli argv protocol T3 vs runner vs T16; selectionsHash computation T11 vs T14 preview; capability v3 answer ccloop T5 vs Orca T7 parser). Cite both plan line numbers.
2. **Execution-order holes**: with order ccloop T1→T2→T4→T3→T6→T5, Orca T8→T7→T9→T10→T11→T12→T13→T14→T15→T16→T17, is there a commit after which the tree does not typecheck or a task's own "run to pass" step cannot pass because it depends on something landing later? Is every transitional state (T7 bridges, probe(profile, selection?), fail-closed confirm button, T5→T7 red window) explicitly created AND explicitly removed with a check?
3. **Rulings not applied**: places in part bodies that contradict §0 R1–R8 (notably R7: W5 wrote option A for estimator at import — list every step the implementer must skip or change; R5 W6-8 payload shape; R4 schema move). Precise line ranges.
4. **Hollow criteria**: a new criterion that could not go red (asserts a value the test itself wrote before the call; mutation named but targets a different branch; a "never happens" assertion without a positive observation).
5. **Existing-criteria handling**: every rewrite must be a whole rewrite that does not loosen; flag any rewrite that loosens (weaker assertion, removed assertion) — the human authorised changing tests, not loosening them.
6. **Spec coverage gaps**: a spec requirement (§4–§9, §12) with no task step.
7. Safety/process: any step that would touch the main working tree for experiments, write to real user dirs (Rule 17), push/merge, or run full suites concurrently.

## Prohibitions
Read-only. No edits in either repo except your report. No git state changes. No full-suite runs (targeted single-file runs in a `git clone --local` copy under `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/75ec878e-a6d3-4299-9a4b-b76dd574b77a/scratchpad/plan-review/` only if really needed). Redirect verification output to files. No human-authorisation claims, no cost estimates. Every line number you cite must be measured now.

## Output
Write `/Users/biran/code/skills/loop/Orca/.superpowers/sdd/2026-09-26-agent-selection/plan-review.md`: Critical / Important / Minor, each with plan location(s), evidence, concrete fix. Return a ≤200-word summary.
