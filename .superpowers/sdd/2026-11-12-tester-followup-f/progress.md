# Tester follow-up F — ledger

Owner: Orca session `5abcad7d` (2026-11-12), controller. Base: main at
`docs(handoff): Orca is repinned to ccloop's #249; what is left to push` (remote main equal, `ls-remote` 2026-11-12).
Design: `docs/superpowers/specs/2026-11-12-tester-followup-f-design.md`.

## Human words (verbatim)

- Session opening: 「上一轮session你可能处理了部分问题，你分析完后先停下来，我们一起看下这个session处理哪些问题。」
  「这个session暂时忽略context大小。我们尽量多处理一些问题。如果需要做brainstorm或写spec，可以先提出来。」
- On the E-round items the controller decided under 「先按你的建议执行」 (#251 no second confirm; #241 acceptance
  treated as passed with ≤1 landed task / multi-repo / folder groups; W5 fresh attempts capped by the group's own
  remainder and agent recovery-retry; #257 `/api/todo` field and lilac `#5a4ee0`; D21 form visible to members;
  rewritten criteria incl. `driverHarness`): 「同意」.
- Push of the two handoff commits: 「已push」. #243: 「这个本轮不做，留到下一轮做。」 Browser review of the E-round UI:
  「先默认通过，之后有问题我会再找你」. Cleanup: 「给我命令」 → the human ran both scripts.
- After the controller's triage (three read-only passes, summarised in the session):
  1. Scope: 「需要你多做一些task，暂时不关心context大小，尽量用subagent做就好。但是这次我们不做需要brainstorm的部分。」
  2. On #195 (confirm requires a context threshold nothing enforces) and #116 (a finite group can only charge the whole
     remainder for unknown usage), both against earlier rulings: 「要改」.
  3. On #81 (low-frequency features on main paths): 「要收起来」.

## Controller decisions (reversible; to be reviewed by the human at round end)

- C1. "Not brainstorm" scope = W1–W6 in the design. Deferred as needing design: a requirement-criteria review run
  (P0-1), an exit for `empty-result` beyond explanation text, a plan-phase budget (#196/#224), early claim after
  landing (#192), a generic "allow this decision" (#189), calibrating the 200k judge grant (#174).
- C2. Criteria authority this round: the human's 「要改」 on #195/#116 and 「要收起来」 on #81 authorise rewriting the
  existing criteria that pin exactly the behaviour being changed. Byte/shape pins that must admit a newly added field
  may be extended (only-add). Any other existing-criterion rewrite: the seat stops and reports; it is not authorised.
  ccloop criteria: none may be rewritten (ccloop Rule 15 needs per-criterion naming by the human).
- C3. #116 is an explicit acknowledgement (`charge-observed-floor`), not automatic as in soft groups: a finite group's
  limit is the operator's statement, so under-charging it needs someone to say so. Open to socket agents like
  `charge-remaining-grant`.

## Seats

(Filled as seats report: branch, commits by subject, criteria added/rewritten, mutations, gate log path.)

## Human words, later in the session (verbatim, 2026-11-12)

「这个session中，尽量将这些要做的task都完整做完，这个session暂时不要考虑context大小。
这次批准改写所有必要的判据。这一轮允许必要的付费真跑。这一轮session如果需要repin ccloop，这个session临时允许你push ccloop到origin main。这一轮session，Orca仓库repin完成后临时允许你push Orca 到origin main。
这一轮如果遇到卡住必须等人的事情，请继续做不必等人的部分。必须等人的事情你可以在session最后总结的时候告诉我并记录到 handoff.md 中。等下一个session再接着继续做。我现在要去休息了。
这一轮执行过程中如果有问题，先按你的建议执行。执行完在最后阶段报给我审核。」

Effect on C2: Orca seats may rewrite any necessary existing criterion (each rewrite in its own commit, comment
`Ruling (2026-11-12, tester follow-up F)`). ccloop: Rule 15 there still needs per-criterion naming by the human; a
relayed blanket approval is not that, so ccloop seats add criteria only. Push: the Tier 0 gate blocks agent pushes
regardless of chat authorisation (rounds C–E); expect to hand pushes back.

## Seats as landed (controller, 2026-11-12; all `--ff-only` into main after rebase; subjects via `git log --grep`)

Logs, mutation tables and clones: `/private/tmp/orca-f1112/<seat>/` (deletable).

- W1 #195 (`fix(control): confirm accepts no context hand-off threshold; auto-confirm keeps it null (#195)` and 5 more):
  null threshold accepted at confirm (Web, socket/CLI), auto-confirm and flow children keep null, CLI/Web say context
  hand-off is not active; Web field blank with "not set". Spec corrections appended to
  `2026-09-19-web-recoverable-control-design.md` and `2026-10-24-tester-round2-design.md` (§26). Rewritten:
  `agentWalk`, `budgetI18n`, two `tokenInput` pins. Mutations 15, all red. Nothing downstream needed non-null.
- W2 #116 (`feat(control): settle a finite run's unknown usage at ccloop's observed floor, explicitly (#116)` and 4
  more): `--acknowledge charge-observed-floor` on `task settle-usage` and `recovery retry` (single calls), marker
  `method:"observed-floor"`, approximate; Web button; flow calls refused `flow-call`. Soft-path arithmetic extracted
  (`bookObservedFloor`, `bookCallFloor`). Rewritten: one `writesMore` title. Mutations 24, all red. Gap: ccloop's
  saved-result recovery does not accept an `observed-floor` marker (same as known-zero / agent principals today).
  Controller fixed a web typecheck error in its test fixture after rebase.
- W3 #81 / D21 (`feat(web): fold low-frequency controls off the main paths; hide project changes from a member (#81, D21)`
  and 5 more): Overview Import plan → More; group header Save-to-library / Schedule → "⋯"; requirement form Options
  disclosure; Save split → "⋯"; Board has no primary; member hides project controls; no-agent notice; server
  `PATCH /api/projects/:id` now owner-only too; `web/DESIGN.md` note appended. Mutations 19, all red.
- W4 (`fix(cli): run results names the task's explanation and outputs apart from recoverability; --json adds
  recoverability (#183)` and 6 more): #183, #173 (`--json` `warnings`, Web note), #162 (attempts ≥2 on apply),
  empty-result explanation (CLI, Web, skill). Mutations 20, all red. Finding: an empty-result task has NO in-group exit
  (`retry-task` refuses `task-not-retryable:run-state:settled`; `set-task-loop` refuses a started task); the text says
  so and names a new group as the way forward. Controller follow-up fixed `RunReason` printing the literal code
  (scanPanelText backstop).
- W5 #241/#245 (`test(control,web): criteria for the group acceptance's guards, tip moves and its Problems placement
  (#241)`, `fix(control): each group acceptance check gets its own scratch worktree (#241)` and 3 more): 12 new
  criteria; `no-required-checks` / `no-task` proved unreachable (not faked); fixed a real race (an aborted check's late
  cleanup could delete the next check's worktree; shared path) with per-check paths + leftover sweep. Mutations 13, all
  red. Controller follow-up: `executionDriverE2E` E1 now waits for the acceptance record before reading the workspace
  scene (it was red at this round's base too).
- W6 #252: Orca side landed (`feat(transcript): accept a call's startedAt, order an attempt by it, show it per call
  (#252)`), inert until ccloop emits `startedAt`. ccloop side STOPPED: the patch
  (`/private/tmp/orca-f1112/w6/ccloop-startedAt.patch`, uncommitted in ccloop worktree
  `.claude/worktrees/f-transcript-started`, branch `f/transcript-started-at`) turns 4 existing criteria in
  `tests/control/collectTranscripts.test.ts` red (they `toEqual` exact entries); ccloop Rule 15 needs the human to name
  them. Hence no ccloop push and no repin this round.
