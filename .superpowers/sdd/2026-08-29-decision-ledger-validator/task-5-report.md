# Task 5 Report: 追加语义检查（检查 6）

Commit: `c0e1799` — `feat(ledger): 追加语义检查，吃 git diff 文本的纯函数`

## What was implemented

- **Created** `/Users/biran/code/skills/loop/Orca/src/ledger/appendOnly.ts` — `checkAppendOnly(diffText: string): AppendOnlyResult`, a pure function over a `git diff` text. Gates on being inside a hunk (after an `@@` marker) before treating a `-`-prefixed line as a removal, rather than on the line's own prefix. This is exactly what keeps a real deleted line whose content starts with `--` from being confused with a diff header line (`--- a/...`), and what lets a pure rename (no hunk at all) pass by construction.
- **Created** `/Users/biran/code/skills/loop/Orca/tests/ledger/appendOnly.test.ts` — 8 tests, translated to English `it(...)` descriptions per the project's English-in-code convention (mapping table below). Logic, assertions, and Chinese test-input strings (`"串行"`, `"并行"`) are byte-identical to the brief.
- **Modified** `/Users/biran/code/skills/loop/Orca/.decisions/orca-dev-09cc3ea1.jsonl` — appended exactly 1 line (mechanically, via `grep`), file is now 12 lines, lines 1-11 unchanged.

No other files touched.

## RED evidence

Command:
```
npx vitest run tests/ledger/appendOnly.test.ts > /tmp/orca-t5-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t5-red.txt
```

Output (exit=1):
```
 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ❯ tests/ledger/appendOnly.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/ledger/appendOnly.test.ts [ tests/ledger/appendOnly.test.ts ]
Error: Failed to load url ../../src/ledger/appendOnly.js (resolved id: ../../src/ledger/appendOnly.js) in /Users/biran/code/skills/loop/Orca/tests/ledger/appendOnly.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

 Test Files  1 failed (1)
      Tests  no tests
exit=1
```

Matches the brief's expectation (module-resolution failure, `exit=1`) — message wording differs slightly ("Failed to load url" vs "Failed to resolve import") because of the vitest/vite version in this repo, but the failure mode (missing `appendOnly.js`) and exit code match exactly.

## GREEN evidence

Command:
```
npm test > /tmp/orca-t5-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t5-green.txt
```

Output (exit=0):
```
 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ✓ tests/ledger/undoExecutable.test.ts (10 tests) 3ms
 ✓ tests/smoke.test.ts (1 test) 1ms
 ✓ tests/ledger/appendOnly.test.ts (8 tests) 2ms
 ✓ tests/ledger/validateFile.test.ts (10 tests) 5ms
 ✓ tests/ledger/validateLine.test.ts (38 tests) 8ms

 Test Files  5 passed (5)
      Tests  67 passed (67)
exit=0
```

59 (prior) + 8 (new) = 67. Confirmed.

## Main-tree-untouched proof

```
git -C "$MAIN" diff > /tmp/orca-t5-fp-before.txt 2>&1; wc -c < /tmp/orca-t5-fp-before.txt   # => 0
... (clone, mutate, restore, three times) ...
git -C "$MAIN" diff > /tmp/orca-t5-fp-after.txt 2>&1; wc -c < /tmp/orca-t5-fp-after.txt     # => 0
diff /tmp/orca-t5-fp-before.txt /tmp/orca-t5-fp-after.txt; echo "fingerprint diff exit=$?"  # => 0
```

Both snapshots are empty (0 bytes, taken with `git diff` over tracked files, before `appendOnly.ts`/`appendOnly.test.ts` were tracked and before the ledger append — per the brief's note to snapshot at the very start/end of Step 5). `diff` between before/after is empty, exit=0. All mutation work happened in a `git clone --local` at `/private/tmp/.../scratchpad/mutant-task-5`, which was `rm -rf`'d at the end (confirmed by a final `ls` on it failing with "No such file or directory").

## Mutation evidence

All three run against the clone: `(cd "$MUT" && npx vitest run tests/ledger/appendOnly.test.ts)`.

Baseline in the clone (unmutated copy of the two new files) ran green first: 8/8 passed, exit=0 — establishing the clone's copies matched main before any mutation.

### M5-a — 检查 6 是死码

**Edit**: deleted the block
```ts
    if (line.startsWith("-")) {
      reasons.push(`non-append change to .decisions/**: ${line}`);
    }
```
from `$MUT/src/ledger/appendOnly.ts` (applied via a small Python script; `assert old in content` confirmed the exact block existed before removal).

**Command**: `(cd "$MUT" && npx vitest run tests/ledger/appendOnly.test.ts) > /tmp/orca-t5-m5a.txt 2>&1; echo "exit=$?"`

**Real output** (exit=1, 3 failed):
```
 × checkAppendOnly — spec §3.8 check 6 > rejects when a removal line is present 3ms
   → expected true to be false // Object.is equality
 × checkAppendOnly — spec §3.8 check 6 > deleting a line whose content starts with -- still counts as a removal 0ms
   → expected true to be false // Object.is equality
 × checkAppendOnly — spec §3.8 check 6 > rejection reports which line 0ms
   → expected rejection
```

**Named assertion visible**: "rejects when a removal line is present" (brief: `含删除行时拒绝`) — present and red, as required. Two other assertions also went red as an expected side effect (removal-detection is used by the "starts with `--`" case and the reasons-content case too); this does not weaken the evidence for the named one.

**Restore**: `cat "$MAIN/src/ledger/appendOnly.ts" > "$MUT/src/ledger/appendOnly.ts"; diff ...; echo "restore exit=$?"` → `restore exit=0`.

### M5-b — hunk 门控是死码

**Edit**: deleted the block
```ts
    if (!inHunk) {
      continue;
    }
```
from `$MUT/src/ledger/appendOnly.ts` (same assert-then-replace method).

**Command**: `(cd "$MUT" && npx vitest run tests/ledger/appendOnly.test.ts) > /tmp/orca-t5-m5b.txt 2>&1; echo "exit=$?"`

**Real output** (exit=1, 3 failed):
```
 × checkAppendOnly — spec §3.8 check 6 > pure append passes 5ms
   → expected { ok: false, …(1) } to deeply equal { ok: true }
 × checkAppendOnly — spec §3.8 check 6 > new file passes (--- /dev/null is not a removal line) 1ms
   → expected { ok: false, …(1) } to deeply equal { ok: true }
 × checkAppendOnly — spec §3.8 check 6 > the file header line --- a/... does not count as a removal 0ms
   → expected { ok: false, …(1) } to deeply equal { ok: true }
```
with received reason `"non-append change to .decisions/**: --- a/.decisions/run-7c.jsonl"` — the `---` header line got misread as a deletion, exactly the failure mode the gate exists to prevent.

**Named assertion visible**: "the file header line --- a/... does not count as a removal" (brief: `文件头的 --- a/… 不算删除行`) — present and red, as required.

**Restore**: `cat "$MAIN/src/ledger/appendOnly.ts" > "$MUT/src/ledger/appendOnly.ts"; diff ...; echo "restore exit=$?"` → `restore exit=0`.

### M5-c — 门控退化成跳过 ---

**Edit**: replaced the entire hunk-gate section
```ts
    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      continue;
    }
```
with the naive
```ts
    if (line.startsWith("---")) continue;
```
in `$MUT/src/ledger/appendOnly.ts`.

**Command**: `(cd "$MUT" && npx vitest run tests/ledger/appendOnly.test.ts) > /tmp/orca-t5-m5c.txt 2>&1; echo "exit=$?"`

**Real output** (exit=1, 1 failed, 7 passed):
```
 × checkAppendOnly — spec §3.8 check 6 > deleting a line whose content starts with -- still counts as a removal 3ms
   → expected true to be false // Object.is equality

 ❯ tests/ledger/appendOnly.test.ts:76:38
     74| ---{"ev":"decision"}
     75| `;
     76|     expect(checkAppendOnly(diff).ok).toBe(false);
```

**Named assertion visible**: "deleting a line whose content starts with -- still counts as a removal" (brief: `删掉一条内容以 -- 开头的行，仍然算删除`) — the *only* failure, exactly as the brief predicted (all 7 other assertions still pass under the naive `---`-skip since none of the other fixtures collide with it). This is the gate's proof of life: it fails precisely and only when the naive implementation replaces the real gate.

**Restore**: `cat "$MAIN/src/ledger/appendOnly.ts" > "$MUT/src/ledger/appendOnly.ts"; diff ...; echo "restore exit=$?"` → `restore exit=0`.

## Test-name mapping table (Chinese brief → English used)

| Chinese (brief) | English `it(...)` used |
|---|---|
| 纯追加通过 | pure append passes |
| 含删除行时拒绝 | rejects when a removal line is present |
| 新建文件通过（--- /dev/null 不是删除行） | new file passes (--- /dev/null is not a removal line) |
| 空 diff 通过 | empty diff passes |
| 纯改名通过——spec §3.7.1 的归档就是 git mv，内容一字不动 | pure rename passes — spec §3.7.1 archiving is just git mv, content unchanged |
| **文件头的 --- a/… 不算删除行** (M5-b target) | **the file header line --- a/... does not count as a removal** |
| **删掉一条内容以 -- 开头的行，仍然算删除** (M5-c target) | **deleting a line whose content starts with -- still counts as a removal** |
| 拒绝时报出是哪一行 | rejection reports which line |

(M5-a's target, `含删除行时拒绝`, is row 2: "rejects when a removal line is present".)

`describe(...)`: `checkAppendOnly — spec §3.8 检查 6` → `checkAppendOnly — spec §3.8 check 6`.

## Ledger append proof

```
sed -n '1,11p' before → /tmp/orca-t5-ledger-before.txt   (11 lines)
grep '^{"ev":' task-5-brief.md >> .decisions/orca-dev-09cc3ea1.jsonl
wc -l → 12
sed -n '1,11p' after → /tmp/orca-t5-ledger-after.txt
diff before after → exit=0
```

Appended line (verbatim, verified via `tail -1`):
```
{"ev":"bound","id":"orca-dev-09cc3ea1/2","note":"三层齐了：validateLine（检查1-4）／validateFile（检查5）／checkAppendOnly（检查6）"}
```

Matches the brief's Step 6 line exactly. First 11 lines byte-identical (diff exit=0); file is now 12 lines.

## Full suite confirmation

Ran once more after the ledger append, before commit:
```
npm test > /tmp/orca-t5-final-green.txt 2>&1; echo "exit=$?"
```
Result: `Test Files 5 passed (5)`, `Tests 67 passed (67)`, `exit=0`. This includes `tests/ledger/validateLine.test.ts` (38 tests) — Task 2's real-ledger regression test — which stayed green throughout; it was never touched.

## Self-review findings and concerns

- The naive-implementation comment block inside `appendOnly.ts` explains the hunk-gate rationale in English, matching the brief's Chinese comment 1:1 in meaning.
- `package-lock.json` appeared as an untracked file in `git status` before this task started and remains untracked; it was not staged or committed — not one of the three files this task owns.
- No concerns. RED, GREEN, all three mutations, ledger append, and main-tree fingerprint are all verified with real command output, none piped through a filter (`grep`/`tail`/`head`/`sed` were only used to produce input data or line-range snapshots into files that were then read back whole, not to filter verification-run output).
