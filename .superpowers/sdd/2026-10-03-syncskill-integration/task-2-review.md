# Task 2 review (d017cb0..847a7a6)

### Spec Compliance
- ✅ Spec compliant. All four brief files present; argv, error codes, order of mapping, strict zod, sorted/unique, empty refusal, relative-bin check, stdin end, spawn-throw handling all match.
- ⚠️ Cannot verify from diff: errors.ts code registration is not in this task's diff (src/control/errors.ts untouched). Plan line 158 assigns it to a later task; controller should confirm that task covers all codes incl. `skills-shape`, `syncskill-failed:*` (a prefixed family, may need pattern handling).
- ⚠️ Mutation/TDD claims (red proofs, restore byte counts) are not visible in the diff; taken from report, unverified.

### Strengths
- Mirrors ccmem shape; ENOENT/EACCES, maxBuffer, killed, then JSON error code, then status order is sound (syncskill.ts:143-153).
- Tests pin exact argv via fake log, and assert "no spawn" on refusals (syncskill.test.ts:240, 260, 301, 331, 338).
- Rule 17 honoured: real test uses temp SYNCSKILL_DIR/HOME and snapshots ~/.syncskill; gate via ctx.skip() (syncskillReal.test.ts:395).
- Spawn-throw branch and stdin-EOF test are thoughtful.

### Issues
#### Critical
none
#### Important
none
#### Minor
1. syncskill.ts:96 and :150 — `slice(0, STDERR_EXCERPT_BYTES)` cuts characters, not bytes; name/constant is misleading (and reused for zod message). Rename to CHARS.
2. syncskill.ts:74 — profile summary schema is non-strict while the lock schema is strict; fine per brief, but profile `ls` result with a members list of non-strings gives `syncskill-output-invalid` only by coincidence of missing key (single code path), acceptable.
3. syncskillReal.test.ts: the C18 `--no-refresh` red proof is not achievable on the real run (report concedes); the flag is guarded only by the fake argv test. Acceptable, but note it as a standing gap.
4. syncskill.ts:124-126 — an exit-0 run that emitted an `error` event plus a `result` event is accepted; unlikely, no test either way.
5. syncskill.test.ts:315 — uses target "/x" in a failing-mode test; safe only because the fake does not mkdir in that mode. Prefer a temp target (the report notes the same trap hit once).
6. skills-shape reused for bad profile name / inject names (beyond brief); sensible, but must be registered in errors.ts.

### Assessment
**Task quality:** Approved
**Reasoning:** Implementation matches brief and global constraints; tests exercise real behaviour through a fake process and a gated real run. Only minor polish items.
