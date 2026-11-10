# Tester follow-up B (2026-11-10, session after `9179cdad`)

Source: `orca_archived_files/issue-20261023.md` #202–#241, verified against Orca `43f76e90` / ccloop `e47f763`
(pin `73fff1a`) by four read-only reviews in this session. Human rulings, this session (verbatim): "要你定的 => 按你的建议走。
#219 同意改裁定。#224／#225 同意软上限。" "repin 为什么每次都跑这么久 => 同意，按你的建议走" "这轮做哪些。 => 按你的建议走".

Rulings this plan carries out:
- R1 (#219): published ruling U2 (`docs/superpowers/specs/2026-09-27-panel-ui-redesign-design.md:91-94`, panes always
  mounted) is changed: a non-current section is unmounted. Recorded as an appended correction; the original text stays.
- R2 (#241): after a task lands by a clean merge onto a group tip it was not tested against, its required checks run again on
  the merged tree before the ref moves. Default on.
- R3 (#235): the ccloop stop order is unchanged (spec `2026-10-20-verifier-sees-checks-and-last-failure-design.md` §3/§11).
  The paid doomed retry is closed by T2's funding floor instead.
- R4 (#224/#225): budgets are soft. Orca does not promise a hard cap; overspend must be visible and, where an adapter can stop
  mid-phase (claude, omp), it should. The ccloop live threshold is deferred to the next cross-repo batch.
- R5 (#227/#208): brainstorm then spec, not this round.
- R6 (repin): when the only dependency change is the ccloop pin, `npm test` selects the ccloop-dependent tests, not the whole
  suite; a repin does not re-run ccloop's full suite (that is ccloop's own commit gate).

Every task: TDD, each new criterion seen red before the product change; `npm test` (affected) plus typecheck; web changes
also `cd web && npx tsc --noEmit -p tsconfig.json`. Rewriting an existing criterion is allowed only where the ruling above
changes the behaviour it pins; each rewrite carries a `Ruling:` line naming R1–R6.

## T1 — a run blocked after landing names its way out and retries a transient step E (#229, #230)
- `orca recovery retry --run <id>` already recovers a non-terminal block at E without dispatching again. Make it findable:
  `task retry` refusing `blocked-at:<step>` for a step other than C, and `group brief`'s next step for such a run, name
  `orca recovery retry --run <id>`.
- `artifact-id-conflict` detail carries the artifact id and which check raised it (`archive.ts` has seven sites); the
  driver's catch that blocks a run writes the detail to its log line.
- A run blocked at E by an error the driver classes transient (`artifact-id-conflict`, I/O) is retried by the driver a
  bounded number of times (3) before it stays blocked. Step E is idempotent (content-addressed archive, checkpoint id).
- Criteria: refusal text names the command; injected one-shot conflict at E retries and lands the checkpoint; a persistent
  conflict stays blocked with the id in `blockedReason`.

## T2 — no automatic retry on a remainder smaller than one attempt (#234, #202)
- `autoRetryFundingRefusal` (`retryTask.ts`) also refuses when the fresh grant the next claim would fund is below the
  failed lineage's observed tokens per attempt (or attempts remaining fall below one full attempt's need). The ladder then
  records a skip and the task waits for a person.
- `task retry --work` output states the fresh grant the next run will receive (authored + top-ups − lineage usage) and warns
  when it is below the last attempt's observed cost.
- Criteria: the #234 fixture (4M authored, 3.2M used over 2 attempts) is not auto-retried; a lineage with ample remainder
  still is.

## T3 — the CLI answers a round the way the Web does (#231, #240, #203, #224)
- `requirement answer` (CLI): questions not named default to `recommended`, glossary/ADR ids not named default to accept,
  as `RoundForm.send` does. Server refusals for a mismatched round become structured: missing/extra ids per kind.
- `requirement consensus` (CLI) on an `awaiting-answers` round refuses unless `--unanswered` is given, naming the open
  question count (mirrors the Web confirmation). Server rule (spec §11.1) unchanged.
- #203: with a null profile window, confirm falls back to the frozen worker selection's numeric `contextWindow`; refusals
  distinguish `worker-window-unknown` from `threshold-above-window:<n>`.
- #224: estimate/confirm print a warning when the profile's `instructionVersion` is older than the newest known.

## T4 — the split cannot hand a task a check it may not fix; acceptance text reaches the task (#239, #204)
- `validateSplitDraft` and `validateMultiSplitDraft`: a test file named in a task's check (any committed file matching
  `testFile()` among the check's tokens) outside that task's `targetPaths` is handed back as
  `check-write-scope:<taskId>:<path>` with an `explainSplitReason` meaning. Unresolvable repo-wide checks are not refused.
- Expansion appends the full text of each acceptance criterion a task `traces` to its contract's success condition (code,
  not instruction). New splits only; frozen contracts unaffected.
- Criteria: the tester's T2 draft is refused naming both paths; widened `targetPaths` passes; a traced AC's literal enum
  appears in the expanded contract.

## T5 — a frozen codex selector the catalog no longer lists is caught before a round runs (#236)
- `requirement open` and each new requirement round check the frozen codex selector against the current catalog and refuse
  with `agent-selection-invalid` listing current candidates.
- A requirement whose round is blocked on `accept-refused:*single-call-unsupported` can re-select its agent slot (new
  freeze, new config hash) and restart that round, keeping finished rounds.

## T6 — a clean merge onto an untested tip re-runs the task's checks (#241, R2)
- In landing, when the task's attempt base differs from the group tip it merges onto, run the task's required checks on the
  merged tree in a scratch worktree before moving `orca/<group>`. Red ⇒ the run blocks with
  `post-merge-check-failed:<command>` and the ref does not move.
- Criteria: two parallel tasks each green alone, red together ⇒ second landing blocked, ref unchanged; a fast-forward
  landing runs no extra check.

## T7 — Web: execution bar, graph routing, Live tab (#228, #232, #226 (i))
- #228: counts as one row of chips, zeros hidden; actions stay a visible toolbar; recent commands move to Technical.
- #232: edges spanning layers route through lanes below each intermediate layer's nodes; a criterion samples every edge
  path on the T1..T6 fixture and finds no point inside a non-endpoint node.
- #226 (i): `live` region after `progress`: running work items, each with `RunTranscript` (active only while shown), phase,
  attempt, tokens, elapsed; latest run when nothing runs. Notes are not part of this task.

## T8 — unmount non-current sections (#219, R1)
- `SectionPane` renders children only when active; inactive Settings categories likewise. The clarification answer form
  and the Task control import form keep their drafts in App's existing draft stores. App-level criteria that relied on
  hidden panes navigate first (`Ruling: R1`). Spec correction appended to the panel redesign spec.

## T9 — repin selects the ccloop-dependent tests (R6)
- `scripts/test-affected.mjs`: when `package.json` differs only in `dependencies.ccloop` and `package-lock.json` only in
  `""`/`node_modules/ccloop*` entries, those two files select the tests that reach ccloop (named by a code rule, printed with
  their reason) instead of the whole suite. Any other lock change still selects everything.
- Spec correction appended to `2026-10-20-test-scope-and-release-gate-design.md`; handoff repin procedure drops the ccloop
  full run.

## Out of this round
#225 live threshold in ccloop (R4, next cross-repo batch), #227/#208 (R5), #237 (needs the tester's catalog entry and
`model_reasoning_effort`), #226 (ii) notes.
