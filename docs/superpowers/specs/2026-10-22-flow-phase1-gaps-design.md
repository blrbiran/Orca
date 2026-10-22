# Flow engine phase 1, the gaps: feedback on a run, re-run questions, skip and defer, cover, spend — design

- **Status:** design only. Written 2026-10-22 by a spec-writer subagent of Orca session `b37f7ce9`; not committed by
  the writer (the controller commits).
- **Extends:** `docs/superpowers/specs/2026-10-22-flow-engine-design.md` ("F §n"). F is published; nothing in it is
  edited. Where this spec changes what F says, §15 lists it as an amendment (Rule 13).
- **Intent:** the human's brainstorm answers and the approved playback, ledger
  `.superpowers/sdd/2026-10-22-session-b37f7ce9/progress.md` lines 267–277 (cited `progress.md:<line>`).
- **Closes** the phase-1 gaps the flow implementers registered as NOT DONE (`progress.md:201`, `:206`, `:228`):
  run-level feedback triage, the "accept as unchanged" verb, revise on a flow clarify step, step-level pause (closed by
  dropping it, §6.5), the `hints.equals` cutoff, per-child spend. Plus the human-reported settings-page bug (§11).
- **Base:** this package is built **on `feat/flow-engine`**, not on `main`. There the control DB schema is `"17"`
  (`src/control/migrations.ts:4`) and this package adds step 18; `main` is still at schema 15 and gets 16–18 when the
  branch merges.
- **Anchors** (Rule 14): first measured with `cat -n` / `grep -n` on `feat/flow-engine` at `047da7ee`, then
  **re-measured at `075bd361`** in the read-only worktree `/private/tmp/orca-b37f7ce9/orca-flow`. Between the two only
  `src/flow/kinds/clarify.ts` and `src/flow/template/checklist.ts` changed (`git diff --stat 047da7ee 075bd361`);
  clarify.ts anchors below are the `075bd361` ones. `web/src/ProjectSettings.tsx` has the same text on `main` at
  `ea7ee89d`. Line numbers must be re-measured before a plan cites them.
- **Marks.** "(controller's call)" = decided by the session controller, either in the playback the human approved
  (`progress.md:277`) or in its answers to the builder check of this spec (marked "(controller's call, builder
  check)"); reversible. "(writer's call)" = decided by this writer under CLAUDE.md Rule 1 step 2, reversible.
  Everything else is a human ruling (§1) or follows from one.

---

## 0. Scope

One package of work on top of the flow kernel as built on `feat/flow-engine`. All of it is Orca code plus the built-in
template `wechat-article` (an Orca file). **No cross-repo change is required** (§16). Mobile entry is out of scope for
this phase but nothing here assumes a desktop (§2.2).

| # | Topic | Section |
|---|---|---|
| A | Feedback on a whole run or a passage: locate by code, triage by model, a short clarify round for vague feedback | §4 |
| B | Re-run scope: the model may mark a candidate "unsure"; the person is asked; 300 s timeout ⇒ accept as unchanged | §5 |
| C | Step skip, defer-then-fill, the effect-after-defer prompt; no step-level pause | §6 |
| D | `hints.equals` projection cutoff | §7 |
| E | Cover: an image param with a preset default from settings; change params mid-run | §8 |
| F | Revise an earlier round of a flow clarify step | §9 |
| G | Spend per execution, per child group, per step, per run — tool-given only | §10 |
| H | Project settings page names its project | §11 |

---

## 1. Human rulings implemented here (verbatim)

| # | Ruling (verbatim) | Source |
|---|---|---|
| R1 | feedback style: 「我一般会指出具体的哪一段给我的感觉，比如太啰唆、太AI话、需要去AI味等等。如果整篇都给我感觉不对劲或者我说不上来具体原因但是不满意也会给出比较模糊的感觉」 | `progress.md:267` |
| R2 | vague: 「我说不上来的情况下，我希望模型能先帮我理清思路，再往下做」 | `:267` |
| R3 | reading place: 「最大概率是公众号的预览功能推送到独立手机，在手机微信里」 | `:267` |
| R4 | phone input: 「最好在手机上就能直接发。但是现在 orca还没考虑手机端的问题，所以只能在电脑上发，但是这个影响不大」 | `:267` |
| R5 | rerun scope: 「默认应该只重跑真正受影响的」 | `:267` |
| R6 | uncertain step: 「可以在早期阶段问人，如果人迟迟不响应（超时）的话可以按默认不做处理」 | `:267` |
| R7 | timeout scope (only uncertain-rerun questions; external effects still wait): 「同意」 | `:267` |
| R8 | timeout: 「5分钟…这个时间可以调整」 | `:267` |
| R9 | while waiting: 「后面不受影响的步骤应该往下跑。前提是不依赖受影响的这一步」 | `:267` |
| R10 | UI issue: 「当前项目设置至少在 web UI 端并不知道是针对哪个项目的」 | `:268` |
| R11 | step-level: 「有可能会想bypass其中某一步，或者这一步临时跳过之后补」 | `:269` |
| R12 | no separate step pause: 「同意，但是后续dogfooding后可能会推翻」 | `:269` |
| R13 | downstream of a deferred step: 「排版可以先排一个无图的版本」 | `:269` |
| R14 | external effect downstream of a deferred step: 「可以在人选先跳过时弹出来让人选。人没选的话，可以先等着不推草稿，人决定先推的话再推。」; on the image key: 「生成图可以先跳过。」 | `:275` |
| R15 | cover: 「作为标准流程可以让人选一个封面或设定一个预设的默认封面。」 | `:276` |
| R16 | the full playback below: 「同意，继续」 | `:277` |

**The playback the human approved (R16), verbatim:**

1. 对 run 提意见三种：指一段（引原句/小标题/第几段，代码在 md 里定位；多处或找不到就回问，不猜）；整篇模糊感觉 ⇒ 先一轮很短的澄清（1–2 问，grilling 式），整理成具体意见再走重跑，可随时「直接改」跳过；截图可作附件给模型看，定位只靠文字（控制器的猜测）。本期只在电脑 Orca 网页提交，手机入口以后加，设计不做死。
2. 重跑范围：代码划出受影响候选，模型只能提议跳过（P7）；拿不准的步骤在开跑前问人，默认等 5 分钟（设置可改，项目>全局），超时 ⇒ 不重做、保留现有产出、记次要决定 —— 即「接受为未变」，人也可主动点；等待期间不依赖它的后续步骤照常跑；对外动作不受此超时影响，一直等确认。
3. 单步：只做「跳过」和「先跳过、之后补」，不做单步暂停（dogfooding 后可能推翻）；被临时跳过的步骤下游普通步骤先缺着它跑（如排版先排无图版）；下游是对外动作时，在人选「先跳过」当场问要不要先推，人没选就先不推。
4. 封面：标准流程可不生图，让人选一张封面或用预设默认封面。
5. 流程里澄清步的修订（控制器的决定）：沿用开发流程「修订前面某一轮」(requirement-revise semantics)，修订后按受影响范围重算下游。
6. 花费（控制器的决定）：每步、每子组显示工具给出的 token 数，拿不到美元就写拿不到。
7. 附带：Web 项目设置页不显示是哪个项目 ⇒ bug，一起修。

Items 1 (the screenshot part), 5 and 6 are marked (controller's call) wherever they are used.

Design principles applied (`docs/handoff/goal.md` §2): P2 (one wait parks only itself and what depends on it), P3 (the
person may object, revise, take back at any time), P5 (model choices nobody looked at become minor decisions), P6 (Web
and the agent path both complete each act), P7 (code bounds, the model only proposes, the person decides; spend only as
the tool reports it).

---

## 2. Goals, non-goals, anti-goals

### 2.1 Goals

1. A person can give feedback on a **run** (not only on a step): pointing at a passage by quote, heading or paragraph
   number, or about the whole article; with screenshots attached.
2. Code locates a pointed passage in the run's Markdown; when it is not exactly one place, Orca asks back.
3. Vague whole-article feedback gets one short grilling-style clarify round (≤ 2 questions) before anything re-runs; the
   person can skip it at any time ("use my words as they are").
4. A re-run plan runs what is certainly affected without waiting; only steps the model is unsure about become a
   question; the question times out after a configurable 300 s into "accept as unchanged".
5. The person can skip a step, or defer it and fill it in later; ordinary downstream steps run without it; a downstream
   external effect waits unless the person says to proceed.
6. The standard WeChat flow can run without image generation: the person picks a cover, or a preset default cover from
   settings applies.
7. An earlier round of a flow's clarify step can be revised; the downstream re-plan follows.
8. Each execution, child group, step and run shows tokens as the tool gave them; money shows "not available" when the
   tool gives none.
9. The project settings page says which project it is for.

### 2.2 Non-goals (this phase)

- A phone entry (R4). The feedback payload is channel-agnostic (§4.1, `via` records the channel), so a phone channel
  adds a route, not a model change.
- Step-level pause/resume (R12). Run pause plus skip/defer suffices until dogfooding says otherwise.
- Read sets (F §7.2). Dependency stays **template order + `parallelWith`** as built (§5.4); what may run while a
  question is open is bounded by it.
- Fuzzy matching of quotes, OCR of screenshots, image understanding for locating.
- A WeChat-specific UI in the run page: every surface here is generic (driven by template data).

### 2.3 Anti-goals (must never happen; each has a criterion in §17)

- **Never guess a location.** Zero or several hits ⇒ ask back; never pick the first hit (G1).
- **Never run an external effect because of a timeout, a default, or a model's say-so.** The 300 s timeout applies only
  to unsure re-run questions and only ever resolves to *not* re-running (G3, G5).
- **Never let the model widen a plan.** The model may propose skips and mark candidates unsure; it cannot add a step,
  reorder, or skip a step with feedback or a `fill` request (G3).
- **Never block the run on the person's own feedback intake** (locating, triage, clarify): only that intake waits (G2).
- **Never report spend that is not the tool's number**: no estimate, no allocation, no 0 for "unknown" (G9).
- **Never write an attachment into the person's folder or a vault commit** (G14).

---

## 3. As built today (the gaps, measured at `047da7ee`)

| Gap | Where it shows |
|---|---|
| Run-level feedback is stored `rejected` | `src/flow/messages.ts:61` `flow-message-target-missing:run-feedback-triage-not-built` |
| A proposed plan holds the **whole run** until the person chooses (under `rerunReview: review`, the built-in default) | `src/flow/rerun.ts:236-237` (`"wait"`), `src/flow/kernel.ts:761-763` |
| `acceptedUnchanged` exists in the pure planner but nothing feeds it | `src/flow/journal/candidates.ts:52-53, 106`; `rerun.ts:77-79` passes no such field |
| A plan-skipped step's carried-forward execution records no `ranOnInputs`; the head stays the older execution whose inputs are older, so the **next** plan proposes the same step again | `kernel.ts:805-813` (carry-forward), `rerun.ts:49-60` (`journalOf` reads the head) — writer's reading; the builder confirms with a red test first (§17 G4) |
| `hints.equals` projection is always null | `rerun.ts:56` (`projection: null`), `kernel.ts:728` |
| A failed step stops the run at that step; no person verb lets it continue without the step | `kernel.ts:782` |
| Commands are `pause, resume, stop, retry, rewind, repin` only | `messages.ts:46` |
| Flow clarify: answer and consensus only; no revise | `src/flow/kinds/clarify.ts:198-251` (at `075bd361`); F §10.1 promised it |
| The pump passes only `running` runs; a run whose steps are all settled turns `done` | `kernel.ts:866` (`listFlowRunIds(deps.store, "running")`), `kernel.ts:756` (`passRun` returns when the run is not `running`), `kernel.ts:832` |
| Rewind re-queues later feedback as a new message and re-applies only edits that produced an execution; a clarify-round edit has none and is dropped | `src/flow/rewind.ts:56-58` (feedback), `:59-61` (edits found by `edit.message`) |
| Spend: the run read has `poolTokens`/`poolDrawn` only; a settled call's run id is deleted from the execution body | `src/flow/views.ts:80`; `kernel.ts:907-908`; child spend is computed in `src/flow/childPort.ts:134` and only used to return the unspent allocation (`kernel.ts:851`) |
| Project settings: the project's name is in a body line ("Defaults for {{project}}…"), not in the heading; whether the label resolves for a `dir` project is unverified | `web/src/ProjectSettings.tsx:25,29`; label from `web/src/App.tsx:1020-1024` |
| `coverImage` is a workspace-relative `path` param; no settings default for params; no params change mid-run | `flows/builtin/wechat-article/template.yaml` (`params.coverImage`, step `cover.when`); F §7.1 promises "a params change" makes a plan, no command exists |

---

## 4. Feedback on a run (A)

### 4.1 The message

`flow-message` kind `feedback` gains optional fields; the target may now be `run`:

```ts
{ text: string,                                   // required, as today
  anchors?: Array<{ quote?: string; heading?: string; paragraph?: number }>,  // ≤ 5; each has ≥ 1 field
  attachments?: string[],                         // sha256 ids from the attachment store (§4.7), ≤ 4
  replaces?: number,                              // the message seq this one replaces (§4.8)
  asIs?: boolean,                                 // skip the vague-feedback clarify round (§4.6)
  hit?: number }                                  // with `replaces`: pick hit k of the replaced intake's hit list
```

Code also extracts anchors from `text` (pure, `src/flow/feedback/anchors.ts`, writer's call on the path): text inside
「」『』“”"" whose normalised form (§4.3) has ≥ 6 characters is a `quote`; `第N段` (N in Arabic digits or Chinese
numerals 一…九十九) and `paragraph N` / `para N` are a `paragraph`; nothing else is parsed (headings only from the
field). Extracted anchors are added to the given ones, deduplicated, capped at 5 in text order.

Feedback with no anchor targeting a **step** behaves exactly as today. Everything else opens an **intake** (§4.2).

### 4.2 The intake (state machine, code)

One intake per such message, row in `flow_feedback` (§12). States move forward only:

```
locating ─▶ needs-location ─▶ (replaced: the message becomes `excluded`, a new message opens a new intake)
   │
   ├─▶ triaging ─▶ clarifying ─▶ restating ─▶ ready ─▶ planned
   │       └───────────────────────────────▶ ready
   (restating = the second triage call, with the Q&A or `asIs`)
   └─▶ ready            (step-targeted, located: no triage)
any state ─▶ withdrawn  (replaced or the run stopped)  ·  failed (a code error; the message stays visible, red)
```

- The intake works **while steps run**: locating is code, triage and clarify are single calls on the parent's pool.
  Only the intake waits for the person (needs-location, clarifying); the run does not (anti-goal 4).
- `ready ⇒ planned` happens at the next whole-run boundary (`consumeAtBoundary`, `messages.ts:101`): the message is
  consumed like step feedback today — `feedback[target] += [text with location]` for each target — and one plan is made
  (`makePlan`, trigger `feedback`). Before planning, code **re-verifies** each located anchor against the current flow
  head; one that no longer locates exactly once sends the intake back to `needs-location` (a new state row write,
  state still forward: `ready ⇒ needs-location` is allowed only through re-verification, writer's call).
- The message row stays `accepted` until `planned` (⇒ `applied`) or `withdrawn` (⇒ `excluded`); no new message state.

**Feedback on a `done` run (controller's call, builder check).** The run **stays `done`** while its intake locates,
triages or clarifies; it becomes `running` only when the intake's plan is made (as `makePlan` does today,
`rerun.ts:168-169`). Kernel changes:

- `advanceFlowRuns` (`kernel.ts:866`) passes every run that is `running` **or** has an open intake (state not
  `planned`/`withdrawn`/`failed`), an open plan, or a pending question (§5); `listFlowRunIds` gains that filter (one
  query over `flow_runs` ∪ `flow_feedback` ∪ `rerun_plans`).
- `passRun`'s early return (`kernel.ts:755-756`, "not `running` ⇒ return false") moves **after** a new first stage that
  advances intakes (calls out, results judged, `ready ⇒ planned` at the boundary) for any run that is not `stopped`; a
  `paused` run advances intakes too (they spend only single calls on the person's request) but plans nothing until
  resume.
- Completion (`kernel.ts:832`): a run turns `done` only when every step is settled **and** no intake is open in
  `locating`/`triaging`/`restating`/`ready`, no plan is open and no step is held (§6.3). An intake in `needs-location`
  or `clarifying` does not keep the run from `done` (it waits on the person, not on Orca) but **counts toward
  `needsYou`** (`views.ts:45` gains intakes in those two states), so the board shows the run under needs-you.

**Rewind (controller's call, builder check).** Rewind (F §8.3, `rewind.ts`) re-queues later feedback as a new
`accepted` message with `reappliedFrom` (`rewind.ts:56-58`). For a message that had an intake, the re-queued message
**reuses the stored intake** — its located anchors (re-verified against the new head, §4.2) and its triage targets and
`restated` text — and makes **no new triage or clarify call**; the new intake row starts at `ready` with
`body.reusedFrom = <old seq>`. A re-verification miss sends it to `needs-location` as usual. Clarify-round revisions
(§9, edits targeting `round`) are re-applied **as round revisions** on the clarify step's newest execution, not
dropped (today `rewind.ts:59-61` looks only for executions carrying `edit.message`, which a round edit never has); a
revision that no longer applies (its round is not on the new active chain) becomes feedback text on that step, flagged
red, as F §8.3 does for edits.

### 4.3 Locating algorithm `loc1` (code, pure, frozen once released)

Input: the anchors; the **search set**; the flow head commit (read from the vault, `refs/orca/<run>/head`). Output per
anchor: `located {file, paragraph, headingPath, excerpt}` or `hits[]` (0 or ≥ 2).

**Search set.** Markdown files (`*.md`) that some step's **active** output changed (union of each active commit's
changed paths, F §5.3), each tagged with its **last writer** = the latest step in template order whose active output
changed it. For a step-targeted feedback: only the files that step's active output changed. Files the person imported
and no step touched are not searched (writer's call: they are the person's notes, a frequent false hit).

**Blocks and paragraphs.** Per file: strip YAML front matter (first line `---` to the next `---`); drop HTML comments
(md2publish's metadata comment); a fenced code block (``` or ~~~) is one block; an ATX heading line (`#{1,6} `) is its
own block; otherwise blocks are separated by blank lines. A **paragraph** is a block that is not a heading, not a
thematic break, not an image-only line. Paragraphs are numbered from 1 in document order; under a heading anchor,
numbered from 1 within that heading's section (to the next heading of the same or higher level).

**Normalisation `norm()`.** NFKC; then a fixed fold table for CJK punctuation (`。→.` `、，→,` `：→:` `；→;` `！→!`
`？→?` `“”「」『』→"` `‘’→'` `（）→()` `【】→[]` `——→-` `…→...`); remove inline Markdown (`*`, `_`, `~~`, backticks,
`[text](url) → text`, `![alt](url) → ""`, HTML tags, a leading `>` and list markers); remove **all** whitespace (the
phone rendering adds and drops spaces between CJK and Latin); lower-case Latin. Bytes of the original are kept for the
excerpt.

**Match ladder, per anchor** (stop at the first rung that has any hit):

1. **Exact quote:** the quote is a substring of a paragraph's raw text. A quote containing `…` or `...` is split there;
   all parts must occur in order inside one paragraph.
2. **Normalised quote:** `norm(quote)` (with the same split) is a substring of `norm(paragraph)`. A normalised quote
   shorter than 6 characters is not a quote (it would match everywhere) and the anchor falls to the next rungs.
3. **Heading:** `norm(heading)` equals `norm()` of exactly one heading's text; the located unit is that section.
4. **Paragraph ordinal:** paragraph N of the **reading file** (below), or of the heading's section when a heading is
   also given.

Hits are counted **per paragraph** (two occurrences in one paragraph are one hit). Across files: keep the hits in the
files whose last writer is latest in template order (the most derived version, which is what the person reads: e.g.
`<slug>.illustrated.md` over `<slug>.wechat.md` over `<slug>.md`). Exactly one hit ⇒ `located`. Zero hits, or ≥ 2
(including two files with the same last writer) ⇒ the intake goes `needs-location` with the hits (each `{file,
paragraph, headingPath, excerpt ≤ 120 chars}`, at most 5; "more not shown: n").

**Reading file** (for ordinals and whole-article feedback): the search set's file with the latest last writer; if that
writer changed several `.md` files, ordinals are ambiguous ⇒ `needs-location` listing them.

An ordinal-only anchor locates deterministically; the run page shows the located excerpt next to the feedback so a
miscount is visible at once and can be replaced (§4.8). It is not "asking back" because it is not a guess (writer's
call; reversible: make ordinal-only anchors always confirm).

### 4.4 Triage: which step takes the feedback (model classifies, code bounds — Rule 5, P7)

Runs for run-targeted intakes (step-targeted ones skip it). One single call, purpose `feedback-triage` (new, on the
parent group like `rerun-proposal`; call key `{flowRunId, "@feedback", messageSeq}`).

- **Candidates `T` (code):** steps of kind `work` or `draft` with an active `done` output, at or before the **last
  writer** of the located file(s) (anchored) or of the reading file (whole-article), in template order, minus steps
  marked skip/defer (§6). Empty `T` ⇒ intake `failed` with `flow-feedback-no-target` (visible, red).
- **Input:** the text; each located anchor's excerpt with ±1 paragraph of context (≤ 2 KB each); for whole-article,
  the reading file bounded to 32 KB with the cut recorded; `T` with step id, kind, skill names and `hints.owns` labels;
  the Q&A of the clarify round if one ran; attachment **names** only (§4.7).
- **Output schema** `{targets: [{stepKey, why}] (1–3), clarity?: "concrete" | "vague", restated?: string}`.
  Code validates: every `stepKey ∈ T`; no duplicates; `clarity: "vague"` allowed **only** on a whole-article intake's
  first triage with `asIs` false; `restated` required when a clarify round ran. Invalid ⇒ the single call's retry
  path; exhausted ⇒ **code default**: the last writer alone, intake flagged `triage-defaulted`.
- `vague` ⇒ `clarifying` (§4.6); otherwise ⇒ `ready` with `targets`.
- The person sees the targets and their `why` on the run page and can change them by replacing (§4.8). Nothing waits
  for that (P2): the plan proceeds; a replacement abandons the plan as F §7 already does for a newer plan.

### 4.5 Feedback text in the step's prompt

Each target's revision prompt gets, code-built: the person's text; for each located anchor "in `<file>`, paragraph N
under «heading path»: «excerpt»"; the restated feedback and the clarify Q&A when present; the attachment paths (§4.7).
This replaces nothing in the existing feedback path (`body.feedback` strings, `kernel.ts:798`).

### 4.6 The vague-feedback clarify round (reuses the clarify machinery)

- **Host:** a third `ClarifyHost` (`src/control/clarifyHost.ts:15`), the **feedback host**: rounds stored in
  `requirement_rounds` at key `(parentGroupId, "@feedback", messageSeq)` (the re-keyed table, F §10.1; `exec_seq > 0`
  holds since message seqs start at 1); call purpose `clarify`; the shared output classifier; background = "the person
  is not satisfied with the article as a whole but cannot say exactly why; ask at most two short questions, grilling
  style, each with a recommended answer, that turn the feeling into concrete, actionable feedback"; context = the
  original text, the reading file bounded to 32 KB, attachment names; sections `[What feels wrong, Where, What it should
  become]`.
- **Caps (code):** the host supplies caps `{rounds: 1, questions: 2, glossary: 0, adrs: 0}`; the requirement and flow
  step hosts keep `CLARIFY_CAPS` (`src/control/requirementSchemas.ts:43`) and **C7's golden prompt bytes are
  unchanged** (F §10.1). A third question, any glossary or ADR item ⇒ invalid ⇒ retry path. Round cap 1, so no
  `clarify-more`. At most 3 calls per intake: triage, clarify round, triage.
- **Answer:** through the existing flow clarify answer (verb `flow-answer`, payload `{feedback: messageSeq, roundNo,
  answers}`) or consensus (unanswered ⇒ recommended answers taken, as F §10.2 level 3). Then the second triage runs
  with the Q&A and must return `concrete` with `restated`.
- **Skip at any time ("直接改"):** a replacement with `asIs: true` (§4.8): the round is closed, the second triage runs
  on the original text and may not answer `vague`.
- **No timeout:** this is the person's own request (R7 scopes the timeout to unsure re-run questions); it waits
  without blocking the run.
- A clarify call that fails or is exhausted ⇒ the intake continues as `asIs`, flagged `clarify-skipped`.

### 4.7 Attachments (controller's call: screenshots shown to the model; locating is text only)

- **Store:** content-addressed files `$ORCA_CONTROL_DIR/flow-attachments/<sha256>.<png|jpg|webp>` (Rule 17, §16),
  accepted by magic bytes only, ≤ 5 MiB each, ≤ 4 per message. Upload route `POST /api/control/flows/:runId/attachments`
  (raw body) returns `{sha256}`; the CLI's `--attach <file>` uses the same route. Access as `flow-message` (`any`).
- **Who sees them:** only the `work` executions that take the feedback (§4.5). Code copies each attachment into the
  child's attempt workspace at `.orca/attachments/<sha256>.<ext>` before the agent starts, a path listed in the vault's
  `info/exclude` (shared by every worktree of the vault, F §5.2), so `commitAttempt`'s `git add -A` never commits it and
  copy-back never sees it. The prompt names those paths. Single calls (triage, clarify) get names only.
- If the builder finds the exclude path does not keep the file out of the attempt commit with the real driver (G14
  red), the builder stops and reports; the fallback (absolute paths outside the workspace) needs a ccloop read-access
  question and is not decided here.

### 4.8 Replacing an intake

A feedback message with `replaces: m` (same run, `m` an intake not yet `planned`, or `planned` whose plan is still
open) sets intake `m` to `withdrawn` and message `m` to `excluded` (`applied → excluded` already exists,
`progress.md:200`) and opens a new intake. Uses: pick a hit (`hit: k` ⇒ the new message's anchors are hit k's exact
location), sharpen the anchor, retarget (`--step` targets the step directly), or `asIs`. A replacement of an intake
whose plan already ran is refused `flow-feedback-already-applied`: send new feedback instead (P3: it re-plans).

---

## 5. Re-run scope: unsure steps, the question, the timeout, accept as unchanged (B)

### 5.1 The proposal may mark candidates unsure

`PROPOSAL_JSON_SCHEMA` (`rerun.ts:32-38`) and `validateProposal` (`src/flow/journal/proposal.ts`) gain
`unsure?: [{stepKey, question}]`. Code validates (P7): every key ∈ candidates; disjoint from `skips`; **not** a step with
`feedback` or `fill` among its reasons; **not** `never-succeeded` (there is no output to keep); `question` 1–200 chars.
Anything else ⇒ invalid ⇒ the existing retry path; exhausted ⇒ no proposal (every candidate runs, nothing unsure).

**Who decides "uncertain" (precise):** a candidate is unsure **iff** the validated proposal lists it under `unsure`.
A candidate the model neither skips nor marks unsure **runs** (today's rule). Absence is never uncertainty, so a
silent model cannot turn steps into timeouts that skip them (writer's call; the reversed reading was rejected because a
timeout resolves to *not* re-running, which would let an empty answer skip work without a stated reason).

The proposal prompt (`rerun.ts:98-126`) gains one instruction: mark `unsure` only when the step's output might or might
not change and the person would know; give one short question the person can answer with "run it" or "keep it".

### 5.2 Settling a proposal

`flows.rerunReview` keeps its two values; **the built-in default becomes `auto`** (writer's call, reversible: under the
old default `review` every feedback waited on a full checklist, which contradicts R5, R6 and R9).

| Mode | Sure skips | Unsure | Everything else |
|---|---|---|---|
| `auto` (new default) and every `orca-auto` plan | taken; **each one a minor decision** `{kind: "rerun-skip", planNo, reason, source: "rerun-proposal"}` (extends today's unattended-only rule, `rerun.ts:200-204`, to every plan nobody ticked) | **pending question** with a deadline | runs at once |
| `review` | proposed, unticked | shown ticked, with the question, **no deadline** | the plan waits for the person, as today |

`chosen = candidates − skips − pending`, in template order; pending steps live in the plan's `chosen.pending`
(`[{stepKey, question, askedAt, deadline, answer: null | {choice, by, via, at, source: "person" | "timeout"}}]`), JSON in
`rerun_plans.chosen` (mutable column, no schema change).

### 5.3 The timeout

- **Setting** `flows.rerunAskTimeoutSeconds`: integer 30–86400, built-in default **300**, project > global (F §11.2
  pattern, read with `{value, source, lockedBy}`); **not lockable** (not a security field). Written with the existing
  `set-flow-settings` (human-only).
- `deadline = askedAt + timeout` with the value resolved **when asked**; changing the setting later moves no existing
  deadline (writer's call).
- **Clock:** the kernel's pass (`passRun`) compares `deps.now()` with each pending deadline. The panel pump calls
  `advanceFlowRuns` on its interval (`src/panel/controlAssembly.ts:367`, `:296`), which passes every `running` run; a
  paused run's deadlines are checked on its next pass after resume (the question did not reach anyone meanwhile either).
- **At the deadline:** the answer is `{choice: "accept-unchanged", by: "orca-auto", via: "orca", source: "timeout"}`,
  applied exactly as the person's accept (§5.5), plus one minor decision `{kind: "rerun-unsure-timeout", planNo,
  stepKey, question, deadline}` (P5: the person can correct it by feedback).
- **Scope (R7, anti-goal 2):** only `chosen.pending` items time out. Effect confirm cards, staged effect records, held
  effects (§6.3), `ask` steps, `needs-person` executions, feedback intakes and clarify rounds never do. An unsure item on
  an effect-classed step that times out means **not re-running** the effect; choosing "run" on it still goes through
  its level gate (F §9.2).

### 5.4 What runs while a question is open (R9, with phase-1 dependency)

Dependency in phase 1 is what the kernel already uses: a step depends on **every earlier step in template order except
its `parallelWith` sibling** (`basisOf`, `kernel.ts:656-659`; `ranOnInputsOf`, `kernel.ts:721-731`; no read sets, F
§7.2). Therefore, while plan `n` has pending items:

- chosen steps **before** the first pending step in template order run normally;
- a chosen `parallelWith` sibling of a pending step runs;
- every chosen or carried-forward step **after** the first pending step waits (it depends on the pending step), and
  the run shows "waiting for your answer on <step> (keeps current output at <time>)";
- other runs and other groups are untouched (P2).

The page and `orca flow show` say this bound plainly: "steps after it depend on it in this template". Read sets (a later
ccloop spec, F §16.2) would widen it; nothing here assumes them.

### 5.5 Accept as unchanged (the verb)

**Meaning:** "the output this step has now stands for the new inputs, and counts as unchanged for every later step".
One verb, two cases decided by code:

| Step's position in the open plan | Effect |
|---|---|
| pending, or chosen and not yet executed under the plan | not run; a carried-forward `skipped` execution (as `kernel.ts:805-813`) with `body.acceptedUnchanged = {by, via, source}`; removed from `chosen.steps`/`pending` |
| executed under the plan (it has a new output) | its new output is fed to the planner as unchanged (`WorkspaceState.acceptedUnchanged`, `candidates.ts:52-53`), so the cutoff (`rerun.ts:241-257`) drops later chosen steps whose only reason was it |
| not in the plan, or no open plan | refused `flow-plan-step-not-candidate` |

Recorded in `rerun_plans.chosen.accepted: [{stepKey, seq, by, via, at, source}]`, and as a `command` message
`{command: "accept-unchanged", planNo, stepKey}` (audit). Per F §7.5 steps only leave a plan; accept never adds one.

**Persistence fix (writer's call, required for the verb to mean anything).** A carried-forward execution (a plan skip,
an accept, a timeout) records `ranOnInputs` as of the carry-forward, and the planner's `journalOf` uses, for each step,
the newest `done` **or carried-forward** execution's `ranOnInputs` (the output hash stays the head's). Without this the
next plan proposes the same step again (§3). The builder first writes the red test (G4) on the code as built; if it is
already green, this part is dropped and the drop recorded.

**The other choice, "run":** a pending item answered `run` joins `chosen.steps` with its candidate reasons.

### 5.6 A newer plan replaces an open one (controller's call, builder check)

`makePlan` abandons an open plan (`rerun.ts:162`) and already carries its unrun feedback (`rerun.ts:150-154`). In
addition:

- **Pending questions carry over:** a step still pending in the abandoned plan that is again a candidate and again
  marked `unsure` (or not skipped) in the new proposal is pending in the new plan with a **fresh deadline** (`now +
  timeout`), and the question text of the new proposal; the abandoned plan's item keeps its record (no answer).
- **Accept decisions carry over** — person or timeout, and a person's `run` choice — for each step whose **inputs did
  not change** since the decision: code compares the step's `ranOnInputsOf` at decision time (stored on the `accepted`
  item) with now. Equal ⇒ the decision applies to the new plan (recorded `source: "carried", fromPlan: n`) and the step
  is neither re-asked nor run for that reason; different ⇒ the decision is dropped and the step is planned afresh.
- Criteria: G3 (a new feedback during a pending question ⇒ the item is pending in plan n+1, deadline reset) and G4
  (accept in plan n, then new feedback on an unrelated later step ⇒ plan n+1 does not re-propose the accepted step;
  new feedback on an earlier step ⇒ it does).

Both answers are the verb `flow-plan-step {runId, planNo, stepKey, choice: "run" | "accept-unchanged"}` (§13).

---

## 6. Skip, defer, fill (C)

### 6.1 Commands

Three new `flow-message` commands on a step (consumed at a boundary like every command, `messages.ts:140-162`):

| Command | Meaning |
|---|---|
| `skip {stepKey}` | the step does not run in this run (now, or in any later plan) until `fill`; its active output, if any, is **suppressed** in the composition while the mark stands (§6.2) |
| `defer {stepKey, effects?: {<effectStepKey>: "proceed" \| "wait"}}` | like skip, and the step is **owed**: it shows as a needs-you item "fill when ready" and holds downstream external effects (§6.3) |
| `fill {stepKey}` | removes the mark; a plan is made (trigger `fill`) in which the step is a candidate with reason `fill` |

- Allowed on kinds `work`, `draft`, `check`, `review`, including effect-classed `work` steps (R14: 「生成图可以先跳过」 —
  `cover`/`visuals` are `cost`-classed). Refused on `clarify` (use consensus, or the run param `clarify: skip`) and
  `ask` (answer it, or its default applies) ⇒ `flow-step-not-skippable`. `fill` on an unmarked step ⇒
  `flow-step-not-marked`. A repeated `skip`/`defer` replaces the mark (the newest wins; this is also how `effects`
  choices change later).
- On an effect-classed step, `skip`/`defer` closes its open effect record, if any (`staged` or a confirm card), as
  `discarded` through `discardEffect` (`src/flow/effects.ts`), recorded `by` the person; `fill` gates afresh (a new
  record, F §9.2).
- The step's newest execution, whatever its state (`failed`, `needs-person`, `parked`, `queued`), is followed by a
  `skipped` execution with `body.mark = {kind, messageSeq}`; this is what lets a run stopped at a failed step
  (`kernel.ts:782`) continue — T18's failed `cover` (`progress.md:273`) is the motivating case.
- **Mark state** is derived by a pure function from the applied `skip`/`defer`/`fill` messages (append-only, Rule 13);
  `flow_runs.body` caches nothing.

### 6.2 Effect on dependents (R13)

- The kernel treats a marked step as settled whatever its basis (it never auto-runs it), and never as a blocker.
- The planner excludes marked steps from candidates (like `when`-false steps, `candidates.ts:73`).
- **Later steps never see a marked step's output, old or new** (R13 「排版可以先排一个无图的版本」: the layout is made
  without the images, not with last time's). Mechanism: while the mark stands, the step's active output is
  **suppressed** — `step_heads` is not moved (rewind and history stay intact), but the composition (F §5.3,
  `compositionFor` / `activeOutputs` in `src/flow/vault/compose.ts`) and the prompt pointers skip every step whose
  derived mark is `skip` or `defer`, exactly as they skip a step with no head. The flow head is recomposed and copied
  back at the next boundary, so the person's folder also loses the suppressed output's files (copy-back deletes only
  files still equal to the previous head's blob, F §5.4, so nothing the person edited is lost). `fill` lifts the
  suppression; the step then re-runs under the fill plan (§6.4), so its old output never comes back by itself.
  `ranOnInputsOf` records a suppressed step as `outputHash: null`, so later steps that ran without it become
  candidates (`upstream-changed:<step>`) when it is filled.
- Every later step's prompt pointers (`contextFor` pointers, `kernel.ts:310-330`) get a code-owned line instead:
  "`<step>`: skipped by the person — its output is not available; proceed without it" or "`<step>`: deferred by the
  person (to be filled later) — its output is not available yet; proceed without it". So `article` lays out the text
  without illustrations (R13).
- Completion and needs-you: a run whose only unsettled steps are **deferred** (nothing held) ends `done`, and the read's
  `needsYou` counts each deferred step (`views.ts:45` today counts `needs-person`/`parked` only), so the board shows it
  under needs-you (the T16 column rule, `progress.md:227`). Skip leaves no needs-you item. **While a downstream
  effect is held (§6.3) the run is not `done`**: it stays `running` with `needsYou ≥ 1` (R14
  「人没选的话，可以先等着不推草稿」).

### 6.3 The effect-after-defer prompt (R14)

- **Which steps:** effect-classed steps of class `external` or `irreversible` **after** the deferred step in template
  order (not its `parallelWith` sibling). `cost` and `local` steps proceed as ordinary steps (writer's call: R14 names
  pushing the draft; cost has the budget backstop, H35).
- **When asked:** at the moment the person defers. Web: the defer dialog lists each such step with two choices,
  preselected **wait**. CLI/agent: `--effects proceed|wait` per step; absent ⇒ `wait`, and the command's result names
  the held steps and the command that releases them.
- **Held:** when the kernel reaches a held step it writes a `parked` execution with `needsYou = {kind:
  "deferred-upstream", deferred: [stepKey…]}` (parks only it and the steps after it, F §8.2). A `parked` execution is
  unsettled, so the run stays `running` (completion rule, §4.2) with `needsYou ≥ 1`. Released by (a) a newer
  `defer` with `proceed` for it ⇒ it starts as a pool-raise restart does today, then its own level gate applies, or (b)
  the deferred step being filled and the resulting plan reaching it.
- `proceed` needs the person token on the socket, like `flow-effect` (§13): a **`SOCKET_TIER` predicate** on
  `flow-message` (the pattern of `set-check-settings`, `src/panel/humanOnly.ts:146`) returns `token` when the payload
  is a `defer` command whose `effects` contains any `proceed`, else `open`. It is **not** a `HUMAN_ONLY_FIELDS` entry
  (`flow-message` stays `any`). Today `SOCKET_TIER` is documented as the tier of each human-only entry
  (`humanOnly.ts` comment above the table); the builder makes the socket and dispatched-run checks (`permissions.ts`)
  consult a `SOCKET_TIER` predicate on an `any` verb too: `token` ⇒ needs the person token on the socket and is refused
  for a run Orca dispatched. `wait` is open.

### 6.4 Fill

`fill` ⇒ `makePlan(trigger "fill")` where the filled step is a candidate with reason **`fill`** (new reason, after
`feedback` in the fixed order; the model may not skip it or mark it unsure, like `feedback`). Its later steps become
candidates by the ordinary rule (`upstream-changed:<step>` because it is re-running, `candidates.ts:104-105`), so the
proposal, unsure questions and the timeout apply. A held effect step then runs under the plan (it is
`never-succeeded`).

### 6.5 Step-level pause: dropped (R12)

F §8.1 ("pause/resume a step") and F §14.2 (`orca flow pause|resume … [--step s]`) are amended: `pause`/`resume` are
run-level only, as built. Recorded so dogfooding can reopen it.

---

## 7. `hints.equals` cutoff (D)

- When an execution ends `done` and its step has `hints.equals`, code computes the projection (closed set, F §3.2):
  `verdict` (a review record's verdict); `headings(<path>)` (the ordered ATX heading lines of `<path>` at the output
  commit, each `level + norm(text)`); `json(<path>, <pointer>)` (RFC 6901 value, canonical JSON). `{{param.*}}` expands
  first. Stored as `body.projection = sha256(bytes)`; missing file, bad JSON or a missing pointer ⇒ `null` (no cutoff,
  never an error).
- `ranOnInputsOf` (`kernel.ts:726-729`) records each earlier active output's projection; `journalOf` (`rerun.ts:56`)
  passes the execution's projection. The pure planner already compares them (`candidates.ts:111-112`).
- The built-in's `outline` (`hints.equals: headings(<slug>.outline.md)`) is the first user: an outline re-run that
  keeps its headings no longer makes `draft` and later steps candidates by itself.

---

## 8. Cover: pick one or use a preset (E)

### 8.1 A new param type `image`

`orca-flow-v1` param types (F §3.2) gain `image` (additive; F §3.4 freezes names, not the closed set before release):
a file path whose extension is `png|jpg|jpeg|gif|webp`, ≤ 20 MiB, that exists when the run starts.

**Always a copy (controller's call, builder check).** Whether the value is the person's pick or a preset, code never
hands a step the original path:

1. At start, and at each `params` change (§8.3), code reads the file once, stores the bytes content-addressed in the
   run's file store `$ORCA_CONTROL_DIR/flow-attachments/<sha256>.<ext>` (the §4.7 store, same modes and rules), and
   records the param's resolved value as `{source: <path as given>, sha256, ext}` in the run.
2. The **params identity** (`params_sha256`) uses the **bytes' hash**, not the path, so a different image (even at the
   same path, applied by a `params` change) makes dependants candidates (`upstream-changed:params`), and an unchanged
   image under a new path does not.
3. Before each `work` execution of the run, code copies each `image` param into the attempt workspace at
   `.orca/params/<paramId>.<ext>` — the same excluded `.orca/` path as attachments (§4.7: vault `info/exclude`, never
   committed, never copied back).
4. `{{param.<id>}}` of an `image` param expands to that workspace-relative copy path (`.orca/params/coverImage.png`)
   in prompts; in check commands too. The skill only ever sees a path inside its own workspace.

Where the value may come from:

- A value given at **start** or by a **params change** must be folder-relative (no `..`), like `path`.
- An **absolute** value is accepted only from the settings layer (§8.2), which only the person writes (human-only,
  token) — so no agent can make a run upload an arbitrary image from the disk (writer's call).
- Orca only **reads** the original file, once per start or change (§16).

### 8.2 Preset defaults for params

Settings field `flows.paramDefaults: {<templateId>: {<paramId>: value}}`, project > global, not lockable, read per
entry with `{value, source, lockedBy}`. At start: given value > project default > global default > template default.
Validated against the template's param type at write time when the template is a built-in, else at start
(`flow-param-invalid:<id>`). Generic for every template param (P4), cover being the first use:
`orca flow settings set paramDefaults.wechat-article.coverImage /Users/…/default-cover.png --global`.

### 8.3 Params change mid-run

New `flow-message` command `params {set: {<paramId>: value}}` (F §7.1 already says a params change makes a plan; F
§8.1 lists no such command — amended, §15). Validated as at start; the run's params and `params_sha256` move
(`flow_runs` row and body, one transaction); `when` is re-evaluated; a plan is made (trigger `params`).
With `coverImage` set, `cover` is `when`-false and is recorded `skipped` (never a candidate, F §7.2); `to-draft-box`
is a candidate (`upstream-changed:params`).

### 8.4 Web: generic, not WeChat-specific

- **Start form:** an `image` param renders a picker of image files in the chosen folder (code lists them, bounded to
  200, excludes applied) plus a path field, and shows the effective default with its source ("default: … (global)").
- **On a failed or deferred step whose `when` reads a param** (derived by code from the `when` predicate), the run page
  offers "set `<param>` instead", sending the `params` command. T18's case: `cover` failed for lack of an image key ⇒
  "set coverImage instead".
- **Settings:** `paramDefaults` entries for the built-in templates' params, with a path field for `image` params.

### 8.5 Built-in `wechat-article` version 2

`params.coverImage` becomes `{type: image, required: false}`; `hints.owns` labels for triage (§4.4) on `outline`
(结构, 提纲), `draft` (内容, 论证, 啰嗦), `deslop` (AI 味, 套路句式), `voice` (语气, 口语, 生硬), `finetune` (公众号风格, 标题);
the run page's existing cover text stays. Prompt and label texts are reviewed by the human as a diff (F §22). The
`to-draft-box` prompt already passes `{{param.coverImage}}` explicitly (`prompts/to-draft-box.md`); with §8.1 that is
the workspace copy `.orca/params/coverImage.<ext>`, so md2publish-draft uploads a file inside its own workspace and no
assumption about paths outside it is needed.

---

## 9. Revise an earlier round of a flow clarify step (F) — controller's call

Semantics are `requirement-revise`'s (F §10.3), on the flow host:

- **Message:** `flow-message` kind `edit`, target `round {stepKey, roundNo}`, body `{answers, glossaryDecisions,
  adrDecisions, reason?, exclude?}` (F §10.1 already names this; `shapeRefusal` stops refusing `round`,
  `messages.ts:52`). Access `any`, like `requirement-revise`.
- **Allowed** when the round is on the active chain of the step's **active or newest** execution and `answered`, and
  the payload differs (else `revision-unchanged`); otherwise `flow-round-not-revisable`.
- **In progress** (the newest execution is `needs-person`): append round row `n+1` `{revises: k, …}` to that execution's
  key; re-advance exactly as F §10.3 (`clarifyChain.ts` shared): next round drafted if the chain is below the cap, with
  superseded answers as recommended answers unless excluded. At most one clarify call.
- **Done** (the step's active output is the document): append execution `seq+1` of the clarify step; code copies the
  active chain's rows of the active execution into the new key `(group, stepKey, seq+1)` (new rows; none changed), the
  revised round written as the revision row; re-advance there. The step's active output stays the old document until
  the new execution reaches consensus; then the head moves and the ordinary plan follows (trigger `edit`), so
  downstream is re-planned with the proposal, unsure questions and the timeout (§5).
- Web: the flow run page's clarify panel reuses the Requirements revise UI from `211aa0db` (Revise on answered chain
  rounds, prefilled form, "costs one clarify call").

---

## 10. Spend (G) — controller's call; only the tool's numbers (P7, Rule 14)

- **Source of truth:** the `runs` rows the driver keeps. A single call's tokens = `runs.body.cumulative.work.tokens`
  (booked from ccloop's usage, `src/flow/calls.ts:156-163`); a child group's tokens = the sum over its runs, as
  `childPort.ts:134` already computes.
- **Keep the run ids:** every call request appends `{runId, purpose}` to the execution body's `calls` list (and the
  plan's / intake's for `@plan` / `@feedback` calls), so `completeFlowCall`'s deletion of `callResult`
  (`kernel.ts:907-908`) loses nothing. Work executions already keep `child_group_id`.
- **Read fields** (computed at read time, nothing new stored):
  `spend = {tokens: number | null, unknownReason: string | null, usd: null, usdReason: "the tool reports no money amount", runs: [{runId, purpose, tokens | null}]}`
  on each execution, on each step (sum of its executions), on each intake and plan, and on the run (sum of all of them).
  `tokens` is `null` with a reason when any summed run has unknown usage (`usageUnknown`, or a tool-given `0`/`None`,
  goal.md P7); a sum over a mix shows the known part and `"partial: n runs unknown"`. **Allocations, pool draws and
  budgets are never shown as spend.**
- Image providers: no amount is reported to Orca ⇒ nothing shown beyond the tokens.
- If ccloop later reports a money amount, that is ccloop's spec (Rule 16); `usd` then fills from it.

---

## 11. Project settings page names its project (H, R10)

Measured: the page heading is the bare "Project settings" (`ProjectSettings.tsx:25`); the project's label is only in a
body sentence (`:29`); the label comes from `repoLabel` (`App.tsx:1020-1024`), whose resolution for a `dir` project
was not exercised by any test the writer found. The builder **reproduces first** (a render with a repository project
and with a `dir` project; systematic debugging), then fixes:

- the `<h2>` reads "Project settings — <project name>" (zh 「项目设置 — <项目名>」) and its accessible name includes the
  project name; under it, the project's path (repository or folder) in muted text;
- a `dir` project resolves to its project name, never to a raw id;
- each embedded section (workspace, integration, checks, flows) keeps its heading; `FlowSettings` in project scope
  shows "for <project name>" in its region label.

---

## 12. Data model

**Schema step 18 on `feat/flow-engine`** (the next after `"17"` there, `src/control/migrations.ts:4` at `075bd361`;
`main` is at 15 and receives 16–18 with the branch; if another step lands on the branch first, the next one).
One control-DB backup precedes it, as every step. One new table, STRICT:

```sql
CREATE TABLE IF NOT EXISTS flow_feedback(
  flow_run_id TEXT NOT NULL REFERENCES flow_runs(id), message_seq INTEGER NOT NULL CHECK(message_seq > 0),
  state TEXT NOT NULL CHECK(state IN ('locating','needs-location','triaging','clarifying','restating','ready','planned','withdrawn','failed')),
  body TEXT NOT NULL,            -- anchors, search set, located/hits, triage calls and result, restated, targets, planNo, flags
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(flow_run_id, message_seq),
  FOREIGN KEY(flow_run_id, message_seq) REFERENCES flow_messages(flow_run_id, seq)) STRICT;
```

State moves forward only, enforced in `src/flow/store.ts` as for the other flow tables; the one backward edge is
`ready → needs-location` on re-verification (§4.2), enforced by name.

No other DDL change. JSON-body additions (no migration): message body fields (§4.1); `rerun_plans.proposal.unsure`,
`rerun_plans.chosen.{pending, accepted}` (accepted items carry the step's `ranOnInputs` at decision time, §5.6);
execution body `mark`, `acceptedUnchanged`, `projection`, `calls`, `ranOnInputs` on carried-forward executions;
`ranOnInputs.earlier[].projection` becomes non-null, and a suppressed step records `outputHash: null` (§6.2);
`flow_feedback.body.reusedFrom` (§4.2 rewind); the run's resolved `image` params `{source, sha256, ext}` (§8.1);
settings bodies gain `flows.rerunAskTimeoutSeconds`, `flows.paramDefaults`. `requirement_rounds` gains rows at
`step_key = '@feedback'`.

Candidate reasons (frozen list, F §18) gain `fill`. Proposal output gains `unsure`. Template format gains param type
`image`. These are the additions F §18's stability table must list.

---

## 13. Commands and access (CLI v2 registry rows, `VERB_ACCESS`, socket tiers)

Today's tiers: `VERB_ACCESS` `any | human-only` and `SOCKET_TIER` `open | token` (`src/panel/humanOnly.ts`); a run Orca
dispatched is refused every human-only entry (`permissions.ts`) and `DISPATCHED_RUN_REFUSED` verbs. Every new row gets
a registry row in `src/commands/domains/flow.ts` (the verb-coverage test forces it) and `npm run gen:cli-docs`.

| Command | Verb | `VERB_ACCESS` | Socket tier | Dispatched run |
|---|---|---|---|---|
| `orca flow feedback <run> [--step s] [--quote q]… [--heading h] [--paragraph n] [--attach f]… --text t` | `flow-message` (feedback) | `any` | — | allowed (as today) |
| `orca flow feedback <run> --replaces m [--hit k \| --quote … \| --step s \| --as-is] --text t` | `flow-message` (feedback) | `any` | — | allowed |
| `orca flow answer <run> --feedback m (--file f \| --consensus)` | `flow-answer` | `human-only` (as built) | `token` (as built) | refused |
| `orca flow include <run> --step s [--plan n]` | `flow-plan-step` `{choice: run}` | `human-only` | `token` (spends, like `flow-rerun`) | refused |
| `orca flow accept <run> --step s [--plan n]` | `flow-plan-step` `{choice: accept-unchanged}` | `human-only` | `open` (does what the timeout would do) | refused |
| `orca flow skip <run> --step s` | `flow-message` (command `skip`) | `any` | — | allowed |
| `orca flow defer <run> --step s [--effects <step>=proceed\|wait]…` | `flow-message` (command `defer`) | `any` (no `HUMAN_ONLY_FIELDS` entry) | `SOCKET_TIER["flow-message"]` predicate: `token` when a `defer`'s `effects` contains `proceed`, else `open` (as `set-check-settings`, `humanOnly.ts:146`) | `proceed` refused |
| `orca flow fill <run> --step s` | `flow-message` (command `fill`) | `any` (spends, like `retry` today) | — | allowed |
| `orca flow params <run> --set k=v…` | `flow-message` (command `params`) | `any` (as `flow-start` params) | — | allowed (values folder-relative only) |
| `orca flow revise <run> --step s --round k --file f` | `flow-message` (edit, target round) | `any` (as `requirement-revise`) | — | allowed |
| `orca flow settings set rerunAskTimeoutSeconds <n> [--global]` | `set-flow-settings` | `human-only` (as built) | `token` (as built) | refused |
| `orca flow settings set paramDefaults.<template>.<param> <value> [--global]` | `set-flow-settings` | `human-only` | `token` | refused |
| `orca flow show|journal` | reads (gain intakes, pending questions, marks, held effects, spend) | — | — | — |

- `flow-plan-step` is a new verb (writer's call on the name; one verb with two choices keeps the Web checklist and the
  CLI on one path). Its `SOCKET_TIER` entry is a predicate on `choice`, as `set-check-settings` is.
- `flow-message` stays `any`; its new `SOCKET_TIER` predicate (above) is the first on an `any` verb, so the socket and
  dispatched-run checks (`permissions.ts`) are extended to consult it (§6.3).
- New refusal codes (en/zh): `flow-feedback-no-target`, `flow-feedback-already-applied`, `flow-attachment-invalid`,
  `flow-plan-step-not-candidate`, `flow-step-not-skippable`, `flow-step-not-marked`, `flow-round-not-revisable`.
  Existing `flow-plan-stale`, `flow-param-invalid`, `revision-unchanged` are reused.
- The attachment upload route (§4.7) is a write outside the command ledger (content-addressed, idempotent); if the
  verb-coverage test requires every write route to be a verb, the builder adds `flow-attach` (`any`) instead.

---

## 14. Web surfaces (P6)

Run page (`web/src/FlowRunPage.tsx`):

1. **Run-level feedback box** (the run-level box T16 withheld, `progress.md:227`): text, optional quote / heading /
   paragraph fields, image attachments (≤ 4), a checkbox "use my words as they are" (`asIs`). Step and execution boxes
   gain the same anchor fields.
2. **Intake cards**, one per open intake: state; located excerpt(s); for `needs-location` the hit list with "this one"
   (⇒ replace with `hit`) and "rewrite"; for `clarifying` the clarify round form (the existing component) with "use my
   words as they are"; triage targets with their `why`, flags (`triage-defaulted`, `clarify-skipped`) and "change
   target"; spend.
3. **Plan**: pending questions with the question, a countdown "keeps the current output at HH:MM", buttons **Run it** /
   **Accept as unchanged**; on executed rows **Accept as unchanged**; accepted rows labelled with source (you / timeout);
   the line "steps after it depend on it in this template" while anything is pending.
4. **Step actions**: Skip, Defer (dialog with the held-effect choices, §6.3, shown only when such a step exists), Fill;
   marked steps badged; held effect cards with "Push now without <step>" (⇒ `defer … proceed`, token-tier on the socket,
   a person in the Web) and "Wait".
5. **"Set `<param>` instead"** on a failed or deferred step whose `when` reads a param (§8.4).
6. **Clarify revise** on a flow clarify step (§9).
7. **Spend** per execution, step, intake, plan and run: tokens or "not available (<reason>)"; money always "not
   available — the tool reports none"; a note "tool-reported, not an estimate".

Start form: the `image` param picker with the effective default (§8.4). Settings (`web/src/FlowSettings.tsx`): the
two new fields with source and lock state. Project settings: §11.

---

## 15. Amendments to the flow engine spec (F stays as published)

| F section | Amendment |
|---|---|
| §3.2 params types | + `image` (§8.1) |
| §7.2 reasons | + `fill`; skip/defer-marked steps excluded like `when`-false (§6) |
| §7.3 proposal | + `unsure [{stepKey, question}]` (§5.1) |
| §7.4 the person decides | `rerunReview` built-in default `auto`; under `auto` only unsure steps are asked, with the timeout; every model skip nobody ticked is a minor decision (§5.2) |
| §7.5 cutoff | "the person marked it unchanged" is the `flow-plan-step accept-unchanged` verb; carried-forward executions record `ranOnInputs` (§5.5) |
| §8.1 kinds | run-level feedback = intake + triage (§4); commands + `skip`, `defer`, `fill`, `params`, `accept-unchanged` (audit); step-level pause/resume removed (§6.5) |
| §5.3 composition | a skip/defer-marked step's active output is suppressed from the composition and pointers until `fill` (§6.2) |
| §8.2 rules / pump | runs that are `done` with an open intake, plan or question are passed; completion waits for open intakes, plans and held effects (§4.2) |
| §8.3 rewind | re-queued feedback reuses its stored intake (no new calls); clarify-round revisions are re-applied as revisions (§4.2) |
| §11.2 settings | + `rerunAskTimeoutSeconds`, `paramDefaults` (not lockable) |
| §14.2 commands | rows of §13; `pause|resume` without `--step` |
| §15 built-in | version 2 (§8.5) |
| §18 stable contracts | + `loc1`, reason `fill`, proposal `unsure`, param type `image`, `flow_feedback` states |

---

## 16. Out-of-repo writes (Rule 17) and cross-repo (Rule 16)

| Path (env redirect) | Writer / trigger | Modes | Failure residue |
|---|---|---|---|
| `$ORCA_CONTROL_DIR/flow-attachments/<sha256>.<ext>` (default `~/.orca/control/…`, `controlRoot`, `src/panel/controlOptions.ts:55-59`) | the attachment upload route; the start and `params` change copy of an `image` param (§8.1) | dir `0700`, files `0600`, explicit; an existing file is never rewritten (same name = same bytes) | temp file + rename; a failed upload leaves no named file. Unreferenced attachments stay until a run is archived (deletion is left to the builder, §19) |
| `.orca/attachments/` and `.orca/params/` inside a child's attempt workspace | the work kind before the agent starts | `0600` | excluded from commits by the vault's `info/exclude`; removed with the workspace as today |
| the original image (preset or picked) | **read only**, once per start / `params` change | — | — |

Criteria use temp `HOME` and every `ORCA_*` redirect (F C21 pattern). No new write to the person's folder.

**Cross-repo:** none required. md2publish-draft already takes the cover path explicitly, and with §8.1 that path is
always a copy inside the step's own workspace. Anything that needs md2publish-skills to change is its own spec in that
repo (Rule 16), not part of this package.

---

## 17. Success criteria (Rule 4: commands with exit codes; Rule 9: named mutations seen red; Rule 18: `npm test`)

All run by `npm test` (exit 0; it selects the affected files and runs typecheck). Each file also passes alone with
`npx vitest run <file>` (exit 0; web files through the web workspace's vitest config as `npm test` runs them). Every
named mutation is made in a `git clone --local` copy and must turn its file red; restore proof is `git diff` and
`git diff --cached` at 0 bytes (Rule 15).

| # | Criterion (test file) | Mutations that must turn it red |
|---|---|---|
| G1 | locate `loc1` (`tests/flow/feedbackLocate.test.ts`, table-driven, pure): exact unique quote ⇒ located; the same quote with full-width punctuation, `**bold**`, a link and removed CJK–Latin spaces ⇒ located at rung 2; `…`-split quote; heading; `第三段` and `paragraph 3` (front matter, an HTML comment, a code fence and headings not counted); a quote in two paragraphs ⇒ `needs-location` with both hits; no hit ⇒ `needs-location`; hits in `<slug>.md` and `<slug>.wechat.md` ⇒ the later writer's file; two files by one writer ⇒ ambiguous; a 5-character normalised quote is not a quote | return the first hit when there are several; drop the CJK fold; count headings as paragraphs; prefer the earliest writer; search files no step touched |
| G2 | intake (`tests/flow/feedbackIntake.test.ts`, fake calls): run-level anchored feedback ⇒ triage with `T` bounded at the last writer; a target outside `T` ⇒ invalid then retried; exhausted ⇒ the last writer, flagged; the plan carries the location text in the target's prompt; while the intake waits in `needs-location` and `clarifying`, a queued step of the run starts; whole-article `vague` ⇒ a clarify round stored at `('@feedback', seq)`; a third question ⇒ invalid; answers ⇒ second triage with `restated` ⇒ plan; `asIs` replacement closes the round; a replacement excludes the old message; anchored + `vague` ⇒ invalid; **on a `done` run** the feedback is triaged by the pump while the run stays `done`, the run turns `running` only when the plan is made, and an intake in `needs-location`/`clarifying` makes `needsYou ≥ 1` with the run `done`; **rewind** past an applied intake ⇒ the re-queued message reuses the located anchors and targets with zero new triage/clarify calls (call count asserted), and a later clarify-round revision is re-applied as a round revision | block the run while an intake waits; accept a third question; accept a target outside `T`; pick a hit instead of asking; plan before re-verifying the anchor; pump only `running` runs (`kernel.ts:866` unchanged); turn the run `running` at intake; triage again on rewind; drop round edits on rewind |
| G3 | unsure + timeout (`tests/flow/rerunUnsure.test.ts`, fake clock): proposal `unsure` on `cover` ⇒ pending, deadline = now + 300 s; with project 600 / global 120 ⇒ 600; a chosen step before it runs, `cover`'s `parallelWith` sibling runs, `to-draft-box` after it waits; at the deadline ⇒ accept-unchanged by `orca-auto`, one minor decision, `cover` carried forward, `to-draft-box` proceeds; `include` ⇒ `cover` runs; `unsure` on a feedback-targeted, `fill` or never-succeeded step ⇒ invalid; an effect confirm card and a held effect older than the timeout are still waiting; under `review` nothing has a deadline; **plan replacement:** new feedback on `voice` while `cover` is pending (fake clock at 200 s) ⇒ plan n abandoned, `cover` pending in plan n+1 with deadline = now + 300 s (not the old 100 s left) | the timeout runs the step; global over project; nothing held while pending; no decision on timeout; the timeout clock applied to a confirm card; treat an unlisted candidate as unsure; keep the old deadline on carry-over; drop pending items on replacement |
| G4 | accept as unchanged (`tests/flow/acceptUnchanged.test.ts`): accept on a chosen unexecuted step ⇒ carried forward, later steps lose `upstream-changed:<it>`; accept on an executed step ⇒ cutoff drops a later step whose only reason was it; **the next plan (new feedback on an unrelated later step) does not propose an accepted or plan-skipped step again**; accept on a non-candidate ⇒ `flow-plan-step-not-candidate`; **carry-over (§5.6):** accept `cover` in plan n while plan n is open, then new feedback on `to-draft-box` (later, `cover`'s inputs unchanged) ⇒ plan n+1 records the accept as `carried` and does not ask about or run `cover`; new feedback on `voice` (earlier, `cover`'s inputs change) ⇒ the accept is dropped and `cover` is planned afresh | do not feed `acceptedUnchanged`; carry forward without `ranOnInputs`; add a step on accept; carry an accept over changed inputs; never carry accepts |
| G5 | skip / defer / fill (`tests/flow/stepSkipDefer.test.ts`, the wechat world fixture): a failed `cover` deferred ⇒ the run continues; `to-draft-box` is held (`parked`, `deferred-upstream`) with no `effects` choice; `defer … proceed` ⇒ it starts and its level gate applies; `article` after a deferred `visuals` gets the "deferred — output not available" pointer, and **when `visuals` had an earlier output, `article`'s base composition does not contain it** (its files absent from the base tree; the head and folder lose them at the next copy-back) while `step_heads` for `visuals` is unchanged; `fill` ⇒ plan with reason `fill`, `visuals` re-runs and `article` is a candidate; skip/defer on `brief` or `pick-title` ⇒ `flow-step-not-skippable`; **while `to-draft-box` is held the run is `running` with `needsYou ≥ 1`**; with nothing held, a deferred step leaves the run `done` with `needsYou ≥ 1`, a skipped one with 0; defer of an effect step discards its staged record | a held effect runs; a held effect lets the run turn `done`; a deferred step blocks later steps; the deferred step's old output stays in the composition; `fill` restores the old output instead of re-running; the model may skip a `fill` step; `needsYou` ignores deferred steps; `proceed` accepted from a socket agent without a token |
| G6 | equals (`tests/flow/equalsProjection.test.ts`): an `outline` re-run with the same headings ⇒ later steps not candidates by `outline`; changed headings ⇒ candidates; `json()` and `verdict` likewise; a missing file ⇒ null, no cutoff | projection always null; hash the whole file instead of the headings |
| G7 | flow clarify revise (`tests/flow/flowClarifyRevise.test.ts`): revise round 1 of a done `brief` ⇒ execution 2 with copied rows plus the revision; execution 1's rows byte-equal; consensus ⇒ head moves ⇒ plan with downstream candidates; revise while in progress appends to the same key; a superseded round ⇒ `flow-round-not-revisable`; C7's golden unchanged | overwrite a round in place; move the head before consensus; no plan after consensus |
| G8 | cover (`tests/flow/coverParam.test.ts`, `tests/flow/wechatBuiltin.test.ts`): `image` type checks extension/size/existence; an absolute start value ⇒ `flow-param-invalid`, from settings ⇒ accepted; project default over global; the image (preset or picked) is copied to the store and into the `to-draft-box` workspace at `.orca/params/coverImage.<ext>`, `{{param.coverImage}}` expands to that path in the prompt, the copy is absent from the attempt commit and the folder; changing the file's bytes then `params` ⇒ `to-draft-box` candidate, the same bytes under a new path ⇒ not a candidate; `coverImage` set ⇒ `cover` skipped by `when`; template version 2 has the `owns` labels | hash the path, not the bytes; expand to the original path; accept an absolute start value; global over project; commit the copy |
| G9 | spend (`tests/flow/flowSpend.test.ts`): per execution from its runs; child group sum equals the driver runs' tokens; step and run sums; an unknown-usage run ⇒ `null` with reason and "partial" on the sum; a tool `0` ⇒ unknown; `usd` always `null` with the reason; a call's run id survives `completeFlowCall` | show 0 for unknown; show the allocation as spend; lose the run id |
| G10 | access (`tests/control/flowVerbAccess.test.ts`, `tests/panel/accessMatrix.test.ts`, `tests/entry/skill.test.ts`): `flow-plan-step` human-only, tier `token` for `run` and `open` for `accept-unchanged`; `flow-message` stays `any` with a `SOCKET_TIER` predicate: a `defer` whose `effects` contains `proceed` is `token` (socket agent without token refused), any other `flow-message` is `open`; a dispatched run refused `flow-plan-step` and a `proceed` defer, allowed a `wait` defer; `HUMAN_ONLY_FIELDS` has no `flow-message` entry; registry rows and payload schemas exist | move `flow-plan-step` to `any`; tier `run` as open; predicate always `open`; the socket check ignores predicates on `any` verbs |
| G11 | project settings label (`web/tests/projectSettings.test.tsx`): heading's accessible name includes the project name for a repository project and for a `dir` project; the path shows; flows region names the project | heading without the name; `dir` label falls back to the id |
| G12 | Web run page (`web/tests/flowRunPage.test.tsx` additions): run-level box sends anchors and attachments; `needs-location` hit picker sends `replaces` + `hit`; countdown and both plan buttons send `flow-plan-step`; the defer dialog appears only with a downstream external/irreversible step; "set coverImage instead" on the failed `cover`; spend `null` renders "not available" | never show the defer dialog; render `null` spend as 0 |
| G13 | migration 17→18 (`tests/control/flowFeedbackMigration.test.ts`): `flow_feedback` exists with its checks; every pre-existing table byte-equal; the backup precedes the step; a backward state write is refused except `ready → needs-location` | skip the backup; allow any backward write |
| G14 | Rule 17 and attachments (`tests/flow/outOfRepoWrites.test.ts` extended, `tests/flow/attachments.test.ts`): a run with feedback and two attachments under temp `HOME` and separate `ORCA_*` dirs ⇒ nothing under `HOME`; attachment dir `0700`, files `0600`; the attachment and an `image` param copy are present in the child's workspace and absent from the attempt commit, the vault head and the person's folder; a preset cover's original file is unchanged (bytes, mode, mtime) | default the store from `os.homedir()`; copy the attachment to a tracked path; write to the original image |

The paid real run of `wechat-article` (feedback by quote on the illustrated article, a deferred cover with a preset
cover, a draft-box enact) is a separate acceptance the human approves, not part of `npm test`.

---

## 18. Build order (each package ends green on `npm test`, Rule 18)

| # | Package | Content | Needs |
|---|---|---|---|
| 1 | Pure | `loc1` + anchor extraction (§4.1, §4.3); proposal `unsure` validation; reason `fill`; projections (§7) | — |
| 2 | Storage | schema step 18 + backup (§12) | — |
| 3 | Planner | §5 (pending, timeout, accept, persistence fix, `auto` default + decisions), §7 wiring | 1 |
| 4 | Step marks | §6 (`skip`/`defer`/`fill`, held effects, pointers, `needsYou`) | 3 |
| 5 | Intake | §4 (intake, triage purpose, feedback host, replacements, attachments) | 1, 2, 3 |
| 6 | Params | §8 (`image`, `paramDefaults`, `params` command, built-in v2) | 3 |
| 7 | Clarify revise | §9 | 3 |
| 8 | Spend | §10 | — |
| 9 | Commands | §13 rows, access, refusal codes, `gen:cli-docs` | 3–8 |
| 10 | Web | §14, §11 | 9 |

---

## 19. Left to the builder (decide, record in the plan's ledger)

- Module paths (`src/flow/feedback/…`), the exact CLI spellings within §13's rows, refusal code spellings.
- Whether the feedback host's caps are enforced in the host or the shared classifier, provided C7's golden holds.
- The triage and proposal prompt texts (the human reviews them as a diff); bounded sizes named in §4.4 may change with
  the cut recorded.
- Whether the attachment upload is a route or the `flow-attach` verb (§13); when unreferenced attachments are deleted.
- How the held-effect `parked` execution is released (reuse the pool-raise restart or a new transition), within §6.3.
- The exact Web layout of §14.
- Whether `ranOnInputs` on carried-forward executions is needed (G4's red test decides, §5.5).

---

## 20. Open for the human (flagged, all reversible)

1. **`rerunReview` built-in default `review → auto`** (§5.2). Under `auto` the person's own feedback plan runs at once
   except unsure steps; `review` remains a setting.
2. **"Unsure" only when the model says so** (§5.1); a model that says nothing gets every candidate run, not asked.
3. **Ordinal-only anchors locate without asking** (§4.3), shown back with the excerpt.
4. **Held effects:** only `external`/`irreversible` steps are held after a defer; `cost` steps (image generation) are
   not (§6.3).
5. **Absolute image paths only through settings** (§8.1).
6. **Step-level pause stays out** until dogfooding (R12).

---

## 21. Corrections and as-built (session 0e13a9b7)

Appended per Rule 13: the sections above stay as published; entries here correct or register by name.

1. **Out-of-repo writer registered (Rule 17, §16's shape).** Schema step 18 added a code-level control-DB backup (§12
   says "one control-DB backup precedes it"; before this there was no such code, only human cutover procedures).

| Path (env redirect) | Writer / trigger | Modes | Failure residue |
|---|---|---|---|
| `control.sqlite.pre-v<from>-<ms>` (`-1`, `-2`, … when the name is taken), in the control state dir (`$ORCA_CONTROL_DIR`, default `~/.orca/control/`) | `openControlStore` (`src/control/store.ts`) when it opens an existing store whose schema version differs from the build's, before the migration transaction; a consistent `VACUUM INTO` copy | file `0600` (set explicitly, inside `privateIO`) | one full copy per version change, never pruned; a failed migration leaves its backup; a failed copy aborts the open and migrates nothing |

   Criteria write it only under temp state dirs (Rule 17).
