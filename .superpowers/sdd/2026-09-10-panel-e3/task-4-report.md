# Task 4 report — static files (Part A) + two Task 3 debts (Part B)

Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. BASE = e4e2ad6.
Commits: `de25a8b` (Part A), `def1204` (Part B).

## Step 2 measured red (before implementation)

Command: `./node_modules/.bin/vitest run tests/panel/staticFiles.test.ts` (redirected, read whole).

```
FAIL  tests/panel/staticFiles.test.ts [ tests/panel/staticFiles.test.ts ]
Error: Failed to load url ../../src/panel/staticFiles.js (resolved id: ../../src/panel/staticFiles.js)
in /Users/biran/code/skills/loop/Orca/tests/panel/staticFiles.test.ts. Does the file exist?
Test Files  1 failed (1)
Tests  no tests
RC=1
```

Not an assertion failure — a collection error, because `src/panel/staticFiles.ts` did not exist yet.
After implementing it: `./node_modules/.bin/vitest run tests/panel/staticFiles.test.ts` → **8 passed (8)**,
RC=0 (5 from the brief's Step 1 + 3 from F3).

## F3 — where the three added criteria live (as required by the ruling)

1. `panel-token-anchor-missing` when `index.html` has no anchor — `tests/panel/staticFiles.test.ts`, test
   "F3.1 rejects by name when index.html exists without the token anchor".
2. non-ENOENT `readdir` failure not relabelled — test "F3.2 does not relabel a non-ENOENT readdir failure
   as panel-dist-missing". Measured (node v22.13.1, darwin, probe script in scratchpad): `readdir` on a
   regular file rejects `code=ENOTDIR`, message `ENOTDIR: not a directory, scandir '<path>'`. Asserted the
   actual errno, not a guess.
3. unknown extension never guessed — test "F3.3 never guesses a content type for an extension it does not
   know". **Choice stated (controller left it to me):** the extra file (`notes.txt`) is written inside that
   one `it()` only, on top of the shared `beforeEach` fixture — not added to the shared `beforeEach` itself.
   Because each `it()` gets a fresh `dist` from `beforeEach` (a new `mkdtemp` per test), this does not touch
   the sorted-names or traversal criteria's expected lists; they still see only `index.html`/`.js`/`.css`.

## F4 — the Map criterion, the symlink, and the S-12 prediction

Probes run in the scratchpad (not the mutation itself):

- `readFileSync(file + "/")` on a real file → throws `ENOTDIR: not a directory, open '<path>/'`.
- `path.join(dir, "index.js/")` → `"<dir>/index.js/"` (trailing slash preserved).
- `path.join(dir, "./index.js")` → `"<dir>/index.js"` (normalises to the real file).
- `path.join(dir, "subdir/index.js")` → `"<dir>/subdir/index.js"` (no `subdir/` exists in the fixture on disk).
- `path.join(dir, "/etc/passwd")` → `"<dir>/etc/passwd"` (join does not treat a leading `/` argument as
  absolute; never reaches the real file).

So under S-12 (`get` re-reads via `join(dir, name)`): `"index.js/"` stays absent (`ENOTDIR` on open, caught,
`undefined`) — it does **not** flip. `"./index.js"` **does** flip (resolves to the real file). `"subdir/index.js"`
stays absent (no such path on disk) — the brief's own rationale citing it as a catcher is wrong (F2), confirmed
by measurement, not just by the controller's say-so. `"linked.txt"` (a separate assertion, in the enumeration
test) also flips, because `readFile`/`readFileSync` follow symlinks and `join(dir, "linked.txt")` resolves to
the real symlink path.

## F5 — the real-process teardown: mechanism and P-10b answer

**Mechanism chosen:** `runPanelProcess()` in `tests/panel/security.test.ts`, replacing `execFileAsync` for the
two real-process criteria (the lsof observation still uses `execFileAsync`, unchanged).

- `spawn(..., { detached: true, stdio: ["ignore","pipe","pipe"] })`. Measured installed `tsx` is `4.23.13`
  (`./node_modules/.bin/tsx --version`); it re-execs the script in a CHILD node process, which is the one
  that actually calls `listen()`. `detached: true` makes the spawned `tsx` pid the leader of a new process
  GROUP (pgid == its own pid on POSIX); the grandchild inherits that pgid since it does not detach itself.
  Signalling the **negated** pid (`process.kill(-child.pid, "SIGKILL")`) reaches the whole group, not just
  the immediate child — killing only the immediate pid would have orphaned the grandchild, which is the
  exact bug being repaired.
- Each call gets its own deadline (5000 ms), well inside vitest's existing 20000 ms per-test timeout. On the
  deadline: kill the group, then **reject** the returned promise with a message naming the pid and the
  deadline and including stderr captured so far — never resolve as if nothing happened.
- `killCurrent` is captured immediately after `spawn` (before `await result`), and an `afterEach` calls it
  again unconditionally. It is a documented no-op once the child has already exited or been killed (a
  `settled` flag), so this is a pure backstop for "a thrown assertion between spawn and settlement skips the
  kill" — in the normal control flow the deadline's own kill already covers it.
- The exit-code / stderr-content / lsof assertions underneath are untouched in meaning (same expectations,
  same E6 comment, same non-empty-first ordering).

**Answer to "what does this criterion now do under P-10b, and what is left running when vitest exits?"**
(predicted; **not witnessed** — I did not run the mutation, per the no-mutations rule):
With the `--by` guard deleted, `orca panel` (no args) parses without throwing: `bind` defaults to
`127.0.0.1` (loopback, so `assertBindAllowed` passes trivially regardless of `confirmedExternal`), `port`
defaults to `0` (kernel picks an ephemeral port), and nothing else in `parsePanelArgs` or
`createPanelServer` reads `opts.by` before `listen()` succeeds — so the process starts a real server and
never exits by itself. `runPanelProcess`'s 5000 ms deadline fires, kills the whole process group via the
negated pid, and **rejects**. Since the test body does `const run = await result;` with no `.catch`, that
rejection propagates as a thrown error out of the `it()`, and vitest marks the test **failed** (red) with the
"did not exit by itself within 5000ms; the whole process group was killed" message — not a silent pass, and
not vitest's own blind 20000 ms timeout with the child left listening. Because the kill already happened
before the rejection, the predicted process count after the run is the same as measured in the untouched
happy path below: **zero** leftover `tsx`/`node` process from this criterion. The sibling criterion ("refuses
an unconfirmed external bind…") is not affected by P-10b: it still supplies `--bind` `192.0.2.1` without
`--i-know-this-is-exposed`, and `assertBindAllowed` is a separate, untouched guard, so it still throws
`EXTERNAL_BIND_NOT_CONFIRMED` before `listen()` and stays green.

## F6 — why parse level, and the two added criteria

Comment written into the test file itself (not just this report): asserting through the real process would,
on the run where either check is deleted, actually **start a server** on loopback (port defaults to `0`,
an ephemeral port) that then never exits — the exact hazard F5 exists to repair, for no reason a
parse-level check can't sidestep. `--by "amy"` is supplied in every one of the new assertions; `{}` is
passed as `env` in every case (never `process.env`), so none of them can resolve to the real `~/.orca`.

## Survey greps (run, not filtered further than the brief specifies; redirected and read whole)

`grep -n "files.get(\|\.names" tests/panel/ -r`:
```
tests/panel/staticFiles.test.ts:29:    expect(files.get("index.js")?.contentType).toBe("text/javascript; charset=utf-8");
tests/panel/staticFiles.test.ts:30:    expect(files.get("index.css")?.contentType).toBe("text/css; charset=utf-8");
tests/panel/staticFiles.test.ts:31:    expect(files.get("index.js")?.bytes.toString("utf8")).toBe("console.log(1)\n");
tests/panel/staticFiles.test.ts:50:      expect(files.get(spelling), spelling).toBeUndefined();
tests/panel/staticFiles.test.ts:58:    expect([...files.names].sort()).toEqual(["index.css", "index.html", "index.js"]);
tests/panel/staticFiles.test.ts:59:    expect(files.get("linked.txt")).toBeUndefined();
tests/panel/staticFiles.test.ts:115:    expect(files.get("notes.txt")?.contentType).toBe("application/octet-stream");
RC=0
```
Only `staticFiles.test.ts` itself reads `.get(`/`.names` off a `StaticFiles` — no other test file is a
hidden second consumer of `loadStaticFiles`'s output (consistent with F1: it is not wired into
`createPanelServer` yet).

Additional greps run to ground the "who else" answers for M-1/M-2/T-1 (same discipline — redirected, read
whole):

`grep -rn "malformed-port\|malformed-repo-argument" tests/ src/`: only `src/panel/server.ts` (the two
`throw new PanelRejection(...)` definitions) and `tests/panel/security.test.ts` (the two new F6 criteria).
No other test references either code.

`grep -rn "cli.ts.*panel\|execFileAsync\|runPanelProcess" tests/`: the only spawns of `src/cli.ts panel`
anywhere in the suite are the two criteria inside `security.test.ts`'s real-process `describe` block, both
now through `runPanelProcess`. Every other `execFileAsync` hit in the codebase drives `git` or
`src/cli.ts validate`/other subcommands, not `panel`.

## Mutation predictions

| id | prediction | (1) earlier assertion short-circuits first? | (2) who else walks the deleted/changed line? | (3) literal's origin |
|---|---|---|---|---|
| S-12 | red in "has no key for any traversal spelling" (via `"./index.js"` only) **and** "enumerates exactly the flat names it loaded, and no symlinked one" (via the `linked.txt` assertion) | In the traversal test: the four percent/`..`/`/etc` spellings before `"./index.js"` in the array stay absent and do not throw, so no, they don't mask it — `"./index.js"` is the first to flip and is what fails. In the enumeration test: the sorted-names assertion runs first and still passes (S-12 does not touch `.names`); the `linked.txt` assertion is second and is what fails. | Survey grep above: nobody outside `staticFiles.test.ts` reads `.get`/`.names`, so no other criterion is touched by this mutation. | `"./index.js"` and `"linked.txt"` are literals the test itself chose (traversal-spelling array, symlink fixture name); the loader's Map behaviour is what's under test, not a value the test wrote and read back. |
| S-13 | red in "enumerates exactly the flat names it loaded, and no symlinked one" only | The sorted-names assertion is first and fails immediately (list now contains `linked.txt`), so the second assertion (`files.get("linked.txt")` undefined) never runs — same test, same criterion, still counted once. | Same survey grep: only this test's two assertions touch `.names`/the symlink key. | The expected array `["index.css","index.html","index.js"]` is the literal fixture list from `beforeEach`, cited by the test, not derived from a value the test wrote mid-test. |
| S-14 | red in "injects the token into index.html in memory, and leaves the anchor nowhere in the output" only | The first assertion (`toContain("s3cret-token")`) fails immediately; the anchor-absence and count checks after it never run. | No other criterion asserts on `index.html`'s byte content; F3.1 exercises a different fixture (anchor missing) and a different throw path untouched by S-14. | `"s3cret-token"` is the token the test itself passed into `loadStaticFiles(dist, "s3cret-token")` as a parameter — the thing under test, not a self-written-and-read-back value. |
| S-15 | red in "F3.1 rejects by name when index.html exists without the token anchor" only | Single assertion (`.rejects.toMatchObject(...)`); nothing precedes it. | No other fixture in the file omits `TOKEN_ANCHOR`; only F3.1 exercises this branch. | `"panel-token-anchor-missing"` is the `PanelRejection` code defined in `staticFiles.ts` itself; the test cites the production contract, not a value it wrote. |
| S-16 | red in "says so by name when web/dist has not been built, instead of serving nothing quietly" only | Single assertion; nothing precedes it. | No other criterion calls `loadStaticFiles` with a missing `distDir`. | `"panel-dist-missing"` is the code `staticFiles.ts` defines for this branch. |
| S-17 | red in "F3.2 does not relabel a non-ENOENT readdir failure as panel-dist-missing" only | `toBeInstanceOf(Error)` still passes (a `PanelRejection` is still an `Error`); the second assertion (`code` not `panel-dist-missing`) is what fails, so the third (`code === "ENOTDIR"`) never runs. | No other fixture points `distDir` at a non-directory; only F3.2 exercises a non-ENOENT `readdir` failure. | `"ENOTDIR"` and `"panel-dist-missing"` are, respectively, the measured Node errno (probe above) and the shared `PanelRejection` code S-16 already defines — neither is self-written by the test. |
| S-18 | red in "F3.3 never guesses a content type for an extension it does not know" only | Single assertion; nothing precedes it. | `index.js`/`.css` hit explicit `CONTENT_TYPES` entries and never reach the fallback; `index.html`'s content type is hardcoded in the index-handling branch, not via `contentTypeOf`'s fallback. `notes.txt` (F3.3's own fixture) is the only name anywhere in the suite with an unrecognised extension. | `"application/octet-stream"` is the production fallback constant cited as the expected value. |
| M-1 | red in "rejects --port by name for a non-integer, for -1, and for 65536; accepts 65535" only | Yes: the loop's first entry (`"abc"`) fails to throw first, so `"-1"` and `"65536"` are never reached — masked, though they would also fail if reached, since the whole guard is gone. | Grep above: `malformed-port` appears nowhere else in tests/ or src/ except its one definition and this one new criterion. | `"malformed-port"` is the code `parsePanelArgs` already throws (Task 3 code, unmodified by Task 4). |
| M-2 | red in "rejects --repo by name for a value with no '=' and for one starting with '='; accepts k=path" only | Yes: the loop's first entry (`"no-equals-here"`) fails to throw first (with the check gone, `pair.indexOf("=")` is `-1`, `pair.slice(0,-1)`/`pair.slice(0)` push a garbage-but-non-throwing repo entry), masking `"=path"`. | Grep above: `malformed-repo-argument` appears nowhere else except its definition and this new criterion. | `"malformed-repo-argument"` is the code `parsePanelArgs` already throws (Task 3 code). |
| T-1 | re-running P-10b: "refuses a missing --by through the REAL process" goes red for a **different** reason — the deadline's "did not exit by itself" rejection, not the exit-code/stderr assertions — and the whole process group is killed before that rejection, so **zero** processes are predicted left running once vitest exits; "refuses an unconfirmed external bind…" is unaffected and stays green | Not applicable in the usual sense — the failure is a rejected promise from `await result`, thrown before any `expect()` in that test body runs at all. | Grep above: no other test in the suite spawns `src/cli.ts panel`, so no other criterion is touched by P-10b. | Not a literal-comparison failure; the message is `runPanelProcess`'s own, naming the measured pid and the 5000 ms deadline it set. **Predicted, not witnessed** — I did not run P-10b; the independent verifier does, per the task's contract. |

## Three verify tiers (BASE was: whole repo 87 files/493 tests, scheduler 51/167, web 1/1, VERIFY_RC=0)

Command: `rtk proxy npm run verify > <scratchpad file> 2>&1; echo "VERIFY_RC=$?" >> <file>` — 1345 lines /
80063 bytes, read whole (no grep/tail on the run itself).

- **Whole repo** (`npm test` = `vitest run`): `Test Files  88 passed (88)` / `Tests  503 passed (503)`.
  Delta from BASE is exactly the tests added: +1 file (`staticFiles.test.ts`, 8 tests) and +2 tests in
  `security.test.ts` (the F6 criteria) = +10 tests, +1 file. Matches.
- **`verify:scheduler`**: `Test Files  51 passed (51)` / `Tests  167 passed (167)` — unchanged from BASE, as
  expected (Task 4 touches no scheduler code).
- **`@orca/web check`**: `Test Files  1 passed (1)` / `Tests  1 passed (1)` — unchanged from BASE.
- `VERIFY_RC=0`.

The scheduler run's stdout (git plumbing / worktree logging from ccloop scenario fixtures) is interleaved
with the test output in the captured file; the pass/fail totals above are the lines vitest itself prints.

## Porcelain listing (before writing this report)

`git status --porcelain -z > <file>; ` decoded whole (NUL-separated, python3): exactly one entry —
`" M .superpowers/sdd/2026-09-10-panel-e3/progress.md"`. Nothing under `src/`, `tests/`, `web/`, or
`.decisions/` was dirty at that point (both Task 4 commits had already landed). Writing this report file
itself will now also appear in that listing, as expected by the contract ("non-zero ONLY because of
progress.md and your report").

## `ls ~/.orca`

`ls -la ~/.orca` → `ls: /Users/biran/.orca: No such file or directory`. Still absent.

## Leftover-process check

`ps aux` captured to a scratchpad file (unfiltered) after the full `npm run verify` run. Grep against that
saved snapshot for `tsx` → no match (RC=1): no `tsx` process, and therefore no `src/cli.ts panel` process,
was running. (An earlier grep for the literal string `"cli.ts panel"` did match one line, but reading that
line showed it was the shell wrapper's own command line — the grep invocation's argument text captured by
`ps`, not an orca process — so it is not a real match.) Also checked immediately after the `security.test.ts`
run alone, before the full verify: same result, no leftover process.

## Deviations from the brief

- Scratch files used the session's scratchpad directory throughout, never the brief's fixed `/tmp/t4.txt` /
  `/tmp/whoS.txt` names, per the controller notes.
- Commit message for Part A rewrites the brief's "Honest note" paragraph per F2: it states the S-12
  prediction (`./index.js` and `linked.txt`, not `subdir/index.js`) as a prediction an independent verifier
  measures, not as something this commit observed.
- `src/panel/staticFiles.ts` and its five brief-given criteria are implemented verbatim from the brief; only
  the three F3 additions and the F1 comment edit in `server.ts` are Task-4-controller-notes-driven additions
  beyond the brief's own text.
- I did not run any of the named mutations (S-12…S-18, M-1, M-2, T-1); every prediction above is reasoning
  plus non-mutation probes (errno, `path.join`, `readFileSync` with a trailing slash, and grep surveys of who
  else reads the changed code paths), never a "seen red" claim.

## What was skipped / uncertain

Nothing was skipped silently. The only "not witnessed" items are the mutation outcomes themselves (by
design — an independent verifier runs them) and, within F5's answer, the actual behaviour under P-10b
specifically (also by design, since I do not run mutations). Everything else in this report — the measured
red, the probes, the survey greps, the three verify tiers, the porcelain listing, `~/.orca`, and the
leftover-process check — was directly observed via a redirected-and-read-whole command.
