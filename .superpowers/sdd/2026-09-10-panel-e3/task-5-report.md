# Task 5 report — metrics endpoint, panel review coverage, static route wiring, skip gate

Repo `/Users/biran/code/skills/loop/Orca`, branch `main`. BASE = `def1204`. Commit produced by this task: `153daec`
("feat(panel): serve /api/metrics with a per-request gate, and give the panel its own review coverage").

## Files touched

- Created `src/panel/coverage.ts` (57 lines, measured `wc -l`), `src/panel/api.ts` (106 lines).
- Modified `src/panel/server.ts` (+12/-7, measured `git diff def1204 HEAD --stat -- src/panel/server.ts`): added
  `now?: () => Date` to `PanelOptions`, wired `loadStaticFiles` + `buildApi` into `createPanelServer`, replaced the
  two Task-3 placeholder comments.
- Created `tests/panel/metricsApi.test.ts` (389 lines, 12 tests) and `tests/panel/noSkips.test.ts` (174 lines, 4
  tests).
- `src/panel/rejection.ts` **not** modified — ruling G2: `TOKEN_REQUIRED` is imported from there, never redeclared.
- `src/metrics/**` **not** modified — ruling G12, confirmed below.

## Step 2: measured red

TDD per the brief's Step 1/2: wrote both new test files complete, then reproduced the pre-Task-5 state to measure
red before restoring the implementation.

Method (git-safe, nothing destructive): moved `src/panel/api.ts` and `src/panel/coverage.ts` into the scratchpad
with `/bin/mv`, then `git stash push -- src/panel/server.ts` to revert that file to its `def1204` content. Ran:

```
rtk proxy npx vitest run tests/panel/metricsApi.test.ts tests/panel/noSkips.test.ts
```

Redirected to a scratchpad file, read whole. Result (RC=1):

```
 ✓ tests/panel/noSkips.test.ts (4 tests) 9ms
 ❯ tests/panel/metricsApi.test.ts (0 test)
FAIL  tests/panel/metricsApi.test.ts [ tests/panel/metricsApi.test.ts ]
Error: Failed to load url ../../src/panel/coverage.js ... Does the file exist?
 Test Files  1 failed | 1 passed (2)
      Tests  4 passed (4)
```

`metricsApi.test.ts`'s whole suite failed to even load (red, by module resolution — every one of its 12 criteria
depends on the not-yet-existing implementation). `noSkips.test.ts` passed already in this state: that file does not
exercise Task 5's server/coverage code at all — it is an independent gate over test-file text, so a red state for it
was never expected; its own red/green boundary is exercised by its internal must-catch/must-not-catch criteria
(below), not by the presence or absence of `api.ts`/`coverage.ts`.

Restored: `/bin/mv` the two files back, `git stash pop`. Confirmed via `git status --porcelain` immediately after
that the working tree matched what it was before the red check (only `progress.md` + the five Task 5 files, same as
before). Then ran the same two files again — green, 16/16 tests, `tests/panel/metricsApi.test.ts (12 tests)`,
`tests/panel/noSkips.test.ts (4 tests)`, `RC=0`.

## G4 raw-path evidence

The static-serving describe block uses `node:http`'s `request()` with a raw string `path`, never `fetch`, per
ruling G4 (WHATWG `URL` parsing collapses `.`/`..`/`%2e%2e` client-side, which would make a fetch-based criterion
test the browser's URL parser instead of the server). The positive control inside the SAME criterion
(`rawGet(started.url, "/index.js")` → 200, run immediately after the loop of traversal spellings that all expect
404) is the evidence that the 404s were not vacuous and that `req.url` really carried the raw spelling: express's
route for the static handler is a bare regex (`/.*/ `), which does no dot-segment normalisation, and `req.path`
(via `parseurl`) is not percent-decoded — the same reasoning `tests/panel/staticFiles.test.ts` already relies on at
the loader level, extended here to the HTTP layer. No dedicated req.url-echo probe was added (none is needed): the
positive/negative pair in one criterion is the proof G4 asked for.

## G7 answer

For "binds the literal 127.0.0.1 by default" (goes through `parsePanelArgs` + `createPanelServer`, per ruling G7,
never a hand-built options object):

- **On the run where the bind guard is deleted (P-1) alone**: the *default* bind value is unaffected by this
  mutation — `parsePanelArgs` still returns the literal `"127.0.0.1"`. `assertBindAllowed` becoming a no-op is
  irrelevant for a loopback address (it would have passed the intact guard too). The server binds to
  `127.0.0.1:<ephemeral port>` exactly as without the mutation, and `started.close()` in the test's `finally`
  closes it cleanly. This criterion does **not** go red under P-1 alone — by design, per ruling G5, P-1's own
  criteria live in `tests/panel/security.test.ts`'s "refuses a non-loopback bind..." pair, which supply a
  non-loopback `--bind` explicitly.
- **On the run where the default is `TEST-NET-1` (P-2) alone**: `parsePanelArgs` returns `bind: "192.0.2.1"`.
  `createPanelServer` calls `assertBindAllowed("192.0.2.1", confirmedExternal=false)` *before* `mintToken`/
  `loadStaticFiles`/`listen()`. Since `192.0.2.1` is not loopback and `--i-know-this-is-exposed` was never passed,
  the (intact) guard throws `EXTERNAL_BIND_NOT_CONFIRMED` synchronously inside `createPanelServer`, so `await
  createPanelServer(...)` **rejects** — nothing ever binds, nothing ever listens, and there is nothing to close (the
  `started.close()` in the test's inner `finally` is never reached because the throw happens on the assignment
  line, before that `try` block; the outer `withCorrectionsDir`/dist-fixture `finally` still runs and cleans up the
  temp dist directory). The criterion still goes **red** — via a thrown `PanelRejection` propagating out of the
  `it`, not via the `.toBe(true)` string comparison it was written to make. No leak either way.

## G9 self-scan answer

The must-catch array (`it.skip(`, `test.skip(`, `describe.skip(`, `it.todo(`, `test.todo(`, `describe.todo(`,
`xit(`, `xtest(`, `xdescribe(`, and `it .skip (` for the whitespace form) is built as `"it" + DOT + "skip("` etc.,
where `DOT = "."` is a runtime value — the raw source of `noSkips.test.ts` never places an actual `.` character
directly between `it`/`test`/`describe` and `skip`/`todo` anywhere in the file; that adjacency only exists in the
evaluated *string*, not in the file's bytes. Confirmed empirically, not just argued: the dedicated criterion "does
not flag its own file" reads `noSkips.test.ts` via `fileURLToPath(import.meta.url)`, runs it through
`findSkipSpellings`, and asserts `[]`. Ran green (see the 4/4 result above; this specific test is one of the four).
The real-file-scan criterion ("tests/panel/*.ts and web/tests/* ... contain no skip or todo spelling") also
recursively includes this same file and passed, which is a second, independent witness of the same fact rather than
an exclusion — nothing was excluded from either scan.

## Survey grep (brief Step 7, run first)

```
/usr/bin/grep -rn "x-orca-token\|127.0.0.1\|currentMetrics" src/panel/ tests/panel/
```

```
src/panel/api.ts:38:async function currentMetrics(opts: PanelOptions) {
src/panel/api.ts:74:    const given = req.header("x-orca-token") ?? undefined;
src/panel/api.ts:84:      const { observations, report } = await currentMetrics(deps.opts);
src/panel/bindGuard.ts:9: * IPv4 loopback is the whole 127.0.0.0/8 block, not just 127.0.0.1: binding
src/panel/bindGuard.ts:10: * 127.0.0.2 is as local as binding 127.0.0.1, and refusing it would be a guard
src/panel/server.ts:25:   * applied where it is read (`src/panel/api.ts`'s `currentMetrics`). A
src/panel/server.ts:79:    bind: flag("--bind") ?? "127.0.0.1",
tests/panel/security.test.ts:123:  it("defaults the bind address to the literal 127.0.0.1", () => {
tests/panel/security.test.ts:127:    expect(parsePanelArgs(["--by", "amy"], {}).bind).toBe("127.0.0.1");
tests/panel/metricsApi.test.ts:23:  fetch(...{ "x-orca-token": token ?? started.token }...
tests/panel/metricsApi.test.ts:136:          // currentMetrics once and reusing it) could not go red.
tests/panel/metricsApi.test.ts:236:  it("binds the literal 127.0.0.1 by default", async () => {
tests/panel/metricsApi.test.ts:241:        // `?? "127.0.0.1"` INSIDE parsePanelArgs; calling createPanelServer
tests/panel/metricsApi.test.ts:247:          expect(started.url.startsWith("http://127.0.0.1:")).toBe(true);
RC=0
```

`currentMetrics` is defined exactly once (`api.ts:38`) and called exactly once (`api.ts:84`, inside the
`/api/metrics` handler) — no other call site to cache against. The `?? "127.0.0.1"` literal appears exactly once
(`server.ts:79`). The `x-orca-token` header check appears exactly once (`api.ts:74`). This is why the mutation
predictions below can name single landing places.

## Mutation predictions

I did not run these; an independent verifier does. For each: which criteria go red, then (1) short-circuit,
(2) other readers of the changed/deleted line, (3) where the asserted literal comes from.

**G-11** — cache `currentMetrics` once in `buildApi` (computed at server-startup time) instead of per request.
Red in **two** tests, not one — because ruling G11 split the brief's single outline into two separate `it`s that
both depend on post-startup re-evaluation:
- "re-runs repository discovery and E2's gate on EVERY request": the *second* `GET` (after the post-startup ghost
  correction) would still return the cached pre-correction 200, so `expect(second.status).toBe(409)` fails.
- "answers a broken gate with a first-class error...": its ghost correction is also written after the server is up
  (matching G11's own constraint); the cached value was computed at startup, before that correction, so the request
  still gets the cached 200 instead of 409.
(1) In both, the failing assertion is the first one checked after the correction is written — no earlier assertion
masks it. (2) `currentMetrics` has one call site (`api.ts:84`); nothing else reads its result. (3) `409` and
`UNRESOLVED_PROJECT_KEYS` are literals naming the spec's own refusal, not values the mutation could coincidentally
still produce.

**P-2** — `parsePanelArgs`'s `?? "127.0.0.1"` → `?? "192.0.2.1"`. Red in **two** tests (ruling G5): Task 3's
"defaults the bind address to the literal 127.0.0.1" (clean value mismatch: `.bind` is now `"192.0.2.1"`) and this
task's "binds the literal 127.0.0.1 by default" — but the second one reds via a **thrown rejection**, not the
`.toBe(true)` line: see the G7 answer above — `createPanelServer` now calls `assertBindAllowed` on a non-loopback
default with `confirmedExternal=false` and throws `EXTERNAL_BIND_NOT_CONFIRMED` before `started` is ever assigned.
(1) No short-circuit in Task 3's test (single assertion). In this task's test, the throw happens before the
`expect` line is even reached. (2) The literal is read only inside `parsePanelArgs`; both tests call it directly or
through `createPanelServer`. (3) `"127.0.0.1"` in both assertions is the spec's own literal (§3.2), not derived
from the implementation.

**T-8** — delete the `/api` token middleware. Red in exactly one test: "answers 401 without a token, and 401 with a
wrong one." (1) The no-token check is the *first* of three sequential assertions in that test; it fails there and
the wrong-token/right-token checks never execute — but the test is already correctly flagged red. (2) The
`x-orca-token` check exists in exactly one place (survey grep above); nothing duplicates it. (3) `TOKEN_REQUIRED` is
imported from `rejection.ts`, and `401` is the spec's literal HTTP status — neither is derived from the deleted
code.

**S-12b** — delete the whole `app.get(/.*/ ...)` static route. Red in **both** static-serving tests, via different
assertions: "serves the token-injected index.html at /" fails at its first assertion (status 200 — falls through to
Express's default 404 with the route gone). "answers 404 for every traversal spelling..." — the seven 404 checks in
its loop *still pass* (Express's own unmatched-route 404 also answers 404, coincidentally), so only the **positive
control** (`/index.js` expecting 200) fails, at the very end of that criterion. This is exactly why the positive
control was required by G4: without it, S-12b would leave that criterion green. (1) No short-circuit hides this —
the loop completes, the failure is the last statement. (2) Nothing else implements the static route. (3) `200`/
`"text/html; charset=utf-8"`/the token-count check are literals for the *working* behaviour, not incidentally true
when the route is gone.

**K-1** — `currentMetrics` stops passing `now` to `collect` (reverts to the wall clock). Red in exactly one test:
"passes E2's report through field for field..." — the server's internal `collect()` call would use the real wall
clock while the test's own comparison `collect()` call still uses the fixed `2026-09-10` clock, so `report.as_of`
(and `as_of_mode`, unaffected, but `as_of` differs) diverges and the whole-report `toEqual` fails. (1) Single
assertion, no short-circuit. (2) `now` is read only inside `collect()`'s own `asOf` computation. (3) The fixed ISO
string is defined once and used identically on both sides of the comparison in the unmutated code — K-1 breaks that
symmetry only on the server side.

**E-1** — error handler answers `MetricsRejection` with 200 and `{ report: null, code, message }`. Red in **two**
tests, mirroring G-11's shape: "re-runs...EVERY request" (its second `GET`'s `expect(second.status).toBe(409)`
fails; the `.code` check right after it would actually still pass in isolation but never runs, short-circuited by
the status assertion above it) and "answers a broken gate..." (`expect(res.status).toBe(409)` fails first; the
`"report" in body === false` check never runs, and would have failed too since E-1's shape has a literal `report:
null` key). (1) In both, the status check is checked before anything else and fails first. (2) Only one error
handler exists (`api.ts`'s trailing `app.use((err, ...) => ...)`). (3) `409` is the spec's literal; `"report" in
body` is a structural check independent of any value the mutation could produce.

**C-1** — delete `if (r.action !== "reviewed") continue;` in `computePanelCoverage`. Red in exactly one test: "keeps
`opened` out of the numerator...". (1) `reviewed_high_tier).toBe(0)` is the first of three assertions and fails
first. (2) Single implementation, no duplicate. (3) `0` is the deliberate "opened never counts" claim from spec
§4.2.

**C-2** — `rate: highTier.size === 0 ? 0 : ...`. Red in **two** tests, both of which reach the zero-denominator
branch: "reports rate null, not 0, when there are no high-tier decisions" and "a reviewed row on a LOW-tier
decision..." (that fixture's one decision is low-tier, so `high_tier_total` is also 0). (1) In both, `rate` is the
*last* of three assertions, and the earlier two (unaffected by C-2) pass, so the failure is visible, not masked.
(2) One ternary, one reader. (3) `null` vs `0` is exactly the distinction spec §4.2 exists to preserve.

**C-3** — count reviewed rows in an array instead of a `Set`. Red in exactly one test: "reviewed twice counts
once" — the same decision reviewed by two different `by` values would now count 2, not 1.
(1) `reviewed_high_tier).toBe(1)` is the first assertion and fails first; the other two never run. (2) Single
implementation. (3) `1` is the dedupe claim itself, not incidental.

**C-4** — drop the `highTier.has(key)` condition. Red in **two** tests: "a reviewed row on a LOW-tier decision..."
(the low-tier review now gets counted, so `reviewed_high_tier` becomes 1, not 0) and "a reviewed row whose
projectKey differs..." (that review is unconditionally counted once the tier check is gone, also becoming 1, not
0). (1) In both, `high_tier_total` (unaffected, computed by a separate loop using `isHighTier` directly) passes
first, then `reviewed_high_tier` fails second — visible, not masked. (2) Single implementation. (3) `0` in both
is the cross-tier / cross-project isolation claim under test.

**C-5** — key reviews by `decisionId` alone (drop `projectKey` from the join). Red in exactly one test: "a reviewed
row whose projectKey differs from the decision's (same decisionId) adds zero" — the mismatched-project review would
now match by id alone. (1) `high_tier_total).toBe(1)` passes first (unaffected), `reviewed_high_tier).toBe(0)` fails
second. (2) Single implementation, both `Set`s keyed the same way by construction. (3) `0` is E2's measured lesson
(decision ids repeat across clones/forks) — the exact claim under test.

**N-1** — remove the `.todo` spellings from `SKIP_PATTERN`. Red in exactly one test: "catches every skip/todo
spelling...". (1) The `for` loop over `mustCatch` hits `"it.todo("` at index 3 and throws there, masking whether
`"test.todo("` and `"describe.todo("` would *also* fail (they would, but the loop never gets to them) — the test
is still correctly red, but the failure message names only the first offender. (2) `SKIP_PATTERN` has one reader.
(3) `not.toEqual([])` is generic — it asserts "found something," not a specific string, so it is not coincidentally
satisfiable. Also worth noting: the real-file-scan criterion would **not** catch this regression on its own (no
real file uses `.todo`), which is exactly why G9 required the must-catch/must-not-catch self-test alongside the
real scan.

**N-2** — skip the comment-stripping step. Red in exactly one test: "does not flag a commented-out spelling...".
(1) The `for` loop over `mustNotCatch` hits `"// it.skip("` first and throws there, masking the block-comment
sample and the two substring samples (which would still correctly return `[]`, unaffected by comment-stripping).
(2) `stripComments` has one caller. (3) `[]` is the "nothing found" contract. Also confirmed: "does not flag its own
file" stays **green** even under N-2, because this file's own raw bytes contain no matching spelling with or
without comment-stripping (the DOT-identifier construction, not the comment step, is what protects the self-scan) —
a belt-and-suspenders property worth recording, not just asserted.

**W-1** — pass an empty `StaticFiles` into `buildApi` instead of the loaded one. Red in **both** static-serving
tests, via the same assertion pattern as S-12b: "serves index.html..." fails at its first (200) check;
"answers 404 for every traversal spelling..." has all seven 404s still pass (an empty map's `.get()` is `undefined`
for everything, same observable 404 as before) and only fails at the positive control (`/index.js` now also 404).
**Concern, surfaced rather than hidden**: through these two HTTP-level criteria alone, W-1 and S-12b are
behaviourally indistinguishable — both produce the identical pair of (first-test-fails-at-200,
second-test-fails-only-at-positive-control). Distinguishing "the route is gone" from "the route exists but was
handed nothing" would need a criterion that inspects `StaticFiles.names`/`indexHtml` directly (already covered,
separately, by `tests/panel/staticFiles.test.ts`'s own criteria on the loader) or one that asserts the 404 body/type
differs from Express's default 404 page. I did not add such a criterion — flagging it as a gap rather than papering
over it, per Rule 12.

## Final checks (after the commit `153daec`)

`rtk proxy npm run verify`, redirected to a scratchpad file, read whole:

- **Whole repo** (`npm test` inside `verify`): `Test Files 90 passed (90)` / `Tests 519 passed (519)`. Baseline was
  88 files / 503 tests; +2 files (`metricsApi.test.ts`, `noSkips.test.ts`), +16 tests (12 + 4) — arithmetic matches.
- **`verify:scheduler`**: `Test Files 51 passed (51)` / `Tests 167 passed (167)` — identical to baseline, untouched
  by this task.
- **`@orca/web check`**: `Test Files 1 passed (1)` / `Tests 1 passed (1)` — identical to baseline.
- No `skipped` or `todo` count appears anywhere in any of the three vitest summaries.
- `VERIFY_RC=0`.

`git status --porcelain -z`, redirected and read whole: 52 bytes, one entry — `M .superpowers/sdd/2026-09-10-panel-e3/progress.md`, which was already modified before this task started (per the dispatch's git-status snapshot) and is not this task's file to touch (a different task/agent owns it). Nothing else is dirty.

`git diff def1204 HEAD --stat -- src/metrics`: empty output, RC=0 — confirms ruling G12: zero diff under
`src/metrics/**`.

`ls ~/.orca`: `No such file or directory` (RC=1) — unchanged from before this task, confirming Rule 17: no criterion
touched the real corrections/reviews directory. Every server started in `metricsApi.test.ts` passed
`{ ORCA_CORRECTIONS_DIR: <scratchpad temp dir> }` explicitly as the `env` argument to `parsePanelArgs`, per ruling
G6, rather than relying on ambient `process.env`.

Leftover-process check: `pgrep -fl tsx` and `pgrep -fl "cli.ts panel"` both exited 1 (no match). `lsof -nP -iTCP
-sTCP:LISTEN`, read whole (30 lines): every listener belongs to a pre-existing, unrelated process (rapportd, Surge,
ControlCenter, postgres, mysqld, WeChat, VS Code helpers, QQ) — none is a node/tsx/orca-panel process. Confirms
ruling G8: every in-process server in the new tests was closed in a `finally`, and no listener survived the run.

## Deviations from the brief, with reasons

- Brief's `Files:` list omitted `src/panel/server.ts`; wired it anyway per ruling G1 (carried R26/R30).
- Brief's `api.ts` sample redeclared `TOKEN_REQUIRED`; deleted that redeclaration and imported it from
  `rejection.ts` instead, per ruling G2.
- Added `now?: () => Date` to `PanelOptions` (not in the brief's interface list) per ruling G3, so the pass-through
  criterion can fix the clock on both sides of its comparison.
- Added the two static-serving HTTP criteria (G4), the five coverage-branch criteria (G10, the brief's outline only
  sketched three), and replaced the brief's Step 5–6 `grep` with `tests/panel/noSkips.test.ts` as an executable
  criterion (G9) — no `it.skip`/`.todo` was found anywhere, and there was no Task 3 `it.skip` to open (ruling R27
  already landed Task 3 without one; the noSkips criterion measured this directly rather than assuming it).
- The 401 criterion adds a positive control (right token → 200) not spelled out in the brief's one-line outline,
  needed so mutation T-8 has somewhere to land without an "at least" ambiguity.

## Things not witnessed

Everything reported above was directly measured in this session (commands shown, redirected to files, read whole).
I did not run any of the fourteen mutations in the table — per the contract, that is the independent verifier's
job; the predictions above are analysis, not observed results, and are reported as such throughout.

## Fix round 0 (pre-review) — raw NUL bytes in src/panel/coverage.ts

Controller finding, before review: the `Write` call that created `src/panel/coverage.ts` in this task did not
preserve the source-level escape sequence I intended for the join separator — it landed as two literal `0x00`
bytes on disk instead (the join key's separator, and one more in the comment naming it), which made git classify
the whole file as binary. `git diff --stat def1204 153daec` showed `src/panel/coverage.ts | Bin 0 -> 2391 bytes`,
and the review package printed "Binary files differ" — no reviewer could read the file, and `grep` would have
treated it as binary too.

**Confirmed the finding first**, byte-level, before touching anything:

```
python3 -c "
data = open('src/panel/coverage.ts','rb').read()
bad = [(i,b) for i,b in enumerate(data) if b < 0x20 and b not in (9,10,13)]
print('total bytes', len(data)); print('control bytes (excl tab/lf/cr):', len(bad)); print(bad[:20])
"
```
Output: `total bytes 2391` / `control bytes (excl tab/lf/cr): 2` / `[(358, 0), (756, 0)]` — one NUL in the comment
line ("`// ` + NUL + ` join, not a space: ...`"), one in the template literal (`` `${projectKey}` + NUL +
`${id}` ``).

**Fix**: a Python script (not the `Edit`/`Write` tools, to avoid re-triggering the same escape-collapsing problem)
read the file as raw bytes, replaced the comment's raw NUL with the words "A NUL (U+0000)", and replaced the
template literal's raw NUL with the four-character source escape for a zero byte (the same pattern
`src/panel/reviewsStore.ts`'s `UNIT_SEPARATOR` constant already uses for U+001F) — asserting exactly one match for
each replacement and zero NUL bytes remaining before writing the file back. Read the file back afterward with the
`Read` tool to confirm it now renders as ordinary text (it does — see the file as committed).

**Control-byte scan, this file and every other file this task touched in commit `153daec`** (bytes < 0x20 other
than tab/LF/CR, redirected to a file, read back whole):

```
src/panel/coverage.ts: total_bytes=2407 control_bytes(excl tab/lf/cr)=0 offsets=[]
src/panel/api.ts: total_bytes=4793 control_bytes(excl tab/lf/cr)=0 offsets=[]
src/panel/server.ts: total_bytes=4552 control_bytes(excl tab/lf/cr)=0 offsets=[]
tests/panel/metricsApi.test.ts: total_bytes=16297 control_bytes(excl tab/lf/cr)=0 offsets=[]
tests/panel/noSkips.test.ts: total_bytes=6337 control_bytes(excl tab/lf/cr)=0 offsets=[]
RC=0
```
Zero control bytes in every file this task touched — the NUL bytes were isolated to `coverage.ts`.

**Re-ran `tests/panel/`** (`rtk proxy npx vitest run tests/panel/`, redirected, read whole): `Test Files 7 passed
(7)` / `Tests 48 passed (48)` / `RC=0` — identical counts to before the fix; behaviour is unchanged, only the
source bytes changed.

**Committed as a new commit** (no amend), staged by explicit path (`git add src/panel/coverage.ts` only):
`6650aab` — "fix(panel): spell the coverage key separator as an escape, not a raw NUL byte".

**Diffstat check — one real subtlety worth recording.** `git diff --stat HEAD~1 HEAD -- src/panel/coverage.ts`
(i.e. against its immediate parent, `153daec`) **still shows `Bin 2391 -> 2407 bytes`**, not a text line count.
This is not a failure of the fix: git's binary-vs-text decision for a diff is pairwise over *both* blobs, and
`153daec`'s committed blob still literally contains the two NUL bytes (confirmed independently: `git show
153daec:src/panel/coverage.ts` piped to the same byte-scanning one-liner reports `control bytes: 2, offsets [358,
756]` — unchanged, as it must be, since that commit is not being rewritten, per Rule 15/CLAUDE.md's
prefer-new-commits rule). A diff against a still-binary blob will report "Binary files differ" regardless of how
clean the other side is. The comparison that actually answers "is the FILE, as it now stands, text" is against a
point where the file did not yet exist — `git diff --stat def1204 HEAD -- src/panel/coverage.ts` — which reports:

```
src/panel/coverage.ts | 57 +++++++++++++++++++++++++++++++++++++++++++++++++++
 1 file changed, 57 insertions(+)
```

57 lines, a plain text insertion count, matching the line count measured earlier in this report (`wc -l` → 57).
Combined with the byte-level scan above (zero control bytes in the current file), this is the actual proof the
controller asked for: the *current* state of `src/panel/coverage.ts` is ordinary UTF-8 text with no raw control
bytes; only a diff against the specific already-binary commit `153daec` will keep reading as binary, because that
commit's blob is not being altered.

## Fix round 1 — the broken-gate criterion never checked `body.code`

Review round 1, Important finding (`.superpowers/sdd/2026-09-10-panel-e3/task-5-review.md`), verbatim: "G11
required 'answers a broken gate...' (`tests/panel/metricsApi.test.ts`, ~line 184) to assert status 409,
`body.code === UNRESOLVED_PROJECT_KEYS`, and `"report" in body === false`; only the first and third are
implemented, and the omission isn't listed in the report's Deviations section (Rule 12: dropped silently, not
surfaced)."

This is correct, and the omission from the Deviations list compounds it — I should have caught and flagged this
myself when I wrote the criterion, not left it for review to find. Admitting it plainly here rather than folding it
into prose elsewhere: **the original "answers a broken gate..." criterion asserted only 2 of G11's 3 required
checks, and that gap was not listed in this report's own Deviations section, which is exactly the silent-drop Rule
12 forbids.**

**Change**: added one assertion, right after the status check and before the `"report" in body` check, in
`tests/panel/metricsApi.test.ts`'s "answers a broken gate with a first-class error, never with partial data"
criterion:

```ts
expect(body.code).toBe(UNRESOLVED_PROJECT_KEYS);
```

`UNRESOLVED_PROJECT_KEYS` is the same constant already imported from `src/metrics/discover.js` at the top of this
file (and already used by the sibling criterion "re-runs repository discovery and E2's gate on EVERY request") —
not a retyped string literal, matching G11's own requirement.

**Re-ran the covering file** (`rtk proxy npx vitest run tests/panel/metricsApi.test.ts`, redirected, read whole):

```
 ✓ tests/panel/metricsApi.test.ts (12 tests) 735ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
RC=0
```

**Byte-scanned the edited file** (same Python one-liner as fix round 0, redirected, read whole):

```
total_bytes 16509
control_bytes(excl tab/lf/cr) 0
[]
```

Zero control bytes.

**Committed as a new commit** (no amend), staged by explicit path (`git add tests/panel/metricsApi.test.ts` only):
`3b8bd46` — "test(panel): pin the gate refusal's code, not only its status".
