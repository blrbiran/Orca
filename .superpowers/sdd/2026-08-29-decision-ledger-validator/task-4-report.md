# Task 4 Report — 整份校验的检查 5（引用的 id 必须存在）

## What was implemented

- Created `src/ledger/validateFile.ts`: exports `LineVerdict`, `FileVerdict`, and
  `validateFile(lines: string[]): FileVerdict`. It runs `validateLine` per non-blank line,
  collects the set of ids from lines with `ev === "decision"`, and for any `bound` /
  `superseded` / `overturned` line whose referenced `id` is not in that set, downgrades
  the per-line result to `rejected` (only when `validateLine` itself did not already
  reject it). File-level `verdict` aggregates with `rejected` outranking `downgraded`
  outranking `ok`.
- Created `tests/ledger/validateFile.test.ts`: 10 tests, exactly the brief's cases
  (Chinese test data — `question`/`chose`/`because`/`undo.cost`/`blast_radius` fields —
  kept byte-identical; `it(...)` descriptions and code comments translated to English
  per project constraint 1).

Both files are new; the implementation is verbatim from the brief's Step 3 code block
(unchanged, since it already matched project conventions and there was nothing to
simplify or correct).

## RED evidence (Step 2)

Command:
```
npx vitest run tests/ledger/validateFile.test.ts > /tmp/orca-t4-red.txt 2>&1; echo "exit=$?" >> /tmp/orca-t4-red.txt; cat /tmp/orca-t4-red.txt
```
Output (verbatim):
```
 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ❯ tests/ledger/validateFile.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/ledger/validateFile.test.ts [ tests/ledger/validateFile.test.ts ]
Error: Failed to load url ../../src/ledger/validateFile.js (resolved id: ../../src/ledger/validateFile.js) in /Users/biran/code/skills/loop/Orca/tests/ledger/validateFile.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

 Test Files  1 failed (1)
      Tests  no tests

exit=1
```
Matches the brief's expectation (`Failed to resolve import`, `exit=1`).

## GREEN evidence (Step 4, and final re-run before commit)

Command:
```
npm test > /tmp/orca-t4-green.txt 2>&1; echo "exit=$?" >> /tmp/orca-t4-green.txt; cat /tmp/orca-t4-green.txt
```
Output (verbatim):
```
> orca@0.1.0 test
> vitest run

 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ✓ tests/smoke.test.ts (1 test) 2ms
 ✓ tests/ledger/undoExecutable.test.ts (10 tests) 3ms
 ✓ tests/ledger/validateFile.test.ts (10 tests) 5ms
 ✓ tests/ledger/validateLine.test.ts (38 tests) 16ms

 Test Files  4 passed (4)
      Tests  59 passed (59)
   Start at  22:29:20

exit=0
```
Re-run once more right before the commit (`/tmp/orca-t4-final-green.txt`), identical
result: `Test Files 4 passed (4)`, `Tests 59 passed (59)`, `exit=0`.

49 pre-existing + 10 new = 59. Matches.

## Mutation procedure

Followed the task's mandated procedure (clone --local, not the brief's git-checkout
recipe, since `validateFile.ts` was uncommitted at mutation time).

Fingerprint before any mutation work:
```
git -C "$MAIN" status --porcelain > /tmp/orca-t4-fp-before-status.txt
git -C "$MAIN" diff > /tmp/orca-t4-fp-before.txt
wc -c < /tmp/orca-t4-fp-before.txt        # => 0
```
`/tmp/orca-t4-fp-before-status.txt` content: `?? package-lock.json` (pre-existing
untracked file, unrelated to this task).

Clone + copy-in:
```
git clone --local -q "$MAIN" "$MUT"
ln -s "$MAIN/node_modules" "$MUT/node_modules"
for f in src/ledger/validateFile.ts tests/ledger/validateFile.test.ts; do
  mkdir -p "$MUT/$(dirname "$f")"; cat "$MAIN/$f" > "$MUT/$f"; diff "$MAIN/$f" "$MUT/$f"; echo "diff $f exit=$?"
done
```
Both `diff ... exit=0`.

Baseline (must be green before mutating):
```
(cd "$MUT" && npx vitest run tests/ledger/validateFile.test.ts) > /tmp/orca-t4-mut-baseline.txt 2>&1; echo "exit=$?"
```
Result: `Test Files 1 passed (1)`, `Tests 10 passed (10)`, `exit=0`.

### M4-a — check 5 is dead code

**Edit**: removed the entire block
```ts
if (typeof parsed.ev === "string" && REFERENCE_EVENTS.has(parsed.ev)) {
  if (typeof parsed.id !== "string" || !decisionIds.has(parsed.id)) {
    return { lineNumber: entry.lineNumber, result: { verdict: "rejected", reasons: [...] } };
  }
}
```
inside `$MUT/src/ledger/validateFile.ts`, leaving only `return { lineNumber: entry.lineNumber, result };`.

**Command**: `(cd "$MUT" && npx vitest run tests/ledger/validateFile.test.ts) > /tmp/orca-t4-m4a.txt 2>&1; echo "exit=$?"`

**Failing output (verbatim, relevant part)**:
```
 ❯ tests/ledger/validateFile.test.ts (10 tests | 4 failed) 10ms
   × validateFile — check 5: referenced ids must exist in the file > rejects when a bound references an id that does not exist 4ms
     → expected 'ok' to be 'rejected'
   × validateFile — check 5: referenced ids must exist in the file > rejects when a superseded references an id that does not exist 0ms
   × validateFile — check 5: referenced ids must exist in the file > rejects when an overturned references an id that does not exist 0ms
   × validateFile — check 5: referenced ids must exist in the file > a bound cannot reference another bound's id — only a decision counts as the referenced object 1ms

 Test Files  1 failed (1)
      Tests  4 failed | 6 passed (10)
exit=1
```

**Named assertion visible**: `rejects when a bound references an id that does not exist` (the brief's target for M4-a) — present and failing, `expected 'ok' to be 'rejected'`.

**Restore**: `cat "$MAIN/src/ledger/validateFile.ts" > "$MUT/src/ledger/validateFile.ts"; diff ...; echo "restore exit=$?"` → `restore exit=0`.

### M4-b — id-collection guard limited to `decision` is dead

**Edit**: in `$MUT/src/ledger/validateFile.ts`, changed
```ts
if (parsed.ev === "decision" && typeof parsed.id === "string") {
```
to
```ts
if (typeof parsed.id === "string") {
```

**Command**: `(cd "$MUT" && npx vitest run tests/ledger/validateFile.test.ts) > /tmp/orca-t4-m4b.txt 2>&1; echo "exit=$?"`

**Failing output (verbatim, relevant part)**:
```
 ❯ tests/ledger/validateFile.test.ts (10 tests | 4 failed) 10ms
   × validateFile — check 5: referenced ids must exist in the file > rejects when a bound references an id that does not exist 4ms
   × validateFile — check 5: referenced ids must exist in the file > rejects when a superseded references an id that does not exist 0ms
   × validateFile — check 5: referenced ids must exist in the file > rejects when an overturned references an id that does not exist 0ms
   × validateFile — check 5: referenced ids must exist in the file > a bound cannot reference another bound's id — only a decision counts as the referenced object 1ms

 Test Files  1 failed (1)
      Tests  4 failed | 6 passed (10)
exit=1
```

**Named assertion visible**: `a bound cannot reference another bound's id — only a decision counts as the referenced object` (the brief's target for M4-b) — present and failing.
(The other three tests also break as a side effect: once any event's own id is added to
the id set regardless of `ev`, a reference to a nonexistent id can accidentally
self-satisfy when that same line's `id` field is read back — confirming the guard was
load-bearing, not incidental.)

**Restore**: `restore exit=0`.

### M4-c — aggregation priority swapped

**Edit**: in `$MUT/src/ledger/validateFile.ts`, changed
```ts
verdict: hasRejected ? "rejected" : hasDowngraded ? "downgraded" : "ok",
```
to
```ts
verdict: hasDowngraded ? "downgraded" : hasRejected ? "rejected" : "ok",
```

**Command**: `(cd "$MUT" && npx vitest run tests/ledger/validateFile.test.ts) > /tmp/orca-t4-m4c.txt 2>&1; echo "exit=$?"`

**Failing output (verbatim)**:
```
 ❯ tests/ledger/validateFile.test.ts (10 tests | 1 failed) 9ms
   × validateFile — aggregation and line numbers > verdict is rejected when there are both downgrades and rejections 4ms
     → expected 'downgraded' to be 'rejected'

 FAIL  tests/ledger/validateFile.test.ts > validateFile — aggregation and line numbers > verdict is rejected when there are both downgrades and rejections
AssertionError: expected 'downgraded' to be 'rejected'

Expected: "rejected"
Received: "downgraded"

 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
exit=1
```

**Named assertion visible**: `verdict is rejected when there are both downgrades and rejections` (the brief's target for M4-c) — present and failing, isolated (only this one test fails, confirming the mutation's effect is scoped exactly where expected).

**Restore**: `restore exit=0`.

## Main-tree-untouched proof

Before:
```
git -C "$MAIN" status --porcelain > /tmp/orca-t4-fp-before-status.txt   # "?? package-lock.json"
git -C "$MAIN" diff > /tmp/orca-t4-fp-before.txt; wc -c < /tmp/orca-t4-fp-before.txt   # => 0
```
After (post-mutation, post-restore, mutant clone removed):
```
git -C "$MAIN" status --porcelain > /tmp/orca-t4-fp-after-status.txt
git -C "$MAIN" diff > /tmp/orca-t4-fp-after.txt; wc -c < /tmp/orca-t4-fp-after.txt   # => 0
diff /tmp/orca-t4-fp-before.txt /tmp/orca-t4-fp-after.txt; echo "fingerprint diff exit=$?"   # => 0
diff /tmp/orca-t4-fp-before-status.txt /tmp/orca-t4-fp-after-status.txt; echo "status diff exit=$?"   # => 0
```
Both diffs exit 0 — the main working tree was untouched by all mutation work. (The
`?? package-lock.json` untracked entry is pre-existing and unrelated to this task; it
was present identically before and after.)

## Test-name mapping table (Chinese brief → English used)

| Chinese (brief) | English `it(...)` used |
|---|---|
| bound 引用了本文件里存在的 decision id 时通过 | passes when a bound references a decision id that exists in the file |
| **bound 引用了不存在的 id 时拒绝** (M4-a target) | **rejects when a bound references an id that does not exist** |
| superseded 引用不存在的 id 时拒绝 | rejects when a superseded references an id that does not exist |
| overturned 引用不存在的 id 时拒绝 | rejects when an overturned references an id that does not exist |
| 引用出现在被引用的 decision 之前也通过——spec 只要求「在本文件中存在」，不要求顺序 | passes even when the reference appears before the referenced decision — spec only requires existence in the file, not order |
| **bound 不能引用另一条 bound 的 id——只有 decision 才是被引用的对象** (M4-b target) | **a bound cannot reference another bound's id — only a decision counts as the referenced object** |
| 空行被跳过，不算一条记录 | blank lines are skipped and do not count as a record |
| 行号是 1-based，且指向出问题的那一行 | line numbers are 1-based and point at the offending line |
| 有降级无拒绝时，整份的 verdict 是 downgraded | verdict is downgraded when there are downgrades but no rejections |
| **同时有降级和拒绝时，整份的 verdict 是 rejected** (M4-c target) | **verdict is rejected when there are both downgrades and rejections** |

describe blocks: `validateFile — 检查 5：引用的 id 必须在本文件中存在` →
`validateFile — check 5: referenced ids must exist in the file`;
`validateFile — 汇总与行号` → `validateFile — aggregation and line numbers`.

## Confirmations

- Full suite green: `npm test` → `Test Files 4 passed (4)`, `Tests 59 passed (59)`, `exit=0`
  (run twice: once at Step 4, once right before commit — identical).
- `.decisions/orca-dev-09cc3ea1.jsonl`: `wc -l` → `11` (unchanged); `git status --porcelain`
  on the path → empty; `git diff` on the path → 0 bytes. Not touched.
- Commit `fe64513`: `2 files changed, 166 insertions(+)` — exactly
  `src/ledger/validateFile.ts` and `tests/ledger/validateFile.test.ts`. No other files
  staged or committed (the pre-existing untracked `package-lock.json` was left alone).

## Self-review findings / concerns

- The Step-3 implementation given in the brief was used verbatim; I did not find
  anything to simplify or correct in it — it already matches the codebase's existing
  patterns (`try/catch` around `JSON.parse`, `Set` for membership, doc comment citing
  spec §3.8).
- One thing worth flagging (not a defect, just an observation for whoever reads this
  later): M4-b's mutation makes 4 tests fail, not just the 1 the brief names — this is
  because removing the `ev === "decision"` guard means a reference event's own `id` also
  gets added to `decisionIds`, so a self-referencing bad-id case can spuriously pass.
  The brief only requires the named assertion to be visible in the failure list, which
  it is; I did not treat the extra failures as a problem.
- No other concerns. All work stayed within the two files the brief lists.
