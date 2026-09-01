# Task 7 Report — 写入方（fail closed）

Commit: `2141c90` — `feat(ledger): 写入方，落盘前先过校验器`

## What was implemented

- **Created** `src/ledger/writer.ts`: `appendEvent(decisionsDir, runId, event)`.
  - Validates `runId` against `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` before doing anything else
    (this is also what stops a run-id from escaping `decisionsDir` via `../`).
  - Serializes `event` with `JSON.stringify`, runs it through `validateLine` from Task 2/3.
  - Throws (without writing) if the verdict is `rejected` or `downgraded`.
  - Only on `ok`: `mkdir(decisionsDir, { recursive: true })`, then `appendFile` the line + `"\n"`.
- **Created** `tests/ledger/writer.test.ts`: 11 tests across 5 `describe` blocks (on-disk shape,
  fail-closed, run-id path safety × 5 cases, and the ledger-reproduction test).
- **Modified** `.decisions/orca-dev-09cc3ea1.jsonl`: appended exactly 1 line (the `bound` event
  for `orca-dev-09cc3ea1/7`), mechanically via `grep ... >>`. File is now 14 lines; lines 1-13
  are byte-identical to before (see proof below).

No other files were touched. `package-lock.json` was already untracked at task start (confirmed
in the very first `git status --porcelain` I ran) and is not part of this task's file list — left
alone, not staged, not committed.

## RED evidence (Step 2)

Command:
```
npx vitest run tests/ledger/writer.test.ts > /tmp/orca-t7-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t7-red.txt
```
Output (exit=1):
```
 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ❯ tests/ledger/writer.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/ledger/writer.test.ts [ tests/ledger/writer.test.ts ]
Error: Failed to load url ../../src/ledger/writer.js (resolved id: ../../src/ledger/writer.js) in /Users/biran/code/skills/loop/Orca/tests/ledger/writer.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
```
Matches the brief's expected failure exactly (`Failed to resolve/load ... writer.js`, exit=1).

## GREEN evidence (Step 4, before ledger append)

Command: `npm test > /tmp/orca-t7-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t7-green.txt`

Result: exit=0, `Test Files 7 passed (7)`, `Tests 89 passed (89)` — 78 previously-landed tests +
11 new writer tests. `tests/ledger/writer.test.ts (11 tests)` all green.

Typecheck: `npm run typecheck > /tmp/orca-t7-typecheck.txt 2>&1; echo "exit=$?"` → exit=0, clean.

GREEN again after Step 6's append (Step 4 command re-run): exit=0, `Test Files 7 passed (7)`,
`Tests 89 passed (89)`. Confirmed below in its own section.

## Test-name mapping table (Chinese brief → English used)

| Chinese (brief) | English `it(...)` used |
|---|---|
| 写到 `<dir>/<runId>.jsonl`，一行一条，行尾一个换行 | `writes to <dir>/<runId>.jsonl, one line per event, trailing newline` |
| 目录不存在时自动建出来 | `creates the directory automatically when it does not exist` |
| **校验器拒绝时抛错，且一个字都不写** (M7-c target) | **`throws when the validator rejects, and writes not one byte`** |
| **校验器降级时也抛错，且一个字都不写** (M7-b target) | **`throws when the validator downgrades, and writes not one byte`** |
| **拒绝非法 run-id: `"../escape"`** (and the other 4 bad values) (M7-a target) | **`` rejects an invalid run id: ${JSON.stringify(bad)} ``** → e.g. `rejects an invalid run id: "../escape"` |
| 接受合法 run-id: orca-dev-09cc3ea1 | `accepts a valid run id: orca-dev-09cc3ea1` |
| 写入方能复现本仓库自己那份手写台账 (describe) | `appendEvent can reproduce this repo's own hand-written ledger` |
| 逐行喂给 appendEvent，产出与 `.decisions/orca-dev-09cc3ea1.jsonl` 逐字相同 | `feeding each line through appendEvent reproduces .decisions/orca-dev-09cc3ea1.jsonl byte for byte` |

All test data (Chinese strings inside `validDecision`, e.g. `"用哪种锁"`, `"文件租约"`, `"回滚一下就好"`)
kept byte-identical to the brief — only descriptions/comments were translated, per project
constraint #1.

## Mutation evidence

All three mutations were run against a `git clone --local` copy at
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/cd28ef61-b463-4863-9a46-784b47aa1757/scratchpad/mutant-task-7`,
per the corrected procedure (writer.ts/writer.test.ts are untracked in main at mutation time, so
`git checkout --` cannot restore them). Main tree checksums are proven unchanged before and after
(see checksum section).

Baseline in the clone before any mutation: `npx vitest run tests/ledger/writer.test.ts` → exit=0,
`11 tests passed (11)`.

### M7-a — run-id validation is dead code

**Edit** (in the clone only): deleted
```ts
if (!RUN_ID.test(runId)) {
  throw new Error(`invalid run id: ${JSON.stringify(runId)}`);
}
```

**Command:**
```
(cd "$MUT" && npx vitest run tests/ledger/writer.test.ts) > /tmp/orca-t7-m7a.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t7-m7a.txt
```

**Result:** exit=1, 5 of 11 tests failed:
```
 × appendEvent — run-id path safety > rejects an invalid run id: "../escape" 5ms
     → promise resolved "undefined" instead of rejecting
 × appendEvent — run-id path safety > rejects an invalid run id: "a/b" 1ms
     → expected [Function] to throw error matching /run id/ but got 'ENOENT: no such file or directory, op…'
 × appendEvent — run-id path safety > rejects an invalid run id: ".hidden" 1ms
 × appendEvent — run-id path safety > rejects an invalid run id: "" 2ms
 × appendEvent — run-id path safety > rejects an invalid run id: "with space" 2ms
```

**Named assertion** (`rejects an invalid run id: "../escape"`) is visible in the failure list, red.

**Restore:** `cat "$MAIN/src/ledger/writer.ts" > "$MUT/src/ledger/writer.ts"` then
`diff "$MAIN/..." "$MUT/..."` → **restore exit=0**.

### M7-b — downgraded verdict is let through

**Edit** (in the clone only): deleted
```ts
if (result.verdict === "downgraded") {
  throw new Error(
    `refusing to append: downgraded to tier 0, this decision is not the agent's to make: ${result.reasons.join("; ")}`,
  );
}
```

**Command:**
```
(cd "$MUT" && npx vitest run tests/ledger/writer.test.ts) > /tmp/orca-t7-m7b.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t7-m7b.txt
```

**Result:** exit=1, 1 of 11 tests failed:
```
 × appendEvent — fail closed > throws when the validator downgrades, and writes not one byte 3ms
     → promise resolved "undefined" instead of rejecting
```

**Named assertion** (`throws when the validator downgrades, and writes not one byte`) is exactly
and only the one that failed. Red.

**Restore:** `cat "$MAIN/src/ledger/writer.ts" > "$MUT/src/ledger/writer.ts"` then
`diff` → **restore exit=0**.

### M7-c — write happens before validation

**Edit** (in the clone only): moved `mkdir`/`appendFile` to before `validateLine` is called
(kept the `const line = JSON.stringify(event)` computation ahead of the write, moved only the
validate-and-throw block to after the write):
```ts
const line = JSON.stringify(event);

await mkdir(decisionsDir, { recursive: true });
await appendFile(join(decisionsDir, `${runId}.jsonl`), `${line}\n`);

const result = validateLine(line);
if (result.verdict === "rejected") { throw new Error(...); }
if (result.verdict === "downgraded") { throw new Error(...); }
```

**Command:**
```
(cd "$MUT" && npx vitest run tests/ledger/writer.test.ts) > /tmp/orca-t7-m7c.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t7-m7c.txt
```

**Result:** exit=1, 2 of 11 tests failed:
```
 × appendEvent — fail closed > throws when the validator rejects, and writes not one byte 5ms
     → promise resolved "'{"ev":"decision","id":"fx/1","at":"20…'" instead of rejecting
 × appendEvent — fail closed > throws when the validator downgrades, and writes not one byte 1ms
     → promise resolved "'{"ev":"decision","id":"fx/1","at":"20…'" instead of rejecting
```

**Named assertion** (`throws when the validator rejects, and writes not one byte`) is in the
failure list, red.

**What the failure actually is (careful read, as the brief demanded):** in both failing cases the
failing expectation is the *second* one in the test body —
`await expect(readFile(join(dir, "fx.jsonl"), "utf8")).rejects.toThrow()`. It failed because
`readFile` *resolved* with the full JSON line instead of throwing ENOENT — i.e. the file now
exists on disk with content. The *first* expectation in each test,
`.rejects.toThrow(/rejected/)` / `.rejects.toThrow(/downgraded/)`, is **not** in the failure list —
`validateLine` still ran (after the write) and the function still threw the correct error. So the
throw itself did not stop happening; what broke is specifically the "not one byte written"
guarantee, which is exactly what M7-c's ordering change should break. This confirms the assertion
is pinning what it claims to pin (write-then-validate corrupts fail-closed), not something else.

**Restore:** `cat "$MAIN/src/ledger/writer.ts" > "$MUT/src/ledger/writer.ts"` then
`diff` → **restore exit=0**. Post-restore recheck in the clone:
`npx vitest run tests/ledger/writer.test.ts` → exit=0, `11 tests passed (11)`.

## Main-tree-untouched proof (checksums)

Before mutation testing:
```
01ef48f7fa62eecfd704d53dfda1a49c6347be3ff8af6ebee5a4000b5f7f7606  /Users/biran/code/skills/loop/Orca/src/ledger/writer.ts
12d5e383b5f058991103d8280ea8f2c6ad7edfac40c977b37518986aac10e0d5  /Users/biran/code/skills/loop/Orca/tests/ledger/writer.test.ts
```
(`/tmp/orca-t7-sha-before.txt`)

After all three mutations, restores, and reverification:
```
01ef48f7fa62eecfd704d53dfda1a49c6347be3ff8af6ebee5a4000b5f7f7606  /Users/biran/code/skills/loop/Orca/src/ledger/writer.ts
12d5e383b5f058991103d8280ea8f2c6ad7edfac40c977b37518986aac10e0d5  /Users/biran/code/skills/loop/Orca/tests/ledger/writer.test.ts
```
(`/tmp/orca-t7-sha-after.txt`)

`diff /tmp/orca-t7-sha-before.txt /tmp/orca-t7-sha-after.txt` → **exit=0** (byte-identical
checksums, main tree confirmed untouched by the mutation process). The clone directory
(`$MUT`) was deleted (`/bin/rm -rf`) after use.

## Reproduction test — stated explicitly

The test `appendEvent can reproduce this repo's own hand-written ledger > feeding each line
through appendEvent reproduces .decisions/orca-dev-09cc3ea1.jsonl byte for byte` reads the repo's
own real ledger file, `JSON.parse`s each line, feeds each parsed object through `appendEvent`
into a temp directory, and asserts the resulting file's full text is `===` to the real file's
full text (`toBe`, not a normalized/relaxed comparison).

- **Before Step 6's append** (13 lines, 10997 bytes): this test passed as part of the Step 4
  full-suite green run (`tests/ledger/writer.test.ts (11 tests)` all green, includes this one).
- **After Step 6's append** (14 lines): re-ran `npm test` again — still exit=0,
  `Tests 89 passed (89)`, including `tests/ledger/writer.test.ts (11 tests)`. The reproduction
  test re-reads the live file each run, so it exercised the 14-line file this second time and
  still passed byte-for-byte.

No normalization, relaxation, or ledger edits were needed or performed to make this test pass —
the writer's `JSON.stringify` output already matches the hand-written ledger's key order and
formatting exactly, both before and after the append.

## Ledger append proof (Step 6)

Commands and results:
```
sed -n '1,13p' .decisions/orca-dev-09cc3ea1.jsonl > /tmp/orca-t7-lines1-13-before.txt   # 13 lines, 10997 bytes
grep '^{"ev":"bound"' .superpowers/sdd/2026-08-29-decision-ledger-validator/task-7-brief.md >> .decisions/orca-dev-09cc3ea1.jsonl
wc -l .decisions/orca-dev-09cc3ea1.jsonl        # → 14
sed -n '1,13p' .decisions/orca-dev-09cc3ea1.jsonl > /tmp/orca-t7-lines1-13-after.txt
diff /tmp/orca-t7-lines1-13-before.txt /tmp/orca-t7-lines1-13-after.txt   # exit=0
```
Result: file is now **14 lines**; **lines 1-13 are byte-identical** (`diff` exit=0). New line 14:
```
{"ev":"bound","id":"orca-dev-09cc3ea1/7","note":"写入方落在 src/ledger/writer.ts：run-id 必填且过字符集校验，落盘前跑 validateLine，非 ok 抛错不写"}
```

## Full suite confirmation

Final `npm test` (after Step 6's append, before commit): exit=0, `Test Files 7 passed (7)`,
`Tests 89 passed (89)`. Final `npm run typecheck`: exit=0, clean.

Task 2's real-ledger regression test (`tests/ledger/validateFile.test.ts`, `ok: 1 ledger file(s)`
line in the test output) stayed green throughout — never touched, never weakened.

## Self-review findings / concerns

- The M7-c mutation, as specified in the brief ("move `appendFile` before `validateLine`"), was
  implemented by moving the entire validate-and-throw block after the write rather than moving
  only the `appendFile` call literally in place — this was necessary because `validateLine` needs
  `line` (computed before both), and the brief's own phrasing ("先写后校验") describes exactly this
  write-then-validate transformation. The resulting mutant is the one the brief's table names
  ("先写后校验"), and its red output matches the brief's warning almost exactly (throw still fires,
  but the file now exists).
- `package-lock.json` was untracked before this task started and remains untracked and uncommitted
  — not part of this task's scope, left alone per Rule 3 / instruction #7.
- No other files were touched. `git status --porcelain` before commit showed exactly the 3
  intended files (M/A/A) plus the pre-existing untracked `package-lock.json`, which was not
  staged.
- No concerns beyond the above; all mutation and reproduction evidence is real, captured
  unfiltered (`> file 2>&1; echo exit=$?; cat file` pattern throughout, no `grep`/`tail`/`head`
  piping of a verification run's output — the one `grep` used was Step 6's mechanical, spec-directed
  ledger append, not a test-verification run).
