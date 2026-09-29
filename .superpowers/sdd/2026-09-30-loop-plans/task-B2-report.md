# Task B2 report — `set-task-loop` (protocol, refusals, draft path, self-check)

Implementer session 1d7d9aa0 (Opus 5.5), BASE 3a75bd7, commit **686e745**
`feat(control): add set-task-loop for a loop task that has not started`.
SCRATCH = `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/1d7d9aa0-4a2b-478b-b0ec-d970d3a51afe/scratchpad/b2/`
(every evidence file named below lives there; mutation clone `…/scratchpad/mut-b2`, kept).

## What was implemented

- `src/control/errors.ts`: `task-loop-version-conflict` (409); `group-reserve-insufficient`, `loop-plan-invalid`,
  `task-already-started`, `task-has-no-loop-plan` (422), at the brief's positions.
- `src/control/webProtocol.ts`: verb `set-task-loop`; `setTaskLoopPayloadSchema` (strict; work strict, no sessions);
  raw + effective variants with `taskCommandTargetSchema`; result `task-loop-set`; `SetTaskLoopPayload` type.
- `src/control/executionSnapshot.ts`: `deriveContract` exported (no other change).
- `src/control/webService.ts`: `SetTaskLoopCommand`; `WebControlService.setTaskLoop` following the brief step by step;
  **new helper `resetDraftReserve(store, id, group, proposal): Amount`** (ruling P5) — the commitments sum +
  `setReserve(residual(...))` that `editProposal` and `proposalSetAgent` each had verbatim; all three callers now use it
  (behavior-preserving: same two statements, same position in each caller; editProposal's no-op check still sits
  between the reserve reset and `reopenProposal`). The work row is read through B1's `workBodyOf`.
- `web/src/controlTypes.ts`: verb, result kind, `SetTaskLoopPayloadV1`. `tests/panel/webParity.test.ts`: two parity
  functions + entries (additive).
- `tests/control/fixtures/taskLoop.ts` and `tests/control/setTaskLoop.test.ts` copied verbatim from the brief (extracted
  programmatically from the brief's code fences), plus three additive criteria (ruling P3, see below).

## RED

`./node_modules/.bin/vitest run tests/control/setTaskLoop.test.ts > b2-red.txt` → rc=1, 16/16 failed, every one
`setTaskLoop is not a function` (expected: the method did not exist).

## GREEN

- `b2-green-final.txt` (rc=0): setTaskLoop, taskAmendments, errorClassification, webProtocol, taskLabels, proposal,
  webParity **plus every file that exercises the refactored callers** (agentFreeze, agentPlanImport, confirmation,
  estimateE2E, estimator, stopIntent, webMutations, panel/agentSelectionApi, panel/controlApi): 15 files passed,
  1 skipped; 201 passed, 3 skipped. The 3 skipped are `estimateE2E.test.ts` (gated off outside the full run, as in the
  A7 gate) — so it did not exercise the helper here.
- `npm run typecheck` → `b2-tsc-final.txt` rc=0. Web typecheck → `b2-web-tsc-final.txt` rc=0 (empty).

## Mutations (clone `mut-b2`; copy check `b2-copy.txt` / `b2-copy2.txt` empty; every restore `b2-MB2-*-restore.txt` empty, cmp rc=0)

Final run is against the final test file (18 criteria); evidence `b2-MB2-<n>.txt` (+ `-tsc.txt`), summary `b2-mut-summary2.txt`, `b2-mut-summary3.txt`.

| # | Edit | Red criterion (reason) |
|---|---|---|
| MB2-1 | run query `AND active=1` | "refuses a task that is running, and one that has any run at all…" (2nd assertion: recovery-blocked, not task-already-started) |
| MB2-2 | reserve-shortfall loop deleted | "refuses a raise the reserve cannot cover…" (got group-budget-unavailable) |
| MB2-3 | `readConfirmedTaskExecution` deleted | "the self-check > rolls a confirmed change back…" (change committed) |
| MB2-4 | `\|\| group.stopped` deleted | "refuses a stopped group…" |
| MB2-5 | estimate loop deleted | "refuses while an estimate is running…" |
| MB2-6 | version check deleted | "refuses a stale loopVersion, …" (1st assertion) |
| MB2-7 | no-op check deleted | "refuses the same contract and the same budget as no-op-command" |
| MB2-8 | `setReserve(...)` deleted **inside `resetDraftReserve`** (P5 form of the brief's draft-branch line) | "raises the budget…" and "lowers the budget…" (recovery-blocked from the step-8 conservation check) |
| MB2-9 | `reopenProposal(...)` → `committedRemaining = …; saveWebAuthority(...)` | "raises the budget … advances the proposal version…" (proposalVersion 1) |
| MB2-10 (P3) | status test deleted (only `group.stopped` kept) | all four "refuses a group whose status is running/review/done/blocked…" |
| MB2-11 (P3) | work-not-found line deleted | "refuses a stale loopVersion, … unknown task…" (TypeError) **and** typecheck red |
| MB2-12 (P3) | `work.status` half of task-already-started deleted | **GREEN** — see concerns |
| MB2-13 (P3) | task-has-no-loop-plan deleted | "refuses a stale loopVersion, … hand-written task…" |
| MB2-14 (P3) | loop-plan-invalid deleted | "refuses … an unknown plan…" (ZodError) and typecheck red |
| MB2-15 (P3) | `!allocation \|\| !handoff` deleted | **typecheck red only** (`allocation`/`handoff` possibly undefined); vitest green (unreachable: a missing allocation row already fails step 1's conservation check) |
| MB2-16 (P3) | numeric-overflow deleted | new "refuses a loopVersion that cannot advance as numeric-overflow" (ZodError instead) |
| MB2-17 (P3) | provenance condition `if (next[d] !== before[d])` dropped | "raises the budget…" (sessions provenance became human) |
| MB2-18 (P3) | step-1 `assertKnownConservation` deleted | new "checks the ledger first: unknown usage on a stopped group is recovery-blocked" (got group-state-invalid). Before that criterion existed it was green (masked by step 8) |
| MB2-19 (P3) | step-8 `assertKnownConservation` deleted | **GREEN alone** (a guard: nothing correct breaks conservation). MB2-19b = MB2-8 + MB2-19: red in "raises…"/"lowers…" at `expectConserved` — proves MB2-8's refusal is this check's |
| MB2-20 (P3) | whole confirmed-branch body deleted | "the self-check > rolls a confirmed change back…" (committed) |
| MB2-21 (P3) | `writeCanonicalRecord(expanded.hash, …)` deleted | new "stores the amended contract where the single-task reader finds it" (readArchivedContract: recovery-blocked). Before that criterion it was green |
| MB2-22 (P3) | draft-branch work-item write deleted | "raises the budget…" (loopPlan not amended) and "stores the amended contract…" |

## Criteria added beyond the brief (additive, same file; ruling P3)

1. `refuses a loopVersion that cannot advance as numeric-overflow` — pins the overflow guard (MB2-16).
2. `checks the ledger first: unknown usage on a stopped group is recovery-blocked` — spec §5.2 step 1 order (MB2-18).
3. `stores the amended contract where the single-task reader finds it` — `readArchivedContract` (B1 made it
   amendment-aware) must answer the amended contract (MB2-21).

## Departures

- **Not calling `prestart` (ruling P5 said "call prestart").** `prestart` answers `grant-amendment-unsupported` for
  running/review/done; spec §5.2 step 1 and criterion 8 (and the brief's `it.each`) require `group-state-invalid`
  for every status but draft/ready, plus stopped. Calling prestart would turn 3 of the 4 status criteria red.
  Evidence (spec + criterion) outranks the ruling's wording here (Rule 7); the inline check is one line with a comment
  saying why. Reversible; controller may overrule.
- P5 helper shape: extracted the two statements editProposal/proposalSetAgent/setTaskLoop share
  (`resetDraftReserve`), not "reserve + reopen", because editProposal's no-op check sits between them and moving it
  would not be strictly behavior-preserving.
- Commit message: added one paragraph naming the helper extraction.

## Self-review / concerns

- **MB2-12 green (masked):** the `work.status !== draft/ready` half of task-already-started. Any work item not
  draft/ready with a non-terminal allocation needs a current run row (else step 1 refuses recovery-blocked), and the
  run row alone already refuses. I found no reachable state where only the status half decides; kept because the spec
  names it. Registered, not fixed.
- **Confirmed branch unobservable in B2:** its internals (reserve delta, derive, work write, saveWebAuthority) are
  always rolled back by the step-8 self-check until B3 adds the snapshot copy; only whole-branch deletion (MB2-20) and
  the self-check (MB2-3) are seen red. Carry to B3: per-line mutations of that branch once it can commit.
- The work row is read through `workBodyOf`, which maps an unparsable body to null → `work-not-found` (the brief's
  inline `JSON.parse` would have thrown a SyntaxError instead). Not covered by a criterion.
- D3 (preflight) still stands: `expectUntouched` cannot tell "refused before writing" from "wrote then rolled back".

## Files changed

src/control/errors.ts, src/control/webProtocol.ts, src/control/executionSnapshot.ts, src/control/webService.ts,
web/src/controlTypes.ts, tests/panel/webParity.test.ts; created tests/control/fixtures/taskLoop.ts,
tests/control/setTaskLoop.test.ts. Commit trailer verified in `b2-msg.txt`.
