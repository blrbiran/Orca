# Feedback Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]` / `- [x]`) syntax for tracking.

**Goal:** Keep the development test gate usable while the panel runs, preserve dependency order in estimate diagnostics and Board failures, and give accurate funding descriptions.

**Architecture:** Narrow the real-user-data snapshot exemption to the panel's temporary accept lock file, preserving durable files and same-named directories. Interpret v1 estimate answers in the archived plan array order, v2+ answers in dependency order, and serialize every result in canonical task ID order. Keep funding calculations unchanged and correct only the preview classification and human wording.

**Tech Stack:** TypeScript, Vitest, SQLite, React UI types.

**Spec:** `/Users/biran/code/skills/orca/orca_archived_files/issue-20261023.md` issues #315, #296 and #291 (outside this repository); existing `docs/superpowers/specs/2026-11-16-implied-write-paths-design.md` establishes task write-set ordering independently.

## Global Constraints

- Never write to real `~/.orca` from tests; keep Rule 17's snapshot checks for durable files.
- Preserve canonical plan, estimate, and group view storage order and hashes.
- Only `npm test` and typecheck are routine gates; full `npm run verify` is release-only.
- Use `/usr/bin/git` for git evidence, and redirect verification output to a file before reading it.

## Review Focus

- A temporary lock under a different run root remains guarded (Task 1).
- A durable `accepted.lock` or `accepted.json` under a panel run remains guarded (Task 1).
- A v2+ estimate that answers prerequisite before dependent has no spurious repair; a v1 estimate keeps its frozen canonical-array instruction (Task 2).
- A malformed or duplicate task answer remains rejected/repaired according to current rules (Task 2).
- A finite expectation group's preview cannot describe its task token grant as unlimited (Task 3).

---

### Task 1: Panel runtime snapshot guard (#315)

**Files:** Modify `tests/setup/relocateUserData.ts`; extend `tests/setup/relocateUserData.test.ts`.

**Interfaces:** `userDataSnapshot(root?: string): string[]` remains public; helper matches only `control/panel.runs/<run-id>/control/accepted.lock.<UUID>`.

- [x] Add a test with a temporary fake root: a canonical temporary accept lock is ignored; adjacent `accepted.lock`, `accepted.json`, `accepted.lock.stale-*`, unrelated run root locks and ordinary control files are reported.
- [x] Run `vitest run tests/setup/relocateUserData.test.ts` and observe the named behavior fail.
- [x] Add one exact-path predicate at the snapshot walk, without dropping other `control/` files.
- [x] Run the focused test and root typecheck, preserving full logs.
- [x] Commit the independently verified change.

### Task 2: Estimate and Board task ordering (#296)

**Files:** Modify `src/control/estimateSettlement.ts`, `src/control/estimateRepair.ts` only if required for distinct interpretation/storage ordering, and `src/panel/controlViews.ts`; extend `tests/control/estimateRepair.test.ts` or a settlement fixture, and `tests/panel/boardCard.test.ts`.

**Interfaces:** `estimateTaskIds(request)` returns dependency order; `BudgetEstimateV1.tasks` remains canonical ID order. Board first failure uses dependency order only for selection, not view storage.

- [x] Add a reversed-ID dependency example proving a prerequisite-first answer does not get `tasks-reordered` and a reversed answer does; both persist canonical ID order. Include malformed/duplicate regression.
- [x] Add a Board example with `a-integration` depending on `z-core`, both failed; `firstFailure` is `z-core`.
- [x] Run each focused test to see behavior-specific failures.
- [x] Adjust interpretation and output serialization at the estimate settlement boundary; choose Board first failure using plan order. Preserve storage schemas.
- [x] Run focused tests, root typecheck, then `npm test` with complete logs and recorded skip counts.
- [x] Commit the independently verified change.

### Task 3: Funding preview semantics (#291)

**Files:** Modify `src/control/fundedAllowance.ts`, `src/commands/domains/verbs.ts`; extend `tests/control/fundingPreviewDraft.test.ts` and `tests/commands/fundingPreview.test.ts` as needed.

**Interfaces:** `FundingPreviewRow` retains optional `expectation`; the renderer distinguishes claim-time slice from a hard task cap and names ineligible state without calling it missing funds.

- [x] Add a failing finite-group case for null and finite non-hard expectation: do not claim unlimited spending or task hard cap; current skip reasons remain specific.
- [x] Fix the preview marking and human line while leaving `decideFundedAllowance` untouched.
- [x] Run focused files, typecheck, and daily `npm test`; preserve complete logs.
- [x] Commit the independently verified change.

## Later independent plans

- ccloop #316 is implemented in `ccloop/docs/superpowers/{specs,plans}/2026-11-16-codex-log-array-compatibility*` (sibling repository); its remote publication and Orca repin remain blocked by Tier 0.
- #225, #224/#266/#196 are scoped in `docs/superpowers/specs/2026-11-16-budget-confidence-proposal.md`; it proposes honest response-boundary copy and measured estimate calibration, without claiming an absolute provider spend cap or using a universal multiplier.

## Review corrections (as built)

- The v1 estimator instruction explicitly asks for the archived plan array order, so its repair diagnostic compares canonical taskId order. v2+ keyed/prompt-mode instructions use dependency order. Both persist a canonical result. The new v1 counterexample was RED before the correction and GREEN after it.
- The preview names a person's `tokenIntent.hard` as `taskCapTokens` even when the stored allocation has `tokens:null`, avoiding a false “unlimited” claim. The preview still does not alter real funding.
- The panel accept-claim snapshot exception checks `lstatSync(...).isFile()`, keeping a same-named directory and its contents guarded. The directory counterexample was RED then GREEN.
