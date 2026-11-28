# Accepted requirement conflicts remain visible

## Intent

Address tester issue #557 and the review-context part of #542. A person can accept a split that explicitly reports a requirement conflict, after which the group brief and final review lose the fact that the person accepted the conflict. Free-text clarification answers also need to reach final review as explicit human decisions.

## Goals

- Persist the exact conflicts carried by an accepted draft, with the accepted draft number and accepting actor/time.
- Mark affected criteria as provisional in the frozen requirement document and list the accepted conflict details.
- Show accepted conflicts in group brief and group show; pass the same saved record to final review.
- Pass active-chain free-text clarification answers to final review, with the original question and model recommendation for context.
- Keep behavior additive for old group records and conflict-free drafts.

## Non-goals

- Use a deterministic parser to decide whether arbitrary prose conflicts.
- Auto-rewrite acceptance criteria from free text without showing the result to the person.
- Add a post-acceptance criterion amendment command. Changing a frozen acceptance document/export after work has started remains a separate design point; the existing review-accept/new-requirement exits remain.
- Change execution, funding, or task acceptance based on a conflict record.

## Approach

When a draft with `requirementConflicts` is accepted, copy those exact entries to an optional `acceptedConflicts` field on the group's requirement record, together with the draft number, timestamp and actor. In the same transaction, freeze the requirement document with a visible accepted-conflicts section and mark criteria provisional only when an entry names an exact criterion id. Project the saved record into the group summary and a warning line in group brief.

For final review, pass both the accepted conflict snapshot and active-chain text answers. Prompt the reviewer to recognize the accepted conflict as known history and to use human answers as context while judging the delivered work. Keep this model-mediated; no new deterministic verdict rule is added.

## Acceptance criteria

1. Accepting a conflict-bearing draft stores the exact entries, draft number, accepting actor and acceptance time on the requirement block; conflict-free acceptance and old records keep the old shape.
2. The frozen document lists accepted conflicts and marks a criterion provisional only when the conflict names its exact id.
3. `group brief` shows a warning with the accepted conflict count and criterion identifiers; `group show` and `requirement show --json` expose the same snapshot.
4. The final review prompt receives the accepted conflicts and active-chain human text answers, including their question and recommendation, as context.
5. Existing schemas remain backward compatible; no database migration, static prose analysis, or automatic pass/fail decision is added.
6. Focused tests cover accepted persistence, frozen document, group brief, and review prompt content, including conflict-free/legacy cases.

## Trade-offs and remaining boundary

This makes the accepted state auditable and gives review the person's words, but does not prove that a model reconciles arbitrary prose correctly. It also does not provide a post-acceptance AC amendment command. That part of #542 remains open because it changes the frozen requirement document and its repository export after work has started.
