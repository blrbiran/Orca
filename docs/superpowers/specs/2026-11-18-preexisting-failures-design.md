# Pre-existing failures: a requirement that says "only add" meets a check that is already red (#341, #322 residue)

Orca session `4389b15f`, 2026-11-18. Tester issues #341 and the residue of #322 in
`orca_archived_files/issue-20261023.md`. Status: design approved in direction by the human; not built.

## Human rulings this design rests on

- The controller first proposed running the group's required checks on the base before every start. Human, verbatim:
  「不希望每次跑之前都跑一次组的必需检查，既浪费时间，又浪费token，你要再好好考虑一下怎么做」.
- The controller's second proposal (four layers below: free in the normal case, paying only after something already
  failed) was answered 「同意」 (2026-11-18).

## The problem

`audit-dogfood-20261117-1`: the requirement said "do not change or remove any existing document contract … only add" and
"`npm test` must pass at the end"; at the base, `test/readme.test.js` already failed (README showed a version-1 example,
the CLI exports version 3). Every path breaks one criterion. The agent of the first task that ran the suite silently chose
to edit README; seven tasks and 19.54M tokens later the review reported `checkConflict` and the group stopped
`not-passed`. Nothing in clarify, split or the runs said earlier "this check was red before anyone changed anything".

Two facts shape the fix:

1. Whether two sentences of a requirement contradict each other is a judgment (Rule 5): code cannot read "only add".
2. Whether a check is red at the base is a fact code can learn -- but learning it by running the suite costs minutes and,
   for an agent-run check, tokens. The agents already run the suite near the start of their work; Orca already runs a
   check on the base when the group's tip is red (`src/control/groupAcceptance.ts`, `baselineRed`).

## Design: four layers, cheapest first

### L1. Clarify asks, only when both sentences are present (no extra call)

The clarify instruction (`src/control/requirementClarify.ts`, the "Which questions are the person's" section) gains one
rule: when the requirement both forbids changing existing behaviour, contracts or documents and requires a whole check
(a test suite, a lint, a build) to pass, ask on the frontier how a failure that already exists in the repository should
be handled -- fix it (an allowed change), or judge the check relative to the base. It is asked at most once per
requirement and never when either sentence is absent. The instruction version rises (prompt head constant, and every
fake that matches on the head is updated; see the #328 lesson in the handoff).

Cost: some instruction bytes in a call that runs anyway.

### L2. The agent reports a pre-existing failure; the group shows it at once (no extra call)

Every loop contract Orca writes gains one constraint line (it goes with the plan version that is current when this is
built; old contracts keep their bytes):

`If a required check already fails before you change anything, report it as a major decision whose question starts with "Pre-existing failure:" followed by the command, and say in "chose" what you did about it.`

ccloop carries `decisions` opaquely and Orca already reads them (`src/control/reportedDecisions.ts`); the marker is a
string Orca defines and the agent is told verbatim, not a reading of free text. When a run lands (or ends) with such a
decision, Orca records an activity `preexisting-failure {taskId, runId, command, chose}` and shows a problem row on the
group: "Task T found `<command>` already failing before its change; it chose: <chose>". The row offers three exits,
each a recorded answer the review reads in "What Orca recorded beyond the diff":

1. **Allow the fix** -- the change the agent made to repair the failure is allowed (the review is told so).
2. **Judge it relative to the base** -- the check is accepted relative to the base (the review is told so; group
   acceptance already reports `passed-relative` for a suite red at the base).
3. **Edit the requirement** -- the existing requirement edit flow.

The group keeps running: most of its work is valid either way, and a person who is away should not stop it. What
changes is that the conflict is visible after the first task, not after the review.

### L3. A task's check failed: learn whether it was red at the base, once (pays only after a failure)

When a task run ends `required-check-failed`, Orca runs that one failing command once at the group's base commit,
with the same runner and the same base the group acceptance uses (`runAcceptance` with a base tip), in its own
temporary checkout, and caches the answer by (repository, base commit, command). If the command is red at the base:

- the run's prior failure handed to the next attempt (`src/control/priorFailures.ts`) carries one evidence line:
  `This check already failed at the group's base, before any change: <tail>`;
- the same problem row as L2 is shown (source: `base-check`).

No retry rule changes. A green answer at the base is cached too and adds nothing.

### L4. Use what Orca already knows about the base (free)

When a group is confirmed, if an earlier group's acceptance on the same repository recorded the full suite (or a
required check) at exactly this group's base commit, its result is shown on the confirm screen and in `group brief`:
"At this group's base, `<command>` was red (group G's acceptance, <date>)". Nothing is run.

## Non-goals

- Running any check before a start (ruled out by the human).
- Code deciding that two sentences of a requirement contradict each other.
- Changing the review's verdict rules or `checkConflict` (it stays the last net).
- #108 (structured acceptance fields carried into task contracts) is a separate design: it changes the clarify →
  split hand-over for every requirement, not only this conflict.

## Acceptance (each a command that exits 0 / non-0)

1. The clarify instruction contains the L1 rule; a clarify fake that answers with the question produces it as a frontier
   question (unit on the prompt + `tests/control/requirementClarify*.test.ts`).
2. A run whose result carries a major decision with question `Pre-existing failure: npm test` records
   `preexisting-failure` and the group view shows the row with its three exits; a decision without the marker records
   nothing.
3. Each exit's answer appears in the review prompt's Orca facts.
4. A task run ending `required-check-failed` on a command red at the base: one base run, cached (a second failure of the
   same command at the same base runs nothing), and the next attempt's prior failure carries the evidence line; green at
   the base adds nothing.
5. A group whose base equals an earlier group's accepted tip with a red full suite shows the L4 line; no command runs.
6. Old contracts' bytes are unchanged; new contracts carry the L2 constraint line.

## Left to the builder

Exact activity body fields, en/zh strings, where the cache lives (a control-store table or a canonical record keyed by
the triple), and which plan version carries the L2 line (with #346 landing v4 first, the line rides v4 if #346 is not
yet released, otherwise v5).
