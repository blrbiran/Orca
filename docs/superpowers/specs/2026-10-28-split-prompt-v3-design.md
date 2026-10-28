# Split instruction version 3, hand-back meanings, chain-numbered rounds, codex window copy

- **Author:** implementer of the split-v3 line, Orca tester feedback round (controller session `a9f9d6de`), 2026-10-28.
  Branch `feat/split-prompt-v3`, cut from main `2893841f`.
- **Inputs:** tester issues #107, #105 (`orca_archived_files/issue-20261023.md`); human rulings in
  `.superpowers/sdd/2026-10-28-tester-feedback-round/progress.md` (round numbering by chain position; split retry in
  revision mode with one instruction-version bump; calls already started keep their version).
- This note adds to, and does not edit, the N1 spec (§8.1 split instruction, §10 document) and the multi-directory
  projects spec §6.4.

## 1. Split instruction version 3 (#107)

Versions 1-2 stated neither the loop-plan rules nor the trace id format the validator enforces; a paid split spent two of
three drafts learning them from codes. Version 3 states exactly what code refuses:

- Path shapes (`pathShapeOk`, `overviewPathExists`): an exact relative path (no leading `/`, no `*`, no empty, `.` or `..`
  segment) naming an existing file or a new file in an existing directory; `<directory>/**` for a directory that exists
  in the overview's commit; or `**`.
- The plan a task runs: its `loopPlan`, else the label table `choosePlanByLabels` reads (generated from `LABEL_PRIORITY`).
- `investigate`: exactly one target path, an exact path (`expandRecipe` `investigate-target`).
- `design`: target paths do not include `**` (`design-target`); `<directory>/**` is allowed.
- Multi: these rules apply to the first `writes` entry, the one expansion reads (`loopOfMulti`).
- Traces: only the ids the requirement document gives acceptance criteria and accepted decisions (the validator's
  `criterionIds` and `adrIds`); question, glossary and round ids are not traceable.

**Calls already started keep their version:** the prompt is built once, at A2 (`stepA2SingleCall`), and frozen in the
run's dispatch envelope; a retried or resumed run sends the stored envelope. Version 3 reaches new calls only.

## 2. Hand-back reasons carry their meaning (#107)

Reasons stay codes (stored on the draft, shown, asserted). `explainSplitReason` gives the plain-language meaning for the
codes whose words are not already in the reason (`expand:*`, `path:`, `trace:`, `untraced:`, `dir:`, `checks-primary:`,
`ledger-path:`, three `import:` items); `plan:`, other `import:` items, `graph:` and `schema:` already carry their
checker's message. The prompt sends each reason as `<code> -- <meaning>`.

## 3. A model with no context window: two refusals (#105)

`estimatorCompatibility` names a null context window by what ccloop's resolution shows of the catalog. ccloop answers a
codex single call only for a catalog row it found (`singleCallExecution` "v1-soft", else null; ccloop
`src/agents/codex.ts`). So:

- null window **with** a single call ⇒ new reason `context-unreported`: the catalog lists the model but gives no window.
  The panel's words point to the installation field `declaredContextWindow` (ccloop spec
  `2026-10-21-declared-context-window-design.md`; Orca's pinned ccloop has it, commit `ed2e0d7`).
- null window **without** a single call ⇒ `context-unavailable`, words unchanged (not in the catalog, or not read).

Known limit: an omp row with no `maxTokens` has no single call, so its null window is still `context-unavailable`
although omp resolution only succeeds for a listed model. Out of #105's scope (codex); not changed.

## 4. Rounds numbered by chain position (human ruling 2026-10-28)

One numbering for a requirement's rounds: the position on the active chain (`activeChain`), as the panel and the
clarify prompt's limits line already used.

- Ids: `recordClarify` passes the drafting round's chain position to `classifyClarifyOutput`, so a round drafted after
  a revision gets `R<position>.Q/G/ADR<n>`. A revision row copies round k's result and takes k's position, so its ids
  agree too. Position 1 is always round 1 or a revision row (never classified), so the round-1-only rules (class,
  slug) are unchanged.
- Document: `### Round <position>` and the consensus line's round are the position on the chain the caller passes.
- Validator: its known decision ids are the chain rounds' accepted ADR ids (unchanged), now in the same numbering.
- Not changed: stored ids of rounds written before this change (history; their answers name them), the panel's
  "superseded" label (stored number), and the flow host's clarify step (`src/flow/kinds/clarify.ts`), which still
  numbers ids by its stored round number -- outside the ruling's scope (requirement documents); flagged for a decision.

## 5. Split retry in revision mode (human ruling 2026-10-28)

Folded into version 3 (not yet released when it landed), so the round has one version bump.

- The prompt carries only the latest earlier draft that has tasks or reasons, as `earlier-draft`
  (`{draftNo, tasks|null, feedback, handedBackFor}`), each reason with its meaning (§2). A draft code handed back and one
  the person sent back with feedback are the same block and the same rule. A failed call with neither is skipped.
- The instruction: revise that draft, change only what its feedback or reasons name, keep every other task; with null
  tasks, write afresh avoiding what the reasons name.
- Order: instruction -> document -> overview -> `earlier-draft`, and no block for draft 1, so every draft of one
  requirement at one commit shares the prefix up to the draft block; the nonce stays `overview.hash.slice(0, 16)`.
- Trade-off: drafts older than the latest are no longer sent; a reason fixed two drafts ago is not repeated to the model.

## 6. Corrections after review (controller session a9f9d6de, 2026-10-28)

- §4 (round numbering): chain-position ids are not unique across a requirement's rows — a superseded row keeps its
  stored ids (e.g. `R3.Q1`) and a later chain round at that position gets the same. A clarify round may therefore depend
  only on the chain's earlier rounds' questions (`recordClarify`, `earlierQuestionIds`); a dependency on a superseded
  round's question is refused `unknown-dependency`. Superseded rounds are still shown to the model as context.
- §5 (revision mode): the block revises the latest earlier draft **that has tasks**, with the person's feedback on it; a
  later draft without tasks (schema-invalid) no longer replaces it — its reasons are added as `draft <n>: <reason>`. Only
  when no earlier draft has tasks is `tasks` null. The instruction text is unchanged.
- Known limits registered, not changed: the flow host's clarify (`src/flow/kinds/clarify.ts`) still numbers ids by stored
  round; the panel still lists hand-back reasons as bare codes (the plain-language meanings reach the model only); an
  omp row without `maxTokens` (or an openrouter row with no window) still reads `context-unavailable`; only the primary
  `writes` entry's paths are shape-checked in a multi split (predates v3, which now states the rule for every entry).
