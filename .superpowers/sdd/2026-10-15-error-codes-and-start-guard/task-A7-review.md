# Task A7 review (task reviewer, Orca session 026d10e3 subagent, 2026-10-15)

Reviewed: 265642c3..3c5f21bd (5c54e447 feat, 3c5f21bd fix), against task-A7-brief.md as overridden by plan R3
(the generic text is `{{code}}: {{detail}}` / `{{code}}：{{detail}}` / `{{code}}`) and the ledger's A7 ruling (no surface shows
`X · X`; the explanation is shown only when it differs from the code). Clone: `/private/tmp/oec/mut/a7` at 3c5f21bd (web built
in the clone, rc=0). I did not touch the implementer's leftover clone `/private/tmp/oec/mut/a7f-red`.

## Spec: ✅ (with one Critical regression outside the brief's test list, below)

- §4.6 surfaces. Each one calls the explainer:
  - `explainRefusal`: `ccloop-failed` → `codeAndDetail` → `explainCcloopCode`.
  - `explainRunReason`: `control-peer-exit` and `accept-refused` go through `peerExitReason`. `<usageUnknownReason>:<code>` appends `explainCcloopCode`.
  - `AgentSelectionEditor` `FailedCell`, `AgentSettings` failure line, `TaskDetail` saved-result line, `RequirementsPanel` failed-call line: all use `explainBesideCode` → `explainCcloopCode`.
  - `ControlGroupView` estimate line: `explainEstimateReason`.
  - `refusalText`: shows the `ccloop-failed` table entry, per the preamble's recorded interpretation (an import cycle otherwise).
- Lookup order is ccloop table → Orca `errorEntry` → generic (`ccloopCodes.ts:18-22`).
- The generic texts follow R3 exactly in `en.ts` and `zh.ts`.
- Every `enCcloopErrors` and `zhCcloopErrors` entry interpolates only `{{detail}}`. The `CCLOOP_CODES` test enforces this.
- `CCLOOP_CODES` is held to both languages in `tests/panel/refusalCoverage.test.ts`. `control-peer-exit` is in `VIEW_REASONS` and in both error tables.
- The ccloop table texts match the brief's table word for word.
- No existing assertion was edited. Every test-file hunk in the diff is an addition, except the brief-named `refusalCoverage.test.ts` import line and the `VIEW_REASONS` addition. `requirements.test.tsx` and `savedResultRecovery.test.tsx` are untouched. The implementer changed code, not tests, to keep them green.
- Deviations, checked:
  - (1) RequirementsPanel explains a blocked reason only when it carries `:`. Both sides are pinned: removing the guard reddens existing `requirements.test.tsx:198` (A7l1); removing the words reddens the new row (A7l2).
  - (2) The TaskDetail guard was later generalised to `explainBesideCode` (3c5f21bd). Its unknown side is pinned twice: by the new ccloopCodes test (A7r) and by existing `savedResultRecovery.test.tsx:29` (A7k4).
  - The brief's "a saved-result reason" test now uses a known code. This is a brief-authored new test, and the change is justified: with R3 the unknown-code literal would have been vacuous.
- Ledger ruling. The four surfaces that print the bare code beside its words use `explainBesideCode`, so none shows `X · X`. ControlGroupView and the blocked-run line print a prefixed reason, which never equals the words (see Minor 1).

## Findings

### Critical

**C1. An existing criterion is red at 3c5f21bd: `web/tests/agentsI18n.test.tsx:126`.** The implementer did not report it.
- Expected `["协调", "被拒 · agent-installation-missing", ""]`. Received `"被拒 · agent-installation-missing · 安装表里没有这个 agent。"`.
- Cause: `FailedCell` (`web/src/AgentSelectionEditor.tsx:72-76`) now explains the slot code via the Orca-table fallback. `agent-installation-missing` has a zh error entry, so its words differ from the code and are appended.
- Proof:
  - The full web suite at HEAD is 1 failed / 1116 passed (`/private/tmp/oec/logs/a7r-webfull-head.log`, rc=1).
  - The same file at 265642c3 (exported with `git archive` into `/private/tmp/oec/mut/a7base`) passes 3/3 (`a7r-agentsI18n-base.log`, rc=0).
  - It was also red at 5c54e447, whose verbatim line always appended the words.
- Why it was missed: the brief's Step 4 list and the implementer's "neighbours" list both leave out `agentsI18n.test.tsx`.
- Fix. Spec §4.6 asks for exactly this behaviour: explain the slot's code, with the Orca table after ccloop's. So the assertion is stale, not the code. It is not in the plan's "Existing criteria that change" list, though, so it needs a controller or human ruling to rewrite (Global Constraints). Then rewrite `agentsI18n.test.tsx:126`, and its `:113` `toContain("被拒 · agent-installation-missing")` if wanted, to the explained literal, with a comment naming §4.6.
- The alternative, explaining a slot only from the ccloop table, contradicts §4.6's lookup order. I do not recommend it.

### Important

**I1. RequirementsPanel's `failedCall` choice is unpinned (two mutations stay green).**
- Code: `web/src/RequirementsPanel.tsx:264` `const failedCall = step?.state === "failed" ? [...step.calls].reverse().find((call) => call.outcome === "failed") ?? null : null;`
- Mutations:
  - A7s: drop `.reverse()`, so the first failed call is shown instead of the latest.
  - A7t: drop the `step?.state === "failed"` guard, so a failed call is shown for a step that is not failed.
- Both stay green on `ccloopCodes.test.tsx` and `requirements.test.tsx`. On the whole web suite, each one's only red is C1's pre-existing failure (`A7s_all`, `A7t_all`).
- Both states are reachable:
  - A round keeps every attempt's call: `src/control/requirementCalls.ts:102`, attempt = `calls.length + 1`; `:199` appends.
  - A retried failed round therefore holds an old failed call. It returns to drafting (A7t), and a second failure leaves two failed calls (A7s).
- Fix: add one new test in `web/tests/ccloopCodes.test.tsx`:
  - A failed round with `calls: [failed "omp-model-catalog-unavailable", failed "omp-single-call-cap-exceeded"]` shows `omp-single-call-cap-exceeded · ${EN_CAP}` and not the catalog line.
  - A `drafting` round holding a failed call renders no `p[role="status"]` with that code.

### Minor

1. **ControlGroupView and the blocked-run line repeat an unknown code.**
   - Estimate line: `estimate-call-failed:omp-new-thing · omp-new-thing`, which `agentSelectionEditor.test.tsx:324` pins.
   - Blocked-run line: `requirement-usage-unknown:omp-new-thing · … settled. omp-new-thing`.
   - This keeps the ledger ruling's letter, because the prefixed reason ≠ the words, but the trailing token adds nothing.
   - Controller's call: either leave it, or make `explainEstimateReason` return null when the words equal the stripped code (and update the new test literal).
2. **The brief's A7b red list over-claims.** The brief says A7b also reddens "a run reason…" (the accept-refused row). That row uses `agent-config-invalid`, a ccloop-table code, so it cannot depend on the Orca fallback. Only the `agent-unselected` row reds. That row alone is a sufficient pin. No code change needed.
3. **A peer exit or `ccloop-failed` with no parseable code reads "unknown".** Examples: `ccloop exited with an error: unknown`, `unknown: <stderr>`. This is R3 applied mechanically to the server's `unknown`. It is unpinned in the web and not a defect; noting it for the human's final review.

## Mutations

Clone `/private/tmp/oec/mut/a7` (3c5f21bd).
- Runner self-check with a bad spec: exit 2, `.mutate` reads "found 0", and clone `git diff` is 0 bytes.
- Green baseline:
  - Web: 11 files, 124/124 (`a7r-baseline-web.log`, rc=0).
  - Root: refusalCoverage + scanPanelText, 9/9 (`a7r-baseline-root.log`, rc=0).
  - No skips.
- Every mutation below:
  - `.mutate` says "applied 1".
  - sha-after ≠ sha-before = sha-restored.
  - restore-bytes are `0 0`.
- Logs are in `/private/tmp/oec/mut/logs/<name>.*`. Specs are in `/private/tmp/oec/mut/specs/a7/`.
- The A7g `from` texts are the implementer's updated ones from 3c5f21bd.

| Name | File | Test | Result: red on |
|---|---|---|---|
| A7a no ccloop table | ccloopCodes.ts | ccloopCodes | red: "reads ccloop's table…", "in Chinese", "a refusal…", "a run reason…", "an estimate's reason code", "a saved-result reason", "a failed requirement…" (each a toEqual/toContain on the table text) |
| A7b no Orca fallback | ccloopCodes.ts | ccloopCodes | red: "reads ccloop's table…" (`agent-unselected` row) |
| A7c drop unknown code | ccloopCodes.ts | ccloopCodes | red: every generic row (en, zh, refusal, run reason, estimate, failed requirement, unknown-once) |
| A7d refusal not special-cased | refusalExplain.ts | ccloopCodes | red: "a refusal…" (`toEqual({text: EN_CATALOG})`) |
| A7e run reason not parsed | refusalExplain.ts | ccloopCodes | red: "a run reason…" rows 1-3 |
| A7f usage-unknown code dropped | refusalExplain.ts | ccloopCodes | red: "a run reason…" row 4; "a failed requirement…" blocked line |
| A7g AgentSelectionEditor | AgentSelectionEditor.tsx | agentSelectionEditor | red: "explains a slot's ccloop code…" (slot line `toContain`) |
| A7g ControlGroupView | ControlGroupView.tsx | agentSelectionEditor | red: same test, estimate line `toContain` |
| A7g AgentSettings | AgentSettings.tsx | agentSettings | red: "explains a failed detection's ccloop code" |
| A7g TaskDetail | TaskDetail.tsx | ccloopCodes | red: "a saved-result reason" (en `toContain`) |
| A7g RequirementsPanel | RequirementsPanel.tsx | ccloopCodes | red: "a failed requirement…" (failed-call line) + unknown-once |
| A7h English in zh | zh.ts | ccloopCodes | red: zh assertions of "in Chinese", "a refusal…", "a run reason…", "a saved-result reason" |
| A7i coverage | zh.ts | root refusalCoverage | red: CCLOOP_CODES test (`['omp-single-call-cap-exceeded']`) |
| A7j en control-peer-exit | en.ts | root refusalCoverage | red: "has a en entry…" (`['control-peer-exit']`) + same-codes |
| A7j_zh (extra) zh control-peer-exit | zh.ts | root refusalCoverage | red: "has a zh entry…" + same-codes |
| A7k1-4 (extra) `explainBesideCode` returns words always | ccloopCodes.ts | agentSelectionEditor / agentSettings / ccloopCodes / savedResultRecovery | red: each unknown-once test (`· omp-new-thing · omp-new-thing`, `omp-new-thing omp-new-thing`, `['omp-new-thing · omp-new-thing']`); existing savedResultRecovery:29 "multiple elements" |
| A7l1 (extra) blocked guard removed | RequirementsPanel.tsx | requirements | red: existing `:198` regex (deviation 1's reason) |
| A7l2 (extra) blocked words removed | RequirementsPanel.tsx | ccloopCodes | red: "a failed requirement…" blocked line |
| A7m (extra) accept-refused not a peer prefix | refusalExplain.ts | ccloopCodes | red: "a run reason…" row 3 |
| A7n (extra) estimator branch dropped | ccloopCodes.ts | ccloopCodes | red: "an estimate's reason code" row 1 |
| A7o (extra) regex `: ` → `:` | ccloopCodes.ts | ccloopCodes | red: "takes the server's forms apart…" (`file:///x` → `file`) + refusal + run reason |
| A7p (extra) zh generic uses ASCII colon | zh.ts | ccloopCodes | red: "in Chinese" row 2 |
| A7q (extra) peerExitReason keeps the exit | ccloopCodes.ts | ccloopCodes | red: "takes the server's forms apart…" second expect + run reason |
| A7r (extra) TaskDetail unknown repeated | TaskDetail.tsx | ccloopCodes | red: unknown-once saved-result `toBe` (`:122`) |
| **A7s** latest → first failed call | RequirementsPanel.tsx | ccloopCodes; full web | **green** (full suite: only C1's pre-existing failure) → I1 |
| **A7t** failed-state guard removed | RequirementsPanel.tsx | requirements; full web | **green** (same) → I1 |

27/29 red, all on assertions: no load errors or crashes.

## Other runs

- Full web suite at HEAD: 1 failed (C1) / 1116 passed (`a7r-webfull-head.log`, rc=1).
- Root `tests/panel` at HEAD: 78 files, 621/621 (`a7r-rootpanel-head.log`, rc=0). I read only the log's summary tail because of its stderr noise. That breaks Rule 14; the whole log is kept for re-reading.
- `pgrep -fl "fake-ccloop|worker.js|vitest"`: no processes before (`a7r-pgrep-before.log`) or after (`a7r-pgrep-after.log`).

## ⚠️ Cannot verify from diff

- Real-browser rendering of the new lines, including spacing next to `<code>`. Only jsdom and static markup were checked.
- Whether any surface outside the §4.6 table shows a ccloop code, for example the run activity views. I did not survey it.
- The Task G full gate. C1 will fail it until it is ruled on.

## Leftovers created by this review (deleting needs the human)

`/private/tmp/oec/mut/a7` (clone), `/private/tmp/oec/mut/a7base` (`git archive` of 265642c3 plus node_modules symlinks),
`/private/tmp/oec/mut/specs/a7/`, `/private/tmp/oec/mut/orig/A7*`, `/private/tmp/oec/mut/logs/A7*`, `/private/tmp/oec/logs/a7r-*`.

## Re-review 1 (fix round 1, commit 0a09d096; task reviewer, Orca session 026d10e3 subagent, 2026-10-15)

Scope: review-3c5f21bd..0a09d096.diff. It touches 2 test files, with 16 insertions and 1 deletion; no source file changed. Fresh clone `/private/tmp/oec/mut/a7r1` at 0a09d096; web build rc=0 (`a7r1-webbuild.log`).

- **C1: ADDRESSED.** In `web/tests/agentsI18n.test.tsx`, the fix changes one line and adds one comment line:
  - It rewrites the `:126` literal to `"被拒 · agent-installation-missing · 安装表里没有这个 agent。"`, as the controller ruled (ledger, A7 C1 ruling).
  - The added comment line names spec §4.6.
  - No other assertion changed. `:113`'s `toContain("被拒 · agent-installation-missing")` is a prefix and stays true.
- **I1: ADDRESSED.** A new test in `web/tests/ccloopCodes.test.tsx`: "a failed requirement names its latest failed call, and a drafting one names none". Both mutations are re-run in the a7r1 clone; for each, `.mutate` says applied 1, sha-before = sha-restored ≠ sha-after, and restore-bytes are `0 0`.
  - A7s_r1 (drop `.reverse()`): rc=1, red at `ccloopCodes.test.tsx:120`. The latest-call `toContain(\`omp-single-call-cap-exceeded · ${EN_CAP}\`)` fails.
  - A7t_r1 (drop the `step?.state === "failed"` guard): rc=1, red at `:124`. The drafting `not.toContain("omp-model-catalog-invalid")` fails, because the received text shows `omp-model-catalog-invalid · omp's model catalog could not be read.`.
  - Each run had 1 failed / 9 passed, the failure on the new test's own assertion, with no load error.
  - The assertion at `:121` (`failed.textContent` not containing the first call's code) was not seen red separately; A7s reds the `:120` assertion first. `:120` already pins the behaviour, so this is not a finding.
- **Full web suite** in a7r1: 129 files, 1118/1118 passed, 0 skipped, rc=0 (`/private/tmp/oec/logs/a7r1-webfull.log`). The clone's `git diff` and `git diff --cached` are both 0 bytes afterwards.
- **New breakage:** none.
- `pgrep -fl "fake-ccloop|worker.js|vitest"` found no processes before or after.
- The three Minors from the first review stay open; the controller decides them.

Verdict after re-review 1: Spec ✅; Quality Approved; Critical 0, Important 0, Minor 3; mutations 29/29 red (A7s and A7t are now red).

Leftovers added by this re-review: `/private/tmp/oec/mut/a7r1`, `/private/tmp/oec/mut/logs/A7s_r1.*`, `A7t_r1.*`, `/private/tmp/oec/logs/a7r1-*`.
