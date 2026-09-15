# Task 8 fix round 1 — re-review

Fix base `0f506c8` → head `d44f6bb`. Diff file: `review-0f506c8..d44f6bb.diff` (2 files changed, 45
insertions(+), 2 deletions(-); no `Bin` line).

## Finding Verdicts

- **(I-1) `DecisionList.tsx` React key collision (`${projectKey}::${id}`)** — ADDRESSED.
  `web/src/DecisionList.tsx:33-35` now exports `rowKey(row): string { return JSON.stringify([row.projectKey,
  row.id]); }`, and `web/src/DecisionList.tsx:47` uses `key={rowKey(row)}` in place of the old template-literal
  join. `JSON.stringify` on a fixed 2-element string array is injective — each element is quoted and every
  internal `"`/`\` is escaped, so the separating `,` between array slots can never be produced by either string's
  own contents — which resolves the exact collision class named in the finding
  (`{projectKey:"a::b",id:"c"}` vs `{projectKey:"a",id:"b::c"}` now yield `'["a::b","c"]'` and `'["a","b::c"]'`,
  which differ). Matches controller ruling R60 (exported pure `rowKey`, `JSON.stringify([projectKey, id])`).
  Pinned by `web/tests/decisionList.test.tsx:43-48`: asserts the colliding pair produces different keys
  (`rowA`/`rowB` built from the review's own example) and that the same row produces the same key twice (rules out
  a trivially-different-every-call generator). Both assertions are real observations, not tautologies, and the
  report's own mutation prediction (K-8: revert to `"::"` join reddens exactly this `it`, first assertion) is
  consistent with the code as written.

## New Breakage in the Fix Diff

None. The diff touches only `web/src/DecisionList.tsx` and `web/tests/decisionList.test.tsx`. `rowKey`'s new
`Pick<DecisionListRow, "projectKey" | "id">` parameter type is a narrowing, not a behavior change, for the
existing call site (`rowKey(row)` inside `.map`, `row: DecisionListRow`). React's `key` prop is not part of
`renderToStaticMarkup`'s output, so the pre-existing "renders only the list fields" criterion
(`decisionList.test.tsx:14-28`) is unaffected by the key-generation change, as the report claims. No dependency,
no `package.json`, no binary diff.

## Out-of-Scope Observations

None — nothing outside the fix diff was inspected beyond confirming its boundaries.

## Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
