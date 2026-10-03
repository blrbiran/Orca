# Task 4 re-review, fix 114b20d..7ab2fa2

## Finding Verdicts
- F1 remove skills-unsupported-agent check: ADDRESSED. Check replaced by a one-line comment naming ccloop's acceptStart (webService.ts ~l.558). Code removed from errors.ts and web/src/locales/zh.ts; grep of src, web/src, tests finds no remaining use. Its test is deleted.
- F2 any declared skills need syncskill: ADDRESSED. lookupSkillProfiles sets `declared` for names or profile and returns syncskill-unconfigured when bin === null (webService.ts ~l.56-65), thrown in-transaction via `skillLookup.failure`. New names-only test in confirmSkills.test.ts covers bin null and undefined deps and checks the group stays unconfirmed. Report claims mutation F2 (drop the check) goes red with 1 failure.
- F3 bare toThrow(): ADDRESSED. Now `toThrow("skills-task-unknown")` (matches webProtocol.ts:506) and the no-names case asserts the issue path equals ["skills.0.names"].

## New Breakage in the Fix Diff
None.

## Out-of-Scope Observations
- The first `skills-task-unknown` test goes through the schema refine, not prepareExecutionSnapshot's own throw; fine, the message matches.
