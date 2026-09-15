# Task 4 — independent mutation verification report

Repo `/Users/biran/code/skills/loop/Orca`, commit under test **def1204**
(`def120468ce5bd0218942e516f342124469a4805`). Verifier did not write this code (Task 4 report:
`.superpowers/sdd/2026-09-10-panel-e3/task-4-report.md`); this report only measures whether the
brief's criteria go red, per CLAUDE.md Rules 9/14/15/17.

## Pre-flight

`/usr/bin/git status --porcelain -z > f; wc -c < f` → **52 bytes**, decoded (python3, NUL-split):
exactly one entry, `' M .superpowers/sdd/2026-09-10-panel-e3/progress.md'`. Nothing under `src/`,
`tests/`, `web/`, `.decisions/` was dirty.
`/usr/bin/git rev-parse HEAD` → `def120468ce5bd0218942e516f342124469a4805`.
`ls -la ~/.orca` → `ls: /Users/biran/.orca: No such file or directory`.

## Baseline (unmutated clone, def1204)

Clone + checkout + symlinked `node_modules`/`web/node_modules`, then
`./node_modules/.bin/vitest run tests/panel`. RUN line pointed into the clone's tmp path.

```
Test Files  5 passed (5)
     Tests  32 passed (32)
RC=0
```

All green, as required before mutating. Files run: `workspace.test.ts` (5), `staticFiles.test.ts` (8),
`usage.test.ts` (1), `security.test.ts` (9, including both real-process criteria — 402ms and 371ms),
`reviewsStore.test.ts` (9). Process census: 5 new lines after vs before, 0 matching `src/cli.ts`/`tsx`.
`ls ~/.orca` before and after: absent. `cmp` of both criterion files (clone vs main tree): identical
(rc 0) both before and after mutating in every subsequent run (never touched — see per-mutation
`cmp1_rc=0` / `cmp2_rc=0` below).

Harness for every mutation below: one `run_mutation.sh <ID> <target-file> <mutation-script>`
invocation per row — fresh `git clone --local`, `checkout --quiet def1204`, symlinked
`node_modules`, python edit script with an exactly-once anchor assertion (non-zero exit on 0 or ≥2
matches — none fired; every `EDITRC=0` below), hash before/after, `diff` against the original
commit's file, `vitest run tests/panel` redirected and read whole, process census before/after,
`cmp` of both criterion test files against the main tree, then `/bin/rm -rf` of the clone's parent
tmp dir. `ORCA_CORRECTIONS_DIR` is supplied by the test file itself for the two real-process
criteria (`throwawayStore`, unchanged) — verified `~/.orca` absent before and after every row.

---

## S-12 — `get` re-reads via `readFileSync(join(dir, name))`, `undefined` on any throw

Hash before `ccd4b318a168fd170037425033c67cf18afd97e1ac93eaa9e296ede42957d56b` → after
`930fb3324f61db7435abfc59a1eb04bcbb0d5d52db348f7a855c772bb5d55203` (differ). Diff: added a
`readFileSync` import and rewrote `get` to try/catch a disk read.

RC=1. `Test Files 1 failed | 4 passed (5)`, `Tests 2 failed | 30 passed (32)`.

Failing criteria:
1. **`static serving (spec section 2.2) > has no key for any traversal spelling, because there is
   no path to join`** — `tests/panel/staticFiles.test.ts:50`. First failing spelling: **`./index.js`**
   (the four preceding spellings — `../../etc/passwd`, `..%2f..%2fetc%2fpasswd`, `%2e%2e/`,
   `/etc/passwd` — stayed undefined and did not mask it). `expected {…} to be undefined` /
   received the real `index.js` asset object (bytes + `contentType: "text/javascript; charset=utf-8"`).
2. **`static serving (spec section 2.2) > enumerates exactly the flat names it loaded, and no
   symlinked one`** — `tests/panel/staticFiles.test.ts:59`. The sorted-`names` assertion (line 58)
   passed first (S-12 doesn't touch `.names`); the second assertion, `files.get("linked.txt")`,
   failed: `expected {…} to be undefined` / received the symlink target's real content
   (`root:x:0:0\n`, `contentType: "application/octet-stream"`).

Census: 7 new process lines, 0 `src/cli.ts`/`tsx` survivors. `~/.orca` absent before and after.
`cmp` both criterion files vs main tree: `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — both the controller's and the implementer's predictions exactly: `./index.js` and
`linked.txt` are the two spellings that resolve; `subdir/index.js` does not (confirmed absent from
the failure, consistent with F2/F4 in the implementer's report — no `subdir/` exists on disk).

---

## S-13 — delete `if (!entry.isFile()) continue;`

Hash before `ccd4b318a1...` → after `8c0ebb3ccf82bbca878ff87869092845bfdbc1a3a15382aac679c9e0fb5a1bd4`
(differ). Diff: removed the one `continue` line; the loader now `readFile`s every `readdir` entry,
symlinks included.

RC=1. `Test Files 1 failed | 4 passed (5)`, `Tests 1 failed | 31 passed (32)`.

Failing criterion: **`static serving (spec section 2.2) > enumerates exactly the flat names it
loaded, and no symlinked one`** — `tests/panel/staticFiles.test.ts:58`. First assertion (sorted
`names`) failed and the second (`files.get("linked.txt")`, line 59) never ran (same test, still
counted once): `expected ['index.css','index.html','index.js'] to deeply equal [...,'linked.txt']`
— `linked.txt` now present in `names`.

Census: 5 new lines, 0 survivors. `~/.orca` absent before/after. `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — exactly the predicted single criterion, exactly the predicted short-circuit (sorted-names
assertion fails first, symlink-`get` assertion never reached).

---

## S-14 — store `index.html` unchanged (no `replace`, anchor left in)

Hash before `ccd4b318a1...` → after `d1ab7e015aa857853242b88b140280e42c6e932d11f283b4bc6b26719da6a848`
(differ). Diff: `bytes: Buffer.from(html, "utf8")` replaces the `html.replace(TOKEN_ANCHOR, ...)` call.

RC=1. `Test Files 1 failed | 4 passed (5)`, `Tests 1 failed | 31 passed (32)`.

Failing criterion: **`static serving (spec section 2.2) > injects the token into index.html in
memory, and leaves the anchor nowhere in the output`** — `tests/panel/staticFiles.test.ts:65`.
First assertion (`toContain("s3cret-token")`) failed and stopped the test there:
`expected '<html><body><!-- orca-panel-token -->…' to contain 's3cret-token'`.

Census: 5 new lines, 0 survivors. `~/.orca` absent before/after. `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — exactly the predicted single criterion and short-circuit point.

---

## S-15 — delete the `panel-token-anchor-missing` throw

Hash before `ccd4b318a1...` → after `8ea1d87a4774612ae9408f3f611d407d5526d0fa0901c2e3f48fb7bf6f1381a2`
(differ). Diff: removed the whole `if (!html.includes(TOKEN_ANCHOR)) { throw ... }` block.

RC=1. `Test Files 1 failed | 4 passed (5)`, `Tests 1 failed | 31 passed (32)`.

Failing criterion: **`static serving (spec section 2.2) > F3.1 rejects by name when index.html
exists without the token anchor`** — `tests/panel/staticFiles.test.ts:86`.
`promise resolved "{ get: [Function get], …(2) }" instead of rejecting` — `loadStaticFiles`
resolved with a full `StaticFiles` object instead of throwing `panel-token-anchor-missing`.

Census: 5 new lines, 0 survivors. `~/.orca` absent before/after. `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — exactly the predicted single criterion.

---

## S-16 — ENOENT branch returns an empty `StaticFiles` instead of throwing `panel-dist-missing`

Hash before `ccd4b318a1...` → after `4f25c5fed772243053a00627ea6e72236eb6ca2568f147f439ee11657b0c683c`
(differ). Diff: `throw new PanelRejection("panel-dist-missing", ...)` replaced by
`return { get: () => undefined, indexHtml: undefined, names: [] };`.

RC=1. `Test Files 1 failed | 4 passed (5)`, `Tests 1 failed | 31 passed (32)`.

Failing criterion: **`static serving (spec section 2.2) > says so by name when web/dist has not
been built, instead of serving nothing quietly`** — `tests/panel/staticFiles.test.ts:74`.
`promise resolved "{ get: [Function get], indexHtml: undefined, names: [] }" instead of rejecting`.

Census: 5 new lines, 0 survivors. `~/.orca` absent before/after. `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — exactly the predicted single criterion.

---

## S-17 — delete `if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;`

Hash before `ccd4b318a1...` → after `eae960f0270c57c9849cf6e0a1ee00f726ee3429e256029d6f5c7e4c066f1447`
(differ). Diff: removed that one rethrow line, so every `readdir` failure (not just `ENOENT`) now
falls through to the `panel-dist-missing` throw.

RC=1. `Test Files 1 failed | 4 passed (5)`, `Tests 1 failed | 31 passed (32)`.

Failing criterion: **`static serving (spec section 2.2) > F3.2 does not relabel a non-ENOENT
readdir failure as panel-dist-missing`** — `tests/panel/staticFiles.test.ts:103`.
`expected 'panel-dist-missing' not to be 'panel-dist-missing' // Object.is equality` — the `ENOTDIR`
failure (pointing `distDir` at a regular file) got relabelled as `panel-dist-missing`.

Census: 5 new lines, 0 survivors. `~/.orca` absent before/after. `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — exactly the predicted single criterion.

---

## S-18 — `contentTypeOf`'s fallback becomes `"text/html; charset=utf-8"`

Hash before `ccd4b318a1...` → after `913754a7af917f113a6718383c0390dbf64523a8650608d964cd6975e991fe35`
(differ). Diff: fallback string literal changed.

RC=1. `Test Files 1 failed | 4 passed (5)`, `Tests 1 failed | 31 passed (32)`.

Failing criterion: **`static serving (spec section 2.2) > F3.3 never guesses a content type for an
extension it does not know`** — `tests/panel/staticFiles.test.ts:115`.
`expected 'text/html; charset=utf-8' to be 'application/octet-stream' // Object.is equality`
(`notes.txt`'s content type).

Census: 5 new lines, 0 survivors. `~/.orca` absent before/after. `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — exactly the predicted single criterion.

---

## M-1 — `server.ts`: delete the `malformed-port` check

Hash before `cd501d2e07a832e4ba7ab1b579d90722d531e03d600f4882a43debc31dedf4dd` → after
`b3571c65be501ff22dc24f82f92636ea07192c70e92bd2435684ebb8565edaaa` (differ). Diff: removed the
`if (!Number.isInteger(port) || port < 0 || port > 65535) { throw ... }` block.

RC=1. `Test Files 1 failed | 4 passed (5)`, `Tests 1 failed | 31 passed (32)`.

Failing criterion: **`parsePanelArgs argument validation (F6: task 3's deferred malformed-port /
malformed-repo-argument) > rejects --port by name for a non-integer, for -1, and for 65536; accepts
65535`** — `tests/panel/security.test.ts:273`. Loop's first entry `"abc"` failed to throw (masking
`"-1"`/`"65536"`, never reached): `AssertionError: abc` (the per-iteration message annotation is
the only detail vitest prints for this `toThrowError` failure).

Census: 7 new lines, 0 survivors. `~/.orca` absent before/after. `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — exactly the predicted single criterion and masking order.

---

## M-2 — `server.ts`: delete the `malformed-repo-argument` check

Hash before `cd501d2e07a8...` → after `23bbad4c7a308bb55a34e52567eb7626b052abed197a98ec4372884f19b6e101`
(differ). Diff: removed the `if (split <= 0) { throw ... }` block.

RC=1. `Test Files 1 failed | 4 passed (5)`, `Tests 1 failed | 31 passed (32)`.

Failing criterion: **`parsePanelArgs argument validation (F6: task 3's deferred malformed-port /
malformed-repo-argument) > rejects --repo by name for a value with no '=' and for one starting with
'='; accepts k=path`** — `tests/panel/security.test.ts:284`. Loop's first entry `"no-equals-here"`
failed to throw (masking `"=path"`, never reached): `AssertionError: no-equals-here`.

Census: 5 new lines, 0 survivors. `~/.orca` absent before/after. `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — exactly the predicted single criterion and masking order.

---

## P-10b — delete the entire missing-`by` refusal block (no default, no throw)

Hash before `cd501d2e07a8...` → after `7f2ed6a2e9bb03038aff175eb7ca7b2b43aa7a6851a3af3e85e5bae4d69180e6`
(differ). Diff: removed the whole `if (by === undefined || by.length === 0) { throw ... }` block,
leaving `const by = flag("--by");` (now possibly `undefined` at runtime; `tsx`/esbuild strip types
so this compiles and runs).

RC=1, duration 5.72s. `Test Files 1 failed | 4 passed (5)`, `Tests 2 failed | 30 passed (32)`.

Failing criteria (two, as predicted):
1. **`panel security (spec sections 3.1 and 3.2) > requires --by even on the loopback interface`**
   — `tests/panel/security.test.ts:115` — `expected function to throw an error, but it didn't`
   (parse-level `--by` criterion).
2. **`panel security via the real CLI process (controller ruling E2/E3: not skipped) > refuses a
   missing --by through the REAL process (ruling E3: the hole Task 1's stub left open)`** —
   thrown from `tests/panel/security.test.ts:77` (inside `runPanelProcess`'s deadline timer, not
   from any `expect()` in the test body) — took **5006ms** (vitest reports the test's own duration
   as 5005ms in this run). Message: `orca panel (pid 82647 [P-10] / 80892 [P-10b]) did not exit by
   itself within 5000ms; the whole process group was killed. ... stderr so far: ""`.

Census: 6 new process lines after vs. before; **0** survivors matching `src/cli.ts`/`tsx` — the
deadline's own `SIGKILL -pid` (negated, whole group) ran before the rejection, so nothing was left
for the census to catch. No leftover process required killing.

`~/.orca` absent before and after. `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — both the controller's and the implementer's prediction exactly: two criteria fail,
the CLI-level one fails via the deadline rejection (not the exit-code/stderr `expect()`s, which
never execute because `await result` itself throws first), and zero `tsx`/`src/cli.ts` processes
survive.

---

## P-10 — replace the missing-`by` refusal with a default `by = "panel"`

Hash before `cd501d2e07a8...` → after `c9d92f572dceffa71b1c902538600d10865a2bd93dfb66b4a4e0234b9b8d090d`
(differ). Diff: same block replaced by `const by = flag("--by") ?? "panel";`.

RC=1, duration 5.78s. `Test Files 1 failed | 4 passed (5)`, `Tests 2 failed | 30 passed (32)`.

Failing criteria — identical pair, identical failure shapes, to P-10b:
1. **`panel security (spec sections 3.1 and 3.2) > requires --by even on the loopback interface`**
   — `tests/panel/security.test.ts:115` — `expected function to throw an error, but it didn't`.
2. **`panel security via the real CLI process (controller ruling E2/E3: not skipped) > refuses a
   missing --by through the REAL process (ruling E3: the hole Task 1's stub left open)`** —
   deadline rejection at `tests/panel/security.test.ts:77`, took **5006ms**. Message: `orca panel
   (pid 82647) did not exit by itself within 5000ms; the whole process group was killed. ... stderr
   so far: ""`.

Census: 5 new lines after vs. before; **0** survivors matching `src/cli.ts`/`tsx`. No leftover
process required killing.

`~/.orca` absent before and after. `cmp1_rc=0`, `cmp2_rc=0`.

**Matched** — same two criteria as P-10b, same census result. Defaulting `by` behaves identically to
deleting the check outright, for both criteria: the parse-level test never gets a thrown
`NO_VIEWER_IDENTITY`, and the CLI-level test's process starts a real (loopback, ephemeral-port)
listener that never exits on its own, so the deadline fires either way.

---

## Summary table

| id | RC | failing criteria | matched/differs | leftover tsx/cli.ts processes |
|---|---|---|---|---|
| baseline | 0 | 0 | — (all green, as required) | 0 |
| S-12 | 1 | 2 | matched | 0 |
| S-13 | 1 | 1 | matched | 0 |
| S-14 | 1 | 1 | matched | 0 |
| S-15 | 1 | 1 | matched | 0 |
| S-16 | 1 | 1 | matched | 0 |
| S-17 | 1 | 1 | matched | 0 |
| S-18 | 1 | 1 | matched | 0 |
| M-1 | 1 | 1 | matched | 0 |
| M-2 | 1 | 1 | matched | 0 |
| P-10b | 1 | 2 | matched | 0 (killed by internal deadline before census) |
| P-10 | 1 | 2 | matched | 0 (killed by internal deadline before census) |

No unpinned criteria found beyond what the table already covers — the implementer's report names
exactly the same set (S-12..S-18, M-1, M-2, T-1/P-10b, plus P-10 added by the controller), and every
one of them produced a real, measured red matching both predictions. **No fully-green mutation was
found in this round** (unlike Task 1's `--by` guard, which this round's P-10/P-10b rows exist to
recheck against the new real-process teardown — and which is now pinned twice over, at parse level
and at CLI level).

Every `~/.orca` check across all 12 runs (baseline + 11 mutations, before and after each) came back
absent. Every `cmp` of both criterion files (clone vs. main tree) returned rc 0. Main-tree porcelain
was 52 bytes / one entry (`progress.md`) both before and after the whole session, and `HEAD` stayed
at `def120468ce5bd0218942e516f342124469a4805` throughout.
