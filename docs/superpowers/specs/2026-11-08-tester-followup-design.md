# Tester follow-up: executable checks and usable next steps

Date: 2026-11-08. Owner: current Orca development session. Based on tester observations #168, #179 and #157 in `orca_archived_files/issue-20261023.md`, reconciled with current main and the user's approval of the proposed sequence. The archived report is evidence, not an implementation mandate.

## Intent

An agent should receive checks it can satisfy using the files its task may change. A person or agent looking at a completed review should see its actual outcome and a route to its evidence, without instructions to repeat pre-start work. Orca's operating skill should guide someone from a requirement through execution and from a blocked state to the relevant diagnostic and action.

## #168: checks owned by the task

- Advance the split instruction version for both single- and multi-directory projects. Frozen in-flight calls retain their existing envelope.
- Tell the splitter to select checks whose failures the task can fix within its writable target paths and any already completed dependencies. A check of a delivered document is appropriate for a document-only task. A repository-wide suite is appropriate when it is already passing and must remain passing, or when the task's writable scope can fix its relevant failures. A baseline-red suite outside a document-only task's scope is not a valid required check for that task; give the responsible implementation task that check and the source/test paths it needs.
- Keep the existing script-exists, check-source and no-verify-only rules. Do not run arbitrary model-proposed checks during split validation; static shell analysis cannot establish arbitrary check satisfiability.
- Ask the operator reviewing a draft split to inspect `checks` against `targetPaths` before accepting it. This is guidance, not a new refusal rule.

## #179: completed review navigation

- Keep default unlimited token provenance visible on a completed group or proposal. Suppress pre-start estimate/apply/confirm or reopen instructions once the group is terminal. Keep those instructions on editable and confirmed-but-not-started proposals, including the existing post-confirm message.
- A parent group detail should show criteria review state, reason when provided, and an action opening its review group using the existing group navigator. The Board remains a brief summary. This must not cause an ordinary empty result to count as accepted work.

## #157: operating guide

- Retain SKILL.md as the short entry point, with a link to a handwritten workflow reference. Show two paths: a new idea through clarification/split/estimate or conscious default/confirm/brief/diagnose, and importing an existing plan. Map relevant group states to a read and next action; map actionable error causes to evidence and safe next steps.
- Do not duplicate the generated CLI verb references or claim that a model estimate is required before confirmation. Make clear that commands can be accepted while work remains pending, that human-only actions still require a person, and that unknown usage or missing recovery evidence cannot be guessed away.

## Constraints and verification

No new protocol field or database migration. English code, tests, spec and skill; Chinese handoff. Targeted tests first, with a demonstrated red criterion for each new behavior, then `npm test` (which chooses affected tests and runs typecheck) per Orca Rule 18. No release-only verification or paid model call. A separate design will address #158's missing OMP malformed-final capsule; this document does not weaken its recovery gates.
