# Task 3 review — panel security boundary (identity, token, bind guard)

Reviewed: `review-cb6f88c..eaedd86.diff` (commit `eaedd86e182e6d69374957791f1cbd4b2c152476`), against
`task-3-brief.md`, `task-3-controller-notes.md`, and `task-3-report.md`. Cross-checked against the
live tree (`src/panel/rejection.ts`, `src/panel/reviewsStore.ts`, `src/corrections/paths.ts`,
`src/cli.ts`, `package.json`) and `git log`/`git status` on the actual commit. Did not re-run the
test suite; did not run the named mutations. All greps below were run independently by me, not
copied from the report.

## Verdict 1 — Spec compliance: ✅

Everything the brief's Interfaces section requires is present with the exact names:
`mintToken`, `tokenMatches`, `EXTERNAL_BIND_NOT_CONFIRMED`, `TOKEN_REQUIRED`, `assertBindAllowed`,
`PanelOptions`, `createPanelServer`, `parsePanelArgs`. `server.ts` was replaced wholesale as
instructed. Nothing extra was built: no premature `buildApi`/`loadStaticFiles` stubs, no static
file serving, no `.decisions/` writes, no git commit, no scope creep beyond the brief's own
`parsePanelArgs` body (the `--repo`/`--port` validation branches are verbatim from the brief, not
implementer-added). Controller rulings E1–E10 were followed, each with a disclosed deviation
where the brief was stale or ambiguous (see findings below for the one deviation worth a note).

## Verdict 2 — Task quality: Approved

### Resolution of the specific questions asked

- **Would the guard actually go red at CLI level if deleted (the Task-1 history)?** Yes. I traced
  `runPanel` in `src/cli.ts`: it imports `startPanelFromArgs`, catches `PanelRejection` and writes
  `rejected: <code>: <message>` to stderr with `err.exitCode` (default `1`). For P-10/P-10b
  (missing `--by` silently tolerated), `assertBindAllowed` then sees a loopback default and
  passes, so the real child process actually starts listening and hangs on `await started.closed`
  — `execFileAsync` never resolves and the new CLI-level test times out at 20s, which vitest
  reports as a failure. For P-1 (`assertBindAllowed` gutted), the child proceeds to
  `server.listen(0, "192.0.2.1")`, which rejects with a plain `EADDRNOTAVAIL` `Error` — not a
  `PanelRejection` — so `runPanel`'s catch rethrows it to the top-level handler, which exits `3`
  with a stack trace, failing both the `code: 1` and stderr-substring assertions. Both shapes are
  genuine reds, not vacuous ones. The report's predictions for P-1/P-10/P-10b match what the code
  actually does; I did not just take its word for it.
- **E1 (buildApi/loadStaticFiles left out) — coherent and minimal?** Yes. `server.ts` builds the
  `express()` app, applies `express.json({ limit: "64kb" })`, wires the already-real
  `ReviewsWriter`, and leaves two one-line comments naming Task 5 and Task 4 at the exact spot
  each would wire in — not stub modules, not empty functions, matching the ruling's letter.
- **E2 (no `it.skip`) —** confirmed by my own grep: no `it.skip`, `it.todo`, `xit`, `xdescribe`,
  or `describe.skip` anywhere in `tests/panel/`. Both real-process criteria run for real.
- **E6 (lsof must not swallow a failure into a vacuous pass) —** confirmed in the diff: the
  `execFileAsync("lsof", …)` call's `.catch` re-throws with a descriptive message instead of
  returning `{ stdout: "" }`, and `expect(listeners.stdout.length).toBeGreaterThan(0)` runs before
  the absence assertion. The comment explicitly rejects a per-pid filter and explains why (the
  child has already exited by the time `lsof` runs, so a pid filter would assert against an empty
  set by construction) — matching the ruling's required reasoning, not just its conclusion.
- **E5 (`TOKEN_REQUIRED` exactly one definition) —** confirmed by grep across `src/` and `tests/`:
  the only occurrence is `src/panel/rejection.ts:34`, with a comment naming Task 5's `api.ts` as
  the future consumer.
- **Token comparison —** `tokenMatches` checks `a.length !== b.length` and returns `false` before
  calling `timingSafeEqual`, so a length mismatch cannot throw. The actual byte comparison is
  `timingSafeEqual`, which is constant-time by construction, so there is no first-differing-byte
  short-circuit. Both failure modes named in the task are closed.
- **Commit message vs. code —** read the full committed message (`git log -1 eaedd86`) against the
  diff. Every claim in it (guard-before-listen ordering, TEST-NET-1 vs. 0.0.0.0, the CLI-level
  criterion added for ruling E3, `server.ts` landing without `api.js`/`staticFiles.js`, `by`
  feeding both derived ids) is true of what the diff actually does. Attribution trailer names
  Claude Sonnet 5 correctly, matching this session.

### Independent checks beyond the report's own claims

- `0.0.0.0` does not appear anywhere in `src/panel/` or `tests/panel/` (grepped independently).
- `express` is an existing `package.json` dependency (`^5.1.0`), not newly added by this diff —
  no undeclared-dependency risk.
- `correctionsDir(env)` (`src/corrections/paths.ts`) is a pure string computation with no
  filesystem side effect, so the unit-level tests that call `parsePanelArgs(..., {})` with an
  empty env object never touch any real path — they just compute an unused string. E8 compliance
  holds even for the tests that don't bother redirecting the env.
- `ls ~/.orca` still reports "No such file or directory" on this machine after reading the whole
  test file and tracing the code paths — consistent with the report's E8/E10 claim.
- `git status --porcelain` on the live tree shows only `.superpowers/sdd/2026-09-10-panel-e3/progress.md`
  modified — matches E10's expectation exactly.

### Findings

- **Important:** none.
- **Minor — untested parsePanelArgs branches.** `malformed-port` and `malformed-repo-argument`
  (the `--port`/`--repo` validation inside `parsePanelArgs`) have no pinning criterion anywhere in
  `tests/panel/` (checked by grep). This code is verbatim from the brief's Step 5 block, not an
  implementer addition, and is orthogonal to the security boundary this task owns, so it doesn't
  block approval — but since `server.ts` was replaced wholesale here, these branches are "new" as
  of this commit and currently unpinned. Worth a one-line registration for whichever task first
  exercises `--port`/`--repo` for real (Task 4/5).
- **Minor — E4 executed as shared `beforeEach`/`afterEach` rather than per-test inline.** The
  controller note said to define `throwawayStore` "inside that criterion"; the implementer hoisted
  it to a `describe`-level `beforeEach`/`afterEach` shared by both real-process tests, since ruling
  E3 added a second one after the note was written. Isolation is preserved (fresh `mkdtemp` per
  test, removed per test), and the deviation is explicitly disclosed in the report with its
  reasoning — a defensible reading of a note written before the second criterion existed, not a
  hidden shortcut.
- **Minor — mutation P-10/P-10b leaves a detached listener on timeout.** Under those specific
  mutations, the CLI-level test times out at 20s while the real child process is still listening
  on loopback; `execFileAsync`'s promise is never awaited to completion by vitest after the
  timeout, so nothing in the test explicitly kills the child. This only matters during the
  verifier's mutation run (normal behavior never reaches it, since the guard throws first), and
  isn't something the brief asked for, but flagging it so the verifier isn't surprised by a
  leftover process after running P-10/P-10b.

None of the above rise to Critical or Important: the security boundary itself (identity
requirement, token minting/comparison, bind guard, and — the reason this task exists — a
CLI-level criterion that would actually catch a deleted `--by` guard) is implemented correctly,
matches the controller's rulings exactly where they override the brief, and is verified by
criteria shaped to go red for the right reason.
