# Recovery CLI and the tester's stuck states (tester #98–#104)

Controller: Claude Opus 5.5, session a9f9d6de, 2026-10-28. Branch `fix/p0-recovery` (cut from main after the
tester-round planning handoff). Human rulings (verbatim in `.superpowers/sdd/2026-10-28-tester-feedback-round/progress.md`):
reproduce the documented states with criteria first; expose only the existing, invariant-keeping recovery commands as
CLI; give #100's drafting + usage-unknown state an exit after settlement; no force-archive, no reset-dispatch, no raw
store edits.

## 1. What each report turned out to be

Every state below was rebuilt through the real code paths in `tests/control/testerStuckStates.test.ts` (never by
writing rows). The tester's own database is not on this machine; a copy of the operator's real control DB
(`~/.orca/control/panel/control.sqlite`, read-only `.backup`) had no stuck run, draft, stop or undelivered handoff row.

| # | Report | Finding |
|---|---|---|
| 98 | Retry on a stopped requirement does nothing; stale outbox rows | **Not a defect on main.** Retry lifts a completed handoff stop and drafts the next draft, which parks on `requirement-usage-unknown` because the closed call's usage is still unknown. The summary offers that call's charge (`blockedRun` + `blockedRunCharge`); the charge sends the draft and it is answered. Undelivered `handoff-request` / `group-handoff` rows the stop left do not hold anything. What looked like "Retry is ineffective" is the second step (charge) the panel asks for. |
| 99 | `auto-confirm-selections-unresolved` logged on every pass for a running group | **Not reproduced.** Condition 1 (`not-draft`) skips a running group, and the booked refusal stops a second pass (existing criterion C22 in `tests/control/autoConfirmUnlimited.test.ts`: the second pass refuses nothing and asks nothing). The hypothesis "the booked row rolls back with the throwing apply" is false. To go further we need the tester's `SELECT id,result FROM commands WHERE id LIKE 'orca-auto-confirm-unlimited-%'` for that group and the group's `status` at the time of the log lines. |
| 100 | Archive refused: draft stuck `drafting` + `waiting` | **Defect, fixed.** `refuseArchive` treated any pending round/draft as a call in flight. A pending call that would not be sent -- parked on `waiting` (unknown usage, the budget) or held by a stop -- now lets the archive through, and the archive interrupts it in the same transaction (state `interrupted`, `waiting` null), so spec §6.3's "no call is pending when it is archived" still holds. A call that would be sent still refuses (`archiveGroup.test.ts` "refuses while a requirement call is waiting"). Archiving books nothing: the group's unknown usage stays unknown. |
| 101 | OMP exit leaves a new requirement "stuck" | **Not a defect** -- the designed #62 path: the call is blocked on unknown usage and the panel offers "charge and retry". Now also reachable from the CLI (§2). |
| 102 | An active blocked run deadlocks dispatch → 423 everywhere | **Not a defect on main; the 423 was the tester's hand edit.** A blocked single call does not keep dispatch blocked: the panel's recovery hands single calls to the driver and recomputes `dispatchBlocked` (criterion: after `recoverControl(..., { driverOwnsWebRuns: true })` it is false and the summary still offers the charge). The tester's own final note names the cause: `requirement_drafts.state` and `body.state` disagreed after a manual `UPDATE`, which the read model refuses as `recovery-blocked:requirement-draft:<group>` (423 by design). |
| 103 | No CLI recovery interface | **Gap, closed for the existing commands** (§2). |
| 104 | Inactive + `blocked` + not closed: the panel shows no charge | **Not reachable by code.** Every writer of `runs.active=0` also moves the run to a terminal state (`stopIntent.ts saveRunBody(..., false)` after `settled-*`, `budget.ts`, `singleCallLedger.closeSingleCall`, `singleCallSettlement.ts`, `webDispatch.ts` `failed-before-provider`). The state is the tester's `UPDATE runs SET active=0` from #102. No code change. |

## 2. The recovery CLI: what exists and what changed

The commands already existed; what was missing was that the two usage settlements could not be sent from the CLI at
all. Both are token-tier on the socket (`humanOnly.ts`: `settle-unknown-usage`, `recovery-retry.acknowledge`), but the
service then required a Web owner (`client === "web"`), so `orca task settle-usage` always failed.

- **Authority** (changed): a settlement is booked to `settlingPersonFor(commandId)` (`src/control/commandClient.ts`):
  a Web account `user:<id>` as before, or on the socket the owner whose **person token** the request carries
  (`personAuthority`, i.e. `hasPersonAuthority`: an owner's token, never a run Orca dispatched). The routes put that
  account beside the command as `personPrincipal: "user:<id>"` (`routedCommandContext`, `src/panel/controlApi.ts`), so
  the settlement marker's `principal` stays a `user:` id (its schema requires one). Everyone else is refused as before
  (`owner-required` / `control-verb-human-only`).
- **CLI surface** (one flag added):
  - `orca recovery list` -- what blocks dispatch (existing).
  - `orca recovery retry --run <run> --acknowledge charge-remaining-grant` -- **new flag**: the panel's "charge and
    retry" for a clarify, split or estimate call blocked (or closed by a stop) on unknown usage. `--acknowledge` goes
    only with `--run` and only as `charge-remaining-grant`; both are refused before anything is sent.
  - `orca recovery retry --run <run>` / `--group <group>` -- existing.
  - `orca task settle-usage <group> <task> --acknowledge charge-remaining-grant|release-unmetered` -- existing row, now
    able to succeed with a person token.
  - `orca group archive <group>` -- existing; now also the exit for #100 (§1).
- **Not added** (human ruling): no force-archive, no reset-dispatch, no command that edits store rows. A state the
  read model refuses as `recovery-blocked` is corrupted data; it is reported, not papered over.

## 3. Criteria and mutations

`tests/control/testerStuckStates.test.ts` (7 criteria) and two cases in `tests/commands/writesMore.test.ts`. Mutations
M1–M9 (parked predicate always false; without its `waiting` branch; without its held branch; no interruption; the
socket branch of `settlingPersonFor` null; the socket branch ignoring person authority; the routes without
`personPrincipal`; the CLI dropping `acknowledge`; the CLI without its scope check) each turned its own criterion red in
a `git clone --local` copy and were restored to 0-byte `git diff` / `git diff --cached`
(log `/private/tmp/orca-a9f9d6de/p0-mutations.log`). In that clone one unrelated `writesMore.test.ts` case
("project set-workspace-mode reads the repository revision") is red at baseline and green in the worktree (clone
environment); it is not counted.

## 4. Correction after review (same session, a9f9d6de)

§2 "Authority" is narrowed. An independent review found that a task run's `settle-unknown-usage` marker is validated
against its command's ledger row (`hasValidUsageSettlement`, `src/control/usageSettlement.ts`: the row must be
`client === "web"` with the marker's principal), and a socket row records `agent:<client>`. A socket settlement would
have booked the charge and left a marker every reader refuses (`run-usage-settlement:<run>`, `retry-settlement`). So:

- `settle-unknown-usage` stays the Web owner's act (as before this round). `orca task settle-usage` remains a token-tier
  row the service refuses; making it work needs the command ledger to record the person token's account beside the
  socket principal (a schema change, not done this round — registered for the human).
- The single call's charge-and-retry keeps the person-token path: its marker (`singleCallSettlement`) is parsed by
  schema only and never checked against the ledger row. Criterion "a task run's settle-unknown-usage stays the Web
  owner's" and mutation M10 (the Web check removed → red) pin the narrowing.
- The two #100 criteria now assert `pendingRequirementCall(...) === null` after the archive (review: counting sends
  could not go red while the usage flag or the stop still held the call).

## 5. Follow-up (session 2026-10-29)

The human approved the schema change §4 registered (「同意」). `orca task settle-usage` now settles a task run's unknown
usage with an owner's person token: spec `2026-10-29-socket-usage-settlement-design.md` (schema 20 → 21,
`commands.person_principal`). §4's first bullet describes this spec's round and stays as written.
