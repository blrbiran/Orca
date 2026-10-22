# Flow engine (Option B): one kernel for every Orca flow — design

- **Status:** design, Orca session `8b1469ea` (spec writer subagent), 2026-10-22. Not committed by the writer.
- **Adopts:** `docs/research/2026-10-21-flow-architecture-options.md` Option B with its phase order (cited "O §n");
  evidence in `docs/research/2026-10-21-flow-engine-research.md` ("R §n"); Orca fixed points in
  `docs/research/2026-10-21-flow-templates-research.md`.
- **Also folds in** (human, `progress.md:60`): (a) corrections that name only a repository plus one sentence, and the
  correction button on a bare run (§13); (b) Issue #76, revising an earlier clarify round (§10.3).
- **Neighbours:** CLI v2 `docs/superpowers/specs/2026-10-21-cli-v2-design.md` (registry §11, tiers §15, `by`/`via`
  §16); clarify caps `docs/superpowers/specs/2026-10-21-clarify-scope-caps-design.md`; checks and triggers ("S1",
  `docs/superpowers/specs/2026-10-22-checks-and-triggers-design.md`, committed `73a3e6b3`). §11.2 and §14.2 follow S1's
  settings pattern and access tiers (S1 §4.1–§4.4).
- **Ledger:** `.superpowers/sdd/2026-10-21-session-8b1469ea/progress.md`, cited `progress.md:<line>`.
- **Anchors** (Rule 14), measured with `grep -n` / `sed -n` at Orca `e4bdf4d6`–`73a3e6b3` (no `src/` change between
  them), ccloop `2a2ae53`, syncskill `3157563`, md2publish-skills `a2b9dc8`, runskills `e62c5f8`. Line numbers must be
  re-measured before a plan cites them.
- **Marks.** "(writer's call)" = decided by the spec writer under CLAUDE.md Rule 1 step 2 (reversible).
  **[BC-x]** = controller's call (session 8b1469ea, after builder check), item x. **[IR-x]** = controller's call
  (session 8b1469ea, after independent review), item x. Everything else is a human ruling (§1) or follows from one.

---

## 0. Scope and phases

One engine runs development, writing/WeChat, office, game-dev and UI/UX flows. A **flow template** is a typed document
of ordered steps; each step has a **kind** from a closed, code-owned set. Code records what each step actually changed,
keeps a journal of step executions with fingerprints, bounds re-runs, and applies side effects under per-class policy.
People talk to a run through a message stream.

| Phase | Content | Detail in this spec |
|---|---|---|
| 1 | Kernel next to the untouched dev flow; `dir` workspaces via the vault; kinds `clarify`, `draft`, `work`, `check`, `review`, `ask`; effect classes and levels; settings layers; planner; message stream; per-step tool rules; built-in `wechat-article`; run page; flow commands. Independent packages: #76 (W-76) and corrections (W-COR). Packages 5 and 8 depend on two cross-repo changes (§16.2 ccloop tool rules, §16.4 md2publish-skills) | **buildable** (§3–§17) |
| 2 | syncskill pins enforced; template layers (personal/shared), versions, Web editor, import/export, template commands | contract (§11.3, §12, §18) |
| 3 | Kinds `subflow`, `effect` (Orca adapters), `software-change`; `repo` workspaces; dev flow as built-in `software-development`; parity; delete the old path | contract (§18, §19) |
| 4 | `foreach`, `wait`, triggers/cron (S1 shape), game-dev and UI/UX built-ins, corrections → proposed template versions, marketplace import | contract (§18) |

**Dev flow untouched in phase 1** (H19): its behaviour does not change except where the human assigned a change
(#76, corrections). Code shared with the kernel is extracted byte-for-byte (§10.1, criterion C7).

---

## 1. Human rulings implemented here (verbatim; requirement IDs as in O §1.1)

| # | Ruling | Where |
|---|---|---|
| H1–H8 | writer flow through skills; 「公众号系统中的发布由我来点击」; 「大部分写文章的作者不会习惯用git管理…单独目录」; 「应该只跑特定几步…后面的某些步骤也应该省略掉」; 「我不是要你将这个微信公众号发布的流程固化下来，应该做成可动态配置的方案…用户可以随时微调形成他们自己的template」 and 「你可以直接将其做成一个内嵌的标准模板」; 「网页版模板市场」; 「模板应该要能网页编辑，或者主要通过网页编辑」; shared across projects | `progress.md:34` |
| H9–H10 | skills via syncskill, 「尽量以 git 地址为准」; 「只有特定人（比如管理员能安装 skill），普通用户只能选择/使用 skill…提前留好口子」; 「一个 run 应该能用不止一个skill」; 「模板应该就要带上对应搭配使用的 skill 组合」 | `:34` |
| H11 | vault (bare repo per dir, refs per step, temp attempt worktree, copy back, drift snapshot, never `git clean`/`checkout .`, size caps, NFC/NFD, excludes, record draft id): 「同意」 | `:36` |
| H12–H15 | 「个人 > 共用 > 内置」; 「用的工具、skill、哪一部一定需要人参与等等都跟开发的flow不一样」; 「不应该在模板中定死…顶多做到建议的 agent 和模型。同意可以加这一步是「人」的选项」; 「写意见和直接动手都要能接受」 | `:37` |
| H16–H19 | prompts in templates: 「好的实践…在用户千锤百炼/有巧思/利用心理学原理的 prompt 里」; clarify kept with per-template background/prompts/sections, optional per template; 「软件改动步骤 => 是否也要拆细？…游戏开发应该也会有改代码的步骤」; 「我还没跑通拆需求部分」 | `:40` |
| H20 | syncskill: pin by ref/SHA, content-addressed multi-version store, manifest install, lock-verified inject, keep unknown keys: 「同意」; source short names collide | `:45` |
| H21 | **no required read/write declarations**: 「管不住 agent 的行为吧？一些 skill 会约束产物路径。一些skill 不会，如果是开发 flow 的话，你更控制不了每一步的产物了。」, 「开发 flow 怎么做？每一步 group 或 task 都不知道自己要读/写哪些文件。你这个方案局限性太大，也限制太死了吧」; replacement (record after the fact; code bounds, model proposes, person adjusts): 「同意你建议的方案…」 (O §1.1 calls this H22) | `:49` |
| H22 | grilling-style clarify is the core asset: 「我们当前的澄清流程就是参考 mattpocock 的 grilling skill 做的。这是我觉得 orca 的一个亮点。…」 (O: H23) | `:48` |
| H23 | clarify optional at three levels (omit / `auto` 0-round / per-run skip or stop): 「同意」 (O: H24) | `:50-51` |
| H24 | effects: 「可以默认直接执行再标红，但是全局/项目设置（项目设置覆盖全局设置）中可以修改为默认先弹确认卡片或默认不执行。」 → three levels, project > global, template recommends under "follow template": 「同意」 | `:51-52` |
| H25 | admin locks: 「能锁，也能不锁」 | `:51` |
| H26 | configured delivery must be executable by Orca; only setting/changing it needs the person token (CLI v2 R3a) | `:26`; controller call `:57` |
| H27 | adopt Option B with this phase order: 「同意」 | `:51` |
| H28 | P7 amended (code bounds re-run candidates, the model may only propose skips, the person decides): 「同意」 | `:55`; goal.md P7 |
| H29 | `irreversible` defaults to a confirm card; stage-only allowed; apply+flag only by an admin's explicit setting with a standing notice: 「同意你的处理方式」 | `:56` |
| H30 | corrections: 「纠正只写「仓库＋一句话」、由 debug agent 自己定位」, human 「可以，但是我更希望你早点把 decisions 接好」; bare-run button: 「同意，但是这个当前基本无效，因为人可能不清楚哪个具体task / group 有问题。但是现在的 group / task 的决定要记录在 decision 中的这条路也要尽快接好。」 | `git show e76224a3:docs/handoff/handoff.md` lines 161-162; correction-debug spec §2, §12.3 |
| H31 | #76: 「Requirements 页面不允许修改之前轮次的决策」; tester's preferred shape: edit in the UI, a new round underneath, history immutable | `orca_archived_files/issue-20261008.md` §Issue 76 |
| H32 | §23 H-A: 「a」 — each step may declare allowed commands and whether it needs network/secrets; Orca passes them to ccloop as per-contract tool rules (a ccloop change) | `progress.md` end (2026-10-22) |
| H33 | §23 H-B: 「b」 — md2publish-skills gains an explicit switch Orca passes (`--confirmed-by-orca <effect-record-id>`) | same |
| H34 | §23 H-C: 「a」 — the built-in WeChat template pins `blrbiran/runskills` and `blrbiran/md2publish-skills`; these repos stay public | same |
| H35 | §23 H-D: 「a」 — `cost` stays apply + flag by default; budget caps are the backstop | same |

The decisions wiring H30 waited on is merged (`docs/handoff/handoff.md:122`), so H30 is unblocked.

---

## 2. Vocabulary

- **Template**: an `orca-flow-v1` document plus its asset files (prompts, fragments, rubrics), `<layer>/<id>@<version>`.
- **Flow run**: one execution of a pinned template. **A flow run is a parent group** (`flow_runs.group_id`, 1:1): it
  shows on the kanban, holds the run budget pool, and is the target of messages. **Each `work` step execution runs in
  its own hidden child group** (§6.2) [IR-C2].
- **Step key**: the step's stable `id`; nested keys `parent/child` (subflow) and `each[<itemKey>]/child` (foreach).
- **Execution**: one attempt to produce a step's output, numbered `seq` per step key. Each step key has one **active**
  execution (`step_heads`); older ones stay addressable.
- **Output**: what an execution actually changed — a vault commit (workspace steps) or a record in `artifacts`
  (`clarify`, `draft`, `review`, `ask`). Never declared in advance (H21).
- **Composition**: the vault commit built from the import commit plus every earlier step's **active** output in
  template order; the base every execution starts from (§5.3) [IR-C3].
- **Message**: a person's (or `orca-auto`'s) input to a run: `feedback`, `edit` or `command` (§8).
- **Effect class / level**: what a step's side effect is (`local`, `cost`, `external`, `irreversible`; `human-only`
  is not allowed in a flow) and how it is gated (`apply-flag`, `confirm`, `stage-only`) (§9).

---

## 3. The template document `orca-flow-v1`

### 3.1 Shape

zod, `.strict()` at every level (unknown keys rejected: ralph's dead config, R §6, §10). No layout, no run state, no
machine bindings (R §0).

```yaml
format: orca-flow-v1
id: wechat-article                # stable slug; never renamed (labels are separate, R §10 n8n id-healing)
version: 3                        # written by publish; a draft has none
title: {en: WeChat article, zh: 公众号文章}
base: builtin/wechat-article@2    # only on copies (§11.3)
params:                           # typed slots -> generated form (P4)
  idea:          {type: longtext, required: true}
  slug:          {type: slug, derive: slug-of-idea}
  coverImage:    {type: path, required: false}
workspace: {kind: dir, excludes: [".md2publish/cache/"]}     # dir (phase 1) | repo (phase 3)
roles:
  writer:   {tier: high, suggest: {agent: claude}}           # suggestions only (H14, goal.md §5.7)
  reviewer: {tier: high, distinctFrom: writer}
requires:
  skills:
    - {source: github.com/blrbiran/runskills, ref: <40 hex>, path: skills, skills: [tech-writer]}
    - {source: github.com/blrbiran/md2publish-skills, ref: <40 hex>, path: skills,
       skills: [md2publish-article, md2publish-cover, md2publish-draft]}
  commands:
    - {name: md2wechat, check: "md2wechat doctor --json"}    # a check, never an installer (R §2)
effects:                          # effect kinds are template-defined; code knows only the classes (§9.1)
  image-generate: {class: cost}
  wechat-draft:   {class: external}
steps:
  - {id: brief, kind: clarify, mode: auto, background: prompts/brief.md, sections: [Reader, Purpose, Angle, Must-use material]}
  - id: draft
    kind: work
    role: writer
    skills: [tech-writer]
    prompt: prompts/draft.md
    tools: {commands: [{exact: "wc -m '{{param.slug}}.md'"}], network: false}
    acceptance: {checks: [{id: exists, run: "test -s '{{param.slug}}.md'", role: gate}]}
    loop: {until: {check: exists}, max: 2}
  - {id: article, kind: work, skills: [md2publish-article], prompt: prompts/article.md}
  - {id: cover, kind: work, skills: [md2publish-cover], effect: image-generate, parallelWith: article,
     when: {not: {param: coverImage, truthy: true}}}
  - {id: to-draft-box, kind: work, skills: [md2publish-draft], effect: wechat-draft, recommendedLevel: confirm}
```

### 3.2 Field reference

| Field | Rule |
|---|---|
| `params.<id>.type` | closed: `text`, `longtext`, `enum{options}`, `bool`, `int`, `path` (workspace-relative, no `..`), `slug` |
| `params.<id>.derive` | closed, code-evaluated: `slug-of-idea`, `today`. No model call in defaults (Rule 5) |
| `roles.<r>` | `tier: low|mid|high`, optional `suggest {agent?, model?}`, optional `distinctFrom: <role>` |
| `requires.skills[]` | `source` = syncskill source id (§16.1), `ref` = 40-hex commit, `path` = subdir, `skills` = names |
| `effects.<kind>` | `{class: local | cost | external | irreversible}`; the only place effect kinds come from in phase 1–2 [IR-I11] |
| step `id` | slug, unique in the template, immutable across versions (a rename is remove + add) |
| step `kind` | one of §4 |
| step `role` / `executor` | `executor: agent | person | either` (default `agent`); `person` allowed on `ask`, `work`, `review` (H14) |
| step `skills` | ⊆ the names in `requires.skills`; one inject per execution, so many skills per step and different sets per step (H10) |
| step `prompt`, `vars` | asset path; vars are params and run metadata only (§12.1) |
| step `tools` | (H32) `{commands?: [{exact: <cmd>} | {prefix: <cmd prefix>}], network?: bool (default false), secrets?: [ENV_NAME]}`; passed to ccloop as `toolRules` (§16.2). Absent = today's behaviour. Required checks are always allowed in addition. A bare interpreter prefix (`python3`, `bash`, `node`, `bun`) is a checklist **error** (it would allow any script) [IR-I9] |
| step `acceptance.checks[]` | `{id?, run, role: gate | diagnostic}`; gate failing ⇒ execution fails; diagnostic output is fed to the next execution (R §5). `run` may use `{{base:<path>}}` (§12.1) |
| step `when` | structured predicate, code-evaluated: `{param, equals|in|truthy}`, `{classification: {scope?, clarity?}}`, `{and|or|not}`. No expression strings |
| step `effect`, `recommendedLevel` | an effect kind from `effects:`; classes the **whole step** (§9) |
| step `parallelWith` | optional ordering hint: may run concurrently with the named step (§6.5) |
| step `loop` | `{until: {check: <check id>} | {verdict: pass}, max: n}` on `work`/`review`; not on effect-classed steps (§9.6) |
| step `onFailure` | `{retry: n, then: ask | fail}`; `subflow` from phase 3; not on effect-classed steps |
| step `hints` | **optional only** (H21): `skipWhen` (text for the proposal model), `owns` (labels for feedback triage), `equals` (cutoff projection: `verdict`, `headings(<path>)`, `json(<path>, <pointer>)`) |

The only data reference a template may hold is `foreach.over` (phase 4, O §3.2). Prompts get earlier steps' outputs as
code-generated pointers (§12.1), never as declared inputs.

### 3.3 Validation: save vs publish vs start

- **Save** (draft) checks only that the file parses as YAML; a broken draft can be saved (R §5).
- **Publish** and **start** run the static checklist: schema; unique step ids and check ids; `skills` ⊆ `requires`;
  every asset exists; every `{{var}}` resolves; `when` refers to existing params; `loop.until.check` names a gate check
  of the same step; `parallelWith` names an existing step; `distinctFrom` names an existing role; every `effect` names a
  kind in `effects:`; `human-only` absent; `executor: person` only on allowed kinds; no bare interpreter prefix in
  `tools`; warning (not error) when an unclassed step uses a skill that a built-in template classes as an effect (§9.5).
- Errors block; warnings show. The checklist is one pure function shared by Web, CLI and the start path.

### 3.4 Format versioning

`format` is `orca-flow-v1`. Names in this section and §4 are frozen before any distribution (gh-aw shipped 75
codemods, R §10). A later format ships a codemod `v1 → v2` that runs on load and on import; files are rewritten only on
the next save.

---

## 4. Step kinds (closed set, registered in code)

### 4.1 Registry contract

Each kind registers once (`src/flow/kinds/registry.ts`, writer's call on the path); a duplicate fails at start-up
(R §6). Registration = `{kind, kindVersion, schema (zod, drives validation and the Web form), start(ctx) ⇒ dispatch,
collect(ctx) ⇒ output, projection?(output, hint) ⇒ bytes, interactive: boolean}`. `kindVersion` is stored on every
execution row. This generalises `SingleCallHandler` (`src/control/singleCallPurposes.ts:25`), which stays the
mechanism under `clarify`, `draft` and `review`.

### 4.2 The kinds

| Kind | Phase | Code owns | Model's part (Rule 5) | Output |
|---|---|---|---|---|
| `clarify` | 1 | today's grilling-style rounds, caps, consensus, document assembly (§10) | questions, classification, 0-round judgement | requirement document record |
| `draft` | 1 | one single call, schema-validated output, invalid ⇒ existing retry path | the content | record |
| `work` | 1 | an agent session through ccloop in a hidden child group (§6.2); afterwards whatever changed is recorded | the work | vault commit |
| `check` | 1 | a command; `role: gate` fails the step, `diagnostic` feeds the next execution | — | record (exit code, bounded output) |
| `review` | 1 | isolated judge (`distinctFrom`), template rubric, typed verdict `{verdict: pass|revise|fail, findings[]}`; runs only after gates pass; `revise` queues a revision of `reviews: <stepId>` with the findings as an `orca-auto` feedback message, at most `maxRounds`, then proceeds flagged red (R §5) | the verdict | record |
| `ask` | 1 | typed form; candidates from the model or from an earlier step's reported `flow.candidates.<name>` (`candidatesFrom: {step, name}`); free text always offered (R §3); `policy: confirm-before | review-after`; timeout policy; unattended ⇒ default + minor decision; the answer is written into the workspace through `writeTo` (§4.4) | candidates, default | record |
| `effect` | 3 | an Orca adapter for an action Orca already owns: `git-land-local`, `push`, `pr-open` | — | effect record |
| `subflow` | 3 | a pinned child template with its own journal; parent-close policy (R §1) | — | child run's outputs |
| `software-change` | 3 | composite: ccloop loop (plan → execute → verify) per task under a loop plan, landing, criteria protection, reconcile, `onFailure` = debug group → ladder (§19) | the work | landed commit |
| `foreach` | 4 | expansion over a list record from an earlier `draft`, children keyed by item key (R §1) | — | children |
| `wait` | 4 | durable timer or message wait; generalises `scheduler_wakes` | — | — |

**H18 (writer's call, carried from O §3.7):** the ccloop loop stays the unit of software work. Finer pieces are template
steps around `software-change` (tests-first task, review, docs); game-dev reuses `software-change` with its own skills.
Splitting ccloop's phases into Orca steps would duplicate ccloop and need per-phase skill dirs (ccloop accepts one,
ccloop `src/control/protocol.ts:258`).

### 4.3 Interactive skills inside unattended steps (writer's call; needed by H1)

Several of the human's skills ask the user through `AskUserQuestion`: wechat-finetune (audience profile, purpose,
title candidates, `wechat-finetune/SKILL.md:74,91,99`), md2publish-visuals (every spend, `md2publish-visuals/SKILL.md:187,196`),
md2publish-article (overwrite an existing `.html`, `md2publish-article/SKILL.md:86`), md2publish-draft (before any
upload, `md2publish-draft/SKILL.md:11,64`). md2publish-cover does **not** ask before a single cover
(`md2publish-cover/SKILL.md:122`) [IR-I10]. A ccloop session has no person to answer, so code appends a fixed,
code-owned fragment to every `work`/`review` prompt (templates cannot remove it). Rules:

1. A question the skill would ask the user is answered from the run's inputs (clarify document, `ask` records, the
   workspace) when they answer it; otherwise take the recommended option and **report it as a decision** (P2, P5).
2. A confirmation a skill requires before a side effect is satisfied **only** by an Orca effect record id printed in
   the prompt (the step was gated by its level, §9), passed to skills that have an explicit switch for it (H33:
   md2publish-skills `--confirmed-by-orca <effect-record-id>`, §16.4). Without one, the agent stops before the side
   effect and reports `flow.needs = {kind: "confirmation", what, payloadSummary}`.
3. A question that cannot be defaulted (no recommended option exists) ⇒ report `flow.needs = {kind: "input", question,
   candidates[]}` and stop.
4. [BC-B8] When a skill would offer the user a choice that the template turns into a later `ask` step (e.g. title
   candidates), the agent picks the recommended one and lists all candidates in its result under
   `flow.candidates.<name>` (≤ 3 plus the recommended index).

The run result gains a top-level `flow` key beside `decisions` and `debug`, read only through
`src/control/reportedDecisions.ts` (the module that owns result keys). `flow.needs` ⇒ the execution ends
`needs-person`; code opens an `ask` for it (parks only that step and later ones in order, P2); the answer queues a
revision execution carrying it. A `needs: confirmation` from an **unclassed** step is how an unclassed side effect
becomes visible before it happens, when the skill itself asks (§9.5).

### 4.4 Ask answers land in the workspace [BC-B8]

An `ask` step may name `writeTo`, a deterministic target from a closed set: `{file, frontmatter: <field>}` or `{file,
json: <pointer>}` (path workspace-relative, `{{param.*}}` expanded). When the answer differs from what the file holds,
code writes it and records the change as a person `edit` (`by` = the person who answered, or `orca-auto` for an
unattended default): a vault commit that becomes the ask step's active output, so the next composition (§5.3) holds it
and later steps become candidates by the ordinary rule (§7.2). A missing file or field fails the write with a red flag;
nothing else is touched. Candidates come only from an earlier step's report (§4.3 rule 4) or the model, never from
parsing a field the skill does not promise to write.

---

## 5. Workspaces and the vault

### 5.1 `dir` workspace (phase 1)

A plain directory the person owns (H3). The project registry (`~/.orca/projects.json`, `src/panel/projectsFile.ts`)
gains an optional `kind: "repo" | "dir"` per entry (absent = `repo`, every existing file still parses); a `dir` project
is not required to be a git repository, and if it is one, its `.git/` is excluded and never touched: every Orca ref,
workspace and landing for a `dir` project lives in the vault, never in the person's `.git`. Project settings (§11.2)
key on the project id as for repositories. (writer's call)

**`dir` groups never integrate** [IR-I7]: every flow group (parent and child) on a `dir` project has delivery `keep`
fixed by code; no integration pass runs; `set-group-integration` on them is refused `flow-group-delivery-fixed`. The
person's folder is updated only by copy-back (§5.4).

### 5.2 The vault (H11, as ruled)

- `$ORCA_VAULT_DIR/<sha256(NFC(realpath(dir)))>.git`, a bare repository created with `git init --bare --shared=0600`
  (§20). One vault per directory, shared by every flow run on it.
- **Import commit** [IR-I6]: a new vault's `HEAD` is unborn. At every run start code snapshots the folder (excludes and
  caps applied) into a commit `orca: import` whose parent is the previous import (none the first time), stored at
  `refs/orca/import/<n>` and as the run's `refs/orca/<flowRunId>/base`. The vault's `HEAD` is never relied on: every
  branch is created with an explicit start point (§5.3).
- **The vault is the driver's target repository** [BC-B1]: the existing execution driver, workspace modes and landing
  are reused; repository resolution maps a `dir` project to its vault (a bare repo supports `git worktree add`). Child
  groups' `refs/heads/orca/<childGroupId>` (`src/control/workspace.ts:44`), attempt commits and landings live in the
  vault. Workspaces themselves are created where today's driver creates them, under the control state's
  `.workspaces` root (`workspace.ts:34`), with their git metadata in the vault.
- **Limits:** the per-file cap (default 50 MB) and per-snapshot cap (default 500 MB) apply to **import and drift
  snapshots**, which code makes; files over cap are excluded and listed, never dropped silently. Attempt commits are
  made by today's `commitAttempt` (`git add -A`, no size cap, `workspace.ts:113-119`), so an over-cap file an agent
  creates is committed; code lists it in the execution record (no cap is added to `commitAttempt` in phase 1).
  `core.precomposeUnicode=true`; paths compared after NFC. Default excludes in the vault's `info/exclude` (`.git/`,
  `node_modules/`, `.DS_Store`) plus `workspace.excludes`.
- **Remote ids:** an effect step's reported `flow.effect = {remoteId, url?}` (e.g. the WeChat `media_id`,
  `md2publish-draft/SKILL.md:124`) is stored on its effect record.

### 5.3 Base composition and the flow head [IR-C3]

- **Before each execution** of a workspace step S, code composes its base: start from the run's import commit; for each
  step earlier than S in template order that has an active output (`step_heads`), merge that output's change (its
  commit against its own parent) into the accumulated tree with `git merge-tree --write-tree`; `commit-tree` the
  result. Conflict ⇒ S does not start; the conflicting earlier step is flagged red with reason `compose-conflict` and
  becomes a candidate (§7.2). The composition commit is S's base, recorded on the execution (`base_commit`), and S's
  child branch is created there (`ensureWorkBranch(targetRepo, childGroupId, startPoint)`, `workspace.ts:64`, which
  already takes a start point).
- **Flow head:** `refs/orca/<flowRunId>/head` holds the composition of every active output. After S's child lands, code
  sets S's `step_heads` entry to the new execution and advances the flow head by compare-and-swap
  (`compareAndSwap`, `workspace.ts:128`) from the value it read to the new composition; a failed CAS (a sibling moved
  it) ⇒ recompose and retry.
- **Rewind and skip only move `step_heads`.** Nothing rewrites history; the next composition reflects the pointers.

### 5.4 Copy-back to the person's folder, drift

- **Copy-back:** after every flow-head advance, code applies the change from the previous flow head to the new one to
  the folder (add, modify, delete). A path whose folder content differs from the previous head's blob (the person
  edited it meanwhile) is merged three-way (`git merge-file`); on conflict the person's file is left byte-identical, the
  step's version stays in the vault, and the execution is flagged red with a "resolve" action (an `edit`). A delete is
  applied only when the file still equals the previous head's blob. **Never** `git clean`, `checkout .`, or a
  whole-tree overwrite.
- **Drift** [IR-I6]: before each execution code snapshots the folder; paths that differ from the flow head are the
  person's drift. The drift is placed at the earliest step whose active output wrote any drifted path, else at the
  start (§7.2), and committed onto that step's active output as a **person-authored execution** of that step
  (`by` = project owner, `via: fs`), so the next composition includes it and the planner sees it as an `edit`.
- **Rewind** (§8.3) moves pointers; the next flow-head advance copies the difference back by the same rule, after a
  drift snapshot, so nothing the person wrote is lost.

### 5.5 `repo` workspace (phase 3)

Today's workspace modes (`src/control/workspaceSettings.ts`), attempt commits and landing; the step output is the
landed commit. No vault.

---

## 6. Journal, outputs, execution substrate

### 6.1 Tables [IR-I5]

Schema steps: **the next schema version after whatever has landed** (today `schemaVersion = "15"`,
`src/control/migrations.ts:3`). In order: (1) S1's step (`check_state`, the `integrationCheck` settings move, S1 §4.1,
§5), then (2) this spec's step (the tables below and the `requirement_rounds` re-key of §10.1). If both are built
together they may share one step; either way **one control DB backup** precedes the first, as on 2026-10-21
(`progress.md:15`). All tables `STRICT`, bodies JSON.

| Table | Key columns | Notes |
|---|---|---|
| `flow_runs` | `id` PK, `group_id` UNIQUE → `groups` (parent), `template_ref`, `template_sha256`, `workspace` (project id + kind), `vault_id`, `params_sha256`, `pool_tokens`, `pool_drawn`, `state`, `revision`, `body` | expanded template bytes stored once in `artifacts` (`migrations.ts:11`), so archived runs re-render |
| `step_executions` | PK `(flow_run_id, step_key, seq)`; `kind`, `kind_version`, `state` (`queued`,`running`,`done`,`failed`,`skipped`,`needs-person`,`parked`,`staged`), `definition_hash`, `base_commit`, `ran_on`, `fingerprint`, `output_kind` (`commit`,`artifact`,`none`), `output_ref`, `output_hash`, `read_set_hash` NULL, `reasons`, `plan_no` NULL, `child_group_id` NULL (→ `groups`, `work` only), `by`, `via`, times, `body` | append-only rows; state moves forward only |
| `step_heads` | PK `(flow_run_id, step_key)`, `active_seq` | the only mutable pointer; every move is also a `command` message (audit, Rule 13) |
| `flow_messages` | PK `(flow_run_id, seq)`, UNIQUE `(flow_run_id, request_id)`; `kind`, `target` (`run`, `step`, `execution`, `round`, `effect`), `body`, `by`, `via`, `state` (`accepted`,`applied`,`rejected`,`excluded`), `reason` | §8 |
| `rerun_plans` | PK `(flow_run_id, plan_no)`; `state` (`proposed`,`chosen`,`running`,`done`,`abandoned`), `candidates`, `proposal`, `chosen`, `by`, `via` | §7 |
| `effect_records` | `id` PK; `flow_run_id`, `step_key`, `seq`, `effect_kind`, `class`, `level`, `policy` (value + source + lockedBy), `state` (`staged`,`confirmed`,`applied`,`discarded`,`failed`), `payload_hash`, `remote_ref`, `by`, `via`, times | §9; immutable except `state` forward |
| `flow_decisions` | PK `(flow_run_id, seq)`; `grade` (`major`,`minor`), `step_key`, `body`, `by` | decisions of `dir` runs, written by landing instead of `.decisions/` (§6.2); `repo` runs keep the git ledger |
| `flow_templates` | PK `(layer, id, version)`; `sha256`, `path`, `published_by`, `published_at` | index of template files (§11.3) |

`by` is a person or `orca-auto`; `via` ∈ `web`, `cli:<client>`, `mcp:<client>`, `fs` (drift), `orca`.

### 6.2 Work steps run in hidden child groups [IR-C2, supersedes BC-B1's synthetic-task form]

- **Parent:** the flow run's group, body block `flow: {role: "parent", flowRunId, projectId, workspaceKind,
  vaultId}`. It has no tasks of its own and holds the run budget pool (§6.3).
- **Child:** each `work` execution opens a child group `flow-<flowRunId>-<stepKey>-<seq>` (deterministic, idempotent),
  body block `flow: {role: "child", flowRunId, parentGroupId, stepKey, seq, baseCommit, effectRecordId?}`. Children are
  hidden from the kanban and shown inside the parent's run page; `orca-auto` drives them; `maxRunningGroups` counts the
  parent only (writer's call; children run under it).
- **Plan builder.** A dedicated `buildFlowStepPlanSource` (precedent: `buildSystemDebugPlanSource`,
  `src/control/systemDebug.ts:109`; `buildDebugPlanSource`, `src/control/debugPlan.ts:174`) produces a one-task plan:
  taskId `step`, no loop plan, labels `[]`, no `dependsOn`, and an inline contract: `goal`/`successCondition` from the
  rendered prompt envelope; `repoPath` = the vault; `targetPaths: ["**"]`; `buildTestCommands`/`requiredChecks` = the
  step's gate checks, else the default gate "the attempt changed at least one path" (ccloop requires ≥ 1 check, ccloop
  `src/contract/schema.ts:39,65`); `executionPolicy.toolRules` from the step's `tools` (§16.2); for effect-classed steps
  `maxAttempts: 1` and the §9.6 rules. `deriveContract` carries `toolRules` and the effect-step `maxAttempts` unchanged
  into the snapshot.
- **Confirmation without an estimate.** The child is imported with no estimate row (the correction-debug spec §5 import
  mode) and confirmed by `orca-auto` with a deterministic command id, its single `work` allocation drawn from the
  parent's pool (§6.3). `readConfirmedTaskExecution` (`src/control/executionSnapshot.ts:329`) then works unchanged.
- **Repository resolution.** `groupRepoId` (`src/control/executionDriver.ts:211`, today `plan.repoId ??
  requirement.repoId`) also reads `flow.projectId`; a `dir` project resolves to its vault path.
- **Branch start:** the child's work branch starts at `baseCommit` (§5.3).
- **Decisions on landing (driver change).** For a group with `flow.workspaceKind = "dir"`, landing
  (`src/control/driverLanding.ts:262-263`, today `writeRunLedger` into `.decisions/` + `git add -f`) writes the reported
  and code-authored decisions to `flow_decisions` in the same DB transaction that records the landing and commits no
  `.decisions/` file; the crash-recovery probe for `.decisions/<runId>.jsonl` (`driverLanding.ts:98-111`) uses the
  `flow_decisions` rows for these groups instead. `repo` groups are unchanged.
- **Completion:** when the child lands (delivery `keep`, §5.1), the kernel records the execution's output (the landed
  commit), moves `step_heads`, advances the flow head (§5.3) and copies back (§5.4). A failed child marks the execution
  `failed`; the parent shows it.
- **Single calls.** `draft`, `review`, `ask`-candidates and the rerun proposal are new single-call purposes on the
  parent group (`src/control/singleCall.ts:11` gains `flow-draft`, `flow-review`, `flow-ask`, `rerun-proposal`);
  `clarify` reuses `clarify` (§10.1).

### 6.3 Budgets [BC-B2, IR-C2]

The parent is confirmed **once, at start**, with a run budget pool (`flow_runs.pool_tokens`): `project.flows.budgets.
tokensPerRun ?? global.flows.budgets.tokensPerRun ?? the template's suggested budget ?? a built-in default`. No estimate
call (P4). Each child is confirmed with an allocation drawn from the pool (the step's `budget` suggestion, else an even
share of what remains, capped by today's `TASK_WORK`); unspent allocation returns to the pool when the child settles.
Single calls on the parent draw from the same pool. When the pool cannot fund the next execution, **only that run
parks** with a needs-you item: raise the pool (human-only, like `set-limit`) or stop. Spend caps (`spend_caps`) apply
unchanged.

### 6.4 Fingerprints (`fp1`, frozen)

- `definitionHash = H(step's expanded definition bytes, prompt bytes after fragment expansion, skills lock entries
  (source id, resolved commit, content_md5) for the step's skills, check commands, tools, kindVersion)`.
- `ranOn = H(base_commit's tree id, ordered list of (stepKey, active outputHash) for every earlier step,
  params_sha256)`. The order key is `(template position, step id)`, stable however parallel siblings finish.
- `fingerprint = H(definitionHash, ranOn)`. **Agent and model are recorded but excluded** (they are suggestions, H14).
- `outputHash`: for a commit, `H(sorted (path, blob id) changed vs its parent)`; for a record, the `artifacts` hash.

### 6.5 Parallel steps

Steps joined by `parallelWith` start from the same composition, each in its own child group. Their outputs meet only in
the next composition (§5.3); a `compose-conflict` flags red and makes the later of the two a candidate. No silent
overwrite.

---

## 7. Re-run planner (P7 as amended, H21, H28)

### 7.1 When a plan is made

On a `feedback` or `edit` message to a run that has executions; on a params change; on re-pinning the run to a new
template version; on drift detected outside a running step; on `orca flow plan`.

### 7.2 Candidate set (code, conservative, pure)

`candidates(journal, template, messages, workspaceState) → [{stepKey, reasons[]}]`. A step is a candidate if any holds:

| Reason | Rule |
|---|---|
| `definition-changed` | its current `definitionHash` ≠ its active execution's |
| `upstream-changed:<stepKey>` | recomputing its `ranOn` now differs from the active execution's; **without a complete recorded read set, every earlier change counts** (unknown ⇒ include). A read set may remove an upstream reason only when present, marked complete, and disjoint from the changed paths (none in phase 1) |
| `feedback` | a feedback message targets it |
| `never-succeeded` | no active `done` execution |
| `compose-conflict` | its active output no longer merges into the composition (§5.3) |

Drift is an `edit` (§5.4): the step it is placed at is not a candidate; later steps get `upstream-changed`. A step
targeted by an `edit` is **not** a candidate (its new output is the edit); later steps are. A step whose `when`
evaluates false is recorded `skipped` and is never a candidate.

### 7.3 Proposal (model, may only remove)

One single call (`rerun-proposal`) receives the candidates with reasons, the message text, bounded diffs of the
changed outputs, step labels and `hints.skipWhen`. Output schema: `{skips: [{stepKey, reason}], startAt?: stepKey}`.
Code validates: every key is a candidate; `startAt` becomes skips of earlier candidates; a feedback-targeted step may
not be skipped; anything else ⇒ invalid ⇒ existing retry path; exhausted ⇒ no proposal (plan = all candidates). The
model cannot add, reorder or change anything.

### 7.4 The person decides

Web: the plan as a checklist (candidates ticked, proposed skips unticked with their reasons, non-candidates
addable), "accept as unchanged" per output, Run. CLI: `orca flow plan <run>` / `orca flow rerun <run> [--skip a,b]
[--add c] [--plan <n>]`. A plan the person has not run stays `proposed`; only that run waits (it is the person's own
revision request); the setting `flows.rerunReview: auto` instead runs it with the proposal at once (the person can
still stop or rewind). **Unattended** sources (`orca-auto` review revisions, triggers, needs-person answers given by
default) take the proposal as is, and **each model skip is recorded as a minor decision** (`flow_decisions`, or the
ledger for `repo` runs) the person can correct later by feedback (P3, P5).

### 7.5 Execution (code)

Chosen steps run in template order (`parallelWith` concurrency allowed); skipped steps keep their active outputs, which
the composition carries forward. After each execution code recomputes candidacy: a step leaves the plan when all its
reasons are gone (cutoff: the re-run output's `equals` projection or `outputHash` is unchanged, or the person marked it
unchanged). Steps only ever leave a chosen plan; code never adds one without the person. Failed or rate-limited
executions are never reused (R §4). Every execution stores its `reasons`, shown before and after it runs.

---

## 8. Human message stream (H15, P3)

### 8.1 Kinds

| Kind | Accepted | Effect |
|---|---|---|
| `feedback` | always (deduped by `request_id`) | target = run, step, execution or round. A run-level feedback is triaged by a model call to step(s) using `hints.owns` labels (classification, Rule 5); the person sees and can change the triage. Each targeted step gets a revision execution with the feedback in its prompt; §7 plans the rest |
| `edit` | when the target exists | the person's change becomes a new active output of that step (`by` = the person): a record value (Web form/CLI `--file`) or files (Web upload, or drift `via: fs`). The edited step is not re-run |
| `command` | validated; **rejections are recorded too** | budget, pause/resume a step, retry with new options, move the active pointer (undo/rewind), confirm/enact/discard an effect, answer an `ask`, re-pin template version |

### 8.2 Rules

- **Never kills a running step**: a message is consumed at the next step boundary (R §3, LangGraph `enqueue`).
- **Never blocks siblings**: an open `ask` (`review-after`) lets later steps run on its default; a `confirm-before`
  ask or a needs-person execution parks only itself and the steps after it in order; other branches and other groups
  continue (P2).
- **Drift is an edit** (§5.4).

### 8.3 Rewind keeps later messages

`command rewind {toStep, toSeq?, exclude?: [messageSeq]}` moves the active pointer of `toStep` (to an older execution,
or to "not run") and makes later steps candidates. Messages sent after the rewound point are **re-applied** unless
excluded (R §3, Temporal reset): feedback is re-queued on its targets; an edit is re-applied as a three-way patch on the
re-run output (record fields by field, files by `git merge-file`), and an edit that no longer applies becomes feedback
text ("the person had made this edit: …") on that step, flagged red. Code does all of this; no model decides what is
re-applied.

---

## 9. Effects (H24–H26, H29, H35)

### 9.1 Classes and defaults [IR-I11]

Code knows only the **classes**; effect kinds are declared by templates (`effects:`, §3.2). From phase 3 code also owns
its adapter kinds for the `effect` kind (`git-land-local` local, `pr-open` external, `push` irreversible).

| Class | Examples (template-declared) | Default level |
|---|---|---|
| `local` | land to a local branch | `apply-flag` |
| `cost` | image generation, a paid model batch | `apply-flag`; budget caps are the backstop (H35) |
| `external` | WeChat draft, PR open, email draft | `apply-flag` |
| `irreversible` | push, send email, merge to main | **`confirm`**; `stage-only` allowed; `apply-flag` only by an admin's explicit setting, with a standing panel notice (H29; deferred with CLI v2, §11.2). **Configured delivery** (push/PR set in the Web UI) runs as `apply-flag` there: the setting is the person's explicit choice (H26) |
| `human-only` | public publish | not allowed in a flow; the flow ends before it (H2) |

### 9.2 Levels

| Level | What happens | Who waits |
|---|---|---|
| `apply-flag` | the step runs; its effect record is `applied` and flagged red for review | nobody |
| `confirm` | a confirm card (step, effect kind, a code-built summary from the latest outputs, policy source) before the step starts | only that step and later steps in order |
| `stage-only` | the step does not run; an immutable effect record `staged` `{step, effect kind, ranOn, policy snapshot}` is stored; enacting it later runs the step then (Web and CLI); discarding closes it | nobody; the flow continues or ends without the effect |
| `follow-template` (a settings value) | use the step's `recommendedLevel`; none given ⇒ the class default | — |

An enacted or confirmed record id is printed into the step's prompt (§4.3 rule 2). Enacting a `staged` record whose
`ranOn` no longer matches shows the difference and asks again (a new record is made; the old one is not edited).

### 9.3 Resolution (pure, shown with provenance)

For a step: `level = project.flows.effects[class] ?? global.flows.effects[class] ?? builtinDefault(class)`; if the
value is `follow-template`, use the step's `recommendedLevel` (an `irreversible` step can never resolve to `apply-flag`
through a template). Locks (§11.2) then clamp: a locked class may only be tightened (`apply-flag` < `confirm` <
`stage-only`). Every resolved level carries `{value, source: project|global|template|builtin, lockedBy}`.

### 9.4 Classing is per step (O §3.1)

`effect:` classes the whole step; the step is gated as a unit even though an agent with a skill performs it (no Orca
WeChat adapter; md2publish-draft does the upload).

### 9.5 Accepted limitation, and what narrows it

An unclassed step that causes a side effect on its own cannot be gated, only recorded afterwards (same nature as H21).
Narrowed by: built-in templates class every effect step; the publish checklist warns when an unclassed step uses a skill
that some built-in template uses in an effect-classed step (derived from the built-ins, no hard-coded skill names);
§4.3 rule 2 makes a confirmation-asking skill stop and surface `needs: confirmation`; per-step `tools` (§16.2) narrow
what a step can run.

### 9.6 How effect-classed steps execute [BC-B4]

- `maxAttempts: 1`; no default "changed at least one path" gate (an upload may change no file); template gates still
  apply; no automatic retry, no continuation, no `loop`, no `onFailure.retry`.
- Failure ⇒ the execution ends `failed`, the effect record `failed`, a red flag; only the person retries
  (`orca flow retry <run> --step s` / Web), which creates a new effect record.
- The effect record id is printed in the prompt as an **idempotency key** with the instruction to pass it wherever the
  target API accepts one (and to report `flow.effect.remoteId` either way), and it is the value passed as
  `--confirmed-by-orca` (§16.4).

---

## 10. The clarify step

### 10.1 Reuse (H22) and storage [BC-B6]

Phase 1 extracts today's round machinery behind a `ClarifyHost` interface with two hosts:

- **requirement host** (dev flow, today): background "one software repository" and the repository overview
  (`src/control/requirementClarify.ts:19`), sections as today; consensus ⇒ split draft (unchanged).
- **flow host**: background, question focus and document sections from the template step (`background`, `focus`,
  `sections`); context = the run params and a bounded listing of the composition; consensus ⇒ the step completes with
  the requirement document as its output record.

Both use the store `requirement_rounds`, the call purpose `clarify`, the caps (`CLARIFY_CAPS`,
`src/control/requirementSchemas.ts:43`) and the verbs (`requirement-answer`, `-consensus`, `-clarify-more`,
`-classify`, and `-revise` from §10.3). **Criterion C7:** for a dev requirement the prompt bytes equal a golden captured
before the extraction.

**Storage.** This spec's schema step (§6.1) rebuilds `requirement_rounds` (create new table, copy, drop, rename, in one
transaction, after the backup) with primary key `(group_id, step_key, exec_seq, round_no)`, columns `step_key TEXT NOT
NULL`, `exec_seq INTEGER NOT NULL CHECK(exec_seq > 0)`; every existing row maps to `step_key = 'clarify'`, `exec_seq =
1`, other columns byte-identical. Every reader and writer (`writeRound`, `latestRound`, `clarifyLimits`,
`src/control/requirementRecords.ts:163-202`) takes `(groupId, stepKey, execSeq)`; the requirement host always passes
`('clarify', 1)`. `ClarifyHost = {groupId, stepKey, execSeq, background(), context(), sections(), onConsensus()}`. A
flow `edit` at round k of a clarify step **is** `requirement-revise` with the step's key and execution.

### 10.2 Optional at three levels (H23)

1. The template omits the step.
2. `mode: auto`: the round-1 answer may set `zeroRound: true` with a one-line `understanding`; code accepts it only
   when the effective class is small + clear. Consensus is then reached at once with no questions, and the
   understanding is recorded as a minor decision the person can object to by feedback on the step.
3. Per run: param `clarify: skip` at start (the document is the idea, marked "not clarified"), or stop mid-way with
   today's consensus verb (unanswered questions recorded as open with the recommended answer shown, `2fc90b6c`).

### 10.3 Revising an earlier round (Issue #76; W-76, may land before the kernel)

On the message model this is an **`edit` at round k** of the clarify step, re-advancing from there, versioned, never
overwriting.

- **Verb** `requirement-revise {groupId, stepKey?, execSeq?, roundNo: k, answers, glossaryDecisions, adrDecisions,
  reason?, exclude?: [roundNo]}`, access `any` like `requirement-answer`; `orca requirement revise <group> --round k
  --file <answers>`. Allowed when round k is on the active chain and `answered`, the group is not stopped, and no split
  draft is `accepted` (else `requirement-already-accepted`; after acceptance the route is feedback on the group or a
  correction, §13). The payload covers exactly round k's ids (same checks as `requirement-answer`,
  `requirementCommands.ts:123-125`) and differs in at least one item (else `revision-unchanged`).
- **Storage:** appends round row `n+1` (n = highest `round_no` for that step execution) in state `answered` with
  `{revises: k, result: <round k's result copied>, answers, glossaryDecisions, adrDecisions, reason, by, via}`. No
  existing row is changed.
- **Active chain** (pure, `src/control/clarifyChain.ts`, shared by both hosts): process rows by `round_no`; a plain
  row appends; a `revises: k` row replaces chain position of k and drops every later position. Dropped rows are
  "superseded" (computed, never stored). The UI numbers rounds by chain position ("Round 2, revised") and shows
  superseded rounds collapsed under the revision.
- **Re-advance:** consensus, if reached, is withdrawn (a new activity row; the requirement block records
  `consensusWithdrawn {at, by, revisedRound}`); an `awaiting-review` split draft is closed `rejected` with reason
  `requirement-revised` (an existing state). If the chain length is below the round cap, code queues one clarify call
  drafting the next round on the active chain. Superseded rounds' questions and answers go into that prompt as
  "earlier answers that may still apply": a question still asked carries the earlier answer as its recommended answer
  (rewind keeps later messages, §8.3) unless the person excluded that round. At the cap, clarification stops as today
  and `clarify-more` grants one more.
- **Caps count chain positions**, not `round_no` (`clarifyLimits`, `requirementRecords.ts:202`; the comparison at
  `requirementCommands.ts:133` changes accordingly).
- **Cost:** at most one clarify call per revision; the dialog says so before sending.

---

## 11. Layers, settings, locks, versions

### 11.1 Two independent stacks (H12, H24, H25)

- **Template layers** resolve the template document by id: **personal > shared > built-in**. Never silent: a
  personal template that shadows a built-in shows "overrides builtin/<id>@<v>".
- **Settings layers** resolve run policy field by field: **project > global > built-in default**.

### 11.2 Settings [IR-I12: same pattern as S1 §4]

- Project: optional field `flows` in the `repository_settings` body (`src/control/workspaceSettings.ts:28-38`); global:
  `flows` in the `orchestration_settings` body (`src/control/orchestration.ts:74-88`). **Locks live only in the global
  layer** (`flows.locks`). No new out-of-repo write.
- `flows = {effects?: {local|cost|external|irreversible: level | "follow-template"}, rerunReview?: "auto" | "review",
  roles?: {<role>: {agent, model}}, allowedSkillSources?: [sourceId], budgets?: {tokensPerRun?}, locks?: [path]}`.
- **Lockable (security-class) paths only:** `effects.<class>`, `allowedSkillSources`, `budgets.tokensPerRun`. Nothing
  is locked by default. A locked field may only be tightened; a looser project write is refused `flow-setting-locked`
  naming the lock; an existing looser project value is ignored while the lock stands and shown struck through,
  "overridden by lock".
- Verbs (S1 §4.4 shape): `set-flow-settings` (repository or `@orchestration`) `{set: {...}, clear: [field]}`;
  `set-flow-locks` (`@orchestration` only) `{locks: [path]}`. Both `human-only` (§14.2).
- `irreversible: apply-flag` needs the owner with the person token and shows a standing notice. **Deferred to CLI v2
  §15** [BC-B5]: phase 1 refuses it from every channel (`flow-setting-needs-person-token`) and enables it when CLI v2's
  token lands.
- Reads return per field `{value, source: "project" | "global" | "builtin", lockedBy: "global" | null}`; Web and
  `--json` render exactly that.
- "Admin" = the panel owner until multi-user (S1 §4.2).

### 11.3 Template files, versions, draft vs live (phase 2; phase 1 ships built-ins only)

- Built-in: Orca repo `flows/builtin/<id>/` (`flow.yaml`, `prompts/`, `fragments/`, `assets/`), seeded into the index
  by upsert-by-id, never overwriting copies (R §8).
- Shared / personal: `$ORCA_FLOWS_DIR/{shared,personal}/<id>/draft/` (mutable) and `…/versions/<n>/` (immutable).
  **Publish** = static checklist passes → copy `draft/` to `versions/<n+1>/` → record sha256 in `flow_templates`. Live =
  highest published version. Saving a draft never changes live.
- **Run pinning:** a run stores `template_ref` and the expanded bytes' sha256 (bytes in `artifacts`) and never changes
  version by itself; re-pinning is a `command` and makes changed steps candidates (§7.2).
- **Copies:** "customise" copies a template into personal with `base: <layer>/<id>@<v>`. When the base publishes a new
  version, the UI offers a three-way update (`git merge-file` per file against the base's recorded bytes); conflicts
  are shown and left for the person (R §2). Prompts are never deep-merged.
- **Import** (`orca template import <path | git URL@sha>`): preview with one decision per item (`skip`, `replace`,
  `create`, `copy`), missing skills listed as "needs admin install", newer `format` behind an explicit confirm, imports
  land in personal as copies (R §8). **Export** writes the template dir with pins, never settings, bindings or secrets.
- Access (phase 2, today's tiers): template reads and personal writes `any`; publishing to **shared** `human-only`
  (person token with CLI v2).

---

## 12. Prompts, skill bundles, roles

### 12.1 Prompts are template assets (H16)

Prompt packs are versioned files in the template dir. Code builds every prompt in a fixed envelope (R §2): stable role
prefix → template instruction (the step's `prompt`, fragments expanded once, R §10) → **code-generated pointers to
every earlier active output** (paths changed with step labels; record summaries) → acceptance (gate checks, rubric) →
the code-owned unattended fragment (§4.3). Variables: `{{param.<id>}}`, `{{run.id}}`, `{{workspace}}` (**the attempt
worktree**, where the agent works; never the person's folder), `{{skill.<name>.dir}}` (the injected copy),
`{{effect.recordId}}`; in check commands also `{{base:<path>}}` = a read-only temp copy of `<path>` as it was at the
execution's `base_commit` (for before/after checks such as `fidelity.py <old> <new>`) [IR-I10]. Unknown ⇒ checklist
error.

### 12.2 Skill bundles (H9, H10, H20)

- `requires.skills` names `(source id, ref, path, skills)`; each step injects its own set (one inject per execution).
- **Phase 1** (before syncskill pins): inject by names through today's path; the lock's `resolved_commit` is compared
  with `ref` and a mismatch shows a warning on the run page; fingerprints use the actual `content_md5`, so re-run
  planning stays truthful.
- **Phase 2:** `syncskill inject --lock` verifies the pinned `(sourceId, sha, content_md5)`; a missing pin refuses
  start with `skill-pin-missing`, naming the install an admin must apply. **Trust is per pin:** an admin installing
  `(sourceId, sha)` is the trust act; a template update to a new sha needs a new admin install (TOFU per pin, R §8).
  Agents may *propose* the install plan; only an admin applies it (H9). Sources outside `allowedSkillSources` are
  refused.

### 12.3 Roles and capability suggestions, resolved per machine (H14)

At run start code resolves each role: `project.flows.roles[r] ?? global.flows.roles[r] ?? template suggest ?? the
existing default agent selection (src/control/agentSelection.ts)`, filtered by `tier` and `distinctFrom`. Unresolvable
⇒ the run refuses to start with `role-unresolved:<r>`; never borrows silently (R §2). The resolution and its source are
recorded per execution. `executor: person` turns the step into a person task (an `edit` completes it).

---

## 13. Corrections on the message model (H30; W-COR)

A correction is a **feedback message after the work finished**, aimed as precisely as the person can aim it. Its
handler is per kind: for `software-change` work (today's dev groups) it opens a debug group (correction-debug spec,
unchanged path); for a flow step it is a `feedback` message (§8) and the planner runs.

### 13.1 Targets

The corrections store row (`src/corrections/schema.ts:30-91`) keeps `projectKey` required and allows exactly one of:
`decisionId` (today) · `runId + pendingId` (today) · **`runId` alone (bare run)** · **none (repository only)**. The
schema rule changes from "exactly one target: decisionId, or both runId and pendingId" (`schema.ts:76-82`) to the four
shapes above; `pendingId` without `runId` stays invalid. Absent optional fields are omitted from the canonical JSON,
so every existing correction id and fix-run id is unchanged (criterion with a stored fixture, as in correction-debug
spec §12.3).

**`dir` projects** [BC-B7]: a `dir` project has no git remote, so its corrections use `projectKey = dir:<project id>`
(a namespace that can never equal a remote URL). In phase 1 they stay local: recorded, shown, and handled as flow
feedback, and **not exported to ccmem** — the exporter skips the `dir:` namespace by name. Exporting them needs a ccmem
contract change (an identity that is not a git remote), which is ccmem's own spec under Rule 16, later.

### 13.2 Repository + one sentence

- The person writes one sentence (`because`, required) and picks the project (defaults to the current one); `kind`
  is pre-set `wrong` and changeable (`not_my_taste` still requires `chose_instead`, schema rule). Nothing else.
  Web: "Correct…" on the project's corrections page. CLI: `orca correction record --because "<sentence>"`
  (project from cwd or `--project`).
- The debug group's frozen input (built by code, Rule 5): the sentence; for the landed groups of that project in the
  window (the smaller of the last 10 landed groups and the last 14 days, writer's call, both settings), each group's
  requirement title, reported decisions (question, chose), and landed commit range; diff text capped at today's inline
  limit with the cut recorded.
- The contract's first required result: `debug.located = {groupId?, runId?, decisionId?, paths[], because}`, reported
  as a **major** decision (the model locates, code bounded where it may look, the person sees it, P7). Then today's
  reproduce-then-fix. Cannot locate ⇒ the task fails `not-located` with the agent's notes; the person may withdraw and
  record a narrower correction.

### 13.3 Bare run

A "Correct" button beside a finished task in the group view (and beside a finished step execution in a flow run).
For a task: target `runId`; the debug input is that run's frozen evidence as for a decision target (correction-debug
spec §4.2) without the decision row, plus the run's reported decisions.

### 13.4 Closing, metrics, memory, access

Both new targets close like a pending-target correction: one `decision` row, **no `overturned` row** (the person named
no ledger row; an agent never writes `overturned`). If the agent located a decision, the closing row's `because` cites
it. Metrics report them on their own line beside "corrections on unrecorded decisions"; the ccmem export names the
target in the head (corrections-to-ccmem spec, the pending-target rule). Access in phase 1: today's `VERB_ACCESS`
(`correction-record` is `human-only`, `src/panel/humanOnly.ts:70`); any opening for an attended socket agent is CLI v2
§15.1's change [BC-B5].

---

## 14. Surfaces (P6)

### 14.1 Web

- **Run page:** steps in order with state, active execution, reasons it ran, output (diff or record), red flags, child
  groups' progress; the message box (feedback / edit / command) per run, step and execution; the rerun plan checklist
  (§7.4); open asks and confirm cards; effect records with enact/discard; decisions; provenance of every effective
  policy value; each tool rule's enforcement status (§16.2).
- **Settings:** `flows` fields per project and global, with source and lock shown.
- **Editor (phase 2):** a step list; a form per step generated from the kind's zod schema; a derived **read-only**
  graph (order, `parallelWith`, nesting); the static checklist; Save draft / Publish. No free canvas (R §5).
- A flow run (the parent) appears on the kanban with a template badge; children do not.

### 14.2 Commands and access [BC-B5, IR-C1]

Every verb gets a control verb, a `VERB_ACCESS` entry in **today's two tiers** (`src/panel/humanOnly.ts`) and, once the
CLI v2 registry exists, a registry row (its verb-coverage test forces it). Phase 1 does **not** build CLI v2 §15: no
person token, no dispatched-run marker. Nothing here loosens today's access; S1 §4.4 made the same choice.

| Command (phase 1 unless marked) | Verb | `VERB_ACCESS` |
|---|---|---|
| `orca flow start <template> (--dir <path> | --project <id>) [--param k=v]… [--clarify skip]` | `flow-start` | `any`; field `pool` `human-only` (like `requirement-open.limit`) |
| `orca flow show|list|journal <run>` | reads | — |
| `orca flow feedback <run> [--step s] [--execution s#n] --text <t>` | `flow-message` (feedback) | `any` |
| `orca flow edit <run> --step s (--file f | --set k=v)` | `flow-message` (edit) | `any` |
| `orca flow plan <run>` | `flow-plan` | `any` (computes and proposes; spends one single call) |
| `orca flow rerun <run> [--skip][--add][--plan n]` | `flow-rerun` | `human-only` |
| `orca flow rewind <run> --to s[#n] [--exclude m…]` | `flow-message` (command) | `any` |
| `orca flow answer <run> <ask> (--file f | --set k=v)` | `flow-answer` | `human-only` |
| `orca flow pause|resume|stop|retry <run> [--step s]` | `flow-message` (command) | `any` (as `retry-task` today) |
| `orca flow effect confirm|enact|discard <record>` | `flow-effect` | `human-only` |
| `orca flow repin <run> --version n` | `flow-message` (command) | `any` |
| `orca flow pool raise <run> --tokens n` | `flow-pool` | `human-only` |
| `orca flow settings show [--project p]` | read | — |
| `orca flow settings set|clear <field> [<value>] [--project p]` | `set-flow-settings` | `human-only` |
| `orca flow settings lock|unlock <field>` (global only) | `set-flow-locks` | `human-only` |
| `orca template list|show|copy|validate|import|export` (phase 2) | reads / personal writes | `any` |
| `orca template publish <id> [--shared]` (phase 2) | `template-publish` | `any` personal; `human-only` shared |
| `orca requirement revise <group> --round k --file f` | `requirement-revise` | `any` |
| `orca correction record [--run r] --because <t>` | `correction-record` | `human-only` (unchanged) |

Unattended paths act as `orca-auto` (rerun proposals taken as is, unattended ask defaults) with deterministic command
ids, as S1 §4.4. When CLI v2 lands, its §15 table decides which rows open to an attended socket agent and adds the
dispatched-run refusals; that is CLI v2's change. Template edits through the agent path (phase 2) are structured
(`orca template step add|remove|move|set <id> …`); whole replace requires `--if-revision` (CLI v2 §6.3).

---

## 15. Built-in `wechat-article` (H1, H2, H5, H34)

The human's chain (`wechat-finetune/SKILL.md`: `tech-writer` → `tech-writer-deslop` → `tech-writer-voice` →
`wechat-finetune` → `md2publish-article` → `md2publish-draft`; visuals before article; cover parallel to article).
`effects:` declares `image-generate: {class: cost}` and `wechat-draft: {class: external}` [IR-I11]. Every step
declares `tools` (H32); no bare interpreter prefix [IR-I9]. Commands in md2publish steps run from the injected skill
directory (`cd '{{skill.<name>.dir}}'` exact, then the skill's own scripts), and rely on §16.4's script files.

| # | Step id | Kind | Skills | Effect / policy | Acceptance, tools, notes |
|---|---|---|---|---|---|
| 1 | `brief` | `clarify`, `mode: auto` | — | — | background: an article for a WeChat official account; focus: reader, purpose, angle, must-use material, length; sections from tech-writer's step 0 (`tech-writer/SKILL.md:18`) |
| 2 | `outline` | `work` | tech-writer | — | gate `test -s '{{param.slug}}.outline.md'`; `hints.equals: headings({{param.slug}}.outline.md)`; tools: none beyond checks |
| 3 | `approve-outline` | `ask`, person | — | `review-after`, default approve | form `{approve: bool, notes: longtext}`; downstream runs on the unratified outline (P2) |
| 4 | `draft` | `work` | tech-writer | — | gate `test -s '{{param.slug}}.md'` |
| 5 | `deslop` | `work` | tech-writer-deslop | — | diagnostic `python3 '{{skill.tech-writer-deslop.dir}}/scripts/scan.py' --json '{{param.slug}}.md'` (exits 0 by design, R §5); tools: that exact command, `network: false` |
| 6 | `voice` | `work` | tech-writer-voice | — | gate `python3 '{{skill.tech-writer-voice.dir}}/scripts/fidelity.py' '{{base:{{param.slug}}.md}}' '{{param.slug}}.md'` (fidelity takes `<old> <new>`, `fidelity.py:112-113`) [IR-I10]; diagnostic `voice.py` likewise; tools: those exact commands, `network: false` |
| 7 | `finetune` | `work` | wechat-finetune | — | writes `<slug>.wechat.md`; reports `flow.candidates.title` (§4.3 rule 4) |
| 8 | `pick-title` | `ask`, either | — | `review-after`, default = recommended candidate | `candidatesFrom: {step: finetune, name: title}`; `writeTo: {file: '{{param.slug}}.wechat.md', frontmatter: title}` (§4.4); ≤ 3 candidates + free text (`wechat-finetune/SKILL.md:74`) |
| 9 | `visuals` | `work` | md2publish-visuals | `image-generate` (cost): apply + flag by default (H35); recommends `confirm` | `when: {param: illustrations, truthy: true}` (default off); passes `--confirmed-by-orca '{{effect.recordId}}'` (its spend question, §16.4); tools: `cd` exact + the skill's `shared/scripts/*` commands as prefixes, `network: true`, provider key names in `secrets` |
| 10 | `article` | `work` | md2publish-article | — | output `<article-name>.html` named after its source (`md2publish-article/SKILL.md:86`): gate `test -s '{{param.slug}}.wechat.html' || test -s '{{param.slug}}.wechat.illustrated.html'` [IR-I10]; passes `--confirmed-by-orca '{{run.id}}'` so an existing `.html` is overwritten without asking (the vault keeps the old version; §16.4); `md2wechat inspect` as a prefix rule |
| 11 | `cover` | `work`, `parallelWith: article` | md2publish-cover | `image-generate` (cost): apply + flag by default (H35); budget caps are the backstop; recommends `confirm` (applies only under `follow-template`) | `when: {not: {param: coverImage, truthy: true}}`; a single cover does not ask (`md2publish-cover/SKILL.md:122`); tools: exact `cd '{{skill.md2publish-cover.dir}}'`, prefixes `python3 shared/scripts/preflight.py`, `python3 shared/scripts/compose_prompt.py`, `python3 shared/scripts/artifacts.py`, `python3 shared/scripts/compress.py`, `bun shared/scripts/imagegen/main.ts`, plus §16.4's replacement scripts for today's inline `python3 -c` lines (`md2publish-cover/SKILL.md:130,149,164,191`); `network: true`; provider key names in `secrets`; a cover is mandatory for a draft (`md2publish-draft/SKILL.md:37`) |
| 12 | `to-draft-box` | `work` | md2publish-draft | `wechat-draft` (external): apply + flag by default; recommends `confirm` | `requires.commands`: `md2wechat doctor --json` (passing ≠ IP whitelist ok, `md2publish-draft/SKILL.md:23`); passes `--confirmed-by-orca '{{effect.recordId}}'` (H33); tools: `md2wechat` subcommand prefixes, `network: true`, `secrets: [WECHAT_APPID, WECHAT_SECRET]`; reports `flow.effect.remoteId = media_id` |

The run ends at the draft box; the run page says publishing is the person's click in the WeChat backend (H2,
`human-only`). Pins (H34; the repos stay public): `github.com/blrbiran/runskills@<sha>` (path `skills`) and
`github.com/blrbiran/md2publish-skills@<sha of the commit with §16.4>` (path `skills`). Secrets come from the machine,
never from the template (R §8). tech-writer-deslop's stop-slop MIT attribution travels with the skill; the template
pins, never copies (R §12).

---

## 16. Cross-repo work (Rule 16: each change gets its own spec in its repo; nothing here relaxes their rules)

### 16.1 syncskill (human-authorised, `progress.md:34,45`) — required by phase 2

| # | Change | Today (syncskill `3157563`) |
|---|---|---|
| S1 | **Pin by ref/SHA**: install and update take `--ref <40-hex | tag>`; tags resolve to a SHA at install and are recorded; branches are refused for pinned entries | checkout clones `--single-branch --depth 1 --branch <branch>` then `reset --hard FETCH_HEAD` (`src/source.ts:1775,1779`) |
| S2 | **Content-addressed multi-version store**: `(sourceId, sha)` → immutable tree; several versions side by side; links/inject point at a version | one checkout per source name |
| S3 | **Manifest install**: `install --manifest <file>` (list of `{source, ref, path, skills}`) through the existing `--plan`/`--apply` contract | per-URL install |
| S4 | **Lock-verified inject**: `inject --lock <file>` copies exactly the pinned `(sourceId, sha, skill, content_md5)` and fails on any mismatch (new exit code) | lock written, never verified (`src/inject.ts:16`, spec `2026-10-03-profile-inject-version-design.md`) |
| S5 | **Keep unknown config keys** on load and save | `validateConfig` rebuilds the object from known keys (`src/config/config.ts:94-126`) |
| S6 | **Collision-free source ids** (controller's proposal, `progress.md:45`): git `host/owner/repo[/subdir]`; local `local/<dirname>-<sha8(realpath)>`; the short name becomes a display alias; skill identity = source id + skill name + pinned version; automatic migration of existing keys, old keys kept as aliases in syncskill's own config | key = `options.name ?? parsed.skillName` (`src/source.ts:2304`); skills owned first-come by name (`:1302`) |
| S7 | **Admin allowlist**: `--allow-sources <file>` (or config) so the agent path cannot install from arbitrary URLs | none |

The content store is registered as an out-of-repo write in syncskill's own spec. Orca calls syncskill only through its
CLI with `--json`.

### 16.2 ccloop: per-contract tool rules (H32) — a ccloop spec first; phase-1 packages 5 and 8 depend on it

**Required change (Rule 16: specified and landed in ccloop under ccloop's own rules before Orca uses it).** The work
contract gains optional `executionPolicy.toolRules = {commands: [{kind: "exact" | "prefix", value}], network:
boolean, secretEnv: [name]}`. Absent ⇒ today's behaviour exactly. Requirements Orca places on the ccloop spec:

- **Never widen.** A rule an agent kind cannot express exactly is left out and recorded with the reason, never replaced
  by a broader rule (the principle ccloop already applies to required checks,
  `src/runtime/claude/claudeAgentAdapter.ts:110-134`).
- **Report status per rule** [IR-I8]: `enforced` (blocked before it runs), `detected` (a violation is seen after the
  fact and fails the attempt), `recorded-only` (declared, not checked), `refused(reason)` (not expressible). Orca shows
  it on the run page and flags `detected`, `recorded-only` network and `refused` rules red.
- **Per agent kind (today, and the expected mapping):**
  - *claude*: today only required checks become `--allowedTools Bash(<cmd>)` rules; commands containing `*`,
    parentheses, a backslash, control characters or edge whitespace are refused because claude would read them
    differently (`claudeAgentAdapter.ts:120-134,185-186`). `exact` maps the same way under the same refusals (`enforced`);
    `prefix` maps to claude's prefix form only if the prefix passes the same refusals, else `refused`. `network: true`
    allows the web tools; claude cannot block network from inside Bash, so `network: false` is `recorded-only`.
  - *codex*: today `--sandbox <installation sandbox>` for execute, `read-only` otherwise
    (`src/runtime/codex/runCodexPhase.ts:42`, `src/agents/codex.ts:38`); `network` maps to the workspace-write
    sandbox's network switch (`enforced`); codex exec has no per-command allowlist, so `commands` are `recorded-only`.
  - *omp*: today a fixed tool-name set per phase (`src/runtime/omp/ompProtocol.ts:33`); ccloop sees each `bash` tool call
    in the protocol stream and can fail the attempt when a command breaks the rules — **`detected`, not `enforced`**
    (the command has already run); `network` is `recorded-only`.
  - *secretEnv*: **there is no environment filter today** (every adapter spawns with `...process.env`), so every
    variable already reaches the agent. In phase 1 `secretEnv` is **declared and recorded only**; whether ccloop adds
    filtering (pass only named secrets) is the ccloop spec's decision.
- **Unchanged and verified by reading:** attempt worktrees come from `git worktree add --detach <path> <HEAD>` on
  `repoPath` (ccloop `src/workspace/worktreeManager.ts:27`, `src/controller/runLoop.ts:1546`); with the vault as the
  driver's target repository the driver hands ccloop a workspace whose git metadata is in the vault (a bare repo
  supports `git worktree add`); `worktreeRequired: true`, `autonomyLevel: "L2"` hold (`src/contract/schema.ts:45,50`);
  per-step skill sets are one directory per run (ccloop `src/control/protocol.ts:258`). **Criterion C14 proves the
  vault path**; if it fails, the builder stops and reports.
- Optional later ccloop specs: report files read per attempt (planner precision, §7.2), prefix replay on retry.

### 16.3 ccmem: optional

Add `flowTemplate@version` and `stepKey` to exported corrections from flow runs, and an identity for `dir:` projects
(§13.1) — both ccmem's own spec, phase 4.

### 16.4 md2publish-skills (H33) — cross-repo, the human's repo; phase-1 package 8 depends on it

Changed under that repo's own rules (Rule 16); the built-in template pins the commit that has all of it [IR-I9, IR-I10]:

1. **Switch** `--confirmed-by-orca <id>` (documented in each SKILL.md, read by the agent from its instructions):
   md2publish-draft skips its confirm before `upload_image`/`create_draft` (`md2publish-draft/SKILL.md:11,64`) and
   prints the id in its summary; md2publish-visuals skips its spend confirmation (`md2publish-visuals/SKILL.md:187,196`);
   md2publish-article overwrites an existing `<article-name>.html` without asking (`md2publish-article/SKILL.md:86`).
   md2publish-cover needs no switch for a single cover (`md2publish-cover/SKILL.md:122`); its retry-spend question
   (`:175`) follows the same switch. Without the switch every skill behaves as today.
2. **Script files instead of inline `python3 -c "…(…)"`** (`md2publish-cover/SKILL.md:130,149,164,191`,
   `md2publish-diagram/SKILL.md:67`, and any like them): each becomes a script under `_shared/scripts/` (synced into
   `shared/scripts/` by the repo's own `sync-shared.sh`), so exact/prefix tool rules can express them (claude refuses
   rules containing parentheses or `*`, §16.2).

runskills: no change.

---

## 17. Phase 1 build detail

Order (each package ends green on `npm test`, Rule 18):

| # | Package | Content | Needs |
|---|---|---|---|
| 0 | Probes | C14 (vault as driver target); `dir` entries in `projects.json` and the panel's repository listing | — |
| 1 | Template core (pure) | `src/flow/template/` schema, static checklist, `when` evaluator, variable expansion, built-in loader | — |
| 2 | Storage | this spec's schema step (§6.1) incl. the `requirement_rounds` re-key (§10.1); one backup | after S1's step if that landed first |
| 3 | Vault | `src/flow/vault/`: import, composition, flow head, copy-back, drift (§5.2–§5.4), `ORCA_VAULT_DIR` | — |
| 4 | Journal + planner (pure) | fingerprints `fp1`, `candidates()`, proposal validation, cutoff | — |
| 5 | Kinds | `draft`, `check`, `review`, `ask` (+ `writeTo`), `work` (child groups, plan builder, pool draws, landing to `flow_decisions`), `clarify` (`ClarifyHost`); unattended fragment + `flow` result key; `toolRules` in contracts | ccloop tool-rules spec landed and pinned (§16.2) for `toolRules`; everything else may land before |
| 6 | Messages + execution | stream, rerun execution, rewind, needs-person asks | — |
| 7 | Effects + settings | classes, levels, resolution, locks, provenance reads, standing notice (deferred part per §11.2) | — |
| 8 | Built-in `wechat-article` | files under `flows/builtin/wechat-article/`, prompts written for the human's skills, pins | §16.2 and §16.4 landed |
| 9 | Web | run page, settings, kanban badge | — |
| 10 | Commands | control verbs + `VERB_ACCESS` per §14.2; registry rows when CLI v2's registry exists | — |
| W-76 | #76 | §10.3; independent of 1–10 except the shared `clarifyChain.ts` and the re-key | — |
| W-COR | corrections | §13; independent | — |

---

## 18. Phases 2–4: what must stay stable

| Contract | Frozen from | Why |
|---|---|---|
| `format: orca-flow-v1` field names (§3.2), step and check id rules | phase 1 | distribution and copies (R §10) |
| kind names, `kindVersion` semantics, result schemas of `clarify`/`draft`/`review`/`ask` | phase 1 | journal rows reference them |
| `fp1` (§6.4) | phase 1 | changing it re-runs everything; a new definition is `fp2` with both readable |
| candidate reasons and the "model may only remove" rule (§7) | phase 1 | P7 |
| message kinds, targets, `by`/`via` values (§8) | phase 1 | audit (Rule 13) |
| effect classes, levels, resolution order, lockable paths (§9, §11.2) | phase 1 | settings written by people |
| vault layout, ref names, composition rule (§5.2–§5.4) | phase 1 | user data on disk |
| parent/child `flow` group blocks (§6.2) | phase 1 | recovery reads them |
| `flow` result key in run results | phase 1 | agents' reports |
| step `tools` shape and its mapping to ccloop `toolRules`, rule statuses | phase 1 | ccloop contract (§16.2) |
| command names (§14.2) | phase 1 | no aliases after release (P1) |
| `ClarifyHost` interface, `clarifyChain`, `requirement_rounds` key | phase 1 | shared by dev and flows until phase 3 |

Phase 2 adds layers, versions, editor, import/export and syncskill enforcement without changing these. Phase 3 adds
`repo`, `subflow`, `effect`, `software-change`. Phase 4 adds `foreach`, `wait`, triggers (S1 §8 shape: `(trigger,
plannedAt)` keyed, missed slots collapse, failure-streak pause, credited to the last publisher; unattended runs turn asks
into defaults plus minor decisions), more built-ins, corrections proposing template versions (R §9: count by exact key,
threshold, propose a diff, human approves, regression eval).

---

## 19. Phase 3: the dev flow onto the kernel, then delete the old path

**Precondition:** the human says the split part runs through (H19).

| Today | Built-in `software-development` |
|---|---|
| clarify rounds | `clarify` step, requirement host's background becomes template data (`requirementClarify.ts:19` text moves to `prompts/`) |
| split (`requirementSplit.ts:17`, task schema `requirementSchemas.ts`) | `draft` step with today's split schema |
| estimate | `draft` step (estimate handler) |
| confirm (= start) | `ask`, `confirm-before`, person |
| per-task loop, landing, criteria protection (`criteriaProtection.ts:22`), reconcile | `foreach(over: split.tasks)` → `software-change` |
| debug groups, ladder, system debug | `software-change.onFailure` subflow |
| integration check, model review | S1 §8 built-in check templates |
| delivery | `effect` step, `pr-open` (external) or `push` (irreversible); configured delivery runs `apply-flag` (§9.1) |

- Behind a per-group choice first; **parity suite**: the same requirement through both paths yields equal records
  (rounds, drafts, estimates, work items, ledger rows), and archived groups re-render byte-identically.
- Cut-over: back up the control DB; map live groups to `software-development@1` runs with executions built from
  `requirement_rounds`, drafts, estimates, work items and runs; archived groups keep rendering from frozen records.
- Then **delete** the hard-wired transitions and the requirement host's special cases; no aliases (P1). The deletion
  list is the builder's first plan task, measured by `grep`.

---

## 20. Out-of-repo writes (Rule 17 registration)

| Path (env redirect) | Writer / trigger | Modes | Failure residue |
|---|---|---|---|
| `$ORCA_VAULT_DIR` (default `~/.orca/vault/`), `<sha>.git` per directory | flow kernel: run start (import), each execution (drift, composition), landing (child branches), flow-head advance | dirs `0700`, files `0600` via `--shared=0600` | refs are written last (`update-ref`, CAS), so no partial output; unreferenced composition objects are collected by `orca flow vault gc` |
| child workspaces | today's driver, under the control state's `.workspaces` root (`workspace.ts:34`), git metadata in the vault | as today | cleaned up as today's driver does |
| the person's `dir` folder | copy-back only (§5.4) | **existing files' modes never changed**; new files `0600`, new dirs `0700` (writer's call: the person can widen them) | none beyond the paths a flow-head advance changed; conflicts leave the person's file untouched |
| `$ORCA_FLOWS_DIR` (default `~/.orca/flows/`), `{shared,personal}/<id>/{draft,versions/<n>}` (phase 2) | template copy, save, publish, import | `0700` / `0600` | temp + rename; a failed publish leaves no version dir |
| settings, journal, messages, effects, decisions | control DB (already registered) | — | — |

---

## 21. Success criteria (Rule 4: commands with exit codes; Rule 9: every named mutation seen red; Rule 18: `npm test`)

All run by `npm test` (exit 0); each file also alone with `npx vitest run <file>`. Mutations are made in a
`git clone --local` copy (Rule 15).

| # | Criterion (test file) | Mutations that must turn it red |
|---|---|---|
| C1 | template schema + checklist (`tests/flow/templateSchema.test.ts`): unknown key, duplicate step/check id, skill not in `requires`, effect kind not in `effects:`, `human-only` class, unknown var, `loop.until` naming a missing check, bare `python3` prefix in `tools`, `executor: person` on `check` all refused; save accepts a broken draft, publish/start refuse it | drop `.strict()`; run the checklist on save; allow a bare interpreter prefix |
| C2 | planner (`tests/flow/rerunPlanner.test.ts`, table-driven) | treat "no read set" as "read nothing"; accept a model key outside the candidates; let the model skip a feedback-targeted step; execute in proposal order; cutoff drops a step with another live reason; reuse a failed execution; put the model id into `fingerprint` |
| C3 | vault copy-back (`tests/flow/vault.test.ts`, temp `ORCA_VAULT_DIR`): dir `0700`/file `0600`; first run creates the import commit in an unborn vault; unchanged files keep inode and mtime; a concurrent human edit merges; a conflicting edit leaves the person's file byte-identical and flags red; NFD name round-trips; over-cap snapshot file listed; pre-existing file mode unchanged | full-tree overwrite on copy-back; apply a delete on a changed file; rely on the vault `HEAD` |
| C4 | composition (`tests/flow/composition.test.ts`, IR-C3): after `cover` and `article` both land and `voice` is rewound to its first execution, the next execution's base contains `voice#1`'s output and both parallel outputs; a CAS race recomposes; a compose conflict flags the earlier step | take the base from a branch tip instead of composing; skip the CAS; compose from all executions instead of `step_heads` |
| C5 | drift placement (`tests/flow/drift.test.ts`, IR-I6): a person's edit to a file last written by `finetune` becomes a person-authored execution of `finetune` committed onto its output; `finetune` is not a candidate, later steps are; an edit to an untouched file is placed at the start | place drift at the end; leave drift out of the composition |
| C6 | article e2e on fake agents (`tests/flow/wechatFlowE2E.test.ts`): run to the draft box → feedback on `voice` → plan shows candidates `voice…to-draft-box` with reasons and the model's proposed skip (`cover`) → person unticks `pick-title` too → only chosen steps run, skipped keep outputs → stub draft records `remoteId`; crosses an `ask` (pause → resume end to end, R §3) | skipped step re-executes; ask blocks the parallel `cover`; `remoteId` not stored |
| C7 | dev untouched (`tests/control/clarifyPromptGolden.test.ts` + the existing requirement e2e tests unchanged): dev clarify prompt bytes equal the golden captured before §10.1 | change the requirement host's background default |
| C8 | flow ClarifyHost (`tests/flow/clarifyHost.test.ts`, IR-I13): a flow clarify step drafts with the template's background and sections, stores rounds under `(group, stepKey, execSeq)`, and on consensus completes the step with the document record | store flow rounds under `('clarify', 1)`; call the requirement host's `onConsensus` |
| C9 | zero round (`tests/flow/clarifyZeroRound.test.ts`, IR-I13): `zeroRound: true` is accepted only for small + clear under `mode: auto` and records a minor decision; any other class or mode makes the answer invalid | accept `zeroRound` for medium; accept it without `mode: auto`; skip the minor decision |
| C10 | #76 + re-key (`tests/control/requirementRevise.test.ts`, `tests/control/roundsRekeyMigration.test.ts`): the schema step keeps row count and every body, mapping to `('clarify', 1)`; revising round 2 of 3 appends row 4; rows 1–3 byte-equal; chain = [1, 4]; the next round's prompt carries round 3's answers as recommended answers unless excluded; after accept ⇒ `requirement-already-accepted`; caps count chain length | overwrite round k in place; compare `round_no` to the cap; drop superseded answers from the prompt; map old rows to `exec_seq` 0 |
| C11 | rewind (`tests/flow/rewind.test.ts`, IR-I13): a rewind to `draft` re-queues a later feedback on `voice` and re-applies a later edit to `finetune` as a three-way patch; an excluded message is not re-applied; an edit that no longer applies becomes feedback flagged red | drop later messages on rewind; re-apply an excluded one |
| C12 | unattended skips (`tests/flow/unattendedSkips.test.ts`, IR-I13): an `orca-auto` rerun takes the proposal and writes one minor decision per model skip | write no decision; take a non-candidate skip |
| C13 | effect levels e2e (`tests/flow/effectLevels.test.ts`): `apply-flag` runs and flags; `confirm` parks only its step while the parallel sibling finishes; `stage-only` leaves a record, enacted once via the Web route and once via the CLI, discarded once; a second enact refused | `confirm` parks the whole run; `stage-only` runs the step |
| C14 | vault driver probe (`tests/flow/vaultDriverProbe.test.ts`, BC-B1, IR-C2): a `dir` flow run starts one `work` step; a hidden child group with its own archived plan, confirmed proposal and snapshot runs through the real execution driver and the pinned ccloop (fake agent) with the vault as target repo; child branch starts at the composition; attempt, landing and `orca/<childGroupId>` refs are in the vault; the person's folder (a git repo in one case) keeps its `.git` byte-equal and receives the files by copy-back; `flow_decisions` holds the reported decision and no `.decisions/` is committed; the child never integrates | resolve the person's folder as the target repo; add the task to the parent group; commit `.decisions/` for a dir group; skip copy-back; let a dir group integrate |
| C15 | budgets (`tests/flow/runBudget.test.ts`, BC-B2, IR-C2): the parent starts confirmed with no estimate call; each child is confirmed with an allocation drawn from the parent pool and returns the unspent part; an exhausted pool parks only that run with a needs-you item while another flow run proceeds | park every group; call the estimator; confirm a child without drawing |
| C16 | effect steps (`tests/flow/effectStepExecution.test.ts`, BC-B4) and ask write-back (`tests/flow/askWriteTo.test.ts`, BC-B8): an effect step's derived contract has `maxAttempts: 1`, no default changed-path gate, no retry; its prompt carries the record id as `--confirmed-by-orca`; a failed effect is not retried until the person retries; a chosen title lands in the `title` frontmatter as a person edit and makes later steps candidates | allow an automatic retry; omit the id; write the answer without an `edit` record |
| C17 | tool rules (`tests/flow/stepToolRules.test.ts`, H32): a step's `tools` reach the child contract's `toolRules` exactly; a step without `tools` produces a contract byte-equal to today's; the run page shows each rule's status as ccloop reports it, `detected` / `recorded-only` network / `refused` flagged red | drop a rule; widen a refused rule; show `detected` as `enforced` |
| C18 | precedence and settings (`tests/flow/policyResolution.test.ts`, `tests/flow/policyRead.test.ts`): project over global; `follow-template` picks `confirm`; a lock set globally refuses a looser project value and a project-layer lock write is refused; `irreversible` defaults to `confirm`, cannot reach `apply-flag` via a template, and is refused `apply-flag` from every channel in phase 1; every field of the read carries `{value, source, lockedBy}` | swap the precedence; drop the clamp; accept a project lock; omit `source` |
| C19 | access (`tests/control/flowVerbAccess.test.ts`, BC-B5, IR-C1): every §14.2 verb has a `VERB_ACCESS` entry equal to the table; `flow-effect`, `flow-answer`, `flow-rerun`, `flow-pool`, `set-flow-settings`, `set-flow-locks` refused for a socket agent; a scripted agent walk using the `any` verbs drives C6's path up to the first human-only act | move one verb to `any`; drop an entry |
| C20 | corrections (`tests/corrections/coarseTargets.test.ts`, `tests/control/correctionCoarseDebug.test.ts`): repo-only and bare-run rows validate, `pendingId` without `runId` is refused; stored fixture ids unchanged; debug input holds the sentence and the bounded window; closing writes one `decision`, no `overturned`; metrics line; ccmem head names the target; a `dir:` row is skipped by the exporter (IR-I13) | keep the old "exactly one" rule; write `overturned`; drop the window bound; serialise absent fields; export a `dir:` row |
| C21 | Rule 17 (`tests/flow/outOfRepoWrites.test.ts`, IR-C4): a whole flow run with `HOME` set to one temp dir and every `ORCA_*` redirect set to a **separate** temp dir; after the run nothing exists under the `HOME` dir | default a path from `os.homedir()` |
| C22 | `needs-person` (`tests/flow/unattendedSkills.test.ts`): a fake agent reporting `flow.needs` parks only its step; the answer queues a revision with it in the prompt; a confirmation request from an unclassed step surfaces as an ask | treat `needs` as success |

Phase 2+ criteria are set in their own plans; syncskill's, ccloop's and md2publish-skills' in theirs. A real paid run of
`wechat-article` is a separate acceptance the human approves (not part of `npm test`).

---

## 22. Left to the builder (decide, record in the plan's ledger)

- Module paths under `src/flow/`, exact verb names within the §14.2 rows, refusal code spellings.
- Whether `step_heads` stays a table or becomes a projection of `flow_messages`.
- The default size caps and the repo-only correction window as settings names.
- How `dir` projects show in the panel's project list and which repository-only actions are hidden for them.
- Prompt texts of the built-in template (written to the human's skills; the human reviews them as a diff).
- The bounded-diff sizes in the rerun proposal input, cut with the cut recorded.
- The check an effect step without template gates carries to satisfy ccloop's ≥ 1 check (a no-op such as `true`,
  confirmed against ccloop's contract), §9.6.
- The exact child-group import and `orca-auto` confirmation mechanics (§6.2), within the shapes given there.
- The exact deletion list for phase 3, measured by `grep`.

---

## 23. Questions put to the human — all RULED (2026-10-22, logged at the end of `progress.md`)

- **H-A tool, command and network permissions:** 「a」 — per-step `tools` declarations passed to ccloop as per-contract
  tool rules; a ccloop spec first (§3.2, §16.2, C17).
- **H-B md2publish-draft's confirmation:** 「b」 — an explicit `--confirmed-by-orca <effect-record-id>` switch in
  md2publish-skills (§4.3 rule 2, §16.4).
- **H-C pinning the personal repos:** 「a」 — the built-in pins `blrbiran/runskills` and `blrbiran/md2publish-skills`; the
  repos stay public (§15).
- **H-D `cost` default:** 「a」 — apply + flag by default; budget caps are the backstop (§9.1, §15).

## 24. Open for the human (next session)

1. **Scope of the md2publish-skills change.** H-B approved the confirmation switch. The independent review widened
   §16.4 [IR-I9, IR-I10]: the same switch also covers md2publish-visuals' spend question and md2publish-article's
   overwrite question, and the inline `python3 -c "…"` lines become script files. All of this is in your repo. Accept
   that scope, or keep only the md2publish-draft switch (then `visuals` and `article` would stop with `needs`, and the
   cover step could not use exact tool rules for those lines)?

## 25. Corrections after the T18 acceptance run (append-only; the sections above stay as written)

Recorded by the flow acceptance fixer (session b37f7ce9, 2026-10-22) on `feat/flow-engine`; the run is `fr-12b4198a…`
in `progress.md` (`- flow T18:` lines).

- **25.1 (corrects §15 ¶1 and row 11's tools).** "Commands in md2publish steps run from the injected skill directory
  (`cd '{{skill.<name>.dir}}'` exact, then the skill's own scripts)" does not work: claude resets the shell's working
  directory after every Bash command, so the relative scripts failed with ENOENT (the cover's generator and finetune's
  `verify.py` never ran). Every skill script is named by its absolute path, `'{{skill.<name>.dir}}/…'`; no step has a
  `cd` rule. The static checklist (§3.3) refuses a `cd` command rule (`tools-cd`) and, in a step that has one, each
  command whose program is a relative path (`tools-depends-on-cd`).
- **25.2 (adds to §3.3 and §16.2).** A tool command rule with leading or trailing whitespace is a checklist error
  (`tools-whitespace`), not trimmed at load: ccloop refuses such a rule (T18: 8 rules in `cover`, 2 in `article` came back
  `refused`), and trimming would widen it -- ccloop compiles a claude prefix `v` to `Bash(v *)`, i.e. `^v( .*)?$`, so
  `mkdir -p ` trimmed would also allow a bare `mkdir -p`. The author removes the space; the built-in has none.
