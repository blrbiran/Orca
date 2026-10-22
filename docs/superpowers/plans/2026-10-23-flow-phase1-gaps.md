# Flow Phase 1 Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

- **Goal:** close the flow-engine phase-1 gaps — run-level feedback (locate by code, triage by model, a short clarify
  round for vague feedback), unsure re-run questions with a 300 s "accept as unchanged" timeout, step skip / defer /
  fill with held downstream effects, the `hints.equals` cutoff, an `image` param with preset defaults and a mid-run
  params change, revise of a flow clarify round, tool-given spend, and the project-settings heading.
- **Architecture:** everything is Orca code on the existing flow kernel (`src/flow/**`), one schema step (17 → 18, one
  new table `flow_feedback`), JSON-body additions elsewhere. Code locates, bounds and decides; the model only triages
  feedback, asks clarify questions and proposes skips / unsure marks (Rule 5, P7). No cross-repo change.
- **Tech:** TypeScript ESM, zod `.strict()`, `node:sqlite` STRICT tables, git plumbing in the vault, Express, vitest,
  React 19 (web).
- **Spec:** `docs/superpowers/specs/2026-10-22-flow-phase1-gaps-design.md` (cited "§n"; criteria "Gn"). Executors read
  the spec **and** this plan; the spec wins over the plan. Parent spec `docs/superpowers/specs/2026-10-22-flow-engine-design.md`
  ("F §n", incl. its §25 as-built corrections).
- **Author / anchors:** plan writer of session `0e13a9b7`, 2026-10-23, anchors re-measured on `main` at
  `3bc52044` (`grep -n`). The feedback-fix branch of the same session (`fix/tester-feedback-91-96`) lands on main
  first; **re-measure every anchor at the start of each task** and record moves in the ledger, not in this file.
- **Ledger:** `.superpowers/sdd/2026-10-23-session-0e13a9b7/progress.md` (append, lines prefixed `- gaps T<n>:`).
  Every criterion rewrite is a ledger line `file:line old → new, reason` and its commit body carries
  `Ruling: 这次批准改写所有必要的判据 (0e13a9b7)`.

## Corrections to the spec's as-built premises (measured at `3bc52044`)

The spec was written on `feat/flow-engine` at `075bd361`; the branch then took the enact fixes and merged. These change
what the spec assumed (the spec stays as published; this plan corrects by name, Rule 13):

1. **Base is `main`**, schema `"17"` (`src/control/migrations.ts:4`); this package adds step `"18"` (§0, §12).
2. **Built-in `wechat-article` is already version 2** (commit `abdb10be` "built-in v2: raster cover"). §8.5's
   "version 2" means **the next version: 3**. Keep v2's cover raster gate and `md2publish-diagram` pin.
3. **A proposed plan no longer holds the whole run:** since `5c0488ed` `passRun` settles running executions before
   `planOf` and a plan holds only *new starts* (`tests/flow/planHoldsNewStartsOnly.test.ts`). §3 row 2 is partly
   closed; §5's "what runs while a question is open" is built on that.
4. **`flow discard-plan`** exists (`b164bc26`, verb `flow-rerun` + `discard: true`); reuse its abandon path when a newer
   plan replaces an open one (§5.6).
5. **An effect step that changes no file settles with no files** (`cdb87df3`) and **an effect report with extra keys is
   applied** (`6c52480b`) — do not re-introduce strict effect reads.

## Global Constraints

- **Verification is `npm test`** (CLAUDE.md Rule 18; it runs typecheck and selects tests by change), with
  `ORCA_CCLOOP_BIN=/private/tmp/orca-b37f7ce9/ccloop-fbd3512/dist/cli.js`. Never `npm run verify`. Every run
  `> $LOGS/<task>-<n>.log 2>&1` then read the whole summary (Rule 14); `$LOGS=/private/tmp/orca-0e13a9b7/logs/gaps`.
  Copy "N selected" and every skipped file verbatim into the ledger (Rule 12). A red is your regression until a solo
  rerun and `docs/handoff/known-load-flakes.md` say otherwise.
- **Rule 9:** every criterion Gn in spec §17 lists its mutations; each named mutation must be made in a
  `git clone --local` copy of the branch tip under `/private/tmp/orca-0e13a9b7/` (node_modules symlinked) and seen red;
  restore proof = `git diff | wc -c` and `git diff --cached | wc -c` both `0`. Never mutate the worktree.
- **Rule 17:** every new out-of-repo path derives from passed env (`ORCA_CONTROL_DIR`), never `os.homedir()`; dirs
  `0700`, files `0600` set explicitly; existing files never re-moded. Criteria use temp `HOME` and every `ORCA_*`
  redirect (pattern: `tests/flow/outOfRepoWrites.test.ts`).
- **Frozen once released:** `loc1` (§4.3), reason `fill`, proposal `unsure`, param type `image`, `flow_feedback` states.
- **Copy:** every new refusal code has en and zh text (find the existing table by grepping `flow-plan-stale`); CLI help
  and docs regenerate with `npm run gen:cli-docs` whenever a registry row changes; Web follows `web/DESIGN.md`
  (tone only via `data-tone`, one primary button per view, sizes 14/18/22).
- **Never:** guess a location; run an external effect because of a timeout / default / model; let the model widen a
  plan; block the run on the person's feedback intake; show non-tool spend (0 for unknown, allocations, budgets);
  write an attachment into the person's folder or a vault commit (§2.3).
- **No paid runs** inside this plan; the paid `wechat-article` acceptance (§17 last paragraph) is Task 11 and only
  after everything else is merged.
- Commits: English conventional subjects, one deliverable each, ending with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A quote that occurs in both the pre-layout file and the layout file of the same writer** (e.g. two `.md` written
   by `article`) — must be `needs-location` (ambiguous), never the first. Owner: Task 1 (G1 "two files by one writer").
2. **The 300 s timeout firing while the panel was down** — the deadline passed during a restart; the next pass must
   resolve it as accept-unchanged exactly once (one minor decision, not two). Owner: Task 3: test
   `resolves an overdue pending question once after a restart` (advance the fake clock past the deadline, run
   `advanceFlowRuns` twice, assert one `rerun-unsure-timeout` decision and one carried-forward execution).
3. **Defer then fill twice in a row** (the person fills, the plan is still open, they defer again) — the newer mark
   wins; the open fill plan's step leaves the plan; no execution starts for a deferred step. Owner: Task 4: test
   `a defer after fill while the fill plan is open removes the step from the plan`.
4. **Feedback on a run whose reading file was deleted by the person in their folder** (drift) — locating uses the flow
   head, not the folder; drift is taken first as everywhere else. Owner: Task 5: test
   `locates against the flow head after drift removed the reading file from the folder`.
5. **An `image` param whose file is replaced by a non-image (same name, bytes are text)** at a `params` change —
   refused `flow-param-invalid:coverImage` by magic bytes, run params unchanged. Owner: Task 6: test
   `refuses a params change whose image file is not an image by its bytes`.

---

## Order and dependencies

Strictly serial, one implementer at a time (spec §18 order): T1 pure → T2 storage → T3 planner → T4 marks → T5 intake
→ T6 params → T7 clarify revise → T8 spend → T9 commands → T10 web → T11 install + acceptance. Each task ends with
`npm test` rc 0 on its branch tip and a ledger line.

Branch: `feat/flow-gaps` from `main` (after the feedback branch merged), worktree
`/private/tmp/orca-0e13a9b7/orca-gaps`, node_modules + web/node_modules symlinked to the main tree.

---

### Task 1: Pure core — anchors, `loc1`, `unsure` validation, reason `fill`, projections (§4.1, §4.3, §5.1, §6.4, §7; G1, G6 pure part)

**Files:**
- Create: `src/flow/feedback/anchors.ts`, `src/flow/feedback/locate.ts`, `src/flow/journal/projection.ts`
- Modify: `src/flow/journal/proposal.ts` (`validateProposal`), `src/flow/journal/candidates.ts` (reason order),
  `src/flow/rerun.ts:32` (`PROPOSAL_JSON_SCHEMA` gains `unsure`)
- Test: `tests/flow/feedbackLocate.test.ts` (new), `tests/flow/equalsProjection.test.ts` (new, pure cases),
  `tests/flow/rerunPlanner.test.ts` (extend for `unsure` validation and `fill`)

**Interfaces (Produces):**
- `type Anchor = { quote?: string; heading?: string; paragraph?: number }`
- `extractAnchors(text: string, given: readonly Anchor[]): Anchor[]` — §4.1 rules, dedupe, cap 5, text order.
- `norm(s: string): string` — §4.3 normalisation, exactly the fold table there.
- `interface SearchFile { path: string; text: string; writerIndex: number; writerKey: string }` (writerIndex = template
  order of the last writer).
- `interface Hit { file: string; paragraph: number; headingPath: string[]; excerpt: string }` (excerpt ≤ 120 chars,
  original bytes).
- `type LocateResult = { anchor: Anchor; located: Hit } | { anchor: Anchor; hits: Hit[]; more: number }`
- `locate(anchors: readonly Anchor[], files: readonly SearchFile[]): LocateResult[]` — the ladder of §4.3.
- `readingFile(files: readonly SearchFile[]): { file: SearchFile } | { ambiguous: string[] }`
- `projectionOf(spec: string, read: (path: string) => Buffer | null, verdict: string | null): string | null` —
  `verdict` / `headings(<path>)` / `json(<path>, <pointer>)` after `{{param.*}}` expansion by the caller; returns
  sha256 hex or `null` (§7).
- `validateProposal` result gains `unsure: Array<{ stepKey: string; question: string }>`; candidate reason union gains
  `"fill"` placed after `"feedback"`.

- [ ] **Step 1:** Write `feedbackLocate.test.ts` table-driven with every G1 case (spec §17 G1 row, verbatim cases) plus
  the `extractAnchors` cases: `「……」` ≥ 6 normalised chars ⇒ quote; `第三段`, `第十二段`, `paragraph 3`, `para 3` ⇒
  paragraph; a heading is never extracted from text.
- [ ] **Step 2:** Extend `rerunPlanner.test.ts`: `unsure` on a `feedback`/`fill`/`never-succeeded` candidate, overlapping
  `skips`, a non-candidate key, an empty or 201-char question ⇒ invalid; a valid `unsure` passes through; `fill` sorts
  after `feedback` and cannot be skipped. Write `equalsProjection.test.ts` pure cases for `projectionOf` (same headings
  different body ⇒ equal; changed heading ⇒ different; `json` pointer; missing file / bad JSON / missing pointer ⇒
  `null`).
- [ ] **Step 3:** Run `npx vitest run tests/flow/feedbackLocate.test.ts tests/flow/equalsProjection.test.ts tests/flow/rerunPlanner.test.ts > $LOGS/t1-red.log 2>&1` — expect failures for missing modules / fields.
- [ ] **Step 4:** Implement the functions above.
- [ ] **Step 5:** Same command ⇒ green; then `npm test` rc 0.
- [ ] **Step 6:** Mutations (clone): G1's five; G6 "hash the whole file instead of the headings"; `unsure` allowed on a
  feedback step. Each red. Ledger line.
- [ ] **Step 7:** Commit `feat(flow): locate feedback anchors, validate unsure proposals, project hints.equals`.

### Task 2: Storage — schema step 18, `flow_feedback` (§12; G13)

**Files:**
- Modify: `src/control/migrations.ts` (step `"18"`, `schemaVersion = "18"`), `src/flow/store.ts` (intake CRUD)
- Test: `tests/control/flowFeedbackMigration.test.ts` (new); every existing test pinning `schemaVersion "17"` (grep)
  is a criterion rewrite under the ruling.

**Interfaces (Produces):**
- `type IntakeState = "locating" | "needs-location" | "triaging" | "clarifying" | "restating" | "ready" | "planned" | "withdrawn" | "failed"`
- `insertIntake(store, row: { flowRunId: string; messageSeq: number; state: IntakeState; body: IntakeBody; at: number }): void`
- `moveIntake(store, flowRunId: string, messageSeq: number, from: IntakeState, to: IntakeState, body: IntakeBody, at: number): void`
  — CAS on `from`; forward-only order as listed above; the only backward edge `ready → needs-location`; `withdrawn`
  and `failed` reachable from any non-terminal state; otherwise throws `flow-intake-backward`.
- `getIntake(store, flowRunId, messageSeq): IntakeRow | null`, `listIntakes(store, flowRunId): IntakeRow[]`,
  `listRunsWithOpenWork(store): string[]` (runs `running`, or with an open intake, an open plan, or a pending question —
  one query over `flow_runs` ∪ `flow_feedback` ∪ `rerun_plans`; used by Task 3/5).
- `IntakeBody` is a zod `.strict()` object in `src/flow/feedback/intakeSchema.ts` with the fields §12 lists (anchors,
  searchSet, results, triage, restated, targets, planNo, flags, calls, reusedFrom).

- [ ] **Step 1:** Write `flowFeedbackMigration.test.ts`: table DDL checks (state CHECK, PK, FKs, STRICT); every
  pre-existing table's `sqlite_master.sql` byte-equal before/after; the backup file exists and precedes the step (the
  existing migration backup helper — find how step 17 tested it); `moveIntake` refuses backward except
  `ready → needs-location`.
- [ ] **Step 2:** Red run, implement, green, `npm test` rc 0 (fix the `"17"` pins as criterion rewrites, ledger each).
- [ ] **Step 3:** Mutations: skip the backup; allow any backward write. Red. Ledger.
- [ ] **Step 4:** Commit `feat(control): schema 18 adds flow_feedback intakes`.

### Task 3: Planner — pending questions, timeout, accept-unchanged, persistence fix, `auto` default, projection wiring (§5, §7 wiring; G3, G4, G6 kernel part)

**Files:**
- Modify: `src/flow/rerun.ts` (`journalOf` at `:49`, `makePlan` at `:143`, `planOf` at `:232`, proposal prompt
  `:98-126`), `src/flow/kernel.ts` (`passRun` `:757`, carry-forward `:806`, `ranOnInputsOf` `:721`, completion `:833`,
  `advanceFlowRuns` `:885` uses `listRunsWithOpenWork`), `src/flow/settingsSchema.ts` + `src/flow/settings.ts`
  (`flows.rerunAskTimeoutSeconds` 30–86400 default 300, not lockable; `rerunReview` built-in default `auto`),
  `src/flow/kinds/*` only where `done` computes `body.projection`
- Create: `src/flow/planStep.ts` — the `flow-plan-step` operation (the verb row comes in Task 9)
- Test: `tests/flow/rerunUnsure.test.ts`, `tests/flow/acceptUnchanged.test.ts` (new); `tests/flow/equalsProjection.test.ts`
  (kernel cases); existing tests that pin `rerunReview` default `review` are criterion rewrites.

**Interfaces:**
- Consumes: Task 1 `validateProposal(...).unsure`, `projectionOf`; Task 2 `listRunsWithOpenWork`.
- Produces: `planStep(deps: FlowDeps, input: { flowRunId: string; planNo: number; stepKey: string; choice: "run" | "accept-unchanged"; by: string; via: string }): { result: "flow-plan-step-applied" } ` throwing refusal `flow-plan-step-not-candidate` / `flow-plan-stale`;
  `chosen.pending: PendingItem[]` with `PendingItem = { stepKey; question; askedAt; deadline; answer: null | { choice; by; via; at; source: "person" | "timeout" | "carried"; fromPlan?: number } }`;
  `chosen.accepted: Array<{ stepKey; seq; by; via; at; source; ranOnInputs: RanOnInputs }>`;
  minor decisions `{kind: "rerun-skip", planNo, reason, source: "rerun-proposal"}` and
  `{kind: "rerun-unsure-timeout", planNo, stepKey, question, deadline}` through the existing `appendFlowDecision`.

- [ ] **Step 1:** Write G4's **persistence** red test first on the code as built: plan skip of `deslop`, then new feedback
  on the unrelated later `finetune` ⇒ the next plan must not propose `deslop`. Record red or green in the ledger; if
  green, drop the persistence fix (§5.5 last paragraph) and say so.
- [ ] **Step 2:** Write the rest of G3 and G4 (spec §17 rows, every case verbatim) plus Review Focus 2 test
  `resolves an overdue pending question once after a restart`, and G6's kernel cases (outline re-run with the same
  headings ⇒ `draft` not a candidate by `outline`).
- [ ] **Step 3:** Red run `> $LOGS/t3-red.log`.
- [ ] **Step 4:** Implement: proposal `unsure` → `pending` with `deadline = askedAt + resolved timeout` (resolved when
  asked); the hold bound of §5.4 (chosen steps before the first pending step and its `parallelWith` sibling run; later
  ones wait — reuse the "plan holds new starts" gate from `5c0488ed`); deadline check in `passRun` via `deps.now()`;
  accept per the §5.5 table; carried-forward executions record `ranOnInputs` (if Step 1 was red); `journalOf` uses the
  newest done-or-carried execution's `ranOnInputs` and the execution's `projection`; `ranOnInputsOf` records
  projections; `auto` default with one minor decision per model skip taken without a person ticking it; carry-over of pending items and
  accepts on a newer plan (§5.6) using the discard-plan abandon path.
- [ ] **Step 5:** Green; `npm test` rc 0.
- [ ] **Step 6:** Mutations: all of G3's and G4's, G6 "projection always null". Ledger.
- [ ] **Step 7:** Commit(s): `feat(flow): unsure re-run questions time out into accept-unchanged`,
  `feat(flow): hints.equals projections cut re-runs off` (split if the diff is large).

### Task 4: Step marks — skip, defer, fill, held effects (§6; G5)

**Files:**
- Create: `src/flow/marks.ts`
- Modify: `src/flow/messages.ts:46` (`COMMANDS` += `skip`, `defer`, `fill`), consume at boundary `:140-162`;
  `src/flow/kernel.ts` (marked = settled, held effect `parked` with `needsYou {kind: "deferred-upstream"}`, completion
  rule, `contextFor` pointer lines `:301`), `src/flow/journal/candidates.ts` (exclude marked, like `when`-false),
  `src/flow/vault/compose.ts` (suppress marked steps' active outputs), `src/flow/effects.ts` (`discardEffect` on
  skip/defer of an effect step), `src/flow/views.ts:45` (`needsYou` counts deferred steps and held effects)
- Test: `tests/flow/stepSkipDefer.test.ts` (new, wechat world fixture `tests/flow/fixtures/`)

**Interfaces:**
- Produces: `type Mark = { kind: "skip" | "defer"; messageSeq: number; effects: Record<string, "proceed" | "wait"> }`;
  `marksOf(messages: readonly FlowMessageRow[]): Map<string, Mark>` (pure, newest wins, `fill` removes);
  `heldEffectSteps(template, marks): Set<string>` (external/irreversible after a deferred step, not its `parallelWith`
  sibling, not released by `proceed`); refusals `flow-step-not-skippable`, `flow-step-not-marked`.
- Pointer copy (code-owned, exact): "`<step>`: skipped by the person — its output is not available; proceed without it"
  and "`<step>`: deferred by the person (to be filled later) — its output is not available yet; proceed without it".

- [ ] **Step 1:** Write G5 (spec §17 row, every case) + Review Focus 3 test
  `a defer after fill while the fill plan is open removes the step from the plan`.
- [ ] **Step 2:** Red, implement, green, `npm test` rc 0. The `proceed` socket tier is Task 9 — here test the kernel
  behaviour only.
- [ ] **Step 3:** Mutations: G5's list except the socket one (Task 9 owns it). Ledger.
- [ ] **Step 4:** Commit `feat(flow): skip, defer and fill a step; hold external effects after a deferral`.

### Task 5: Feedback intake — locate, triage, clarify round, replacement, rewind reuse, attachments (§4; G2, G14)

**Files:**
- Create: `src/flow/feedback/intake.ts` (state machine driver), `src/flow/feedback/triage.ts` (single call purpose
  `feedback-triage`, call key `{flowRunId, "@feedback", messageSeq}`), `src/flow/feedback/attachments.ts` (store
  `$ORCA_CONTROL_DIR/flow-attachments/<sha256>.<ext>`, magic bytes png/jpg/webp, ≤ 5 MiB, ≤ 4 per message),
  `src/flow/feedback/host.ts` (third `ClarifyHost`, caps `{rounds: 1, questions: 2, glossary: 0, adrs: 0}`)
- Modify: `src/flow/messages.ts:61` (run-targeted feedback opens an intake instead of `run-feedback-triage-not-built`),
  message schema fields of §4.1, `src/flow/kernel.ts` (new first stage in `passRun` advancing intakes for every
  non-stopped run; `ready ⇒ planned` at the boundary with re-verification), `src/flow/rewind.ts:56-61` (reuse intake;
  re-apply round edits as revisions), `src/control/clarifyHost.ts:15` (host type), `src/flow/kinds/work.ts` (copy
  attachments into `.orca/attachments/` before start), vault `info/exclude` gains `.orca/` (find where F §5.2 writes it,
  `tests/flow/vaultExcludes.test.ts`), `src/panel/*` route `POST /api/control/flows/:runId/attachments` (or verb
  `flow-attach` — decide by the verb-coverage test, ledger the choice)
- Test: `tests/flow/feedbackIntake.test.ts`, `tests/flow/attachments.test.ts` (new), `tests/flow/outOfRepoWrites.test.ts`
  (extend)

**Interfaces:**
- Consumes: Task 1 (`extractAnchors`, `locate`, `readingFile`), Task 2 (intake CRUD), Task 3 (`makePlan` trigger
  `feedback`), Task 4 (`marksOf` to exclude marked steps from `T`).
- Produces: `advanceIntakes(deps: FlowDeps, run: LoadedRun): Promise<boolean>`; `storeAttachment(env, bytes: Buffer): { sha256: string; ext: "png" | "jpg" | "webp" }`
  (refusal `flow-attachment-invalid`); refusals `flow-feedback-no-target`, `flow-feedback-already-applied`; intake flags
  `triage-defaulted`, `clarify-skipped`.
- Triage output schema exactly §4.4; triage prompt and clarify background text are new copy — ledger them for the
  human's diff review.

- [ ] **Step 1:** Write G2 (every case of the §17 row, including `done`-run and rewind cases, call counts asserted),
  G14 (attachments in workspace, absent from attempt commit / vault head / folder; modes; nothing under `HOME`) and
  Review Focus 4 test `locates against the flow head after drift removed the reading file from the folder`.
- [ ] **Step 2:** Red, implement, green, `npm test` rc 0. **Stop and report** if G14 is red with the real driver
  because `info/exclude` does not keep the file out (spec §4.7 last bullet) — do not invent the fallback.
- [ ] **Step 3:** Mutations: G2's and G14's lists. Ledger.
- [ ] **Step 4:** Commit(s) `feat(flow): run-level feedback intake with code location and model triage`,
  `feat(flow): screenshot attachments for feedback, kept out of commits`.

### Task 6: Params — `image` type, `paramDefaults`, `params` command, built-in v3 (§8; G8)

**Files:**
- Modify: `src/flow/template/schema.ts` (+ `image`), `src/flow/template/vars.ts` (`{{param.X}}` of an image ⇒
  `.orca/params/<id>.<ext>`), start path (`src/flow/flowCommands.ts` start + params identity `params_sha256` over bytes),
  `src/flow/settingsSchema.ts` (`flows.paramDefaults`, not lockable), `src/flow/messages.ts` (command `params`),
  `src/flow/kinds/work.ts` (copy into `.orca/params/`), `flows/builtin/wechat-article/template.yaml` (version **3**,
  `coverImage: {type: image, required: false}`, `hints.owns` labels per §8.5), `src/flow/builtins.ts` sha seed
- Test: `tests/flow/coverParam.test.ts` (new), `tests/flow/wechatBuiltin.test.ts` (rewrite version 2 → 3, owns labels —
  criterion rewrite under the ruling)

**Interfaces:** Consumes Task 5 `storeAttachment` for the content-addressed store; Task 3 `makePlan` trigger `params`.
Produces resolved param value `{ source: string; sha256: string; ext: string }` on the run; refusal
`flow-param-invalid:<id>` reused.

- [ ] **Step 1:** Write G8 (every case) + Review Focus 5 test
  `refuses a params change whose image file is not an image by its bytes`.
- [ ] **Step 2:** Red, implement, green, `npm test` rc 0.
- [ ] **Step 3:** Mutations: G8's list. Ledger (incl. the new built-in sha256 and that the person reviews the template
  diff — F §22).
- [ ] **Step 4:** Commit `feat(flow): image params with preset defaults and a mid-run params change; wechat-article v3`.

### Task 7: Revise a flow clarify round (§9; G7)

**Files:** Modify `src/flow/messages.ts:52` (stop refusing target `round`), `src/flow/kinds/clarify.ts` (in-progress
and done paths, shared `clarifyChain.ts`), `src/flow/kernel.ts` (head moves only at consensus; plan trigger `edit`).
Test: `tests/flow/flowClarifyRevise.test.ts` (new); C7's golden must stay byte-equal (find it by grepping the
`clarifyHost` golden test).

**Interfaces:** Produces refusals `flow-round-not-revisable`; reuses `revision-unchanged`.

- [ ] **Step 1:** Write G7 (every case). Red.
- [ ] **Step 2:** Implement, green, `npm test` rc 0.
- [ ] **Step 3:** Mutations: G7's list. Ledger.
- [ ] **Step 4:** Commit `feat(flow): revise an earlier round of a flow clarify step`.

### Task 8: Spend — tool-given tokens per execution, child group, step, intake, plan, run (§10; G9)

**Files:** Create `src/flow/spend.ts`; modify `src/flow/calls.ts` / `src/flow/kernel.ts:928` (keep `{runId, purpose}`
in the execution's / plan's / intake's `calls` list before `callResult` is deleted), `src/flow/childPort.ts` (reuse the
child sum, export it), `src/flow/views.ts` (read fields). Test: `tests/flow/flowSpend.test.ts` (new).

**Interfaces:** Produces
`type Spend = { tokens: number | null; unknownReason: string | null; usd: null; usdReason: "the tool reports no money amount"; runs: Array<{ runId: string; purpose: string; tokens: number | null }> }`
and `sumSpend(parts: readonly Spend[]): Spend` (known part + `"partial: n runs unknown"`). A tool `0` is unknown.

- [ ] **Step 1:** Write G9 (every case). Red. **Step 2:** implement, green, `npm test` rc 0. **Step 3:** G9 mutations.
  **Step 4:** Commit `feat(flow): show tool-reported spend per execution, step, plan and run`.

### Task 9: Commands, access, refusal copy, CLI docs (§13; G10)

**Files:** `src/commands/domains/flow.ts` (rows of §13: `feedback` with `--quote/--heading/--paragraph/--attach/--replaces/--hit/--as-is`,
`answer --feedback`, `include`, `accept`, `skip`, `defer --effects`, `fill`, `params --set`, `revise`, settings keys),
`src/panel/humanOnly.ts` (`VERB_ACCESS["flow-plan-step"] = "human-only"`; `SOCKET_TIER["flow-plan-step"]` predicate
`run ⇒ token`, `accept-unchanged ⇒ open`; `SOCKET_TIER["flow-message"]` predicate `defer` with any `proceed` ⇒ `token`
else `open`; no `HUMAN_ONLY_FIELDS` entry for `flow-message`), `src/panel/permissions.ts` (socket and dispatched-run
checks consult a predicate on an `any` verb: `token` ⇒ needs the person token, refused for a dispatched run), control
verb `flow-plan-step` wiring to Task 3's `planStep`, refusal text en/zh, `npm run gen:cli-docs` (docs/cli.md,
skills/orca-control/references/flow.md). Tests: `tests/control/flowVerbAccess.test.ts`, `tests/panel/accessMatrix.test.ts`,
`tests/entry/skill.test.ts` (extend; G10).

- [ ] **Step 1:** Write G10 (every case) + the G5 socket mutation's test (`proceed` from a socket agent without token
  refused). Red. **Step 2:** implement, gen docs, green, `npm test` rc 0. **Step 3:** G10 mutations + G5's socket one.
  **Step 4:** Commit `feat(flow): commands and access for feedback, plan steps, marks, params and revise`.

### Task 10: Web — run page surfaces, start form image picker, settings fields, project settings heading (§14, §11; G11, G12)

**Files:** `web/src/FlowRunPage.tsx` (run-level feedback box with anchors + attachments + "use my words as they are";
intake cards; plan pending questions with countdown "keeps the current output at HH:MM" and **Run it** / **Accept as
unchanged**; step actions Skip / Defer (dialog only when a downstream external/irreversible step exists) / Fill; held
effect cards "Push now without <step>" / "Wait"; "Set `<param>` instead"; clarify revise reusing the Requirements
revise UI; spend "not available (<reason>)", money "not available — the tool reports none", note "tool-reported, not an
estimate"), the flow start form (image picker bounded to 200 files + effective default with source),
`web/src/FlowSettings.tsx` (two new fields with source and lock state), `web/src/ProjectSettings.tsx` (heading
"Project settings — <name>" / 「项目设置 — <项目名>」, path muted under it; `dir` project resolves to its name — find the
label path from `web/src/App.tsx` `repoLabel`), i18n strings en/zh. Tests: `web/tests/projectSettings.test.tsx` (new),
`web/tests/flowRunPage.test.tsx` (extend).

- [ ] **Step 1:** Reproduce §11 first: a render test with a repository project and a `dir` project; record what the
  heading shows today (ledger). **Step 2:** Write G11 and G12 (every case). Red. **Step 3:** implement per
  `web/DESIGN.md`; green; `npm test` rc 0 (includes web). **Step 4:** G11/G12 mutations. **Step 5:** Commit
  `feat(web): flow run page for feedback intakes, plan questions, marks, params and spend; name the project in settings`.

### Task 11: Merge, install, paid acceptance

- [ ] **Step 1:** Whole-branch review (one fresh reviewer, spec + this plan + diff `main..feat/flow-gaps`); fix Critical
  and Important; rerun `npm test` rc 0.
- [ ] **Step 2:** Rebase on `main`, `npm test` rc 0, `git merge --ff-only` into `main` (Rule 15 allows `--ff-only`).
- [ ] **Step 3:** Install into the panel service: back up the control DB (`~/.orca/backups/schema17-to-18-<ms>/`, copy
  `control.sqlite*` with the panel stopped or via `sqlite3 ".backup"` on `file:…?mode=ro`), `npm run build` + web build
  in the main tree, restart the service (`orca panel` service commands; find them in `docs/cli.md`), `orca status`
  shows schema 18.
- [ ] **Step 4:** Paid acceptance (authorised this round as "必要的付费真跑"; keep it minimal): on a sandbox copy
  (pattern `/private/tmp/orca-b37f7ce9/wechat-acceptance/run-panel-accept*.sh`, temp `HOME` and every `ORCA_*`
  redirect), one `wechat-article` v3 run that (a) defers `cover` with a preset `coverImage` default, (b) takes one
  quote-anchored run-level feedback, (c) **stops before any draft-box enact** (no WeChat write: the human asked not to
  manage the draft further). Record tool-reported tokens only.
- [ ] **Step 5:** As-built section appended to the spec (`## 21. As built`, corrections by name), ledger closed.

## Criteria files expected to change (ledger each line; all under the round's ruling)

- tests pinning `schemaVersion "17"` (Task 2); tests pinning the built-in `rerunReview` default `review` (Task 3);
  `tests/flow/messages.test.ts` cases asserting `run-feedback-triage-not-built` and round-target refusal (Tasks 5, 7);
  `tests/flow/wechatBuiltin.test.ts` version / params / owns (Task 6); access matrix rows (Task 9); `docs/cli.md` and
  `skills/orca-control/references/flow.md` (generated).

## Out-of-repo writes

Only `$ORCA_CONTROL_DIR/flow-attachments/` (Tasks 5, 6), as registered in spec §16. Workspace-internal `.orca/` copies
are excluded from commits. Nothing new under the person's folder.
