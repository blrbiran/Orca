# Progress — syncskill integration (per-run skill snapshots)

Controller: Orca session 08b1007d, 2026-10-03. Spec: docs/superpowers/specs/2026-10-03-syncskill-integration-design.md (§10 overrides §1–§9).
Plan: docs/superpowers/plans/2026-10-03-syncskill-integration.md. Human (2026-10-03): execute subagent-driven; decide problems by the controller's recommendation without asking; report everything at the end.
Base: Orca main at the plan commit; ccloop main 85a9564 (pushed, = origin at start).

## Rulings
Ruling: skills apply to plan, execute and verify alike (spec §10.7) — human agreed 2026-10-03.
Ruling: the injected snapshot is made read-only (spec §10.6) — human agreed 2026-10-03.

## Tasks
SDD ledger — plan: docs/superpowers/plans/2026-10-03-syncskill-integration.md

## Pre-flight scan (controller)
| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T2 → T3 | `isSafeSkillName`, `PROFILE_NAME_PATTERN` (src/skills/syncskill.ts) → loopSkillsSchema | consistent |
| T2 → T4/T5 | `profileMembers`, `SyncskillError` codes → confirm / set-task-loop refusals | consistent (`skills-shape`, `skills-profile-empty`, `syncskill-failed:<E>`) |
| T2 → T6 | `injectSkills` → A2; block reason `skills-inject-failed:<SyncskillError.code>` | consistent with C10 text |
| T3 → T4/T5 | recipe `skills` → snapshot freeze, kept/no-op | consistent |
| T4 → T5 | `replaceTaskInSnapshot` gains a skills argument (T5); `readConfirmedTaskExecution().skills` (T4) | T5 must update the existing caller in setTaskLoop only — consistent |
| T4 → T6 | `readConfirmedTaskExecution().skills` → stepA2 | consistent |
| T1 → T6 | ccloop envelope `work.skillPluginDir` → Orca schema.ts copy + toStartEnvelope | consistent; Orca gate needs ORCA_CCLOOP_BIN = Task 1 build |
| T5 ↔ T7 | both edit web/src/LoopPlanCard.tsx (payload vs display) | sequential, no conflict |
| T4, T5, T6 | all add codes to src/control/errors.ts | additive; later tasks reuse existing codes |
| T1 self | validateEnvelopePaths(envelope) has no method argument today | needs the method passed from parseControlRequest — in scope |
| T6 self | A2 `removeOwnPath(dir)` on a leftover dir made read-only by a crashed earlier A2 cannot empty it | see ruling below |
| T2–T7 self | tests named match the code each task specifies | no further finding |

Ruling: work directly on Orca and ccloop `main` with local commits, no worktree branch — every previous Orca round did so, the human asked for this round to run unattended, and Rule 15 makes a merge into main a human act — cost if wrong: commits sit on local main instead of a branch (still unpushed, revertible).
Ruling: one helper removes a skills dir by first restoring owner write permission recursively, used by both A2's leftover removal and cleanupRunWorkspace — a read-only tree cannot be emptied otherwise — cost if wrong: none beyond the helper.
Ruling: Task 1 (ccloop tree) and Task 2 (Orca tree) run concurrently — different repositories, no shared file, and the one-implementer-per-tree rule still holds — cost if wrong: none (no shared state).
Task 1: dispatched (ccloop base 85a9564)
Task 2: dispatched (Orca base d017cb0)
Task 1: implemented (commits 5f58806..af26a22), DONE_WITH_CONCERNS: worker re-validates skillPluginDir as accept on relaunch => dir must live until collected; ENOTEMPTY cleanup flake in new accept test fixed by retries
Task 2: implemented (commit 847a7a6), DONE: concerns — real test cannot show --no-refresh matters (seeded dir unchanged either way; argv assertion is the proof); restore proof by staged-diff bytes
Task 2: review — spec ✅, quality Approved, 0 Critical/Important; 6 Minor (see task-2-review.md), e.g.:
Task 2: minor (deferred): STDERR_EXCERPT_BYTES slices characters, not bytes (syncskill.ts).
Task 2: minor (deferred): --no-refresh is guarded only by the fake-argv test; the real-bin test cannot turn it red (seeded dir unchanged either way).
Task 2: minor (deferred): an inject failure test uses target "/x".
Task 2: ⚠️ errors.ts registration of syncskill-failed:* and skills-shape is Task 4's — carried into Task 4 dispatch.
Task 2: complete (commit 847a7a6, review clean)
Task 1: review — spec ✅, quality Approved, 0 Critical/Important; 5 Minor (task-1-review.md), e.g.:
Task 1: minor (deferred): the envelope-hash golden at protocol.test.ts:384 never passes through the schema, so it cannot go red.
Task 1: minor (deferred): the M4 per-method check sits in one `it`; `collect` alone was never seen red.
Task 1: minor (deferred): a replayed `accept` after skillPluginDir is removed answers control-request-invalid ⇒ Orca must keep skills-<runId> until the run is collected (carried into Task 6).
Task 1: complete (ccloop commits 5f58806..af26a22, review clean)
Task 3: implemented (commit 60a0eb0), DONE; note: both-keys/empty/bad-profile refused by zod at plan parse, name-rule as loop-plan-invalid:<task>:skills-shape
Task 3: review — spec ✅, quality Approved, 0 Critical/Important; 3 Minor (task-3-review.md).
Ruling: C2's both-keys / empty-names / bad-profile cases are refused by the plan-file zod schema (`malformed: tasks.N.loop.skills: Invalid input`), not as `skills-shape`; only name-rule violations answer `loop-plan-invalid:<task>:skills-shape` — every other malformed plan field is refused the same way and it fails closed — cost if wrong: a person sees a less specific error for those three shapes.
Task 3: minor (deferred): loopRecipeSchema does not apply the name rule; only expansion validates names.
Task 3: minor (deferred): the "contract has no skills" test passes trivially (guard only).
Task 3: complete (commit 60a0eb0, review clean)
Task 4: dispatched (Orca base 60a0eb0, opus)
Task 4: implemented (commit 114b20d), DONE with deviations: deps.syncskill optional (absent = unconfigured); all 9 codes durable 422; zh locale entries added; agent check compares the installation id to "claude".
Ruling: the plan's confirm-time `skills-unsupported-agent` check is wrong — `selection.agent` is an agents-table installation id (ccloop materialize.ts resolveAgent: kind = table.installations[id].kind) and Orca never reads the table nor freezes the kind. Remove the Orca-side agent check and rely on ccloop's acceptStart refusal (Task 1: nothing persisted; Orca blocks `accept-refused:skills-unsupported-agent`) — cost if wrong: a codex task with skills is refused at run start instead of at confirm.
Task 4: review — spec ✅, quality Approved, 0 Critical/Important; 7 Minor (task-4-review.md). Controller-confirmed gaps entering the fix loop: F1 agent check by installation id (ruling above); F2 names-only task with syncskill unset must refuse confirm `syncskill-unconfigured`.
Task 4: minor (deferred): skills refusals precede prepareExecutionSnapshot's own checks (brief placement vs spec "after every existing check").
Task 4: minor (deferred): a syncskill lookup is spawned even when confirm will refuse no-op/stale.
Task 4: minor (deferred): a broad catch while reading recipes before the transaction.
Task 4: minor (deferred): syncskill-timeout is recorded as a durable outcome for that command id.
Task 4: minor (deferred): fake-syncskill path in a test depends on cwd.
Task 4: fix round 1 dispatched (F1, F2, bare toThrow)
Task 4: fix round 1/5 implemented (commit 7ab2fa2): F1 agent check removed with skills-unsupported-agent unregistered in Orca; F2 names-only + unset bin refused; named error in test. Scoped re-review dispatched.
Ruling: spec §10.5's set-task-loop `skills-unsupported-agent` refusal is dropped for the same reason as F1 (installation id, not kind) — ccloop acceptStart is the only agent-kind authority — cost if wrong: a codex task given skills after confirm is refused at run start, not at set-task-loop.
Task 4: fix round 1/5 (3 addressed, 0 open; commits 114b20d..7ab2fa2)
Task 4: complete (commits 60a0eb0..7ab2fa2, review clean)
Ruling: a set-task-loop payload without `skills` removes the task's skills (the payload is the full desired state, like `inputs`); a profile is looked up before the transaction whether the task is draft or confirmed, the result used only on the confirmed branch — cost if wrong: a draft set-task-loop with a profile fails when syncskill is unavailable, though confirm would fail anyway.
Task 5: dispatched (Orca base 7ab2fa2, opus)
Task 5: implemented (commit edf59e3), DONE; 7 existing test files got `await` (49 calls), setTaskLoopConfirmed passes null to replaceTaskInSnapshot; BudgetEditor's estimate-suggestion path also re-sends skills.
Task 5: controller-confirmed gap (H3): a budget-only set-task-loop on a confirmed task re-resolves its profile and can change the frozen names or be refused when syncskill is unset. Fix: when the payload's skills equal the current recipe's skills, keep the frozen snapshot entry and spawn nothing; look up only a changed declaration.
Task 5: review — spec ❌ (H3), quality Needs fixes; Important I1 (budget-only edit re-resolves a frozen profile); 3 Minor.
Ruling: an unchanged skills declaration on a confirmed task keeps its frozen snapshot entry with no lookup; draft tasks never look up (confirm freezes them); a confirm race is refused as a state conflict — H3 says later profile edits do not reach a confirmed task — cost if wrong: none beyond H3.
Task 5: minor (deferred): a skills-only change never sets planChanged (H12 is about the contract; skills are not in it).
Task 5: fix round 1 dispatched (I1, draft lookup, re-indent)
Task 5: fix round 1/5 implemented (commit dc70658): I1 unchanged declaration keeps frozen entry, drafts never look up, race refused proposal-version-conflict, re-indent; redundant unset-bin check removed (profileMembers already refuses). Scoped re-review next.
