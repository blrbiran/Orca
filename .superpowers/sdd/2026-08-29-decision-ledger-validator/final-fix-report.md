# Final fix wave — decision ledger validator branch

Dispatched against `main` at `f7af633` (89/89 tests, `tsc --noEmit` clean, `npm run verify` exit 0).
This is the only fix wave; a scoped re-review follows this report, not another fix round.

All commands below were run for real in this session; outputs are pasted verbatim from files
under `/tmp/orca-fin-*.txt` (never through a pipe that could swallow an exit code — every
verification run was redirected to a file, then the whole file was read back).

---

## Fix 1 — `src/ledger/writer.ts`: check 5 wired into the write path

### What changed

`appendEvent` now, after the existing `validateLine` screen (checks 1/2/3/4, unchanged
behaviour), reads the target file (a missing file counts as empty), builds the prospective
full contents `[...existingLines, newLine]`, and runs `validateFile` on it. Any non-`ok`
verdict throws before a single byte is written. `validateFile` is now imported in
`src/ledger/writer.ts`.

The consequence flagged in the brief — a streaming writer cannot see the future, so writing a
`bound` before its `decision` now throws, even though `validateFile` on those same two lines in
that order still returns `ok` (spec §3.8 check 5 asks for existence, not order) — is documented
both in a code comment and pinned by an explicit test (see below), so the asymmetry is an
assertion, not a comment on its own.

### Covering tests (`tests/ledger/writer.test.ts`)

- `throws when a bound references an id with no matching decision in the file (a typo, not
  fixable in place)` — the exact repro from the brief (`appendEvent(dir, "probe", {ev:"bound",
  id:"probe/999", note:"typo"})`), asserts it rejects and that zero bytes were written.
- `passes once the referenced decision has actually been appended first` — the normal,
  in-order case still works.
- `writing a bound before its decision throws, even though validateFile accepts that same
  order` — one test, both halves: `appendEvent` on the out-of-order pair throws; `validateFile`
  given the identical two lines in the identical order returns `ok`.

### Commands and real output

```
$ npx vitest run tests/ledger/writer.test.ts
 ✓ tests/ledger/writer.test.ts (14 tests) 45ms
```//(full run, see "Full suite" section below for the whole-repo number)

### Mutation proof (in `git clone --local` clone only, never the main tree)

Mutation: `if (prospective.verdict !== "ok")` → `if (false && prospective.verdict !== "ok")`
(the check-5 widening becomes dead code).

Real failing output:
```
 ❯ tests/ledger/writer.test.ts (14 tests | 2 failed) 23ms
   × appendEvent — check 5: a reference event's id must exist as a decision > throws when a
     bound references an id with no matching decision in the file (a typo, not fixable in
     place)
     → promise resolved "undefined" instead of rejecting
   × appendEvent — check 5: a reference event's id must exist as a decision > writing a bound
     before its decision throws, even though validateFile accepts that same order
     → promise resolved "undefined" instead of rejecting
 Test Files  1 failed (1)
      Tests  2 failed | 12 passed (14)
exit=1
```
Both check-5 tests went red, and only those two — the pre-existing 12 stayed green, confirming
the mutation's blast radius matches the fix's actual surface.

Restore proof: `cat` from `$MAIN/src/ledger/writer.ts` over the mutated clone file, `diff` exit
0, then re-ran the same test file: 14/14 green again.

### Dogfood closure — still green

`tests/ledger/writer.test.ts`'s `appendEvent can reproduce this repo's own hand-written ledger`
test (feeding every line of `.decisions/orca-dev-09cc3ea1.jsonl` through `appendEvent` and
asserting byte-for-byte identity with the file on disk) passed in every run of the full suite in
this session (baseline, after each mutation restore, and the final run — all "Test Files 7
passed (7)" / "Tests 98 passed (98)"). All 14 prefixes of that file validate `ok` in order (each
`bound` line references a `decision` id that was appended earlier in the same file), so widening
the writer to check 5 does not touch this test's outcome.

---

## Fix 2 — `src/ledger/appendOnly.ts`: no-trailing-newline exemption

### What changed

`checkAppendOnly` now looks one and two lines ahead of every `-` line inside a hunk. If the very
next line is exactly `\ No newline at end of file` and the line after that is a `+` line whose
content (everything after the marker character) is byte-identical to the `-` line's content, the
`-` line is treated as part of an append (git's way of saying "this line's bytes didn't change,
only the trailing newline got added") and is not counted as a removal. Any content difference
between the `-` and the following `+` line still counts as a removal and is rejected — the
exemption is exactly this narrow, gated on `nextLine.slice(1) === line.slice(1)`.

### Covering tests (`tests/ledger/appendOnly.test.ts`)

- `byte-identical content across a no-newline marker is an append, not a removal` — reproduces
  the brief's exact diff shape and expects `{ ok: true }`.
- `content that differs across a no-newline marker is still a removal and is rejected` — same
  shape but the `+` line's JSON is tampered (`"tampered":true` added); expects `.ok === false`.

### Commands and real output

```
$ npx vitest run tests/ledger/appendOnly.test.ts
 ✓ tests/ledger/appendOnly.test.ts (10 tests) 3ms
```

### Mutation proofs (in the clone)

**Mutation A** — delete the exemption entirely (`isNoNewlineAppend = false`), targeting the
legitimate-case test:
```
 ❯ tests/ledger/appendOnly.test.ts (10 tests | 1 failed) 7ms
   × checkAppendOnly — a ledger with no trailing newline must not be permanently wedged >
     byte-identical content across a no-newline marker is an append, not a removal
     → expected { ok: false, …(1) } to deeply equal { ok: true }
 Tests  1 failed | 9 passed (10)
exit=1
```
Restored (`diff` exit 0), re-ran: 10/10 green.

**Mutation B** — drop only the byte-identity clause (`nextLine.slice(1) === line.slice(1)`),
targeting the hostile-case test:
```
 ❯ tests/ledger/appendOnly.test.ts (10 tests | 1 failed) 6ms
   × checkAppendOnly — a ledger with no trailing newline must not be permanently wedged >
     content that differs across a no-newline marker is still a removal and is rejected
     → expected true to be false
 Tests  1 failed | 9 passed (10)
exit=1
```
Note this mutation reddened exactly one test (the hostile case) and left the legitimate-case
test green — confirming the two tests are independent and each pins its own half of the
narrowness requirement. Restored (`diff` exit 0), re-ran: 10/10 green.

---

## Fix 3 — the gate ships armed by default, and a silent miss is loud

### What changed

- `package.json` gained a `prepare` script:
  `git rev-parse --git-dir >/dev/null 2>&1 && git config core.hooksPath scripts/githooks || true`.
  npm runs `prepare` automatically after `npm install`, arming the hook by default. Parsed as
  `(A && B) || true`: if there's no git repo (or no `git` binary at all — command-not-found also
  makes `A` fail), the whole expression still exits 0 via the trailing `|| true`. Verified
  directly (see below).
- New `scripts/check-hooks-path.mjs`: reads `git config core.hooksPath`, exits 0 with
  `ok: core.hooksPath is scripts/githooks` if it matches, otherwise writes to stderr the actual
  value, states the gate is disarmed (naming spec §3.8 check 6), names the fix command
  (`npm run hooks:install`), and sets `process.exitCode = 1`.
- `npm run verify` now runs this script as its last step.
- `hooks:install` is untouched — still the manual escape hatch.

### Commands and real output

**No-op outside a git repo / without triggering an error** (run directly in a fresh non-repo
scratch directory, not the main tree or the clone):
```
$ cd <scratch non-git dir>
$ git rev-parse --git-dir >/dev/null 2>&1 && git config core.hooksPath scripts/githooks || true
$ echo "exit=$?"
exit=0
```

**Fails loud in a fresh clone before `prepare` runs** (the clone's local git config starts
empty — `core.hooksPath` is not tracked content, so a `git clone --local` reproduces exactly the
"fresh clone" scenario the finding describes):
```
$ git config core.hooksPath; echo "exit=$?"
exit=1
$ node scripts/check-hooks-path.mjs; echo "exit=$?"
core.hooksPath is "", expected "scripts/githooks".
The pre-commit gate (spec §3.8 check 6) is disarmed on this machine.
Fix: npm run hooks:install
exit=1
```

**`npm run prepare` arms it**:
```
$ npm run prepare
> git rev-parse --git-dir >/dev/null 2>&1 && git config core.hooksPath scripts/githooks || true
exit=0
$ git config core.hooksPath
scripts/githooks
$ node scripts/check-hooks-path.mjs
ok: core.hooksPath is scripts/githooks
exit=0
```

**`npm run verify` in that same clone, now armed, end to end**:
```
...
> orca@0.1.0 ledger
> tsx src/cli.ts validate .decisions

ok: 1 ledger file(s)
ok: CLAUDE.md is 135/200 lines
ok: core.hooksPath is scripts/githooks
exit=0
```

In the main repo, `core.hooksPath` was already `scripts/githooks` before this fix wave (someone
had already run `hooks:install`), so `npm run verify` there also passes; see "Full verify"
below.

No mutation was run for this fix — it is a deployment/config assertion, not a branch inside a
pure function, so "delete the assertion and watch a specific test go red" doesn't apply the same
way; instead the clone's naturally-unset `core.hooksPath` served as the real-world negative case
and the real script was run against it (shown above), which is a stronger proof than a
synthetic mutation would have been.

---

## Fix 4 — single source of truth for the reference-event-name list

### What changed

- `src/ledger/schema.ts`: `REFERENCE_EVENT_TYPES = ["bound", "superseded", "overturned"] as
  const` is now declared once, above `referenceEventSchema`, and `referenceEventSchema`'s
  `z.enum(...)` consumes it directly (`z.enum(REFERENCE_EVENT_TYPES)`) instead of repeating the
  literal array.
- `src/ledger/validateFile.ts`: imports `REFERENCE_EVENT_TYPES` from `./schema.js` and builds
  `REFERENCE_EVENTS = new Set<string>(REFERENCE_EVENT_TYPES)` from it, instead of its own
  independent `new Set(["bound", "superseded", "overturned"])`.

Behaviour is unchanged by construction — both consumers now read the exact same three strings
from the exact same array — and this is confirmed by every existing test in
`tests/ledger/schema`-adjacent files (`validateLine.test.ts`, `validateFile.test.ts`) staying
green with no changes to those test files.

`validateLine.ts`'s own `ev === "bound" || ev === "superseded" || ev === "overturned"` routing
check was deliberately left untouched — the brief named exactly three copies (the unused export,
the inlined zod enum, and `validateFile.ts`'s `REFERENCE_EVENTS`), and `validateLine.ts`'s
routing condition wasn't one of them. Touching it would be outside this finding's scope
(CLAUDE.md Rule 3).

### Commands and real output

Covered by the same full-suite run as everything else — see "Full suite" below. No new test was
added for this fix; the brief asks only that behaviour not change, and the existing 89 tests
touching `referenceEventSchema` and `validateFile`'s check 5 already exercise both consumers of
the now-shared constant.

---

## Fix 5 — CLI: an empty validation must not read as "ok"

### What was picked and why

**Exit non-zero on zero files** (return `1`), not a reworded message. Rationale: CI gates on
exit code, not on parsing stdout text for the substring "ok". A wording-only fix would still let
a silently-empty scan pass any script that checks `$?`. Making the exit code itself non-zero is
what actually stops the empty-green failure mode from propagating into an automated gate; the
stderr message additionally names what happened for a human reading the log
(`error: 0 ledger files found — nothing was validated`).

### What changed

`src/cli.ts`'s `runValidate`: after the existing `sawRejected` / `sawDowngraded` checks, if
`files.length === 0`, write the error line to stderr and return `1` instead of printing
`ok: 0 ledger file(s)` and returning `0`.

### Covering test (`tests/cli/cli.test.ts`)

`returns 1 when a directory contains no .jsonl files (an empty check must not read as a pass)` —
creates a fresh empty temp directory and asserts `main(["validate", emptyDir])` returns `1`.

### Commands and real output

```
$ npx vitest run tests/cli/cli.test.ts
 ✓ tests/cli/cli.test.ts (12 tests) 1059ms
```

### Mutation proof (in the clone)

Mutation: delete the `if (files.length === 0) { ...; return 1; }` block entirely, falling
straight through to the old `ok: N ledger file(s)` / `return 0`.

Real failing output:
```
 ❯ tests/cli/cli.test.ts (12 tests | 1 failed) 896ms
   × main — validate exit codes > returns 1 when a directory contains no .jsonl files (an empty
     check must not read as a pass)
     → expected +0 to be 1
 Tests  1 failed | 11 passed (12)
exit=1
```
Exactly the intended test failed and nothing else (the "real process exit code" subprocess tests
were unaffected, since they exercise `rejected.jsonl` / `ok.jsonl`, not an empty directory).
Restored (`diff` exit 0), re-ran: 12/12 green.

---

## Fix 6 — `src/ledger/undoExecutable.ts`: named mutation per `isArgShaped` sub-branch

### What changed

Only `tests/ledger/undoExecutable.test.ts` changed — the predicate itself (`isArgShaped`) was
already correct; the finding was about missing coverage, not a bug. Added one assertion per
input from the brief's table, each with a comment re-deriving (independently) why it reaches
only that one `isArgShaped` clause and why `hasNamedTarget` cannot also catch it:

- `make target=foo` → exercises `token.includes("=")` only.
- `rm *.tmp` → exercises `token.includes("*")` only.
- `node build.mjs` → exercises `FILE_NAME.test(token)` only.

I independently re-derived the exclusivity claim from the brief before trusting it (rather than
just citing the table): for all three inputs, the second token has no `-` prefix and no `/`, so
`isArgShaped`'s earlier clauses (`startsWith("-")`, `includes("/")`) never fire first; and none
of the three `how` strings contains a camelCase or snake_case identifier or a `/`, so
`hasNamedTarget`'s `NAMED_TARGET` regex cannot independently make the overall predicate true —
confirmed for real by the mutation runs below (each mutation reddened exactly one test, meaning
no other clause was silently also making that input pass).

### Commands and real output

```
$ npx vitest run tests/ledger/undoExecutable.test.ts
 ✓ tests/ledger/undoExecutable.test.ts (13 tests) 3ms
```

### Mutation proofs (in the clone, one at a time, each restored before the next)

**M-eq** — delete `token.includes("=") ||` from `isArgShaped`:
```
 ❯ tests/ledger/undoExecutable.test.ts (13 tests | 1 failed) 7ms
   × ... > command-shape via a '=' argument: make target=foo
     → expected false to be true
 Tests  1 failed | 12 passed (13)
exit=1
```
Restored, `diff` exit 0.

**M-star** — delete `token.includes("*") ||`:
```
 ❯ tests/ledger/undoExecutable.test.ts (13 tests | 1 failed) 6ms
   × ... > command-shape via a '*' argument: rm *.tmp
     → expected false to be true
 Tests  1 failed | 12 passed (13)
exit=1
```
Restored, `diff` exit 0.

**M-filename** — delete `FILE_NAME.test(token)` (and the now-dangling `||`):
```
 ❯ tests/ledger/undoExecutable.test.ts (13 tests | 1 failed) 6ms
   × ... > command-shape via a FILE_NAME argument: node build.mjs
     → expected false to be true
 Tests  1 failed | 12 passed (13)
exit=1
```
Restored, `diff` exit 0.

Each mutation reddened exactly one test and left the other 12 (including the other two new
ones) green, confirming the three inputs are mutually exclusive across the three sub-branches as
claimed, and none is caught by `hasNamedTarget`.

---

## Checksum proof — main working tree never touched by mutation testing

All mutations above were applied only inside a `git clone --local` copy at
`/private/tmp/claude-501/.../scratchpad/mutant-final`, restored from the main tree via `cat`
after every mutation, and the clone was deleted (`/bin/rm -rf`) once all mutation testing was
done. `git diff`/`git status` were not relied on for this proof (an untracked new file's content
is invisible to `git diff`) — a `shasum -a 256` fingerprint of every file this session touched
was taken before the mutation phase and after it, and diffed:

```
$ diff /tmp/orca-fin-sha-before.txt /tmp/orca-fin-sha-after.txt; echo "checksum diff exit=$?"
checksum diff exit=0
```

Empty diff, exit 0 — every touched file (`src/ledger/writer.ts`, `src/ledger/appendOnly.ts`,
`src/ledger/schema.ts`, `src/ledger/validateFile.ts`, `src/cli.ts`,
`src/ledger/undoExecutable.ts`, `package.json`, `scripts/check-hooks-path.mjs`,
`tests/ledger/writer.test.ts`, `tests/ledger/appendOnly.test.ts`,
`tests/ledger/undoExecutable.test.ts`, `tests/cli/cli.test.ts`) has byte-identical content
before and after the whole mutation-testing phase.

---

## Full suite, typecheck, and verify — final state of the main tree

```
$ npx vitest run
 ✓ tests/smoke.test.ts (1 test)
 ✓ tests/ledger/appendOnly.test.ts (10 tests)
 ✓ tests/ledger/undoExecutable.test.ts (13 tests)
 ✓ tests/ledger/validateFile.test.ts (10 tests)
 ✓ tests/ledger/validateLine.test.ts (38 tests)
 ✓ tests/ledger/writer.test.ts (14 tests)
 ✓ tests/cli/cli.test.ts (12 tests)
 Test Files  7 passed (7)
      Tests  98 passed (98)
exit=0
```
(89 tests before this wave, +9 new: writer.test.ts 11→14 (+3: typo case, in-order case,
asymmetry case), appendOnly.test.ts 8→10 (+2: legitimate case, hostile case), cli.test.ts 11→12
(+1: empty-directory case), undoExecutable.test.ts 10→13 (+3: the three isArgShaped
sub-branches). 89 + 9 = 98.)

```
$ npx tsc --noEmit -p tsconfig.json
exit=0
```

```
$ npm run verify
...
 Test Files  7 passed (7)
      Tests  98 passed (98)
> orca@0.1.0 ledger
> tsx src/cli.ts validate .decisions
ok: 1 ledger file(s)
ok: CLAUDE.md is 135/200 lines
ok: core.hooksPath is scripts/githooks
exit=0
```

Dogfood reproduction test (`appendEvent can reproduce this repo's own hand-written ledger`
inside `tests/ledger/writer.test.ts`) is included in every one of the runs above and passed in
all of them.

---

## Concerns

- Fix 4 touched only the 3 spots the brief explicitly named (`REFERENCE_EVENT_TYPES` in
  `schema.ts`, the inlined zod enum, and `validateFile.ts`'s `REFERENCE_EVENTS`).
  `validateLine.ts`'s own `ev === "bound" || ev === "superseded" || ev === "overturned"` routing
  condition is a 4th place that logically encodes the same list and was left as-is per Rule 3
  (touch only what was asked). If a future reference-event type is ever added, this routing
  condition would still need to be updated by hand alongside the new shared constant — flagging
  this for cleanup rather than acting on it, since it wasn't in scope for this wave.
- Fix 3's `prepare` script silently no-ops if `git config core.hooksPath` itself fails for a
  reason other than "not a git repo" (e.g. a permissions problem on `.git/config` while inside a
  real repo) — the `|| true` swallows that too. This is intentional per the brief ("must not
  break an install... make it a no-op") and is exactly why `npm run verify`'s loud assertion
  exists as a second, independent check; flagging it so the reviewer knows the division of labor
  is deliberate, not an oversight.
- No other concerns. All six fixes are covered by tests, the mandated mutations (Fixes 1, 2, 5,
  6) were run for real against the actual code with restore proofs, and the full suite /
  typecheck / verify all pass cleanly in the main tree.

---

## Fix 7 (post-wave) — writer.ts × Fix 1/Fix 2 intersection: missing separator corrupted the append

Dispatched after the scoped re-review of the six fixes above found this defect and the human
authorised acting on it immediately rather than deferring to a further round.

### The defect, confirmed

`appendEvent` wrote `line + "\n"` unconditionally via `appendFile`, which only concatenates
bytes — it does not insert a separator. If the target file's last byte was not `"\n"` (the shape
Fix 2's own `checkAppendOnly` exemption establishes as ordinary for a hand-written or
externally-trimmed ledger, per spec §9.2), the new record landed glued onto the end of the
previous line. `appendEvent` reported success while producing a physically-one-line file that
`validateFile` rejects as unparseable JSON — the exact append-only deadlock Fix 1 exists to
prevent, reached through a different door: no sanctioned repair exists for a corrupt line in an
append-only file.

The second half of the finding: the pre-fix check-5 step validated
`[...existingText.split("\n"), line]`, which models the file as if a separator were already
there between the last existing line and the new one. When the file did not end in a newline,
that split-based model did not match the bytes `appendFile` was about to write — so the
guarantee could return `ok` for a file shape that would never actually exist on disk.

### What changed (`src/ledger/writer.ts`)

After reading `existingText` (a missing file still counts as empty, unchanged from Fix 1):

```ts
const separator = existingText.length > 0 && !existingText.endsWith("\n") ? "\n" : "";
const payload = `${separator}${line}\n`;

const prospective = validateFile((existingText + payload).split("\n"));
if (prospective.verdict !== "ok") { /* throw, unchanged */ }

await mkdir(decisionsDir, { recursive: true });
await appendFile(filePath, payload);
```

`payload` is now the single value both (a) folded into what check 5 validates
(`existingText + payload`) and (b) the exact bytes handed to `appendFile` — by construction, not
by convention, so the two can never drift apart. This holds in every case:

- **empty/absent file** — `existingText.length === 0` ⇒ `separator === ""` ⇒ unchanged from
  before this fix (confirmed by the dogfood test and the "does not insert a separator..." test
  below, both of which start from a fresh temp dir).
- **file already ending in `"\n"`** — `existingText.endsWith("\n")` ⇒ `separator === ""` ⇒
  unchanged; this is the normal sequential-append case, since every `payload` this function
  itself ever writes ends in `"\n"`.
- **file not ending in `"\n"`** — `separator === "\n"` ⇒ the new record is pushed onto its own
  line before being appended.

### Covering tests (`tests/ledger/writer.test.ts`)

- `inserts a separating newline so the appended record lands on its own line, and what is on
  disk validates ok` — seeds a file directly with `writeFile` (not through `appendEvent`, so its
  last byte is genuinely not `"\n"`), calls `appendEvent` to append a `bound` referencing that
  seeded decision, then reads the file back from disk and asserts: exactly two physical lines
  (`onDisk.split("\n").filter(l => l.length > 0)` has length 2), each independently
  `JSON.parse`-able, first line's `id` is `"probe/1"`, second line's `ev` is `"bound"`, and
  `validateFile(onDisk.split("\n"))` — run against the actual bytes read back from disk, not
  against anything passed into `appendEvent` — returns `ok`.
- `does not insert a separator when the existing file already ends with a newline (normal,
  sequential appends are untouched)` — two ordinary sequential `appendEvent` calls from a fresh
  directory; asserts no blank line was introduced (`onDisk` does not contain `"\n\n"`) and there
  are still exactly two physical lines.

### Commands and real output

```
$ npx vitest run tests/ledger/writer.test.ts
 ✓ tests/ledger/writer.test.ts (16 tests) 26ms
```

### Mutation proof (in a fresh `git clone --local` copy, never the main tree)

Set up: cloned `main` (HEAD at the prior commit, `9486af3`), copied in the two files this fix
touched (`src/ledger/writer.ts`, `tests/ledger/writer.test.ts`) from the main tree, `diff`
confirmed byte-identical copies, baseline run confirmed 16/16 green before mutating.

Mutation: `const separator = existingText.length > 0 && !existingText.endsWith("\n") ? "\n" :
"";` → `const separator = ""; // MUTATION: separator logic deleted` — the missing-newline case
degenerates back to the pre-fix, unconditional-concatenation behaviour.

Real failing output:
```
 ❯ tests/ledger/writer.test.ts (16 tests | 1 failed) 25ms
   × appendEvent — a missing trailing newline must not corrupt the append (scoped re-review
     finding) > inserts a separating newline so the appended record lands on its own line, and
     what is on disk validates ok
     → refusing to append: rejected: not valid JSON: Unexpected non-whitespace character after
       JSON at position 282 (line 1 column 283)
 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
exit=1
```
This is the corruption manifesting exactly as described — a JSON parse failure on the merged
bytes — and nothing else in the suite was affected (15/16 stayed green, including the "does not
insert a separator..." test, confirming the mutation's blast radius matches only the
missing-newline path). Note it surfaces as a thrown rejection from `appendEvent` rather than a
failed assertion on bytes read back from disk: because check 5 validates the exact prospective
bytes (`existingText + payload`), the same corruption that used to land on disk undetected is
now caught and thrown before a single byte is written — a stronger outcome than the pre-fix
report showed (silent success + corrupt file on disk), consistent with this fix tying validation
to the literal output bytes.

Restore proof:
```
$ diff "$MAIN/src/ledger/writer.ts" "$MUT/src/ledger/writer.ts"; echo "restore diff exit=$?"
restore diff exit=0
$ npx vitest run tests/ledger/writer.test.ts
 ✓ tests/ledger/writer.test.ts (16 tests) 20ms
```
Full suite also re-confirmed green in the clone after restoring (100/100), then the clone was
deleted (`/bin/rm -rf`).

### Checksum proof — main tree untouched by this mutation

```
$ shasum -a 256 src/ledger/writer.ts tests/ledger/writer.test.ts > /tmp/orca-fix7-sha-before.txt
# ... clone created, files copied in, mutated, restored, clone deleted ...
$ shasum -a 256 src/ledger/writer.ts tests/ledger/writer.test.ts > /tmp/orca-fix7-sha-after.txt
$ diff /tmp/orca-fix7-sha-before.txt /tmp/orca-fix7-sha-after.txt; echo "checksum diff exit=$?"
checksum diff exit=0
```

### Full suite, typecheck, verify — final state after Fix 7

```
$ npx vitest run
 Test Files  7 passed (7)
      Tests  100 passed (100)
exit=0

$ npx tsc --noEmit -p tsconfig.json
exit=0

$ npm run verify
...
ok: 1 ledger file(s)
ok: CLAUDE.md is 135/200 lines
ok: core.hooksPath is scripts/githooks
exit=0
```

The dogfood reproduction test (`appendEvent can reproduce this repo's own hand-written ledger`)
is included in every run above and passed in all of them — it seeds from an empty temp directory
on every call, so `separator` is always `""` there and its output bytes did not move.

### Concerns

None beyond what was already flagged for the prior six fixes. This fix is strictly additive to
Fix 1's write path and does not touch Fix 2, Fix 3, Fix 4, Fix 5, or Fix 6's code.
