# Proposal: weight cache reads in the token ledger (tester #285 follow-up)

Status: **proposal only — not built.** Written by the controller of Orca session `d467cbd2` (2026-11-13, tester
follow-up I) under the human's 「先按你的建议执行」; the controller's recommendation in the round's analysis was
"brainstorm before changing the budget unit", so nothing here changes behaviour until the human picks an option.

## 1. Problem

Every budget number in Orca — a task's work grant, a group's `limit.tokens`, spend caps, the estimator's answer — is in
**ledger tokens**: `entryTotal = input + output + cacheRead + cacheWrite` (`src/control/usageLedger.ts:12`). The
estimator is told to count cache reads at their full count (`src/control/estimatePrompt.ts:119`).

Providers do not price those four the same. The tester's `dogfood-20261112-6` run (issue #285, "成本结构补充"):

| task | ledger tokens | of which cacheRead |
|---|---|---|
| planning-cli | 16,610,268 | 16,074,752 (96.8%) |
| dag-core | 6,897,827 | 6,563,840 (95.2%) |
| graph-cli | 6,487,490 | 6,111,744 (94.2%) |

A cache read is billed at roughly a tenth of fresh input by Anthropic (ccmem's 2026-09-06 fit: cache_read 0.50 vs
cache_creation 10.00 vs output 25.00 $/Mtok for the model it measured; prices change and differ per provider/model). So a
task that "used 16.6M tokens" cost about what ~2.5M fresh-input-equivalent tokens cost. Consequences a user sees:

- Grants and caps feel 5–10× too small once a session gets long, and runs stop on budget while the money spent is modest.
- Estimates look wildly wrong (#224, #266: 12–92×) partly because the dominant term — replaying the transcript from cache
  on every tool call — is counted at full weight, and grows quadratically with the number of tool calls.
- Comparing tasks by "tokens" ranks a long cheap session above a short expensive one.

## 2. Options

- **A. Keep raw ledger tokens** (today). Simple, provider-neutral, exactly what providers report. Misleads on cost.
- **B. Display a weighted figure next to the raw one; budgets unchanged.** `weighted = input·w_in + output·w_out +
  cacheRead·w_cr + cacheWrite·w_cw` in "input-equivalent tokens", weights per agent installation (or per provider) in
  orchestration settings, defaulting to `w_in=1, w_cw=1.25, w_cr=0.1, w_out=1` (output left at 1 so the weighted number
  stays a token count, not a price). Shown in run/group usage lines and the #285 breakdown. No budget semantics change.
- **C. Budget in weighted tokens for groups created from a marker on** (the same "model version" mechanism the
  expectation model used: old groups keep raw tokens, new ones use weighted). Estimator instruction v5 asks for weighted
  tokens. ccloop's live ceiling and the 1.2× live threshold compare against the same unit, so ccloop must either receive
  weights in the envelope or keep comparing raw tokens against a raw ceiling Orca converts (needs a ccloop change and a
  repin).
- **D. Budget in money.** Needs real per-model prices kept current; the projects already avoid pinning model specifics
  in code (ccmem rule "不在代码里 pin 任何模型 ID"). Not recommended.

## 3. Recommendation

B now (display only, reversible, no cross-repo change), then decide C with a few real runs' numbers side by side.
Open questions for the human: is "token budget ≈ cost" the intended meaning of a budget at all, or is it a guard
against runaway sessions (where raw counts are the right unit)? Should weights be per installation, or one global set?

## 4. Not in scope

Reducing the replay itself (context handoff thresholds, #195; session reuse, #109/#197, which the human ruled out and
which would not remove in-session replay anyway).
