# Task 2 Report: 事件 schema ＋ 单行校验的检查 1／2／4

## What was implemented

Files created (all new, per the brief):

- `src/ledger/types.ts` — `DECISION_KINDS`, `DECISION_SCOPES`, `ValidationResult` (three-state: ok / downgraded(tier 0) / rejected).
- `src/ledger/schema.ts` — `alternativeSchema`, `undoSchema`, `decisionEventSchema` (`.strict()`), `referenceEventSchema` (`.passthrough()`), `REFERENCE_EVENT_TYPES`.
- `src/ledger/validateLine.ts` — `validateLine(raw: string): ValidationResult`, dispatching on `ev` to `decisionEventSchema` or `referenceEventSchema`, rejecting invalid JSON, non-object JSON, and unknown `ev` values.
- `tests/ledger/validateLine.test.ts` — 33 tests covering checks 1, 2, 4, and the reference-event rule (decision /5). Code, comments, and `it(...)` descriptions translated to English per the project's English-in-code convention; logic, assertions, values, structure, and test count are unchanged from the brief.

Modified:

- `.decisions/orca-dev-09cc3ea1.jsonl` — appended exactly 2 lines (byte-identical to the brief, generated mechanically via `grep`), no existing line touched. File went from 8 to 10 lines.

No other files were touched. `package-lock.json` is a pre-existing untracked file from Task 1's skeleton commit, outside this task's file list, left alone.

## RED evidence

Command:
```
npx vitest run tests/ledger/validateLine.test.ts > /tmp/orca-t2-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-red.txt
```

Output (full file read back, not filtered):
```
exit=1

 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ❯ tests/ledger/validateLine.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/ledger/validateLine.test.ts [ tests/ledger/validateLine.test.ts ]
Error: Failed to load url ../../src/ledger/validateLine.js (resolved id: ../../src/ledger/validateLine.js) in /Users/biran/code/skills/loop/Orca/tests/ledger/validateLine.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
   Start at  21:37:53
   Duration  269ms (transform 24ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 45ms)
```

This is exactly the expected failure per the brief's Step 2 ("Failed to resolve import ... validateLine.js", exit=1) — the test file existed but its import target (`src/ledger/validateLine.ts`) did not yet exist.

## GREEN evidence

Command:
```
npx vitest run tests/ledger/validateLine.test.ts > /tmp/orca-t2-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-green.txt
```

Output:
```
exit=0

 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ✓ tests/ledger/validateLine.test.ts (33 tests) 7ms

 Test Files  1 passed (1)
      Tests  33 passed (33)
   Start at  21:38:16
   Duration  272ms (transform 29ms, setup 0ms, collect 36ms, tests 7ms, environment 0ms, prepare 31ms)
```

## Mutation evidence

Per CLAUDE.md Rule 15 and this task's mandated substitution for the brief's Step 5, all mutation was performed in a `git clone --local` copy at
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/cd28ef61-b463-4863-9a46-784b47aa1757/scratchpad/mutant-task-2`
(symlinked `node_modules`, with this task's uncommitted `src/ledger/*.ts` and `tests/ledger/validateLine.test.ts` copied in via `cat >`, each copy proven byte-identical via `diff ... ; echo exit=$?` — all four printed `exit=0`).

Baseline (clone, before any mutation):
```
npx vitest run tests/ledger/validateLine.test.ts  → exit=0, 33 tests passed
```

### M2-a — check 2 killed

Edit: in `schema.ts`, `alternatives: z.array(alternativeSchema).min(1),` → `alternatives: z.array(alternativeSchema),` (`.min(1)` removed).

Command: `(cd "$MUT" && npx vitest run tests/ledger/validateLine.test.ts) > /tmp/orca-t2-mut-a.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-mut-a.txt`

Failing output (real, unfiltered):
```
exit=1
 ❯ tests/ledger/validateLine.test.ts (33 tests | 1 failed) 10ms
   × validateLine — check 2: alternatives is non-empty and each entry has option and why_not > rejects when alternatives is an empty array (spec §3.5: not a decision) 4ms
     → expected 'ok' to be 'rejected' // Object.is equality
 Tests  1 failed | 32 passed (33)
```

Named assertion visible: **`rejects when alternatives is an empty array (spec §3.5: not a decision)`** — the exact assertion the brief's table names (`alternatives 为空数组时拒绝`).

Restore: `cat "$MAIN/src/ledger/schema.ts" > "$MUT/src/ledger/schema.ts"; diff "$MAIN/src/ledger/schema.ts" "$MUT/src/ledger/schema.ts"; echo "restore exit=$?"` → `restore M2-a exit=0`.

### M2-b — check 4 killed

Edit: in `schema.ts`, `kind: z.enum(DECISION_KINDS),` → `kind: z.string(),`.

Command: `(cd "$MUT" && npx vitest run tests/ledger/validateLine.test.ts) > /tmp/orca-t2-mut-b.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-mut-b.txt`

Failing output (real, unfiltered):
```
exit=1
 ❯ tests/ledger/validateLine.test.ts (33 tests | 1 failed) 11ms
   × validateLine — check 4: kind and scope whitelists > rejects kind outside the whitelist 4ms
     → expected 'ok' to be 'rejected' // Object.is equality
 Tests  1 failed | 32 passed (33)
```

Named assertion visible: **`rejects kind outside the whitelist`** — the exact assertion the brief's table names (`拒绝白名单外的 kind`).

Restore: same procedure → `restore M2-b exit=0`.

### M2-c — decision /5 killed

Edit: in `schema.ts`, `referenceEventSchema`'s trailing `.passthrough();` → `.strict();`.

Command: `(cd "$MUT" && npx vitest run tests/ledger/validateLine.test.ts) > /tmp/orca-t2-mut-c.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-mut-c.txt`

Failing output (real, unfiltered):
```
exit=1
 ❯ tests/ledger/validateLine.test.ts (33 tests | 1 failed) 12ms
   × validateLine — decision /5: reference events require only ev and id > accepts the bound example given verbatim in spec §3.3 (with note, and without at / run) 5ms
     → expected { verdict: 'rejected', …(1) } to deeply equal { verdict: 'ok' }
 - Expected
 + Received
   Object {
-    "verdict": "ok",
+    "reasons": Array [
+      "<root>: Unrecognized key(s) in object: 'note'",
+    ],
+    "verdict": "rejected",
   }
 Tests  1 failed | 32 passed (33)
```

Named assertion visible: **`accepts the bound example given verbatim in spec §3.3 (with note, and without at / run)`** — the exact assertion the brief's table names (`接受 spec §3.3 逐字给出的 bound 例子`), and the failure reason (`Unrecognized key(s) in object: 'note'`) confirms the mechanism (strict rejecting the passthrough `note` field), not a coincidental failure.

Restore: same procedure → `restore M2-c exit=0`.

## Main-tree-untouched proof

Fingerprint commands run BEFORE building the clone and AFTER all three mutations/restores + clone deletion:

Before:
```
git -C "$MAIN" diff | wc -c        → 0
git -C "$MAIN" diff --cached | wc -c → 0
git -C "$MAIN" status --porcelain  → ?? package-lock.json
                                      ?? src/
                                      ?? tests/ledger/
```

After:
```
git -C "$MAIN" diff | wc -c        → 0
git -C "$MAIN" diff --cached | wc -c → 0
git -C "$MAIN" status --porcelain  → ?? package-lock.json
                                      ?? src/
                                      ?? tests/ledger/
```

Identical in both byte counts and porcelain output — the main working tree was never touched by any mutation. (The clone directory itself was removed with `/bin/rm -rf` after use, as instructed — this only touched the scratchpad, never `$MAIN`.)

## Test-name mapping table (Chinese brief → English `it(...)` used)

Full mapping (all `describe`/`it` blocks):

| Brief's Chinese | English used |
|---|---|
| `describe`「检查 1：必填字段齐全」 | `validateLine — check 1: all required fields present` |
| 接受 spec §3.4 的完整 decision 例子 | accepts the complete decision example from spec §3.4 |
| 缺 `${field}` 时拒绝 | rejects when `${field}` is missing |
| 不是合法 JSON 时拒绝，且不抛异常 | rejects invalid JSON without throwing |
| ev 不认识时拒绝 | rejects unknown ev |
| `describe`「检查 2：alternatives 非空且每条含 option 与 why_not」 | `validateLine — check 2: alternatives is non-empty and each entry has option and why_not` |
| **alternatives 为空数组时拒绝（spec §3.5：这不是决策）** *(M2-a target)* | **rejects when alternatives is an empty array (spec §3.5: not a decision)** |
| alternatives 某条缺 why_not 时拒绝 | rejects when an alternatives entry is missing why_not |
| alternatives 某条的 why_not 是空串时拒绝 | rejects when an alternatives entry's why_not is an empty string |
| `describe`「检查 4：kind 与 scope 白名单」 | `validateLine — check 4: kind and scope whitelists` |
| 接受白名单内的 kind=`${kind}` | accepts whitelisted kind=`${kind}` |
| **拒绝白名单外的 kind** *(M2-b target)* | **rejects kind outside the whitelist** |
| 接受白名单内的 scope=`${scope}` | accepts whitelisted scope=`${scope}` |
| 拒绝白名单外的 scope | rejects scope outside the whitelist |
| 拒绝 decision 上的未知字段（与 ccloop 的 .strict() 同形） | rejects unknown fields on decision (matches ccloop's .strict() shape) |
| `describe`「决策 /5：引用事件只要求 ev 与 id」 | `validateLine — decision /5: reference events require only ev and id` |
| **接受 spec §3.3 逐字给出的 bound 例子（含 note，且没有 at / run）** *(M2-c target)* | **accepts the bound example given verbatim in spec §3.3 (with note, and without at / run)** |
| 接受只有 ev 与 id 的 superseded | accepts superseded with only ev and id |
| 接受只有 ev 与 id 的 overturned | accepts overturned with only ev and id |
| 引用事件缺 id 时拒绝 | rejects a reference event missing id |

(Bold rows are the three assertions the mutation table names.)

## Ledger append proof

Before appending, first 8 lines were captured to `/tmp/orca-t2-ledger-before8.txt` (`sed -n '1,8p'`), 8 lines confirmed by `wc -l`.

After appending (via `grep '^{"ev":' task-2-brief.md >> .decisions/orca-dev-09cc3ea1.jsonl`, which produced exactly 2 lines), first 8 lines captured again to `/tmp/orca-t2-ledger-after8.txt`.

```
diff /tmp/orca-t2-ledger-before8.txt /tmp/orca-t2-ledger-after8.txt > /tmp/orca-t2-ledger-diff.txt 2>&1; echo "exit=$?"
→ exit=0
```

`wc -l .decisions/orca-dev-09cc3ea1.jsonl` → `10`.

Lines 9-10 (`sed -n '9,10p'`) read exactly:
```
{"ev":"bound","id":"orca-dev-09cc3ea1/3","note":"ValidationResult 三态落在 src/ledger/types.ts"}
{"ev":"bound","id":"orca-dev-09cc3ea1/5","note":"referenceEventSchema 只钉 ev 与 id，passthrough 放行 note"}
```
— byte-identical to the brief's Step 6 block.

`git diff .decisions/orca-dev-09cc3ea1.jsonl` (captured before staging) additionally confirmed only two `+` lines were added at the end, with all prior lines shown as context (unmodified).

## Full-suite run before commit

```
npm test > /tmp/orca-t2-fullsuite.txt 2>&1; echo "exit=$?"
→ exit=0
 ✓ tests/smoke.test.ts (1 test)
 ✓ tests/ledger/validateLine.test.ts (33 tests)
 Test Files  2 passed (2)
      Tests  34 passed (34)
```

Also ran `npm run typecheck` → `exit=0`, no type errors.

## Commit

`3c31320 feat(ledger): 单行校验的检查 1/2/4` — 5 files changed, 245 insertions(+), 0 deletions. Message is verbatim from the brief (Chinese, intended) plus the required `Co-Authored-By` / `Claude-Session` trailers. Staged only the 5 files the brief lists; `package-lock.json` (pre-existing untracked file from Task 1) was left untouched and unstaged.

## Self-review findings

- All three mutations produced the specific named-assertion failure, not just "something went red" — verified by reading the actual failure text in each case, including the zod error message for M2-c which confirms the mechanism (rejecting `note` as an unrecognized key under `.strict()`).
- The mutation baseline in the clone was run and confirmed green before any mutation, satisfying the requirement that a red result only proves something if the pre-mutation state was known-green.
- No verification run was piped through `grep`/`tail`/`head`/`sed` — every verification command was redirected to a file and the file read back in full via `cat`. The only `grep` used was the brief's Step 6 ledger-generation command, which is file generation, not verification, per this task's own constraint 3.
- The main tree's fingerprint (unstaged diff bytes, staged diff bytes, porcelain status) was identical before and after the entire mutation exercise, confirming zero main-tree touch during fault injection.
- No concerns: the brief's code blocks matched the repo's actual state (Task 1's skeleton was present exactly as described, `zod` was installed, no `src/` existed yet), so no BLOCKED/NEEDS_CONTEXT condition arose.

---

## Fix round 1 (controller feedback)

### Finding 1 — `decisionEventSchema` rejected every real decision (evidence field)

Root cause: `.strict()` schema listed only the 11 required fields from spec §3.8 check 1, but every real `decision` line in `.decisions/orca-dev-09cc3ea1.jsonl` carries a 12th key, `evidence` (per spec §3.4's canonical example / §3.5.1's trustworthiness criterion).

Fix in `src/ledger/schema.ts` — added inside `decisionEventSchema`, immediately after `kind`:
```typescript
// Optional per spec §3.4's canonical example and §3.5.1 (evidence is how a
// decision's trustworthiness is judged); not one of the 11 required fields
// in §3.8 check 1, but legitimate. Fix round 1, finding 1.
evidence: z.array(z.string()).optional(),
```
`.strict()` was left untouched, as instructed.

### Finding 2 — added a regression test against the real ledger

Added to `tests/ledger/validateLine.test.ts`, new `describe("validateLine — regression: every real line in this repo's own ledger validates")` block with two tests:

1. **`has at least one line in the ledger fixture (guards against a wrong/empty path)`** — resolves the ledger path via `fileURLToPath(new URL("../../.decisions/orca-dev-09cc3ea1.jsonl", import.meta.url))`, reads it, filters empty lines, asserts `lines.length > 0`. This guards against the exact failure mode the controller flagged: a wrong or mis-resolved path silently producing zero lines and a vacuous pass.
2. **`accepts every non-empty line in .decisions/orca-dev-09cc3ea1.jsonl`** — runs `validateLine` over every non-empty line, collects any whose verdict is not `"ok"` with their 1-based line number and reasons, and on any failure throws an `Error` naming every offending line and its reasons (not a bare `toBe(true)`), so a future regression is diagnosable directly from the failure output rather than just "something broke."

Import additions: `import { readFileSync } from "node:fs";` and `import { fileURLToPath } from "node:url";`.

### Verification — covering test file

Command:
```
npx vitest run tests/ledger/validateLine.test.ts > /tmp/orca-t2-fix-green.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-fix-green.txt
```
Output (full, unfiltered):
```
exit=0

 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ✓ tests/ledger/validateLine.test.ts (35 tests) 7ms

 Test Files  1 passed (1)
      Tests  35 passed (35)
   Start at  22:13:10
   Duration  248ms (transform 34ms, setup 0ms, collect 39ms, tests 7ms, environment 0ms, prepare 43ms)
```
35 = the original 33 plus the 2 new regression tests.

### Verification — full suite

Command:
```
npm test > /tmp/orca-t2-fix-fullsuite.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-fix-fullsuite.txt
```
Output:
```
exit=0

> orca@0.1.0 test
> vitest run


 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ✓ tests/smoke.test.ts (1 test) 1ms
 ✓ tests/ledger/validateLine.test.ts (35 tests) 7ms

 Test Files  2 passed (2)
      Tests  36 passed (36)
   Start at  22:13:15
   Duration  267ms (transform 39ms, setup 0ms, collect 56ms, tests 8ms, environment 0ms, prepare 70ms)
```

### Verification — `confidence` strict-rejection assertion still green

Command:
```
npx vitest run tests/ledger/validateLine.test.ts -t "rejects unknown fields on decision" > /tmp/orca-t2-confidence-check.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-confidence-check.txt
```
Output:
```
exit=0

 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ✓ tests/ledger/validateLine.test.ts (35 tests | 34 skipped) 2ms

 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
   Start at  22:13:22
   Duration  247ms (transform 36ms, setup 0ms, collect 39ms, tests 2ms, environment 0ms, prepare 52ms)
```
Confirms `rejects unknown fields on decision (matches ccloop's .strict() shape)` — i.e. the `confidence` case — is still passing after adding `evidence`.

### Seen-red proof for the new regression test (clone-only mutation, per Rule 15)

Built a second `git clone --local` copy at `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/cd28ef61-b463-4863-9a46-784b47aa1757/scratchpad/mutant-task-2-fix` (same procedure as the Task 2 mutation round: symlinked `node_modules`, uncommitted `src/ledger/*.ts` + test file copied in via `cat >`, all four copies proven byte-identical via `diff ...; echo exit=$?` → all `exit=0`).

Fingerprint of the main tree BEFORE building the clone (fix was staged-but-uncommitted at this point):
```
git -C "$MAIN" diff | wc -c        → 2572
git -C "$MAIN" diff --cached | wc -c → 0
git -C "$MAIN" status --porcelain  → " M src/ledger/schema.ts"
                                       " M tests/ledger/validateLine.test.ts"
                                       "?? package-lock.json"
```

Baseline in the clone (with the fix applied) — green:
```
(cd "$MUT" && npx vitest run tests/ledger/validateLine.test.ts) → exit=0, 35 tests passed
```

Mutation: deleted the line `evidence: z.array(z.string()).optional(),` from `$MUT/src/ledger/schema.ts` (confirmed exactly 1 occurrence removed via a script assertion).

Command: `(cd "$MUT" && npx vitest run tests/ledger/validateLine.test.ts) > /tmp/orca-t2-fix-mut-red.txt 2>&1; echo "exit=$?"; cat /tmp/orca-t2-fix-mut-red.txt`

Real failing output:
```
exit=1
 ❯ tests/ledger/validateLine.test.ts (35 tests | 1 failed) 10ms
   × validateLine — regression: every real line in this repo's own ledger validates > accepts every non-empty line in .decisions/orca-dev-09cc3ea1.jsonl 3ms
     → 7 of 10 ledger lines did not validate:
line 1: verdict=rejected, reasons=["<root>: Unrecognized key(s) in object: 'evidence'"]
line 2: verdict=rejected, reasons=["<root>: Unrecognized key(s) in object: 'evidence'"]
line 3: verdict=rejected, reasons=["<root>: Unrecognized key(s) in object: 'evidence'"]
line 4: verdict=rejected, reasons=["<root>: Unrecognized key(s) in object: 'evidence'"]
line 5: verdict=rejected, reasons=["<root>: Unrecognized key(s) in object: 'evidence'"]
line 6: verdict=rejected, reasons=["<root>: Unrecognized key(s) in object: 'evidence'"]
line 7: verdict=rejected, reasons=["<root>: Unrecognized key(s) in object: 'evidence'"]
 Tests  1 failed | 34 passed (35)
```
This exactly reproduces the controller's originally reported symptom (lines 1-7 rejected on `evidence`, lines 8-10 ok) — proving the new regression test does catch this exact bug, not a coincidental failure.

Restore: `cat "$MAIN/src/ledger/schema.ts" > "$MUT/src/ledger/schema.ts"; diff "$MAIN/src/ledger/schema.ts" "$MUT/src/ledger/schema.ts"; echo "restore exit=$?"` → `restore exit=0`.

Fingerprint of the main tree AFTER (clone mutated/restored/removed):
```
git -C "$MAIN" diff | wc -c        → 2572   (identical)
git -C "$MAIN" diff --cached | wc -c → 0     (identical)
git -C "$MAIN" status --porcelain  → " M src/ledger/schema.ts"
                                       " M tests/ledger/validateLine.test.ts"
                                       "?? package-lock.json"   (identical)
```
Main tree confirmed untouched throughout the mutation exercise.

### Ledger untouched

Per instruction, `.decisions/orca-dev-09cc3ea1.jsonl` was not modified in this fix round — only `src/ledger/schema.ts` and `tests/ledger/validateLine.test.ts` were staged and committed (`git status --porcelain` before commit showed exactly those two `M` lines, plus the pre-existing untracked `package-lock.json` from Task 1, left alone).

### Commit

`00ccd07 fix(ledger): decisionEventSchema 放行 evidence 字段，补真实台账回归判据` — 2 files changed, 40 insertions(+), 0 deletions. New commit (not amended), on top of `3c31320`. Message in Chinese, same two trailers as the original Task 2 commit.
