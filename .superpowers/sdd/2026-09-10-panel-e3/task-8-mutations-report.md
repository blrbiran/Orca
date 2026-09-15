# Task 8 — independent mutation verification report

Repo `/Users/biran/code/skills/loop/Orca`. Commit under test: `0f506c874bf727cf457c9c95b1731955fe288d32` (`0f506c8`).
Verifier did not write this code (task 8, "add the E3 web frontend and GET /api/todo"). Every mutation below was
applied in its own throwaway `git clone --local` copy (`/usr/bin/git clone --local --quiet` + `checkout --quiet
0f506c874bf...`, then `node_modules` and `web/node_modules` symlinked from the main tree), never in the main tree.
Edits were made by a Python harness (`mutrun.py` in the scratchpad) that asserts each anchor/pattern matches
**exactly once**, requires the sha256 to change, and byte-scans every touched file afterward. No `git stash`, no
`reset`, no `checkout` in the main tree.

**Runners, per mutation** (all three per the brief):
1. root criteria: `./node_modules/.bin/vitest run tests/panel` (cwd = clone root)
2. web criteria: `../node_modules/.bin/vitest run` (cwd = clone's `web/`) — confirmed every run's `RUN` line pointed
   into the clone (see below) and used `web/vite.config.ts`'s `test.include` (`tests/**/*.test.tsx`)
3. typechecks: `./node_modules/.bin/tsc --noEmit -p tsconfig.json` (root) and `../node_modules/.bin/tsc --noEmit -p
   tsconfig.json` (web)

## Baseline (unmutated, at 0f506c8)

- root vitest: RC=0, `Test Files 11 passed (11)`, `Tests 74 passed (74)`. `RUN` line:
  `RUN  v2.1.9 /private/var/.../tmpkfyygqjz/orca` — inside the clone.
- web vitest: RC=0, `Test Files 5 passed (5)`, `Tests 9 passed (9)`. `RUN` line pointed into `.../orca/web`.
- root tsc: RC=0. web tsc: RC=0.
- `cmp`/`diff -rq` of `tests/panel/` and `web/tests/` (clone vs main tree): empty both times — no drift.
- Leftover `tsx`/`src/cli.ts` processes: none. `lsof -nP -iTCP -sTCP:LISTEN` after: only pre-existing, unrelated
  system listeners (rapportd, Surge, ControlCenter, postgres, mysqld, WeChat, Code Helper, QQ — none loopback-only
  node/vitest, none introduced by the run). `ls ~/.orca`: absent before and after.
- All green, as required before trusting any mutation result.

## Per-mutation results

### F-4 — `MetricsView` renders `numerator/denominator` as a percent instead of `rate_excluding_stale`

- File: `web/src/MetricsView.tsx`. sha256 before `bd07848...80f9`, after `834c4ac...e3c6e` (differ). Byte-scan: 0.
- Diff: `{formatRate(report.correction_rate.rate_excluding_stale)}` →
  `{formatRate(report.correction_rate.numerator_corrections_excluding_stale / report.correction_rate.denominator_decisions)}`.
- RCs: root vitest 0, web vitest **1**, root tsc 0, web tsc 0.
- root vitest: 11/11 files, 74/74 tests passed (unaffected — this is a web-only mutation).
- web vitest: `Test Files 1 failed | 4 passed (5)`, `Tests 2 failed | 7 passed (9)`. Failing, full names:
  - `MetricsView (spec section 4.1) > renders the rate the server sent, never one of its own` —
    `AssertionError: expected '<section><h2>Correction rate</h2><p d…' to contain '99'` (`web/tests/metricsView.test.tsx:77`).
  - `MetricsView (spec section 4.1) > prints the whole report even when a line was malformed` —
    same assertion, same file, `toContain("99")` at `web/tests/metricsView.test.tsx:97`.
- Matched: exactly the implementer's prediction ("renders the rate..." AND "prints the whole report..." — both
  `toContain("99")`, nothing else). Under the fixture (3/10 vs 0.99) a computed rate renders "30%" and "99" appears
  nowhere else in the markup, so both `it`s fail on the same literal; the second `it`'s malformed-count assertion
  is never reached (short-circuits after the "99" check) but the `it` itself still counts red.

### F-4b — `MetricsView` stops rendering all 7 of E2's annotations (not the panel's own coverage rate/caveat)

- File: `web/src/MetricsView.tsx`, 7 sequential anchor deletions (correction-rate caveats `<ul>`, repair-rate
  caveats `<ul>`, stale-bias `<p>`, review-coverage-reason `<p>`, unresolved-count `<p>`, malformed-count `<p>`,
  excluded-as-future `<p>`) — `panel-coverage-rate` / `panel-coverage-caveat` untouched. sha256 before
  `bd07848...80f9`, after `8038fa0...e6fdb` (differ). Byte-scan: 0. Diff shown in the harness output; net effect
  removes exactly those 7 `<p>`/`<ul>` blocks.
- RCs: root vitest 0, web vitest **1** (of files), root tsc 0, web tsc 0.
- web vitest: `Test Files 1 failed | 4 passed (5)`, `Tests 2 failed | 7 passed (9)`. Failing:
  - `shows every one of E2's annotations, each with its own visible text` — `AssertionError: expected '...' to
    contain 'no producer has run yet'` (`web/tests/metricsView.test.tsx:84`).
  - `prints the whole report even when a line was malformed` — `AssertionError: expected '...' to match
    /malformed[^<]*3/i` (`web/tests/metricsView.test.tsx:98`).
  - `shows the coverage caveat next to the coverage number, not somewhere else` stayed **green** — its string is
    `coverage.caveat` ("read it with the backlog"), rendered on a separate, untouched line (`panel-coverage-caveat`),
    never one of the 7 removed items.
- Matched: exactly the implementer's prediction (2, not the brief's illustrative "3") — Q2 answers who else reads
  each line: `coverage.rate`/`coverage.caveat` are the panel's own `PanelCoverage`, a different render point from
  E2's 7 named annotations (confirmed by the implementer's own survey grep and now by direct measurement).

### F-4c — `MetricsView` stops rendering only `review_coverage.reason`

- File: `web/src/MetricsView.tsx`, one block removed (`review-coverage-reason` `<p>`). sha256 before
  `bd07848...80f9`, after `0f63e0a...034bab`. Byte-scan: 0.
- RCs: root vitest 0, web vitest **1**, root tsc 0, web tsc 0.
- web vitest: `Tests 1 failed | 8 passed (9)`. Failing:
  - `shows every one of E2's annotations, each with its own visible text` — `AssertionError: expected '...' to
    contain 'no producer has run yet'` (`web/tests/metricsView.test.tsx:84`).
- Matched: exactly 1, as predicted. No other `it` reads `review_coverage.reason` (`review-coverage-reason` is its
  own line, distinct from `panel-coverage-caveat`).

### F-5 — the null-rate formatter prints `0%` for null

- File: `web/src/MetricsView.tsx`. `formatRate`'s body changed from `rate === null ? UNKNOWN_RATE : ...` to
  `` `${((rate ?? 0) * 100).toFixed(0)}%` `` (prints `0%` for null, unchanged for non-null). sha256 before
  `bd07848...80f9`, after `d2b011c...1db1906c`. Byte-scan: 0.
- RCs: root vitest 0, web vitest **1**, root tsc 0, web tsc 0.
- web vitest: `Tests 1 failed | 8 passed (9)`. Failing:
  - `renders a null coverage rate as unknown, not as zero` — `AssertionError: expected '...' not to match /\b0%/`
    (`web/tests/metricsView.test.tsx:112`).
- Matched: exactly 1, as predicted. `formatRate` is shared by correction rate / repair rate / coverage rate, but
  only the null-coverage `it`'s fixture passes `null`; `panelHome.test.tsx`'s fixture also carries `rate: null` but
  never inspects rate text.

### F-6 — `DecisionList` renders every key of the row object instead of only `WEB_LIST_FIELDS`

- File: `web/src/DecisionList.tsx`. `{WEB_LIST_FIELDS.map((field) => (` →
  `{(Object.keys(row) as Array<keyof DecisionListRow>).map((field) => (`. sha256 before `80491c3...5f443`, after
  `978ddb6...d3a7d7ce`. Byte-scan: 0.
- RCs: root vitest 0, web vitest **1**, root tsc 0, web tsc 0 (the cast keeps this well-typed at BASE, where
  `DecisionListRow`'s own keys are all `Object.keys(row)` would ever normally produce).
- web vitest: `Tests 1 failed | 8 passed (9)`. Failing:
  - `DecisionList (task 8 ruling K6) > renders only the list fields, never an extra field on the row` —
    `AssertionError: expected '...' not to contain 'a reasoning value that must never lea…'`
    (`web/tests/decisionList.test.tsx:27`).
- Matched: exactly 1, as predicted. `panelHome.test.tsx`'s todo rows carry no extra field, so iterating
  `Object.keys(row)` there renders the same 6 fields either way — no second red.

### P-8 — web `WEB_LIST_FIELDS` gains `"question"`

- File: `web/src/types.ts`. Appended `"question"` to the `WEB_LIST_FIELDS` array (still under
  `as const satisfies readonly (keyof DecisionListRow)[]`). sha256 before `ea5296f...e50ff`, after
  `6b8982b...af7b4`. Byte-scan: 0.
- RCs: root vitest **1**, web vitest **1**, root tsc **2**, web tsc **2**.
- root vitest: `Test Files 1 failed | 10 passed (11)`, `Tests 1 failed | 73 passed (74)`. Failing:
  - `web/src/types.ts stays in lockstep with the server shapes (task 8 ruling K2) > WEB_LIST_FIELDS is the same SET
    as LIST_FIELDS` — `AssertionError: expected [ 'at', 'id', 'kind', …(4) ] to deeply equal [ 'at', 'id', 'kind',
    …(3) ]` (`tests/panel/webParity.test.ts:34`).
- web vitest: `Tests 1 failed | 8 passed (9)`. Failing:
  - `DecisionList (task 8 ruling K6) > renders only the list fields, never an extra field on the row` —
    `AssertionError: expected '...' not to contain 'a reasoning value that must never lea…'`
    (`web/tests/decisionList.test.tsx:27`) — because `DecisionList` iterates `WEB_LIST_FIELDS`, not a hardcoded
    list, so the mutation also makes it render `row.question` for `decisionList.test.tsx`'s fixture row, which
    deliberately carries one.
- root tsc: `web/src/types.ts(182,3): error TS2322: Type '"question"' is not assignable to type '"at" | "id" |
  "scope" | "kind" | "projectKey" | "verdict"'.` (RC=2).
- web tsc: same TS2322 at `src/types.ts(182,3)`, plus `src/DecisionList.tsx(28,25): error TS7053: Element
  implicitly has an 'any' type ... Property 'question' does not exist on type 'DecisionListRow'.` (RC=2).
- Matched (extends the table): the table's terse row says "red in the root runtime parity criterion... only";
  the implementer's own report predicted the fuller picture — 2 runtime reds (parity test AND `DecisionList`'s own
  criterion) plus **both typechecks breaking**, because `WEB_LIST_FIELDS` is typed against `DecisionListRow` via
  `satisfies`. Measured exactly as the implementer predicted, confirming their caveat that the table undercounts
  this one.

### P-8b — rename `rate_excluding_stale` → `rate` inside the web `CorrectionRate` type, followed in the view and (at least) one web fixture

Two readings were measured because the mutation's own wording ("follow it ... in the web fixture", singular) is
ambiguous: there turn out to be **two** web-side fixtures that construct a `CorrectionRate` object literal —
`web/tests/metricsView.test.tsx` (named by the implementer's K3 fixture) and `web/tests/panelHome.test.tsx` (its
own, separately-typed, self-consistent fixture for the H-1/ordering criterion — not named anywhere in the task-8
report or brief).

**Reading A — only `web/tests/metricsView.test.tsx` follows the rename** (the narrower, literal reading):
- Files: `web/src/types.ts` (`rate_excluding_stale: number | null;` → `rate: number | null;` inside `CorrectionRate`
  only — disambiguated from `CorrectionRateSlice`/`CorrectionRateBucket`'s own same-named field by anchoring on the
  following `corrections_total_including_stale` line), `web/src/MetricsView.tsx` (follow the rename),
  `web/tests/metricsView.test.tsx` (follow the rename in K3's fixture). sha256s: types.ts `ea5296f...e50ff` →
  `429e4b5...8abd716`; MetricsView.tsx `bd07848...80f9` → `8eeb91c...026b1dbe1`; metricsView.test.tsx
  `1828179...58ad15` → `b29f140...245aae1c`. Byte-scan: 0 for all three.
- RCs: root vitest 0, web vitest 0, root tsc **2**, **web tsc 2**.
- root tsc: `tests/panel/webParity.test.ts(41,3)` and `(44,3)`: `TS2322`, "Property 'rate' is missing in type
  ...CorrectionRate" / "Property 'rate_excluding_stale' is missing in type ...CorrectionRate" — the
  `reportServerToWeb`/`reportWebToServer` mutual-assignability functions, exactly the file the implementer
  predicted.
- web tsc: `tests/panelHome.test.tsx(20,5): error TS2353: Object literal may only specify known properties, and
  'rate_excluding_stale' does not exist in type 'CorrectionRate'.`
- root/web vitest: both fully green (94→ no, scoped: 11/11 and 5/5 files, 74/74 and 9/9 tests) — the rename doesn't
  reach any assertion, only a type position.
- **Differs from the implementer's prediction** ("web typecheck ... green"): under this reading, web tsc also goes
  red. Q2 answers why: `web/tests/panelHome.test.tsx` independently types its own `MetricsReport` fixture (for the
  H-1 ordering criterion) and still carries the old field name — a second reader of `CorrectionRate` the
  implementer's report never named. This is not a short-circuit (Q1 doesn't apply — it's a compile error, not a
  runtime assertion) and the literal is the type-checker's own field name, not a fixture string (Q3).

**Reading B — `web/tests/panelHome.test.tsx`'s fixture also follows the rename** (adding a 4th edit,
`rate_excluding_stale: 0,` → `rate: 0,` at `web/tests/panelHome.test.tsx:20`; sha256 `d09f2bd...451605f` →
`0398e9f...48b48a5903fa`, byte-scan 0):
- RCs: root vitest 0, web vitest 0, root tsc **2**, **web tsc 0**.
- root tsc: same two `webParity.test.ts` errors as Reading A.
- web tsc: clean.
- **Matched** the implementer's prediction exactly once all web-side `CorrectionRate` literals follow the rename,
  not just the one the report's K3 section named.

Both readings share `criteria_diff` on `web/tests/*`: Reading A's clone differs from the main tree only in
`metricsView.test.tsx` (the file the mutation is defined to touch); Reading B's clone additionally differs in
`panelHome.test.tsx` — both differences are the mutation's own defined effect (P-8b explicitly edits a fixture),
not contamination, and `tests/panel/` matched byte-for-byte in both.

### T-1 — `unreviewedHighTier` ignores reviews

- File: `src/panel/coverage.ts`. `return decisions.filter((d) => isHighTier(d.scope, d.kind) &&
  !reviewed.has(keyOf(d.projectKey, d.id)));` → `return decisions.filter((d) => isHighTier(d.scope, d.kind));`.
  sha256 before `909e400...9772c54`, after `a52498e...4cd6356c`. Byte-scan: 0.
- RCs: root vitest **1**, web vitest 0, root tsc 0, web tsc 0.
- root vitest: `Test Files 1 failed | 10 passed (11)`, `Tests 2 failed | 72 passed (74)`. Failing:
  - `unreviewedHighTier (task 8 ruling K5, pure) > (a) excludes a high-tier decision that carries a \`reviewed\` row`
    — `AssertionError: expected [ { projectKey: 'proj', …(5) } ] to deeply equal []` (`tests/panel/todo.test.ts:89`).
  - `GET /api/todo (task 8 ruling K5, HTTP) > (e) answers with exactly the unreviewed high-tier decision, deep-equal
    to its LIST_FIELDS projection, and records nothing` — `AssertionError: expected [ { projectKey: 'proj', …(5) },
    …(1) ] to strictly equal [ { projectKey: 'proj', …(5) } ]` (`tests/panel/todo.test.ts:153`).
- Matched: exactly (a) AND (e), as predicted. (b)/(c)/(d) unaffected — matches the implementer's per-case reasoning.

### T-2 — `unreviewedHighTier` treats `opened` as reviewed

- File: `src/panel/coverage.ts`. Dropped `if (r.action !== "reviewed") continue;` from the reviewed-set loop (every
  review row, including `opened`, now counts). sha256 before `909e400...9772c54`, after `67c3d30...b699a315360`.
  Byte-scan: 0.
- RCs: root vitest **1**, web vitest 0, root tsc 0, web tsc 0.
- root vitest: `Tests 1 failed | 73 passed (74)`. Failing:
  - `unreviewedHighTier (task 8 ruling K5, pure) > (b) keeps a high-tier decision whose only row is \`opened\`` —
    `AssertionError: expected [] to deeply equal [ { projectKey: 'proj', …(5) } ]` (`tests/panel/todo.test.ts:95`).
- Matched: exactly (b), as predicted. (e) records no `opened` row, so unaffected.

### T-3 — `unreviewedHighTier` drops the tier condition

- File: `src/panel/coverage.ts`. `return decisions.filter((d) => isHighTier(d.scope, d.kind) &&
  !reviewed.has(...));` → `return decisions.filter((d) => !reviewed.has(...));`. sha256 before `909e400...9772c54`,
  after `b81c285...15a6e01f4`. Byte-scan: 0.
- RCs: root vitest **1**, web vitest 0, root tsc 0, web tsc 0.
- root vitest: `Tests 1 failed | 73 passed (74)`. Failing:
  - `unreviewedHighTier (task 8 ruling K5, pure) > (c) excludes a low-tier decision even with no review row at all`
    — `AssertionError: expected [ { projectKey: 'proj', …(5) } ] to deeply equal []` (`tests/panel/todo.test.ts:100`).
- Matched: exactly (c), as predicted. Both decisions in (e) are already high-tier, so dropping the check changes
  nothing observable there.

### T-4 — `unreviewedHighTier` keys reviews by decision id alone

- File: `src/panel/coverage.ts`, two edits: `reviewed.add(keyOf(r.projectKey, r.decisionId));` →
  `reviewed.add(r.decisionId);`, and `!reviewed.has(keyOf(d.projectKey, d.id))` → `!reviewed.has(d.id)`. sha256
  before `909e400...9772c54`, after `461d9dc...d10901de26`. Byte-scan: 0.
- RCs: root vitest **1**, web vitest 0, root tsc 0, web tsc 0.
- root vitest: `Tests 1 failed | 73 passed (74)`. Failing:
  - `unreviewedHighTier (task 8 ruling K5, pure) > (d) a \`reviewed\` row for the same id under another projectKey
    does not exclude it` — `AssertionError: expected [] to deeply equal [ { projectKey: 'proj-a', …(5) } ]`
    (`tests/panel/todo.test.ts:106`).
- Matched: exactly (d), as predicted. (e)'s two decisions have different ids under the same projectKey, so id-only
  keying still separates them correctly there.

### H-1 — `PanelHome` renders the metrics view before the todo list

- File: `web/src/PanelHome.tsx`. Moved `<MetricsView .../>` above the `<h1>`+`<DecisionList>` block. sha256 before
  `b916cf7...6883e40`, after `175f047...555f267e`. Byte-scan: 0.
- RCs: root vitest 0, web vitest **1**, root tsc 0, web tsc 0.
- web vitest: `Tests 1 failed | 8 passed (9)`. Failing:
  - `PanelHome (task 8 ruling K5) > shows the todo rows' ids, with the todo heading before the metrics heading` —
    `AssertionError: expected 37 to be greater than 816` (`web/tests/panelHome.test.tsx:54`).
- Matched: exactly 1, as predicted. No other `it` in the suite checks ordering.

## Cross-cutting checks (every mutation, including baseline and both P-8b readings — 14 runs total)

- **Anchor/hash discipline**: every edit's exactly-once anchor/pattern assertion held (no run needed a second
  attempt); every touched file's sha256 changed; every `edits_applied` list matches the intended mutation.
- **Byte-scan**: 0 bytes below 0x20 (excluding tab/LF/CR) in every touched file, every run — no NUL or other
  control-byte leaked into any edit script, heredoc, or Write.
- **`RUN` line**: every root and web vitest invocation's header line named a path under that run's own
  `/private/var/.../tmpXXXXXXXX/orca` clone (spot-checked all 14; example above for baseline) — never the main
  tree.
- **Criteria untouched**: `diff -rq` of the clone's `tests/panel/` against the main tree's was empty in all 14
  runs; `diff -rq` of `web/tests/` was empty in 12 of 14 (baseline and every mutation except P-8b's two readings,
  where the mutation's own definition edits `web/tests/metricsView.test.tsx` and, in reading B,
  `web/tests/panelHome.test.tsx` — expected, not criteria contamination, since P-8b explicitly follows the rename
  "in the web fixture").
- **Process census**: `ps -axo pid,ppid,pgid,command` before/after every vitest run, diffed for any surviving
  `tsx`/`src/cli.ts` process — none, in any of the 14 runs.
- **Listener census**: `lsof -nP -iTCP -sTCP:LISTEN` after every run — only pre-existing, unrelated system services
  (rapportd, Surge, ControlCenter, postgres, mysqld, WeChat, Code Helper/VS Code, QQ/QQEXDOC), identical set across
  every run; no new node/vitest listener, no non-loopback address introduced.
- **Unhandled errors**: no "Unhandled Rejection"/"Unhandled error" block in any vitest output, any run.
- **`~/.orca`**: absent before and after every one of the 14 runs (baseline, F-4, F-4b, F-4c, F-5, F-6, P-8, P-8b
  reading A, P-8b reading B, T-1, T-2, T-3, T-4, H-1).
- **Main tree**: never edited. `git rev-parse HEAD` = `0f506c874bf...` throughout.
  `git status --porcelain -z | wc -c` = 90 bytes before this run and 90 bytes after — the same two pre-existing
  controller entries (`M .superpowers/sdd/2026-09-10-panel-e3/progress.md`, `?? .decisions/orca-dev-5d5c8055.jsonl`)
  every time; nothing under `src/`, `tests/`, or `web/` ever appeared in it. Every clone's temp directory was
  removed (`shutil.rmtree` on the harness's own `mktemp -d` root) after each run; a listing of the OS temp
  directory afterward shows no leftover `tmpXXXXXXXX/orca` clone, only unrelated pre-existing `tmp.*` entries.

## Summary

| id | web/root RC (v/v/tsc/tsc) | failing | verdict |
|---|---|---|---|
| F-4 | 0/1/0/0 | 2 (both "...99" tests) | matched |
| F-4b | 0/1/0/0 | 2 (annotations, malformed) | matched (2, not brief's illustrative 3) |
| F-4c | 0/1/0/0 | 1 (annotations) | matched |
| F-5 | 0/1/0/0 | 1 (null-coverage) | matched |
| F-6 | 0/1/0/0 | 1 (list-only-fields) | matched |
| P-8 | 1/1/2/2 | 2 runtime + both typechecks | matched (implementer's fuller prediction) |
| P-8b (reading A: only K3 fixture) | 0/0/2/2 | 0 runtime, both typechecks | differs: web tsc also red — Q2, a second untouched web fixture (`panelHome.test.tsx`) |
| P-8b (reading B: both web fixtures) | 0/0/2/0 | 0 runtime, root tsc only | matched |
| T-1 | 1/0/0/0 | 2 ((a),(e)) | matched |
| T-2 | 1/0/0/0 | 1 ((b)) | matched |
| T-3 | 1/0/0/0 | 1 ((c)) | matched |
| T-4 | 1/0/0/0 | 1 ((d)) | matched |
| H-1 | 0/1/0/0 | 1 (ordering) | matched |

No fully-green (undetectable) mutation was found among the twelve. The one genuine finding is P-8b's ambiguity:
taken literally against only the fixture the task-8 report names, the mutation also breaks web's own typecheck
(an extra, unpredicted red) because a second web-side fixture (`web/tests/panelHome.test.tsx`) independently types
a `CorrectionRate` literal that the report never surveyed; extending the same rename to that second fixture
reproduces the implementer's predicted picture exactly. This is a scope gap in the K2/K3 survey, not a broken
mutation or a broken criterion.

## Fix round 1 (d44f6bb): K-8

Repo `/Users/biran/code/skills/loop/Orca`. Commit under test: `d44f6bb7bb3529144097a699ca8e0f2037a84d43` (`d44f6bb`,
"fix(panel): give DecisionList a collision-free row key" — review finding I-1 / controller ruling R60, replacing the
`rowKey` join `` `${projectKey}::${id}` `` with `JSON.stringify([projectKey, id])`). Independent re-verification of
this one fix, in its own throwaway `git clone --local` copy at `d44f6bb`, node_modules and web/node_modules symlinked
from the main tree, never touching the main tree. Only the web runner and the root typecheck were run for this
round, per the dispatch scope (root vitest and web typecheck were not run for K-8).

**Baseline (unmutated, at d44f6bb), web run only**:
- `cd "${C}/web" && ../node_modules/.bin/vitest run`: `RUN v2.1.9 /private/.../tmp.zn5u5UDwFA/orca/web` (inside the
  clone). `Test Files 5 passed (5)`, `Tests 10 passed (10)` — `panelHome.test.tsx` (1), `decisionList.test.tsx` (2),
  `decisionDetail.test.tsx` (1), `metricsView.test.tsx` (5), `App.test.tsx` (1). RC=0. Matches the implementer's
  "5 files / 10 tests". All green, as required before trusting the mutation.
- Process census (`ps -axo pid,ppid,pgid,command` before/after): no `tsx`/`src/cli.ts` process present after that
  wasn't before. `lsof -nP -iTCP -sTCP:LISTEN` after: 29 lines, all pre-existing unrelated system listeners
  (rapportd, Surge, ControlCenter, postgres, mysqld, WeChat, Code Helper, QQ/QQEXDOC) — no node/vitest listener, no
  non-loopback address introduced. No "Unhandled Rejection"/"Unhandled error" block. `ls ~/.orca`: absent before and
  after.

### K-8 — `rowKey` reverts to the old fixed-separator join

- File: `web/src/DecisionList.tsx`. Anchor `  return JSON.stringify([row.projectKey, row.id]);\n` matched exactly
  once (Python harness asserts count==1, exits non-zero otherwise). Replaced with
  `` `  return \`${row.projectKey}::${row.id}\`;\n` ``.
- sha256 before `0298b6552d1c964aeec71e8fc8626e47e5d82277f197aefc9e6d96e9fb409d43`, after
  `fd4ae9947e9832bbf1c6745e5c3b5b39202b123dd0fc32d102592fe0aea4f1f6` — differ. Byte-scan (bytes < 0x20 excluding
  tab/LF/CR): **0**.
- Diff:
  ```diff
   export function rowKey(row: Pick<DecisionListRow, "projectKey" | "id">): string {
  -  return JSON.stringify([row.projectKey, row.id]);
  +  return `${row.projectKey}::${row.id}`;
   }
  ```
- Web vitest RC: **1**. Root typecheck RC (`cd "${C}" && ./node_modules/.bin/tsc --noEmit -p tsconfig.json`): **0**
  — matches the "expected 0" landing (`DecisionList.tsx` and its test live under `web/`, outside the root
  `tsconfig.json`'s scope, so a web-only string-literal edit cannot redden it).
- Web vitest summary: `Test Files 1 failed | 4 passed (5)`, `Tests 1 failed | 9 passed (10)`.
- Failing criterion, full name and first (only) assertion failure:
  - `DecisionList (task 8 ruling K6) > gives two different keys to a pair that would collide under a fixed
    separator, and the same key twice to the same row` —
    `AssertionError: expected 'a::b::c' not to be 'a::b::c' // Object.is equality`
    (`web/tests/decisionList.test.tsx:46`, the `expect(rowKey(rowA)).not.toBe(rowKey(rowB))` line). The suite's
    other criterion, `renders only the list fields, never an extra field on the row`
    (`web/tests/decisionList.test.tsx:14-28`), stayed green — unaffected by this change, as expected.
  - Line 47 (`expect(rowKey(rowA)).toBe(rowKey(rowA))`, the same-row-same-key half) was never reached: vitest
    reports one failed assertion per `it`, and line 46 threw first, short-circuiting the `it` before line 47 could
    run. Under the mutated join this second assertion would still hold on its own (`rowKey(rowA) === rowKey(rowA)`
    trivially, same input both times) — consistent with the implementer's and controller's prediction that it
    "would hold" — but that could not be independently measured in this run because the `it` block stops at its
    first thrown assertion; confirmed by reading the mutated `rowKey` source, not by a separate execution.
- **Matched** exactly: red in the new rowKey criterion in `web/tests/decisionList.test.tsx` only, at its first
  (different-keys) assertion; no other file or criterion affected; nothing else in the run turned red.
- Census: no surviving `tsx`/`src/cli.ts` process after that wasn't present before. `lsof` listener set identical
  (byte-for-byte, `diff` empty) to the baseline's 29-line set — no new listener, no non-loopback address. No
  "Unhandled Rejection"/"Unhandled error" block. `ls ~/.orca`: absent before and after.
- Teardown: `diff -rq` of the clone's `tests/panel/` against the main tree's — empty. `diff -rq` of the clone's
  `web/tests/` against the main tree's — empty (the mutation touches only `web/src/DecisionList.tsx`, never a
  criterion file). Clone removed via `/bin/rm -rf "$(dirname "${C}")"`; confirmed gone.

**Main tree**: `git rev-parse HEAD` = `d44f6bb7bb3529144097a699ca8e0f2037a84d43` before and after this round.
`git status --porcelain -z | wc -c` = 90 bytes before and 90 bytes after (byte-for-byte identical via `cmp`) — the
same two pre-existing controller entries (`M .superpowers/sdd/2026-09-10-panel-e3/progress.md`,
`?? .decisions/orca-dev-5d5c8055.jsonl`); nothing under `src/`, `tests/`, or `web/` appeared in it at any point.
`ls ~/.orca`: absent before baseline, after baseline, before K-8, and after K-8 — four readings, all absent.

**Summary**: K-8 matched the controller's and implementer's shared prediction exactly — one red, in the collision
criterion's first assertion, root typecheck stays at 0. No unpinned criteria, no false red, no broken mutation.
