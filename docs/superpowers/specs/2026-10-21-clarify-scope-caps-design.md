# Clarification sized by the requirement: scope and clarity decide the caps

Orca implementer run under session `8b1469ea` (Claude Code), 2026-10-21. Observation anchor: Orca `main` at `016792ad`.
Source: tester feedback `orca_archived_files/issue-20261008.md` Issue 86 (one requirement ran 10 rounds, 49 questions,
50 glossary entries and 30 ADRs, about 2.9M tokens, with no way to stop but consensus).

## 1. Problem

Clarification has no stopping rule but the model's own `frontierEmpty`. Code caps questions at five per round
(`MAX_QUESTIONS`, enforced by `clarifyOutputSchema`), but rounds, glossary entries and ADRs are unbounded, and the
instruction does not tell the model which questions are the person's to answer and which are the executing agent's.

## 2. Ruling

The human approved this approach (controller brief, session `8b1469ea`): the model judges the requirement's scope and
clarity once, code maps that judgement to caps, clarification stops at the round cap by default, and the person may
change the judgement or grant one more round. The tester's patches are not taken verbatim.

## 3. Design

### 3.1 The judgement

Round 1's answer carries `classification`: `scope` (`small` | `medium` | `large`) and `clarity` (`clear` | `fair` |
`vague`), each with a one-sentence reason (`scopeReason`, `clarityReason`). Code requires it in round 1 (a round-1
answer without it is invalid: `classification-missing`, retried as any invalid answer) and drops it from later rounds.
It is stored as written in round 1's result (`result.classification`), the model's evidence, never rewritten.

The person may set their own class (`requirement-classify`, payload `{ scope, clarity }`). It is stored on the
requirement block as `classOverride` beside the model's judgement, which stays on round 1. The effective class is the
person's when set, else the model's.

### 3.2 Caps (code, not the model)

The class maps to a tier, and the tier to caps, in one table (`CLARIFY_CAPS`, `src/control/requirementSchemas.ts`):

| tier | when | rounds | questions / round | glossary / round | ADRs / round |
| --- | --- | --- | --- | --- | --- |
| small | scope small **and** clarity clear | 1 | 3 | 2 | 1 |
| medium | anything else | 2 | 5 | 4 | 2 |
| large | scope large **or** clarity vague | 3 | 5 | 5 | 3 |

Per-round caps are enforced as `MAX_QUESTIONS` is today: the instruction states them and code validates the answer
(`classifyClarifyOutput`); an answer over a cap is invalid (`cap:<field>:<n>>max`) and goes through the existing retry
path (at most `MAX_AUTO_RETRIES`, the reason fenced into the retry prompt). Nothing is silently truncated: a dropped
question would leave the model's statement and dependencies referring to something the person never saw.

Round 1's per-round caps come from the person's class if one is already set, else from the class in that same answer.

### 3.3 Stopping at the cap, and one more round

The round cap is `max(CLARIFY_CAPS[tier].rounds, roundsGranted)`. When the person answers a round whose number is at
the cap, no next round is drafted (as when `frontierEmpty`): the requirement waits for consensus, which needs no
change (`answered` is already a consensus state).

`requirement-clarify-more` (payload `{ roundNo }`, the latest round) grants exactly one more round: allowed only while
clarification has stopped (no consensus, the latest round `answered` and not closed by consensus); it sets
`roundsGranted = roundNo + 1`, writes round `roundNo + 1` and queues its call. After that round is answered the cap is
reached again. Raising the class above the latest round does not draft by itself; the person presses the same button.

Both new verbs are open to owners and members (`any`), as `requirement-answer` and `requirement-consensus` are.

### 3.4 Records that predate this

- A round-1 result without `classification`, and a requirement block without `classOverride` or `roundsGranted`,
  still parse (all three fields are optional).
- Such a requirement is **unclassified** and uses the **large** tier. Rejected alternative: default to medium/fair.
  Unclassified means nobody judged clarity, and "not judged" is closest to "vague"; the large tier is also the one
  closest to the old behaviour (five questions per round) and the least likely to cut short a requirement that really
  was large. Its glossary and ADR caps only apply to answers drafted from now on. A requirement already past round 3
  stops after its current round is answered; the person can grant more rounds one at a time, or set a class.
- The view says `unclassified` and the person can set a class.

### 3.5 Instruction version 2

`CLARIFY_INSTRUCTION_V2` replaces version 1 (the prompt head names the version). Changes: the frontier rule asks only
questions whose answer changes the plan materially; implementation details, edge cases, file locations, naming,
error handling, test layout and cleanup are the executing agent's to decide and report as decisions later. It explains
the classification and states the cap table (built from `CLARIFY_CAPS`, so the two cannot disagree; changing the table
changes the instruction and needs version 3). Each prompt carries a `Limits:` line with this round's caps.

### 3.6 View

The requirement view gains `clarify`: the model's classification (or null), the person's override (or null), the
tier, the round cap and per-round caps, and whether clarification has stopped at the cap. It also gains
`draftingSince` (epoch ms): the time of the command that started the current drafting step (the newest
`command` activity row of `requirement-open`, `requirement-answer`, `requirement-clarify-more`,
`requirement-consensus`, `requirement-draft-feedback` or `recovery-retry`), null when nothing is drafting or the row
was retired. No new column or record field is needed for it.

## 4. Criteria

- A per-class cap is enforced: an answer over its tier's questions, glossary or ADR cap is invalid; the same answer
  passes under a wider tier (`tests/control/requirementClarifyCaps.test.ts`).
- The class-to-tier mapping is pinned on the boundary cases (small+clear, small+fair, large+clear, medium+vague).
- Answering the cap round drafts no next round; `requirement-clarify-more` drafts exactly one more, and answering it
  stops again.
- A requirement block and a round written before this change still read, and use the large tier.
- Mutations seen red: the cap check removed; the class-to-cap mapping swapped; the continue grant dropped.
