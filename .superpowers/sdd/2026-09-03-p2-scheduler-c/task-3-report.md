# Task 3 report — write-set normalisation + directory-trie intersection

Commit: `7f5a683` — `feat(scheduler): decide path intersection by containment, not by string prefix`

## What was implemented

- `src/scheduler/writeSet.ts` (new): `ClaimedPath`, `normalizeClaim`, `writeSetOf`.
  `writeSetOf` reads `contract.context.targetPaths` and
  `contract.safetyPolicy.allowlistPaths` off an opaque `unknown`, defaulting
  missing/non-array fields to `[]`, and normalizes each declared string.
- `src/scheduler/pathTrie.ts` (new): `ConflictKind`, `PathConflict`,
  `classify`, `intersect`, plus the private `segments`/`contains` helpers —
  transcribed verbatim from the brief's Step 3 code block, including its
  comments. `ConflictKind`/`PathConflict` (not given a home in the brief)
  were placed in `pathTrie.ts` since that is where the conflict vocabulary is
  produced; `ClaimedPath` is imported from `./writeSet.js`.
- `tests/scheduler/writeSet.test.ts`: the brief's `normalizeClaim` describe
  block verbatim, plus two additional tests for `writeSetOf` (union of the
  two fields; defaults to `[]` when both are missing) — `writeSetOf` has no
  criteria in the brief's Step 1 and no named mutation in Step 5, so these
  are baseline coverage only, not mutation-hardened.
- `tests/scheduler/pathTrie.test.ts`: the brief's `intersect` describe block
  verbatim, with a local `c(declared)` helper (`= normalizeClaim(declared)`,
  not given explicitly in the brief but implied by its use).

## TDD evidence

**RED** — command:
```
npx vitest run tests/scheduler/writeSet.test.ts tests/scheduler/pathTrie.test.ts
```
Real output (both files fail to load, 0 tests collected, RC=1):
```
 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ❯ tests/scheduler/writeSet.test.ts (0 test)
 ❯ tests/scheduler/pathTrie.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/scheduler/pathTrie.test.ts [ tests/scheduler/pathTrie.test.ts ]
 FAIL  tests/scheduler/writeSet.test.ts [ tests/scheduler/writeSet.test.ts ]
Error: Failed to load url ../../src/scheduler/writeSet.js (resolved id: ../../src/scheduler/writeSet.js) in /Users/biran/code/skills/loop/Orca/tests/scheduler/pathTrie.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

 Test Files  2 failed (2)
      Tests  no tests
RC=1
```
Expected because `src/scheduler/writeSet.ts` and `src/scheduler/pathTrie.ts`
did not exist yet.

**GREEN** — same command after implementing both modules:
```
 RUN  v2.1.9 /Users/biran/code/skills/loop/Orca

 ✓ tests/scheduler/writeSet.test.ts (6 tests) 2ms
 ✓ tests/scheduler/pathTrie.test.ts (7 tests) 2ms

 Test Files  2 passed (2)
      Tests  13 passed (13)
RC=0
```

**`npm run verify`** — full run, RC=0. The overall vitest suite grew from 131
to 144 tests (11 files, 144 passed) — the +13 from this task. The seven
`downgraded to tier 0` lines for `.decisions/orca-dev-09cc3ea1.jsonl` print as
expected (by design, per decision context #6) and the run still exits 0.

## Mutation table

All six mutations were applied one at a time in a `git clone --local` copy at
`/private/tmp/.../scratchpad/orca-mutate` (symlinked `node_modules` from the
main tree), run against
`npx vitest run tests/scheduler/pathTrie.test.ts tests/scheduler/writeSet.test.ts`,
then reverted from a saved pristine copy before the next mutation. The main
worktree was never touched during mutation (see restoration proof below).

### `M-TRIE` 🔴 — replace `contains`'s body with `inner.startsWith(outer)`

Patch (against `src/scheduler/pathTrie.ts`):
```diff
 function contains(outer: string, inner: string): boolean {
-  const o = segments(outer);
-  const i = segments(inner);
-  if (o.length > i.length) return false;
-  return o.every((seg, idx) => seg === i[idx]);
+  return inner.startsWith(outer);
 }
```
Output file: `M-TRIE.txt`. Result: **1 of 13 red** — `does not confuse a
sibling whose name is a string prefix` (`src/a` vs `src/ab.ts` now reads as
`new-inside-old` instead of no conflict). All 12 other criteria — including
`equal`, both containment directions, `**`, and "lists every conflict" —
stayed green. This is the load-bearing proof: a string-prefix implementation
passes everything else and only fails the one case a segment comparison is
for.

### `M-TRIE-b` 🔴 — delete both `contains` branches in `classify`, leaving only `equal`

Patch:
```diff
 export function classify(a: ClaimedPath, b: ClaimedPath): ConflictKind | null {
   if (a.normalized === b.normalized) return "equal";
-  if (contains(b.normalized, a.normalized)) return "new-contains-old";
-  if (contains(a.normalized, b.normalized)) return "new-inside-old";
   return null;
 }
```
Output file: `M-TRIE-b.txt`. Result: **4 of 13 red** — the two named
criteria (`reports a directory that contains someone else's leaf`,
`reports a leaf that falls inside someone else's directory`) both went red as
predicted, plus two more that also depend on containment being non-trivial
(`says a bare ** intersects everything`, `lists every conflicting path, not
just the first`) — expected collateral, since both fixtures rely on a
non-`equal` classification existing at all.

### `M-TRIE-c` ⚠️ — delete only the `"new-contains-old"` diagnosis-name branch

Patch:
```diff
 export function classify(a: ClaimedPath, b: ClaimedPath): ConflictKind | null {
   if (a.normalized === b.normalized) return "equal";
-  if (contains(b.normalized, a.normalized)) return "new-contains-old";
   if (contains(a.normalized, b.normalized)) return "new-inside-old";
   return null;
 }
```
Output file: `M-TRIE-c.txt`. Result: **2 of 13 red**, not the 1-red-1-green
shape the brief predicted in isolation. `reports a directory that contains
someone else's leaf` went red as named. `reports a leaf that falls inside
someone else's directory` **stayed green**, exactly as predicted — confirming
the two cases share one judgement and differ only in diagnosis name.
Additionally, `lists every conflicting path, not just the first` also went
red: that fixture (`src/a.ts`, `src/b.ts` vs `src/**`) is itself a
`new-contains-old` scenario and depends on the same deleted branch, so its
count drops from 2 to 0. This is not a contradiction of the brief's model —
it is a second, unnamed consumer of the same deleted branch — but it means
the actual blast radius of this mutation is one criterion wider than the
table's "喂它的场景／判据" column names. **Registering as instructed: this is
a mutation of the diagnosis name/branch that cases ② and ③ share, not of the
underlying judgement** — the judgement itself is pinned by `M-TRIE` and
`M-TRIE-b`, not by this row.

### `M-TRIE-d` 🔴 — make `intersect`'s inner loop return on first hit

Patch:
```diff
   for (const x of a) {
     for (const y of b) {
       const kind = classify(x, y);
       // Every conflicting pair, never just the first: a caller who fixes one
       // and re-runs to find the next is a caller the tool is wasting.
-      if (kind !== null) out.push({ kind, a: x, b: y });
+      if (kind !== null) {
+        out.push({ kind, a: x, b: y });
+        return out;
+      }
     }
   }
```
Output file: `M-TRIE-d.txt`. Result: **1 of 13 red** — exactly
`lists every conflicting path, not just the first` (2 expected, got 1). All
others green.

### `M-NORM` 🔴 — `normalizeClaim("**")` returns `"**"` instead of `""`

Patch (against `src/scheduler/writeSet.ts`):
```diff
 export function normalizeClaim(declared: string): ClaimedPath {
-  const normalized = declared.endsWith("**") ? declared.slice(0, -2) : declared;
+  const normalized = declared === "**" ? "**" : declared.endsWith("**") ? declared.slice(0, -2) : declared;
   return { normalized, declared };
 }
```
Output file: `M-NORM.txt`. Result: **2 of 13 red** — the named criterion
`says a bare ** intersects everything` (pathTrie.test.ts) went red as
predicted, and the direct unit test in writeSet.test.ts,
`normalizes a bare ** to the repository root`, also caught it (same mutation
site, exercised at both layers — expected, not a surprise).

### `M-DECL` 🔴 — don't preserve `declared`

Patch:
```diff
 export function normalizeClaim(declared: string): ClaimedPath {
   const normalized = declared.endsWith("**") ? declared.slice(0, -2) : declared;
-  return { normalized, declared };
+  return { normalized, declared: normalized };
 }
```
Output file: `M-DECL.txt`. Result: **1 of 13 red** — exactly
`keeps the declared string for diagnostics`. All others green.

## Restoration proof

`shasum -a 256` of the four touched files, recorded before any mutation and
re-measured on the main worktree after all six mutations were reverted in the
clone:

```
== before ==
d8eb5f7f179a66a021c373d344b45be4d48e25daf65e2aa5032592f9749a559b  src/scheduler/writeSet.ts
a33c46477e42a019279049b1e8a6a17731dee57f1b04a20e8bd9f11dcaf5f4ce  src/scheduler/pathTrie.ts
430dcf2a2072fe395e3f30a741314f8580d1401bd4ccac481d276fdc2c8bbc70  tests/scheduler/writeSet.test.ts
1fb477d7e4cf88b73ec2af965792faa8277acfe91223aa72327a56ba43f812fc  tests/scheduler/pathTrie.test.ts
== after ==
d8eb5f7f179a66a021c373d344b45be4d48e25daf65e2aa5032592f9749a559b  src/scheduler/writeSet.ts
a33c46477e42a019279049b1e8a6a17731dee57f1b04a20e8bd9f11dcaf5f4ce  src/scheduler/pathTrie.ts
430dcf2a2072fe395e3f30a741314f8580d1401bd4ccac481d276fdc2c8bbc70  tests/scheduler/writeSet.test.ts
1fb477d7e4cf88b73ec2af965792faa8277acfe91223aa72327a56ba43f812fc  tests/scheduler/pathTrie.test.ts
```
Identical. `git status --porcelain` on the main worktree was empty after
mutation testing (checked before the commit, and the main worktree was not
touched at all during the clone-based mutation phase, which ran after the
commit). All six mutations were applied and reverted only inside the
`git clone --local` copy at
`/private/tmp/claude-501/.../scratchpad/orca-mutate`; its `node_modules`
symlink was removed with `/bin/rm -f` before the clone directory was removed
with `/bin/rm -rf`.

Per decision context #7, `M-TRIE`'s stated feeding scenario is S2
(end-to-end), which does not exist yet — Task 5/10 build it. This report
covers the unit-level red proof only, run against `tests/scheduler/pathTrie.test.ts`.

## Files changed

- `src/scheduler/writeSet.ts` (new)
- `src/scheduler/pathTrie.ts` (new)
- `tests/scheduler/writeSet.test.ts` (new)
- `tests/scheduler/pathTrie.test.ts` (new)

No other files touched. `.decisions/`, `src/ledger/`, `scripts/githooks/` not
touched, per decision context #6.

## Self-review findings

- Checked for the two known bad shapes (Rule 9 warning):
  - No assertion in either test file reads back a value the test itself just
    wrote before the call under test — every assertion is downstream of a
    call to `normalizeClaim`/`writeSetOf`/`intersect`.
  - Each `it()`'s assertions measure exactly what its name claims (verified
    by the mutation table above — every mutation reddened the criterion
    whose name matches what it broke, or was explicitly noted where it also
    hit an unnamed neighbour).
- `writeSetOf` has no criteria in the brief and no named mutation in Step 5.
  I added two modest tests for it (union behaviour, missing-field default)
  as baseline coverage since it is a new exported function, but did not
  invent a mutation for it — the brief's mutation table is exactly six rows
  and I did not add a seventh. Flagging this as a coverage gap relative to
  the rest of the file, not a defect: `writeSetOf`'s real exercise, per the
  plan doc, is Task 4's graph construction and the later end-to-end
  scenarios.
- `ConflictKind`/`PathConflict` needed a home the brief didn't specify (it
  lists them under Task 3's combined "Produces" without saying which file).
  Placed them in `pathTrie.ts` since `classify`/`intersect` produce them and
  nothing outside this task needs them from `writeSet.ts`. `ClaimedPath` is
  the interface `writeSet.ts` needs to export since `normalizeClaim` and
  `writeSetOf` produce it.
- No adjacent code was touched; `planFile.ts`, `sandbox.ts`, and
  `verify-scheduler.mjs` are all unmodified (confirmed via `git status`
  before commit — only the four new files were staged).

## Concerns

- `M-TRIE-c`'s actual blast radius (2 red, not the 1-red/1-stays-green shape
  as an isolated pair) is wider than the brief's table names, though it does
  not change the underlying claim (cases ② and ③ share one judgement) — see
  the `M-TRIE-c` section above for the exact accounting. Recorded honestly
  rather than reconciled to fit the table.
- `writeSetOf` is implemented per the one-line contract in decision context
  #4 but is untested by mutation (only unit-tested); this is consistent with
  the brief providing no criteria or mutation for it, but is worth Task 4
  reviewers knowing.

---

# Fix round 1

Commit: `77d34a8` — `fix(scheduler): resolve . and .. before classifying a claim's path prefix`

## The finding

`normalizeClaim` compared raw path segments verbatim, with no `.`/`..`
resolution: `src/foo/../bar/x.ts` against `src/bar/**`, and `./src/**`
against `src/**`, both answered "disjoint" for a genuinely overlapping
pair — the unsafe direction spec §3.1 warns against. Ruled: fix it, since
this is a hole in the plan's own algorithm (inherited verbatim from the
brief), not a defect introduced by this task.

## Fix

`src/scheduler/writeSet.ts`, `normalizeClaim`:
```diff
+import { posix } from "node:path";
+
 /**
  * A claimed path as a task declares it (its raw string), plus the same claim
@@
 /**
  * Spec 3.3: a claim collapses to the path prefix it actually restricts.
  * "src/**" claims the src/ directory, not a literal path ending in "**", so
  * it normalizes to "src/". A bare "**" claims the repository root — every
  * path is inside the root — so it normalizes to the empty prefix, which
- * pathTrie's segment comparison already treats as containing everything, for
- * free. Anything else (no glob suffix) is already a prefix in its own right
- * and is kept whole.
+ * pathTrie's segment comparison already treats as containing everything, for
+ * free. An empty-string claim is the same repository-root case (a task that
+ * declares no restriction at all), so it also normalizes to the empty
+ * prefix. Anything else (no glob suffix) is already a prefix in its own
+ * right and is kept whole.
+ *
+ * Both root cases are handled before path.posix.normalize runs, not after:
+ * normalize("") returns ".", which would turn "claims the whole repository"
+ * into "claims a directory literally named .". contains() would then answer
+ * false where it used to answer true (the ** claim would stop swallowing
+ * everything) — the unsafe direction spec 3.1 warns against — so the empty
+ * prefix must never reach normalize().
+ *
+ * pathTrie's `contains` compares path segments verbatim; it does not resolve
+ * "." or "..". Without resolving them here, "src/foo/../bar/x.ts" and
+ * "src/bar/x.ts" name the same file but produce different segment lists, so
+ * intersect() would answer "disjoint" for a genuinely overlapping pair —
+ * the unsafe direction. path.posix.normalize also strips a leading "./" for
+ * free, so "./src/**" and "src/**" normalize identically.
  */
 export function normalizeClaim(declared: string): ClaimedPath {
-  const normalized = declared.endsWith("**") ? declared.slice(0, -2) : declared;
-  return { normalized, declared };
+  if (declared === "**" || declared === "") {
+    return { normalized: "", declared };
+  }
+  const prefix = declared.endsWith("**") ? declared.slice(0, -2) : declared;
+  return { normalized: posix.normalize(prefix), declared };
 }
```
`declared` is untouched in every branch — only `normalized` changes.
`classify`, `contains`, `intersect` in `pathTrie.ts` were not touched, per
the ruling's instruction to keep the change minimal and inside
`normalizeClaim`.

## New criteria

`tests/scheduler/writeSet.test.ts` — added:
```diff
   it("keeps the declared string for diagnostics", () => {
     // Without this, src/a.ts is reported as having claimed "src/a.ts/**", a
     // directory that does not exist, and the diagnosis reads as a tool bug.
     expect(normalizeClaim("src/**").declared).toBe("src/**");
   });
+
+  it("treats an empty string as the repository root, like a bare **", () => {
+    // A task that declares no restriction at all claims everything, same as
+    // "**". This must be handled as its own case rather than falling through
+    // to path.posix.normalize("") — that returns ".", which would turn
+    // "claims the whole repository" into "claims a directory literally named
+    // .", the unsafe direction (fix round 1, Important finding).
+    expect(normalizeClaim("").normalized).toBe("");
+  });
 });
```

`tests/scheduler/pathTrie.test.ts` — added (the existing "says a bare **
intersects everything" criterion was left untouched rather than duplicated,
per the ruling):
```diff
   it("says a bare ** intersects everything", () => {
     expect(intersect([c("**")], [c("anything/at/all.txt")]).length).toBe(1);
   });
+
+  it("says an empty-string claim intersects everything, like a bare **", () => {
+    // A task that declares no restriction at all is the repository-root
+    // case, same as "**" — it must not be read as claiming nothing.
+    expect(intersect([c("")], [c("anything/at/all.txt")]).length).toBe(1);
+  });
+
+  it("resolves a leading ./ so it intersects the same claim written without it", () => {
+    // ./src/** and src/** name the same directory. Before fix round 1, the
+    // leading "./" survived normalization verbatim, so the two segment lists
+    // never matched and this pair was answered "disjoint" — the unsafe
+    // direction spec 3.1 warns against.
+    expect(intersect([c("./src/**")], [c("src/a.ts")]).length).toBe(1);
+  });
+
+  it("resolves .. so a claim that walks out and back in intersects its real target", () => {
+    // src/foo/../bar/x.ts and src/bar/x.ts name the same file. Before fix
+    // round 1, contains() compared raw segments (["src","foo","..","bar",
+    // "x.ts"] vs ["src","bar"]) and never matched — a genuinely overlapping
+    // pair answered "disjoint".
+    expect(intersect([c("src/foo/../bar/x.ts")], [c("src/bar/**")]).length).toBe(1);
+  });
```

## RED-before-fix proof (extra verification, not explicitly required but done for rigor)

Before committing the fix, I temporarily restored the pre-fix
`src/scheduler/writeSet.ts` (via `git show HEAD:...` from the commit that
predates this fix, `7f5a683`) with the new test files already in place, and
ran:
```
npx vitest run tests/scheduler/writeSet.test.ts tests/scheduler/pathTrie.test.ts
```
Real output — exactly the two new bug-reproducing criteria went red, the
empty-string and bare-`**` criteria (already correct pre-fix) stayed green:
```
 ✓ tests/scheduler/writeSet.test.ts (7 tests) 2ms
 ❯ tests/scheduler/pathTrie.test.ts (10 tests | 2 failed) 6ms
   × intersect (spec 3.2) > resolves a leading ./ so it intersects the same claim written without it 3ms
     → expected +0 to be 1 // Object.is equality
   × intersect (spec 3.2) > resolves .. so a claim that walks out and back in intersects its real target 0ms
     → expected +0 to be 1 // Object.is equality

 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 15 passed (17)
RC=1
```
The fixed `writeSet.ts` was then restored and diffed byte-identical against
the saved fixed copy before proceeding.

## GREEN

```
npx vitest run tests/scheduler/writeSet.test.ts tests/scheduler/pathTrie.test.ts
```
```
 ✓ tests/scheduler/writeSet.test.ts (7 tests) 2ms
 ✓ tests/scheduler/pathTrie.test.ts (10 tests) 3ms

 Test Files  2 passed (2)
      Tests  17 passed (17)
RC=0
```

`npm run verify` — RC=0. Overall vitest suite grew from 144 to 148 (the four
new criteria: empty-root in writeSet.test.ts, empty-root/leading-./../.. in
pathTrie.test.ts). The seven `downgraded to tier 0` lines print as before
and are not in scope.

## Mutation `M-NORM-DOT`

Applied in a fresh `git clone --local` copy at
`/private/tmp/.../scratchpad/orca-mutate2` (cloned from the fix commit
`77d34a8`), symlinked `node_modules`, reverted before deleting.

Patch (delete the resolution step only, replace with the raw prefix):
```diff
   const prefix = declared.endsWith("**") ? declared.slice(0, -2) : declared;
-  return { normalized: posix.normalize(prefix), declared };
+  return { normalized: prefix, declared };
```

Output file: `M-NORM-DOT.txt`. Result: **2 of 17 red**, exactly the two
mutation-targeted criteria:
```
 ✓ tests/scheduler/writeSet.test.ts (7 tests) 2ms
 ❯ tests/scheduler/pathTrie.test.ts (10 tests | 2 failed) 7ms
   × intersect (spec 3.2) > resolves a leading ./ so it intersects the same claim written without it 3ms
     → expected +0 to be 1 // Object.is equality
   × intersect (spec 3.2) > resolves .. so a claim that walks out and back in intersects its real target 0ms
     → expected +0 to be 1 // Object.is equality

 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 15 passed (17)
RC=1
```
All 15 other criteria — including the empty-string and bare-`**`
repository-root cases, which are handled before the resolution step and do
not depend on it — stayed green, confirming the root-case guard and the
dot-resolution step are independent code paths as intended.

## Restoration proof

```
== before ==
cd5015377920a2b6b1ebe96849184b323e5e7a6d75c5ea7e30e9b9fdb64585a1  src/scheduler/writeSet.ts
1fbaabeb1f6eb4cb0d5a3eae5621d48e7ff70be0b195b4bf70434b6756a7d631  tests/scheduler/writeSet.test.ts
98682fb0fedefafd01264d9b244f1338e4be1572f5304528c8556c64ed15b3e4  tests/scheduler/pathTrie.test.ts
== after ==
cd5015377920a2b6b1ebe96849184b323e5e7a6d75c5ea7e30e9b9fdb64585a1  src/scheduler/writeSet.ts
1fbaabeb1f6eb4cb0d5a3eae5621d48e7ff70be0b195b4bf70434b6756a7d631  tests/scheduler/writeSet.test.ts
98682fb0fedefafd01264d9b244f1338e4be1572f5304528c8556c64ed15b3e4  tests/scheduler/pathTrie.test.ts
```
Identical. `git status --porcelain` on the main worktree was empty
throughout. The clone's `node_modules` symlink was removed with
`/bin/rm -f` before the clone directory was removed with `/bin/rm -rf`.

## Deferred (not touched this round, per ruling)

- `writeSetOf` concatenates rather than deduplicating (over-reports a
  conflict twice — the safe direction).
- A leading `/` yields a `new-contains-old` diagnosis where `equal` would
  read better.
- The empty-string claim's behaviour was previously undocumented; this
  round's docstring update (see patch above) now documents it as a
  consequence of fixing the Important finding, per the ruling's allowance.

## Files changed this round

- `src/scheduler/writeSet.ts` (modified)
- `tests/scheduler/writeSet.test.ts` (modified: +1 criterion)
- `tests/scheduler/pathTrie.test.ts` (modified: +3 criteria)

No other files touched.
