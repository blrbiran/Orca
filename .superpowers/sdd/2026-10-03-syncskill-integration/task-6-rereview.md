# Task 6 re-review, fix round 1 (01b74bc..2ea3271)

## Finding Verdicts
- I1 (C5 with a real syncskill): ADDRESSED. tests/control/driverSkillsReal.test.ts:73-135 is gated by ctx.skip() on ORCA_SYNCSKILL_REAL_BIN. It uses temp HOME/SYNCSKILL_DIR (:111) and runs A1/A2 (:117-118). It asserts SKILL.md (:122), plugin.json bytes (:123), dirs 0700 (:124-125), snapshot not writable (:126), drive.skills deep-equals {dir, profile:null, lock: lockFile.skills} (:129), and the real ~/.syncskill snapshot unchanged (:133). The report records syncskill SHA 3157563e58585e1feb5327a24a56e04efe7a4291 and a gated run (r1-gate.log, 2 passed rc 0). The fake now writes schema and created_at (fake-syncskill.mjs:211-212), matching the measured real shape.
- I2 (mutations seen red): ADDRESSED.
  - (a) workspace.test.ts:176-192 asserts the outside file stays 0644 after makeReadOnly. The report shows M13 red (365 vs 420).
  - (b) The same test asserts the outside file stays 0400 after removeSkillsSnapshot. The report shows M14 red (493 vs 256), rerun alone after the stacked first attempt was discarded, with restore bytes checked.
  - (c) driverSkills.test.ts:30-39 pins `skills-inject-failed:EACCES: permission denied, mkdir '<dir>'`, and no syncskill spawn. The report shows M15 red.
  - Skips are kept; no src change.

## New Breakage in the Fix Diff
None. Only tests changed. Minor: driverSkills.test.ts:35 relies on chmod 0500 producing EACCES, so the test would not fail as written if run as root.

## Out-of-Scope Observations
None.

## Verdict
**Fix round:** All findings addressed, no new Critical/Important breakage.
