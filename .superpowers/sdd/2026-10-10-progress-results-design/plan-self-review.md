# Plan self-review

Codex controller, 2026-10-10 Asia/Shanghai. Independent spec review and re-review are complete; re-review Ready, no open P0/P1/P2. Plans are progress Tasks 1–4 and results Tasks 1–5. User selected subagent-driven implementation and autonomous rulings with final audit; no intermediate approval question.

## Coverage and task alignment

| Specification requirement | Owning task |
|---|---|
| truthful groups, human steps, missing/archived/read counts | Progress 1 |
| progress-first default/nav, owner focus, decision freshness | Progress 2 |
| global/panel defaults, explicit project, account permissions | Progress 3 |
| detail defaults, valid controls, poll focus/drafts | Progress 4 |
| optional nonfatal report, opaque parser, packaged runner | Results 1 |
| isolated capture, live RPC, immutable verification stages | Results 2 |
| metadata jobs/fence/unsupported cache, archive isolation/cleanup | Results 3 |
| read-only task/group aggregate, member authority, saved preview | Results 4 |
| result UI/history/escaping/availability, documentation | Results 5 |
| full gates, clones/mutations, browser geometry, final review/handoffs | Controller close shared by both plans |

## Shared-file/interface pre-flight table

| Tasks | Interface or file | Check/ruling |
|---|---|---|
| Progress 1/2 | Overview DTO | Same names and shapes; server/browser mirrored, navigation only |
| Progress 2/3 | App/sections/Shell/locales | Sequential; settings entries extend established nav, no callback takeover |
| Progress 2/4 | owner focus/region ids | Exact preparation/dispatch/problem/integration/results vocabulary mapped in detail; selected region poll-stable |
| Results 1/2 | optional taskResult + normalization | Same status/report/reason/diagnostic contract; invalid remains nonfatal |
| Results 2/3 | collection/manifest/evidence | Explicit schema/identity/revision/stage fields mirrored; no unpublished package import |
| Results 3/4 | admitted outbox/projection | Readers use admitted immutable closure; no GET capture/write; recordProjectionChange only actual result change |
| Results 4/5 | strict result DTOs/API | Same fetch/run/group/output shapes; captureRevision/currentAttempt/source are independent |
| Progress 1/Results 4 | webProtocol/controlApi | Sequential endpoint additions, strict mirror parity, generic read permissions preserved |
| Progress 4/Results 5 | GroupDetailRegions/task detail | Explicit Results placeholder replaced, completed missing result remains visible |
| Progress 2/Results 5 | App epoch/scoped sources | Separate freshness/request identity, hidden-pane reads absent, no command creation |

Each task's tests, file list and implementation/interface were checked against its own text. No mandatory test asserts only a mock; initial business RED must precede code, final mutation proof is independent. Added explicit decoder/predicate assertions to clarify test intent without prescribing function bodies. NormalizedTaskResult's diagnostic property was made explicit before publication. The plan introduces no undefined helper consumed by a successor.

Review-focus classes each point to an owning acceptance test. Plans use small code assertions, not an implementation transcript. Exact global limits copied from specs; effective §8 precedence resolves historical transport wording. No task adds handoff/Candidate/collect/capability fields or changes the installed pin.

Ruling: cleanup may flush optional retention only AFTER business settlement, with a 67000-ms overall bound including queue wait — 64 bounded evidence RPCs plus index/manifest allowance — failure records unavailable and proceeds with cleanup, without changing outcome or holding settled budget. Cost if wrong: delayed cleanup or unavailable optional output, not extra provider execution. Final review must audit this path.

Baseline evidence: Web92/751/0fail RC0. ccloop125 files/1298pass/1fail, CLI example 5000-ms timeout was UNKNOWN to known-red checker; full result is not green. Same unchanged CLI file three isolated runs37/37 each RC0, with load observations retained. No test edit or new flake waiver. First ccloop full attempt had min/max worker conflict before tests; retained, rerun used Vitest2 minWorkers1/maxWorkers2. Orca root baseline still running on unchanged source when this note was written.

Ruling: proceed from the explicit source baseline and named scoped recovery per user's autonomous recommendation instruction; final full gates must rerun and classify actual failures, never turn this baseline timeout into a new waiver.
