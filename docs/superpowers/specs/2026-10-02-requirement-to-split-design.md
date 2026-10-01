# N1: from an idea to a confirmed split — design

Status: designed with the human section by section; written for the human's review.
Author: Orca controller session `b5e8d368`, 2026-10-02.
Source: `docs/handoff/goal.md` §10 N1 (agreed 2026-09-28), §10.2 G7.

## 1. Rulings

Every line below is the human's, given in session `b5e8d368` (2026-10-01/02), in the order they were asked.

| # | Question | Ruling |
|---|---|---|
| H1 | What is the first usable version? | **Thin end-to-end slice**: rounds of questions → requirement document → split draft → code validation → the existing confirm. "Look up facts yourself" (sub-agents reading the target repository) moves to **version 2**. |
| H2 | What does the model see of the target repository? | **Code attaches a repository overview automatically.** The human added: code may also collect basic structure with codegraph / ast-grep. |
| H3 | Which structure tool? | **ast-grep `outline`, as an optional enhancement** (§6). codegraph is not used in version 1. |
| H4 | Spending cap of one requirement | **One total grant per requirement, default 10,000,000 tokens**, editable in the panel ("需求讨论清楚是很重要的，否则后面会越做越偏"). |
| H5 | Where the requirement document goes | Under `.orca/requirements/` in the target repository, named like superpowers names specs: **`.orca/requirements/YYYY-MM-DD-<slug>.md`**. |
| H6 | Architecture | **B′**: a requirement *is* a group, with a new earliest status `clarifying`; the single-call estimate chain is generalised into a single call with a `purpose` (`estimate` / `clarify` / `split`) and the requirement is built on it. |
| H7 | Model output that fails its schema | **Retry, but not forever**: at most two automatic retries, then stop with a reason code. |
| H8 | Languages | UI strings stay in the i18n catalogue (zh + en today; a new language is a new catalogue). Model-generated content is **not translated**: each requirement has one content language, defaulting to the panel's current UI language. A "translate to the current language" button is **not** in version 1. |

The controller decided the following itself (Rule 1 ladder, all reversible) and reported each to the human, who
did not object: at most five questions per round; "accept every recommended answer" in one click; a split draft can
be sent back with free-text feedback; one requirement targets one repository; the requirement's agent is resolved
from the agent preferences like the estimator's; the requirement document is exported as the first commit of
`orca/<groupId>` (§9), never into the person's working tree.

## 2. Goal and success

A person writes an idea in the panel. Orca asks rounds of numbered questions, each with a recommended answer, until
the person says the requirement is agreed. Orca then drafts a split into loop tasks; code expands it into a plan,
validates it and computes which tasks run in series and which in parallel; the person accepts it. From there the
group continues exactly as an imported plan does today (estimate → confirm → start → land), and the agreed
requirement document lands in the target repository with the work.

Division of labour (Rule 5): the model answers judgment questions only — which questions are on the frontier, the
recommended answers, the restatement, the acceptance criteria, the split. Code records every round, decides every
state transition, validates every model output, computes series/parallel from dependencies and write sets, and
renders the document. The person decides: answers, consensus, accepting a draft.

Success criterion (mechanical): the end-to-end criterion of §12.3 passes in a fresh-clone gate, and the gate of
§12.4 exits 0.

## 3. Out of scope for version 1

- Sub-agents that read the target repository to answer factual questions (version 2; codegraph may be used then,
  on a temporary clone with its network features off — it always writes `.codegraph/` into the repository it
  indexes).
- Going back from split drafting to question rounds (`requirement-reopen`); feedback on a draft covers course
  corrections in version 1.
- Translating model-generated content; a requirement spanning several repositories; deleting a requirement
  (groups cannot be deleted today either).
- CLI / skill / MCP entry points (N2).

## 4. Data model

### 4.1 The group gains an earliest status

`GroupView.status` gains `clarifying`: `clarifying → draft → ready → running → review → done` (plus `blocked`).

A `clarifying` group has **no** `planHash`, `plan`, `proposal` or work items. It carries:

- `requirement: { requirementId, repoId, slug, contentLanguage, createdOn }` — `createdOn` is the `YYYY-MM-DD` used in
  the file name, `slug` is filled from round 1 (§7.3).
- a reduced ledger: `limit` (default `{tokens: 10_000_000, activeMs: 14_400_000, attempts: 40, sessions: 40}` —
  at most 40 calls, automatic retries included; `set-limit` edits it), `used`, `reserved` (the grant of the call in
  flight), `usageUnknown`.

Every code path that reads a plan, a proposal or work items refuses or skips a `clarifying` group explicitly
(`requirement-not-split`), each with a criterion. Paths found by the plan's survey (Task 0) are listed in the plan.

### 4.2 New tables

Both keyed by `group_id`, in the style of `estimates`:

- `requirement_rounds(group_id, round_no, state, body)`. `state`: `drafting` → `awaiting-answers` → `answered`;
  side states `interrupted`, `failed`. `body`: the questions as code numbered them, the model's restatement,
  acceptance criteria, glossary and ADR proposals, `frontierEmpty`, `openBranches`, the person's answers and their
  per-item acceptance of glossary/ADR proposals, the run ids and usage of the round's calls, the overview hash and
  commit the round saw, the automatic-retry count.
- `requirement_drafts(group_id, draft_no, state, body)`. `state`: `drafting` → `awaiting-review` → `accepted` /
  `rejected`; side states `invalid` (handed back automatically), `interrupted`, `failed`. `body`: the model's raw
  output, the expanded plan, the validation result (pass, or every reason), the computed layers, the person's
  feedback, the automatic-retry count.

### 4.3 The requirement document is derived, never stored twice

A pure function renders the document from the two tables (§10). The panel shows its output; the export writes its
output. There is no separately edited copy that could disagree with the records.

## 5. The single call, generalised

### 5.1 Phase 1 — a pure refactor

`EstimateRun` (`phase: "estimate"`) becomes `SingleCallRun` (`phase: "single-call"`, `purpose: "estimate"`). Each
purpose registers four things: build the request and prompt, the JSON schema, classify the output, complete in the
store. Claim plumbing, the protocol-3 envelope (`toSingleCallEnvelope`), steps A1 / A2 / B / Ce, the record check,
accounting, handoff-stop, stop intents and recovery are written once for `phase === "single-call"`.

The work item key stays `estimateId` for `estimate`; the new purposes use `round:<n>` and `draft:<n>`.

Phase 1 changes no behaviour: **every existing criterion of the estimate chain stays unchanged and green**; the only
new criterion refuses an unknown purpose. A gate (§12.4) runs between phase 1 and phase 2; phase 2 does not start
until it passes.

### 5.2 Grants

`estimate` keeps `ESTIMATE_GRANT`. `clarify` and `split` calls each reserve
`{tokens: 1_000_000, activeMs: 1_200_000, attempts: 1, sessions: 1}` from the requirement's limit and settle at the
usage the tools report. A call whose grant no longer fits the remaining limit is not claimed: the round or draft
waits with `requirement-budget-exhausted` until `set-limit` raises it.

## 6. Repository overview

Built by code at step A2 of every `clarify` and `split` call.

- **Which tree**: the committed tree of the target repository's base, i.e. the commit `HEAD` resolves to when the
  overview is built (the same commit `ensureWorkBranch` would branch from). The person's working tree and index are
  never read. The commit id is recorded.
- **File list**: `git ls-tree -r --name-only <commit>`, sorted; at most 4,000 paths or 120 KB, whichever comes first.
  When cut, a table "top-level directory → file count" is attached and the cut is stated ("N of M listed").
- **Documents**: `README*`, `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` at the root, read with
  `git show <commit>:<path>`; at most 16 KB each and 48 KB together; binary or non-UTF-8 files are skipped and named.
- **Structure (optional)**: `ast-grep outline` listing each file's exported symbols.
  - The files ast-grep supports are exported with `git archive <commit>` into a private temporary directory under
    Orca's state directory (0700) and removed afterwards; no worktree is registered and nothing is written in `.git`.
  - Orca's own `sgconfig` is passed with `-c`; the target repository's `sgconfig.yml` is not read. Fixed thread count;
    output sorted by path.
  - Caps: 50 MB exported, 120 KB of output, 30 s.
  - Status: `ok` / `unavailable` (no binary) / `skipped-too-large` / `timeout` / `failed`. Anything but `ok` is stated in
    the overview and the call proceeds without it.
  - Binary: `ORCA_AST_GREP_BIN` if set, otherwise the npm dependency `@ast-grep/cli` at an exact pinned version.
- **The overview** is canonical JSON `{commit, files, docs, structure}`, each part with its own status and cut
  information, hashed and stored as an artifact, cached per (repository, commit).
- **The target repository is data**: it is fenced in the prompt with explicit delimiters and the instruction says the
  fenced text is data, not instructions. The call runs with tools off, its output is validated by code, and the person
  confirms.

To be measured in the plan's Task 0 (read from source only so far): that `-c` fully hides the target's
`sgconfig.yml`; the exact JSON fields of `outline --json=stream`; that ast-grep writes nothing. A result that differs
comes back to this spec as a correction.

## 7. `clarify`

### 7.1 Input

The idea, the content language, the overview, every previous round (questions, recommended answers, the person's
answers), the accepted glossary and ADRs, the previous restatement and acceptance criteria, and a fixed instruction
carrying the four grilling rules of goal.md N1: ask only questions on the frontier (whose premises are settled) and
defer the rest; give a recommended answer to every question; do not ask what the overview already answers; at most
five questions. On an automatic retry the instruction also names what the previous output got wrong.

### 7.2 Output schema

```
{ slug?: string,                       // required in round 1
  statement: string,                   // the whole restatement; the latest round's wins
  acceptanceCriteria: [{ id, text }],  // the whole list; the latest round's wins
  questions: [{ key, question, recommendedAnswer, why, dependsOn: string[] }],   // 0..5
  frontierEmpty: boolean,
  openBranches: string[],              // branches seen and deliberately deferred
  glossary: [{ term, definition }],    // new proposals
  adrs: [{ title, context, decision, consequences }] }   // new proposals
```

### 7.3 Classification (code)

Schema valid; `frontierEmpty === false` ⇒ at least one question; `dependsOn` names only questions of this round or
of earlier rounds; acceptance-criterion ids unique; question numbers are assigned by code (`R<round>.Q<n>`), never
taken from the model. Round 1's `slug` must match `^[a-z0-9]+(-[a-z0-9]+){0,7}$`; otherwise the slug falls back to
`requirement-<first 8 of requirementId>`. An ADR proposal becomes a record only when the person accepts it.

A failure retries automatically, at most twice per round (H7); then the round is `failed` with
`clarify-output-invalid`.

## 8. `split`

### 8.1 Input and output

Input: the rendered requirement document, the overview, every previous draft with the person's feedback or the
validation reasons it was handed back with.

```
{ tasks: [{ taskId, title, labels: string[], loopPlan?: string, goal, successCondition,
            targetPaths: string[], checks: string[], dependsOn: string[], traces: string[] }],
  notes: string }
```

### 8.2 Expansion (code)

Into a complete plan file: `targetRepo` = the repository `repoId` resolves to; `ccloopBin`, `runsDir` from the panel
configuration; `workBranch: "orca/<groupId>"`; `policy: "local-merge"`; `goal` = the statement; `successConditions` =
the acceptance criteria's texts; every task a loop task (`loop: { goal, successCondition, targetPaths, checks,
plan?: loopPlan }`, labels kept), `targetVersion: 1`.

### 8.3 Validation (code; any failure hands the whole draft back with every reason)

1. Every check `loadPlan` and the Web import apply today.
2. `expandLoopTask` succeeds for every task.
3. `buildGraph` finds no cycle.
4. Every `targetPaths` entry exists in the overview's commit or lies under a directory that does.
5. Every acceptance criterion is traced by at least one task; every trace names an existing criterion or ADR id.

A failure retries automatically, sharing one counter with schema failures, at most twice per draft (H7); then the
draft is `failed` with `split-validation-exhausted` (or `split-output-invalid`), carrying the last reasons.

### 8.4 Series and parallel

Computed by `buildGraph` from explicit dependencies and the implicit edges write-set conflicts produce. The panel
shows the layers code computed and names the write-set conflict behind each implicit edge. The model never declares
them.

## 9. Accepting a draft and exporting the document

### 9.1 `requirement-draft-accept` (one transaction)

- Freeze the document: render it from the records now, hash it, store the hash on the group.
- Import the expanded plan into this group (`clarifying → draft`), creating work items, proposal and estimate as
  `importControlPlan` does today, through a new entry point that takes a stored plan instead of an allowlisted file.
- Carry the budget over: the new `limit` = what today's import formula gives + the `used` of the clarifying phase;
  `used` carries over unchanged.
- Record each work item's `traces`.
- Queue a `requirement-export` wake.

### 9.2 Export (in the driver: it has git side effects)

- Name: `.orca/requirements/<createdOn>-<slug>.md`; on a name already present in `HEAD`'s tree, `-2`, `-3`, ….
- Git plumbing only; the working tree and the index are never touched: `hash-object -w` the document; build a tree
  from `HEAD`'s tree plus the file with a temporary index (`GIT_INDEX_FILE` under Orca's state directory);
  `commit-tree` with `HEAD` as parent, author and committer `Orca <orca@localhost>`, message
  `docs(requirements): <slug>` with the `Orca-Document-Sha256` trailer; `update-ref refs/heads/orca/<groupId> <commit> ""` (create only).
- `ensureWorkBranch` then finds the branch and keeps it; every task lands on top of the document commit.
- Idempotent: a branch whose tip is that commit with the frozen document hash counts as done. A branch that exists
  with anything else blocks with `requirement-export-conflict`; it is never overwritten.
- What it writes into the target repository is of the same kind as today: git objects and refs under `orca/`.
- `HEAD` here is `HEAD` at export time, which may be newer than the commit the overviews saw; both are recorded, and
  the group records the export's parent commit and the commit message carries the document hash
  (`Orca-Document-Sha256: <hash>` trailer). The document itself names neither: it is frozen before the export exists,
  and it cannot contain its own hash.

### 9.3 Gates

`confirm` does not wait for the export. `start` is refused with `requirement-export-pending` until the export is done.

## 10. The requirement document

Rendered by one pure function, in the requirement's content language for prose; identifiers stay as they are.

```
---
orcaRequirementId: <requirementId>
orcaGroupId: <groupId>
repo: <repoId>
createdOn: <YYYY-MM-DD>
---
# <slug as title>
## Statement
## Acceptance criteria         (id: text)
## Glossary                    (terms only, no implementation)
## Decisions (ADRs)            (accepted only)
## Rounds                      (R<n>.Q<k>: question / recommended / answer)
## Consensus                   (round, time; open branches the model still listed, if any)
## Split                       (only after accept: criterion → tasks table)
```

Same records ⇒ the same bytes; a criterion pins this.

## 11. Commands and panel

### 11.1 New commands

All through `applyWebCommand` (`commandId`, `expectedRevision`, `actorId`, replay by command id and request hash).

1. `requirement-open { groupId, repoId, idea, limit?, agent?, contentLanguage? }` — creates the `clarifying` group and
   round 1, queues a `clarify` wake. `idea` at most 32 KB; `repoId` must be a registered repository.
2. `requirement-answer { roundNo, answers[], glossaryDecisions[], adrDecisions[] }` — every question answered
   (`{kind:"recommended"}` or `{kind:"text", text}`); round → `answered`; queues the next round.
3. `requirement-consensus { roundNo }` — only when the latest round is `answered`. Allowed while the model still lists
   open branches; those branches are then written into the document's Consensus section and shown in the panel.
   Queues draft 1.
4. `requirement-draft-feedback { draftNo, feedback }` — draft → `rejected`; queues the next draft.
5. `requirement-draft-accept { draftNo, draftHash }` — §9.1.

Existing commands reused: `set-limit` (on a `clarifying` group it edits the reduced ledger), `handoff-stop` (the call
in flight; its round or draft becomes `interrupted`, usage booked), `recovery-retry` (a `failed` or `interrupted`
round or draft).

Reason codes: `clarify-output-invalid`, `split-output-invalid`, `split-validation-exhausted`,
`requirement-budget-exhausted`, `requirement-not-split`, `requirement-export-pending`, `requirement-export-conflict`.

### 11.2 Panel

- A fifth navigation section **Requirements**, always mounted like the other four (hidden only by
  `.section-pane:not([data-active="true"])`). `clarifying` groups also appear in Task control with a badge linking
  here; after accept the group is operated from Task control as today.
- Left: the requirement list. Right: details.
  - New requirement: repository (registered `repoId`s only), idea, limit (10M), optional agent, content language
    (default: the current UI language).
  - Current understanding: statement, acceptance criteria, glossary, accepted ADRs, open branches, a budget bar
    (used / limit / in flight; tool-reported numbers only).
  - Rounds: earlier rounds collapsible; the current round is a form, each question preset to "use recommended",
    switchable to free text; "accept all recommended"; per-item accept/reject of glossary and ADR proposals.
    While the model drafts, "drafting" with a stop button.
  - Consensus button; when the model still lists open branches, a second confirmation shows them.
  - Draft review: task table (id, title, labels, loop plan, target paths, checks, dependencies, traces), the computed
    layers with the write-set conflict behind each implicit edge, validation results, a feedback box, accept (with
    `draftHash`).
  - Document preview, rendered by §10's function as preformatted text (no new markdown dependency); after accept, the
    export state and commit id.
  - Each reason code with a one-line explanation and a retry button.
- Data: the control projection gains a requirement summary (state, round, open questions, budget) on the existing
  2-second `changeSeq` pull; details come from `GET /api/control/groups/:id/requirement`. New commands join
  `ControlAction` and inherit the in-doubt command recovery.
- UI strings in the i18n catalogue in zh and en; the pseudo-locale criterion covers them. Model content is shown as
  written.

## 12. Testing and gates

Every new branch names the mutation that deletes *it* and that mutation is seen red (CLAUDE.md Rule 9).

### 12.1 Phase 1

Every existing estimate criterion unchanged and green; one new criterion (unknown purpose refused). Mutation: route
`estimate` to a wrong classifier ⇒ estimate criteria red.

### 12.2 Phase 2, by module

- Overview: cuts and the directory table; document caps; the five structure statuses (driven by a fake ast-grep
  binary); the target's `sgconfig.yml` ignored; **zero writes to the target repository** — working tree, index and
  `.git` snapshotted before and after, directory mtimes included.
- `clarify` classification and retry; `split` expansion, one criterion per hand-back reason and one fully valid draft;
  layers equal `buildGraph`'s.
- Document rendering: same records ⇒ same bytes; frozen text unaffected by later record changes.
- Export: working tree and index untouched, create-only, idempotent re-entry, conflict blocks, name suffixes.
- Commands: legal and illegal transitions, revision CAS, replay; the budget carry-over arithmetic; `start` refused
  before export.
- Panel (jsdom): round form and "accept all recommended", consensus second confirmation, draft layers, pseudo-locale.

### 12.3 End to end

Fake claude + a real ccloop build + fake codex: open → two rounds → consensus → draft 1 invalid, automatic retry →
valid → accept → import → export → estimate → confirm → start → land on `orca/<groupId>`, and the landed history
contains the document commit. Whether ccloop's fake claude can answer single calls per purpose is measured in Task 0;
if not, ccloop's test fixture gains a mode (fixture only, pushed before Orca's tests need it).

### 12.4 Gate (after phase 1 and after phase 2)

Fresh `git clone --local` of both repositories, HOME and the four XDG roots redirected, a short real TMPDIR,
`ORCA_CCLOOP_BIN` = the ccloop clone's build; web built in the clone. Orca full suite, web check, `verify:panel`,
`verify:ccloop-pin`, `check-tmp-leak`; the real `~/.orca` byte-identical before and after. Known flakes are judged by
re-running the single file once load is down, with `uptime` recorded.

### 12.5 Paid run

After phase 2, one small requirement end to end under real claude on a scratch repository (n = 1). Asked of the human
separately, with the expected rounds and the cap, before it runs.

## 13. Writes outside the repository (Rule 17)

| Writer | Path | Trigger | Residue on failure |
|---|---|---|---|
| overview builder | `<control state dir>.overview/<repoKey>/<commit>/` (cache, 0700/0600) | every `clarify`/`split` call | a cache entry, reused or overwritten by the same commit |
| ast-grep export | `<control state dir>.overview/tmp-<runId>/` (0700) | structure step | removed in `finally`; a crash leaves it, removed on the next build |
| export index | `<control state dir>.overview/index-<groupId>` (0600) | `requirement-export` | removed after `write-tree`; a crash leaves it, rewritten on retry |

All three follow the control state directory (`ORCA_CONTROL_DIR`, `--control-state-dir`); criteria run against a
redirected one.

## 14. Later

- Version 2: sub-agents that look facts up in the target repository; codegraph on a temporary clone.
- `translate` as a fourth purpose of the single call, shown beside the original, never replacing it.
- `requirement-reopen`.
- CLI / skill / MCP (N2) over the same commands.

## 15. Corrections from planning (2026-10-02, session `b5e8d368`; the text above is kept as written)

Found by the plan's drafter against the code (`docs/superpowers/plans/2026-10-02-requirement-to-split.md`, rulings DR1–DR28):

1. §5.1 `round:<n>` / `draft:<n>` cannot be ids (`idSchema` has no colon): the keys are `round-<n>` / `draft-<n>`.
2. §5.1 "`phase: "single-call"`, `purpose: "estimate"`" contradicts what is on disk: `phase: "estimate"` sits in hashed
   dispatch envelopes, an `attempt_evidence` CHECK constraint and a criterion. Stored estimate runs keep
   `phase: "estimate"`, read as purpose `estimate` by code; new purposes are stored as `phase: "single-call"` with
   `purpose`; no row is rewritten (DR1).
3. §11.1: answering a round queues the next round only while the model reports the frontier open; consensus is allowed
   when the latest round is answered, awaiting answers, failed or interrupted (DR10). As written, consensus could never
   be reached.
4. §12.3: the ccloop fixture need not be pushed first; Orca's criteria load it from the clone `ORCA_CCLOOP_BIN` names.
5. §13 also gains the export's two scratch files, `document-<groupId>.md` and `message-<groupId>.txt`, beside the index,
   with the same lifetime.
6. §4.1: booking usage on a clarifying group keeps the ledger mirror in sync without a proposal; a clarifying group must
   not be read as a legacy group by the `"planHash" in group` test.
7. §11.1: a clarifying group survives a panel restart: shutdown treats it as driver-owned (DR17).
8. §6: the ast-grep facts read from source agree with this spec; Task 0a measures them on the real binary.
9. The control store schema goes to v6 (DR5, controller ruling under the human's standing instruction); an older Orca
   build then refuses a migrated store with `control-schema-unsupported`.
10. §6 "exported with `git archive`": `git archive` runs the target repository's smudge filters (a task review measured
    it; with git-lfs that writes into `.git/lfs/objects`) and nothing bounds it. The export reads raw blobs from the
    `ls-tree` listing with one `git cat-file --batch` (no filters, no attributes), every git child has a timeout, and only
    an `ok` structure result is cached (Task 5 review, controller rulings).
