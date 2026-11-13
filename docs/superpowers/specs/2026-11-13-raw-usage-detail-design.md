# Raw usage detail: record what a later price conversion needs (tester #285 follow-up)

Status: design, awaiting the human's approval. Orca session `c8b75eac` (tester follow-up J), 2026-11-13.
Supersedes the open question of `2026-11-13-weighted-token-ledger-proposal.md` (see "Outcome" appended there).

## 1. Intent

The human, verbatim (this session): 「token 预算的本意是近似成本 => 近似成本」; then 「应该以 token 为单位，美元可以之后换算」;
then, choosing among (1) weighted enforcement in ccloop, (2) Orca-side weighted booking, (3) record only:
「选3，都要记录原始token，而不是等效token。需要详细分别记录 token 相关的一些状态，比如是 in 还是 out，以及是否有cache。
还有具体的模型，这样之后才有机会换算成美元。具体要记录哪些你可以再补充」; and on the field list:
「同意按这张表格记，但是有些项目不是must have，有就记录，没有就留空。」

So: **budgets, caps, pause lines, live ceilings and estimates keep today's raw ledger tokens** (input + output +
cacheRead + cacheWrite). What changes is that every booked usage row carries enough raw detail — split by kind and by
model, and by who/where it was spent — that a later step can price it in dollars. No weights, no prices in this work.

## 2. Goals / non-goals / anti-goals

- Goal: each usage ledger row records, when the source reports it, the fields of §3; when the source does not, the field
  is null (never invented, never 0 for unknown).
- Goal: the detail is readable — CLI `usage` / `run show` / `group show` breakdowns and the Web usage panel show the split
  per model, including while a run is under way where today's events allow.
- Non-goal: weighted or dollar budgets; price tables; changing any enforcement comparison; estimator instruction changes.
- Anti-goal: a field filled with a guess (e.g. splitting a settlement total across kinds) — a guessed split is worse than
  null because a later conversion cannot tell it from a measurement.
- Anti-goal: changing `entryTotal` or the rule that the four parts reconcile to `tokens` (D7) — every new field is a
  sub-part or an annotation, never a fifth addend.

## 3. What to record (human-approved table; all optional except the total)

| Field | Meaning | Source | Today |
|---|---|---|---|
| `tokens` (required) | the booked total, as today | unchanged | yes |
| `input` | non-cached input | ccloop byModel | yes |
| `output` | output, reasoning included | ccloop byModel | yes |
| `reasoning` | of which reasoning/thinking (sub-part of output) | codex `reasoning_output_tokens`; claude/omp if reported | read, dropped |
| `cacheRead` | cache reads | ccloop byModel | yes |
| `cacheWrite` | cache writes, total | ccloop byModel | yes |
| `cacheWrite5m`, `cacheWrite1h` | of which 5-minute / 1-hour (sub-parts of cacheWrite) | claude `usage.cache_creation.ephemeral_{5m,1h}_input_tokens` | no |
| `model` | the model string as the provider reported it | ccloop byModel | yes |
| `agentKind`, `installationId` | which CLI and which installation (provider / endpoint) | Orca: the run's frozen agent selection | no |
| `requests` | number of model requests in the delta | claude/omp per assistant message; codex: null | no |
| `maxRequestInput` | largest single-request input (input + cacheRead + cacheWrite) in the delta | claude/omp per message; codex: null | no |
| `phase` | plan / execute / verify / setup / clarify / split / estimate / review / handoff | Orca run phase + ccloop event phase where present | partly (`source`) |
| `groupId`, `taskId`, `runId` | where it was spent | Orca | group, run yes; task no |
| `quality` | reported / observed-floor / settled (grant charge) / unattributed / breakdown-mismatch | Orca | partly |
| `appliedAt` | when booked (prices change over time) | Orca | yes |

Rows without a measured split (settlements, reconcile, killed calls' floors, pre-ledger migration) keep only `tokens`
plus the annotations Orca knows (agent, installation, phase, quality); kinds stay null. Not added now: service tier /
fast mode and server-side tool counts — no CLI reports them today; add when one does.

## 4. Approaches considered

1. Weighted enforcement in ccloop (weights in the envelope, live ceiling in equivalent tokens) — rejected by the human.
2. Orca-side weighted booking with raw live ceilings — rejected by the human.
3. **Record raw detail only (chosen).** No change to any budget semantics; a later price step reads the ledger.

## 5. Shape of the change

- **Wire (ccloop → Orca)**: `byModel` entries gain optional `reasoning`, `cacheWrite5m`, `cacheWrite1h`, `requests`,
  `maxRequestInput`. Both sides' `modelUsageSchema` are `.strict()`, so **Orca must accept the optional keys before
  ccloop emits them** (same repin carries both; Orca's acceptance lands first in the same release). Validation:
  `reasoning ≤ output`, `cacheWrite5m + cacheWrite1h ≤ cacheWrite` (≤, not =, so a provider reporting only one bucket is
  fine), `maxRequestInput ≤ input + cacheRead + cacheWrite`; violating values are dropped (field null) with the row still
  `reported` — the four reconciling parts are unaffected. `entryTotal` and reconciliation unchanged.
- **Cumulative vs delta**: usage events carry cumulative byModel; Orca books deltas (`bookUsageDelta`). Sub-parts are
  delta'd the same way; `requests` is delta'd; `maxRequestInput` is not additive — book the event's cumulative max and
  derive nothing from differences (a row's value means "max over the run so far at this event"; document it as such).
- **Storage (Orca)**: `usage_ledger` gains nullable columns for the §3 fields it lacks (schema migration, backup first
  per handoff §3.A). Existing rows: new columns null; no backfill guesses.
- **Readers**: `usageQuery.ts`, `usageLines.ts`, `web/src/UsagePanel.tsx`, `usageNotes.ts` show the split per model with
  "—" for null; totals unchanged. `orca usage --json` gains the fields (additive).
- **ccloop producers**: claude adapter (stream-json `usage` per assistant message: cache_creation buckets, requests, max
  input), codex (`reasoning_output_tokens`, already parsed), omp (whatever its usage carries; null otherwise).

## 6. Left to the builder

Exact column names and the migration number; whether `taskId` / `phase` / `installationId` go in columns or are joined
from `runs` at read time (columns preferred: a run's selection can be switched later); CLI table layout; how the Web
panel fits the extra columns on narrow screens.

## 7. Criteria (sketch)

Each new field: a producer test per adapter that reports it, a null test per adapter that does not, an Orca booking test
(delta, null propagation, bad sub-part dropped without touching the four parts), a migration test (old rows readable,
new columns null), and a guard that every budget/cap/ceiling comparison still uses `tokens` (mutation: switch one to a
sub-part ⇒ red). Wire order needs no runtime switch: Orca pins one exact ccloop commit, so the Orca commit that repins to
the emitting ccloop is the one that must already accept the keys (pinned by a real-ccloop test reading a byModel with
them).

## 8. Builder-check questions, settled by the controller (human: 「先按你的建议执行。执行完在最后阶段报给我审核」)

1. **Phase is a wire field.** ccloop's worker already emits one usage event per settled phase; the event gains an
   optional top-level `phase` (`plan|execute|verify|setup`, or absent for single calls), accepted by Orca in the same
   commit as the repin. Orca's ledger `phase` = that value for task runs, else the run's phase/purpose (clarify, split,
   estimate, review, handoff). Without it the column would only repeat `source`.
2. **Claude sub-parts only when the stream reconciles.** ccloop emits `reasoning` / `cacheWrite5m` / `cacheWrite1h` /
   `requests` / `maxRequestInput` for a claude model only when the streamed messages' four parts for that model equal
   the result envelope's `modelUsage` for it; otherwise those fields are absent (null). The `≤` checks in §5 remain
   Orca's sanity check, not the producer's licence to emit an undercount.
3. **`quality` keeps its three values and CHECK.** A new nullable column `basis` annotates how a non-measured row was
   booked: `remaining-grant`, `observed-floor`, `known-zero`, `soft-loop-floor`, `reconcile`, `integration`,
   `pre-ledger`. Measured rows and every old row: `basis` null. Readers keep treating non-`reported` as one bucket and
   may show `basis` as a sub-label. No table rebuild.
4. **A sub-part, once absent in a run, stays absent for the rest of that run** (per field, per model) — the same rule
   `byModel` already follows (`createByModelAccumulator`, Orca `baseline`). A partial sum that looks measured is the
   anti-goal.
5. **`maxRequestInput` is per phase, not run-so-far.** It is the largest single-request input among the requests of the
   phase that produced this event (not cumulative, not delta'd); `requests` stays cumulative and is delta'd. A later
   long-context price step then reads, per row, whether any request in that phase crossed a provider's threshold.
   §5's "Cumulative vs delta" paragraph is superseded on this point.

## 9. As built (Orca consumer half) — 2026-11-13, implementer seat `j-usage` of session `c8b75eac`, branch `j/usage` off `d382ebdf`

- **Schema 23 → 24** (`src/control/migrations.ts` `schema23To24` / `migrate23To24`): `usage_ledger` gains nullable `reasoning`,
  `cache_write_5m`, `cache_write_1h`, `requests`, `max_request_input` (each `CHECK(… IS NULL OR … >= 0)`), `phase` (CHECK: the
  nine §3 values), `task_id`, `agent_kind`, `installation_id`, `basis` (CHECK: the seven §8.3 values). One `ALTER TABLE … ADD
  COLUMN` per missing column (idempotent; no table rebuild; `quality` and its CHECK unchanged). The store's generic backup
  (`control.sqlite.pre-v23-<now>`, `VACUUM INTO`, mode 0600) precedes the step. Old rows: every new column NULL. The one
  exception: a store upgraded from before schema 8 gets its pre-ledger rows booked by that same upgrade, and those rows say
  `basis='pre-ledger'`; pre-ledger rows booked by an earlier upgrade stay NULL (§8.3 "every old row").
- **Booking** (`src/control/usageLedger.ts`): sub-parts and `requests` are delta'd against the baseline; a sub-part absent in
  the event, or in **any** earlier applied event of the run and bucket for that model, is NULL (§8.4); a model new in the event
  starts from 0. `maxRequestInput` is the event's own value (§8.5). The §5 bounds are checked on the event's cumulative **and**
  on the delta; a violating field (the 5m/1h pair together) is NULL, the row stays `reported`, the four parts are untouched.
  `breakdown-mismatch` rows carry no detail. `phase` (`ledgerPhase`): handoff bucket → `handoff`; estimate run → `estimate`;
  single call `clarify`/`split` → itself, `requirement-review`/`flow-review` → `review`, other purposes (flow-ask, flow-draft,
  no-change-judge, quota-probe, rerun-proposal) → NULL; a task work event → ccloop's event `phase` or NULL. `task_id` = the run's
  `taskId`; `installation_id` = the run's frozen `agent.agent`; **`agent_kind` is always NULL**: the frozen selection names the
  installation, not its CLI kind, and the kind is only known through ccloop's asynchronous `listAgents` (see the report's open
  question). `basis`: `remaining-grant` (settle-unknown-usage, single-call settlement), `known-zero` (passed, but a known-zero
  settlement charges 0 and so books no row), `observed-floor` (Orca's approximate single-call floor and an explicit
  `charge-observed-floor`), `soft-loop-floor` (softLoopSettlement), `reconcile`, `integration`, `pre-ledger`; measured rows NULL.
- **Readers**: `GET /api/control/usage` (`orca usage show`, JSON) — `range.byModel[]` gains the five detail fields (sum of rows;
  NULL as soon as one summed row lacks it; `maxRequestInput` the max, NULL likewise) and `range.byModelPhase[]` (same per model
  and phase; the unattributed bucket per phase with model NULL). Run view `usageDetail[]` (`runUsageDetail`, per model and
  phase from the run's rows) → `orca run show` lines; `orca group show` sums its runs' lines (rows booked to no run, i.e.
  integration, are not in any run: `orca usage show` has them). Web Usage panel: the model table gains the five columns,
  a "per model and phase" table follows, "—" for NULL, both inside the existing horizontal-scroll wrapper.
- **Guard**: every budget/cap/pause-line comparison still reads `tokens` / `group.used`; criterion in
  `tests/control/rawUsageDetail.test.ts` ("guard: …").
