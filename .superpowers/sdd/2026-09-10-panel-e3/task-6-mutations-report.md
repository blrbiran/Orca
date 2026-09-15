# Task 6 — independent mutation verification report

Repo `/Users/biran/code/skills/loop/Orca`. Commit under test: `ea8c2bba156f6660a4a4f818f5af57805c01dc78` (`ea8c2bb`).
Every mutation ran in its own `git clone --local` at that commit, `node_modules`/`web/node_modules` symlinked from
the main tree, edited with an exactly-once-anchor python script (`mutate.py`), run with
`./node_modules/.bin/vitest run tests/panel`, then torn down. Full outputs are redirected to files and read back
whole; nothing piped/grepped for a verifying run. Scratch files under
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d5c8055-111d-4296-ad0c-e78a5b191f54/scratchpad/task6/`.

## Main-tree safety

- Before: `git status --porcelain -z` = 52 bytes (`M .superpowers/sdd/2026-09-10-panel-e3/progress.md` only).
  `git rev-parse HEAD` = `ea8c2bba156f6660a4a4f818f5af57805c01dc78`.
- After (all 9 mutations + baseline + one extra investigation run for L-3): porcelain still 52 bytes, byte-identical
  to the "before" file (`diff` empty); HEAD unchanged. `src/`, `tests/`, `web/`, `.decisions/` never appeared.
- Every mutation's teardown ran `diff -rq <clone>/tests/panel <main>/tests/panel`; all nine (plus baseline) returned
  `cmp_rc=0` — no mutation ever leaked into a criterion file.
- `ls ~/.orca` before and after every single mutation (9×2) plus the baseline and the extra investigation probe:
  always `No such file or directory`.
- No process whose command contains `src/cli.ts` or `tsx` appeared after a run that was not already present before
  (`ps -axo pid,ppid,pgid,command`, 1071 lines before/after in every run, 0 matches either side). `lsof -nP -iTCP
  -sTCP:LISTEN` after every run showed exactly one line matching `node|vitest` case-insensitively in every file —
  that line is the **column header** (`... NODE NAME`), not a process; zero actual node/vitest listeners in any
  run. No "Unhandled Rejection" / "Unhandled error" block appeared in any full run output (all nine plus baseline
  read whole).
- Byte-scan (bytes < 0x20 other than tab/LF/CR) on every edited file, every mutation: **0** in all cases (printed by
  `mutate.py` immediately after each write).

## Baseline (unmutated clone, same commit)

`Test Files 8 passed (8)` / `Tests 56 passed (56)`, RC=0. `RUN` line pointed into the clone's tmp path, confirmed.
This is the expected all-green baseline the brief requires before mutating.

## Mutations

For each: sha256 before/after (from `mutate.py`, which refuses to proceed if the anchor is not exactly-once or the
hash doesn't change), the diff, RC, vitest summary, and per failing criterion its full name and first assertion
failure.

### L-3 — list handler also appends an `opened` row for every listed decision

Anchor (`src/panel/api.ts`, exactly once): `res.json({ rows: observations.decisions.map(projectForList) });`
Hashes: `22561e36…362e` → `71706cd5…184f` (changed).

```diff
       res.json({ rows: observations.decisions.map(projectForList) });
+      // MUTATION L-3: list handler also appends an `opened` row for every
+      // listed decision.
+      for (const d of observations.decisions) {
+        void deps.reviews
+          .append({
+            decisionId: d.id,
+            projectKey: d.projectKey,
+            action: "opened",
+            by: deps.opts.by,
+            at: nowIso(deps.opts),
+          })
+          .catch(() => undefined);
+      }
     })().catch(next);
```

RC=0. `Test Files 8 passed (8)` / `Tests 56 passed (56)` — **fully green**.

**differs: false green, not a false red.** The controller/implementer predicted red in "records NOTHING when the
list is served"; the mutation ran fully green. Investigated with a standalone probe (same mutation, a small tsx
script hitting `/api/decisions` directly): the mutated write DOES happen — `readReviews(dir)` 500ms after the
response shows the appended `opened` row — but the criterion's own `readReviews(dir)` call runs *immediately* after
`get()` returns, with no `eventually()`/polling (unlike the sibling `records exactly one opened…` criterion, which
does poll). The list handler's mutated loop calls `void deps.reviews.append(...).catch(() => undefined)`
fire-and-forget, and `ReviewsWriter.append` does `await mkdir` → `await acquireReviewsLock` (its own `mkdir`) →
`await writeFile`/`appendFile` before the row lands on disk. On this host the client's `fetch()` round trip
consistently resolves and the test's synchronous `readReviews` call consistently completes before those awaits
land: repeated 8/8 on a fixed mutated clone (`for i in 1..8`), always `[]` at the immediate read, always the row
present 500ms later. This is not a rare race — it is a **reliable miss**: the criterion's own logic (no short-circuit
before it, nothing else walks the line) is exactly as the implementer described, but the mechanism it uses to
observe ("read right after the response, no poll") cannot catch this particular mutation on this host, ever, in the
runs performed. **This mutation survives — a fully green mutation, reported plainly per the brief's own instruction
("A fully green mutation is a finding, not a failure").** None of the three brief questions (short-circuit / who
else walks the line / literal's origin) explains it; the explanation is a timing gap between an unpolled assertion
and a fire-and-forget async write, which the brief's three questions don't have a slot for.

### L-3b — `projectForList` returns `{ ...decision, summary: decision.id.slice(0, 8) }`

Anchor (`src/panel/listProjection.ts`, exactly once): `  return row as DecisionListRow;`
Hashes: `6a12e645…c1ce` → `f14e7f9f…f97` (changed).

```diff
-  return row as DecisionListRow;
+  return { ...decision, summary: decision.id.slice(0, 8) } as unknown as DecisionListRow;
```

RC=1. `Test Files 1 failed | 7 passed (8)` / `Tests 1 failed | 55 passed (56)`.
Failing criterion (full name): **"the decisions endpoints (spec sections 4.2 and 4.3.1) > returns list rows
DEEP-EQUAL to the frozen projection, not merely lacking a summary"**. First failure: `tests/panel/decisionsApi.test.ts:90:29`,
`expect(body.rows).toEqual(expected)` — expected object without `summary`, received `"summary": "orca-dev"` added
on both rows.

**matched.** Exactly the one criterion predicted, at exactly the assertion the implementer's report named (the
`toEqual` at line 90, not the later `Object.keys` check — it never got to run because `toEqual` threw first, as the
implementer's report itself flagged as a correction to the controller notes' framing).

### W-6b — detail's `void deps.reviews.append(...)` becomes `await`ed and moved BEFORE `res.json`

Anchors (`src/panel/api.ts`, exactly once, one edit covering the whole moved block): the `res.json({ decision });`
through the `.catch((err: unknown) => {...});` block (lines 146–168 at BASE). Hashes: `22561e36…362e` →
`58b768dc…840` (changed).

```diff
+      await deps.reviews.append({
+        decisionId,
+        projectKey,
+        action: "opened",
+        by: deps.opts.by,
+        at: nowIso(deps.opts),
+      });
       res.json({ decision });
-      // 🔴 spec section 4.3.1: AFTER the response, never before. ...
-      void deps.reviews
-        .append({ ... })
-        .catch((err: unknown) => {
-          process.stderr.write(`orca panel: could not record opened for ${decisionId}: ${String(err)}\n`);
-        });
```
(catch removed, so the awaited call throws through rather than warning after the fact — the smallest edit with the
table's meaning: "becomes awaited and moves before res.json.")

RC=1. `Test Files 1 failed | 7 passed (8)` / `Tests 1 failed | 55 passed (56)`.
Failing criterion: **"...serves the detail while the reviews lock is held, and the failed opened write is only a
server-side warning"**. First failure: `tests/panel/decisionsApi.test.ts:197:30`, `expect(res.status).toBe(200)` —
received 409.

**matched**, including the mechanism: status 409 through `PanelRejection` (thrown by
`acquireReviewsLock` after its 1000ms retry budget) caught by `err instanceof PanelRejection` in `api.ts`'s error
handler.

### O-1 — the `opened` append's `.catch` body becomes `() => undefined`

Anchor (`src/panel/api.ts`, exactly once): the `void deps.reviews... .catch((err: unknown) => {...});` block.
Hashes: `22561e36…362e` → `cd6e6f0c…6cd` (changed).

```diff
-        .catch((err: unknown) => {
-          process.stderr.write(`orca panel: could not record opened for ${decisionId}: ${String(err)}\n`);
-        });
+        .catch(() => undefined);
```

RC=1. `Test Files 1 failed | 7 passed (8)` / `Tests 1 failed | 55 passed (56)`.
Failing criterion: **"...serves the detail while the reviews lock is held, and the failed opened write is only a
server-side warning"**. First failure: `tests/panel/decisionsApi.test.ts:211:24`, `expect(seen).toBe(true)` —
received `false` (the `eventually(...)` stderr-warning poll timed out at 3000ms).

**matched**, at the stderr-warning assertion as predicted. No "Unhandled Rejection"/"Unhandled error" block appeared
anywhere in the (whole, unfiltered) run output — the silent `.catch(() => undefined)` fully absorbs the rejection.

### K-6 — `opened.at` uses `new Date().toISOString()` instead of the panel clock

Anchor (`src/panel/api.ts`, exactly once): `          at: nowIso(deps.opts),` (the detail handler's append call
only — `currentMetrics`'s clock read is a different literal, `now: () => nowIso(opts)`, so this anchor does not
touch it). Hashes: `22561e36…362e` → `75d896b3…31b` (changed).

```diff
-          at: nowIso(deps.opts),
+          at: new Date().toISOString(),
```

RC=1. `Test Files 1 failed | 7 passed (8)` / `Tests 1 failed | 55 passed (56)`.
Failing criterion: **"...records exactly one `opened` when a detail is served, and no `reviewed`"**. First failure:
`tests/panel/decisionsApi.test.ts:164:33`, `expect(mine(rows)[0]).toMatchObject({...})` — `at` received
`2026-09-15T15:50:37.959Z` (real wall clock) vs expected `2026-09-10T00:00:00.000Z` (the fixed `opts.now`).

**matched**, exactly and only this criterion.

### R-6b — detail handler wraps its whole body in `withStoreLock(deps.opts.correctionsDir, …)`

Two anchors in `src/panel/api.ts`, applied in one mutation: (1) import line, exactly once:
`import { computePanelCoverage } from "./coverage.js";` → adds `import { withStoreLock } from
"../corrections/storeLock.js";` on the next line. Hashes: `22561e36…362e` → `92c41372…570`. (2) handler wrapper,
exactly once: `void (async () => {` → `void withStoreLock(deps.opts.correctionsDir, async () => {`, and `    })().catch(next);\n  });` →
`    }).catch(next);\n  });` (both inside the `/api/decision` route only — the anchor text is the full detail-handler
block, so it cannot match the sibling `/api/decisions` or `/api/metrics` handlers). Hashes: `92c41372…570` →
`ceb6ca3a…ea2`.

```diff
   app.get("/api/decision", (req, res, next) => {
-    void (async () => {
+    void withStoreLock(deps.opts.correctionsDir, async () => {
       ...
-    })().catch(next);
+    }).catch(next);
   });
```

RC=1. `Test Files 1 failed | 7 passed (8)` / `Tests 1 failed | 55 passed (56)`.
Failing criterion: **"...serves the detail even when the CORRECTIONS lock is held"**. First failure:
`tests/panel/decisionsApi.test.ts:240:30`, `expect(res.status).toBe(200)` — received 500.

**matched**, including the mechanism: `withStoreLock` throws `CorrectRejection` (not `MetricsRejection`/
`PanelRejection`), which the shared error handler's `instanceof` check does not match, so it falls to the default
500 branch — exactly as predicted, and the sibling reviews-lock criterion (a different lock, different directory)
stayed green (it's in the passing 7).

### D-1 — detail's not-found branch answers 200 `{ decision: null }`

Anchor (`src/panel/api.ts`, exactly once): the `if (decision === undefined) { res.status(404)...; return; }` block.
Hashes: `22561e36…362e` → `82a31695…fab` (changed).

```diff
       if (decision === undefined) {
-        res.status(404).json({ code: DECISION_NOT_FOUND, message: `no decision ${decisionId}` });
+        res.status(200).json({ decision: null });
         return;
       }
```

RC=1. `Test Files 1 failed | 7 passed (8)` / `Tests 1 failed | 55 passed (56)`.
Failing criterion: **"...answers 404 for a decision it has never seen, and for a known id under an unconfigured
projectKey"**. First failure: `tests/panel/decisionsApi.test.ts:265:36`, `expect(neverSeen.status).toBe(404)` —
received 200 (first request in the `it`, so its own second request never ran).

**matched**, exactly and only this criterion.

### D-2 — membership and repo lookup match on decision id alone (projectKey ignored; first match wins)

Anchor (`src/panel/api.ts`, exactly once): the `known`/`repo` two-line block (`observations.decisions.some(...)` /
`observations.repos.find(...)`). Hashes: `22561e36…362e` → `27453680…5fc` (changed).

```diff
-      const known = observations.decisions.some(
-        (d) => d.projectKey === projectKey && d.id === decisionId,
-      );
-      const repo = known ? observations.repos.find((r) => r.projectKey === projectKey) : undefined;
+      const owningDecision = observations.decisions.find((d) => d.id === decisionId);
+      const known = owningDecision !== undefined;
+      const repo = known ? observations.repos.find((r) => r.projectKey === owningDecision!.projectKey) : undefined;
```

RC=1. `Test Files 1 failed | 7 passed (8)` / `Tests 2 failed | 54 passed (56)` — **two failures, as predicted**.

1. **"...answers 404 for a decision it has never seen, and for a known id under an unconfigured projectKey"** —
   `tests/panel/decisionsApi.test.ts:269:39`, `expect(unconfigured.status).toBe(404)` — received 200 (the first
   sub-request in the `it`, the truly-never-seen id, still 404'd and passed; the second sub-request, the
   known-id-under-unconfigured-key one, is what reddens).
2. **"...returns each repository's own row when two repositories share a decision id"** —
   `tests/panel/decisionsApi.test.ts:310:43`, `expect(bodyB.decision.question).toBe("用哪种缓存")` — received
   `"用哪种锁"` (repo A's/`ORIGINAL`'s question — confirms "first match wins": `proj-a` sorts before `proj-b`, so
   the id-only lookup for `orca-dev-1/1` under key `proj-b` still resolves to `proj-a`'s row). `resA`'s own
   assertion passed first (no short-circuit before `resB`'s).

**matched — red in exactly these two criteria, matching both the controller's and the implementer's prediction.**

### D-3 — detail skips `currentMetrics`; finds the repo with `discoverRepos(deps.opts)` directly

Two anchors in `src/panel/api.ts`: (1) import, exactly once: `import { collect } from "../metrics/collect.js";` →
adds `import { discoverRepos } from "../metrics/discover.js";` on the next line. Hashes: `22561e36…362e` →
`25429db9…354`. (2) handler body, exactly once: `const { observations } = await currentMetrics(deps.opts);` plus the
`known`/`repo` block collapse to `const { repos } = await discoverRepos(deps.opts); const repo = repos.find((r) =>
r.projectKey === projectKey);`. Hashes: `25429db9…354` → `9ad0a411…c06`.

```diff
-      const { observations } = await currentMetrics(deps.opts);
-      const known = observations.decisions.some(
-        (d) => d.projectKey === projectKey && d.id === decisionId,
-      );
-      const repo = known ? observations.repos.find((r) => r.projectKey === projectKey) : undefined;
+      const { repos } = await discoverRepos(deps.opts);
+      const repo = repos.find((r) => r.projectKey === projectKey);
```

RC=1. `Test Files 1 failed | 7 passed (8)` / `Tests 1 failed | 55 passed (56)`.
Failing criterion: **"...answers the detail with the gate's refusal when the gate is broken"**. First failure:
`tests/panel/decisionsApi.test.ts:348:30`, `expect(res.status).toBe(409)` — received 200.

**matched**: `discoverRepos` alone never calls `enforceIntegrityGate` (that only happens inside `collect()`), so the
ghost correction's unresolvable projectKey never surfaces; the handler finds repo `"proj"` and the decision
normally and answers 200 instead of 409.

## Summary table

| id | RC | failing criteria | result |
|---|---|---|---|
| L-3 | 0 | 0 | **surviving mutation (false green) — reported as a finding, not matched** |
| L-3b | 1 | 1 | matched |
| W-6b | 1 | 1 | matched |
| O-1 | 1 | 1 | matched |
| K-6 | 1 | 1 | matched |
| R-6b | 1 | 1 | matched |
| D-1 | 1 | 1 | matched |
| D-2 | 1 | 2 | matched |
| D-3 | 1 | 1 | matched |

8 of 9 mutations matched the controller's and implementer's predictions exactly, including the two multi-branch
ones (D-2's two criteria, R-6b's/W-6b's distinct error-handler branches). One (L-3) is a genuine surviving mutant:
the code change is real and does write an `opened` row on every list request, but the "records NOTHING when the
list is served" criterion cannot observe it because it reads the reviews store synchronously right after the
response, with no polling, and the fire-and-forget write reliably loses that race on this host (confirmed both by
8 repeated runs of the mutated criterion, all green, and by a direct probe showing the row lands ~500ms later,
after the store read that would have caught it already ran).

## Fix round 1 re-run (248f03a)

Independent re-verification of fix round 1, commit `248f03a0f89ade88fd930c5df0ed62a36de6b5a8` (`test(panel): repair
the list criterion's dead assertion, and poll for absence`), per this session's dispatch. Same method as above: each
mutation in its own `git clone --local` at this commit, `node_modules`/`web/node_modules` symlinked from the main
tree, edited by `mutate.py` (an exactly-once-anchor script that refuses to proceed on 0 or ≥2 matches or an
unchanged hash, and byte-scans the file after every write), run with `./node_modules/.bin/vitest run tests/panel`,
outputs redirected to files and read whole. Scratch files under
`/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d5c8055-111d-4296-ad0c-e78a5b191f54/scratchpad/task6r1/`.

### Main-tree safety

- Before: `git status --porcelain -z` = 52 bytes (`M .superpowers/sdd/2026-09-10-panel-e3/progress.md` only).
  `git rev-parse HEAD` = `248f03a0f89ade88fd930c5df0ed62a36de6b5a8`.
- After (baseline + L-3's three runs + L-3b): porcelain still 52 bytes, byte-identical to the "before" file (`cmp`
  clean); HEAD unchanged. `src/`, `tests/`, `web/`, `.decisions/` never appeared.
- Every clone's teardown compared its `tests/panel/` file list against the main tree's (`find | sort`, identical)
  and then `cmp`'d every file individually: all three clones (baseline, L-3, L-3b) came back with only
  `FILELIST_SAME` and zero `DIFF:` lines — no mutation ever leaked into a criterion file.
- `ls ~/.orca`: absent before and after the baseline run, before and after each of L-3's three runs, and before and
  after the L-3b run — 8 readings total, all `No such file or directory`.
- Process census (`ps -axo pid,ppid,pgid,command`, before/after each run): zero lines containing `src/cli.ts` or
  `tsx` present after that were not present before, in every one of the 5 runs (baseline, L-3×3, L-3b).
  `lsof -nP -iTCP -sTCP:LISTEN` after every run: the only line matching `node|vitest` (case-insensitive) in any run
  was the column header (`COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME`) — zero actual listeners in any run.
  No "Unhandled Rejection"/"Unhandled error" block appeared in any of the 5 full run outputs.
- Byte-scan (bytes < 0x20 other than tab/LF/CR) on every edited file: **0** for both L-3 (`src/panel/api.ts`) and
  L-3b (`src/panel/listProjection.ts`), printed by `mutate.py` immediately after each write.

### Baseline (unmutated clone, same commit)

`Test Files 8 passed (8)` / `Tests 56 passed (56)`, RC=0. `RUN` line pointed into the clone's tmp path, confirmed.
"records NOTHING when the list is served" took 2224ms — consistent with waiting out the new bounded window
(`REVIEWS_LOCK_TIMEOUT_MS + 1_000` = 2000ms) before returning `[]`.

### L-3 — list handler also appends an `opened` row for every listed decision (re-run against the repaired criterion)

Same edit as the original L-3 (reused from `ea8c2bb`'s round, anchor unchanged): `src/panel/api.ts`, anchor
`res.json({ rows: observations.decisions.map(projectForList) });` (exactly once, line 111).
Hashes: `22561e36b5f84d56436d54541626673333a5a9b3de10531b48fe8bb08974362e` →
`71706cd5cd02074aa2c43dd44e77248ee944903f7112a379eba9e8c064b0184f` (changed, identical to the round-0 measurement —
same base file). Byte-scan: 0.

```diff
       res.json({ rows: observations.decisions.map(projectForList) });
+      // MUTATION L-3: list handler also appends an `opened` row for every
+      // listed decision.
+      for (const d of observations.decisions) {
+        void deps.reviews
+          .append({
+            decisionId: d.id,
+            projectKey: d.projectKey,
+            action: "opened",
+            by: deps.opts.by,
+            at: nowIso(deps.opts),
+          })
+          .catch(() => undefined);
+      }
     })().catch(next);
```

Run three times against the same mutated clone (brief permits "separate clones or the same clone re-run" for
repeatability). All three:

| run | RC | Test Files | Tests | failing criterion | first failure |
|---|---|---|---|---|---|
| 1 | 1 | 1 failed, 7 passed (8) | 1 failed, 55 passed (56) | "records NOTHING when the list is served" | `decisionsApi.test.ts:154:24`, `expect(rows).toHaveLength(0)` — expected 0, received 1 |
| 2 | 1 | 1 failed, 7 passed (8) | 1 failed, 55 passed (56) | same | same, `154:24`, expected 0 received 1 |
| 3 | 1 | 1 failed, 7 passed (8) | 1 failed, 55 passed (56) | same | same, `154:24`, expected 0 received 1 |

All three runs: **matched — exactly and only the controller's predicted criterion, at exactly its length-0
assertion, red every time (3/3).** The criterion's own message is `expected [ Array(1) ] to have a length of +0 but
got 1`; each run's failing test finished at ~193–201ms elapsed (well inside the 2000ms bounded window), because
`eventually()` returns as soon as its predicate (`r.length > 0`) is true rather than waiting out the full deadline —
the mutated write now reliably lands and is caught within the window on every run. This closes the round-0 finding:
the fix (bounding the observation window instead of reading once, immediately, with no poll) turns L-3 from a
100%-reproducible false green into a 100%-reproducible (3/3) red, at exactly the assertion the controller named.
No other criterion in the file reddened in any of the three runs.

Process/listener census, `~/.orca`, and byte-scan for this mutation are reported above (main-tree-safety section);
identical clean result on all three runs. Teardown: `tests/panel/` file-list and per-file `cmp` against the main
tree matched (`FILELIST_SAME`, no `DIFF:` lines); clone removed with `/bin/rm -rf "$(dirname "$C")"`, confirmed gone.

### L-3b — `projectForList` returns `{ ...decision, summary: decision.id.slice(0, 8) }` (re-run)

Same edit as the original L-3b (reused from `ea8c2bb`'s round, anchor unchanged): `src/panel/listProjection.ts`,
anchor `  return row as DecisionListRow;` (exactly once, line 31).
Hashes: `6a12e645158acaa6619a4e9783aa0fc24a98aafe60c082d8b5f04803f65ec1ce` →
`f14e7f9f44a2116d2dfa8664b6b5ca3d3c38e295d09823bd608d840aa4848f97` (changed, identical to the round-0 measurement).
Byte-scan: 0.

```diff
-  return row as DecisionListRow;
+  return { ...decision, summary: decision.id.slice(0, 8) } as unknown as DecisionListRow;
```

RC=1. `Test Files 1 failed | 7 passed (8)` / `Tests 1 failed | 55 passed (56)`.
Failing criterion (full name): **"the decisions endpoints (spec sections 4.2 and 4.3.1) > returns list rows
DEEP-EQUAL to the frozen projection, not merely lacking a summary"**. First failure:
`tests/panel/decisionsApi.test.ts:104:29`, `expect(body.rows).toStrictEqual(expected)` — expected objects without
`summary`, received `"summary": "orca-dev"` added on both rows.

**matched — exactly and only the predicted criterion, at exactly the assertion the round-0 report named.** The
sibling "records NOTHING when the list is served" criterion stayed green (2190ms — it waited out the full bounded
window, since L-3b writes no review row, and returned `[]` as expected).

### Fix round 1 summary

| id | runs | RC (each) | failing count (each) | result |
|---|---|---|---|---|
| L-3 | 3 | 1, 1, 1 | 1, 1, 1 | **matched, 3/3 — repaired: the surviving mutant from round 0 is now reliably caught** |
| L-3b | 1 | 1 | 1 | matched (unchanged from round 0 — anchor and behavior identical) |

Round 0's one open finding (L-3, a false green caused by an unpolled assertion racing a fire-and-forget write) is
resolved by this commit: the "records NOTHING when the list is served" criterion now uses a bounded
`eventually()` window sized off `REVIEWS_LOCK_TIMEOUT_MS`, and L-3 reddens at its intended assertion on 3 out of 3
independent runs, with no flakiness observed. L-3b is unaffected by this commit's changes (different file, different
criterion) and re-confirms the same clean match as round 0.
