# Feedback that breaks an explicit requirement is reported by the split, shown, and confirmed on purpose (#351 addendum)

**Written by:** a subagent (Claude Opus 5.5) of Orca session 2026-11-18 (second of the day), against `main` at `dec64fac`
(`/usr/bin/git -C /Users/biran/code/skills/orca/Orca rev-parse --short main`). **Status:** accepted by the controller (rulings at the end); being built on `feat/split-feedback-conflicts-351`.
**Sources:** `orca_archived_files/issue-20261023.md` lines 1987-2001 (the "并发现象" paragraph);
`.superpowers/sdd/2026-11-18-tester-triage/report.md` section "#351 addendum".

## The problem

The tester's `requirement feedback` moved `sla-breach` to `dependsOn: ['sla-clock']`. The requirement explicitly asked for
two concurrent tasks in Layer 2. The splitter did what it was told: `REVISION_RULE` (`src/control/requirementSplit.ts:40`)
says "change only what its feedback or reasons name and keep every other task as it is". The draft passed validation (code
checks shapes, not whether the draft still matches the requirement), was accepted and confirmed. Seven tasks, 42 minutes and
10.5M tokens later the requirement review judged AC4 `not-met`, `fixableBy: plan`. Nothing earlier said "this feedback
conflicts with AC4". The splitter had the requirement document and the feedback side by side and was the only party that
could have said so.

## Decisions

**D1. The model judges the conflict; code never does.** The split answer gains an optional structured field,
`requirementConflicts`, which the splitter fills when its draft cannot meet a criterion or structure the requirement states
explicitly: because of the feedback, or for any other reason. The prompt tells it to keep following the feedback and report
the conflict. *Why:* whether two sentences contradict each other is a judgment (Rule 5). The splitter already reads both, so
reporting costs output tokens in a call that runs anyway. *Cost if wrong:* the model misses a conflict (we are where we are
today, and the review still catches it), or it reports one that is not real (one extra click on a warning).
*Named `requirementConflicts`, not `conflicts`:* the draft view already has `implicitEdges[].conflicts` (write-set overlap,
`requirementSchemas.ts` `implicitEdgeSchema`). Two different things shown under the same name would mislead the reader.

**D2. Code only shows the conflicts; confirming needs a deliberate second step, and Orca never refuses the draft.** The
draft view (Web and `requirement show`) lists the conflicts as a warning. Accepting a draft that has conflicts takes the
Issue 88 shape: on the Web, a dialog with "Accept anyway" (`RequirementsPanel.tsx` already does this for consensus on an
unanswered round). On the CLI, `requirement accept` refuses locally unless `--despite-conflicts` is passed, the way
`requirement consensus` refuses without `--unanswered` (`work.ts:97` `unansweredRefusal`). The server and the accept payload
do not change. *Why:* the person may agree with their own feedback. The requirement may have been wrong, and the fix then is
to revise it. The person decides; code only makes sure the decision is a conscious one. *Cost if wrong:* a caller that posts
to `/api/control/groups/:g/requirement/accept` directly skips the step (see Open risks). MCP runs the same registry
(`src/entry/mcp.ts`), so it does get the refusal.

**D3. This is split instruction version 7, single-repository only.** Adding a key the model may write is a contract change.
It changes the answer template, the JSON schema sent as `responseSchema`, and `splitOutputSchema`, the same way #328 added
`historyExpectation` in V6. *Why a version:* the head line is how fakes and envelopes tell instructions apart, and every
earlier contract change got one. *Cost if wrong:* about 12 files of churn (listed below) for no behaviour change.
Multi-directory stays at its V5 (see Open questions).

**D4. Old drafts and drafts with no conflicts look exactly as they do today.** The key is optional and never defaulted.
An empty list or `null` (codex's strict projection makes optional keys required) is removed before the schema reads the
answer, as `withoutEmptySetup` already does for `setup`. So a draft with no conflicts stores no key. Its view, its
`requirement show` output and its single-repository `draftHash` (the hash of the expanded plan,
`requirementCalls.ts:491`) are byte-equal to today's. *Cost if wrong:* nothing visible. A defaulted `[]` would change
every stored view.

**D5. Caps: at most 8 entries, and each string 1-1024 UTF-8 bytes.** Eight matches `SETUP_BOUNDS.commands`, the
neighbouring count cap in the split schema. 1024 bytes sits between `CALL_DETAIL_MAX_BYTES` (512) and
`SETUP_BOUNDS.bytes` (4096), and leaves room for about 340 Chinese characters. Going over a cap is a `schema:` hand-back,
like an oversized `setup`. *Cost if wrong:* one auto-retry call. The prompt states the caps, so this should be rare.

**D6. Draft edits keep the conflicts.** `apply-parallel`, `add-implied-path` and `narrow-path` copy `output`
(`requirementDraftEdit.ts:49` `structuredClone`), so the conflicts carry over to the edited draft. *Why:* code cannot tell
whether an edit resolved a conflict (Rule 5). A stale warning costs one click; a dropped one costs the run we are fixing.

## Contract

`src/control/requirementSchemas.ts`, added to `splitOutputSchema` (single only):

```ts
export const REQUIREMENT_CONFLICT_BOUNDS = { entries: 8, bytes: 1024 } as const;
const conflictText = z.string().refine((s) => s.length > 0 && Buffer.byteLength(s, "utf8") <= REQUIREMENT_CONFLICT_BOUNDS.bytes,
  { message: `1-${REQUIREMENT_CONFLICT_BOUNDS.bytes} utf8 bytes` });
export const requirementConflictSchema = z.object({ criterion: conflictText, feedback: conflictText.optional(), why: conflictText }).strict();
// splitOutputSchema gains:  requirementConflicts: z.array(requirementConflictSchema).min(1).max(REQUIREMENT_CONFLICT_BOUNDS.entries).optional()
```

`src/control/requirementSplit.ts`: `SPLIT_JSON_SCHEMA_V7` = V6 plus
`requirementConflicts: { type: "array", items: { type: "object", additionalProperties: false, required: ["criterion", "why"], properties: { criterion: str, feedback: str, why: str } } }`.
The fold that drops an empty `setup` also drops a `requirementConflicts` that is `[]` or `null`, and a `feedback` that is
`null`.

`SPLIT_INSTRUCTION_V7` is built from `SPLIT_INSTRUCTION_V6` with `.replace`, as V6 was built from V5. No shared constant
changes, so the V5 and V6 bytes stay as they are. It makes three replacements:

1. Head: `Orca requirement split, instruction version 7.` (`SPLIT_PROMPT_HEAD_V7`).
2. After the `REVISION_RULE` line, insert this line verbatim (`REQUIREMENT_CONFLICTS_RULE`):

> - Feedback does not change the agreed requirement. When `earlier-draft` carries the person's feedback, follow it; if following it means your draft no longer meets an acceptance criterion or a structure the requirement document states explicitly (such as tasks it says run concurrently, an order between tasks, a path or a module layout), still follow the feedback and report each such conflict in `requirementConflicts`: `criterion` is the acceptance criterion's id (such as AC4), or a short quote of the requirement's sentence when no criterion states it; `feedback` quotes the feedback words that caused it; `why` says what in this draft does not meet it. Report there too, without `feedback`, any other place where your draft does not meet something the requirement document states explicitly. Report only a stated criterion or structure the draft does not meet, never a preference, a risk or a guess; at most 8 entries, each string at most 1024 bytes. When there is none, omit the key.

3. Before the `"notes"` line of the answer template, insert verbatim:

> `  "requirementConflicts": optional [ { "criterion": an acceptance criterion's id or a short quote, "feedback": optional, the feedback words that caused it, "why": what in this draft does not meet it } ],`

`buildSplitPrompt`'s `instructionVersion` becomes `5 | 6 | 7`, with 7 as the default. `SPLIT_HANDLER.prepare`
(`requirementCalls.ts:519`) sends `SPLIT_JSON_SCHEMA_V7` for single-repository groups.

## Where it shows

- **View:** nothing new on the server. The field rides in `draft.output`, and `webProtocol.ts:1865` already serves
  `draftBodySchema`'s output. `web/src/controlTypes.ts` `DraftViewV1.output` gains `requirementConflicts?`.
- **Web** (`RequirementsPanel.tsx`, by the other draft notes): `<div role="alert" data-requirement-conflicts>`, a title,
  then one item per conflict. Clicking `acceptSplit` on such a draft opens the Issue 88 dialog, which lists the
  conflicts and offers `acceptAnyway` and `consensusCancel`; with no conflicts, one click accepts, as today. New keys:
  - `requirementConflictsTitle` — en: "This draft does not meet the requirement as written ({{count}})" / zh: "这份草稿与需求原文不一致（{{count}} 处）"
  - `requirementConflict` — en: "{{criterion}}: {{why}}" / zh: "{{criterion}}：{{why}}"
  - `requirementConflictFeedback` — en: "Caused by your feedback: “{{feedback}}”" / zh: "由你的反馈引起：“{{feedback}}”"
  - `requirementConflictsHelp` — en: "The split followed your feedback and reports this itself; Orca does not check it. Accept anyway if the feedback is what you want, send feedback to restore the requirement, or revise the requirement." / zh: "拆分照你的反馈做了，这是它自己报告的；Orca 不做校验。如果反馈就是你要的，可以仍然接受；否则发反馈恢复需求，或修订需求。"
  - `acceptAnyway` — en: "Accept anyway" / zh: "仍然接受"
- **CLI `requirement show`** (`reads.ts` `requirementShow`): one line per conflict, after the existing hint lines:
  `draft <n> requirement-conflict: <criterion> -- <why>[ (feedback: "<feedback>")]`.
- **CLI `requirement accept`** (`work.ts:367`): new flag
  `{ name: "despite-conflicts", type: "boolean", summary: "accept a draft whose split reports it does not meet the requirement as written" }`.
  Without it, a latest draft with `requirementConflicts` throws
  `EntryRejection("requirement-draft-conflicts", "draft <n> reports <k> conflict(s) with the requirement as written (orca requirement show <group>); send feedback, or pass --despite-conflicts to accept it as it stands")`.
  The payload is `{draftNo, draftHash}` either way. Update `docs/cli.md:95` and
  `skills/orca-control/references/requirement.md` (`requirement accept`).

## Versioning and compatibility

- **In-flight calls keep V6.** A call that has passed A2 carries its prompt and `responseSchema` frozen in its envelope
  (`stepA2SingleCall`, `prepareRequirementCall`). Its answer has no new key and `splitOutputSchema` accepts it unchanged.
  A V7 answer whose `requirementConflicts` is dropped by an older schema cannot happen: the schema is the same module.
- **Stored drafts:** no migration. The key is absent, `draftBodySchema` parses it as today, and nothing is shown.
- **Multi-directory drafts:** untouched (`multiSplitOutputSchema` stays strict, and the multi instruction stays at V5).

Every place the V7 bump touches (12 files):

| File | Change |
|---|---|
| `src/control/requirementSplit.ts` | `SPLIT_PROMPT_HEAD_V7`, `REQUIREMENT_CONFLICTS_RULE`, `SPLIT_INSTRUCTION_V7`, `SPLIT_JSON_SCHEMA_V7`, `buildSplitPrompt` 5\|6\|7 (default 7), the fold; version comment at :84-93 |
| `src/control/requirementSchemas.ts` | bounds, `requirementConflictSchema`, `splitOutputSchema` key |
| `src/control/requirementCalls.ts` | :23 import and :519 send `SPLIT_JSON_SCHEMA_V7` |
| `tests/control/fixtures/requirementHarness.ts` | `HEADS.split` gains the v7 head (keep v5, v6 and multi v5), with a ruling comment |
| `tests/commands/agentWalk.test.ts`, `tests/control/requirementE2E.test.ts`, `tests/control/dirRequirementE2E.test.ts`, `tests/control/dirRequirementOutOfRepo.test.ts` | fake heads (real ccloop): import `SPLIT_PROMPT_HEAD_V7 as SPLIT_PROMPT_HEAD`, update the comment |
| `tests/control/multiDirOverview.test.ts` | :256 `SPLIT_JSON_SCHEMA_V7`, :260 head v7; `PINNED.splitPrompt` (V5) unchanged; **add** `PINNED.splitInstructionV6` = sha of `SPLIT_INSTRUCTION_V6` as on `main` before this change |
| `tests/control/driverRequirementSplit.test.ts` | :23 `SPLIT_JSON_SCHEMA_V7` |
| `tests/control/splitParallelCandidates.test.ts` | :95-103 "version 7" |
| `tests/control/historyContract.test.ts` | :61 head of the default prompt becomes 7; V6 still has `historyExpectation` |

Each rewritten criterion needs the human's ruling recorded in its comment ("这次批准改写所有必要的判据" or equivalent).
Without one, this is `awaitingHuman`.

## Tests (each with the mutation that must turn it red)

1. `tests/control/splitRequirementConflicts.test.ts` (schema): a split with 1 and with 8 conflicts parses; 9 entries, an
   empty `why` and a 1025-byte `why` are refused; a split without the key parses to an object without the key.
   *Mutations:* drop `.max(8)` → red. Drop the byte refine → red. Add `.default([])` → red (the key appears).
2. Same file (fold): `requirementConflicts: []`, `requirementConflicts: null` and `feedback: null` are removed before
   parsing. *Mutation:* remove the fold → `[]` fails `.min(1)` and the draft goes `invalid` (red).
3. Same file (prompt): the default `buildSplitPrompt` head is v7 and contains `REQUIREMENT_CONFLICTS_RULE` and the template
   line verbatim. `instructionVersion: 6` contains neither, and its instruction's sha equals `PINNED.splitInstructionV6`.
   *Mutations:* add the sentence to the shared `REVISION_RULE` instead → V6 pin red. Drop the replace → red.
4. Harness (`requirementHarness`): draft 1, then feedback, then a queued v7 answer with one conflict is stored in
   `draft.output.requirementConflicts`. Its `draftHash` equals the hash of the same answer without the key, and the earlier
   draft's view JSON is byte-equal before and after. *Mutations:* `prepare` still sends `SPLIT_JSON_SCHEMA_V6` → the
   envelope assertion goes red. Hash the output → red.
5. `tests/commands/` `requirement show`: one `requirement-conflict:` line per entry, with `(feedback: ...)` only when the
   entry has one; none for a draft without the key. *Mutation:* drop the line builder → red.
6. `tests/commands/` `requirement accept`: with conflicts and no flag → `requirement-draft-conflicts`, no command sent. With
   `--despite-conflicts` → the payload is exactly `{draftNo, draftHash}`. A draft without conflicts is accepted with no
   flag. *Mutations:* invert the flag test → red. Always refuse → the third case goes red.
7. `web/tests/requirementConflicts.test.tsx`: the alert lists each conflict (and the feedback quote when present). The
   first click on "Accept this split" opens the dialog and sends nothing. "Accept anyway" sends `requirement-draft-accept`.
   With no conflicts, one click sends. Both locales have the five keys (the existing i18n tests cover parity).
   *Mutation:* send on the first click → red.

Nothing here measures whether the model reports conflicts. That is a judgment test (Rule 5). Replay the tester's case once
by hand (V7, feedback that serialises the Layer 2 pair) and record the answer with its run id. It is evidence, not a gate.

## Non-goals

- No code-side check of free text: code does not parse "concurrent", count layers against the statement, or match
  criteria to `dependsOn` edges.
- No automatic re-split, and no refusal of a draft or an acceptance by the server.
- No change to the requirement review. It stays the backstop and still judges AC4.
- No change to `REVISION_RULE` in V5 or V6, and none to the multi-directory instruction.
- The long-term home is **#108 (structured acceptance)**: once a criterion such as "these two tasks run concurrently" is
  structured, code can check it against the graph without judgment. This field is the stop-gap until then and should be
  re-read when #108 lands.

## Open risks and questions

- **Recall is the model's.** A splitter that does not see the conflict reports nothing, and today's failure repeats
  unchanged. A splitter that over-reports trains people to click "Accept anyway". The replay above is the only evidence we
  will have at first.
- **Client-side gate.** A direct HTTP POST to the accept route skips the step. If that matters, add
  `acceptConflicts: true` to `requirementDraftAcceptPayloadSchema` and check it server-side. That is a protocol change,
  deliberately not made here.
- **Open question (not settled from the code): multi-directory groups.** The same feedback hole exists there:
  `REVISION_RULE` is in `SPLIT_INSTRUCTION_MULTI_V5`. But the multi instruction has never had a V6. `buildSplitPrompt`
  ignores `instructionVersion` when `multi` is set, and several tests pin multi v5 heads (`multiDirOverview.test.ts:174`,
  `splitCheckOwnership.test.ts:21`, `splitPromptV3.test.ts:23`). This spec follows #328 and stays single-only. The
  controller should decide whether multi gets its own v6 now or later.
- **Stale warning after an edit (D6)** is accepted on purpose and may surprise people. The dialog's help text tells them
  what to do.

## Controller rulings (Orca session 2026-11-18, second of the day)

The human delegated this round's reversible decisions to the controller ("先按你的建议执行", reviewed at session end).
- Single-repository split only (v7); the multi instruction stays at v5 — a registered gap, not a decision that multi
  never gets it. Why: multi's version plumbing differs (prompt builder ignores the version for multi) and three tests pin it.
- The confirm-anyway gate is client-side (Web dialog, CLI `--despite-conflicts`), like consensus `--unanswered`; a direct
  HTTP POST to the accept route is not gated. Why: the server never refuses on a model's judgment (Rule 5 spirit).
- Draft edits (`apply-parallel`, `add-implied-path`, `narrow-path`) carry the conflicts over unchanged.
