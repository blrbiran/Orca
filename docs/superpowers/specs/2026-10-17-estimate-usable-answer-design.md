# A paid estimate yields a usable answer — design

Who: Orca session `4de777f4` (continued), 2026-10-17. Branch `codex/round-20261017`.
Status: draft revised after self-review, a builder check and an independent review; for the human's approval.

## 1. Intent

Every plan import (and every accepted requirement split, which goes through the same `writeImportedPlan`) queues one
paid single-call budget estimate. Today an answer that breaks any rule of `budget-estimate-v1` is discarded whole: the
estimate goes `failed`, the tokens are booked, and the person gets nothing for them. On the person's omp LiteLLM alias
3 of 4 real estimates were discarded for the same shape — task `a` listed twice, the second copy with
`rationale: "placeholder"` (evidence: `.superpowers/sdd/2026-10-15-omp-single-call-acceptance/progress.md`,
`.superpowers/sdd/2026-10-15-every-agent-requirement-chain/p2-report.md` run C).

**The human's words (2026-10-17):** what matters is "花了钱就一定要拿到能用的结果" — money spent must buy a usable result.
Asked whether Orca may repair an answer itself: "能接受". Asked what to do when it cannot repair: "希望 Orca 自动再调一次".
The automatic estimate at import stays (the human chose usable results over "don't spend automatically").

## 2. Goals, non-goals, anti-goals

Goals
- G1. Make the model less likely to break the shape at all (instruction and per-request response schema).
- G2. When the answer carries a real estimate for every task but breaks a mechanical rule, Orca repairs it
  deterministically and uses it, marked as repaired, with the raw answer kept.
- G3. When it cannot be repaired, Orca automatically makes one more call that tells the model what was wrong.

Non-goals
- No change to when an estimate is triggered (import, split-accept, the person's `estimate` command).
- No change to how a ready estimate is applied to the budget (it stays advice the person applies).
- No retry of transport failures (spawn failure, timeout, rate limit, provider error): those are not "the model
  answered badly", and retrying them blindly can burn money in a loop. They stay `estimate-call-failed:<code>`.

Anti-goals (a failure even if it "works")
- A1. Inventing numbers. Repair may drop, reorder, normalize or copy request identity; it never fills in a missing
  task's amounts, a missing field, or a number the model did not give.
- A2. Unbounded spend. At most one automatic retry per estimate the system or the person started; never a retry of a retry.
- A3. Hiding what happened. A repaired or retried estimate says so in the panel, with the repairs listed.

## 3. Constraints

- CLAUDE.md Rule 5: repair and the retry decision are code, never the model.
- Rule 9: every new branch gets a mutation that removes it and is seen red. Existing criteria are rewritten only where
  this spec names them, under the human's 2026-10-17 go-ahead.
- Rule 13: `.superpowers/sdd/**` and published specs are not edited; this spec is new.
- Control store schema stays 13 unless a column is truly needed (the estimate body is JSON; new fields go in it).
- The estimate record's output stays `budget-estimate-v1` (what the panel and `apply` read today).
- ESTIMATE_GRANT (250 000 tokens) per call is unchanged; a retry is a new grant from the group's reserve.
- omp single calls have no decode-time schema enforcement (ccloop pastes the schema into the prompt only); claude
  (`--json-schema`) and codex (`--output-schema`) enforce it. The schema must stay within the keywords real claude and
  codex already accept (estimatePrompt.ts, drafter finding F9): `type`, `properties`, `required`,
  `additionalProperties: false`, `items`, `enum`.

## 4. Design

### 4.1 Instruction v2 and a per-request answer shape (G1)

Add instruction version `"2"` to `ESTIMATE_INSTRUCTIONS` (`src/control/estimatePrompt.ts`). Differences from v1:

- The plan's task ids and their count are listed in plain text in the instruction tail that follows the request
  (e.g. `This plan has 3 tasks: "a", "b", "c". Answer each exactly once.`), computed from the request, so the model
  never has to dig them out of the nested string.
- **The answer's `tasks` is an object keyed by taskId**, not an array:
  `"tasks": { "<taskId>": { complexity, confidence, work, handoff, rationale, assumptions }, ... }`.
  The response schema is built **per request**: `tasks` is `{ type: "object", properties: { <each taskId>: <task
  entry schema without taskId> }, required: [<every taskId>], additionalProperties: false }`. This uses only the
  allowed keywords, and under claude/codex decoding it makes "each task exactly once, none extra" structural.
- The answer's `schema` value is `"budget-estimate-answer-v2"`; Orca converts it to `budget-estimate-v1` (tasks as the
  array in plan order, `taskId` filled from the key) before classification. The stored output stays v1.
- **Duplicate keys under v2.** ccloop parses the model's text with `JSON.parse`, so a key written twice keeps the *last*
  value and Orca never sees the first. Under claude/codex decoding this cannot happen; under omp it can. The placeholder
  rule (§4.2) is what catches a placeholder second copy then; a second copy with real numbers is used as given.
- v2 drops v1's "assumptions sorted" rule (the classifier never checked order) and keeps "no entry twice"; `planHash`
  is no longer asked of the model (Orca copies it from the request, §4.2).
- **Detecting the v2 shape** goes by the contract's `instructionVersion === "2"` and `tasks` being a plain object, never
  by the answer's `schema` string. Conversion walks the **plan's** task list and reads each key with `Object.hasOwn`
  (ids such as `constructor` are legal, and `JSON.parse` moves all-digit keys to the front), never `Object.keys` order.
- `responseSchemaVersion` stays the literal `budget-estimate-v1` in the request and the contract; the name
  `budget-estimate-answer-v2` lives only in the v2 instruction and the per-request response schema.

`SingleCallHandler.prepare` for `estimate` builds the per-request schema when the contract's instruction version is
`"2"`; v1 keeps `BUDGET_ESTIMATE_JSON_SCHEMA`. The preflight's prompt-size count (`buildBudgetEstimateRequest`) must use
the v2 prompt bytes, task list included.

**Selecting v2.** The instruction version comes from the execution profile (`estimatorPreflight.instructionVersion`,
part of `profileHash`). The person's real profile says `"1"`. The builder changes nothing in `~/.orca`; the handoff
gives the human the one-field edit plus a read-only check that no estimate is `queued`/`running` first (a queued one,
including an automatic retry, would go `profile-changed` at claim; a stranded estimate in that window is accepted).
Repair (§4.2) and retry (§4.3) work under both versions.

### 4.2 Deterministic repair (G2)

A new pure function `repairEstimateOutput(raw, ctx) -> { output, repairs: string[] } | { problems: string[] }`
(`ctx` = plan hash, the plan's task ids in order, the contract's instruction version) runs in
`completeEstimateInStore` before `classify`; the classifier then judges the repaired value and stays the single judge.
Its input is the raw answer ccloop returned. A `null` raw answer never reaches repair: it is a failed call (§4.3).

Steps, in this order; each records a code in `repairs` only when it changed something:

1. `answer-v2-converted` — a v2 keyed answer (§4.1) converted to the v1 array. (Not a defect; records which shape came back.)
2. `schema-name-set` — top-level `schema` missing or not `budget-estimate-v1`: set it.
3. `plan-hash-copied` — `planHash` missing or not the request's: set it. The hash carries nothing the model could add.
4. `assumptions-normalized:<taskId>` — in **every** entry, before any entry is chosen: trim each string, drop empty
   ones, drop exact duplicates (first kept; order otherwise unchanged, no sorting). If none remain, that entry is
   unusable (A1: Orca never invents an assumption).
5. `unknown-task-dropped:<taskId>` — an entry whose taskId the plan does not have: dropped.
6. `duplicate-task-dropped:<taskId>` — a v1 array with a taskId more than once: keep the **first entry that is
   usable** — passes the per-task schema after step 4 and is not a placeholder (below); drop the others. If none is
   usable, the task is unrepairable.
7. `tasks-reordered` — entries put in the plan's order.

**Placeholders.** An entry is a placeholder when its `rationale`, trimmed and lower-cased, is one of `placeholder`,
`todo`, `tbd`, `x`, `n/a`, `...`, `-`. This applies to every remaining entry, duplicate or not: a placeholder entry
with no usable sibling makes the answer unrepairable (`placeholder-entry:<taskId>`). This is the only judgement in
repair, pinned by a criterion. It makes a one-task answer whose rationale is `placeholder` fail and retry where v1
accepted it today — intended (§1).

Unrepairable (→ §4.3), each a problem code: `task-missing:<taskId>`, `task-invalid:<taskId>:<zod path>`,
`placeholder-entry:<taskId>`, `field-invalid:<zod path>` (top-level fields: `goalReviewReserve`, `groupRationale`,
extra keys), `not-an-object`. Repair **collects every problem**, it does not stop at the first.

If repair succeeds but the classifier still refuses (a number past the safe-integer limit, non-canonical JSON), the
problems are the zod issues as `field-invalid:<path>:<message>` plus `output-not-canonical`; the list is never empty.
`problems` are capped at 20 entries of at most 200 characters each.

The estimate record gains `repairs: string[]`; records written before this change have no such field and parse as
`[]`. The raw answer's canonical record is kept as today. A repaired estimate is `ready`.

### 4.3 One automatic retry with feedback (G3)

**Trigger.** An estimate that is not itself a retry ends `failed` with one of:
- `estimate-output-invalid` or `estimate-output-plan-mismatch` after repair failed (problems from §4.2);
- `estimate-call-failed:single-call-output-invalid` — ccloop could read no single JSON object from the answer
  (prose, a broken fence, or an answer cut off at the output cap; ccloop `ompSingleCall.ts`, `codexSingleCall.ts`,
  `types.ts` `SingleCallOutputInvalid`). Problem: `no-json-object` (the feedback says the answer may have been cut off
  and asks for the JSON object only, with one-sentence rationales).

No other `estimate-call-failed:*` code retries (transport, timeout, rate limit, provider errors; §2).

**Never throws.** The retry is decided **after** the failed estimate's settlement numbers are computed in the same
transaction, by plain comparisons only; no call in that decision may throw (a throw would roll back the settlement and
leave the estimate `running`, re-driven every round). Each unmet condition records `retrySkipped: <code>` on the
failed estimate instead:
- `group-not-prestart` — the group is stopped, archived, or past pre-start;
- `budget-deficit` — `group.ledger.budgetDeficit` is non-zero after settlement;
- `usage-unknown` / `dispatch-blocked` — the group or store is in that state;
- `reserve-insufficient` — the reserve after settlement cannot hold one ESTIMATE_GRANT in every dimension
  (a `null` limit in a dimension counts as fitting);
- `proposal-changed` — the proposal's version differs from the `proposalVersion` stored on the failed estimate
  (new field, written at queue time by `writeImportedPlan` and `createEstimate`; an estimate without it →
  `proposal-unknown`);
- `superseded` — a newer estimate version exists for the group (the person ran `estimate` meanwhile);
- `tokenizer-unavailable` — the profile's tokenizer is `exact` (the completion transaction has no token counter;
  the person's profile uses `utf8-upper-bound`);
- `input-too-large` — the retry prompt no longer fits the frozen window or the grant.

**What the retry is.** A new estimate row and a `budget-estimate` wake, written in the same transaction. Not a
command-ledger entry: replay safety comes from the existing `estimate-result` receipt check that returns early on a
second completion (webService.ts `completeEstimateInStore`).
- id: `estimate-${sha256Canonical({ groupId, retryOf: failedEstimateId }).slice(0, 24)}`; version: max + 1.
- It reuses the failed estimate's frozen `estimatorSlot`, profile, mode and **request unchanged** (so a v1 request stays
  byte-identical); no profile resolution or agent probe.
- The record carries `origin: { kind: "auto-retry", of: <failedEstimateId>, problems: [...] }`; the failed record
  carries `retriedAs: <id>` or `retrySkipped`. Human-started and import-started estimates carry no `origin`.
- A new contract is written: the old one plus `retryProblems: [...]` (optional field; absent on every other contract),
  with its own hash. `prepare` appends a feedback tail after the request bytes when the contract has
  `retryProblems`: "Your previous answer was rejected for these problems: …. Answer again with one JSON object that
  fixes all of them." The previous answer is not resent.
- Size re-check: a pure function computes the retry prompt's bytes (instruction + request + tail), applies the frozen
  tokenizer ratio and framing overhead, and compares with the frozen window and the grant (`input-too-large` above).
- The grant is reserved like any queued estimate (`committedRemaining` += ESTIMATE_GRANT, reserve recomputed).

The retry then goes through the normal wake, claim, spend-cap and accounting path; usage is booked like any estimate.
A failed retry stays `failed` with no further retry (A2). A person's `estimate` command is a fresh start and may get
its own one retry.

**In-flight rule (unchanged).** `start` and `set-task-loop` refuse `estimate-in-flight` while an estimate is `running`
or `start-unknown`; a merely `queued` retry does not block `start`. A retry still queued when the group starts meets
the same fate as any queued estimate at that point today (existing behavior, not changed here; the builder records
what it is in the plan).

### 4.4 Panel

- An estimate shows `repaired` (with codes), `retry of vN`, `retried as vN+1`, or `retry skipped: <code>`, both locales.
- The newest estimate version is the current one (as today).
- Strict schemas that must learn the new optional fields: `budgetEstimateRequestSchema` (no change: the request is
  unchanged), `estimateExecutionContractSchema` (`retryProblems`), the estimate record/view schemas
  (`repairs`, `origin`, `retriedAs`, `retrySkipped`, `proposalVersion`) and their web mirrors.

## 5. What the builder decides

- Exact placement of repair vs. classification (one function or two), as long as classify remains the final judge.
- The English and Chinese wording in the panel, the v2 instruction text and the feedback tail (keep v1's tone).
- What a retry still queued at `start` does today, recorded in the plan (§4.3).

## 6. Verification

Free (fixtures; ccloop fake-omp / fake codex / fake claude single-call answers):
- Each repair code: an answer needing exactly that repair goes `ready` with exactly that code; mutation removing the
  repair → red.
- Unrepairable shapes (missing task, missing amount, placeholder entry) and `single-call-output-invalid` → `failed` and, when not a retry,
  a queued retry whose prompt lists the problems; mutation removing the retry → red.
- A retry that fails again → no third call (count the fake's calls). Retry skipped for each `retrySkipped` code.
- Any other `estimate-call-failed:*` → no retry. Each `retrySkipped` code, including a settlement with a deficit (the transaction must not throw).
- v2 per-request schema: for a 3-task plan, the schema's `tasks.required` equals the three ids; the v2 answer converts
  to the same v1 output as the equivalent v1 answer.
- v1 requests and prompts are byte-identical to today's (pin a hash).

Paid (human approved paid acceptance for this round, 2026-10-17). `scripts/live-driver-acceptance.ts --scenario estimate`
today accepts only claude and omp kinds; the builder extends it to codex (soft estimate mode) and to repeated runs:
- omp alias `local-litellm/ep-20261012204110-nvhqw`, instruction v2: N real estimates (builder proposes N, ≥5) of the
  same small plan; report how many were ready first-call, ready-after-repair, ready-after-retry, failed. Tool-reported
  tokens only.
- codex `gpt-6-luna` (soft estimate mode) and claude 1M: one real estimate each under v2. (`gpt-6-sol` has no quota.)
- `~/.orca` unchanged throughout (Rule 17); the person's profile is not edited by the builder.

## Correction (session 3d229487, 2026-10-20): queued estimates are withdrawn at claim time

Who: Orca session `3d229487` (implementer under controller `3d229487`), 2026-10-20, written on branch
`estimate-withdrawn` from main `852ed0dc`. This section corrects §4.3 "In-flight rule (unchanged)" (its last sentence:
"A retry still queued when the group starts meets the same fate as any queued estimate at that point today (existing
behavior, not changed here …)") and the matching §5 bullet ("What a retry still queued at `start` does today"). The
text above is kept verbatim; where it disagrees with this section, this section wins.

**The ruling.** It is not in `.superpowers/sdd/2026-10-17-estimate-usable-answer/progress.md` (that ledger records only
the gap: "Ruling: a retry still queued when the group starts is claimed and runs (existing queued-estimate behavior,
observed in Task 5, not changed) … logged as a known gap for the handoff" and final-review "M1 queued retry still runs
after confirm/start/supersede (handoff, later round)"). The human ruled in session `a3b2a7a7` on 2026-10-18, recorded in
`docs/handoff/handoff.md` by commit `51019eb1` ("docs(handoff): record the ruling on withdrawing unusable queued
estimates"). Quoted from that commit:

> 修法**人已裁**（2026-10-18，会话 `a3b2a7a7`，人原话「同意你上面所有的建议」）。控制器建议原文：①新增终态
> `withdrawn`，带原因码 `group-started`／`proposal-confirmed`／`superseded`，释放 grant、不触发重试，面板显示
> 「已撤回：<原因>」（不复用 `failed`——那表示答案不合格且会走重试判定；不删行——留证据链）；②**所有排队估算一起管**，
> 不只自动重试（判据是「结果还能不能用」，与谁排的队无关；卡死问题人的估算本来就有）；检查放在领取时、用代码。

**What was wrong.** Read on main `852ed0dc` (`src/control/webService.ts` `claimEstimate`): a queued estimate whose
proposal was confirmed, or which a newer estimate superseded, was claimed and run (a paid call whose answer the panel
cannot apply). Once the group had started, `prestart(group)` threw `grant-amendment-unsupported` inside the claim; the
`budget-estimate` wake handler (`webDispatch.ts`) let the throw escape, so the wake stayed undelivered and was retried
every pump pass, the estimate stayed `queued` forever and its grant stayed in `committedRemaining`.

**The rule.** `claimEstimate`, inside its transaction, for an estimate that is `queued` — whoever queued it (a person's
`estimate`, an import, a draft acceptance, or an automatic retry) — decides by code, after the existing checks that the
estimate is still claimable, that no run exists for it yet, and that the group is not archived (an archived group's
estimate stays queued, issue-fixes spec §6.3, unchanged), and before every other check (`prestart`, stopped, spend cap,
probe result):

1. `group-started` — the group's status is `running`, `review` or `done` (the statuses `prestart` refuses with
   `grant-amendment-unsupported`), or the group's execution is pending or running by the start guard's predicate
   (`groupExecutionPendingInStore`, start-guard spec 2026-10-15 §3.1: an undelivered start/no-start/resume wake, an
   active work run, or a busy task — a Web start leaves the stored status `ready` through the first run);
2. `proposal-confirmed` — the budget proposal's state is `confirmed` (its advice can no longer be applied);
3. `superseded` — the group holds an estimate with a higher `estimate_version`.

The first that holds wins (a started group's proposal is always confirmed, so the more specific reason comes first).
The estimate then becomes **`withdrawn`**, a new terminal state, with `reasonCode` `estimate-withdrawn:<reason>`:
- its grant is released in the same transaction: `committedRemaining` minus the estimate's grant, then reserve and
  deficit recomputed from the group's limit and usage (`budgetBalance`, as a settlement does);
- no run row, no claim row, no provider call, no settlement and no retry decision (a withdrawn estimate is never
  retried and never re-queued);
- the estimate's spend-cap block, if any, is cleared;
- the claim returns `null`; the wake handler sees a state other than `queued` and marks the wake delivered.

The probe that runs before the transaction (not the paid call) may still run once for such an estimate; the decision
is taken in the transaction so that a confirm, start or newer estimate that lands while the probe runs is seen.

**Storage.** `estimates.state` is a `TEXT` column with no `CHECK` (migrations.ts); `withdrawn` is a value checked in code
only (the record schema in `queries.ts` and the view schema in `webProtocol.ts` and its web mirror). No control-DB
schema version change. A record in state `withdrawn` must carry a request and one of the three reason codes.

**Visibility.** The group view (HTTP, MCP `orca_send`, `orca control send` and the panel read the same view) shows the
state `withdrawn`; the panel shows "withdrawn: <reason>" / 「已撤回：<原因>」 in both locales.

**Unchanged.** `retrySkipped` `proposal-confirmed` and `superseded` on settlement stay: they apply to an estimate that
was already running when the proposal was confirmed or a newer estimate was queued. A queued estimate of a **stopped**
pre-start group, or one whose profile no longer resolves, is not withdrawn by this section (not in the ruling).

## Correction (session 9ec98639, 2026-10-21): a stopped pre-start group's queued estimate is parked

Who: Track E implementer, Orca session `9ec98639`, 2026-10-21. Corrects the last sentence of the 3d229487 Correction
above ("A queued estimate of a **stopped** pre-start group … is not withdrawn by this section (not in the ruling)"):
such an estimate is now **parked** — still `queued`, grant kept, its wake acknowledged in the claim's transaction —
and re-armed by every reachable un-stop path. Ruling and design: `2026-10-21-estimate-parking-design.md`.
