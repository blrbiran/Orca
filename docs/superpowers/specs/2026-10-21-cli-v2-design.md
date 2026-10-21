# Orca CLI v2 — one command registry, `orca <domain> <action>`, CLI + skill first

Status: design, session 8b1469ea (2026-10-21). Source: external feedback #85
(`/Users/biran/code/skills/orca/orca_archived_files/issue-20261008.md` §Issue 85, with
`cli-comparison-analysis.md` and `skill-cli-analysis.md` beside it). Human rulings are quoted in §2; everything marked
**(controller's call)** was decided by the controller and can be overridden at review.

## 1. Why

Orca is unreleased. The human: "你要从全局最优的角度考虑，而不仅考虑破坏性大不大。现在产品还未发布，还是做破坏性改动的最佳时期。"

Today one `orca` binary serves three audiences with no structure between them:

1. **People running the service**: `panel install|start|stop|restart|status|logs`, `user`, `agents init|show|refresh`.
2. **Agents operating Orca**: `orca control get <path>` / `orca control send <route> --expected-revision <n> --payload <json>`
   and `orca mcp serve` (two generic tools). To act, an agent must memorise a 45-row route table (SKILL.md §8), build
   JSON payloads by hand (including 64-hex hashes and base versions copied from reads), and look up in a second table
   (SKILL.md §9) which read holds the revision for each route.
3. **Tools for developing Orca itself**: `level`, `gate`, `checkpoint write`, `resume`, `chain`, `check-append-only`,
   mixed with ledger file tools `validate`, `plan`, `correct`, `metrics`, `compact-reviews`.

Command docs live in three hand-synced places (`src/cli.ts` USAGE, `docs/cli.md`, `skills/orca-control/SKILL.md`) and
the two MCP tool descriptions; they drift.

The human also ruled that Orca pushes **CLI + skill** as the agent interface and keeps MCP's context footprint
minimal ("当前各个 MCP 工具对上下文的占用太厉害了，所以我自己的 agent 都尽量把 MCP 都 disable 了").

## 2. Human rulings (verbatim, this session)

- Controller's proposal A–F accepted: "同意你的建议" — one registry generating CLI/MCP/skill references/help with a
  drift test; `orca <domain> <action>`; dev tools out of the user surface; `--json` on every command;
  `orca status` + `orca doctor`, no `update`/`check-update`; skill = intent routing + generated references, version
  in frontmatter checked by `orca status`, no separate skill package.json; project inferred from cwd, no `orca link`;
  `orca control send` kept as a hidden escape hatch.
- Dev tools under `orca dev` (not a separate binary): "同意".
- Revision: "你可以审视一下 revision 到底有没有必要" → after the audit (§6) and the AWS CLI / kubectl comparison:
  default no revision, optional `--if-revision` — "除了上面说的以外，其他部分可以接受"; last-writer-wins on a single
  value across Web and terminal: "可以接受".
- Whole-document edits: interactive-only editing is not agent-usable → structured small edits as the main path,
  whole replace requires `--if-revision`, conflict answer is agent-readable JSON, `edit` is a TTY convenience over
  `replace`: "同意修改后的方案".
- Project: inferred from cwd "也应该可以通过命令行参数修改" ⇒ `--project <id|path>` overrides.
- Old command names deleted, no aliases: "同意".
- MCP: "需要尽量优化，防止大量占用其他 agent 的上下文 … 主推 cli + skill 的方式，并且尽量精简 MCP 对上下文的占用".
- This spec is written before the flow-templates design because new flow commands will register in the same table: "同意".

## 3. Goals, non-goals, anti-goals

**Goals**
- G1 Every user-facing action is one line: `orca <domain> <action> <ids> [--flags]`, no hand-built JSON, no hashes,
  no revision lookups for the common path.
- G2 A single registry (code, not docs) defines each command once; CLI parsing, `--help`, the MCP tool, the skill's
  `references/` files and the error-code reference are generated from it; a test fails when a generated file is stale.
- G3 An agent loads little by default: SKILL.md is short (intent routing + core rules); details are read on demand.
- G4 Safety guarantees that exist today are preserved where they do work (§6), and stated honestly where they change.

**Non-goals**
- Changing the panel's protocol beyond what §14–§15 list (the CLI keeps calling the same verbs over the socket). The
  additions are: `retry-task.runId` (R2), the socket plans route (R4), the person-token and dispatched-run headers,
  their refusal codes, and the verb-access table split (§15).
- Self-update / release channel (`orca update`, `check-update`).
- A persistent "current project" file (`orca link`).

**Anti-goals** (failure even if it "works")
- A generated reference that silently diverges from what the CLI accepts.
- An MCP surface that costs other agents thousands of tokens of tool schema.
- Dropping an existing safety check without saying which check now covers that case.

## 4. Command shape

`orca <domain> <action> [positional ids] [--flags]`. Global flags on every command: `--json`, `--project <id|path>`,
`--control-state-dir <dir>`, `--quiet`, `--verbose`, `--help`.

**Domains and actions (controller's call; the builder may rename within these rules: domains are nouns, actions are
verbs, one verb = one control verb or one read).** Each row lists the current verb/route it maps to.

| Command | Maps to |
|---|---|
| `orca status` | panel status + service manager + agents table validity + ccloop pin + ccmem reachability + skill/CLI version match (§8) |
| `orca doctor` | each check of `status` with a one-line fix hint per failure (§8) |
| `orca version` | Orca version, ccloop pin, skill version |
| `orca help [<domain> [<action>]]` | generated from the registry |
| `orca project list|show` | `get config` |
| `orca project set-workspace-mode|set-integration|set-integration-check|set-criteria-review` | repository verbs |
| `orca project register-plan <path>` | `POST /api/projects/:id/plans` (#65) |
| `orca requirement open --idea <text>` | requirement-open |
| `orca requirement show|answer|consensus|continue|feedback|accept <group>` | requirement reads and verbs (`continue` = #86 "continue clarifying" verb, from the clarify-caps spec) |
| `orca group list|show <group>` | `get summary`, `get groups/<id>` |
| `orca group import <plan>` | import-plan |
| `orca group estimate|confirm|start|pause|resume|stop-handoff|resume-handoff|archive|unarchive <group>` | the matching verbs (`confirm --hold` keeps today's hold) |
| `orca group set-limit|set-integration|retry-integration|resolve-integration|depend|undepend <group>` | the matching verbs |
| `orca proposal show <group>` | proposal part of `get groups/<id>` |
| `orca proposal set-budget|set-agent <group> …` | proposal-edit operations / proposal-set-agent, one value per call |
| `orca proposal replace <group> --file <path> --if-revision <n>` | proposal-edit with the whole operation list (§6.3) |
| `orca proposal edit <group>` | TTY only: open `$EDITOR` on `show` output, then `replace` with the revision read |
| `orca task show|retry|continue|set-loop|set-labels|verify-saved-result <group> <task>` | the task verbs |
| `orca task settle-usage …` | settle-unknown-usage (person token, §15) |
| `orca run show|activity|evidence|results|eligibility <run>` | run reads |
| `orca decision list <group>` / `approve|reject|ratify` | group decisions read / decision verbs |
| `orca decision validate <path>` / `metrics` / `compact-reviews` | today's `validate`, `metrics`, `compact-reviews` (ledger file tools, no panel needed) |
| `orca plan preview <path>` | today's `orca plan` |
| `orca correction list|record|close|withdraw|debug` | correction read and verbs (§9: relation to today's offline `orca correct`) |
| `orca agent list|show|init|refresh|models` / `orca agent set-preferences` | today's `agents …` + agent-preferences verb |
| `orca usage show` / `set-cap|clear-cap|set-calendar` | usage read / spend verbs |
| `orca orchestration show|set` | orchestration read / set-orchestration-settings |
| `orca recovery list|retry` | recovery read / recovery-retry |
| `orca command show <commandId>` | retained-result lookup; the CLI derives the scope itself (SKILL.md §4 today) |
| `orca panel run|install|start|stop|restart|uninstall|status|logs` | unchanged |
| `orca user add|passwd|disable|list|rotate-key` | unchanged |
| `orca control get|send` | unchanged, hidden from top-level help, documented only in the skill's escape-hatch reference |
| `orca agent apply-update` | apply-agent-update (person token, §15) |
| `orca dev level|gate|checkpoint|resume|chain|check-append-only|correct` | today's dev harness commands and the offline ledger-writing `orca correct` (§5) |

Old top-level names (`validate`, `plan`, `correct`, `metrics`, `compact-reviews`, `level`, `gate`, `checkpoint`,
`resume`, `chain`, `check-append-only`, `agents`, `mcp serve` arguments) are **removed without aliases**; an unknown
command prints the nearest registered command (`did you mean orca dev gate?`) and exits 1.

**Ids.** Positional ids accept the full id or an unambiguous prefix/slug (the panel already shows slugs; ambiguity is
an error that lists the candidates). **Project.** Resolved from `--project`, else from cwd: the registered repository
whose root contains cwd (realpath), else the only registered repository, else an error listing them.

**Arguments instead of payloads.** Every field a person or agent decides is a flag. Fields that exist only to pin
"what I read" (`baseProposalVersion`, `baseLoopVersion`, `baseLabelsVersion`, `planHash`, profile hashes,
`selectionsHash`, `proposalVersion`) are **filled by the CLI from a fresh read** made in the same invocation; with
`--if-revision <n>` the CLI refuses before sending if the group revision it read differs (§6). Payloads that are
genuinely structured (a loop's inputs, a proposal) accept `--file <path>` (JSON or YAML) in addition to flags.

## 5. `orca dev`

`level`, `gate`, `checkpoint write`, `resume`, `chain start|stop|unlock`, `check-append-only` and the offline `correct`
move under `orca dev`
and leave the top-level help (`orca help dev` lists them). Everything that calls them moves in the **same commit**:
`.claude/settings.json` hooks (`src/cli.ts gate --hook claude-code`, `src/cli.ts level --hook claude-code`),
`scripts/githooks/*` (`pre-commit:23` `check-append-only`, `pre-commit:33` `validate … || [ $? -eq 2 ]`),
`package.json` `verify` (`npm run ledger -- validate` → `decision validate`), **`src/gate/settings.ts:6`
`GATE_HOOK_COMMAND` (the single source of the hook string), its sha256 pin in `tests/gate/settings.test.ts:57-62`
(updated deliberately, the commit says why), and `src/chain/gateCheck.ts:33`**, which requires a chain repository's
settings to equal `GATE_HOOK_COMMAND` exactly — a worktree branched before the move then fails the chain's gate check
by design ("detect and stop"); the plan states this and the human recreates or rebases such worktrees.
`src/panel/chains.ts` (spawns `orca chain start`), `scripts/verify-*.{mjs,ts}`, `docs/handoff/**` how-to lines, tests.
The Tier 0 gate hook must keep working at every commit: a test runs `GATE_HOOK_COMMAND` (and asserts
`.claude/settings.json` carries the same string) against a fixture push command and expects exit 2.

## 6. Revision and other "what I read" pins

### 6.1 What the audit found (Explore audit, this session; file:line at Orca main 016792ad)
- The revision is per scope: each group has `groups.revision`; repository, operator preferences, spend and
  orchestration settings have their own counters; corrections and `@global` are always 0 (`commandLedger.ts:45-102,177-178`).
- A group's revision moves only when a command changes authority (`commandLedger.ts:386-392`) or at shutdown stop
  (`controlLifecycle.ts:168-169`); driver progress, usage and checkpoint writes never move it (spec
  `2026-09-19-web-recoverable-control-design.md:353,358`). A read followed seconds later by a send rarely conflicts.
- It does real work for **content edits** (proposal-edit, set-limit, set-task-loop, labels, dependencies, agent
  choice): without it a later write silently replaces one based on a newer state.
- For **state transitions** (start, stop, pause, archive) each verb already checks state (`webDispatch.ts:165-175`,
  `stopIntent.ts:385-419`, `archiveGroup.ts`); the revision adds a mandatory read and little else.
- **`retry-task` has no state precondition of its own beyond `task-not-retryable` eligibility checks
  (`retryTask.ts:74-122`); the audit flagged that a stale retry is guarded only by the revision.** The builder must
  confirm and, if so, add the missing precondition (e.g. the run the person saw failing is still the current run) as a
  verb-level check — **this is required before the CLI stops demanding the revision for retry**.
- The revision also fences saved-result recovery (`commandLedger.ts:393-394`, `savedResultRecovery.ts:157,176`); that
  depends on the server-side counter moving, not on clients sending it — unaffected by this spec.
- orca-auto already reads the revision right before sending (`orchestration.ts:189-194`), so the check is empty for it.

### 6.2 Rule (human-approved)
- The server keeps checking `expectedRevision` exactly as today. **What changes is the CLI/MCP/skill contract**: the
  CLI reads the current revision itself and sends it, unless `--if-revision <n>` is given, in which case it sends `n`
  (a stale `n` answers `revision-conflict`, as today).
- Retries reuse the `commandId`; the CLI generates it, prints it, and `--command-id` reuses one (today's semantics).
- The skill tells agents: when an action is based on something you read earlier (not just now), pass
  `--if-revision` with the revision from that read.
- Accepted cost (human: "可以接受"): a person on the Web and someone on the terminal changing the same single value
  at the same time — the later write wins with no conflict; the Web shows the latest value.

### 6.3 Whole-document replace
- `orca proposal replace` **requires** `--if-revision`; it is the only command where the CLI refuses without it.
- On `revision-conflict` every command answers (with `--json`) one JSON object that includes the current revision and
  a list of what changed since the given revision **when the server can tell** (builder: if the panel cannot list
  changed fields cheaply, return the current revision and the current document, and say so in the reference).
- `orca proposal edit` is a TTY convenience: show → `$EDITOR` → `replace --if-revision <revision read>`; on conflict
  it prints the difference and asks again. Non-TTY ⇒ refused with a pointer to `replace`.

## 7. Output and exit codes

- Default output is human text generated from the registry's per-command formatter; `--json` prints exactly one JSON
  line (today's `orca-cli-response-v1` envelope generalised: `{schema, status, commandId?, body}`).
  **(controller's call)** No automatic switch to JSON when stdout is not a TTY — explicit is easier to reason about.
- Exit codes keep today's meaning for control commands (0 answered 2xx, 1 refused locally, 2 panel answered an error,
  3 crash) and become the rule for every command; commands with their own documented codes (`resume` exit 2,
  `chain start` 0–4, `metrics` 6) keep them and the registry records them per command.

## 8. `status`, `doctor`, `version`

- `orca status`: one screen, each line `ok|warn|fail <subject>: <fact>` — service manager state, panel answering
  (socket + HTTP), control schema version, agents table (validate), ccloop pin (package.json vs installed
  `node_modules/ccloop`), ccmem binary reachable, skill version vs CLI version. Read-only, never starts anything.
  Exit 0 all ok, 1 any fail, 0 with warnings.
- `orca doctor`: same checks plus slower ones (agent CLIs on the service PATH, `~/.orca` modes, stale sockets) and,
  per failure, one line saying what to do. Read-only; it never fixes anything itself.
- Skill version: SKILL.md frontmatter carries `version:` equal to Orca's package version, written by the generator;
  `status` compares the installed skill copy (where the agent loads it from, when findable) with the CLI.

## 9. Human-only actions from a terminal

Resolved by the human; see §15 (it replaces the earlier default "unchanged"). The offline ledger-writing `orca correct`
moves to `orca dev correct`; `orca correction record` goes through the panel and is in the open tier.

## 10. Skill and MCP

**Skill** (`skills/orca-control/`):
- `SKILL.md` ≤ ~120 lines: what Orca is in 5 lines, core rules (never start/stop the service; read state, not command
  acceptance; human-only actions; long work = poll), an **intent routing table** ("I want to … → command / reference
  file"), and the escape hatch pointer.
- `references/` generated from the registry: one file per domain (commands, flags, examples, which actions are
  human-only), `error-codes.md` (generated from `src/control/errors.ts`), `output-and-exit-codes.md`. Hand-written:
  `troubleshooting.md`, `escape-hatch.md` (`orca control get/send`, routes).
- `scripts/` only where a sequence is genuinely repeated by agents (the builder proposes; none required by this spec).
- No separate package.json; version in frontmatter (§8).

**MCP** (`orca mcp serve` stays a user command):
- **One tool**, `orca`, input `{ "args": string[] }` = the CLI argv after `orca`, always run with `--json`. Description
  ≤ 2 sentences: it runs the Orca CLI; read the orca-control skill or call it with `["help"]` for commands.
- The tool refuses the same commands the CLI would refuse for an agent, and refuses `panel`, `user`, `dev` domains.
- Measurement (success criterion): the serialized `tools/list` response is ≤ 800 bytes (today's two tools: measure
  and record the before number in the plan).

## 11. Registry and drift test (what "generated" means)

- One module (e.g. `src/commands/registry.ts`) exports an array of command definitions: domain, action, summary,
  positional ids, flags (type, required, human-only), how it maps to a control verb or read (or a local handler),
  how pins are filled, formatter for human output, exit-code notes, examples.
- Generated from it: argument parsing + `--help`, `orca help`, MCP refusal list, `skills/orca-control/references/*`
  (generated files carry a header saying so), the command section of `docs/cli.md` (the rest of `docs/cli.md` stays
  hand-written developer reference).
- `npm run gen:cli-docs` writes them; a test regenerates into memory and fails on any byte difference with the
  committed files. Mutation to see red: edit one generated reference by hand.
- A second test walks every control verb in the panel's verb list and fails if a verb has no registry entry and is not
  on an explicit "escape-hatch only" list (so new verbs cannot silently miss the CLI).

## 12. Success criteria (each a command with an exit code)

1. `npm test` green, including: registry drift test; verb-coverage test; gate-hook string test (§5); per-command
   parse tests; pin-filling tests (CLI fills `baseProposalVersion` etc. from the read; `--if-revision` stale ⇒ refused
   before send / `revision-conflict` after).
2. A scripted agent walk on a fake panel (existing fake ccloop table) using only v2 commands, no `control send`:
   open requirement → answer → consensus → accept → confirm → start → show → retry a failed task → archive. Exit 0.
3. `orca mcp serve` `tools/list` byte size ≤ 800 (test).
4. `grep -rn` for each removed top-level command name in `src/ scripts/ skills/ docs/cli.md README.md .claude/
   package.json tests/` returns only the "did you mean" table and historical docs (a test with an explicit allow-list).
5. Mutations seen red: remove the retry-task precondition (§6.1); make `replace` send without `--if-revision`; drop a
   verb from the registry; hand-edit a generated reference.

## 13. Left to the builder
- Exact action names inside a domain, flag names, the human-text formats, YAML support for `--file`.
- Whether `orca help` renders references from the registry at runtime or reads the generated files.
- How slug/prefix resolution is served (one `get summary` read is enough today).
- Ordering of the migration in the plan (suggested: registry + generator + drift test → read commands → write
  commands → dev move + hook rewrite in one commit → skill/MCP → delete old names).

## 14. Builder check round 1 (independent reviewer, session 8b1469ea) — resolutions

These override the sections they name.

- **R1 Retry with a command id (overrides §6.2 "today's semantics").** The panel replays a command id only for a
  byte-identical request (`commandLedger.ts:155-159`); a CLI that re-reads pins on retry would get
  `command-id-conflict`. **(controller's call)** (a) Transport retries inside one invocation resend the same bytes
  from memory. (b) When an outcome is uncertain (timeout, dropped connection, `retryable:true`), `--json` output
  carries `request`: the exact `{route, expectedRevision, payload, commandId}` sent. (c) `orca command retry
  --request <file|->` looks the id up first and, only on a confirmed miss, resends exactly those bytes. No local
  journal (no new out-of-repo write). `--command-id` on an ordinary command keeps meaning "use this id for a new
  request".
- **R2 `retry-task` stale guard (overrides the §3 non-goal "no protocol change").** Additive, optional payload
  fields are allowed when a guard needs them. **(controller's call)** `retry-task` gains optional `runId`: when present,
  refused unless it is the task's current run (new code `task-run-moved`). The CLI fills it from its read; the Web UI
  sends the run it displays. The full list of protocol additions is in §3 non-goals.
- **R4 `project register-plan`.** **(controller's call)** Add the plan-registration route to the control socket
  (`/api/control/projects/<id>/plans`, same handler and validation as the HTTP route, not human-only: registering
  a git-tracked file in a registered repo spends nothing).
- **R5 `requirement continue`** maps to the verb defined by `docs/superpowers/specs/2026-10-21-clarify-scope-caps-design.md`
  (#86, being implemented in parallel). If that verb has not landed when this is built, omit the command.
- **R6 `run show <run>`.** No single-run read exists. **(controller's call)** `run show` = one call that reads the
  group view's run entry + the activity head + the evidence manifest summary, client side; no new route.
- **R7 `command show <commandId>`.** A `cli-<uuid>` id carries no scope. **(controller's call)** Requires the scope as
  a flag (`--group <id>`, `--project <id>`, `--operator`, `--spend`); with `--json` output of the original command the
  scope is included in `request`, so agents have it.
- **R8 Exit codes (§7).** Add: `decision validate` exit 2 = downgraded (relied on by `scripts/githooks/pre-commit:33`
  and `verify`'s `|| [ $? -eq 2 ]`, both rewritten in the same commit), `dev gate` exit 2 = block,
`dev check-append-only` (`pre-commit:23`) keeps its codes.
- **R9 Refusals (§10).** Human-only refusals are enforced by the panel, not the CLI (`controlCommand.ts` does no
  check); the registry records human-only so help and references say so, and the MCP tool forwards to the panel
  like the CLI. The MCP tool itself refuses only the `panel`, `user` and `dev` domains.

## 15. Who may do which action (replaces the earlier R3/R3a text; review round 1 fixes C1–C3, I1–I6)

**Rulings.** Human: "人通过 agent 做的动作，不也算人做的选择吗。所以我理解可以适当放宽。"; on the three tiers "其他同意";
"批准 agent 解决合入冲突 => 为什么 agent 不能做？" (moved to open: Orca already dispatches conflict resolution itself,
kanban S5); "如果用户在 Orca WebUI配置的的合入方式就是 开PR 或 push到哪个分支的话，那 orca 本身也要能做这些动作才对吧？"
(executing the configured delivery is automatic and unaffected; only setting/changing where work goes needs a token).
The boundary that matters is an **attended session** versus **a run Orca dispatched** (an agent must never approve its
own work or raise its own budget), not "a person clicked" versus "an agent typed".

### 15.1 The table (every entry of today's `VERB_ACCESS` human-only and `HUMAN_ONLY_FIELDS`, by name)

| Verb / field (today human-only) | Socket agent, no token | Socket + person token | Socket + dispatched-run marker | Web member |
|---|---|---|---|---|
| `correction-record`, `correction-close`, `correction-withdraw`, `correction-debug-open.undoHow` | open | open | refused | unchanged (refused) |
| `approve-pending-decision`, `reject-pending-decision`, `ratify-flagged-decision` | open | open | refused | unchanged |
| `add-group-dependency`, `remove-group-dependency` | open | open | refused | unchanged |
| `set-criteria-review`, `set-orchestration-settings` | open | open | refused | unchanged |
| `retry-integration`, `resolve-integration-conflict` | open | open | refused | unchanged |
| `set-integration-check` with `command: null` (use the groups' own checks) or `enabled:false` | open | open | refused | unchanged |
| `set-integration-check` with a non-null `command` | **token** | open | refused | unchanged |
| `confirm.integrationHash` (confirm under the configured integration, any delivery) | open (field leaves `HUMAN_ONLY_FIELDS`) | open | refused | unchanged |
| `set-integration-scheme`, `set-group-integration` with `delivery:"keep"` | open | open | refused | unchanged |
| `set-integration-scheme`, `set-group-integration` with any other delivery | **token** | open | refused | unchanged |
| `set-limit`, `requirement-open.limit`, `proposal-edit.proposedGroupLimit` | **token** | open | refused | unchanged |
| `set-spend-cap`, `clear-spend-cap`, `set-usage-calendar`, `settle-unknown-usage` | **token** | open | refused | unchanged |
| `apply-agent-update` | **token** | open | refused | unchanged |

- **(controller's call, flag for the human)** `set-integration-check` with a custom `command` makes Orca run that
  command in its own environment, outside ccloop's sandbox — equivalent in reach to "where work goes", so it is in the
  token tier; switching the check on with the groups' own checks stays open.
- **Web members are unchanged (I3).** Today one `humanOnly` column in `permissions.ts:17-21` covers members and the
  socket agent. The implementation splits it: the socket agent gets the tiers above; the member row keeps today's
  refusals. Changing what members may do is out of scope.
- A test enumerates `HUMAN_ONLY_VERBS` and `HUMAN_ONLY_FIELDS` at build time and fails if any entry is missing from this
  table's code mirror (a new human-only verb cannot fall through unclassified).
- `confirm` cannot carry "a different integration": it carries only a hash, and a mismatch is already refused
  `integration-unapproved` (`webService.ts:1356`). R3a therefore means exactly: remove `integrationHash` from
  `HUMAN_ONLY_FIELDS` for the socket agent.

### 15.2 Attribution (C2)

Opening a verb must not record an agent's act under the person's name. Today `principalLabel` (`permissions.ts:9`)
reaches only the command ledger; correction rows take `by` from the panel operator (`correctionCommands.ts:97-100`,
`decisionCommands.ts:164,188`), and an approval writes `undo.how by ${command.actorId}` into the committed `.decisions`
ledger (`decisionCommands.ts:70-73`). The implementation passes the principal into every writer an opened verb
reaches (corrections store, decision-ledger lines, closing rows, `undoHow`, ratify marks): a socket agent writes
`agent:<client>`; a token writes `user:<id>` plus `via agent:<client>`. Criterion: an agent-sent approve and record
each produce a line containing `agent:` (red if the writer falls back to the operator).

### 15.3 Person token (C1)

- **This weakens accounts spec §2 / §3.5, and the spec says so.** Today a process using Orca's interfaces "cannot
  perform a human-only action without a human's password" and the socket "can never do a human-only action whatever it
  sends". With a token on disk, any process running as the person can use it through the CLI. Implementation adds a
  Correction section to `2026-10-07-accounts-and-spend-caps-design.md` naming this spec (history unchanged, Rule 13).
- **Explicit use only.** `orca login` (panel account password, typed at the terminal) stores a token; the CLI sends it
  **only when the command carries `--as-person`**. No command uses it implicitly, so an unattended agent does not use it
  by accident; a person's own agent uses it when the person tells it to add the flag.
- **Store (Rule 17).** Directory `$ORCA_PERSON_DIR` (default `~/.orca/person`), created `0700`; token file `0600`;
  an existing file's mode is never changed; registered here as an out-of-repo write by `orca login` / `orca logout`;
  failure leaves no partial file (write temp + rename). Tests use a temp `ORCA_PERSON_DIR` only.
- **Lifetime and revocation.** The token is its own session (`sid`) in the accounts store with a fixed lifetime equal
  to the Web session length (no sliding refresh, so the CLI never rewrites the file); `orca logout` revokes that `sid`;
  the Web UI lists and revokes CLI sessions next to browser sessions. `orca user rotate-key` still revokes everything.
- **Dispatched runs** get `ORCA_PERSON_DIR` pointed at an empty directory, and the CLI refuses `--as-person` when the
  dispatched-run marker is present. Getting around this takes a deliberate change of environment and `HOME`; stated as
  a convention at Orca's interfaces, not a security boundary.

### 15.4 Dispatched-run marker (I5)

- Orca sets `ORCA_DISPATCHED_RUN=<runId>` (a name without KEY/SECRET/TOKEN, so environment filters keep it) in every
  process it starts for work: ccloop runs (all kinds), system debug and criteria-review runs, chain sessions. The CLI
  sends it as a socket request header; the socket refuses every verb in §15.1 with `control-dispatched-run-refused`.
- Criterion: a fake-agent run under each kind (claude, codex, omp fakes) prints the variable from its shell and the
  harness asserts it is present; if a kind drops it, the plan stops and reports (no ccloop change in this spec, Rule 16).

### 15.5 Wire format (I4)

Socket requests gain two optional headers: `x-orca-person-token: <token>` and `x-orca-dispatched-run: <runId>`.
New refusal codes: `control-person-token-required` (403), `control-person-token-invalid` (401),
`control-dispatched-run-refused` (403), `task-run-moved` (409, R2). The Web HTTP API ignores both headers.

### 15.6 Added success criteria (extend §12)

6. Access matrix test: every §15.1 row × {socket agent, socket + valid token, socket + marker, socket + token + marker,
   Web member, Web owner} answers as the table says; mutation per tier (move one verb across a tier boundary) seen red.
7. R1: a retried uncertain command resends the stored request and gets the replay; mutation "re-read pins on retry"
   seen red as `command-id-conflict`.
8. R2: stale `retry-task` with an old `runId` ⇒ `task-run-moved`; mutation removing the check seen red.
9. R3a: confirm under a configured non-`keep` integration succeeds with no token; `set-group-integration` to a
   non-`keep` delivery without a token ⇒ `control-person-token-required`.
10. Token store: temp `ORCA_PERSON_DIR`; dir 0700, file 0600; pre-existing file's mode unchanged; `logout` revokes
    the `sid` (the next call ⇒ `control-person-token-invalid`); no test touches `~/.orca`.
11. R4: socket plans route registers a tracked file and refuses a changed one (`plan-changed-since-registration`).
12. R8: `decision validate` exit 2 on a downgraded ledger; `dev gate` exit 2 on a push; the rewritten pre-commit hook
    and `verify` still pass on a clean tree.
13. Attribution (§15.2) and marker propagation (§15.4) as stated there.
- §12 criterion 2's "fake panel" = the existing control-plane harness used by `tests/control/*E2E.test.ts` with the
  fake agents table (`tests/control/fixtures/ccloopWorld.ts`); the builder names the exact entry point in the plan.

## 16. Correction after commit (human review, session 8b1469ea)

- **§15.2 attribution is replaced.** Human: "具体的记法你可以再review一下，我感觉怪怪的". The earlier text mixed two facts
  in one field (`agent:<client>` as if an agent were an accountable party; `user:<id> via agent:<client>` as one string).
  Every writer an opened verb reaches records two separate fields:
  - `by`: the accountable **person**, always a person. A token call ⇒ the token's account. A socket call without a
    token ⇒ the panel owner (the socket is local to the owner's machine; the human ruled that what a person does through
    an agent is the person's choice). Orca-dispatched runs are refused (§15.4), so they never reach a writer.
  - `via`: the channel — `web`, `cli:<client>`, `mcp:<client>`.
  - Where a store holds one line of text (e.g. the `.decisions` evidence line), it is rendered `by <person> via <channel>`.
  - Criterion (replaces §15.2's): an agent-sent approve and record each produce `by` = the owner and `via` = `cli:<client>`
    or `mcp:<client>` (red if `via` is dropped or `by` holds a non-person value).
- **Existing tests.** Human: "允许改必要的test。改cli这个大架构变化肯定会影响到现有test。" Tests that pin removed command
  names, the old CLI/MCP surfaces, the gate hook string and its sha256, and the human-only refusals that §15 changes may
  be rewritten. Each rewrite is listed in the plan's ledger as file:line old → new with the reason (Rule 9 still
  applies: a rewritten criterion must be seen red on a mutation of the behaviour it now pins).
- The controller's call on `set-integration-check` with a custom command (token tier, §15.1): human "同意".

## Correction (2026-10-22, session b37f7ce9)

Recorded by the CLI v2 fixer (session b37f7ce9) on `feat/cli-v2`, after review finding M2. §15.3's text above is kept
as written (Rule 13); this section corrects it.

- **Wrong:** §15.3's last bullet says getting around the dispatched-run guard "takes a deliberate change of environment
  and `HOME`". `HOME` need not change. A dispatched run's processes run as the person, Orca does not relocate their
  `HOME`, and the token's default path is under that real `HOME` (`~/.orca/person/token.json`). Unsetting
  `ORCA_DISPATCHED_RUN` and `ORCA_PERSON_DIR` is enough: the CLI then reads the person's token and sends it with
  `--as-person`, and the socket sees no marker header.
- **What the protection actually rests on:** (1) the token is sent only when a command carries `--as-person`, so it is
  never used by accident; (2) a process that keeps the environment Orca gave it is refused twice — the CLI refuses
  `--as-person` (and `login`) under the marker, and the socket refuses every §15.1 verb to a request carrying the
  marker header; (3) its `ORCA_PERSON_DIR` names an empty directory, so even a CLI that ignored the marker finds no
  token. All three hold only while the dispatched process leaves `ORCA_DISPATCHED_RUN` and `ORCA_PERSON_DIR` as set: a
  process that deliberately unsets them, or reads the token file directly, is not stopped. The boundary that does hold
  is the operating-system user; §15.3's "a convention at Orca's interfaces, not a security boundary" stands.
- **Same review, implemented on this branch:** the default path is computed from the passed environment's `HOME`, not
  `os.homedir()` (a missing or relative `HOME` is refused), as `src/agents/paths.ts` does; and the marker and the empty
  person directory now also reach the agent-written commands Orca runs itself — the debug reproduction check, the
  criteria base re-run, the integration check — and chain sessions (a per-chain empty `0700` directory under the git
  dir, beside the chain's stop request).
