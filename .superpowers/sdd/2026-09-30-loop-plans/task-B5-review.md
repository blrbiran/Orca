# Task B5 review (661273e..92ef663)

### Spec Compliance
- ✅ Spec compliant. Route entry (src/panel/controlApi.ts:28-36) and dispatcher case (:58) match the brief and mirror `set-task-labels`; `WEB_LOOP_PLANS` (web/src/controlTypes.ts:165-172) present; the four criteria match the brief verbatim. English names follow R-F5, and the MB5-3 edit was adapted accordingly (a departure that the rulings mandate).
- The `web/src/controlApi.ts` wiring is left out, per the controller note it belongs to B6. Not a finding.
- ⚠️ Cannot verify from the diff: RED/GREEN/mutation results (rc values, MB5-1..4 red criteria) rest on the report's evidence files. I did not re-run them, as instructed.

### Strengths
- Minimal, surgical diff (+93, nothing else touched); the route copies the neighbouring entry's shape exactly, ledger key the group's.
- Mirror criterion compares order and name against the live registry, so both rename and omission go red (MB5-3, MB5-4, the latter added per P3).
- The refusal criterion checks the ledger through the command lookup, not only the HTTP answer.
- Report is candid that MB5-2 leaves the shape criterion green (the 400 comes from the envelope parse before the switch), which is correct.

### Issues
#### Critical
None.
#### Important
None.
#### Minor
- tests/panel/taskLoopApi.test.ts:137-143: the title says "before the ledger" but the test only checks status 400 and the error code. It never asserts the command is absent from the ledger (e.g. a lookup of `loop-shape` answering not-found). A route that ledgered the 400 would still pass. Add a lookup assertion, or reword the title.
- web/src/controlTypes.ts:165: a runtime `const` is added to a types module. The brief mandates it, so this is only a note for B6 if that module is ever imported by type-only tooling.

### Assessment
**Task quality:** Approved

**Reasoning:** A small, convention-matching change with criteria that go red for the right reasons per the reported mutations, including the P3 extra branch. Only one minor test-title/assertion gap.
