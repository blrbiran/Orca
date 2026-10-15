# Task A1 review (reviewer, clone /private/tmp/oec/mut/a1 @ 7e6baa08)

## Spec: PASS
- Production block in src/control/ccloopPort.ts matches the brief's Step 3 code verbatim (read against the diff): PEER_DETAIL_MAX=512, PeerFailure, peerFailure, peerErrorCode (same signature, defined as `peerFailure(error)?.code ?? null`), peerCode, peerExitText, ccloopFailedMessage, peerFailureLogLine.
- Binding constraints verified in the code: 512 cut = 511 units + "…", one less when unit 511 (index 510) is a high surrogate; C0/C1 class is \u0000-\u001f and \u0080-\u009f written as escapes (DEL untouched); K1 lookahead is exactly `(?=$|\s|:\s|:$)`.
- Test file is verbatim from the brief. Only the two listed paths changed (2 files, +121/-4).
- Clone baseline: peerFailure.test.ts 7/7 pass, 0 skipped (/private/tmp/oec/logs/a1-base.log).

## Findings
Critical: none.

Important
- I1 (missing criteria, three mutations stay green; test file tests/control/peerFailure.test.ts). The brief's own binding constraints are not pinned:
  - DEL kept (`\u007f`): mutation widening the class to start at \u007f (e2) stays green. Fix: in the C0/C1 test add a DEL char, e.g. detail `"a\u007fb"` expecting `"a\u007fb"` (write it as an escape).
  - NUL / lower bound of C0: mutation `\u0000` -> `\u0001` (e4) stays green. Fix: include `\u0000` in the control-character input and expect a space.
  - Final-colon branch of the K1 lookahead (`|:$`): removing it (e1) stays green. Fix: add `peerFailure(peer("2:agent-version-drift:"))` expecting `{exit:"2", code:"agent-version-drift", detail:""}`.
  These are new-criterion gaps in A1's own scope; per the plan, add the assertions (new test only) in this task.

Minor
- M1 brief Step 6 says A1a is red on the URL test "only"; actually red on 3 tests (URL test, the 512-cut test via the 600-"a" run, and peerCode/peerErrorCode test). The named assertion is red, so no action beyond correcting the brief's wording.
- M2 the new code uses 2-space/spaced style while neighbouring lines are compact; it is the brief's verbatim text, so conformant with the task, noting only.

## Mutations (clone a1, runner self-check: bad spec -> .mutate "found 0", restore bytes 0 0, file unchanged)
All rows: sha-after != sha-before, sha-restored == sha-before, restore-bytes `0 0`.
| name | change | result |
|---|---|---|
| A1a | drop lookahead | RED: "names no code for a URL..." (code 'file' received) (+ 2 more tests) |
| A1b | drop 512 early return | RED: "cuts the detail to 512..." |
| A1c | keep control chars | RED: "replaces every C0 and C1..." |
| A1d | no surrogate guard | RED: "cuts the detail..." (emoji line, length 512 vs 511) |
| E1 | drop `\|:$` | GREEN (gap I1) |
| E2 | class starts at \u007f (DEL replaced) | GREEN (gap I1) |
| E3 | `PEER_DETAIL_MAX - 1` -> `PEER_DETAIL_MAX` | RED: cut test |
| E4 | class starts at \u0001 | GREEN (gap I1) |
| E5 | drop second trim | RED: control-char test |
| E6 | `{0,63}` -> `{0,64}` | RED: 65-char test |
| E7 | drop `^:` strip | RED (4 tests) |
| E8 | peerErrorCode returns null | RED: peerCode/peerErrorCode test |
A1a-A1d: 4/4 red. Extras: 6/9 red, 3 green. Logs: /private/tmp/oec/mut/logs/*.

## Cannot verify from diff
- Implementer's typecheck (rc=0) and the 86-test green run of the existing port/freeze/collector files; I did not rerun them (only the new file in the clone).
- Raw-NUL byte check on ccloopPort.ts: the diff shows escapes, not raw bytes; implementer's a1-bytes.log claims `0 1`.
- pgrep: before my run 9 matching lines, after 32 vitest/worker lines from other sessions' gates (not mine; my runs had finished). No process killed. Runner note: my mut.sh continues to the test run on a failed mutate (the bad-spec self-check still showed file unchanged and bytes 0).

## Re-review 1 (fix 9b6391aa, clone /private/tmp/oec/mut/a1r1)
Fix diff: tests/control/peerFailure.test.ts only, +5 lines (final-colon case, NUL case, DEL case, all as \u escapes). No production change.
Baseline in clone: 7/7 pass.
| mutation | red on | restore bytes |
|---|---|---|
| E1 drop `\|:$` | "reads ccloop's code..." (final-colon assertion, code null received) | 0 0 |
| E2 class starts at \u007f | "replaces every C0 and C1..." (DEL assertion) | 0 0 |
| E4 class starts at \u0001 | "replaces every C0 and C1..." (NUL assertion, test.ts:30) | 0 0 |
All three sha-restored == sha-before. Finding I1: ADDRESSED. New breakage: none.
