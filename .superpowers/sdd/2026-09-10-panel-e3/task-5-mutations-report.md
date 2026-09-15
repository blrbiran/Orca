# Task 5 — independent mutation verification report

Repo `/Users/biran/code/skills/loop/Orca`. Commit under test: `6650aab09885a651da1b51716b153466265fda54`
("fix(panel): spell the coverage key separator as an escape, not a raw NUL byte"), confirmed via
`/usr/bin/git rev-parse HEAD` before and after the whole run (unchanged both times).

Method: each mutation ran in its own `git clone --local` under a fresh `mktemp -d`, checked out to the commit
above, with `node_modules` and `web/node_modules` symlinked from the main tree. Edits were applied by
`apply_mutation.py` (single Python script, exactly-once-anchor assertion per edit, exit non-zero on 0 or ≥2
matches) and every touched file was byte-scanned for control bytes < 0x20 (excl. tab/LF/CR) both before editing
(pre-existing sanity check) and after (mutation-safety check) — **zero such bytes appeared in any file, in any
mutation, before or after**. `shasum`-equivalent (`hashlib.sha256`) before/after is reported per file; every
mutation changed the hash. Runs used `./node_modules/.bin/vitest run tests/panel` inside the clone; every `RUN`
line below points into a `/var/folders/.../tmp.*/orca` path, i.e. the clone, never the main tree. Every clone was
torn down with `/bin/rm -rf "$(dirname "$C")"` after `cmp`-ing every file under `tests/panel/` against the main
tree.

Driver scripts (kept in scratch, not in the repo): `apply_mutation.py`, `run_mutation.sh`.

## Hard-rule bookkeeping

- **Porcelain before**: 52 bytes, ` M .superpowers/sdd/2026-09-10-panel-e3/progress.md` only.
- **Porcelain after** (all 14 runs — baseline + 13 mutations — complete): 52 bytes, identical single line.
  Nothing under `src/`, `tests/`, `web/` or `.decisions/` ever appeared in the main tree's status.
- **HEAD before and after**: `6650aab09885a651da1b51716b153466265fda54`, unchanged.
- **`ls ~/.orca`**: `No such file or directory` (RC=1) — checked before and after **every one of the 14 runs**
  (baseline included). Absent every single time.
- **Process census**: for every mutation, `ps -axo pid,ppid,pgid,command` before/after was diffed (comparing
  command text with pid/ppid/pgid stripped, since unrelated system processes churn pids constantly); grepped for
  `src/cli.ts` / `tsx` among anything appearing after but not before. **Zero matches in all 13 mutations and the
  baseline** — no leftover `tsx`/CLI process in any run, so nothing needed to be killed.
- **`lsof -nP -iTCP -sTCP:LISTEN`**: diffed before/after for every mutation and the baseline. **Zero diff in all
  14 runs** — no listener owned by a node/vitest process survived any run.
- **Unhandled Rejection / Unhandled error blocks**: none appeared in any of the 14 full vitest outputs (each read
  whole via the Read tool, never piped/grepped/sed'd for the primary verifying read).
- **Safety**: no mutation substituted `0.0.0.0`, or any real/bindable address, for `192.0.2.1`. P-2 changes the
  *default* literal to `192.0.2.1` (RFC 5737 TEST-NET-1) exactly as the brief specifies — never `0.0.0.0` — and
  the (intact) bind guard refuses it every time, so nothing ever binds under that mutation either.

## Baseline (unmutated clone, same commit)

`RUN v2.1.9 /private/var/folders/.../tmp.iTKxTzGcR7/orca` — `Test Files 7 passed (7)` / `Tests 48 passed (48)` /
`RC=0`. All green, as required before touching any mutation. Process census: 1069/1069 lines, 0 diff. lsof: 0
diff. `~/.orca` absent before and after.

---

## G-11 — cache `currentMetrics` once in `buildApi` instead of per request

**File**: `src/panel/api.ts`. **Hash before**: `c1c24778c55535f0a27befb6e19fbf2a8d9b3f755270b5211cc3ce3123a6049a`.
**Hash after**: `4dc7ffe0e7cf1beb7249c77a354b5ee931e1c040fad2d45c7774c2982ae99447` (changed: true). Control bytes
after: 0.

```diff
 export function buildApi(app: Express, deps: ApiDeps): void {
+  const cachedMetrics = currentMetrics(deps.opts);
   // 🔴 The static route. Registered BEFORE the /api token middleware, ...
@@
   app.get("/api/metrics", (_req, res, next) => {
     void (async () => {
-      const { observations, report } = await currentMetrics(deps.opts);
+      const { observations, report } = await cachedMetrics;
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 2 failed | 46 passed (48)`.

Failing criteria:
- `the metrics endpoint (spec sections 4.1 and 5) > re-runs repository discovery and E2's gate on EVERY request`
  — `tests/panel/metricsApi.test.ts:149:33` — `expected 200 to be 409`.
- `the metrics endpoint (spec sections 4.1 and 5) > answers a broken gate with a first-class error, never with
  partial data` — `tests/panel/metricsApi.test.ts:185:30` — `expected 200 to be 409`.

**No "Unhandled Rejection" / "Unhandled error" block** printed, even though `cachedMetrics` is a promise created
once and never re-created — the controller's specific question ("does a stored rejected promise produce an
unhandled-rejection error") answers **no** in this run: the cached promise here always resolves (the ghost
correction is written after the promise was already created and settled, so it never becomes a *rejected*
stored promise in this scenario; nothing at module/process level ever attaches a second rejection handler to
provoke Node's unhandled-rejection detector).

**Verdict: matched** — exactly the report's/controller's predicted two criteria, same reasoning (first assertion
after the correction is the one that fails, no short-circuit).

---

## P-2 — `parsePanelArgs`'s default bind `?? "127.0.0.1"` → `?? "192.0.2.1"`

**File**: `src/panel/server.ts`. **Hash before**: `638ed32f819fa31d3076980d264dc8ef21b2cd3bd15aa13b7c506e23c389544d`.
**Hash after**: `ee7043fc06ccee5e71c630ca6dacec0c8eb9f6e200f53696d63f2ba4ad052189` (changed: true). Control bytes
after: 0.

```diff
   return {
     by,
-    bind: flag("--bind") ?? "127.0.0.1",
+    bind: flag("--bind") ?? "192.0.2.1",
```

**RC=1**. `Test Files 2 failed | 5 passed (7)` / `Tests 8 failed | 40 passed (48)`.

Failing criteria (8, not 2):
- `security.test.ts > panel security (spec sections 3.1 and 3.2) > defaults the bind address to the literal
  127.0.0.1` — `tests/panel/security.test.ts:127:54` — `expected '192.0.2.1' to be '127.0.0.1'`.
- `metricsApi.test.ts > the metrics endpoint (spec sections 4.1 and 5) > passes E2's report through field for
  field, adding nothing and dropping nothing` — throws `PanelRejection EXTERNAL_BIND_NOT_CONFIRMED` at
  `src/panel/bindGuard.ts:30:9` via `createPanelServer` at `tests/panel/metricsApi.test.ts:91:31` (never reaches
  its own assertions).
- `... > re-runs repository discovery and E2's gate on EVERY request` — same throw, `metricsApi.test.ts:129:31`.
- `... > answers a broken gate with a first-class error, never with partial data` — same throw,
  `metricsApi.test.ts:171:31`.
- `... > answers 401 without a token, and 401 with a wrong one` — same throw, `metricsApi.test.ts:207:31`.
- `... > binds the literal 127.0.0.1 by default` — same throw, `metricsApi.test.ts:243:31`.
- `static serving via HTTP (spec section 2.2) > serves the token-injected index.html at / with no token header`
  — same throw, `metricsApi.test.ts:263:31`.
- `static serving via HTTP (spec section 2.2) > answers 404 for every traversal spelling over HTTP, with a
  positive control that resolves` — same throw, `metricsApi.test.ts:287:31`.

**Verdict: differs from both predictions** (controller: 2; implementer's report: 2, same 2). Measured: **8**
red criteria, not 2. Explanation via the three questions:
1. *Short-circuit?* No — for 7 of the 8, there is no assertion to short-circuit: `createPanelServer(...)` itself
   throws synchronously (`assertBindAllowed` inside it) before the test body reaches any `expect(...)` at all.
   Only the 8th (`security.test.ts`'s own bind-default test, which calls `parsePanelArgs` alone, never
   `createPanelServer`) fails at an ordinary `.toBe()` mismatch.
2. *Who else walks the deleted/changed line?* **Every** criterion in `metricsApi.test.ts` that calls
   `createPanelServer(parsePanelArgs([...], ...))` without an explicit `--bind` flag inherits the new default —
   and that is 7 of `metricsApi.test.ts`'s 12 criteria (only the 5 `panel review coverage` unit tests, which call
   `computePanelCoverage` directly and never touch `parsePanelArgs`/`createPanelServer`, are unaffected). The
   implementer's report and the controller's table both named only the one criterion whose *own name* mentions
   the bind default ("binds the literal 127.0.0.1 by default") plus Task 3's default-value test — neither
   traced the *other* seven criteria that construct a server the same way for an unrelated purpose and pay the
   same tax as a side effect.
3. *Where does the literal/status come from?* `192.0.2.1` is the mutation's own literal, read once inside
   `parsePanelArgs`; `EXTERNAL_BIND_NOT_CONFIRMED` and the 409-shaped `PanelRejection` come from
   `src/panel/bindGuard.ts`'s intact guard, which every one of those 7 criteria now trips before it can do
   anything else. This is not a false red: the mutation genuinely breaks every one of those criteria, just via a
   different, shared failure mode (bind-guard rejection at startup) than the two criteria's own named assertions
   — the report undercounted the blast radius, it did not misdescribe the two it did name.

Safety note: the run that would try to bind `192.0.2.1` never actually attempts to bind it, because the (intact)
`assertBindAllowed` guard rejects the non-loopback default with `confirmedExternal=false` before `listen()` is
ever called — consistent with the brief's warning that this address must never actually be bound.

---

## T-8 — delete the `/api` token middleware

**File**: `src/panel/api.ts`. **Hash before**: `c1c24778c55535f0a27befb6e19fbf2a8d9b3f755270b5211cc3ce3123a6049a`.
**Hash after**: `de8e3e50980a6af22842f678a86915958516dc9cc6a7f25bbab4fb5788b18f3b` (changed: true). Control bytes
after: 0.

```diff
-  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
-    const given = req.header("x-orca-token") ?? undefined;
-    if (!tokenMatches(deps.token, given)) {
-      res.status(401).json({ code: TOKEN_REQUIRED, message: "this panel needs its one-time token" });
-      return;
-    }
-    next();
-  });
-
   app.get("/api/metrics", (_req, res, next) => {
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 1 failed | 47 passed (48)`.

Failing criterion:
- `the metrics endpoint (spec sections 4.1 and 5) > answers 401 without a token, and 401 with a wrong one` —
  `tests/panel/metricsApi.test.ts:214:34` — `expected 200 to be 401`.

**Verdict: matched** — exactly the predicted single criterion, failing at its first (no-token) assertion exactly
as predicted.

---

## S-12b — delete the whole `app.get(/.*/ ...)` static route

**File**: `src/panel/api.ts`. **Hash before**: `c1c24778c55535f0a27befb6e19fbf2a8d9b3f755270b5211cc3ce3123a6049a`.
**Hash after**: `029aae4944508783a90d67907c1dcef92187bd545a1482ea9b707f79033abc78` (changed: true). Control bytes
after: 0.

```diff
-  app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
-    if (req.path.startsWith("/api/")) return next();
-    const name = req.path === "/" ? "index.html" : req.path.slice(1);
-    const asset = deps.statics.get(name);
-    if (asset === undefined) {
-      res.status(404).type("text/plain").send("not found");
-      return;
-    }
-    res.status(200).type(asset.contentType).send(asset.bytes);
-  });
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 2 failed | 46 passed (48)`.

Failing criteria:
- `static serving via HTTP (spec section 2.2) > serves the token-injected index.html at / with no token header`
  — `tests/panel/metricsApi.test.ts:268:30` — `expected 404 to be 200` (first assertion — Express's own
  unmatched-route 404 answers, as predicted).
- `static serving via HTTP (spec section 2.2) > answers 404 for every traversal spelling over HTTP, with a
  positive control that resolves` — `tests/panel/metricsApi.test.ts:309:35` — `expected 404 to be 200` (the loop
  of 7 traversal-spelling 404 checks all pass coincidentally; only the positive control at the very end fails,
  exactly as G4/the report predicted).

**Verdict: matched.**

---

## K-1 — `currentMetrics` stops passing `now` to `collect`

**File**: `src/panel/api.ts`. **Hash before**: `c1c24778c55535f0a27befb6e19fbf2a8d9b3f755270b5211cc3ce3123a6049a`.
**Hash after**: `ff5a793b255982bb4cc9ff5d1f10a0214ee6ae98d05ae94af708f7599ebdd52a` (changed: true). Control bytes
after: 0.

```diff
   const observations = await collect({
     root: opts.root,
     repos: opts.repos,
     correctionsDir: opts.correctionsDir,
-    now: () => (opts.now ?? (() => new Date()))().toISOString(),
   });
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 1 failed | 47 passed (48)`.

Failing criterion:
- `the metrics endpoint (spec sections 4.1 and 5) > passes E2's report through field for field, adding nothing
  and dropping nothing` — `tests/panel/metricsApi.test.ts:109:31` — whole-report `toEqual` fails; the diff shows
  exactly the predicted divergence, `as_of`/`correction_rate.buckets[0].counted_through` real wall-clock value
  (`"2026-09-15T14:37:26.918Z"`) vs. the test's fixed-clock expectation (`"2026-09-10T00:00:00.000Z"`) — nothing
  else in the 12-field report differs.

**Verdict: matched.**

---

## E-1 — error handler answers `MetricsRejection` with 200 and `{ report: null, code, message }`

**File**: `src/panel/api.ts`. **Hash before**: `c1c24778c55535f0a27befb6e19fbf2a8d9b3f755270b5211cc3ce3123a6049a`.
**Hash after**: `e5299f2686efda013654b43c8f04ac889605634cfa549b1186b1ab3c3f9d09ee` (changed: true). Control bytes
after: 0.

```diff
   app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
-    if (err instanceof MetricsRejection || err instanceof PanelRejection) {
+    if (err instanceof MetricsRejection) {
+      res.status(200).json({ report: null, code: err.code, message: err.message });
+      return;
+    }
+    if (err instanceof PanelRejection) {
       res.status(409).json({ code: err.code, message: err.message });
       return;
     }
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 2 failed | 46 passed (48)`.

Failing criteria:
- `the metrics endpoint (spec sections 4.1 and 5) > re-runs repository discovery and E2's gate on EVERY request`
  — `tests/panel/metricsApi.test.ts:149:33` — `expected 200 to be 409`.
- `the metrics endpoint (spec sections 4.1 and 5) > answers a broken gate with a first-class error, never with
  partial data` — `tests/panel/metricsApi.test.ts:185:30` — `expected 200 to be 409`.

**Verdict: matched** — exactly the predicted two criteria; the `MetricsRejection` (`UNRESOLVED_PROJECT_KEYS`)
these two trip now answers 200 per the mutation, so both fail at their status check, before the `body.code`/
`"report" in body` checks that would have fully exposed E-1's shape ever run — same short-circuit the report
described.

---

## C-1 — delete `if (r.action !== "reviewed") continue;`

**File**: `src/panel/coverage.ts`. **Hash before**:
`ca1d3fb733651441f33f1416d10bb0d1bde491bdc31762aba7ba4edaf124973c`. **Hash after**:
`84d0304d33d8b7e467980ee32307603cc202eb571aab2d21a3fdd8b80eff2c2a` (changed: true). Control bytes after: 0.

```diff
   const reviewed = new Set<string>();
   for (const r of reviews) {
-    if (r.action !== "reviewed") continue;
     const key = keyOf(r.projectKey, r.decisionId);
     if (highTier.has(key)) reviewed.add(key);
   }
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 1 failed | 47 passed (48)`.

Failing criterion:
- `panel review coverage (spec section 4.2) > keeps \`opened\` out of the numerator even when there are many of
  them` — `tests/panel/metricsApi.test.ts:358:39` — `expected 1 to be +0`.

**Other coverage criteria whose fixture carries an `opened` row**: only this one fixture uses `action: "opened"`
rows (`Array.from({ length: 20 }, ... "opened" ...)`); no other coverage criterion's fixture includes an
`opened` row, so no other criterion reddens under C-1 (all four other coverage criteria use only `"reviewed"`
rows and are unaffected by removing a filter on a different action value).

**Verdict: matched.**

---

## C-2 — `rate: highTier.size === 0 ? 0 : ...`

**File**: `src/panel/coverage.ts`. **Hash before**:
`ca1d3fb733651441f33f1416d10bb0d1bde491bdc31762aba7ba4edaf124973c`. **Hash after**:
`1e7a17983c13d0d146d05bad0aee5339d0768984d53eebaf0682a82f675e9fe9` (changed: true). Control bytes after: 0.

```diff
-    rate: highTier.size === 0 ? null : reviewed.size / highTier.size,
+    rate: highTier.size === 0 ? 0 : reviewed.size / highTier.size,
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 2 failed | 46 passed (48)`.

Failing criteria:
- `panel review coverage (spec section 4.2) > a reviewed row on a LOW-tier decision adds zero, and that decision
  is not in the denominator` — `tests/panel/metricsApi.test.ts:369:25` — `expected +0 to be null`.
- `panel review coverage (spec section 4.2) > reports rate null, not 0, when there are no high-tier decisions` —
  `tests/panel/metricsApi.test.ts:376:25` — `expected +0 to be null`.

**Verdict: matched** — both are the last of three assertions in their `it`, and both reach the zero-denominator
branch, exactly as predicted.

---

## C-3 — count reviewed rows with an array `push` instead of a `Set`

**File**: `src/panel/coverage.ts`. **Hash before**:
`ca1d3fb733651441f33f1416d10bb0d1bde491bdc31762aba7ba4edaf124973c`. **Hash after**:
`5b3b7e2cb323fd5d08ad9d5f2257f59b631fc0426c69e74c00eb5340b26da8e6` (changed: true). Control bytes after: 0.

```diff
-  const reviewed = new Set<string>();
+  const reviewed: string[] = [];
   for (const r of reviews) {
     if (r.action !== "reviewed") continue;
     const key = keyOf(r.projectKey, r.decisionId);
-    if (highTier.has(key)) reviewed.add(key);
+    if (highTier.has(key)) reviewed.push(key);
   }
   return {
-    reviewed_high_tier: reviewed.size,
+    reviewed_high_tier: reviewed.length,
     high_tier_total: highTier.size,
-    rate: highTier.size === 0 ? null : reviewed.size / highTier.size,
+    rate: highTier.size === 0 ? null : reviewed.length / highTier.size,
```
(Four edits were needed to keep the mutation type-consistent and runnable: swapping the container plus every
`.size`/`.add` read site that referenced it. This is the minimum change that realizes "array push instead of a
Set" as an actually-executable mutation, not an enlargement of the mutation's intent.)

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 1 failed | 47 passed (48)`.

Failing criterion:
- `panel review coverage (spec section 4.2) > counts distinct reviewed high-tier decisions over high-tier total;
  reviewed twice counts once` — `tests/panel/metricsApi.test.ts:349:39` — `expected 2 to be 1`.

**Verdict: matched.**

---

## C-4 — drop the `highTier.has(key)` condition

**File**: `src/panel/coverage.ts`. **Hash before**:
`ca1d3fb733651441f33f1416d10bb0d1bde491bdc31762aba7ba4edaf124973c`. **Hash after**:
`3e2ec9c3236d2f6006be59c38563cf6fee77e95f00636c19dba2edb798a56d0b` (changed: true). Control bytes after: 0.

```diff
-    if (highTier.has(key)) reviewed.add(key);
+    reviewed.add(key);
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 2 failed | 46 passed (48)`.

Failing criteria:
- `panel review coverage (spec section 4.2) > a reviewed row on a LOW-tier decision adds zero, and that decision
  is not in the denominator` — `tests/panel/metricsApi.test.ts:368:39` — `expected 1 to be +0`.
- `panel review coverage (spec section 4.2) > a reviewed row whose projectKey differs from the decision's (same
  decisionId) adds zero` — `tests/panel/metricsApi.test.ts:386:39` — `expected 1 to be +0`.

Both fail on `reviewed_high_tier`, the *second* assertion in each `it` (`high_tier_total`, computed by the
separate `isHighTier` loop and unaffected by this mutation, passes first) — exactly as predicted.

**Verdict: matched.**

---

## C-5 — key both sets by decision id alone (drop `projectKey`)

**File**: `src/panel/coverage.ts`. **Hash before**:
`ca1d3fb733651441f33f1416d10bb0d1bde491bdc31762aba7ba4edaf124973c`. **Hash after**:
`33907d7ca9c1860966858e4e796f1cd79a76f50c88e1d54e4d50d266d90d1e8c` (changed: true). Control bytes after: 0.

```diff
-const keyOf = (projectKey: string, id: string): string => `${projectKey}\x00${id}`;
+const keyOf = (projectKey: string, id: string): string => id;
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 1 failed | 47 passed (48)`.

Failing criterion:
- `panel review coverage (spec section 4.2) > a reviewed row whose projectKey differs from the decision's (same
  decisionId) adds zero` — `tests/panel/metricsApi.test.ts:386:39` — `expected 1 to be +0`.

**Verdict: matched** — `high_tier_total` (first assertion, unaffected) passes; `reviewed_high_tier` (second)
fails, exactly as predicted.

---

## N-1 — remove the `.todo` spellings from `SKIP_PATTERN`

**File**: `tests/panel/noSkips.test.ts`. **Hash before**:
`d7fccd5ed5791248f5d165d24a07ecc1ac6e127fcc74210d74487c26812c112e`. **Hash after**:
`4f3499e85841b5609d882cbe6a19cd656e4a4970ba76365e934011d551ce1780` (changed: true). Control bytes after: 0.

```diff
-const SKIP_PATTERN = /\b(it|test|describe)\s*\.\s*(skip|todo)\b|\bx(it|test|describe)\s*\(/g;
+const SKIP_PATTERN = /\b(it|test|describe)\s*\.\s*(skip)\b|\bx(it|test|describe)\s*\(/g;
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 1 failed | 47 passed (48)`.

Failing criterion:
- `the noSkips scanner itself (task 5 ruling G9) > catches every skip/todo spelling, one per named form, plus
  one with stray whitespace` — `tests/panel/noSkips.test.ts:115:53` — sample `it.todo(`: `expected [] to not
  deeply equal []` (the loop hits `"it.todo("` — index 3 of `mustCatch` — and throws there, masking whether
  `"test.todo("`/`"describe.todo("` would also fail; they would, but per the report's prediction this is still
  correctly red, just with the message naming only the first offender).

**Real-file-scan criterion** (`tests/panel/*.ts and web/tests/* ... contain no skip or todo spelling`) stayed
**green** under N-1 — confirmed: no real file under `tests/panel/` or `web/tests/` uses a `.todo(` spelling, so
this mutation is invisible to the directory scan and only the must-catch self-test catches it, exactly as the
report noted this criterion is required to exist for.

**Verdict: matched.**

---

## N-2 — skip the comment-stripping step

**File**: `tests/panel/noSkips.test.ts`. **Hash before**:
`d7fccd5ed5791248f5d165d24a07ecc1ac6e127fcc74210d74487c26812c112e`. **Hash after**:
`a0d38fc78c8a0212874c4e6da7486098a743cc5c0745e4339a2f995ae8a8371f` (changed: true). Control bytes after: 0.

```diff
 function findSkipSpellings(src: string): string[] {
-  const stripped = stripComments(src);
-  return [...stripped.matchAll(SKIP_PATTERN)].map((m) => m[0]);
+  return [...src.matchAll(SKIP_PATTERN)].map((m) => m[0]);
 }
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 3 failed | 45 passed (48)`.

Failing criteria (**3, not 1**):
- `the noSkips scanner itself (task 5 ruling G9) > does not flag a commented-out spelling, or a word that merely
  contains skip/exit as a substring` — `tests/panel/noSkips.test.ts:120:49` — sample `// it.skip(`:
  `expected [ 'it.skip' ] to deeply equal []`.
- `the noSkips scanner itself (task 5 ruling G9) > does not flag its own file` —
  `tests/panel/noSkips.test.ts:130:40` — `expected [ 'it.skip', 'it .skip', 'xit(', 'xtest(', 'xdescribe(',
  'it.skip', 'it .skip' ] to deeply equal []`.
- `no skipped or todo test in this subsystem (spec Rule 12) > tests/panel/*.ts and web/tests/* (if present)
  contain no skip or todo spelling` — `tests/panel/noSkips.test.ts:171:23` — `expected [ Array(1) ] to deeply
  equal []` (one offender: `.../tests/panel/noSkips.test.ts: it.skip, it .skip, xit(, xtest(, xdescribe(,
  it.skip, it .skip`).

**Verdict: differs from the implementer's report**, which predicted red in exactly one criterion (must-not-catch)
and explicitly asserted the self-scan criterion "stays **green** under N-2 ... a belt-and-suspenders property
worth recording" — that specific claim is **false** under measurement; it stays green under the *unmutated*
scanner (comment-stripping in place) but reddens along with the real-directory scan once N-2 removes that
stripping step. The controller's own table anticipated exactly this possibility ("report whether the whole-
directory scan ALSO reddens and, if so, which file and which comment line caused it") — it does, and the file is
`tests/panel/noSkips.test.ts` itself.

Answering the three questions:
1. *Short-circuit?* No — three separate `it`s, three separate failures, none masking another; within the
   must-not-catch `it`, the loop over `mustNotCatch` does stop at its first offender (`"// it.skip("`), matching
   the report's prediction for *that one* criterion, but the other two criteria are independent test bodies that
   also call the mutated `findSkipSpellings` and fail on their own terms.
2. *Who else walks the removed step?* All three failing criteria call the same `findSkipSpellings` function; two
   of them (`does not flag its own file`, and the real scan via `collectSourceFiles`) pass this very file's own
   raw text through it. Once `stripComments` is skipped, that raw text is exactly what gets scanned.
3. *Where do the literal matches come from?* Measured directly (`grep -n` against the file at this commit,
   redirected and read whole): lines **20, 75, 88** of `tests/panel/noSkips.test.ts` are ordinary `//` comments
   that, for documentation purposes, spell out literal examples of the spellings the scanner is designed to
   catch —
   - line 20: `// must-catch samples further down spelled "it.skip(" out as one contiguous`
   - line 75: `` // `it .skip (`), and the `x`-prefixed forms (`xit(`, `xtest(`, `xdescribe(`). ``
   - line 88: `` // runtime each entry equals a real spelling ("it.skip(", "it .skip (", ...), ``

   Under the intact scanner these are stripped as comments before `SKIP_PATTERN` ever sees them — that is
   precisely comment-stripping's job. N-2 removes that shield, so `SKIP_PATTERN` matches `it.skip` (×2),
   `it .skip` (×2), `xit(`, `xtest(`, `xdescribe(` — 7 hits, matching the observed failure output exactly. The
   `// it .skip (` etc. literals were written as human-readable illustration text about the pattern's own design,
   never intended to be scanned; they are not incidentally true, they are the direct, traceable cause.

This also means the DOT-identifier construction (protecting the `mustCatch`/`mustNotCatch` *array literals* from
containing a contiguous spelling) is not what protects the self-scan under N-2 — it was never in danger from
those arrays either way. The actual exposure is these three descriptive comment lines, which the DOT trick does
nothing to shield, and which only comment-stripping shields.

---

## W-1 — pass an empty `StaticFiles` into `buildApi`

**File**: `src/panel/server.ts`. **Hash before**: `638ed32f819fa31d3076980d264dc8ef21b2cd3bd15aa13b7c506e23c389544d`.
**Hash after**: `62e816f7f118dc7b18bd845c3d64ba90d18297c277418eb46e70796595efddfb` (changed: true). Control bytes
after: 0.

```diff
-  buildApi(app, { opts, token, reviews, statics });
+  buildApi(app, { opts, token, reviews, statics: { get: () => undefined, indexHtml: undefined, names: [] } });
```

**RC=1**. `Test Files 1 failed | 6 passed (7)` / `Tests 2 failed | 46 passed (48)`.

Failing criteria:
- `static serving via HTTP (spec section 2.2) > serves the token-injected index.html at / with no token header`
  — `tests/panel/metricsApi.test.ts:268:30` — `expected 404 to be 200`.
- `static serving via HTTP (spec section 2.2) > answers 404 for every traversal spelling over HTTP, with a
  positive control that resolves` — `tests/panel/metricsApi.test.ts:309:35` — `expected 404 to be 200` (positive
  control `/index.js` now also 404).

**Verdict: matched** — both criteria red, via the same assertion shape S-12b produces. As the report already
flagged (and this run confirms by direct comparison of the two vitest outputs): **W-1 and S-12b are
behaviourally indistinguishable through these two HTTP-level criteria alone** — byte-identical failing-test
names, byte-identical first-failure messages (`expected 404 to be 200` at the same two file:line locations in
both runs). Distinguishing "route deleted" from "route present but handed an empty `StaticFiles`" is a real,
still-open gap, exactly as the report said — `tests/panel/staticFiles.test.ts`'s own loader-level criteria would
catch this at a different layer, but no criterion under `tests/panel/` inspects `StaticFiles.names`/`indexHtml`
or the 404 body/type directly at the HTTP layer to tell the two mutations apart.

---

## Criteria the implementer's report names but this table does not cover

None. Every criterion the report's "Mutation predictions" section names (G-11, P-2 ×2, T-8, S-12b ×2, K-1, E-1
×2, C-1, C-2 ×2, C-3, C-4 ×2, C-5, N-1, N-2, W-1 ×2) maps onto a row in the brief's table; nothing extra needed
inventing.

## Summary of matched vs. differs

| id | matched? |
|---|---|
| G-11 | matched |
| P-2 | **differs** — 8 red criteria measured, not 2 (blast radius of the bind-guard throw was undercounted by both predictions; not a false red, see write-up) |
| T-8 | matched |
| S-12b | matched |
| K-1 | matched |
| E-1 | matched |
| C-1 | matched |
| C-2 | matched |
| C-3 | matched |
| C-4 | matched |
| C-5 | matched |
| N-1 | matched |
| N-2 | **differs** — 3 red criteria measured, not 1 (implementer's report's claim that the self-scan "stays green" under N-2 is empirically false; three literal-example comment lines in noSkips.test.ts itself, lines 20/75/88, are unprotected once comment-stripping is skipped) |
| W-1 | matched |

No fully green mutation was found in this batch — every one of the 13 produced at least one red criterion (the
brief's example of a fully-green mutation, the `--by` guard from Task 1, does not recur here).

## Fix round 1 — E-2 (on 3b8bd46)

Commit under test: `3b8bd4601fddec026d143417d583e14020d7cfca` ("test(panel): pin the gate refusal's code, not only
its status"), confirmed via `/usr/bin/git -C /Users/biran/code/skills/loop/Orca rev-parse HEAD` before and after
the whole run — unchanged both times (`3b8bd4601fddec026d143417d583e14020d7cfca`).

Context: fix round 1 added `expect(body.code).toBe(UNRESOLVED_PROJECT_KEYS)` to the criterion "answers a broken
gate with a first-class error, never with partial data" (`tests/panel/metricsApi.test.ts:189`), which already
asserted status 409 and `"report" in body === false`. This mutation checks whether that added line is load-bearing.

**Mutation E-2**: in `src/panel/api.ts`'s four-argument error handler (line 100-101), for the
`MetricsRejection`/`PanelRejection` branch, keep status 409 and the body shape but replace `code: err.code` with
`code: "mutated-code"`.

### Method

Single shell invocation per run (baseline, then the mutation), each in its own `git clone --local` under a fresh
`mktemp -d`, checked out to `3b8bd4601fddec026d143417d583e14020d7cfca`, with `node_modules` and
`web/node_modules` symlinked from the main tree. The edit was applied by a Python script
(`mutate_e2.py`, kept in scratch, not the repo) with an exactly-once anchor assertion (exit non-zero on 0 or ≥2
matches on the literal `res.status(409).json({ code: err.code, message: err.message });`). Ran
`./node_modules/.bin/vitest run tests/panel > <out> 2>&1; echo "RC=$?" >> <out>` and read the output whole (no
pipe/grep/tail/sed on the verifying run).

### Baseline (unmutated clone, same commit)

All green. `RUN v2.1.9 /private/var/folders/.../tmp.aCRN4XmjJJ/orca` — points into the clone. `Test Files 7
passed (7)`; `Tests 48 passed (48)`. `RC=0`. No unhandled-rejection/error block printed.

### Hash before/after

- Before: `c1c24778c55535f0a27befb6e19fbf2a8d9b3f755270b5211cc3ce3123a6049a  .../orca/src/panel/api.ts`
- After: `38616630982e803ca80aea401b8d7524ac5ec1bd1a656f5439af32c02b2919ce  .../orca/src/panel/api.ts`
- Hashes differ (not a broken run). Anchor log: `ANCHOR_COUNT=1 OK`.
- Byte scan for control bytes (< 0x20, excluding tab/LF/CR) on the edited file after the edit: `NO_CONTROL_BYTES`.

### Diff

```diff
@@ -98,7 +98,7 @@
   // stops matching them as ordinary routes.
   app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
     if (err instanceof MetricsRejection || err instanceof PanelRejection) {
-      res.status(409).json({ code: err.code, message: err.message });
+      res.status(409).json({ code: "mutated-code", message: err.message });
       return;
     }
     res.status(500).json({ code: "panel-internal-error", message: String(err) });
```

### RC and vitest summary

`RUN v2.1.9 /private/var/folders/.../tmp.C2OyS6b08J/orca` — points into the clone.

```
❯ tests/panel/metricsApi.test.ts (12 tests | 2 failed) 765ms
  × the metrics endpoint (spec sections 4.1 and 5) > re-runs repository discovery and E2's gate on EVERY request 177ms
    → expected 'mutated-code' to be 'unresolved-project-keys' // Object.is equality
  × the metrics endpoint (spec sections 4.1 and 5) > answers a broken gate with a first-class error, never with partial data 166ms
    → expected 'mutated-code' to be 'unresolved-project-keys' // Object.is equality

Test Files  1 failed | 6 passed (7)
     Tests  2 failed | 46 passed (48)
RC=1
```

No compile/collection error. No "Unhandled Rejection" / "Unhandled error" block printed.

### Failing criteria, full names and first assertion failure

1. **"the metrics endpoint (spec sections 4.1 and 5) > re-runs repository discovery and E2's gate on EVERY
   request"** — first failure at `tests/panel/metricsApi.test.ts:151`:
   `expect(body.code).toBe(UNRESOLVED_PROJECT_KEYS)` — expected `"unresolved-project-keys"`, received
   `"mutated-code"`. (The preceding `expect(second.status).toBe(409)` at line 149 does not short-circuit: status
   is untouched by this mutation and stays 409.)
2. **"the metrics endpoint (spec sections 4.1 and 5) > answers a broken gate with a first-class error, never with
   partial data"** — first failure at `tests/panel/metricsApi.test.ts:189`:
   `expect(body.code).toBe(UNRESOLVED_PROJECT_KEYS)` — expected `"unresolved-project-keys"`, received
   `"mutated-code"`. This is exactly the assertion fix round 1 added. The later `expect("report" in body).toBe(false)`
   at line 194 is never reached this run because the round-1 assertion fails first — but that assertion is
   independently real: reverting only the mutation (not the fix) reproduces a pass on line 189 and then exercises
   line 194, so the round-1 line is not vacuous, merely first in sequence here.

### Load-bearing question, answered

The broken-gate criterion (`tests/panel/metricsApi.test.ts:162-203`) **does redden**, and its first failure is
exactly the assertion fix round 1 added (`body.code` expected `"unresolved-project-keys"`, received
`"mutated-code"`, line 189). It does not stay green. This confirms the added line is load-bearing for E-2: before
fix round 1 (assertion absent), this same mutation would have been invisible to this criterion, since status
stays 409 and `"report" in body"` stays `false` regardless of what `code` says.

### Two vs. counted

Controller prediction: red in the broken-gate criterion AND the every-request-gate criterion — two. **Matched**:
exactly two criteria reddened, both listed above, both first failures on the `body.code` assertion with the same
expected/received pair. No investigation of the three short-circuit/other-walker/literal-origin questions was
needed — the counts match the prediction exactly and the first-failure line matches the load-bearing hypothesis
precisely.

### Process / listener / `~/.orca` census

- **Process census**: `ps -axo pid,ppid,pgid,command` before/after the mutation's vitest run, diffed and grepped
  for `src/cli.ts` / `tsx` among lines present after but absent before: **none**. Same result for the baseline
  run.
- **Listener census**: `lsof -nP -iTCP -sTCP:LISTEN` before/after the mutation's vitest run: **identical** (diff
  empty). Same for baseline.
- **`ls ~/.orca`**: `ls: /Users/biran/.orca: No such file or directory` — checked before and after both the
  baseline run and the E-2 mutation run (4 readings total). Absent every time.

### Teardown and hard-rule bookkeeping

- `cmp` of every file under `tests/panel/` in the clone against the main tree's `tests/panel/`: identical for
  both the baseline clone and the E-2 clone (`TESTS_PANEL_DIFF=0` both times) — no mutation leaked into a
  criterion.
- Both clones removed with `/bin/rm -rf "$(dirname "$C")"`; confirmed removed (`ls` on the parent tmp dir
  reported "No such file or directory" afterward, both times).
- **Porcelain before** (whole run): 52 bytes, ` M .superpowers/sdd/2026-09-10-panel-e3/progress.md` only.
- **Porcelain after** (whole run): 52 bytes, identical single line. Nothing under `src/`, `tests/`, `web/` or
  `.decisions/` appeared.
- **HEAD before/after**: `3b8bd4601fddec026d143417d583e14020d7cfca`, unchanged.

### Matched / differs

**Matched.** Two red criteria, exactly as the controller predicted, and the load-bearing question resolves
affirmatively: the broken-gate criterion reddens on the newly added `body.code` assertion, first failure at
`tests/panel/metricsApi.test.ts:189`, expected `"unresolved-project-keys"` received `"mutated-code"` — the added
line is doing real work, not decoration.
