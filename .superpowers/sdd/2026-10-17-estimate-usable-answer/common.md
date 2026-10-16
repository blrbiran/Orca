# Common context for every implementer and reviewer of this plan

Project: Orca (/Users/biran/code/skills/orca/Orca-wt/round-20261017, branch codex/round-20261017). Read its CLAUDE.md (the repo rules; Rules 9, 12, 13, 14, 15, 17 bind you).
Spec (binding): docs/superpowers/specs/2026-10-17-estimate-usable-answer-design.md — read §1-§4 before coding.
Code/comments/docs in English.

## Global Constraints

- Work only in the worktree `/Users/biran/code/skills/orca/Orca-wt/round-20261017`, branch `codex/round-20261017`; never push, merge, or delete branches (Tier 0).
- Every git command is `/usr/bin/git`. Every verification run redirects to a file and the whole file is read back (CLAUDE.md Rule 14).
- Tests run with `ECC_GATEGUARD=off DISABLE_OMC=1 ./node_modules/.bin/vitest run <files>`; web tests from `web/` with `../node_modules/.bin/vitest run <files>`; new web DOM test files start with `// @vitest-environment jsdom`.
- Rule 9: every new branch gets a named mutation (done in a `git clone --local` copy, never the worktree) that removes it and is seen red; restore proof is `git diff`/`git diff --cached` byte counts 0/0. Report each mutation in the task report.
- Existing criteria may be rewritten when the change requires it (human authorization, 2026-10-17, this session); each rewrite carries a comment `Ruling (session 4de777f4, 2026-10-17): …` saying why.
- v1 requests, the v1 instruction text and `BUDGET_ESTIMATE_JSON_SCHEMA` stay byte-identical. `responseSchemaVersion` stays the literal `budget-estimate-v1`; the request schema stays `budget-estimate-request-v1`.
- Placeholder rationales (trimmed, lower-cased): `placeholder`, `todo`, `tbd`, `x`, `n/a`, `...`, `-`.
- `problems`: at most 20 entries, each at most 200 characters, never empty when a retry is queued.
- Retry id: `estimate-${sha256Canonical({ groupId, retryOf: failedEstimateId }).slice(0, 24)}`; version = max existing + 1.
- No write to `~/.orca` from any test or script (Rule 17); no paid call from any task (paid runs are the controller's, after Task 7).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (an implementer on another model writes its own true model name).

## Review Focus

- Estimate rows written before this change (no `repairs`/`proposalVersion`/`origin`) must still decode, display, and never get a retry (`proposal-unknown`). → Task 2 and Task 5 tests.
- The person edits the budget proposal between the failed call's queueing and its settlement: no retry (`proposal-changed`); a person's newer `estimate` already queued: no retry (`superseded`). → Task 5.
- The settlement is replayed (crash after commit, driver re-runs Ce): the receipt makes the second completion return early; exactly one retry row exists. → Task 5.
- Task ids that are object-prototype names (`constructor`, `toString`) or all digits (`10`, `2`) in a v2 keyed answer. → Task 1.
- A large plan whose every entry is broken: problems are capped at 20 × 200 chars and the retry prompt still fits or skips with `input-too-large`. → Task 1 (cap), Task 5 (size skip).

---

- For any run that touches real-ccloop criteria (scheduler, *E2E, full suite), export ORCA_CCLOOP_BIN=/private/tmp/ccb6-qswQ/ccloop/dist/cli.js (a build of the pinned ccloop) and CCLOOP_CACHE_DIR=$(mktemp -d /private/tmp/cc-t-XXXX). Without it ~40 criteria red with "ccloop bin not found" (environment, not a regression).
