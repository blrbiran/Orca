# Task E9 review (reviewer, session 2; package 92da0e6..f7e61b4)

**Verdict: Needs fixes** (one Important, 4 minor)

### Spec Compliance
- ✅ Graph drawn whenever items exist, edges or not (DependencyGraph.tsx `items.length === 0` only); rewritten tests match the brief verbatim.
- ✅ Nodes classed by server category (`nodeClass`), legend of all five via WEB_WORK_ITEM_CATEGORIES, en+zh keys complete (zh typed against en).
- ✅ nodeLines: step · attempt, run number > 1, elapsed from current run `startedAt`, stalled strictly > 10 min; non-running -> all null. Stall in amber (`.dep-stall` = --warn).
- ✅ Slow pulse 2.4 s, none under reduced motion; tokens in dark + both light blocks (styles.test.ts pins all three).
- ✅ ControlGroupView passes `runs` and `now`; graph hook order is safe (useClock before the early return).
- ✅ Mutation evidence m1-m7 covers each new branch (report); I did not re-run.
- Deviation 1 (runNumber -> `lineageRunNumber`, shared with D6's `taskRunNumber`): correct on the merits and required by global.md amendment 3 (no duplicate helpers; E9 uses D6's rule). `taskRunNumber` behaviour is unchanged (same filter). Accepted.
- Deviation 2 (`*-subtle` tokens in both light blocks): accepted; it is the E8 follow-up the ledger assigned to E9, and values mirror the light --ok/--warn/--danger/--info at the dark blocks' 0.08. Minimal and surgical.
- Dark-only contrast test: matches the existing harness (reads only the dark block); judged below.

### Strengths
- One run-number rule instead of two; tests call the code first and assert after; stall boundary tested at exactly 10 and 11 min; reduced-motion pinned.
- Left `nodeClass` joined-literal trick so the panel text scan stays quiet.

### Issues
**Important**
1. `.dep-node text.dep-stall` (styles.css, `fill: var(--warn)`, 12 px) is the only coloured text on a category fill and it is not pinned by contrast.test.ts. It appears only on running nodes. Computed by me (WCAG 2, node script over the diff's token values): light theme #b45309 on the light running fill = **4.05:1** (< 4.5 AA for small text); dark #f59e0b on the dark running fill = 4.51:1 (a hair above, no margin). The spec requires amber, so keep amber but fix it: e.g. darken the light-theme stall colour (a dedicated `--warn-text` / or `--stall` token, ~#92400e gives >= 4.5 on the green fill), or fill the stall line with a solid backing; and add a contrast assertion for stall text on `--cat-running` (dark, and light if the test is extended per minor 1).

**Minor**
1. contrast.test.ts pins only the dark block, so a light-theme fill regression is invisible. My computation shows body `--text` on every light fill is 8.35-9.38:1, so nothing is wrong today. Cheap improvement: make `token()` take the block (light blocks are one-line, first `}`-delimited slice works) and loop the category assertion over dark + light. Not blocking by itself; it becomes needed with Important 1's light case.
2. styles.test.ts reduced-motion check uses `css.indexOf("@media (prefers-reduced-motion: reduce)")` (first occurrence); it passes today because the graph's block is the only one (styles.css:288) but would silently check another block if one were added earlier. Anchor on the `.dep-node.dep-running` text instead.
3. `.dep-node[aria-current="true"]` changed from an accent fill to an accent stroke (stroke-width 3), identical to `:focus-visible`; selected and focused nodes are now indistinguishable. Defensible (fill is now the category) but not in the brief's list of reasons; worth a glance by the human.
4. NODE_H grows to 88 for every node, including idle/done ones that draw only two lines; graphs of many tasks get taller than needed. Brief-mandated constants, so leave unless the human objects.

### Assessment
**Needs fixes.** Implementation matches spec §6.5 and the brief, both deviations are sound; the one blocker is the amber stall text at 4.05:1 on the light running fill with no contrast pin.
