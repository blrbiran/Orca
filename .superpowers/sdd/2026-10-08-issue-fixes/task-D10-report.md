# Task D10 report
Appended the ERRATUM to docs/superpowers/specs/2026-09-25-execution-driver-design.md (one hunk @@ -236,3 +236,26 @@, 23 added lines, zero `-` lines; /usr/bin/git diff read whole). Pathspec commit of that one file.
Deviations from brief text: added attribution line (Rule 13); noted §2.3 line is Chinese in the original; added retry-task refusal list (task-not-retryable, group-reserve-insufficient) as implemented in src/control/retryTask.ts; cleanup sentence phrased as "left with cleanedUp false so the driver archives ... " (D7's cleanup commit not landed, not cited). Cited subjects verified with git log --fixed-strings --grep: 6a90702, 54f76a2, c57493f, ebe9882.
Concern: the cleanup sentence is true only once D7 lands; D8/D7 not cited.
No tests/mutations (docs).
