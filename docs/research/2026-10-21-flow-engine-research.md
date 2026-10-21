# Flow engine research: synthesis of tracks t1–t9

- **Author:** synthesis subagent of Orca session `8b1469ea`, 2026-10-21. Research only, **no design decision here**. The
  options and the recommendation are in `docs/research/2026-10-21-flow-architecture-options.md`.
- **Revision 2026-10-22** (base commit `56d881c8`). After the human's rulings (`progress.md:48-54`) and an independent
  review (`:53`), I added notes where the rulings change a conclusion: H22 record-not-declare in §1 and §4, effects in
  §3, admin locks in §7. I also fixed one ccloop citation (§11), the gh-aw #35467 wording (§8) and the deslop
  attribution note (§12).
- **Why:** the human asked for many flow templates (development, writing/WeChat, office, game dev, UI/UX) on one engine
  and for a "global optimum" redesign before release (goal.md P1; ledger
  `.superpowers/sdd/2026-10-21-session-8b1469ea/progress.md:40`).
- **Inputs (all read in full for this synthesis):** brief `/private/tmp/orca-8b1469ea/research/brief.md`; track reports
  in `/private/tmp/orca-8b1469ea/research/`: `t1-workflow-engines.md`, `t2-agent-orchestration.md`,
  `t3-process-skills.md` (it condenses the `t3-part-*.md` files, which were not re-read), `t4-writing-pipelines.md`,
  `t5-packaging-and-learning.md`, `t6-visual-flows.md`, `t7-durable-execution.md`, `t8-dify-n8n.md`, `t9-gh-aw.md`;
  earlier notes `docs/research/2026-10-21-flow-templates-research.md` (session `9ec98639`).
- **Commits measured** (copied from each report's header; the reports measured them with `git -C <repo> log -1`):

| Track | Projects @ commit |
|---|---|
| t1 | nextflow `64c574e11`, snakemake `45233569`, airflow `675b02a2f9`, bazel `e91365e120`, buck2 `57f33de53f`, pants `984eae61fd`, zuul `87e497396` |
| t2 | multica `47120a413`, hermes-agent `a31975222e`, openclaw `56376753f83`, ralph-orchestrator `b5789df`, loop-engineering `614a959`, oh-my-openagent `4863a41b85`, oh-my-claudecode `6688a30e9` |
| t3 | superpowers `bb92a77`, mattpocock-skills `49dd158`, OpenSpec `c794978f`, gstack `25dbe34f4`, ECC `76aaa77d`, better-harness `840ff54`, deepseek-harness `687f282e86` |
| t4 | baoyu-skills `1567581`, md2wechat-skill `a8e2900`, md2publish-skills `a2b9dc8`, ran-publish `177aad8`, runskills `e62c5f8`, stop-slop `8da1f03`, wechat_article_skills `abae70b`, Viral_Writer_Skill `1c76f89` (Orca `2fc90b6c`) |
| t5 | syncskill `3157563`, openskills `57d933a`, anthropic-skills `dbd4588`, agent-skills `aeac41d`, awesome-copilot `cb64ad12`, openai-skills `49f948f`, Supervisor-Skills `a20d76e`, pskoett-ai-skills `314b029`, gbrain `f717b1a5b` (Orca `2fc90b6c`) |
| t6 | ragflow `543e16738`, open-webui `91ea4e342` (Orca `2fc90b6c`) |
| t7 | langgraph `3cd57c038`, temporal `e6461b3fd` (Orca `3e3ee55b`) |
| t8 | dify `bc751e71a9`, n8n `da70de87b1` |
| t9 | gh-aw `b0d1adf1` |

- **Orca anchors** in §11 were measured by this synthesis at Orca `31c7c952` with `grep -n` / `sed -n` / `cat -n`.
- **Citation form:** `t7 §4 L1` = track t7, section 4, lesson 1; the project `file:line` after it is the one the track
  report cites. Line numbers are as of the commits above — **re-measure before citing in a spec** (CLAUDE.md Rule 14).
- **Evidence marks** are carried over from the reports: **[V]** the track read it in source/docs at that line; **[I]**
  inference (the track's or, where it says "synthesis", mine). A claim that combines several tracks is marked [I] even
  when each part is [V].

---

## 0. Summary in ten lines

1. **Nobody kept a general workflow DSL; everyone who tried cut it back** to a closed, small set of code-owned step
   kinds that templates select, order and parameterise (t2 §0, L4). [V]
2. **The flow must be one canonical, layout-free, typed document with stable step ids**; run state, layout and
   machine bindings live elsewhere (t6 L1, t8 L5, t2 L1). [V]
3. **Partial re-run = record an input fingerprint per step execution and re-run only stale steps**; build systems do it
   by hash (t1 L1), LangGraph by version vectors (t7 L1), n8n/Dify only half (t8 L1). [V]
4. **Early cutoff (output unchanged ⇒ stop) exists only in build systems, never in agent tools**; byte equality rarely
   fires after an LLM step, so it needs a per-step projection/equality, which for Orca is an **optional author hint**
   (H22), plus the person's "unchanged" mark (t1 L2, t2 §8, t7 L1). [V for the absence; I for the remedy]
5. **A human edit is an injected value for one step's output, recorded on a new branch**, not a re-computation and not
   an overwrite (t1 L6, t7 L2, t8 L2). [V]
6. **"Don't wait for people" is a code-level rule keyed on reversibility**: reversible decisions are defaulted and
   reported; irreversible ones park only their dependents (t2 L2, t3 L3, t9 L1–L2). [V]
7. **Side effects are typed requests applied by code under a per-class policy**, not agent actions and not one yes/no
   gate (t9 L1–L3, t4 L1, t3 L12). [V]
8. **Templates bind roles/tiers, never machines**; the machine resolves agent+model at run time with provenance and
   fails visibly (t2 L1, t9 L4, t3 L13). [V]
9. **Pin everything a template pulls in by immutable ref and content hash; never overwrite local edits on update**
   (t5 L1–L2, t9 L5–L6, t1 L11). [V]
10. **Gaps nobody solved** (the part Orca would add): semantic early cutoff for LLM steps, per-person layering of the
    same unit, partial re-run inside agent orchestration, a durable enactment record for deferred effects, and any
    measurement that humans intervene less (§1–§9 "Gaps").

---

## 1. Definition model (units, flow as data, versioning, composition, fan-out)

**Consensus**
- **Closed, code-owned step kinds; the template only selects, orders and parameterises them.** omc admits four stage
  sequences and rejects extra keys (t2 §7.1 `pipeline-types.ts:43-60`, `pipeline.ts:158-172`); openclaw removed
  TaskFlow, "No compatibility facade remains" (t2 §3.7 `removed-surfaces.md:357-374`); ralph consolidated presets
  because "every builtin preset becomes product surface area" (t2 §4.7 `docs/guide/presets.md:57-71`); multica: "This
  is not a workflow engine" (t2 §1.1). gh-aw's compiler owns the job skeleton and only lets things plug in at fixed points
  (t9 §6). [V]
- **Flow as data, with nodes = artifacts/steps and edges = "requires".** OpenSpec is the only process-skill project
  whose flow is data: artifacts `{id, generates, template, instruction, requires}`, Kahn order, cycle check, schema
  pinned per change (t3 §3.1 `types.ts:29-64`, `graph.ts:95-139`, `change-metadata/schema.ts:38-62`); one generic skill
  set asks the engine "what's next" (t3 L1 `propose.ts:140-160`). [V]
- **Data-dependent expansion is a first-class, bounded construct**: Snakemake `checkpoint` re-evaluates the DAG after a
  step (t1 §2.1 `rules.rst:3034-3060`), Buck2 `dynamic_output` (t1 §5.1), LangGraph `Send` + reducer (t7 §1.1
  `types.py:738-790`), Airflow `.expand()` and `.loop(max_iterations, until)` with a reasoned gate (t1 §3.1
  `loops.rst:24-110`). Orca's split is already such a checkpoint (t1 L14). [V; Orca mapping I]
- **Runs pin the definition version they started on**: omc persists `profileHash` and refuses a mismatch on resume
  (t2 L5 `pipeline.ts:175-234`); Airflow GitDagBundle reruns use the recorded commit (t1 §3.1); Dify/n8n publish
  immutable versions, runs and sub-flow tools pin them (t8 L3); gh-aw records `source: …@ref` + `frontmatter_hash`
  (t9 §1). [V]
- **Definition and run state are separate**: RAGFlow stores run state inside the DSL and needs reset functions (t6 A8.2
  `dsl/reset.go`) — the anti-pattern every other system avoids. [V]

**Disagreements**
- *Linear stages vs graph.* multica (ordered statuses + one back edge, t2 §1.1), gh-aw (one agent run per workflow,
  chaining via `dispatch-workflow`, t9 §1) and omc (closed stage lists) stay linear; OpenSpec, LangGraph, Dify, n8n,
  RAGFlow use DAGs. The writing pipeline the human actually ran is linear with one parallel branch (cover) (t4 §1).
  Synthesis [I]: a DAG with `needs` edges costs little more than a list and covers both (*superseded 2026-10-22 by the human's H22 ruling: steps are an ordered list with optional ordering/skip hints, no required data edges; see §4*); the *editor* can still be a list
  (t6 L2).
- *Who defines composition.* Zuul single-parent inheritance with `!override`/`!inherit` (t1 §7.1); gh-aw `imports:`
  with typed `import-schema` and per-field merge (t9 §1, L8); Snakemake `use rule … with:` (t1 §2.1); Temporal/LangGraph
  child workflows/subgraphs with their own journals (t7 L11); Dify "workflow as tool" pinned to a version (t8 §1.1).
- *Mid-step interrupt vs boundary gates.* LangGraph `interrupt()` restarts the whole node on resume (t7 §1.3
  `types.py:918-923`) — for hours-long paid steps t7 L6 says gates must be separate steps at boundaries. [V]

**Gaps**
- "A saved, versioned, parameterised, composable flow template with code-checked per-node acceptance and content-hash
  early cutoff" exists in none of the seven process-skill projects (t3 §9 end); dsh explicitly defers "saved or nested
  workflows" (t3 §7.1 `workflow/README.md:125-129`). [V by absence]
- Typed template parameters that generate a form exist only as hermes Automation Blueprint slots
  `time|enum|text|weekdays` (t2 §8), Open WebUI inline prompt variables (t6 B1 `utils/index.ts:1748-1866`), Dify start
  variables (t8 §1.1), Airflow params (t1 §3.1). [V]

---

## 2. Customisation and layering (prompts, skills, tools/MCP/CLI, models)

**Consensus**
- **A packaged unit = prompt + skills + tools, hashed together.** Nextflow agent module dirs carry `skills/` and
  `tools/`, both in the task hash, capped at 64 files / 256 KB (t1 L12 `agent.mdx:306-324,475-491`); gh-aw frontmatter
  carries `skills:`, `tools:`, `mcp-servers:`, `plugins:` next to the prompt body (t9 §2); Open WebUI model presets
  bundle system prompt + tool/skill/filter ids (t6 B1); hermes skill bundles = `skills + instruction` (t2 §2.2). [V]
- **Roles name tiers, not models; the machine resolves.** omc `ModelTier` + `team.roleRouting` (t2 §7.5
  `models.ts:1-80`); omo categories with provenance and "drop a category whose models are unavailable instead of
  borrowing another family" (t2 §6.5 `model-resolution-pipeline.ts:46-58`, `categories.ts:60-95`); ralph per-hat
  backend fails closed, embedded presets drop their `cli:` block (t2 §4.5); gh-aw model aliases resolved at run time
  against the live catalogue, `model_unavailable` before start, resolution logged (t9 §2 `model-alias-specification.md`
  §8.8, §10); superpowers model choice is advisory per role (t3 §1.2). [V]
- **Every defaulted value carries its source layer.** omc prints and persists `threshold_source` (t2 L12
  `deep-interview/SKILL.md:75-95`); md2wechat `PromptSpec.Source` (t4 §2.5 `catalog.go:16-33`); omo model provenance. [V]
- **Prompt envelope is fixed and layered; per-node rules are separate from global context.** OpenSpec envelope order
  `<task> → <project_context> → … → <rules> → <dependencies> → <output> → <instruction> → <template> → <success_criteria>`
  and "constraints for YOU, not content for the file" (t3 §3.6 `instructions.ts:245-345`, `propose.ts:179-181`); gstack
  preamble order is load-bearing (t3 §4.1 `preamble.ts:94-98`); multica brief precedence identity > project > step >
  skills (t2 §1.2 `runtime_config_sections.go:483-486,845-875`). [V]
- **Prompt craft is real engineering, and form must match failure**: superpowers "Match the form to the failure"
  (prohibition tables for rule-skipping, REQUIRED slots for omissions, no nuance clauses) and the measured cost of removing
  rationalization rows (8/10 → 5/10) (t3 §1.6 `writing-skills/SKILL.md:461-477`, `RELEASE-NOTES.md:179`); the human's
  writing skills each have "one single criterion" and explicit neighbour boundaries (t4 §2.1). This backs the human's
  "好的实践…在用户千锤百炼…的 prompt 里" (ledger `progress.md:40`). [V]
- **Mechanical/semantic split**: the agent writes a brief, a pure renderer composes the prompt/output, so templates are
  testable without a model (t4 L8, md2publish spec §6; md2wechat "AI request" envelopes t4 §2.5). [V]

**Disagreements — layering semantics (the main one)**

| Rule | Who | Evidence |
|---|---|---|
| Same-named unit in a higher layer **replaces** the lower one wholesale | omc profiles, openclaw per-agent skill lists, OpenSpec whole-schema first-match | t2 L6 (`autopilot/SKILL.md:71`, `schema.help.core.ts:312`); t3 §3.1 `resolver.ts:120-170` |
| **Deep-merge per field** with explicit merge rules and `!override`/`!inherit` | Zuul jobs, gh-aw imports, Nextflow config + selector priority, ralph (maps merge, arrays replace) | t1 L10 (`job.rst:13-60`); t9 §2 (`imports.md:313-335`); t1 §1.2; t2 §4.2 |
| **Copy-to-customise + 3-way update** against a recorded base | gh-aw `update` (diff3), gbrain "scaffold once, own the copy" | t9 L6 (`update_merge.go:100-220`); t5 §9 (`skillpacks-as-scaffolding.md:1-12`) |
| Overlays with `extends` + per-node patch, record resolved bytes | t3's recommendation | t3 L6 [I] |
| Shadow silently by precedence | openskills, dsh | t5 §2 (`skills.ts:41-42`); t3 §7.2 (`skill/README.md:140`) — the anti-pattern |

Synthesis [I]: merging *prompts* is unreviewable (t5 L5), so prompts and step lists want copy+3-way-merge; plain
settings (budgets, defaults, bindings) want per-field deep merge; security/permission keys can be *required* by an
import but never *granted* (gh-aw, t9 §2; omo "project layers cannot extend them", t2 §6.2). Note the precedence
direction: gh-aw lets the workflow win over imports; the human ruled **个人 > 共用 > 内置** (`progress.md:37`), i.e. the
person/machine layer last (t9 L4 [I]).

**Gaps**
- "Nobody has a real built-in < shared < personal merge of *the same unit* — they shadow by name" (t5 §10). Dify
  shares only per tenant (t8 §1.2). [V by absence]
- Tool/MCP dependency declaration exists only in openai `agents/openai.yaml` `dependencies.tools[]` (t5 §4) and gbrain
  recipes `requires/secrets/health_checks` (t5 §9); Dify DSL `dependencies` + "leaked dependencies" check at import
  (t8 §1.1). [V]

---

## 3. Humans and not waiting (gates, async feedback, direct edits, interrupts, rewind)

**Consensus**
- **Front-load the human, then run without stopping.** Human touches in the default dev path: superpowers ≈3–4,
  OpenSpec 2 (one non-blocking), ECC 2, gstack autoplan 1 final gate (t3 §8). superpowers "Rulings, not stalls", with a
  9-hour stall as the motivation (t3 §1.3 `subagent-driven-development/SKILL.md:17-31`, `RELEASE-NOTES.md:140`). [V]
- **Classify each pending decision; only irreversible ones park, and only their dependents.** omc verifiability test
  ("if done wrong, can the system detect it? can it redo or roll back?") and AFK assumption protocol (t2 §7.3
  `launch/SKILL.md:12-14,139-145`, `autopilot/SKILL.md:158`); gstack Mechanical / Taste / User Challenge (t3 §4.3);
  hermes `kanban_block(needs_input)` parks one card (t2 §2.3); dsh `askTimed` returns *pending* (t3 §7.3); ralph
  `human.timeout` ⇒ continue (t2 §4.3). Unattended/cron mode disables asks by construction (hermes, t2 L2). [V]
- **Human steps are typed nodes with defaults and a timeout policy, and waiting holds no worker.** Airflow HITL:
  options/defaults/form/assigned users, defaults on timeout, `AWAITING_INPUT` frees the worker, approve / **edit then
  approve** (downstream gets the edited text) / reject ⇒ skip downstream (t1 §3.3, L4 `hitl.py:58-136,234-241`,
  `approval_gates.rst:28-44`); Dify Human Input: actions = edges, `__timeout` edge, node vs global expiry, multi-channel
  recipients (t8 §1.3); RAGFlow `UserFillUp` with 24 h checkpoint TTL (t6 A3). [V]
- **Human input is a durable message stream, never a blocking call** (t7 L4): Temporal signal (always accepted,
  deduped by request id) / update (validated, synchronous answer) / query (read-only) (`workflow-update.md:8-48`);
  multica comments steer a running turn and are coalesced when queued (t2 §1.3); gh-aw `steer` comments read mid-run
  (t9 §3). [V]
- **Direct edit = write the step's output as the human** (LangGraph `update_state(as_node)` ⇒ successors trigger by the
  normal rule, t7 L2 `pregel/main.py:1619-2100`; Dify draft variables `editable` + `last_edited_at`, n8n pinned data,
  t8 L2; DICE injected keys, t1 L6). [V]
- **Rewind keeps what the human said since**: Temporal reset re-applies later signals/updates unless excluded (t7 L3
  `workflow_resetter.go:107-111,948-1000`); LangGraph forks are independent branches (t7 §1.3 `test_time_travel.py:143-220`). [V]
- **Clarify primitive**: frontier rounds, each question with a recommended answer worded so "yes" accepts it, facts
  looked up by sub-agents (mattpocock grilling, t3 §2.3 `grilling/SKILL.md:6-30`); a closing builder check by a cold
  domain reader, one round of "theirs" only (superpowers, t3 §1.3 `builder-check-prompt.md:6-23`). Both are
  domain-parameterised already. [V] **Human, 2026-10-22 (via the coordinator):** Orca's clarify is already modelled on
  grilling and is 「orca 的一个亮点。比 superpowers 的 brainstorm 轻量好实现」. So grilling-style clarify is the asset
  every template reuses. t3 L5's suggestion of a closing builder check is **not** adopted as a default step.
- **Defaults must be said out loud** ("A default they never heard is one they couldn't reject", t3 §1.3
  `brainstorming/SKILL.md:200`); ask-steps carry inferred candidates + a free-text slot + skip conditions + profile
  write-back that records rejections (t4 L4 `wechat-finetune/SKILL.md:70-80`, audience-profile template `:56`). [V]

**Disagreements**
- *Default on a gate's timeout.* Airflow/Dify route timeout to defaults or a timeout edge; Open WebUI treats timeout as
  denial (t6 B3); openclaw denies immediately when no approval surface exists (t2 §3.3); gh-aw says manual gates
  "defeat automation's purpose" and defaults to apply + `REQUEST_CHANGES` review (t9 §3 `safe-outputs-specification.md`
  §1.1; `threat-detection.md:507-563`). **Ruled 2026-10-22** (`progress.md:51-52`): each effect class has three levels,
  apply + flag red (default), confirm card (parks only that step) and stage only (an immutable deferred record,
  enacted or discarded later in Web/CLI). Precedence is project settings > global settings. A template's recommended
  level applies only when settings say "follow template". Options doc §3.5.
- *Where external writes stop.* The human's own md2publish-draft hard-confirms before upload (t4 §1 row 11,
  `md2publish-draft/SKILL.md:64-80`); baoyu post-to-wechat creates the draft without a confirm step, relying on drafts
  being non-public (t4 §2.4); public publish is "human only, the agent never does it" (`ran-publish handoff.md:18`),
  which matches the human's ruling "公众号系统中的发布由我来点击" (`progress.md:34`).
- *Question caps.* mattpocock deliberately has no cap (t3 §2.3 `.out-of-scope/question-limits.md`) yet logged
  "Codex just asked me 200 questions"; Orca already ruled caps by scope × clarity (#86, `progress.md:21`).

**Gaps**
- **Approval has no durable "enact later" record** in gh-aw (open maintainer proposal #61112, t9 §8.1); Airflow HITL
  review holds a worker slot (t1 §3.3 `hitl_review.rst:44-55`); RAGFlow pauses only per session, no async queue (t6 A3).
- **No one tests pause→resume end to end by default**: RAGFlow shipped a HITL chain that "never actually connected"
  (t6 A3 `interrupt_resume.go:20-26`). [V]
- Speculative execution past an unresolved human gate exists only for CI changes (Zuul NNFI + AIMD window, t1 §7.4,
  L5); no agent system runs downstream on unratified output and resets on rejection. [V by absence in t2/t3]

---

## 4. Partial re-run, caching, early cutoff, invalidation

**Consensus**
- **Fingerprint per step execution = definition bytes + declared inputs + environment; re-run only changed
  fingerprints.** Nextflow task hash incl. agent skills/tools/model/instruction (t1 §1.4 `cache-and-resume.mdx:20-36`,
  `agent.mdx:475-491`); Snakemake rerun triggers `{MTIME, PARAMS, INPUT, SOFTWARE_ENV, CODE}` with a per-job `reason`
  (t1 §2.4 `dag.py:1336-1510`); LangGraph `channel_versions > versions_seen` (t7 §1.1 `pregel/_algo.py:1259-1276`);
  ralph/omo stable step keys and "amend invalidates affected dependents" (t2 L10). [V]
- **Never re-execute an LLM step to replay it; record its result once.** Nextflow: "resuming an agent run only replays a
  stored run" (t1 §1.4 `agent.mdx:493`); Temporal activity results are history events (t7 L5); LangGraph saves each
  finished task's writes so only failed siblings rerun (t7 §1.4 `pregel/_loop.py:827-838`). Never cache a failed or
  rate-limited call (Pants `ProcessCacheScope.SUCCESSFUL`, DICE transients, t1 L13). [V]
- **Show why a step will re-run, before it re-runs** (Snakemake `reason`, Nextflow `-dump-hashes` diff, t1 L7); without
  it Snakemake accumulated years of spurious-rerun bugs (`CHANGELOG.md:994,1005,1121,…`). [V]
- **Unknown inputs ⇒ must run; afterwards record what was actually read** (Bazel `inputsKnown()`, Buck2 dep files,
  Pants dependency inference, t1 L8). [V mechanisms; I for agents]
- **Reuse an earlier step's stored output when only a later step changed** (n8n partial execution v2 start-node search
  `workflow-execute.ts:246-353`; Dify single-node run with draft variables, t8 §1.4, §2.4). [V]

**Disagreements**
- *Hash vs timestamp vs counter.* n8n dirtiness is timestamp-based and client-side, with two server-side `TODO:
  implement` clauses (t8 §2.4 `find-start-nodes.ts:14,21`); Snakemake needs newer-and-checksum-different (t1 §2.4
  `dag.py:1449-1460`); LangGraph counters bump on any non-empty write (t7 §1.4 `last_value.py:57-69`); Pants separates
  RunToken from Generation (t1 §6.2 `entry.rs:34-46`). All tracks that propose a design for Orca pick **content hashes**
  (t1 L1, t7 L1, t8 L1, t4 §4). [I]
- *Value of early cutoff for Orca.* t1 L2: byte cutoff "never fires after an LLM step re-runs" ⇒ declare a per-step
  equality/projection (e.g. a verdict, an outline, a schema). t7 L1: cutoff "mostly fires on deterministic steps … and on
  steps whose inputs didn't change — still the main saving". Compatible: hash cutoff for deterministic steps, projection
  for LLM steps, human "accept as unchanged" as the override (t1 L2, L6).

**Gaps**
- **Early cutoff in any agent tool**: "No project implements early cutoff" across seven orchestrators (t2 §8); none of
  seven process-skill projects (t3 L8); LangGraph none (t7 §1.4); n8n/Dify none (t8 L1); gh-aw has no in-run partial
  re-run at all (t9 §4). [V by absence]
- **Undeclared reads by agents** — hermetic sandboxing is impractical (t1 "do not transfer"); "report what you read"
  from the tool-call log is a proposal, not prior art for agents (t1 L8 [I]).
- **Human ruling, 2026-10-22 (CORRECTION entry at the end of `progress.md`):** the build-system premise of declared
  inputs and outputs (t1 L1, L8; t3 L1; t7 L1) does **not** transfer to Orca. In the human's words: 「管不住 agent 的行为吧？…
  如果是开发 flow 的话，你更控制不了每一步的产物了」 and 「每一步 group 或 task 都不知道自己要读/写哪些文件」. What stays:
  outputs recorded after the fact (one commit per step), reads recorded when available, and fingerprints over what a step
  actually ran on. Re-run choice becomes a conservative code bound, then a model proposal, then the person's
  adjustment (see the options doc §3.4).
- **Speculation budget**: Zuul's AIMD window (t1 L5 `gating.rst:250-326`) is the only bound on wasted work found.

---

## 5. Verification and quality gates beyond tests

**Consensus**
- **Deterministic gate first, judge second; the judge runs only if the gates pass; score never is the gate alone.**
  hermes `GoalGate` before judge (t2 §2.1 `goals.md:136-154`); better-harness "local validators … decide pass/fail",
  "Do not declare acceptance from an average score", evidence ladder with score ceilings (t3 §6.5); ECC rendered-finish
  gate checked by a script (t3 §5.5); gstack null score "never invented" (t3 §4.5); gh-aw graders return `unavailable`
  instead of fabricating (t9 §5). [V]
- **Gate checks and diagnostic checks must be declared as such.** deslop `scan.py` exits 0 by design (diagnostic);
  `fidelity.py`/`verify.py` exit 1 (gates); the one bug the human hit was a gate that "reports FAIL with exit code 0"
  (t4 §3.6, L2). [V]
- **Per-output declared checks with a pure failure-decision function**: Dify agent-v2 outputs `type, required, check`
  (model compares a produced file against a benchmark file), retry budget, then `stop | default_value | fail_branch`,
  merged by a state-free orchestrator (t8 §1.5 `agent_config_entities.py:889-990`, `output_failure_orchestrator.py`). [V]
- **Reviewer design is domain-agnostic; the template supplies the rubric**: isolated reviewers with the same inputs,
  typed verdicts, capped rounds, adjudicate at the cap (superpowers two-verdict + 5-round breaker; ECC santa with
  content/compliance rubric extensions; mattpocock Standards ∥ Spec; better-harness lanes; t3 L10). Writer ≠ reviewer
  (t4 L7 `review-mode.md:1-8`). [V]
- **Acceptance measured from what the person did afterwards** (gh-aw `outcomes`: accepted / rejected / pending, t9 L9);
  the human's own loop converges on *edit granularity*, not issue count (t4 §2.1 `tech-writer/SKILL.md:264-270`). [V]
- **Static checks on the flow itself gate start/publish, never save** (RAGFlow canvas checklist, t6 A5; Dify DSL check
  error vs warning, t8 §1.5; gh-aw compile-time schema + lint, t9 §5). [V]

**Disagreements**
- Judge calibration: loop-engineering verifier "Default stance: REJECT" (t2 §5.6); ECC code-reviewer ">80% confidence,
  zero findings is valid" (t3 §5.5); hermes judge fails open to `continue` (t2 §2.1). Per-template choice [I].

**Gaps**
- OpenSpec's instruction envelope still prints `<success_criteria><!-- To be defined in schema validation rules -->`
  (t3 §3.5 `instructions.ts:330-334`): no schema-declared acceptance. Generalising Orca's criteria protection (test
  files only today) to a template-declared protected set has prior art only in gh-aw protected files (t9 L2). [V]

---

## 6. Extension mechanism (new step kinds, plugins) and boundaries

**Consensus**
- **A step kind registers once, with a schema that drives validation and the form; duplicates fail at start-up.**
  RAGFlow back end `component.Register` panics on duplicates, carries a real version (t6 A6 `registry.go:44-74`), but its
  front end needs ≥ 8 touch points per kind — the anti-pattern (t6 A6). Open WebUI Valves schema → form (t6 B2). Dify
  node `(type, version)` resolver (t8 §1.1 `node_factory.py:145-171`); n8n `VersionedNodeType` keeps old nodes on old
  code (t8 §2.1). [V]
- **Core fixed, plug-ins at named points**: gh-aw (custom safe-output jobs, engines, MCP, graders; skeleton not
  extensible, t9 §6); openclaw "Small core, capable plugins", plugins use only the SDK (t2 §3.6); dsh "Plugins, not loop
  changes" (t3 §7.7). [V]
- **Executable extensions need stronger rights than text edits** (Open WebUI: editing tool code needs more than write
  grant, t6 B5; n8n checksum-vetted community packages, t8 §2.2; Dify plugin `resource.permission`, t8 §1.2). [V]

**Pain to avoid**: a version number alone was not enough identity for Dify agent nodes (t8 §1.8 `node_factory.py:156-164`);
unknown keys silently ignored made ralph's `backpressure.gates` dead config (t2 §4.1 `config.rs:3122-3133`). [V]

---

## 7. Multi-user and permissions

**Consensus**
- **One generic grant table** `(resource, principal user|group|anyone, read|write)` (Open WebUI `access_grants.py:25-34`,
  t6 B7); roles projected onto permission keys incl. `skill.publish`, `plugin.install` (Dify `rbac/builtin.py:17-80`,
  t8 §1.7). [V]
- **Install/publish is a separate right from admin**: gbrain "publishing is not a consequence of admin", self-registered
  clients capped (t5 §9); Dify per-tenant `install_permission` ∈ everyone/admins/noone + install scope + signature
  (t8 §1.7); n8n type-availability policies enforced at save/publish/start/import, grandfathered only at save (t8 §2.7). [V]
- **Re-check authority at dispatch time** so a saved card cannot widen a later caller's access (openclaw Workboard,
  t2 §3.6); standing grants fail closed when the job definition changes (t2 §3.3). [V]
- **Scheduled runs are credited to whoever last published the rule/version** (multica t2 §1.4; n8n t8 §2.1). [V]

**Disagreements / limits**: openclaw "ownership features are usability features, not security boundaries" (t2 §3.6);
hermes Kanban is single-user, single-host (t2 §2.6); Airflow Multi-Team is "different from multi-tenancy" (t1 §3.7).
Zuul documents that its `final`/`protected` locks are circumventable from untrusted changes (t1 §7.2). [V]

**Gaps**: per-person template layering with shared defaults (see §2). [I] **Ruled 2026-10-22** (`progress.md:51-52`):
an admin lock is **optional per security-class field** (effect policy, skill sources, budget caps), 「能锁，也能不锁」. A
locked field may only be tightened by lower layers. Everything else keeps 个人 > 共用 > 内置 for templates and
project > global for settings. The UI shows "locked by" and the source layer of every effective value (options doc
§3.6).

---

## 8. Packaging, distribution, marketplace

**Consensus**
- **Pin by immutable ref, record content hashes, refuse branches for published entries.** awesome-copilot
  `validateImmutableRef` rejects branch names / short SHAs (t5 §5 `external-plugin-validation.mjs:316-337`, MIT); gh-aw
  resolves skill refs to SHAs at compile, plugins fail compile if unpinnable (t9 §2 `frontmatter.md:278-367`); gbrain
  TOFU keyed by (name, author, pinned sha) (t5 §9 `trust-prompt.ts:1-14`); Nextflow module checksum in `.module-info`
  (t1 §1.2). [V]
- **Never silently overwrite a local edit on update.** Nextflow refuses without `-force` (t1 §1.2); hermes skips locally
  edited skills by content-hash drift and merges cron jobs by id, new ones arrive paused (t2 §2.2); gh-aw 3-way merge,
  conflicts left for a human (t9 §2); gbrain retired its installer because it "would have silently deleted your skills"
  (t5 §9 CHANGELOG `:37251`); md2publish `check-shared-drift.sh` refuses auto-overwrite (t4 §2.2). [V]
- **Import = preview + one decision per item** (`skip | replace | create | copy`, `expected_version_id`, copies start
  private) (Open WebUI `routers/skills.py:816-890`, t6 L6); Dify import computes missing dependencies and gates
  newer-major DSL behind explicit confirm (t8 §1.1); export strips secrets (RAGFlow `clearSensitiveFields`, Dify
  credential ids, n8n credential references) (t6 L6, t8 L4). [V]
- **Built-ins seeded from repo files by upsert-by-id, never overwriting user copies** (RAGFlow `canvas_template_seed.go:39-77`,
  t6 L7). [V]
- **Supply-chain hygiene**: gh-aw cool-down skips releases younger than 7 d (t9 §2 `update_cooldown.go:19-20`); "safe
  update" refuses newly introduced secrets/actions until approved (t9 §5); gbrain never auto-executes install scripts
  (t5 §9). [V]

**Disagreements**: package-manager install with pins (awesome-copilot, gh-aw, syncskill today) vs "scaffold once, own the
copy" (gbrain v0.36, t5 §9). The human ruled skills go through syncskill from git sources with admin-only install
(`progress.md:34,45`), so skills are pinned packages; *templates* can still be copy-to-customise (t5 L5 [I]).

**Gaps**: no central registry with ratings/signing in gh-aw (code signing *for the gh-aw binaries* is open issue #35467, t9 §2; workflow/package signing is not addressed); syncskill today
has no ref pinning, one global namespace with first-owner-wins, lock "版本只记录，不重放", no permission model (t5 §1
`source.ts:1775-1779,1295-1307`, spec `2026-10-03-profile-inject-version-design.md:18,23`). Source keys collide by short
name (`progress.md:45`, observed by the controller). [V]

---

## 9. Learning from corrections

**Consensus (three working patterns, t5 §10)**
- (a) **Classify the correction and fix the source of truth**, stamped with its source (gbrain `correction-pipeline`
  classes BRAIN / MEMORY / … / HALLUCINATION / STALE; never edit rendered files, fix the answer bank and re-render;
  t5 §9). [V/S]
- (b) **Count by exact key → threshold → propose a rule diff with provenance → human approves asynchronously →
  regression eval** (pskoett: `Recurrence-Count >= 3`, ≥2 tasks, 30 days, "Do NOT fuzzy-match", harness-updater outputs a
  diff for approval, never deletes rules; t5 §8 `self-improvement/SKILL.md:275-277`). [V]
- (c) **Eval-gated self-edit, never auto-applied** (gbrain SkillOpt "never auto-mutates bundled skills — emits
  proposed.md", skillify "NO-REGRESSION LAW"; anthropic skill-creator feedback loop; agent-skills rejection ledger). [S]
- **Trust tiers**: `user_confirmed > operator_curated > tool_observed > agent_written`; a lower-tier write that would
  supersede a higher one becomes a proposal (gbrain `tier.ts:6-36`, t5 L7). [S]
- **Profiles are long-lived user-owned memory that make later runs ask less, and they record rejections** (t4 §3.4,
  audience-profile: "rejections predict better than selections"). [V]
- **Feedback is triaged to a "ruler", then only that step re-runs** (ran-publish triage, t4 §2.3, L6). [V]

**Gaps**: "No project has measured that humans intervene less" (pskoett bench has no agent solvers; agent-skills
measures trigger rates only; t5 §10, L10). gbrain lost 4/20 corrections to a cosine-0.95 dedupe (t5 §9 TODOS `:421`). [S]

---

## 10. Pitfalls (observed failures, with the fix they suggest)

| Pitfall | Evidence | Lesson |
|---|---|---|
| Two copies of the same params drift (27/89 nodes) + 781-line normalizer | t6 A8.1 RAGFlow | one canonical document |
| Layout and run state stored in the definition | t6 A8.2; t8 §1.8 Dify | keep both out by schema |
| Identity by display name, id-healing, rename rewriting | t8 §2.8 n8n `heal-node-ids.ts` | stable step ids, labels separate |
| Unknown keys silently accepted ⇒ dead config | t2 §4.1 ralph `config.rs:3122-3133` | reject unknown keys |
| Schema churn: 75 codemods, 71 keys, 889 KB schema | t9 §8.2–8.3 | settle names before distribution; version the format |
| Prompt-only phase ordering decays; default flow leaks into custom ones | t3 L7 (gstack, OpenSpec `CHANGELOG.md:49,683`) | order and scope detection in code |
| Same rule "in four copies that had already drifted" | t2 §1.7 multica | define prompt fragments once, reference them |
| Agent must remember to advance status ⇒ stuck forever | t2 §1.7 multica `issueworkflow.go:713` | code advances on a completion contract |
| Idle-edge prompt injection races, duplicate work | t2 §6.6 omo `ROADMAP.md:83-91` | one durable continuation owner |
| Concurrency policies shipped broken, then removed | t2 §1.4 multica `043_…` | don't ship untested policies |
| HITL chain never connected end to end | t6 A3 RAGFlow | e2e test of pause→resume |
| Interrupt restarts the node | t7 §1.3 LangGraph | gates at step boundaries |
| Workflow-as-code patching hell | t7 §2.2 Temporal | flows as pinned data |
| HITL review holds a worker | t1 §3.3 Airflow | waiting holds nothing |
| Spurious reruns for years | t1 §2.8 Snakemake | show reasons; content hashes |
| Timestamp-based dirtiness | t8 §2.4 n8n | content hashes, server-side |
| A gate that exits 0 on FAIL | t4 §2.2 md2publish | declare gate vs diagnostic |
| Skill install by path symlink broke (targets moved) | t4 §2.1 (fixed by the human 2026-10-21, `progress.md:44`) | install by identity + preflight |
| Silent shadowing of same-named skills | t5 §2 openskills | visible "overridden by" |
| Installer silently deleting user skills | t5 §9 gbrain | never overwrite local edits |
| Two-speed edits (body hot, frontmatter needs compile) ⇒ stale locks | t9 §8.4 | re-expand deterministically at start, store the bytes |
| Ambient instructions overflow context | t9 §8.6 gh-aw #22929 | budget prompt layers |
| "Every builtin preset becomes product surface area" | t2 §4.7 ralph | small catalogue, composition first (t3 L14) |

---

## 11. Where Orca stands (anchors measured at `31c7c952`)

- **Step-kind registry already exists for single calls**: `SingleCallHandler { prepare, evaluate?, classify, complete,
  usageUnknownReason }` with purposes `estimate | clarify | split` (`src/control/singleCallPurposes.ts:12-37,60`;
  handlers `src/control/requirementCalls.ts:252,317`). [V] This is the natural seam for a step-kind registry [I].
- **Per-task recipe layer**: loop plans `standard/bugfix/refactor/design/investigate`, append-only versions, label →
  plan map (`src/control/loopPlans.ts:16,104,328-336`). [V]
- **Durable kernel pieces** (t7 §3, re-checked here): `commands` with `payload_hash`, `runs.generation`,
  content-hashed `artifacts`, `checkpoints`, `outbox` (`src/control/migrations.ts:7,8,11,12,13`), `stop_intents` (`:42`),
  `scheduler_wakes` (`:44`), `requirement_rounds` (`:71`), `pending_decisions` (`:126`), `flagged_decisions` (`:135`). [V]
  Missing: a per-step journal with input fingerprints, forks, a first-class human message stream (t7 §3). [V by absence]
- **Dev-specific fixed points**: clarify instruction "one software repository" (`src/control/requirementClarify.ts:19`);
  split instruction "one software repository" (`src/control/requirementSplit.ts:17`); split tasks require
  `targetPaths` and `checks` ≥ 1 (`src/control/requirementSchemas.ts:77`); criteria protection by `TEST_PATH` regex
  (`src/control/criteriaProtection.ts:22`). [V]
- **Skills per run**: one injected snapshot per run with a synthetic `orca-run-skills` plugin
  (`src/control/executionDriver.ts:344,383-393`); ccloop accepts at most one skill directory per run
  (ccloop `src/control/protocol.ts:258-259`; the fields `skillPluginDir` / `codexSkillsDir` / `ompSkillsDir` at
  `protocol.ts:270,299`; local HEAD `2a2ae53`) and requires `worktreeRequired: true`, `autonomyLevel: "L2"`
  (`src/contract/schema.ts:45,50`). [V] *(Corrected 2026-10-22: the first version cited `schema.ts:258-259`.)*

---

## 12. License table (what Orca may take)

| Project | License | Use |
|---|---|---|
| Nextflow, Airflow, Bazel, Pants | Apache-2.0 | code with notice; ideas |
| Snakemake, Buck2 (MIT/Apache) | MIT | code with attribution |
| Zuul | Apache-2.0 **+ GPL-3.0 files** (`zuul/ansible/base/...`) | ideas for GPL parts; check headers |
| LangGraph, Temporal (server) | MIT | code with attribution |
| hermes-agent, openclaw, ralph-orchestrator, loop-engineering, oh-my-claudecode | MIT | code with attribution |
| multica | "Multica License" (Apache-2.0 + no hosting/embedding conditions) | **ideas only** |
| oh-my-openagent | Sustainable Use License 1.0 + CLA | **ideas only** |
| superpowers, mattpocock-skills, OpenSpec, gstack, ECC, better-harness, deepseek-harness | MIT | text and code with attribution |
| tech-writer family, md2publish-skills, ran-publish | the human's own | free (human's call); tech-writer-deslop carries stop-slop's MIT attribution (`tech-writer-deslop/SKILL.md:17-18`), which must be kept |
| baoyu-skills, stop-slop | MIT | with attribution |
| md2wechat-skill | source-available (BSL-based, personal non-commercial) | **ideas only** |
| wechat_article_skills, Viral_Writer_Skill | no license file | **ideas only** |
| syncskill | MIT (the human's) | own code |
| openskills | Apache-2.0 | with notice |
| anthropic-skills | per skill; docx/pdf/pptx/xlsx proprietary | per skill; doc skills ideas only |
| openai-skills | per skill (mostly Apache-2.0); repo deprecated | per skill |
| awesome-copilot, agent-skills, gbrain, pskoett (plugin parts) | MIT | with attribution |
| Supervisor-Skills | CC BY-NC-SA 4.0 | **ideas only** |
| RAGFlow | Apache-2.0 | with notice |
| Open WebUI | BSD-3 + branding clause | **ideas only** (don't copy UI code) |
| Dify | modified Apache-2.0 (no multi-tenant service, logo, design patent) | **ideas only** (recommended by t8) |
| n8n | Sustainable Use License; `.ee.` files enterprise | **ideas only**; `.ee.` off-limits |
| gh-aw | **MIT** (Copyright GitHub, Inc.) | code with attribution |

---

## 13. Corrections to earlier notes (Rule 13: the earlier file is left as it is)

- `docs/research/2026-10-21-flow-templates-research.md:59` lists GitHub Agentic Workflows as "ideas". **t9 read the
  `LICENSE`: MIT** (t9 header) ⇒ ideas and code reusable with attribution.
- t4 §2.1 reported `~/.claude/skills/tech-writer{,-deslop,-voice}` symlinks broken; the human had them re-pointed later the
  same day (`progress.md:44`). The lesson (install by identity, not path) stands.
