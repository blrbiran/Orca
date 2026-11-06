# Save full requirement splits in the plan library (#190)

## Intent

A requirement split may contain more than 20 acceptance criteria and a statement longer than 2,000 characters. Saving that same plan into the library must preserve every criterion and the full goal so it can later be imported without silently changing the agreement.

## Approaches

1. Merge or truncate criteria during split: risks dropping independently checkable acceptance conditions and changes a confirmed plan. Rejected.
2. Add a separate compression step only when saving: the library copy would differ from the run's archived plan. Rejected.
3. Remove the library codec's per-field 20-condition and 2,000-character ceilings; retain its existing 2 MiB canonical document limit and the scheduler's full import validation. Chosen.

## Behavior and boundary

- `plan-library-save` from a group or requirement draft and `plan-library-import` retain the full `goal` and `successConditions` values. `orca-plan-v1` stays the same schema name because old documents remain valid.
- Malformed shape, invalid tasks/graph and the 2 MiB canonical byte ceiling retain their named refusals. The total byte limit bounds every string and list together.
- No prior plan version or accepted requirement is rewritten. A document beyond 2 MiB is still refused by `plan-library-doc-too-large`.
