# Split instruction version 9: the delivery graph the requirement states is the split's shape (tester #385)

- **Author:** controller session, 2026-11-23 (human said 「同意」 to preparing the v9 spec and the criterion frame;
  a paid evaluation is deferred to the human — see §5).
- **Status (2026-11-23):** implemented and committed; §6's criteria are green and each clause's mutation turns exactly
  its own criterion red. The paid evaluation (§5) is **not** run — it awaits the human.
- **Inputs:** tester ledger `orca_archived_files/issue-20261023.md` #385 (three live shapes: the 8-task delivery graph
  merged into 5, the lock2 re-split, the links group losing its final verification and gaining an unasked artifact task);
  the existing hints `src/control/splitImpliedPaths.ts` (`requirementUnitProblems`) and `src/control/requirementDelivery.ts`
  (`deliveryProblems`); the split instruction versions in `src/control/requirementSplit.ts` (V5–V8, multi V5–V6).
- This note adds a version; it does not change V5–V8 bytes. Calls already started keep the version frozen in their
  dispatch envelope (the same rule every earlier bump followed), so v9 reaches new calls only.

## 1. What goes wrong today, stated as code

The splitter is asked for `tasks[]` with `targetPaths`, `dependsOn`, `checks`, `traces`. Nothing in the answer states the
**delivery graph** the requirement named — which units exist, which are independent, which is the final verification.
The validator (`validateSplitDraft`) checks paths, write sets, implicit edges and traces; it cannot tell a merged pair
from a requirement that only ever named one task, and code may not read prose to decide (Rule 5).

So two classes of deviation survive every draft until a person reads it:

1. **A stated unit is merged or loses a dependency.** "T2 is independent; T2 depends on T1" → one task, `dependsOn:[]`.
   The existing `requirementUnitProblems` hint catches a *missing* unit id or a *path* it named, but a merged `T2a/T2b`
   pair under a single id still passes; and a dependency the prose stated ("independent T2 matcher and actions" implies
   no edge, but "T4 renders T3's engine output" implies one) is not compared.
2. **The acceptance's own delivery steps are dropped.** A requirement that names a final full-suite verification, or an
   overall-verification task, delivers a split whose every task carries a narrower check; acceptance then proves the
   task checks and never the suite. `deliveryProblems` hints this for a *command* the document names, but not for the
   *final-verification unit* shape, and the reverse — an unasked artifact task the split invented — has no hint at all.

Both hints are warn-only and single-repository by design (they say so); v9 changes what the splitter is **asked for**,
so the deviation is less likely to be produced, and keeps the hints as the backstop.

## 2. The v9 change: the answer carries the graph it was given

Version 9 adds one optional answer key, `deliveryGraph`, and one instruction rule that makes it the split's shape:

```
deliveryGraph: {
  units: [ { unit: "T1", taskIds: ["T1"], dependsOn: ["T2"] }, … ],   // one entry per unit the requirement names
  independent: [ ["T2a","T2b"], … ],                                    // pairs/groups the requirement calls independent
  finalVerification: "T6" | null                                        // the unit that runs the overall verification, if any
}
```

The instruction (new `DELIVERY_GRAPH_RULE`, inserted after `PARALLEL_RULE`) states, in the model's voice:

- When the requirement's goal or a success condition names delivery units (a labelled list such as `T1..T6`, a sentence
  "independent T2 and T4", a final "文档与整体验证" step), the split reports each unit in `deliveryGraph.units` with the
  task ids that carry it and the units it must follow, and every unit's `dependsOn` is a subset of what the graph says.
- A unit the requirement calls independent is carried by tasks with no edge between them.
- When the requirement names an overall/full-suite verification, `finalVerification` names the task that runs it
  (its `checks` include that command), and no other task claims it.
- When the requirement names no units, omit `deliveryGraph`; the answer's bytes are then v8's (this is the one path
  that keeps a no-unit requirement's prompt unchanged apart from the head line).

Like `historyExpectation` (v6) and `requirementConflicts` (v7), the key is optional and **provenance only unless the
validator can use it** — see §3 for what code can check from it without reading prose.

## 3. What the validator can enforce (and what it cannot)

Code can compare `deliveryGraph` against the draft it accompanies; code cannot compare it against prose it did not parse.
So the v9 validator checks a draft **against its own claimed graph**, which makes the model commit and makes a deviation
visible to a person:

- Every `unit` name is the requirement's own id shape (`T<n>`, or `T<n><letter>` for a split unit); a unit's `taskIds`
  are draft task ids; a task in more than one unit or no unit is named by `delivery-graph-unit-ambiguous:<task>` /
  `-unassigned:<task>`.
- A task's `dependsOn` may not leave its unit's stated `dependsOn` (a dependency on a unit the graph does not order it
  after is `delivery-graph-edge:<task>:<dep>`); two tasks the graph marks independent may not have an edge
  (`delivery-graph-independent:<a>:<b>`).
- `finalVerification`, when present, names a task whose `checks` include the full-suite command the document names (the
  same `FULL_SUITE` regex `requirementDelivery.ts` already uses); a final-verification task with no such check, or such a
  check on a task not named `finalVerification`, is `delivery-graph-final-verification:<task>`.

These are **hand-backs** the existing revision mode already carries (the model sees the reason and revises), not
refusals of the requirement. A requirement that names no units skips all of this.

What stays a hint, not a check: whether a committed graph actually matches the prose. That is the paid evaluation's
question (§5), and until then the two existing hints stay warn-only beside it.

## 4. Version plumbing

- `SPLIT_PROMPT_HEAD_V9 = "Orca requirement split, instruction version 9."`; `SPLIT_INSTRUCTION_V9 = SPLIT_INSTRUCTION_V8`
  with the head replaced, `DELIVERY_GRAPH_RULE` after `PARALLEL_RULE`, and the template line carrying the optional key
  (the same `.replace` chain V6→V7→V8 use, so V5–V8 bytes are untouched).
- `buildSplitPrompt` accepts `instructionVersion: 9` and selects V9; the schema `SPLIT_JSON_SCHEMA_V9` adds the optional
  `deliveryGraph` object (strict) beside `requirementConflicts`; `validateSplitDraft` runs §3's checks when the key is
  present. The split handler (`requirementCalls.ts`) sends V9 for new single-repository calls; multi stays at its own
  version (the multi instruction is per-directory and has no single `deliveryGraph`; a multi v7 is a separate change).
- A draft accepted under v8 keeps its stored shape; the view (`controlViews.ts` `requirementDelivery` /
  `requirementUnits`) is unchanged and still hints.

## 5. The paid evaluation (deferred to the human)

Whether v9 makes drafts correct is a real-model question and costs a paid requirement call (clarify + split, roughly the
`ESTIMATE_GRANT`/call the ledger already records). The frame to run when the human approves:

- Requirement: the `policy-dogfood-20261119-1` goal verbatim (8 units, "independent T2 and T4"); and the
  `links-dogfood-20261120-1` goal (final verification + no unasked artifact task).
- Measure, on each: draft 1 task count and `layers` against the goal's units (`deliveryGraph` present, units match);
  whether `finalVerification` is named and runs `npm test`; whether `plan-dag-artifact` (unasked) is absent.
- Pass: both drafts' `deliveryGraph.units` name every goal unit with no merge and no lost edge, and the links goal's
  final verification is a real task — without human feedback. Cost and count recorded in the round ledger.

Until this runs, #385 stays **partially resolved**: the hints are the backstop, v9 is the intended fix, and neither is
paid-verified.

## 6. Criteria (as implemented — `tests/control/splitDeliveryGraph.test.ts`, 7)

The implementation task writes these first, each seen red before it is green:

1. `buildSplitPrompt({ instructionVersion: 9, … })` head is version 9 and contains `DELIVERY_GRAPH_RULE`; the V8 prompt
   bytes for the same input are unchanged (a frozen V8 golden).
2. `validateSplitDraft` hands back `delivery-graph-unassigned:<task>` for a draft whose `deliveryGraph` omits a task, and
   the same draft with no `deliveryGraph` key passes (bytes equal to a v8 draft).
3. `delivery-graph-edge:<task>:<dep>` for a task depending outside its unit's stated `dependsOn`; the positive shape (a
   dependency the graph orders) passes.
4. `delivery-graph-final-verification:<task>` for a `finalVerification` task whose checks lack the named suite, and the
   positive shape (the task's check is `npm test`) passes.
5. A mutation that drops each check (unassigned, edge, independent, final-verification) turns exactly its own criterion
   red, with the other drafts still green.
## Correction (tester #501, 2026-11-26)

§3's checks kept a draft to the graph it claimed, but nothing made the claim agree with the requirement's own wave
order. `independent` listed the requirement's waves and only forbade edges **inside** one; a Layer 3 unit that named
only a Layer 1 dependency was valid, so `sprint-audit` ran beside Layer 2 (and review AC12 failed after the group
finished). `deliveryGraphProblems` now also requires every unit in wave *k* (k ≥ 1) to reach at least one unit of
wave *k-1* through the graph's `dependsOn`; otherwise `delivery-graph-layer:<task>:<unit>`.

This closes the layer-placement half only. The other shape in #501 — the draft's `dependsOn` omitting a unit the
requirement named with "AFTER both" while the `independent` grouping is correct — is **not** covered: deciding which
prose names are dependencies is not a structural check. It needs a design (structured expectation on the requirement,
or a contract field), and #501 stays partially resolved until then. Criterion:
`tests/control/splitDeliveryGraph.test.ts` ("requires a wave-k unit to reach wave k-1").
