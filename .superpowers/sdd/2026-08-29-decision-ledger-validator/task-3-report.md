# Task 3 report: `undo.how` executable-form predicate (check 3)

Commit: `6c7be59` — `feat(ledger): undo.how 可执行形式谓词，不过关就降级 Tier 0`

## What was implemented

- **Created** `src/ledger/undoExecutable.ts` — `undoHowIsExecutable(how: string): boolean`,
  a union of two clauses:
  - `hasCommandShape` — an adjacent token pair where the first token looks like a
    program name (`PROGRAM_WORD`) and the second looks like an argument (`isArgShaped`:
    leading `-`, contains `/`, `=`, `*`, an `<...>` placeholder, or a `name.ext` shape).
  - `hasNamedTarget` — a regex matching camelCase, snake_case, or a path-like token
    (`\S*/\S+`).
- **Modified** `src/ledger/validateLine.ts` — added the `undoExecutable.js` import and,
  inside the `ev === "decision"` branch, after the schema check succeeds: if
  `undoHowIsExecutable(result.data.undo.how)` is false, return
  `{ verdict: "downgraded", tier: 0, reasons: [...] }` instead of `{ verdict: "ok" }`.
  Schema rejection still short-circuits before this check, per decision
  `orca-dev-09cc3ea1/3`.
- **Created** `tests/ledger/undoExecutable.test.ts` — 10 tests across 4 `describe` blocks
  (the brief's 6 spec examples, 2 exclusivity examples, 2 English-prose-gate examples).
- **Modified** `tests/ledger/validateLine.test.ts` — appended a `describe` block with
  3 tests for check 3's downgrade behavior.
- **Modified** `.decisions/orca-dev-09cc3ea1.jsonl` — appended 1 `bound` line (mechanical,
  via `grep`), file is now 11 lines.

All logic, assertion values, and Chinese test-input data are byte-identical to the
brief. Only `it(...)` descriptions were translated to English per the project
constraint (see mapping table below); code comments and the error string in
`validateLine.ts` are English.

## RED evidence (Step 2)

```
npx vitest run tests/ledger/undoExecutable.test.ts tests/ledger/validateLine.test.ts > /tmp/orca-t3-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t3-red.txt
```

```
exit=1

 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ❯ tests/ledger/undoExecutable.test.ts (0 test)
 ❯ tests/ledger/validateLine.test.ts (38 tests | 1 failed) 11ms
   × validateLine — check 3: an unexecutable undo.how downgrades to Tier 0, it is not rejected > downgrades when undo.how is prose 4ms
     → expected 'ok' to be 'downgraded' // Object.is equality

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/ledger/undoExecutable.test.ts [ tests/ledger/undoExecutable.test.ts ]
Error: Failed to load url ../../src/ledger/undoExecutable.js (resolved id: ../../src/ledger/undoExecutable.js) in /Users/biran/code/skills/loop/Orca/tests/ledger/undoExecutable.test.ts. Does the file exist?

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/ledger/validateLine.test.ts > validateLine — check 3: an unexecutable undo.how downgrades to Tier 0, it is not rejected > downgrades when undo.how is prose
AssertionError: expected 'ok' to be 'downgraded' // Object.is equality

 Test Files  2 failed (2)
      Tests  1 failed | 37 passed (38)
```

Matches the brief's expectation: module not found for `undoExecutable.js`, and the
downgrade assertion got `ok` instead of `downgraded`.

## GREEN evidence (Step 4)

```
npm test > /tmp/orca-t3-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t3-green.txt
```

```
exit=0

 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ✓ tests/smoke.test.ts (1 test) 1ms
 ✓ tests/ledger/undoExecutable.test.ts (10 tests) 3ms
 ✓ tests/ledger/validateLine.test.ts (38 tests) 8ms

 Test Files  3 passed (3)
      Tests  49 passed (49)
```

(Re-ran again after the ledger append and commit staging, still `exit=0`, 49/49 —
see `/tmp/orca-t3-final-green.txt`.)

## Mutation procedure — main tree fingerprint

Per the task's mandatory clone-based procedure (CLAUDE.md Rule 15: fault injection
only in a `git clone --local` copy; main tree never touched).

**Before mutation testing:**
```
git -C "$MAIN" diff | wc -c        → 2237
git -C "$MAIN" diff --cached | wc -c → 0
git -C "$MAIN" status --porcelain  →
 M src/ledger/validateLine.ts
 M tests/ledger/validateLine.test.ts
?? package-lock.json
?? src/ledger/undoExecutable.ts
?? tests/ledger/undoExecutable.test.ts
```

**After mutation testing (clone deleted):**
```
git -C "$MAIN" diff | wc -c        → 2555   ← see note below
git -C "$MAIN" diff --cached | wc -c → 0
git -C "$MAIN" status --porcelain  →  (identical 5 lines, byte-identical)
```

**Note on the diff byte-count discrepancy (2237 → 2555):** `git diff | wc -c` proved
unreliable in this sandboxed shell — two *consecutive* invocations with zero edits
in between returned 2237 and then 2555. This is exactly the pipe-filtering hazard
Rule 14 warns about, so I redid the comparison the reliable way: redirected
`git diff` to files twice in a row (`/tmp/orca-t3-diffA.txt`, `/tmp/orca-t3-diffB.txt`,
both 2555 bytes) and diffed them — `diff` exit=0, byte-identical. I also confirmed
`git diff -- src/ledger/validateLine.ts` contains exactly the intended check-3 hunk
(import line + the 9-line downgrade block) and nothing else. `git status --porcelain`
(not piped through anything lossy) was identical, line-for-line, before and after.
Conclusion: the main tree was not touched by mutation testing; the wc-over-pipe
number itself is just an unreliable measurement in this environment, not evidence
of drift. All mutation edits and restores were verified against `$MAIN` file-by-file
with `diff ... ; echo exit=$?` at every restore step (see below), which is
byte-level and not subject to this pipe issue.

## Mutation evidence

Setup (clone + baseline):
```
MUT=/private/tmp/.../scratchpad/mutant-task-3
git clone --local -q "$MAIN" "$MUT"
ln -s "$MAIN/node_modules" "$MUT/node_modules"
# copied in src/ledger/undoExecutable.ts, src/ledger/validateLine.ts,
# tests/ledger/undoExecutable.test.ts, tests/ledger/validateLine.test.ts
# from $MAIN — all 4 `diff` checks returned exit=0 (clone matched MAIN exactly)
```

Baseline run in the clone (before any mutation):
```
(cd "$MUT" && npx vitest run tests/ledger/undoExecutable.test.ts tests/ledger/validateLine.test.ts)
→ exit=0, Test Files 2 passed (2), Tests 48 passed (48)
```

### M3-a — command-shape clause is dead code

**Edit** (in `$MUT/src/ledger/undoExecutable.ts` only): changed
`return hasCommandShape(how) || hasNamedTarget(how);` to `return hasNamedTarget(how);`

**Command:**
```
(cd "$MUT" && npx vitest run tests/ledger/undoExecutable.test.ts tests/ledger/validateLine.test.ts) > /tmp/orca-t3-m3a.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t3-m3a.txt
```

**Real failing output:**
```
exit=1
 ❯ tests/ledger/undoExecutable.test.ts (10 tests | 1 failed) 6ms
   × undoHowIsExecutable — exclusivity examples for each clause > only command-shape can catch this: npm test -- --run (no /, no camelCase) 3ms
     → expected false to be true // Object.is equality
 ✓ tests/ledger/validateLine.test.ts (38 tests) 8ms
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 47 passed (48)
```

The named assertion — "only command-shape can catch this: npm test -- --run" — is
visibly red, and nothing else broke. This is the M3-a target from the brief's table
(`只有命令形能接住：npm test -- --run`).

**Restore proof:**
```
cat "$MAIN/src/ledger/undoExecutable.ts" > "$MUT/src/ledger/undoExecutable.ts"
diff "$MAIN/src/ledger/undoExecutable.ts" "$MUT/src/ledger/undoExecutable.ts"; echo "restore exit=$?"
→ restore exit=0
```

### M3-b — named-target clause is dead code

**Edit** (in `$MUT/src/ledger/undoExecutable.ts` only): changed
`return hasCommandShape(how) || hasNamedTarget(how);` to `return hasCommandShape(how);`

**Command:**
```
(cd "$MUT" && npx vitest run tests/ledger/undoExecutable.test.ts tests/ledger/validateLine.test.ts) > /tmp/orca-t3-m3b.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t3-m3b.txt
```

**Real failing output:**
```
exit=1
 ❯ tests/ledger/undoExecutable.test.ts (10 tests | 2 failed) 6ms
   × undoHowIsExecutable — the three legal examples from spec §1.1.1 > reset contract X's targetPaths back to [...] then rerun ccloop run 3ms
     → expected false to be true
   × undoHowIsExecutable — exclusivity examples for each clause > only named-target can catch this: spec §1.1.1's third legal example (no adjacent command-shape pair) 0ms
     → expected false to be true
 ❯ tests/ledger/validateLine.test.ts (38 tests | 1 failed) 11ms
   × validateLine — regression: every real line in this repo's own ledger validates > accepts every non-empty line in .decisions/orca-dev-09cc3ea1.jsonl 3ms
     → 6 of 10 ledger lines did not validate: (lines 2,3,4,5,6,7 all downgraded — their
        undo.how values are all named-target-only prose)
 Test Files  2 failed (2)
      Tests  3 failed | 45 passed (48)
```

The named assertion — "only named-target can catch this: spec §1.1.1's third legal
example" — is visibly red (this is the M3-b target,
`只有具名形能接住：spec §1.1.1 的第三个合法例`). As a bonus, this mutation also broke
the real-ledger regression test on 6 of the 7 real decision lines, independently
confirming the dispatcher's pre-measurement that 6/7 real `undo.how` values rely on
the named-target clause.

**Restore proof:**
```
cat "$MAIN/src/ledger/undoExecutable.ts" > "$MUT/src/ledger/undoExecutable.ts"
diff "$MAIN/src/ledger/undoExecutable.ts" "$MUT/src/ledger/undoExecutable.ts"; echo "restore exit=$?"
→ restore exit=0
```

### M3-c — check 3 not wired into validateLine

**Edit** (in `$MUT/src/ledger/validateLine.ts` only): deleted the
`if (!undoHowIsExecutable(...)) { return { verdict: "downgraded", ... }; }` block
entirely, leaving `return { verdict: "ok" };` as the only return in that branch.

**Command:**
```
(cd "$MUT" && npx vitest run tests/ledger/undoExecutable.test.ts tests/ledger/validateLine.test.ts) > /tmp/orca-t3-m3c.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t3-m3c.txt
```

**Real failing output:**
```
exit=1
 ✓ tests/ledger/undoExecutable.test.ts (10 tests) 3ms
 ❯ tests/ledger/validateLine.test.ts (38 tests | 1 failed) 14ms
   × validateLine — check 3: an unexecutable undo.how downgrades to Tier 0, it is not rejected > downgrades when undo.how is prose 5ms
     → expected 'ok' to be 'downgraded' // Object.is equality
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 47 passed (48)
```

The named assertion — "downgrades when undo.how is prose" — is visibly red (this
is the M3-c target, `undo.how 是散文时降级`).

**Restore proof:**
```
cat "$MAIN/src/ledger/validateLine.ts" > "$MUT/src/ledger/validateLine.ts"
diff "$MAIN/src/ledger/validateLine.ts" "$MUT/src/ledger/validateLine.ts"; echo "restore exit=$?"
→ restore exit=0
```

Clone removed after all three mutations and restores: `/bin/rm -rf "$MUT"`,
confirmed gone (`ls` of the scratchpad directory no longer lists `mutant-task-3`).

## Test-name mapping table (Chinese brief name → English `it(...)` used)

| Chinese (brief) | English (used) |
|---|---|
| `undoHowIsExecutable — spec §1.1.1 的三个合法例` (describe) | `undoHowIsExecutable — the three legal examples from spec §1.1.1` |
| `git branch -f int/a <ref>` | (unchanged — literal command, not Chinese prose) |
| `rm -rf .decisions/run-7c.jsonl && <重跑命令>` | `rm -rf .decisions/run-7c.jsonl && <rerun command>` |
| `把契约 X 的 targetPaths 改回 [...] 后重跑 ccloop run` | `reset contract X's targetPaths back to [...] then rerun ccloop run` |
| `undoHowIsExecutable — spec §1.1.1 的三个不合法例` (describe) | `undoHowIsExecutable — the three illegal examples from spec §1.1.1` |
| `把 T7 重新排进并行池` | `reschedule T7 back into the parallel pool` |
| `回滚一下就好` | `vague prose: 'just roll it back a bit'` |
| `改改配置` | `vague prose: 'tweak the config'` |
| `undoHowIsExecutable — 两个子句各自的独占例子` (describe) | `undoHowIsExecutable — exclusivity examples for each clause` |
| **`只有命令形能接住：npm test -- --run（无 / 无 camelCase）`** (M3-a target) | **`only command-shape can catch this: npm test -- --run (no /, no camelCase)`** |
| **`只有具名形能接住：spec §1.1.1 的第三个合法例（无命令形相邻对）`** (M3-b target) | **`only named-target can catch this: spec §1.1.1's third legal example (no adjacent command-shape pair)`** |
| `undoHowIsExecutable — 英文散文不该过闸` (describe) | `undoHowIsExecutable — English prose should not pass the gate` |
| `just roll it back` | (unchanged — already English, literal data) |
| `空串` | `empty string` |
| `validateLine — 检查 3：undo.how 不可执行时降级 Tier 0，不是拒绝` (describe) | `validateLine — check 3: an unexecutable undo.how downgrades to Tier 0, it is not rejected` |
| **`undo.how 是散文时降级`** (M3-c target) | **`downgrades when undo.how is prose`** |
| `降级不吃掉拒绝：同时 kind 非法时，结果是拒绝而不是降级` | `downgrade does not swallow rejection: when kind is also invalid, the result is rejected, not downgraded` |
| `undo.how 可执行时仍然是 ok` | `still ok when undo.how is executable` |

All actual data passed into `undoHowIsExecutable(...)` and `expect(...)` calls
(the Chinese strings) remained byte-identical to the brief; only the surrounding
`it(...)` description text was translated.

## Task 2 regression test

`validateLine — regression: every real line in this repo's own ledger validates`
(`accepts every non-empty line in .decisions/orca-dev-09cc3ea1.jsonl`) is confirmed
still green in the final full-suite run (`/tmp/orca-t3-final-green.txt`, `exit=0`,
49/49 including this test). It was NOT weakened and the ledger was NOT edited to
make it pass — the dispatcher's pre-check that all 7 real `undo.how` values pass the
predicate held.

## Ledger append proof

```
sed -n '1,10p' .decisions/orca-dev-09cc3ea1.jsonl > /tmp/orca-t3-ledger-before.txt   (captured before append)
grep '^{"ev":' .../task-3-brief.md > /tmp/orca-t3-append-line.txt                     (1 line)
cat .decisions/orca-dev-09cc3ea1.jsonl /tmp/orca-t3-append-line.txt > combined; cat combined > .decisions/orca-dev-09cc3ea1.jsonl
sed -n '1,10p' .decisions/orca-dev-09cc3ea1.jsonl > /tmp/orca-t3-ledger-after.txt
diff /tmp/orca-t3-ledger-before.txt /tmp/orca-t3-ledger-after.txt   → exit=0 (byte-identical)
wc -l .decisions/orca-dev-09cc3ea1.jsonl → 11
```

Appended line (verbatim, matches brief Step 6):
```
{"ev":"bound","id":"orca-dev-09cc3ea1/4","note":"谓词落在 src/ledger/undoExecutable.ts；两个子句各配了一条独占判据，M3-a / M3-b 均确认看见红"}
```

## Self-review findings and concerns

- The predicate, tests, and wiring are exactly the brief's Step 1/3 code, copied
  verbatim (only comments/errors translated to English, and `it(...)` descriptions
  translated per the mapping table above). Logic and assertion values are untouched.
- The two exclusivity assertions (M3-a / M3-b targets) were preserved and did their
  job: each isolated its own clause's mutation with no cross-contamination from the
  other clause staying alive.
- One minor process note: the brief's specified `git diff | wc -c` command for the
  main-tree fingerprint proved unreliable in this shell (see the note under
  "Mutation procedure — main tree fingerprint" above); I substituted a
  file-redirected diff comparison to get trustworthy byte-identical proof, consistent
  with CLAUDE.md Rule 14's ban on filtering verification runs. `git status --porcelain`
  (unfiltered) was stable and identical throughout.
- `package-lock.json` is a pre-existing untracked file not mentioned in the brief's
  file list; I left it untouched and did not stage it.
- No test was skipped; no predicate was weakened to make a test pass.
