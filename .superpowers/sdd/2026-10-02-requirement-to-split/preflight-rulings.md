## Controller rulings on the preflight scan (2026-10-02, session b5e8d368; preflight-scan.md in the SDD workspace)

These override the task text they name. Each implementer whose task is named must apply them.

- PR-B1 (Tasks 4, 12, and any harness that makes a clarifying group): a clarifying group used by a criterion is created
  through `requirement-open` (the production path), or, where a task inserts rows directly, with exactly the
  `revision` and `projection_seq` that `requirement-open` writes (both ≥ 1). The summary's positivity checks
  (`webProtocol.ts:895-896`) stay as they are.
- PR-B2 (Tasks 8, 11): the `startAt: "split"` harness seeds round 1 with a slug, so the group's `requirement.slug` is
  set; Task 11's criteria rely on it.
- PR-I1 (Task 9, M9.6): the criterion for "consensus refused while a call is in flight" sets up an answered latest round
  AND a call in flight, so the in-flight check is the only refusal; then M9.6 must be seen red at that criterion.
- PR-I2 (Task 7, M7.1): the document fixture carries one accepted and one rejected glossary proposal, so M7.1 can be red.
- PR-I3 (Task 5, M5.5): the criterion plants a hostile `sgconfig.yml` (the customLanguages form measured in Task 0, rc
  79 without `-c`) at the root of the export directory, runs the real or fake binary from there, and asserts the
  overview's structure is `ok`; M5.5 drops `-c` and must be seen red. Orca's own sgconfig lives outside the export
  directory's ancestry.
- PR-I4 (Task 6; spec §5.1 is binding, "written once"): where `claimRequirementCallInTransaction` /
  `settleRequirementCall` would repeat the estimate claim or settlement line for line, extract the shared part into one
  helper used by both purposes; purpose-specific parts stay separate. Every estimate criterion stays unchanged and green.
- PR-I5 (Tasks 3, 4, 6, 10): one helper computes the clarifying ledger mirror and one predicate answers "has a
  requirement block"; every caller uses them.
- PR-I6 (Tasks 5, 11): every file Orca creates outside the repository is 0600 — `export.tar` opened with mode 0o600, and
  the `tar`/`git` children that create files (extraction, `GIT_INDEX_FILE`, scratch document/message) run under
  `umask 077`; a criterion asserts the modes.
- PR-I7 (Task 12): editing `webParity.test.ts` is permitted as a named rewrite under the human's standing instruction
  for this session; the report names the test and what it now encodes.
- PR-I8 (Task 3): DR5 is ruled (controller, under the human's standing instruction); the two "5" assertions are
  rewritten as named in the plan.
- PR-I9 (wherever `FIXTURE_SLOT.configHash` is used): a valid 64-hex hash, measured as the plan says.
- PR-I10 (Task 14): every fake-claude queue entry the criterion needs, the estimate's included, is enqueued before the
  command that can trigger the call.
- Minor findings (20) in preflight-scan.md table 3: each implementer reads the rows for its task and applies the ones
  that are fixes to its own text; none is load-bearing.
