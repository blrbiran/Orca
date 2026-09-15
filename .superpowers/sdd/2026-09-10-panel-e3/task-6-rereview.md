# Task 6 fix round 1 — re-review

Fix base ea8c2bb, head 248f03a. Diff: tests/panel/decisionsApi.test.ts only,
42 insertions / 17 deletions, no `Bin` line in the stat.

## Finding Verdicts

1. **(I-1) dead per-row Object.keys assertion mislabeled load-bearing** —
   ADDRESSED. tests/panel/decisionsApi.test.ts:81-92 (diff) replaces the
   `toEqual` + `Object.keys(row).sort()` pair with a single
   `expect(body.rows).toStrictEqual(expected);` (line 82 of the diff hunk,
   file line ~81 post-fix). `expected` is still built at
   `Object.fromEntries(LIST_FIELDS.map((f) => [f, d[f]]))` (diff lines
   78-80), not via `projectForList` — the L-3b tautology fix from ea8c2bb is
   preserved. The comment above it (diff lines 54-72) states plainly that
   the dropped loop could not redden independently once `expected` stopped
   moving with the implementation, and does not repeat the "load-bearing"
   claim. `toStrictEqual` is a strict superset of the old `toEqual` catch
   set (also rejects an extra `undefined`-valued key), so nothing regresses.

2. **(L-3 surviving mutation) absence read immediately after response** —
   ADDRESSED. tests/panel/decisionsApi.test.ts diff lines 130-135: the read
   is now `const rows = await eventually(() => readReviews(dir), (r) =>
   r.length > 0, REVIEWS_LOCK_TIMEOUT_MS + 1_000);` followed by
   `expect(rows).toHaveLength(0);`. `REVIEWS_LOCK_TIMEOUT_MS` = 1000
   (src/panel/reviewsLock.ts:8), so the window is 2000ms, comfortably above
   the ~500ms landing time the mutation verifier measured. `eventually`
   itself (tests/panel/decisionsApi.test.ts:46-53, unchanged by this diff)
   returns early only when `done(value)` is true, otherwise polls every 10ms
   until the deadline and returns the last-read value — so on the unmutated
   path (nothing ever lands) it genuinely blocks out the full window before
   the assertion runs, matching the report's observed ~2.2s runtime for this
   test. The comment at diff lines 115-129 explains the window's sizing and
   why the early return doesn't defeat it.

3. **(I-2) ea8c2bb's commit message overclaimed the Object.keys assertion
   "actually catches" L-3b** — ADDRESSED per Rule 13's own terms: no history
   rewrite (confirmed `git log -1 --format=%B 248f03a`, saved to
   /tmp/rr_commitmsg.txt) — ea8c2bb is untouched. 248f03a's commit message
   body point 3 names the wrong claim, says which commit made it, and points
   to the actual repair (point 1) and to task-6-report.md's "Fix round 1"
   Finding 3 section, which restates the same correction in full. This is
   the "named correction in the fix commit body" the ruling asked for, not
   a silent drop.

## New Breakage in the Fix Diff

None. Only tests/panel/decisionsApi.test.ts changed; the only other diff
hunk is the import line adding `REVIEWS_LOCK_TIMEOUT_MS` alongside the
existing `acquireReviewsLock` import. No production code (src/panel/*)
touched by this fix round. `body.rows.length).toBeGreaterThan(1)` assertion
directly below the fixed line is untouched and still present.

## Out-of-Scope Observations

None — the fix diff is confined to the two findings' assertions plus the
one import line; nothing else in the file changed to comment on.

## Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
