# Flow templates (development / documentation / office / research) — research notes

- **Author:** Orca session `9ec98639` (2026-10-21), research only. **No design decision is made here**; the brainstorm is
  the next session's (human: "这件事可以等到下一个session做具体的brainstorm，你可以先调研一下").
- **The human's idea (verbatim):** "orca 中当前我们做所有group / task都是用一套开发用的默认流程不能自定义不能修改。我们接下来是不是可以提供几套默认流程，并且可以让可以修改流程。开发流程、文档流程、办公流程等不同场景下的流程可能会很不一样。包括使用的skill，task之间的组织形式，是否要加特定的task等等。"
- **Measured at:** Orca main `d85b9e9c`, ccloop main `71d650c`. Line numbers are from those commits; re-measure before citing.

## 1. Where today's single development flow lives in Orca

A group today goes: idea → clarify rounds → split into tasks → (plan file import as an alternative entry) → estimate →
confirm (auto-start, kanban S2) → per task one ccloop run (plan → execute → verify, required shell checks) → landing
(reconcile on conflict, criteria protection) → integration/delivery → debug groups / escalation ladder / integration check.

| Stage | Where (file:line) | Fixed today | Already configurable | Knob a flow template would need |
|---|---|---|---|---|
| Clarify (requirement) | `src/control/requirementClarify.ts:11` instruction V1 | Prompt assumes "one software repository" and a repository overview (file list, exported symbols) as the only context | language of prose; nothing else | scenario-specific instruction text + context source (repo overview vs document set vs mailbox/folder) |
| Split into tasks | `src/control/requirementSplit.ts:17,28-33`; schema `src/control/requirementSchemas.ts:52-55` (`splitTaskSchema`) | Each task must have `targetPaths` (repo paths, min 1) and `checks` = shell commands run in the repo (min 1); "each task changes a small, coherent part of the repository" | optional `loopPlan` per task, `labels`, `dependsOn` | per-scenario split instruction; whether checks are shell, artifact checks, or a judge; mandatory tasks the split must include (review, docs, tests); topology hints |
| Plan file (alternative entry) | `src/scheduler/planFile.ts:140-153` (task = `contract` xor `loop`), `:196-231` `taskContractSchema` | One plan = one target repo, `workBranch`, `ledgerMode`; contract is ccloop V1 | per task: raw contract or loop recipe; agent selection; labels | a plan-level `flow` reference so a plan file can say which template it follows |
| Loop plans (per-task recipe) | `src/control/loopPlans.ts:16` ids `standard/bugfix/refactor/design/investigate`; `:20-41` definition; `:61-108` registry (versions 1–3, append-only); `:110-114` shared `EXECUTION_POLICY`; `:328-343` `LABEL_PRIORITY` + `choosePlanByLabels` | Five built-in recipes, code-only (no user-defined recipe); budget = `TASK_WORK`; versioned append-only so archived recipes re-expand byte-identically | per task: plan id, inputs, **skills (profile or names, `:134-141`)**; chosen explicitly or by label | **This is already a per-task template layer** (goal.md §3.3 calls it "zero code" — stale). A flow template would sit one level above: a named set of recipes + defaults + topology |
| Labels | `src/control/labels.ts:16` `SYSTEM_LABELS` (feature, bug, refactor, test, doc, design, investigate, perf, security, chore) | Vocabulary is dev-centric; label → recipe mapping hard-coded (`loopPlans.ts:328-343`) | labels per task | per-template label vocabulary and label→recipe map |
| Estimate | `src/control/estimatePrompt.ts:11,65` ("a plan of software tasks"); `src/control/estimator.ts:16` `TASK_WORK` (3M tokens, 4 h, 3 attempts) | Prompt wording and per-task budget defaults | instruction version; spend caps | per-template budget defaults and estimate wording |
| Confirm / orchestration | `src/control/orchestration.ts:15-34` (actor `orca-auto`, cap 3, settings `maxRunningGroups`, `criteriaReview`) | Same orchestration for every group | global cap; hold vs run on confirm | possibly per-template cap or "always hold" for flows with external side effects |
| Skills | `src/control/executionDriver.ts:334-359` (inject per run), `:376-392` `injectRunSkills`; `src/skills/syncskill.ts`; ccloop `src/control/protocol.ts:234-246` (one skill dir per run) | One frozen skill set **per task run, same for plan/execute/verify**; skills come from the loop recipe (`skills`) only | per task: syncskill profile or names | per-template default skill profile; per-phase skill sets would need a ccloop change (today one directory for all phases) |
| ccloop contract | ccloop `src/contract/schema.ts:45` `autonomyLevel: z.literal("L2")`, `:50` `worktreeRequired: z.literal(true)`, `:64` `verifierType: command|agent`; Orca mirror `planFile.ts:196-231` (verification at `:218`) | A git worktree per attempt, a commit per attempt, required checks are shell commands (`sh -lc`, ≥1), verifier is command or agent | maxAttempts, timeouts, tokenBudget, allow/deny paths, maxFilesTouched, rejectOn, evidenceRequired | whether non-git outputs are possible at all (see §2) |
| Workspace | `src/control/workspaceSettings.ts:10` `worktree | clone` | git only | per repository mode | non-repo workspaces (`dir:` as hermes has) |
| Delivery / landing | `src/control/integrationScheme.ts:20` default `{delivery:"keep"}`, `local`/PR paths `:110-196`; `src/control/driverLanding.ts`; reconcile `src/scheduler/reconcile.ts` | Delivery = git branch/merge/PR | per project delivery scheme | non-git delivery (file drop, email draft, doc in a shared folder) — none exists |
| Criteria protection | `src/control/criteriaProtection.ts:22` `TEST_PATH` regex (tests/, `*.test.*`, `test_*.py`…), `criteriaReview.ts` | Detects weakened **code tests** only | per repo / global reviewer switch | per-template "what defines acceptance" (doc rubric, checklist file) |
| Debug / ladder / integration check | `src/control/systemDebug.ts:27-29` (write set `**`), `debugGroup.ts`, `debugPlan.ts:50` kind instructions, `integrationCheck.ts` | Debug = fix code so checks pass; integration check = re-run shell checks on merged target | integration check on/off + command per project | per-template recovery: for docs "revise per review", for office "ask the person" |
| Decision ledger | `src/ledger/*`, `.decisions/` in the target repo | Lives in a git repo | — | ledger location for a flow whose target is not a repo |

**Summary of the fixed points:** (1) every flow assumes a git repository as the target, workspace and delivery
channel; (2) acceptance = shell commands exiting 0 (with an optional agent verifier on top); (3) the
requirement→split→estimate prompts say "software repository/tasks"; (4) the per-task template layer (loop plans)
exists but is a closed, code-defined set of five recipes and one skill set per task; (5) task topology is free-form
(the split model decides), with no notion of mandatory tasks (e.g. "always end with a review task").

## 2. What in ccloop is development-specific, and do non-code outputs fit?

- Each attempt runs in a **git worktree** and ends in an **attempt commit** (contract `worktreeRequired: true`);
  required checks run as shell commands in that worktree; the verifier sees the diff and evidence.
- **Documents fit already**, if they live in a repo: loop plans `design` and `investigate` (v2+) produce a document
  and check "every target document exists and is not empty" by command (`loopPlans.ts:66-75`); quality is left to an
  agent verifier. A doc flow mostly needs better acceptance (rubric/checklist judged by a verifier, link/spell/format
  checks as commands) rather than a new runtime.
- **Office outputs** (xlsx/docx/pptx, email drafts) fit only as files committed to a repo or a scratch repo. Anything
  with an external side effect (send mail, post, edit a shared doc) does not fit ccloop's model: ccloop has no approval
  primitive for side effects and its "landing" is a git merge. Prior art (Lobster, hermes kanban, gh-aw safe outputs)
  all make side effects a separate, gated step.
- **Research outputs** fit like documents (report file + sources), with acceptance = citations present / links
  resolve (command) + judge.

## 3. External prior art (ideas only unless the license says otherwise)

| System | License / use | How a flow is defined | Customization | Versioning | Per-scenario parts |
|---|---|---|---|---|---|
| **multica** (`/Users/biran/code/skills/loop/multica`) | Multica License, source-available ⇒ **ideas only** | Project **workflow** = ordered subset of a shared status catalog; each step names a **handler** (agent / squad / member / project lead / creator) and **instructions** (≤ 8000 chars); a workspace **Default** workflow used when a project has none (`server/internal/issueworkflow/issueworkflow.go` header, `default.go`) | per project; statuses shared and peer-level; fixed head/tail (todo first; done/cancelled last) | stored rows, Default created lazily | handler + instructions per status; **Skills** = reusable playbooks; **Autopilots** = cron-run standups/audits/reports; **Squads** = leader routes work |
| **hermes-agent** (`/Users/biran/code/skills/agent/hermes-agent`) | MIT ⇒ reusable with attribution | **Kanban** board: tasks with one assignee *profile*, parent→child links, comments as the inter-agent protocol; **workspace kinds** `scratch` / `dir:<path>` / `worktree` per task; **completion contracts** (`outcome, verification, constraints, boundaries, stop_when`) and **quality gates** (shell commands that must exit 0 before an LLM judge runs) on `/goal`; **PR completion contracts** vs `local-only`; **deliverable mode** for files (docx/xlsx/pdf via skills) (`website/docs/user-guide/features/kanban.md`, `goals.md`, `deliverable-mode.md`) | profiles (persona + memory + skills) per role; boards per project/domain | rows in SQLite; contracts persisted with the goal | the workspace kind and the completion contract are the scenario switches (code → worktree + PR checks; office → `dir:` + deliverables) |
| **openclaw** (`/Users/biran/code/skills/agent/openclaw`) | MIT ⇒ reusable with attribution | **Lobster** (optional plugin): typed YAML/JSON workflow files (`name, args, steps[id, command, stdin: $step.stdout, condition, approval: required]`), deterministic runner, **approval gates with resume tokens**; `llm-task` = schema-validated JSON-only LLM step inside a workflow (`docs/tools/lobster.md`, `docs/tools/llm-task.md`); **standing orders** = per-program authority/trigger/approval gate/escalation in `AGENTS.md` (`docs/automation/standing-orders.md`); **team preset** coordinator/researcher/writer/reviewer roles with written lane contracts (`docs/concepts/multi-agent.md` §Team preset, `docs/concepts/parallel-specialist-lanes.md`) | per agent: skills allowlist (`agents.defaults.skills` baseline, per-agent replacement), tools allow/deny, workspace | workflow files are data (diffable, replayable) | side-effect steps gated by approval; LLM only in `llm-task` steps; scenario = workflow file + role contracts |
| **GitHub Agentic Workflows** (`gh aw`) | ideas | Markdown file: YAML frontmatter (triggers, permissions, tools, engine, **safe-outputs**) + natural-language body; compiled to a standard Actions workflow ([pkg.go.dev/github.com/github/gh-aw](https://pkg.go.dev/github.com/github/gh-aw@v0.92.0)) | per repo file | git | agent job read-only by default; writes only via validated safe outputs |
| **GitHub Actions reusable workflows** | ideas | `workflow_call` with typed inputs/secrets ([docs](https://docs.github.com/en/actions/sharing-automations/reusing-workflows)) — not re-fetched this session | caller passes inputs | git ref pinning | composition over copying |
| **CrewAI** | ideas | `agents.yaml` + `tasks.yaml`; Crew `process` = `sequential` (default) or `hierarchical` (manager LLM/agent routes) ([docs.crewai.com/en/concepts/crews](https://docs.crewai.com/en/concepts/crews), [tasks](https://docs.crewai.com/concepts/tasks)) | placeholders filled at kickoff | project files | process type is the topology switch — note hierarchical = LLM routing (Orca Rule 5 forbids for scheduling) |
| **Backstage Software Templates** | ideas | `template.yaml` (`kind: Template`): `parameters` (JSON-schema form, auto-generated UI) → `steps` (`id, action, input`, sequential) → `output` ([backstage.io writing templates](https://backstage.io/docs/features/software-templates/writing-templates)) | form inputs; custom actions | catalog entity, refreshed from its location | the "golden path" idea: a template = form + deterministic steps |
| **LangGraph templates / OpenAI Agents SDK handoffs / Jira workflow schemes** | ideas | Graph templates as starter apps; handoffs as agent-to-agent transfer; Jira: workflow per issue type via a scheme — cited from general knowledge, **not re-fetched this session** | — | — | Jira's "scheme maps issue type → workflow" is the closest analogue of "label → loop plan" today |

Common shape across them: **a named, versioned, data-defined template** = (inputs form) + (ordered or graph steps, each
with a handler/role, instructions, and allowed tools/skills) + (acceptance per step: deterministic gate first, LLM judge
second) + (side effects isolated behind approval/safe-output steps) + (a default template when none is chosen).

## 4. Candidate scenario flows (for the brainstorm; not decided)

| | Development (today) | Documentation | Office / ops | Research |
|---|---|---|---|---|
| Target / workspace | git repo, worktree per attempt | git repo (docs/) or a docs folder | folder (`dir:`), mailbox, spreadsheet; often outside git | report folder or repo |
| Skills (examples from this machine) | TDD, debugging, code review | doc-coauthoring, writing guides, docx/pdf | xlsx, docx, pptx, email drafting | deep-research, arxiv, web search |
| Task topology | split by code area; deps by explicit `dependsOn` + write-set order | outline → sections in parallel → consistency/edit pass → review | collect → draft → **approve** → apply/send | question → parallel source sweeps → synthesis → citation check |
| Mandatory tasks | (none today); candidates: tests, review | final edit/consistency pass; review | human approval before any send/post | citation/claim verification |
| Verification (replacing shell checks) | required shell checks + agent verifier; criteria protection | file exists + lint/links/spell (commands) + rubric judged by verifier | schema/format checks on produced files; side effects only after approval | links resolve, every claim has a source (command) + judge |
| Delivery | branch / local merge / PR | merge to docs branch, or publish | file drop / draft created / sent after approval | report file |
| Recovery | debug group, ladder, integration check | "revise per review" task | ask the person (side effects) | re-search a gap |

## 5. Constraints a design must honor

- **Rule 5 (code decides routing):** choosing and expanding a template, ordering tasks, inserting mandatory tasks —
  code. A model may *propose* a template (classification) but the expansion must be deterministic and re-expandable
  byte-for-byte, as loop plans already are (`loopRecipeCheck.ts`, goal.md §3.3 hard constraint 1).
- **Versioning:** archived groups must re-render; templates need the loop-plans discipline (append-only versions,
  recipe bytes stored with the plan).
- **Rule 16:** a flow template is for the *target* repo's agents; Orca's own rules must not leak into it.
- **Rule 17:** user-defined templates stored outside the repo (e.g. `~/.orca/flows/`) are a new out-of-repo write
  path — env-redirectable, explicit modes, registered in a spec.
- **goal.md §1.1** (people fill little; defaults editable), **§1.2** (every action in Web UI and the agent path),
  **§1.3** (few, important decisions), **§1.4** (confirm = start; side effects land then flag — but external side
  effects such as sending mail may need a real gate, which is a tension to resolve).
- **ccloop boundary (Rule 16 for ccloop):** per-phase skills, non-git workspaces, or approval steps need ccloop specs
  first; ccloop today has one skill dir per run and a mandatory worktree.

## 6. Open questions for the brainstorm (list, not answers)

1. Level: is a "flow" a **group-level** template (topology + mandatory tasks + defaults) on top of the existing
   **task-level** loop plans, or a replacement for them?
2. Who chooses the flow: the person at requirement time, a label/scenario classifier (model proposes, code expands),
   or the project default?
3. Editing: edit a built-in in place (new version) vs copy-to-custom; where custom flows live (repo file, control DB,
   `~/.orca`); can a project pin a flow version?
4. Topology: fixed stage list (like multica statuses / Backstage steps) vs a graph template the split must fill;
   how mandatory tasks are inserted (code appends them after the split, or the split must emit them and code checks).
5. Acceptance for non-code flows: which deterministic checks exist (file present, lint, links, schema) and when an
   agent judge is enough; how criteria protection generalizes beyond test files.
6. Non-git targets: do we support `dir:` workspaces and non-git delivery at all in v1, or keep every flow inside a
   repo (docs and reports as files) and postpone office side effects?
7. Side effects (send/post): adopt an approval-gate step (Lobster / gh-aw safe outputs) — how does that square with
   §1.4 "don't block on people"?
8. Skills: per-flow default profile only, or per-phase/per-role skills (needs ccloop)?
9. Which 3–4 built-in flows ship first (YAGNI), and what is the migration for existing groups (they stay on
   "development v1")?
</content>
</invoke>
