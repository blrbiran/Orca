# A path a success condition names is part of the task's write authority

**Status:** accepted 2026-11-16 (session `2026-11-16`, human ruling: continue and report at the end).
**Issues:** #265 (and the `add-implied-path` follow-up from tester follow-up K).

## The problem

A split task's `successCondition` can name a file another task lists -- "README.md documents the
history command" while only the docs task lists `README.md`. The run then writes it, stops on
`allowlist miss`, and the task waits for a person. The tester's case cost 8.9M tokens. The existing
answer was a hint (`impliedPathsOutsideTargets`) plus the manual `requirement add-implied-path`; the
hint only tells the person after the model already produced the inconsistent draft, and the run still
discovers it the expensive way.

## Decision

For a single-repository split, make the split itself add every hinted path to the mentioning task's
`targetPaths` before expanding and validating the draft:

- the added paths are computed by the existing `impliedPathsOutsideTargets` (whole-token mention, only
  paths some task lists, bare document names when unambiguous);
- the adjusted draft is what is stored, hashed, shown and accepted;
- the write-set intersection rule (#268) then turns the shared path into the same implicit edge it
  already creates for any two tasks writing one file, so the two tasks run serially;
- validation runs on the adjusted draft, so an addition that creates a cycle or an invalid shape (an
  `investigate` task that would now write two files, say) fails the draft honestly instead of being
  accepted and blocked at run time;
- the draft records `impliedPathsAdded: [{taskId, path, writers}]`; `requirement show` prints one
  `implied-path-added:` line each. The old `impliedPathsOutsideTargets` hint stays for drafts that
  still have an unresolved hint (multi-directory drafts, and drafts stored before this change).

Multi-directory drafts keep the hint and the manual command: a write must name its directory, and a
path alone may exist in more than one member. Adding it automatically to the wrong member's write set
would be worse than the hint.

## Why this shape (and not the alternatives)

- **Hard reject** was tried and rolled back: it broke four existing hint fixtures and it is wrong in
  principle -- a success condition naming another task's file is often the truthful description of a
  shared file.
- **Keep the hint** leaves the expensive failure in place; the tester's run is the evidence.
- **Auto-add + serialise** is the only option that makes the contract self-consistent: if A's
  condition requires README, A must be allowed to write README; if B also writes it, #268 already
  knows how to order them. The person still reviews and accepts the adjusted draft.
- The runtime `--allow-observed-paths` retry stays as the recovery path for misses the text matcher
  cannot see.

## Non-goals

- No path inference beyond whole-token names of paths some task already lists.
- No automatic acceptance of the adjusted draft; the person still accepts it.
- No change to the allowlist semantics at run time.
- No automatic edit for multi-directory drafts.

## Tests

`tests/control/splitImpliedPaths.test.ts`:

1. `applyImpliedPaths` adds README.md to the CLI task, records the addition, and the adjusted draft
   has no unresolved hint; a clean draft is returned unchanged.
2. The harness stores the adjusted draft (`targetPaths` contains the path, `impliedPathsAdded` set),
   the view carries the addition, and the draft is accepted.
3. Two tasks that now share the added path get one implicit edge, and acceptance writes it into
   `dependsOn`.

`tests/control/requirementDraftEdit.test.ts`: a single-repository draft already has the path, so the
manual `add-implied-path` refuses `draft-edit-not-an-implied-path`; the multi-directory manual edit is
unchanged.

Mutations: drop the `targetPaths` push → the target list and the serial edge are missing (red); drop
the validation of the adjusted draft → an `investigate` addition is accepted instead of invalid (red);
add the path without re-running the graph → no implicit edge (red).