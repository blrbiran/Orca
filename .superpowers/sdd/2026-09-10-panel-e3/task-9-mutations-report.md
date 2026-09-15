# Task 9 mutations report — independent verification

Repo `/Users/biran/code/skills/loop/Orca`. Commit under test: `1a95e7d91e1829da9f02190da1ef8ec93f730355` (confirmed
via `/usr/bin/git rev-parse HEAD` in every clone before mutating, and against the main tree before/after this whole
run). Every clone: `git clone --local --quiet` + `git checkout --quiet 1a95e7d` + symlinked
`node_modules` and `web/node_modules`. No `git stash`; no write in the main tree except this file. No subagents.

Harness: `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/5d5c8055-111d-4296-ad0c-e78a5b191f54/scratchpad/t9v/`
(`mutate.py` — anchor-once edits with sha256/diff/byte-scan; `run9.sh` — one shell invocation per mutation: clone,
mutate, build, `verify:panel` with census, optional vitest, `cmp` of `tests/panel/`, teardown). Full per-mutation
output (build.txt, verify_panel.txt, vitest.txt, mutate.json, ps/lsof/tmpdir before-after) is under
`.../scratchpad/t9v/out_<ID>/`.

## Main-tree safety (whole run)

- Before: `git status --porcelain -z | wc -c` = 90; HEAD = `1a95e7d9...`.
- After (post all 13 runs — baseline + 12 mutations): `git status --porcelain -z | wc -c` = 90; HEAD unchanged.
  Porcelain content both times: `M .superpowers/sdd/2026-09-10-panel-e3/progress.md` and
  `?? .decisions/orca-dev-5d5c8055.jsonl` — the controller's own files, nothing under `src/`, `tests/`, `web/`,
  `.decisions/`.
- No leftover clone directories found under `/private/var/folders` after the run (`find ... -iname orca -type d`
  empty); every clone was `/bin/rm -rf`'d by its own run.

## Safety pre-checks

- **E-9**: `ifconfig -a` on this machine lists `inet 127.0.0.1`, `inet 192.168.3.129`, `inet 198.18.0.1` — no
  `192.0.2.1` on any interface. `assertBindAllowed`/the second panel process in `tests/panel/security.test.ts` and
  `scripts/verify-panel.ts` step 11 both pass exactly `192.0.2.1` (TEST-NET-1) with no `--i-know-this-is-exposed`.
  Confirmed safe to run.
- **E-4**: `scripts/verify-panel.ts`'s `makeFixture()` creates the target repo via
  `mkdtemp(join(tmpdir(), "orca-panel-verify-target-"))` — under `$TMPDIR`, never this repository. Confirmed this
  repository's HEAD/porcelain unchanged immediately before and after the E-4 run (both 90 bytes, same HEAD; see
  below).

## Anchor pre-check (read-only, main tree)

Every anchor in `mutate.py` was counted against the main tree's files at `1a95e7d` before any clone existed: all 15
anchors (across the 12 mutations; E-4 and E-11 each use multiple) matched **exactly once**. `mutate.py`'s
`apply_edit` also asserts this at mutation time inside each clone (exits 2 on 0 or ≥2 matches, exits 3 if the text is
unchanged after replacement) — every one of the 12 runs reported `MUTATE_RC=0` and a changed sha256; **bad_bytes: 0**
for every edited file, every mutation.

## Baseline (unmutated clone)

`build.txt` RC=0 (flat `dist/index.html` 0.34kB + `dist/index.js` 228.52kB). `verify_panel.txt`: **RC=0**, 13 PASS
lines (0-12), 0 FAIL. Census: no `tsx`/`src/cli.ts` process present after that was not present before; `lsof`
identical before/after; no `orca-panel-verify-{store,target}-*` left in `$TMPDIR`; `ls ~/.orca` = absent both times;
`cmp` of `tests/panel/*` clone vs main tree: identical (`CMP_OK=true`).

## Per-mutation results

### E-1 — `GET /api/decisions` also appends `opened` for every listed decision

Anchor: `res.json({ rows: observations.decisions.map(projectForList) });` (unique in `src/panel/api.ts`).
before `69c3599c…504f` → after `85b8a66f…8966`. bad_bytes 0.
```diff
       res.json({ rows: observations.decisions.map(projectForList) });
+      // MUTATION E-1: also records "opened" for every listed decision, fire-and-forget.
+      for (const d of observations.decisions) {
+        void deps.reviews
+          .append({ decisionId: d.id, projectKey: d.projectKey, action: "opened", by: deps.opts.by, at: nowIso(deps.opts) })
+          .catch(() => undefined);
+      }
     })().catch(next);
```
Build RC=0. `verify:panel` **RC=1**: PASS 0, PASS 1, **FAIL 2** `listing records nothing (opened/reviewed stay 0 for
both decisions) (opened(verify-panel-1/1)): 0 vs 1`. **Matches the controller's and implementer's prediction
exactly** (FAIL at step 2). Census: no leftover `tsx`/`cli.ts` process, `lsof` identical, no `$TMPDIR` residue,
`ls ~/.orca` absent before/after, `cmp tests/panel` identical.

### E-2 — `ReviewsWriter.append` skips its dedupe check (always writes)

Anchor: `if (this.seen.has(rowKey)) return "duplicate";` in `src/panel/reviewsStore.ts` (unique).
before `47bf4c6c…a1a` → after `1e759c82…139`. bad_bytes 0.
```diff
-    if (this.seen.has(rowKey)) return "duplicate";
+    if (false) return "duplicate"; // MUTATION E-2: dedupe check skipped, always writes.
```
Build RC=0. `verify:panel` **RC=1**: PASS 0-3, **FAIL 4** `opening the same detail again does not duplicate the
'opened' row (opened(verify-panel-1/1)): 1 vs 2`. **Matches exactly** (FAIL at step 4; step 3 stayed green as
predicted). Census/residue/`~/.orca`/`cmp`: all clean, same as baseline.

### E-3 — `POST /api/reviews` appends `opened` instead of `reviewed`

Anchor: the full `deps.reviews.append({...action:"reviewed"...}); res.json({ result });` block in the `/api/reviews`
handler (unique — the corrections handler's `action: "reviewed"` append is a different multi-line block).
before `69c3599c…504f` → after `c1b10ef3…c71`. bad_bytes 0.
```diff
       const result = await deps.reviews.append({
         decisionId,
         projectKey,
-        action: "reviewed",
+        action: "opened", // MUTATION E-3: was "reviewed"
         by: deps.opts.by,
```
Build RC=0. `verify:panel` **RC=1**: PASS 0-4, **FAIL 5** `agreeing records exactly one 'reviewed' row: 1 vs 0`.
**Matches exactly** (FAIL at step 5, synchronous, no window needed). Census/residue/`~/.orca`/`cmp`: clean.

### E-4 — `POST /api/corrections` also closes the loop into the target repo

Two anchors in `src/panel/api.ts` (import block + end of the corrections handler, both unique). First edit adds
imports (`execFile`/`promisify`/`appendEvents` under `_e4`-prefixed names to avoid colliding with the file's own
identifiers); second inserts, right before `res.json({ correction: stored });`, a best-effort block that appends one
valid `decision` event to the fixture repo's `.decisions/` and commits it.
before `69c3599c…504f` → (import) → `21bb5d5e…55a` → (handler) → `c92b7e61…d09`. bad_bytes 0 both edits.
```diff
+import { execFile as _e4ExecFile } from "node:child_process";
+import { promisify as _e4Promisify } from "node:util";
+import { appendEvents as _e4AppendEvents } from "../ledger/writer.js";
+const _e4ExecFileAsync = _e4Promisify(_e4ExecFile);
```
```diff
+      // MUTATION E-4: also closes the loop into the target repo.
+      try {
+        const closeRepo = observations.repos.find((r) => r.projectKey === projectKey);
+        if (closeRepo) {
+          const closeRunId = "panel-mutation-e4";
+          await _e4AppendEvents(`${closeRepo.path}/.decisions`, closeRunId, [{ ev: "decision", id: `${closeRunId}/1`,
+            at: nowIso(deps.opts), run: closeRunId, question: "panel mutation e4 closing question",
+            chose: "panel mutation e4 closing choice",
+            alternatives: [{ option: "leave open", why_not: "mutation test" }],
+            because: "mutation E-4 test closes the loop",
+            undo: { how: "git revert <ref>", cost: "low", blast_radius: "one repo" }, scope: "file", kind: "dependency" }]);
+          await _e4ExecFileAsync("git", ["-c","user.name=panel-e4","-c","user.email=panel-e4@invalid","add","-A"], { cwd: closeRepo.path });
+          await _e4ExecFileAsync("git", ["-c","user.name=panel-e4","-c","user.email=panel-e4@invalid","commit","-m","panel mutation e4 close"], { cwd: closeRepo.path });
+        }
+      } catch { /* best effort */ }
       res.json({ correction: stored });
```
**Investigation note (Rule 9 / Rule 14 discipline):** the first attempt at this mutation used `undo.how: "git
revert"` (no `<ref>`), which `src/ledger/undoExecutable.ts`'s `hasCommandShape` does not recognize (needs a second,
arg-shaped token) — `appendEvents` rejected it ("downgraded to tier 0: undo.how is not executable"), the `catch`
swallowed it, and `verify:panel` came back fully green (a **broken mutation**, not a green measurement). Confirmed
with a standalone debug driver that ran the panel directly with inherited stderr
(`.../scratchpad/t9v/e4debug.mjs`): saw `E4-DEBUG: close failed: Error: refusing to append: downgraded to tier 0…`.
Fixed `undo.how` to `"git revert <ref>"` (the same literal `scripts/verify-panel.ts`'s own fixture uses) and reran
the debug driver: `E4-DEBUG: close succeeded`, `git log` in the fixture repo showed the new `panel mutation e4 close`
commit. Re-ran the full pipeline with the corrected mutation:

Build RC=0. `verify:panel` **RC=1**: PASS 0-5, **FAIL 6** `the target repo's HEAD does not move: "e632d83…" vs
"5f5e695…"`. **Matches the controller's and implementer's prediction exactly** (FAIL at step 6, on the HEAD check
specifically). Main-repo safety: `/Users/biran/code/skills/loop/Orca` HEAD and porcelain byte-count (90) were
identical immediately before and after this run — the mutation only ever touched the throwaway fixture repo under
`$TMPDIR`. Census/residue/`~/.orca`/`cmp`: clean.

### E-5 — the already-recorded branch answers the CLI's `err.message`

Anchor: the `res.status(409).json({ code: err.code, message: ...multi-line panel sentence..., retry_field: "again" })`
block (unique). before `69c3599c…504f` → after `5167fa5d…010`. bad_bytes 0.
```diff
           res.status(409).json({
             code: err.code,
-            message:
-              `You already recorded a correction on this decision. If you mean to record a ` +
-              `second, separate one, choose "record another" and it will be kept alongside the ` +
-              `first rather than replacing it.`,
+            message: err.message, // MUTATION E-5: was the panel's own sentence
             retry_field: "again",
           });
```
Build RC=0. `verify:panel` **RC=1**: PASS 0-6, **FAIL 7** `the panel's own message never mentions --again: false vs
true`. **Matches exactly** (FAIL at step 7; `err.message` is `src/corrections/store.ts`'s
`"...Pass --again to record another one on purpose."`). Census/residue/`~/.orca`/`cmp`: clean.

### E-6 — `currentMetrics` computed once and reused

The table's shape ("computed once in `buildApi` and reused") names a multi-call-site refactor; there is no
single anchor that would express it without touching 6 near-identical call sites individually (each occurring more
than once verbatim). Per the hard rules ("write the smallest edit that has the table's MEANING"), memoized
`currentMetrics` itself (module-scope cache, one function, one anchor, unique) — externally indistinguishable from
memoizing at the `buildApi` call sites: either way, every route after the first call to `currentMetrics` gets the
same cached `{ observations, report }` for the life of the process.
before `69c3599c…504f` → after `86e005a2…c6b`. bad_bytes 0.
```diff
+// MUTATION E-6: memoized module-wide, computed once and reused (smallest edit with the
+// table's meaning: "currentMetrics computed once in buildApi and reused").
+let cachedMetricsResult: {...} | undefined;
 async function currentMetrics(opts: PanelOptions) {
+  if (cachedMetricsResult !== undefined) return cachedMetricsResult;
   const observations = await collect({...});
-  return { observations, report: computeMetrics(observations, { bucket: "month" }) };
+  cachedMetricsResult = { observations, report: computeMetrics(observations, { bucket: "month" }) };
+  return cachedMetricsResult;
 }
```
Build RC=0. `verify:panel` **RC=1**: PASS 0-7, PASS 8's own gate check reached, **FAIL 8**
`the next request notices the unresolvable projectKey: 409 vs 200`. Steps 1-7 all green, confirming the implementer's
finer-grained prediction ("Step 8 only... a stale report never breaks step 5's coverage check, since A/B are seeded
before startup"). **Matches exactly.** Census/residue/`~/.orca`/`cmp`: clean.

### E-7 — the static route is deleted

Anchor: the whole `app.get(/.*/, ...)` block (unique). before `69c3599c…504f` → after `6e738d2e…56d`. bad_bytes 0.
```diff
-  app.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
-    if (req.path.startsWith("/api/")) return next();
-    ...
-    res.status(200).type(asset.contentType).send(asset.bytes);
-  });
+  // MUTATION E-7: the static route is deleted.
```
Build RC=0. `verify:panel` **RC=1**: PASS 0-8, **FAIL 9** `GET / (positive control) answers 200: 200 vs 404`.
**Matches exactly** — the raw-traversal half of step 9 (404) stayed green (no route matches at all, express's default
404), and the positive control is exactly what catches this, as the report says it would.
Census/residue/`~/.orca`/`cmp`: clean.

### E-8 — the `/api` token middleware is deleted

Anchor: the whole `app.use("/api", ...)` block (unique). before `69c3599c…504f` → after `ef58435c…54a`. bad_bytes 0.
```diff
-  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
-    const given = req.header("x-orca-token") ?? undefined;
-    ...
-  });
+  // MUTATION E-8: the /api token middleware is deleted.
```
Build RC=0. `verify:panel` **RC=1**: PASS 0-9, **FAIL 10** `a request with no token is refused: 401 vs 409`.
**Differs from the implementer's predicted "200 instead of 401"**, though the step number matches. Investigated with
the three questions: (1) no earlier step failed; (3) not a literal-source question; **(2) who else walks the
line** — with the middleware gone, the no-token request to `/api/metrics` in step 10 falls straight into the
handler, which calls `currentMetrics`. Step 8's own fixture (injected a few requests earlier, still present in the
corrections store for the rest of the run) leaves the metrics gate broken (`UNRESOLVED_PROJECT_KEYS`), so *every*
`/api/metrics` request for the remainder of the run — token or not — now answers 409 through that gate, not 200. The
token check being deleted is still what step 10 correctly reds on (no request should ever reach a handler without
one), but the specific status code depends on what step 8 already did to the store, which the auth layer no longer
intercepts. Census/residue/`~/.orca`/`cmp`: clean.

### E-9 — `assertBindAllowed` call is deleted from `createPanelServer`

Anchor: `// Before listen(), never after -- see bindGuard.ts.\n  assertBindAllowed(opts.bind, opts.confirmedExternal);\n`
in `src/panel/server.ts` (unique). before `638ed32f…44d` → after `6819c148…bb7`. bad_bytes 0.
```diff
-  // Before listen(), never after -- see bindGuard.ts.
-  assertBindAllowed(opts.bind, opts.confirmedExternal);
+  // MUTATION E-9: assertBindAllowed call deleted.
```
Build RC=0. `verify:panel` **RC=1**: PASS 0-10, **FAIL 11**
`the refusal names EXTERNAL_BIND_NOT_CONFIRMED: "external-bind-not-confirmed" vs "orca: Error: listen EADDRNOTAVAIL:
address not available 192.0.2.1\n    at Server.setupListenHandle...`. **Matches the implementer's detailed prediction
exactly**: the second process does NOT manage to bind (192.0.2.1 is on no interface of this machine, confirmed by
`ifconfig -a` above), fails with `EADDRNOTAVAIL`, and that propagates out of `startPanelFromArgs` uncaught by the
`PanelRejection` branch in `cli.ts`, landing in the top-level `catch` (exit 3, raw stack on stderr) — the script's
"exits non-zero" half-check still passed silently (code ≠ 0/null), only the named-refusal check reds. `lsof` for
that pid showed nothing (never listened); the `lsof -nP -iTCP -sTCP:LISTEN` before/after diff for the whole run was
also empty, and no `tsx`/`cli.ts` process survived. Safety held throughout. `~/.orca`/`cmp`: clean.

### E-10 — `web/vite.config.ts` `assetsDir: "."` → `"assets"`

Build run **AFTER** the mutation (per the hard rules, since this mutation changes build config). Anchor:
`assetsDir: ".",` (unique). before `c674a5b3…100` → after `28899370…0ca`. bad_bytes 0.
```diff
-    assetsDir: ".",
+    assetsDir: "assets",
```
Build RC=0 (with the mutation already applied). `verify:panel` **RC=0** — 13 PASS lines, 0 FAIL.
**A fully green mutation — a finding, not a failure, and it contradicts both the controller's and the implementer's
prediction** (both expected FAIL at the pre-check / step 0, on "web/dist has no subdirectory"). Investigated
directly: rebuilt a standalone debug clone with this exact mutation and listed `web/dist` by hand —
`web/dist/index.html` and `web/dist/index.js` only, **no `assets/` subdirectory** appears. Root cause: this app
(`web/src/*.tsx`) has **zero non-entry-point static assets** — no CSS files, no images, no fonts (confirmed:
`find web -name '*.css'` and a directory listing of `web/src` show none). Vite/Rollup's `assetsDir` only relocates
non-entry "asset" outputs (extracted CSS, imported images/fonts, etc.); `entryFileNames`/`assetFileNames` in
`rollupOptions.output` govern the two files this build actually produces (`index.html`, `index.js`), and neither is
subject to `assetsDir`. So on this codebase, as it stands today, `assetsDir` is dead configuration from the pre-check's
point of view — the mutation is real (the config genuinely changed, confirmed by the differing hash and rebuilt
output), but the criterion the controller/implementer expected it to redden cannot observe it, because the build
never emits anything that setting would move. This would only start mattering if a future change to `web/src` adds a
CSS import or a static asset. Census/residue/`~/.orca`/`cmp`: clean.

### E-11 — `parseReadyLine` accepts a line with no `token=` (returns an empty token)

Three anchors in `scripts/verify-panel.ts` (regex; destructure; hex-shape check), all unique. before
`d17efe1f…0eb` → after `d58fa759…de9` → after `be4f7f00…5d2` → after `ed0343a3…c8b`. bad_bytes 0 (all three edits).
```diff
-const READY_LINE = /^orca-panel ready url=(\S+) token=(\S+)\s*$/;
+const READY_LINE = /^orca-panel ready url=(\S+)(?: token=(\S+))?\s*$/; // MUTATION E-11
...
-    const [, url, token] = match;
+    const [, url, rawToken] = match;
+    const token = rawToken ?? ""; // MUTATION E-11: empty token when token= is absent
...
-    if (!/^[0-9a-f]{64}$/.test(token)) {
+    if (token !== "" && !/^[0-9a-f]{64}$/.test(token)) { // MUTATION E-11: empty token skips the shape check
```
Build RC=0. `verify:panel` **RC=0** — 13 PASS lines, 0 FAIL (the real CLI always emits a `token=`, so this mutation
is invisible to the end-to-end run — exactly as both predictions say).
`vitest run tests/panel/endToEnd.test.ts` inside the clone: `RUN v2.1.9 /private/var/folders/.../tmp.yvBbQ7ItF1/orca`
(confirmed pointed **into the clone**, not the main tree). **1 failed, 4 passed**:
`FAIL tests/panel/endToEnd.test.ts > parseReadyLine ... > throws when the line is missing token=`
(`AssertionError: expected function to throw an error, but it didn't`). No "Unhandled Rejection"/"Unhandled error"
block anywhere in the output. **Matches exactly.** `cmp tests/panel` clone vs main tree: identical (the test file
itself was never touched — only `scripts/verify-panel.ts` was mutated). Census/residue/`~/.orca`: clean.

### R-9b — `ReviewsWriter.append` chmods an existing reviews directory to `0o700` after `mkdir`

Anchor: `await mkdir(this.dir, { recursive: true, mode: REVIEWS_DIR_MODE });\n      const lock = await
acquireReviewsLock(this.dir);` in `src/panel/reviewsStore.ts` (unique; `chmod` already imported at the top of the
file, no new import needed). before `47bf4c6c…a1a` → after `5d700c56…01e`. bad_bytes 0.
```diff
       await mkdir(this.dir, { recursive: true, mode: REVIEWS_DIR_MODE });
+      await chmod(this.dir, 0o700); // MUTATION R-9b: chmod an existing dir to 0o700 after mkdir
       const lock = await acquireReviewsLock(this.dir);
```
Build RC=0. `verify:panel` **RC=0** — 13 PASS lines, 0 FAIL (this fixture never runs the panel against a
pre-existing, looser-mode reviews directory, so the mutation is invisible to the end-to-end run).
`vitest run tests/panel/reviewsStore.test.ts` inside the clone: `RUN v2.1.9 /private/var/folders/.../tmp.bTauNRFZnG/orca`
(confirmed pointed into the clone). **1 failed, 8 passed**:
`FAIL ... > leaves an already-existing directory's mode alone, even when it is looser than 0700`
(`AssertionError: expected 448 to be 493` — 448 = 0o700, 493 = 0o755). No unhandled-error block. **Matches exactly**
— this is precisely task 9's L1 answer confirmed empirically: the existing criterion in
`tests/panel/reviewsStore.test.ts` (unmodified by task 9, per L1's ruling) is the one this mutation reddens, and only
this one. `cmp tests/panel` clone vs main tree: identical. Census/residue/`~/.orca`: clean.

## Unpinned criteria

The implementer's report table (`task-9-report.md`) names exactly the same 12 mutation IDs and the same step/
criterion targets as the controller's table — nothing named in the report falls outside this table. Nothing to flag
as unpinned.

## Summary of findings (fail-loud)

- **10 of 12 mutations reddened exactly where predicted** (E-1, E-2, E-3, E-4, E-5, E-6, E-7, E-9, E-11, R-9b) —
  each a genuine, reproducible red on a freshly-built clone, with `verify:panel` otherwise green on the unmutated
  baseline and no process/port/tmp/`~/.orca` residue anywhere.
- **E-8 reddened at the predicted step but with a different mechanism** (409 via the still-broken step-8 gate,
  not 200) — the step is still correctly caught, the specific status code is incidental to test ordering.
- **E-10 is a genuine green mutation — a real finding, not a failure of measurement.** The `assetsDir` config change
  is real (confirmed by hash, diff, and a standalone rebuild), but this web app currently has no non-entry-point
  static assets for `assetsDir` to relocate, so the pre-check's "no subdirectory" assertion cannot observe it. The
  criterion is not wrong for today's codebase; it has a live blind spot that would only bite if `web/src` ever grows
  a CSS/asset import.
- One mutation (E-4) required a debug/repair cycle before it measured anything real: the first attempt was a
  **broken mutation** (my own injected code's `undo.how` failed ledger validation and was silently swallowed by its
  own `catch`), confirmed with a standalone instrumented driver before concluding anything about the real code.

## Fix round 1 (952739d): E-10b and TD-1

Independent re-verification of fix round 1 (commit `952739df4c3f45a36618f7d8b6b986b89603ddd9`, the fix for E-10's
blind spot plus the teardown-failure hardening). Same hard rules as above: clone per run
(`/usr/bin/git clone --local --quiet`, `checkout --quiet 952739d`), both `node_modules` symlinks, exactly-once
anchor assertions, sha256 before/after, byte-scan (0 in all edits below), whole-file reads, `cmp`/`diff -rq` of
`tests/panel` vs the main tree, `/bin/rm -rf` of every clone, process (`ps -axo pid,ppid,pgid,command`) and listener
(`lsof -nP -iTCP -sTCP:LISTEN`) census before/after every `verify:panel` run, `$TMPDIR` census for the script's
`mkdtemp` prefixes (`orca-panel-verify-target-`, `orca-panel-verify-store-`) before/after, `ls ~/.orca` before/after.
Main tree never touched: porcelain byte count 90 → 90 (unchanged, and byte-identical per `diff`), HEAD stayed
`952739df4c3f45a36618f7d8b6b986b89603ddd9` throughout. No subagents used.

### Baseline (952739d, unmutated clone)

`npm run build --workspace web` → RC=0 (`dist/index.html`, `dist/index.js`). `npm run verify:panel` → **RC=0**, 13
PASS lines (steps 0–12), 0 FAIL, matching the brief's expectation exactly. Process census: `ps` line count identical
before/after (1070/1070), no line containing `tsx`/`src/cli.ts` present after but not before. `lsof` listener list
byte-identical before/after (all pre-existing unrelated listeners — Surge, ControlCenter, postgres, mysqld, WeChat,
VS Code Helpers, QQ — none new). `$TMPDIR` had no `orca-panel-verify-*` entries before or after. `ls ~/.orca`:
absent before and after. `diff -rq` of the clone's `tests/panel` against the main tree's: no differences.

### E-10b — `web/vite.config.ts`: `entryFileNames: "[name].js"` → `entryFileNames: "js/[name].js"`

Anchor `entryFileNames: "[name].js"` in `web/vite.config.ts`'s `rollupOptions.output`, exactly once (script asserted
count===1 and exited non-zero otherwise; it did not exit non-zero, i.e. the anchor was unique). sha256 before
`c674a5b3…6100`, after `26af9ba7…1940` — differ. `diff`:
```diff
-    rollupOptions: { output: { entryFileNames: "[name].js", assetFileNames: "[name].[ext]" } },
+    rollupOptions: { output: { entryFileNames: "js/[name].js", assetFileNames: "[name].[ext]" } },
```
bad_bytes=0. Build run **after** applying the mutation (brief's rule for build-config mutations): `npm run build
--workspace web` → RC=0. Full recursive listing of `web/dist` after that build:
```
web/dist
web/dist/index.html
web/dist/js
web/dist/js/index.js
```
— confirms a real subdirectory (`js/`) is now emitted, unlike the earlier E-10 (`assetsDir: "assets"`), which
produced no subdirectory because this build has no non-entry-point static assets for `assetsDir` to relocate;
`entryFileNames` governs the entry chunk itself, so redirecting it directly forces the flat-dist pre-check to have
something to see. `npm run verify:panel` → **RC=1**, exactly one line before the RC:
```
FAIL 0 web/dist has no subdirectory (staticFiles.ts reads the top level only): [] vs ["js"]
```
No PASS lines at all — the failure is at step 0, the pre-start check, before the panel is ever spawned. Process
census: `ps` line count 1069 before and after; no `tsx`/`src/cli.ts` line present after but not before — **no panel
process was ever started**, confirming the controller prediction's "no panel process ever started" clause. `lsof`
listener list unchanged (no diff). `$TMPDIR` `orca-panel-verify-*` census: empty before and after (nothing created,
since the script fails before `makeFixture()`/`mkdtemp` run). `ls ~/.orca`: absent before and after. `cmp`/`diff -rq`
of `tests/panel` (clone vs main tree): no differences.

**Matched exactly** — controller predicted FAIL at the pre-start flat-dist check, RC 1, no panel process ever
started; all three hold precisely, with the dist listing as direct evidence of the subdirectory the check caught.

### TD-1 — teardown's `ORCA_CORRECTIONS_DIR` removal throws `Error("TD-1 injected")`

Anchor in `scripts/verify-panel.ts` (the `cleanups.push` entry for the throwaway store directory):
`run: () => guardedRmRecursive(storeDir, "orca-panel-verify-store-"),` — exactly once (distinct from the fixture's
own cleanup entry, which targets `"orca-panel-verify-target-"` and calls `fixture.cleanup`, not
`guardedRmRecursive` directly). Replaced the removal call itself with a throw, so the directory is never actually
removed (matching the brief's framing: "make the removal ... throw"):
```diff
-      run: () => guardedRmRecursive(storeDir, "orca-panel-verify-store-"),
+      run: () => { throw new Error("TD-1 injected"); }, // MUTATION TD-1
```
sha256 before `0af155d6…5832`, after `2e7e055c…627d1` — differ. bad_bytes=0. Build run **before** the mutation (not
a build-config change; `npm run build --workspace web` → RC=0), as the hard rules require. `npm run verify:panel` →
**RC=1**, output:
```
PASS 0 web/dist exists, is flat, and carries the token anchor
PASS 1 orca panel is up at http://127.0.0.1:52306, ready line parsed
PASS 2 listing records nothing (opened/reviewed stay 0 for both decisions)
PASS 3 opening a decision's detail records exactly one 'opened' row and no 'reviewed' row
PASS 4 re-opening the same decision's detail does not duplicate the 'opened' row
PASS 5 agreeing records 'reviewed', moves the coverage numerator to 1, and updates the to-do list
PASS 6 recording a correction records it and 'reviewed', and never closes the loop
PASS 7 a second correction on the same decision is refused by name, with the panel's own message
PASS 8 a correction with an unresolvable projectKey makes the next request answer 409 by name
PASS 9 a raw traversal path 404s, and GET / still serves the token-injected index.html
PASS 10 a request with no token is refused by name (401 TOKEN_REQUIRED)
PASS 11 an unconfirmed external bind is refused by name, and the process never listens
PASS 12 panel closed; ~/.orca is unchanged (absent before and after)
FAIL teardown: remove the throwaway ORCA_CORRECTIONS_DIR: TD-1 injected
RC=1
```
All 13 numbered steps PASS (0–12), then exactly the predicted `FAIL teardown: ...TD-1 injected` line, RC=1 —
matches the prediction's shape precisely. Other teardown items still ran despite this one throwing: the panel
child's process-group kill/exit-confirm cleanup and the target-repo fixture removal both completed (process census
below shows no leftover panel process; the `orca-panel-verify-target-*` fixture directory was not present in the
post-run `$TMPDIR` scan). Process census: `ps` line count 1074 before, 1072 after (2 fewer — unrelated transient
processes elsewhere on the machine finishing between snapshots); no line containing `tsx`/`src/cli.ts` present after
but not before, i.e. **no leftover panel process**. `lsof` listener list: no diff (no leftover listener). `$TMPDIR`
`orca-panel-verify-*` census: **exactly one entry after, none before** —
`orca-panel-verify-store-67AlPX` (the throwaway `ORCA_CORRECTIONS_DIR`, matching the predicted "only that one
directory left"). Contents: `corrections.jsonl` (436 bytes) and `reviews.jsonl` (409 bytes), both mode `0600`,
directory mode `0700` — this is the same store the run's own steps 2–8 exercised, left behind only because its
removal was the thing mutated to throw. `ls ~/.orca`: absent before and after.

Residue handling per the dispatch instructions: confirmed the leftover path
(`/var/folders/nb/068k_scs4gzgclcp66f9hys40000gn/T/orca-panel-verify-store-67AlPX`) lies under `$TMPDIR`
(`/var/folders/nb/068k_scs4gzgclcp66f9hys40000gn/T/`) and carries the script's exact `mkdtemp` prefix
(`orca-panel-verify-store-`) before removing it, then removed it with `/bin/rm -rf`; confirmed gone by a follow-up
`ls` (No such file or directory). `cmp`/`diff -rq` of `tests/panel` (clone vs main tree): no differences.

**Matched exactly** — controller predicted all step PASS lines, then `FAIL teardown: ...TD-1 injected`, RC 1, other
teardown items still ran, and exactly one leftover directory to record and remove; every clause held.

### Fix round 1 summary

- **E-10b matched the controller's prediction exactly**: FAIL at the pre-start flat-dist check, RC 1, no panel
  process ever started. This closes the blind spot the original E-10 exposed (that run's `assetsDir: "assets"` was a
  genuine green finding because the app emits no non-entry assets) — `entryFileNames` reaches the one file the
  pre-check actually inspects, so the fix's re-shaped mutation (E-10b in place of E-10) now has something to catch.
- **TD-1 matched the controller's prediction exactly**: all 13 step PASS lines, then the named teardown FAIL, RC 1,
  with the other teardown items (panel process-group kill, target-repo fixture removal) still running and only the
  mutated removal's own directory left behind. This is a genuine positive control on fix round 1's Rule 12
  ("teardown failures force non-zero exit") — before this fix, a thrown teardown error printed to stderr but the
  loop's own state (`exitCode`) was never forced non-zero by it if every numbered step had already passed; TD-1
  proves it now is.
- No leftover process, listener, or `~/.orca` write in either run beyond the one recorded-and-removed TD-1
  directory. Main tree porcelain and HEAD unchanged across the whole session (byte count 90 → 90, byte-identical by
  `diff`; HEAD `952739df4c3f45a36618f7d8b6b986b89603ddd9` throughout).
