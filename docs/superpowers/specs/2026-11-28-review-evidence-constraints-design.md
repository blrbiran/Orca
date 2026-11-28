# Review evidence for constrained criteria

## Intent

Address tester issue #544: requirement review can cite a file path as evidence for `met` even when that path does not show the constraint named by the acceptance criterion. Improve the reviewer's evidence reasoning without adding deterministic source analysis or a new class of rules that blocks work across agents with different capabilities.

## Goals

- Ask the reviewer to identify the subject and relation named by a constraint before deciding it is met (for example, which module must not import which other module).
- Require evidence that bears on that relation. A path's existence, hash, or unrelated diff is not by itself evidence that a dependency constraint holds.
- If the supplied diff, file list, and recorded facts do not let the reviewer assess the relation, let it report `cannot-judge` with the missing evidence named instead of guessing.
- Keep the review model's judgment flexible; do not add a code-level import parser, new verdict, schema field, or automatic fail-closed rule for unrecognized prose.

## Non-goals

- Prove arbitrary natural-language requirements mechanically.
- Require every constraint to be expressible in a fixed vocabulary.
- Treat a model's evidence citation as independently verified fact.
- Change review funding, retry, or acceptance state transitions.

## Approach

Update the requirement-review instructions only. For a constraint, the reviewer should connect the exact subject and relation in the criterion to evidence in the delivered diff or other material supplied in the review. For dependency examples, use the criterion, original requirement and agreed statement together to determine whether the intended relation is a direct import or the transitive dependency graph; do not silently substitute one relation for the other. If those sources still permit materially different readings that would change the verdict, use the existing `cannot-judge` outcome and name the clarification needed; otherwise use judgment for the supplied evidence. A citation must point to the evidence actually supporting the judgment, not merely to a named or existing path.

The reviewer continues to decide using the existing `met`, `not-met`, and `cannot-judge` outcomes. The controller keeps its existing schema and classification rules. No new deterministic restriction is introduced, so criteria outside the evidence available to the reviewer remain a judgment call rather than being rejected by a new parser.

## Acceptance criteria

1. The review prompt tells the reviewer not to treat path existence or unrelated file evidence as proof of a content or dependency constraint.
2. For a criterion such as “module A must not directly import B,” the prompt tells the reviewer to cite evidence about A's dependency relation to B; evidence about another file alone is insufficient.
3. For dependency wording that does not specify direct versus transitive behavior, the prompt directs the reviewer to use the criterion, original requirement and agreed statement together. If materially different readings remain and would change the verdict, the reviewer uses `cannot-judge` and names the needed clarification.
4. When the review material does not show the relevant relation, the prompt directs the reviewer to use `cannot-judge` and name what evidence is missing, rather than claim `met` from a path-only citation.
5. Existing verdict schema and controller classification remain unchanged; no static dependency analyzer or new hard rejection is added.
6. A regression criterion demonstrates the prompt change against the reported A/B mismatch shape, while preserving ordinary reviews for criteria that are supported by the supplied evidence.

## Trade-off

This is a prompt-level improvement, not a proof system. It should reduce unsupported `met` judgments while preserving flexibility across models and agents. A reviewer can still make a mistaken judgment; the change must not be described as mechanically guaranteeing semantic verification.
