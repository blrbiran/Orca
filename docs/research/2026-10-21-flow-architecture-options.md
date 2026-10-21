# Flow templates: architecture options for one Orca engine

- **Author:** synthesis subagent of Orca session `8b1469ea`, 2026-10-21, at Orca `31c7c952`. **A proposal for the
  human to decide on, not a spec.**
- **Revision 2026-10-22** (base commit `56d881c8`): H22 replaced (record, don't declare); H23/H24 added; effects,
  settings precedence and optional admin locks rewritten per the rulings at `:51-52`; configured delivery per CLI v2 R3a
  (`:26`); Q1–Q3 marked ruled; fixes from the independent review (`:53`). Evidence is in `docs/research/2026-10-21-flow-engine-research.md` (cited as
  "R §n"); track reports in `/private/tmp/orca-8b1469ea/research/` (cited as "t7 L1" and so on).
- **Yardstick:** goal.md P1–P7 and the human rulings in
  `.superpowers/sdd/2026-10-21-session-8b1469ea/progress.md` (cited as `:line`).
- **Scope:** one engine that runs development, writing/WeChat, office, game-dev and UI/UX flows. Out of scope here:
  kanban layer 2, group edges v2, the correction button and #76, which are other design items in this session (`:23`).
- **Marks:** [V] seen in source or in the ledger; [I] inference or proposal. All sizes are rough relative guesses [I],
  not measurements.

---

## 1. What every option must satisfy

### 1.1 Human requirements (ledger excerpts, verbatim where quoted)

| # | Requirement | Where |
|---|---|---|
| H1 | Writer flow: idea + references + raw material in; research/draft/polish/images/publish through skills and tools; template decides which steps to add, remove or switch | `:34` |
| H2 | 「公众号系统中的发布由我来点击」: Orca stops at the WeChat draft box | `:34` |
| H3 | 「大部分写文章的作者不会习惯用git管理…单独目录」: plain directories | `:34` |
| H4 | 「应该只跑特定几步…后面的某些步骤也应该省略掉」: a revision re-runs only some steps | `:34` |
| H5 | 「不是要你将这个微信公众号发布的流程固化下来，应该做成可动态配置的方案…用户可以随时微调形成他们自己的template」 and 「可以直接将其做成一个内嵌的标准模板」 | `:34` |
| H6 | Distributable; end state 「网页版模板市场」 | `:34` |
| H7 | 「模板应该要能网页编辑，或者主要通过网页编辑」 | `:34` |
| H8 | Shared across projects (`~/.orca/flows/`); plan for shared vs per-user once multi-user | `:34` |
| H9 | Skills through syncskill, sources 「尽量以 git 地址为准」; 「只有特定人（比如管理员能安装 skill），普通用户只能选择/使用 skill…提前留好口子」 | `:34` |
| H10 | 「一个 run 应该能用不止一个skill」; 「模板应该就要带上对应搭配使用的 skill 组合」 | `:34` |
| H11 | Vault: bare repo per directory, refs per step, temp attempt worktree, copy back the write set, snapshot human drift, never `git clean`/`checkout .`, size caps, NFC/NFD, excludes in the vault, record the remote draft id: 「同意」 | `:35-36` |
| H12 | Layer precedence 「个人 > 共用 > 内置」 | `:37` |
| H13 | Game/UI-UX: 「用的工具、skill、哪一部一定需要人参与等等都跟开发的flow不一样」 | `:37` |
| H14 | Agent/model 「不应该在模板中定死…顶多做到建议的 agent 和模型。同意可以加这一步是「人」的选项」 (also goal.md §5.7) | `:37` |
| H15 | At a gate 「写意见和直接动手都要能接受」: feedback = revision; direct edit = human version, downstream queued | `:37` |
| H16 | Templates carry editable prompts: 「好的实践…在用户千锤百炼/有巧思/利用心理学原理的 prompt 里」 | `:40` |
| H17 | Clarify framework kept, with domain background, prompts and document structure per template; clarify optional per template | `:40` |
| H18 | 「软件改动步骤 => 是否也要拆细？…游戏开发应该也会有改代码的步骤」 | `:40` |
| H19 | Dev flow still dogfooding: 「我还没跑通拆需求部分」 | `:40` |
| H20 | syncskill: pin by ref/SHA, content-addressed multi-version store, manifest install, lock-verified inject, keep unknown keys 「同意」; source ids derived from the source (short names collide) | `:45` |
| H21 | #82 cron is part of this design round | `:23` |
| H23 | 「我们当前的澄清流程就是参考 mattpocock 的 grilling skill 做的。这是我觉得 orca 的一个亮点。比 superpowers 的 brainstorm 轻量好实现，也能充分挖掘用户的真实意图和实际需求。」: the grilling-style clarify (frontier rounds, recommended answers, facts by the agent / decisions by the person, scope caps #86) is a core asset every option keeps and reuses across templates; no heavier brainstorm step replaces it | `:48` |
| H24 | 「我们是不是也要允许部分模板显示bypass 需求澄清这一步，比如一些流程非常固定的场景？」: clarify is optional at three levels: (1) a template may omit it (fixed flows); (2) a template may mark it `auto`, so the model may judge the input clear + small and run zero rounds, posting a one-line "my understanding" the person can object to later (P3), i.e. #86 caps gain a 0-round tier; (3) per run the person may skip it at start or stop it mid-way (unanswered ⇒ recommended answers, the existing consensus path). Clarify mechanics unchanged | `:50-51` |
| H25 | Effects (Q2): 「可以默认直接执行再标红，但是全局/项目设置（项目设置覆盖全局设置）中可以修改为默认先弹确认卡片或默认不执行」 → ruled: per effect class three levels, **apply + flag** (default) / **confirm card** (parks only that step) / **stage only** (immutable deferred effect record, enacted or discarded later in Web and CLI); precedence **project settings > global settings**; a template's recommended level applies only when settings say "follow template" (built-in WeChat recommends confirm) 「同意」 | `:51-52` |
| H26 | Admin lock (Q3): 「能锁，也能不锁」: optional per security-class field (effect policy, skill sources, budget caps); a locked field may only be tightened by lower layers; show "locked by" and the source layer of every effective value | `:51-52` |
| H27 | Delivery: configured push/PR must be executable by Orca (CLI v2 R3a); only setting or changing delivery needs the person token | `:26` |
| H28 | Q1: adopt Option B with the phase order 「同意」 | `:51` |
| H22 | **No required read/write declarations.** The human rejected "outputs declared as paths and enforced, inputs = declared dependencies": 「管不住 agent 的行为吧？一些 skill 会约束产物路径。一些skill 不会，如果是开发 flow 的话，你更控制不了每一步的产物了。」 and 「开发 flow 怎么做？每一步 group 或 task 都不知道自己要读/写哪些文件。你这个方案局限性太大，也限制太死了吧」. Approved replacement (「同意你建议的方案，但是你可以结合上面我的说面再一起看下是否需要调整」): outputs are **recorded** after each step (one vault/git commit per step = what actually changed); reads are recorded where available (agent tool logs) but never required; writes are never rejected by path, and Orca records and can roll back; rerun = code computes a conservative candidate set (unknown ⇒ include), the model proposes skips or a starting step from the feedback with reasons, the person adjusts, and code executes in template order, reusing prior outputs for skipped steps; author hints are optional | CORRECTION entry at the end of `progress.md` (2026-10-22) |

Note: 「Template shape: 同意」(`:37`) was given to the controller's v1 architecture, which the human later said did not
satisfy them (`:40`). The options below keep v1's ruled parts (H11, H12, H15) and the replacement H22, and re-open the
rest. An earlier draft of this file used the rejected H22; this version replaces it.

### 1.2 What the research says any good answer contains (R §0), adjusted by H22

Closed code-owned step kinds; one canonical layout-free document with stable ids; a per-step record of what each
execution ran on and what it changed, with re-runs computed conservatively by code and shown with reasons. The research's
build-system ideal of declared inputs and outputs is out: the human ruled it too rigid for agents (H22). Also: human edits
as injected outputs on a branch; decisions graded by reversibility;
side effects as typed requests under per-class policy; roles bound to tiers and resolved on the machine; pinned,
hash-recorded dependencies that never overwrite local edits.

---

## 2. Option A: stage recipes on today's group kernel

**Idea.** Raise loop plans (today a per-task recipe, `src/control/loopPlans.ts:16,104` [V]) one level: a **flow
template is an ordered list of stages**. Each stage expands into work items of the existing group, and the existing
scheduler, ledger and landing run them unchanged. Close to multica / omc staged pipelines (R §1).

**Core concepts and data model**
- Template `{id, version, title, params[], requires{skills}, stages[]}`; stage `{id, kind, prompts, skills, acceptance,
  human: none|confirm-before|review-after, suggest{agent, model}}`.
- Stage kinds: `clarify` (today's grilling-style requirement rounds, unchanged, H23; omit / `auto` 0-round / skip-or-stop per run, H24), `split` (today's), `estimate`, `confirm`, `tasks` (ccloop loop
  per work item, loop plan by label), `single` (one agent call producing a document), `ask` (person), `effect`.
- Artifacts: files in the group's workspace (repo worktree, or a vault-backed plain directory, H11); no per-step
  journal beyond today's runs and records.
- Human messages: today's decision ledger and corrections, plus "reopen stage k with feedback".
- Effects: a terminal stage kind with a confirm flag.

**Re-run.** The person picks stages; code reopens them and every later stage (no fingerprints, so no early cutoff); the
person may untick later stages. H22 fits trivially: stages declare nothing, and each stage's workspace changes are
recorded as one vault/git commit. But there is no candidate set or model proposal, so the person does all the choosing.

**Dev pipeline.** Becomes the built-in stage list `clarify → split → estimate → confirm → tasks → integrate → deliver`;
the change is mostly parameterising the prompts in `requirementClarify.ts:19` and `requirementSplit.ts:17` [V] and
reading the stage list instead of hard-coded transitions.

**Strengths.** Smallest change, reuses everything that already works, lowest risk to dogfooding (H19).
**Weaknesses.** No dataflow: a stage either runs or not, so H4 over-runs (changing the title reruns visuals, format and
draft); no parallel branches across stages (cover ∥ visuals, art ∥ code in game dev, H13); a direct edit in the middle
of a stage has no addressable target; early cutoff impossible. P1 asks for the long-run optimum, and this is the shape
every surveyed engine outgrew or never needed (R §1 "Disagreements") [I].

**Size [I]:** small–medium. **Cross-repo:** syncskill list (§5.3); ccloop none; ccmem none.

---

## 3. Option B: artifact flow engine (one engine; dev becomes a built-in template) — recommended

**Idea.** A flow is a **typed document of ordered steps**. Steps declare no inputs or outputs (H22). After each step,
code **records what it actually changed** as one vault/git commit, plus a structured record for `draft`/`review`/`ask`
steps. A code interpreter keeps a **journal of step executions with fingerprints of what they ran on**. After a change
or feedback it computes a conservative candidate set to re-run; a model proposes skips; the person adjusts.
Humans talk to a run through a **message stream**. Side effects are **typed requests applied by code**. The existing
group/run machinery becomes the substrate under the `work` and `draft` step kinds, not a parallel system. Sources:
OpenSpec artifact DAG (t3 L1), build-system fingerprints (t1 L1–L2), LangGraph fork-by-writing-as-a-node (t7 L1–L2),
Temporal message kinds and reset-with-reapply (t7 L3–L4), gh-aw safe outputs (t9 L1–L3), Airflow/Dify human steps
(t1 L4, t8 L6).

### 3.1 Template document (`orca-flow-v1`; zod, unknown keys rejected, no layout, no run state)

```yaml
id: wechat-article            # stable; steps never renamed (label is separate)
version: 3                    # append-only; a run stores the expanded bytes + sha256
params:                       # typed slots -> generated form (t6 L8, t2 §8)
  idea:      {type: text, required: true}
  materials: {type: dir, default: "{{workspace}}/material"}
requires:
  skills: [{source: github.com/blrbiran/runskills, ref: <40-hex>, names: [tech-writer, tech-writer-deslop]}]
  commands: [{name: md2wechat, check: "md2wechat doctor --json"}]   # checks, not installers (t5 L4)
roles: {writer: {tier: high}, reviewer: {tier: high, distinctFrom: writer}}
workspace: {kind: dir}        # dir (vault) | repo (git worktree)
steps:                        # executed in this order; no declared inputs or outputs (H22)
  - {id: outline, kind: draft, role: writer, prompt: prompts/outline.md}
  - {id: approve-outline, kind: ask, executor: person, policy: review-after, onTimeout: proceed}
  - {id: draft, kind: work, role: writer, skills: [tech-writer],
     acceptance: {checks: [{run: "test -s {{slug}}.md", role: gate}]}}
  - {id: deslop, kind: review, role: reviewer, skills: [tech-writer-deslop],
     acceptance: {checks: [{run: "scan.py --json {{slug}}.md", role: diagnostic}]},
     hints: {equals: verdict, owns: [ai-tone]}}      # optional: cutoff projection, feedback triage labels
  - {id: cover, kind: work, parallelWith: draft,     # optional ordering hint, not a data declaration
     effect: image-generate,                         # classes the WHOLE step (class cost), gated as a unit
     hints: {skipWhen: "body-only change"}}
  - {id: to-draft-box, kind: work, skills: [md2publish-draft],
     effect: wechat-draft, recommendedLevel: confirm} # class external; level comes from settings (§3.5)
```

Everything under `hints` (and `parallelWith`) is optional and only improves planning; a template with none still works.
`effect:` classes a whole step (C5, controller's call `:53`). The step is gated as a unit by its class's level even
though an agent with a skill performs it. v1 has no Orca WeChat adapter; the human's md2publish-draft skill does the
upload inside the effect-classed step.

### 3.2 Step kinds (closed set, registered in code like `SingleCallHandler`, `singleCallPurposes.ts:25-37` [V])

| Kind | What code owns | Model's part (Rule 5) |
|---|---|---|
| `clarify` | **today's grilling-style clarify, kept as is (H23)**: frontier rounds, a recommended answer per question, facts looked up by the agent and decisions left to the person, caps by scope × clarity (#86), document assembly. A template supplies only the domain background, question focus and document sections; no brainstorm or builder-check step is added. **Optional at three levels (H24):** a template omits it; `clarify: auto` adds a 0-round tier to the #86 caps (small + clear ⇒ no questions, one-line "my understanding" posted as an objectionable decision); and per run the person can skip it at start or stop it mid-way (unanswered ⇒ recommended answers, today's consensus path) | questions, classification, the 0-round judgment |
| `draft` | one call, schema-validated output (split, estimate, outline, brief) | the content |
| `work` | an agent session in a workspace through ccloop (plan/execute/verify). Afterwards, whatever changed is recorded as the step's output (one vault/git commit); nothing is rejected for writing elsewhere, and rollback moves refs (H22) | the work |
| `check` | a command; `role: gate` blocks, `role: diagnostic` feeds the next step (t4 L2) | — |
| `review` | isolated judge with the template's rubric, typed verdict, capped rounds; runs only after gates pass (R §5) | the verdict |
| `ask` | typed form, inferred candidates + free text, skip conditions, timeout policy; `executor: person / agent / either` (H14) | candidates, defaults |
| `effect:` (a class on any step, not a kind) | the step is gated as a unit by its class's level (§3.5). Orca adapters exist only where Orca already owns the action (git-land, push, PR open); elsewhere the step's agent + skill performs it. **Accepted limitation:** an unclassed step that causes a side effect on its own cannot be controlled, only recorded afterwards (same nature as H22) | the payload / the work |
| `foreach` | `over: <step>.tasks`, **the one allowed data reference** in a template (I9): deterministic expansion over a list record produced by an earlier `draft` step, children keyed by item key, not index (t7 L10) | — |
| `subflow` | a pinned child flow with its own journal and a parent-close policy (t7 L11) | — |
| `wait` | durable timer or message wait; generalises `scheduler_wakes` (`migrations.ts:44` [V]) | — |

Loops are fields, not kinds: `loop: {until: <check or verdict>, max: n}` on `work`/`review` (Airflow `.loop`, t1 L14).
`when: <predicate over params or classification>` drops steps (H4, H17 "clarify optional"); code evaluates it.

### 3.3 Artifacts, versions, journal

- **Step output** = what the execution actually changed, recorded after the fact. For a workspace it is one commit
  (vault `refs/orca/<run>/<step>/<n>` for `dir`, H11; an attempt commit for `repo`). For `draft`/`review`/`ask` it is a
  structured record in the existing content-addressed `artifacts` table (`migrations.ts:11` [V]); no separate
  `artifact_versions` table, because versions are journal rows pointing at `artifacts` hashes. Each output carries `by` (a
  person or the agent identity) and `via` (web/cli/mcp, CLI v2 §16, `:33`). The vault's "copy back the write set"
  (H11) now means copying back what changed, not a declared set.
- **Reads** are recorded where the agent's tool log provides them (optional, best effort), and never required.
- **Step execution** = `(runId, stepKey, seq, fingerprint, ranOn, output, readSet?, state, reason, branch)`.
  `ranOn` = the workspace tree hash plus the hashes of all earlier steps' outputs at the moment it started.
  `fingerprint = H(template step version bytes, prompt + skill lock hash, params, ranOn)`. Model and agent are recorded
  but **excluded** (they are suggestions, H14) [I].
- **Parallel steps (`parallelWith`)** (I8): each runs in **its own attempt worktree** from the same base. `ranOn` is
  ordered by the key `(template position, step id)`, so it is stable even when siblings finish in any order. On
  copy-back, the later finisher rebases or merges onto the earlier finisher's commit. A conflict goes to conflict
  resolution like today's reconcile (`src/scheduler/reconcile.ts`), or, where that is not configured, the step fails and
  is flagged red; nothing is overwritten silently.
- **Branches**: each step has an *active execution* per run. A human edit or an undo moves the pointer and writes a
  journal row; old executions stay addressable (LangGraph forks, t7 L2) [I]. Several steps may touch the same file;
  each commit shows which step changed what.

### 3.4 Re-run planning: code bounds, model proposes, person decides, code executes (H22)

1. **Candidate set (code, conservative).** A step is a candidate if its own definition changed (template step version,
   prompt, skill pins), or if any earlier step's output changed since it last ran (its `ranOn` differs). Without
   declared inputs, "earlier" means earlier in template order. A recorded read set may narrow this only when it is
   present and covers that step; **unknown ⇒ include**. Steps with a person's feedback or edit are always candidates.
2. **Proposal (model).** From the person's feedback, the recorded diffs and the template order, a model **may only
   remove candidates** (skip them; a "starting step" means skipping earlier candidates), each with a reason
   ("title-only change: cover and visuals unaffected"). It cannot add steps or reorder. Author hints (`skipWhen`,
   `equals`) are inputs to that proposal, never requirements. Ruled to fit P7 as amended (§7 O1).
3. **The person adjusts** the plan in the Web UI or CLI: untick or add steps, choose the start (H4
   「后面的某些步骤也应该省略掉」), or mark an output "accept as unchanged" (t1 L6). In unattended mode the proposal
   is taken as is, and **each model skip is recorded as a minor decision** the person can correct later (P5, P3).
4. **Execution (code)** runs the chosen steps in template order. Skipped steps keep their prior outputs, which later
   steps run on. Each execution records its new `ranOn` and fingerprint, so the journal stays truthful about what ran on
   what.
5. **Cutoff.** If a re-run step's declared projection (`equals: verdict | headings | task list`) or its output hash is
   unchanged, or the person marks it "unchanged", the later candidates it alone caused are dropped from the plan
   (t1 L2, t7 L1). Byte equality rarely holds after an LLM step, so projections and the human mark do most of the work.
6. Failed or rate-limited executions are never reused (t1 L13).
7. Better precision later, optional: ccloop reporting the files each attempt read (Buck2 dep files, t1 L8).

### 3.5 Humans: message stream and effect policies

- **`flow_messages`** `(id, runId, kind, target step|artifact|run, body, by, via, requestId, state)`, three kinds
  (t7 L4):
  - `feedback`: always accepted and appended. A model may classify which step it concerns, using the optional
    `hints.owns` labels when the author gave them ("ruler" triage, t4 L6). Code then queues a **revision execution** of that step with the feedback
    in its prompt. Later steps become candidates, and the §3.4 plan decides which of them run (H15 「写意见」).
  - `edit`: the person's change is recorded as a new output of that step, with `by` = the person. Later steps become
    candidates, and the edited step is not re-run (H15 「直接动手」).
  - `command`: change budget, move the active pointer (undo), pause or retry a step with new options, approve or
    discard a deferred effect. Code validates it; **rejections are logged too** (t7 L4, Rule 13).
- **Running steps are not killed by feedback**; it is consumed at the next boundary (LangGraph `enqueue`, t7 L4).
  **Rewind re-applies later messages** unless the person excludes them (Temporal reset, t7 L3).
- **`ask` steps never block siblings**. `review-after` asks let downstream run on the unratified output; if the person
  edits, the later steps become candidates for the §3.4 plan (Zuul speculation, t1 L5). This is P2's 「先跑后审」.
- **Effect levels (ruled, H25)** apply to effect-classed steps (§3.1):

| Level | What happens | Waiting |
|---|---|---|
| `apply-flag` (**default except `irreversible`**) | the step runs; its effect is flagged red for review afterwards | none |
| `confirm` | a confirm card before the step starts | **only that step** (and steps after it in template order) is parked; parallel branches and other groups continue (P2) |
| `stage-only` | the step does not run; an immutable **deferred effect record** `{step, effect kind, ranOn, payload hash if any, policy snapshot, source execution}` is stored, then enacted or discarded later in Web and CLI (gh-aw #61112 gap, t9 L3) | none; the flow ends or continues without the effect |
| `follow-template` (a settings value, not a level) | use the template's `recommendedLevel` (built-in WeChat: `confirm`); none given ⇒ `apply-flag` | — |

| Class | Examples | Built-in default level (O2 ruling, 2026-10-22) |
|---|---|---|
| `local` | write the workspace, land to a local branch | `apply-flag` |
| `cost` | image generation, paid model batch (budget caps still apply) | `apply-flag` |
| `external` | WeChat draft, PR open, email draft (visible but undoable) | `apply-flag` |
| `irreversible` | push, send email, merge to main | **`confirm`**; settings may choose `stage-only`; `apply-flag` only by an admin's explicit setting, with a standing panel notice. **Configured delivery** (push/PR set in the Web UI) is the person's explicit choice for that project/group ⇒ it runs as `apply-flag` there (CLI v2 R3a, `:26`, H27); only *setting or changing* delivery needs the person token |
| `human-only` | public publish: not an effect; the flow ends before it (H2) |

### 3.6 Bindings, skills, prompts, layers

- **Roles → tier → machine binding** table in the personal layer, resolved at run start with provenance. An
  unresolvable role fails visibly, never borrows silently (t2 L1, t9 L4). `executor: person` is allowed on `ask`,
  `work` and `review` (H14).
- **Skills:** `requires.skills` uses the source id derived from the source (`github.com/owner/repo[/subdir]`, H20) at a
  pinned SHA. Each step's skill set is one inject per step execution, so many skills per run and different sets per
  step come for free (H10). Install is a syncskill plan that an agent may propose and an admin applies (H9; t5 L3).
- **Prompts:** prompt packs are versioned files with inline typed variables (t6 L8). They use the fixed envelope:
  stable role prefix → per-step instruction → artifact pointers → acceptance (t3 L11). Fragments are defined once and
  referenced (multica drift, R §10).
- **Two independent layer stacks** (H12, H25, H26):
  - **Template layers** resolve the *template document*: personal > shared > built-in. Built-ins are repo files seeded
    by upsert-by-id (t6 L7); shared and personal live under `~/.orca/flows/{shared,personal}/`. A personal template
    is a **copy with `base: <id>@<version>`**; updates use a 3-way merge with conflicts shown (t9 L6, t5 L5).
  - **Settings layers** resolve *run policy* (effect levels per class, budgets, timeouts, bindings): **project
    settings > global settings**, deep-merged per field. Both live in the existing control DB settings (like today's
    orchestration and workspace settings), set from the Web UI and CLI.
  - **How they meet.** For a policy field the effective value is the project setting, else the global setting, else
    (when the value is `follow-template`) the effective template's recommendation, else the built-in default
    (`apply-flag`). Templates only *recommend* policy; settings decide.
  - **Admin locks (optional, H26)** can be set on security-class fields only: effect level per class, allowed skill
    sources, budget caps. A lock is set in global settings, and project settings and every template layer may then only
    tighten that field.
  - The UI and `--json` show, for every effective value, its **source layer** and **"locked by"** when locked (t2 L12).
- **Editing (H7, P6):** the Web UI has a step list, a form per step kind generated from its schema, and a derived
  read-only graph (t6 L2–L3). Static checks gate *start/publish*, never *save* (t6 L4). Saving a draft ≠ making it
  live. An agent can edit the same document through CLI v2 (`orca flow …`, `--if-revision`), and code validates it
  and shows the diff (t9 L11).
- **Triggers (H21):** a schedule creates a flow run through the same entry as a person does. It is keyed
  `(trigger, plannedAt)`, missed slots collapse to the latest, it auto-pauses on a failure streak, and it is credited
  to whoever last published it. Unattended runs turn asks into defaults plus reported decisions (t2 L9).

### 3.7 Where the dev pipeline goes

| Today | In option B | Code today [V] |
|---|---|---|
| clarify rounds (caps by #86) | `clarify` step; template supplies background source (`repo-overview`), question policy, document sections | `requirementClarify.ts:16-19`, `requirementCalls.ts:252` |
| split | `draft` step; output schema = today's split task schema | `requirementSplit.ts:14-17`, `requirementSchemas.ts:77` |
| estimate | `draft` step (estimate handler) | `singleCallPurposes.ts:39-58` |
| confirm (= start) | `ask` step, `confirm-before`, executor person | `orchestration.ts` |
| per-task ccloop loop, landing, criteria protection | `foreach(over: split.tasks) → subflow software-change { work (loop plan by label) → land step classed effect: git-land (class local; protected set = today's TEST_PATH rule) }` | `loopPlans.ts:328-336`, `criteriaProtection.ts:22`, `executionDriver.ts:344` |
| debug groups / ladder | `onFailure` subflow of `software-change` | `debugGroup.ts`, `systemDebug.ts` |
| integration check, delivery | `check` step; delivery step classed `effect: pr-open` (external) or `push` (irreversible). Configured delivery is executable by Orca and follows the effect level (H27); setting it needs the person token | `integrationCheck.ts`, `integrationScheme.ts` |
| kanban across groups | unchanged: a group *is* a flow run | `orchestration.ts`, `groupEdges.ts` |

**H22 in the dev flow.** Groups and tasks declare nothing new. The split's existing `targetPaths` (`requirementSchemas.ts:77`)
stay what they are today, scheduling hints for the existing kanban and write-set logic, and the flow engine does not
enforce them. Each task's landed commit is its recorded output. A wrong result goes through the existing path:
correction → debug group → ladder (`progress.md` CORRECTION entry).

**H18 (finer software-change pieces) — my call [I], open to override:** keep one ccloop loop (plan → execute → verify)
as the unit of `work`. ccloop owns that loop and Orca follows its contract (G1, Rule 16). Finer pieces are template
steps *around* it (tests-first task, review, docs), and the game-dev template reuses the same `software-change`
subflow with engine-specific skills. Splitting ccloop's internal phases into Orca steps would duplicate ccloop and
needs per-phase skills in ccloop (one skill dir per run: ccloop `src/control/protocol.ts:258-259`, fields at `:270,299` [V]).

### 3.8 Phase plan (respects H19: the dev flow is not touched until its split part runs)

| Phase | Content | Done when [I] |
|---|---|---|
| 0 (this session) | Spec for `orca-flow-v1`, kinds, journal, planner, messages, effect levels, settings layers; freeze names before any distribution (gh-aw: 75 codemods, t9 L10) | spec committed; Q1–Q3 already ruled (`:51-52`); O1 answered |
| 1 | Kernel next to the dev flow: schema + validator + kind registry; tables `flow_runs`, `step_executions`, `flow_messages`, `effect_records` (step outputs reuse `artifacts`); effect levels + settings precedence; planner as a pure, mutation-tested function; kinds `draft`, `work` (dir via vault), `check`, `review`, `ask`, `effect`; built-in `wechat-article` template on the human's skills; run page (steps, artifacts, rerun plan, messages); `orca flow` verbs in the CLI v2 registry | `npm test` incl. a named e2e: article flow → feedback on one step → plan shows the conservative candidates and the model's proposed skips with reasons → person unticks one → only the chosen steps run, skipped ones keep prior outputs → draft-box effect stub records a draft id. Plus named e2e cases for **each effect level** (apply-flag runs and flags; `confirm` parks only its step while a parallel step finishes; `stage-only` leaves a deferred record that is enacted once via Web and once via CLI, and discarded once) and for **precedence** (project overrides global; `follow-template` picks the template's `confirm`; a locked global field refuses a looser project value) |
| 2 | syncskill changes (§3.9); `requires` install with admin gate; prompt packs; layers with copy + 3-way update; Web editor; import/export with preview and per-item decision (t6 L6) | `npm test`; edit → save draft → publish blocked by static check → fixed → run pins new version |
| 3 | Dev flow as built-in `software-development` template on the same kernel, behind a per-group choice; parity tests (same records, archived groups re-render byte-identically); then cut over and delete the hard-wired path (pre-release, no aliases, P1) | after the human says the split part runs through; `npm test` + parity suite |
| 4 | `foreach` for writers (per-section re-runs), triggers/cron (#82), game-dev and UI/UX built-ins, corrections → proposed template versions (t5 L6), marketplace import from git sources with cool-down (t9 L5) | per item |

### 3.9 Cross-repo changes (Rule 16: each needs its own spec in that repo)

- **syncskill (authorised by the human, `:34`):** exact ref/SHA fetch; content-addressed multi-version store;
  `install --manifest` through the existing plan/apply contract; `inject --lock` that verifies `content_md5`;
  `validateConfig` keeps unknown keys; source ids derived from the source, with automatic migration of short keys to
  aliases (H20); an `--allow-sources` allowlist so the agent path cannot install from arbitrary URLs (t5 §1).
- **ccloop: none required for phases 1–3 [I, to verify in the spec].** The vault gives ccloop a real git worktree, so
  `worktreeRequired: true` (`schema.ts:50`) holds for plain directories too. Per-step skill sets are per-run.
  Optional later specs: report files actually read per attempt (planner precision), and prefix-replay of model/tool
  calls on retry (t1 L3).
- **Out-of-repo writes (Rule 17)**, to be registered in the flow spec: the vault `~/.orca/vault/<sha(realpath)>.git`
  (env redirect `ORCA_VAULT_DIR`; dirs 0700, files 0600; a failed attempt leaves its temp worktree under the vault's
  `tmp/`, removed on the next start or by `orca doctor`); `~/.orca/flows/{shared,personal}/` (`ORCA_FLOWS_DIR`, same
  modes). Global and project settings live in the control DB, already registered; if the spec chooses a global settings
  file instead, it is registered here with 0600. The person token is already registered in CLI v2. The syncskill content
  store is registered in syncskill's own spec. Existing files' modes are never changed.
- **CLI v2 tiers:** `orca flow` verbs that loosen an effect level or lift a lock, set or change delivery, or publish a
  template to the shared layer are in the **person-token tier** (CLI v2 §15). Running, giving feedback, editing personal
  templates, and enacting or discarding a staged effect within the person's own rights are open.
- **ccmem: optional.** Add `flowTemplate@version` and `stepId` to exported corrections, so lessons stay scoped to a
  template (ccmem has its own Rule 13; nothing breaks without it).

### 3.10 Migration and compatibility

- Pre-release, so no aliases (P1). Until phase 3 the old path stays in place and serves existing groups unchanged.
- At cut-over, back up the control DB first (as on 2026-10-21, `:15`). Live groups map to `software-development@1`
  runs with step executions built from `requirement_rounds`, drafts, estimates, work items and runs
  (`migrations.ts:71` and others). Archived groups keep rendering from their frozen records.
- Loop plans become the per-`work`-step recipe inside `software-change`. Their append-only versions carry over unchanged.

### 3.11 Risks

| Risk | Mitigation |
|---|---|
| Largest scope; two engines coexist during phases 1–3 (Rule 7) | time-boxed; one direction; phase 3 deletes the old path |
| Candidate set too large without declarations; model proposes a wrong skip | conservative code bound (unknown ⇒ include); every skip carries a reason and is shown before running; the person adjusts; optional read sets and author hints narrow it; the candidate function is pure and mutation-tested |
| Early cutoff rarely fires on LLM output | optional `equals:` projections; human "unchanged" mark |
| Vault edge cases (NFC/NFD, size caps, human drift) | as ruled in H11; drift snapshotted before each step |
| Format churn after distribution | `formatVersion`, codemods from day one, names frozen in phase 0 |
| Pause → resume never tested end to end (RAGFlow) | phase 1 done-criterion is an e2e that crosses an `ask` |
| Non-developers find the editor too technical | list + forms, no free canvas; agent-authored edits as the second path |
| A side effect hidden inside an unclassed step (C5) | accepted limitation, same nature as H22: recorded afterwards, not gated; built-in templates class every effect step; the static checklist warns when a step's skills are known effect skills but the step is unclassed |

**Size [I]:** large overall. Phase 1 is medium and is the only part that must land before writers get value.

---

## 4. Option C: prompt-first flow files

**Idea.** A template is **one Markdown file**: frontmatter (params, required skills/tools, roles, allowed effects and
their policies, gates, workspace kind) plus a prose body describing the phases and prompts. One agent session per flow,
or per phase delimited by headings, follows the prose with the skill pack injected. Orca supplies the vault, a phase
journal, typed effect requests and `ask` requests. This is the gh-aw / superpowers / OpenSpec-skills shape (t9 §0, t3 §1).

**Clarify.** To keep H23, the grilling-style clarify runs as an Orca step before the first session, and its
requirement document is the session's input. It is not left to the prose. H24's three levels apply the same way:
frontmatter `clarify: none | auto | on`, plus the per-run skip and stop.

**Data model.** Template = `flow.md`; run = sequence of phase sessions plus their artifacts in the vault; human
messages = feedback appended to the next session; effects = typed requests (as in B §3.5).

**Re-run.** The person says "redo from phase X with this feedback". A new session reads the prior artifacts and the
**agent decides** what to change.

**Dev pipeline.** Cannot be expressed without losing the code-owned estimate, split validation, kanban orchestration
and ladder, so it stays a separate hard-wired system.

**Strengths.** Authoring is prose, natural for writers and for agents; the marketplace is just Markdown files (gh-aw
`add`/`update`); prompt edits are hot; the engine is smallest.
**Weaknesses.** Routing and re-run choice are made by the model, against P7 and Rule 5. No computable rerun plan, so
H4 depends on the agent's restraint. Prompt-only ordering decays (gstack, OpenSpec, t3 L7). Long sessions repeat paid
work. Two systems remain (dev and everything else), against P1's "one engine".

Option B can run a C-style template as a degenerate case: one `work` step with a process skill plus effect steps. So C
adds no coverage B lacks [I].

**Size [I]:** small. **Cross-repo:** syncskill list; ccloop maybe longer sessions; ccmem none.

---

## 5. Comparison

### 5.1 Human requirements → how

| # | A: stages | B: flow engine | C: prompt-first |
|---|---|---|---|
| H1 steps add/remove/switch | edit stage list | edit step list; `when` | edit prose |
| H2 stop at draft box | last stage = draft effect | `work` step with md2publish-draft classed `effect: wechat-draft`; publish is `human-only` | effect allowlist |
| H3 plain dir | `dir` workspace + vault | same | same |
| H4 only some steps re-run | person picks stages; later ones reopen (over-runs) | code candidate set (unknown ⇒ include) → model proposes skips with reasons → person adjusts → code runs in order, reusing skipped outputs; cutoff by projection or "unchanged" | agent decides, no code bound |
| H5 dynamic + built-in | built-in stage lists, copies | built-in files + personal copies with base | built-in `flow.md` + copies |
| H6 distributable/marketplace | export list | pinned `requires`, provenance, import preview, 3-way update | Markdown files |
| H7 web editing | list editor | list + schema forms + derived graph + agent edit | text editor |
| H8 shared across projects | `~/.orca/flows` | `~/.orca/flows/{shared,personal}` | same |
| H9 syncskill, git sources, admin install | `requires` + admin applies | same + agent proposes the plan | same |
| H10 several skills; template carries combos | per stage | per step | one pack per flow |
| H11 vault | per stage | refs per step execution | per phase |
| H12 个人 > 共用 > 内置 | whole-template shadowing | template copies with base + 3-way; separate settings stack (project > global) | file shadowing |
| H13 game/UI-UX differ | separate lists, no parallel lanes | separate templates, parallel branches, person executors | separate prose |
| H14 agent/model suggested; 「人」 | suggestion + binding | role → tier → machine binding; `executor: person` | frontmatter suggestion |
| H15 意见 and 动手 | reopen stage / vault version | `feedback` → revision of target step; `edit` → human output recorded; later steps become candidates | appended to next session |
| H16 crafted prompts | per-stage text | versioned, layered prompt packs | the body |
| H17 clarify reused, optional | stage params | `clarify` kind params; `when` | prose |
| H18 software change pieces | `tasks` stage | `software-change` subflow reused by game dev | not addressed |
| H19 dev still dogfooding | small refactor | dev untouched until phase 3 | dev stays separate |
| H20 syncskill gaps | needed | needed | needed |
| H21 cron | trigger creates a group | trigger creates a flow run, idempotent per planned time | trigger starts a session |
| H23 grilling clarify kept | `clarify` stage, unchanged | `clarify` kind, unchanged; templates add background/sections only | Orca-run clarify before the first session |
| H24 clarify bypass | stage omitted / `auto` / per-run skip-stop | step omitted; `clarify: auto` (0-round tier + "my understanding" decision); per-run skip at start or stop mid-way ⇒ recommended answers | frontmatter `clarify: none / auto / on` + per-run skip/stop |
| H25 effect levels + project > global | stage `effect` flag reads settings | three levels per class; settings precedence; template only recommends | frontmatter recommends; settings decide |
| H26 optional admin locks | same stores | lock in global settings; lower layers only tighten; "locked by" shown | same |
| H27 configured delivery by Orca | `deliver` stage under effect level | delivery step classed `effect`, follows level; setting delivery = token tier | same |
| H22 no declarations; record, don't enforce | nothing declared; stage changes recorded per commit | nothing required; output = recorded commit/record per step; reads recorded when available; no path enforcement; rollback by refs | nothing declared; changes recorded per phase commit |

### 5.2 Principles

| | A | B | C |
|---|---|---|---|
| P1 common core, extensible | partial: stage kinds shared, no dataflow; likely rewritten later | one engine and one kind registry for all five scenarios; new scenarios are data | one runner; dev remains separate |
| P2 don't wait | a stage-level ask holds the rest of the group | per-step policies; siblings and downstream continue; unattended defaults | session waits or guesses |
| P3 object/undo/modify any time | coarse (stage) | messages at any time, branches, rewind with reapply, `by`/`via` | at session boundaries only |
| P4 fill little | stage defaults | typed params form, inferred candidates, value sources shown | prose params |
| P5 few, key decisions | today's ledger | ledger + rerun plan + flagged effects | agent's report |
| P6 Web UI and agent path | yes | yes (`orca flow` in CLI v2 registry + Web) | yes |
| P7 code decides | yes | code bounds candidates, orders and executes; the model may only remove candidates with reasons; the person decides. **fits P7 as amended (§7 O1)** | **no**: model routes and chooses reruns |

---

## 6. Recommendation

**Option B, phased as in §3.8.** Reasons:

1. **It is the only option that meets H4 and P3 by construction.** Re-running "only these steps" and accepting a
   direct edit both reduce to "record a new step output, let code bound the candidates, let the model propose skips,
   let the person adjust". This needs no read/write declarations (H22). A gives no candidate set or proposal, and C
   leaves the whole choice to the agent with no code bound (R §4).
2. **It is the common core P1 asks for, and the research converges on it.** Closed kinds, data template, journal,
   messages and typed effects each have verified prior art (R §0). The combination is the gap no surveyed system fills
   (R §1 "Gaps"). The new parts (semantic cutoff, per-person layers, enactment records) are the ones the research
   found unsolved.
3. **It protects dogfooding.** Phase 1 ships writers on the new kernel without touching the dev flow (H19). The dev
   flow moves only in phase 3, onto seams that already exist (`SingleCallHandler`, loop plans, the content-addressed
   `artifacts` table).
4. **It subsumes A and C.** A stage list is a B template without dataflow. A prompt-first flow is a B template with
   one `work` step. Neither of those directions works the other way round.

Calls I made inside B, each reversible, so not raised as questions (Rule 1 step 2):
- the ccloop loop stays the `work` unit (H18, §3.7);
- templates are files with a DB index rather than DB rows, for diffability and agent editing (t6 L1);
- model and agent are excluded from fingerprints;
- no free-canvas editor in v1 (t6 L2);
- C5 (controller, `:53`): effect policy attaches to effect-classed steps; unclassed side effects are an accepted
  limitation.

---

## 7. Ruled questions and what is still open

**Ruled (2026-10-22):**
- **Q1 adopt Option B with this phase order:** 「同意」 (`:51`).
- **Q2 default for visible-but-undoable effects:** 「可以默认直接执行再标红，但是全局/项目设置（项目设置覆盖全局设置）中可以修改为默认先弹确认卡片或默认不执行」.
  This became the three levels and precedence in §3.5–§3.6, 「同意」 (`:51-52`).
- **Q3 admin locks:** 「能锁，也能不锁」. Locks are optional per security-class field and only tighten (`:51-52`).

**Ruled after review (2026-10-22, `progress.md` last entries):**
1. **O1 → ruled.** Human 「同意」 to the P7 amendment; goal.md P7 now reads: code bounds re-run candidates (unknown ⇒
   include), the model may only propose skips with reasons, the person adjusts, unattended skips are recorded as
   minor decisions, order is code's (commit `docs(goal): P7 — code bounds re-run candidates…`).
2. **O2 → ruled, stricter than the draft reading.** Human 「同意你的处理方式」: the `irreversible` class (send email,
   public publish, …) defaults to **confirm card** (parks only that step); settings may change it to stage-only;
   changing it to apply+flag requires an admin's explicit setting and shows a standing notice in the panel.
   Visible-but-undoable classes keep apply+flag as default. Configured delivery push/PR (H27) follows the level set for
   its class.
