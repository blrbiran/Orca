# Task 9 fix round 1 — scoped re-review

Base `1a95e7d` → Head `952739d`. Diff file:
`.superpowers/sdd/2026-09-10-panel-e3/review-1a95e7d..952739d.diff`.

## Finding Verdicts

1. **(I-1, R61) verify-panel.ts teardown failures were only console.error'd, never reached exit code** —
   ADDRESSED. `scripts/verify-panel.ts:212-219`: the `finally` loop now runs
   `cleanup.run()` per item in its own try/catch and on throw prints
   `` `FAIL teardown: ${cleanup.what}: ${message}` `` and sets `exitCode = 1`
   (verify-panel.ts:224-228 in the new file / diff lines 219-229). Sub-checks:
   - Step's own FAIL line stays first: the `catch (err)` block (verify-panel.ts:805-811)
     prints `FAIL <n> ...` and completes before `finally` starts — ordinary
     try/catch/finally sequencing, unchanged by this fix, still holds.
   - One failing teardown item does not skip the rest: each `cleanup.run()` call
     is individually try/caught inside the `for` loop (verify-panel.ts:219-230);
     a throw in one iteration does not exit the loop. Confirmed empirically by
     the report's clone demonstration (injected throw on the store-dir cleanup;
     the panel-kill and fixture-repo cleanups still ran and left no residue).
   - Destructive removals guarded: `guardedRmRecursive(path, expectedPrefix)`
     (verify-panel.ts:203-217) refuses `path.length === 0` or a path not
     containing `expectedPrefix`. Confirmed both `rm(...)` call sites route
     through it — `grep -nF "rm("` over the file turns up exactly one raw
     `rm(` call, the one inside `guardedRmRecursive` itself
     (verify-panel.ts:216); both destructive sites call the guarded wrapper
     (verify-panel.ts:277 fixture root with prefix `orca-panel-verify-target-`,
     verify-panel.ts:550 store dir with prefix `orca-panel-verify-store-`).
     Both `root` and `storeDir` are themselves `mkdtemp(join(tmpdir(), prefix))`
     results (verify-panel.ts:237, ~544), so they always literally contain
     their own prefix — the guard can never reject a legitimate mkdtemp path
     from this script, and would reject `/`, `$HOME`, or the repo root since
     none contain the fixed prefix string. (Minor note under New Breakage
     below on the `includes` vs `startsWith` check.)

2. **(R62) endToEnd.test.ts used the literal 0.0.0.0 as a must-catch sample** —
   ADDRESSED. `tests/panel/endToEnd.test.ts:26-30`: the sample is now
   `` `orca-panel ready url=http://198.51.100.1:54321 token=${GOOD_TOKEN}` ``
   (RFC 5737 TEST-NET-2), distinct from the file's other non-loopback sample
   `192.0.2.1` (TEST-NET-2 vs TEST-NET-1 — genuinely different addresses), and
   the assertion (`toThrowError(ReadyLineParseError)`, endToEnd.test.ts:34)
   still exercises parser rejection. Verified independently with
   `git grep -n "0\.0\.0\.0"` over the tracked tree (not just the report's
   claim): the literal appears only inside comments (verify-panel.ts:755,
   endToEnd.test.ts:29, security.test.ts:103-104) and prose docs/plans —
   never as a fixture, sample, or mutation value anywhere in the tree.

## New Breakage in the Fix Diff

None Critical/Important.

Minor — `guardedRmRecursive`'s check is `path.includes(expectedPrefix)`
rather than a prefix/dirname check on the resolved path (verify-panel.ts:211).
In this script it is harmless: both call sites pass only script-generated
`mkdtemp` results, never external/derived input, so it can't be tricked in
practice. Flagging only because a future caller could pass a substring-only
match (e.g. `/some/dir/containing-orca-panel-verify-store-as-text/etc`) and
the guard would wave it through. Not blocking.

**Timeout wrapper around confirming the child's exit** (the reviewer's
specific concern) — checked and no gap found. `withTimeout(panelExited, 5000,
...)` (verify-panel.ts diff lines 32-46) races the cached, once-attached
`exited` promise (`watchExit`, verify-panel.ts:365-369) against a 5s timer.
`killGroup(child)` (SIGKILL to the process group) is called before the wait
starts, so the timeout only bounds *confirmation*, not the kill signal
itself. If the timer wins the race: the wrapper rejects, the teardown loop's
try/catch catches it, prints `FAIL teardown: ... did not confirm exit within
5000ms after SIGKILL`, sets `exitCode = 1`, and the loop continues to the
next cleanup — this is a report, not a hang. `main()` still resolves and
`process.exitCode = code` is set at the bottom (verify-panel.ts:826-829), so
the process does not hang and does not silently report success. If the real
`exited` promise later resolves after the timeout already fired,
`withTimeout`'s `.then(resolve, reject)` calls `resolve`/`reject` on an
already-settled promise, which is a no-op — no crash, no unhandled
rejection. Net: a timeout here is surfaced loudly and cannot leave the run
looking green; it also cannot itself hang the script.

**Path guard** (the reviewer's other specific concern) — checked, no gap
found. Cannot refuse a legitimate mkdtemp path (both `root` and `storeDir`
are `mkdtemp(prefix)` results and always contain their own prefix by
construction) and cannot accept `/`, `$HOME`, or the repo root (none contain
either fixed prefix string `orca-panel-verify-target-` /
`orca-panel-verify-store-`). See the `includes`-vs-`startsWith` minor note
above — not a real gap given the two actual call sites.

## Out-of-Scope Observations

None (nothing outside the fix diff was inspected beyond what was needed to
confirm call sites of `rm(`/`guardedRmRecursive` and the `0.0.0.0` grep, both
within the fix's own claims).

## Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
