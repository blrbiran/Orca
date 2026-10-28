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
