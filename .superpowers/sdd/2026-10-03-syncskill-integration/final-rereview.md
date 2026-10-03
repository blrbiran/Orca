# Final re-review (T1, N1, I1, I2)

## Finding Verdicts
- T1 (ccloop) envelope-hash golden through the parse path, red under mutation: ADDRESSED. tests/control/protocol.test.ts (01d1684) hashes parseControlRequest("accept"|"inspect", envelope) output, pins temp paths after the parse; golden unchanged. Report shows `.default("/")` mutation red on the new test and green on the old form (c-mut1-new/old logs).
- N1 (Orca) changed skills on confirmed task with syncskill unset refused: ADDRESSED. src/control/webService.ts setTaskLoop check (state !== editable, !skillsUnchanged, recipe.skills defined, bin null). Test in setTaskLoopSkills.test.ts covers names/names-added/profile with undefined and {bin:null}, state unchanged, unchanged and removal accepted, no spawn; drafts covered by existing test. Mutations N1a-d each red per report.
- I1 (Orca, ruling b) codex E2E: ADDRESSED. skillsE2E.test.ts new describe asserts blockedReason accept-refused:2:skills-unsupported-agent, no agent calls, no accepted.json, skills-<runId> kept; two mutations red. Report honestly notes the no-accepted.json and snapshot-kept assertions not seen red alone.
- I2 (Orca) offline probe: ADDRESSED. scripts/probe-claude-skills.mjs committed (3e1366d), recorder, no model call, A2-shaped read-only plugin dir; run once rc 0 against claude 2.1.288; verdict recorded in final-fix-report.md section 4 (namespaced orca-run-skills:<name>, lock not reached, read-only loads); two probe mutations red.

## New Breakage in the Fix Diff
None.

## Out-of-Scope Observations
- Spec §11 does not yet carry the probe answers (report lists as N6, not done).
- Probe ran from an uncommitted copy with same bytes as 3e1366d (blob daf5949), per report.

## Verdict
All findings addressed, no new Critical/Important breakage.
