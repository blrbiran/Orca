# Task 2 re-review — fix round 1 (commit `4bcaa9e..a5b55dc`)

Scope: re-review of the one open Important finding (check-then-act race in
`ReviewsWriter.append`'s in-process dedupe) against the fix diff
`review-4bcaa9e..a5b55dc.diff`, plus a scan of that same diff for new
breakage. Nothing outside this diff was reviewed as a finding.

## Verdict: ADDRESSED

All three controller-required repairs are present and each is independently
verifiable by reading the diff/current source:

1. **Synchronous claim, with rollback.** `src/panel/reviewsStore.ts:70-83`:

   ```ts
   const rowKey = key(row);
   if (this.seen.has(rowKey)) return "duplicate";
   // ... comment only, no code ...
   this.seen.add(rowKey);
   try {
     await mkdir(...)
     ...
   } catch (err) {
     this.seen.delete(rowKey);
     throw err;
   }
   return "written";
   ```

   Between the `has` check (line 71) and the `add` (line 83) there is no
   statement other than a comment — no `await`, no function call that could
   yield. The claim is synchronous. Because of JS's run-to-completion
   semantics for the synchronous prefix of an `async` function, two
   `append()` calls invoked back-to-back (as `Promise.all([...])` does)
   cannot interleave before the first one reaches `add`: call A runs
   check→add→suspends at `await mkdir`; only then does call B start, and by
   that point `rowKey` is already in `seen`, so B's `has` check is true and
   it returns `"duplicate"` immediately. The window is closed, not narrowed.

2. **New criterion**, `tests/panel/reviewsStore.test.ts:92-102`:

   ```ts
   it("resolves exactly one of two concurrent appends for the same row as written, the other as duplicate", async () => {
     const writer = new ReviewsWriter(dir);
     await writer.load();
     const [a, b] = await Promise.all([writer.append(row()), writer.append(row())]);
     expect([a, b].sort()).toEqual(["duplicate", "written"]);
     expect(await readReviews(dir)).toHaveLength(1);
   });
   ```

   - Fires two genuinely concurrent `append` calls on the same instance for
     the same row (`Promise.all`, not sequential `await`s).
   - Asserts a **literal count** (`toHaveLength(1)`), not an upper bound.
   - Compares outcomes **order-independently** (`[a, b].sort()` against a
     fixed two-element array), so it doesn't matter which of the two promises
     the runtime happens to resolve first.
   - Shape check for red-on-old-code: on the pre-fix code (`add` deferred
     until after the write), call A's synchronous prefix only runs `has`
     (false) then suspends at `await mkdir` — `seen` is untouched at that
     point. Call B then also sees `has` false and also proceeds to write.
     Both writes land, both resolve `"written"`, and the file ends up with 2
     rows. That fails both assertions in this criterion (`.sort()` would be
     `["written","written"]`, and length would be 2), so the criterion's
     shape is capable of going red on the un-fixed ordering — it is not a
     test that passes regardless. (Implementer's report is honest that it
     did not directly measure this red-then-green; the above is an
     independent reasoning-based check, consistent with the report's own
     R-11 survey and the mutation verifier's separate job.)

3. **Comment explaining WHY**, `src/panel/reviewsStore.ts:73-82`: explicitly
   names the check-then-act hazard, states the claim must sit before the
   first `await`, and ties it to production reachability (Task 5's shared
   `ReviewsWriter` behind the HTTP handlers, two clicks = two concurrent
   calls). Satisfies the "why, not just what" bar.

### Rollback correctness, including the "key already in `seen`" edge case

The delete-on-throw (`this.seen.delete(rowKey)` in the `catch`, line 109)
only ever fires for a key **this specific call added**, never for a
pre-existing one:

- If `rowKey` was already in `seen` before this call (from `load()` seeding
  it off disk, or from an earlier completed `append` on this instance), the
  `has` check on line 71 is true and the function returns `"duplicate"`
  immediately — it never reaches `add`, `try`, or `catch`. The delete path
  is structurally unreachable for that case.
- A given call only ever executes its own `add`/`catch` pair once, so the
  `delete` in its `catch` undoes exactly the `add` that same call performed
  moments earlier. No other call's claim can be deleted, because a second
  concurrent call for the same key is guaranteed (by point 1 above) to have
  already short-circuited at `has` before this call's `catch` could run.

So the rollback restores the pre-call state exactly: a failed write leaves
`seen` exactly as it would have been had `append` never been called for that
row, and never touches a key it did not itself add.

### New breakage scan (fix diff only)

None found. Specifics checked:

- The old code had no `try/catch` around `mkdir`/lock/write at all (a thrown
  `mkdir`/lock error propagated directly, since `seen.add` only ran after a
  successful write). The new code wraps that same sequence in an outer
  `try { ... } catch (err) { this.seen.delete(rowKey); throw err; }`, which
  rethrows the original `err` unchanged — error identity and properties
  (e.g. `.code`) are preserved. The "refuses by its OWN name when its OWN
  lock is held" criterion (asserts `rejects.toMatchObject({ code:
  "reviews-store-busy" })`) still passes under this structure: `acquireReviewsLock`
  throwing that error is now caught by the new outer `catch`, which deletes
  the just-added key and rethrows the same error object.
- The inner lock `try/finally` (`await lock.release()`) is untouched in
  shape, just re-nested one level inside the new outer `try` — lock release
  still happens on any write-path error before the outer `catch` runs.
- The directory-mode comment (previously above the `mkdir` call) was moved,
  not duplicated; it appears exactly once in the new source, and its content
  is unchanged, so the two mode-related criteria ("gives the directory and
  the file their modes explicitly..." and "leaves an already-existing
  directory's mode alone...") are unaffected by the reordering.
- No change to the `key()` function, `load()`, `readReviews()`, or the
  return-type contract (`"written" | "duplicate"`) — all other existing
  criteria in the test file (mode criteria, cross-process dedupe, lock
  criteria, whole-line-append criterion) exercise code paths untouched by
  this diff's restructuring.

## Observations (out of scope for this finding, not verdicted)

- The implementer's report flags, on its own initiative, that it did not
  directly observe the new criterion red on the pre-fix code (a manual
  revert attempt hit a syntax error and was abandoned; a separate mutation
  verifier covers this). That gap is disclosed, not hidden, and this
  re-review's independent reasoning above corroborates the criterion's
  shape without relying on that measurement.
