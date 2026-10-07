# Orca

_Leave it to Orca — every idea, made real._

Orca turns an idea into tasks, runs those tasks with coding agents (Claude Code or Codex), and lands the results
on a git branch for you to review. You drive it from a local Web panel.

This README is about that panel: what Orca is, how to install and configure it, how to start the panel, what each
section does, and what is and is not safe. The command-line reference (`orca plan`, `orca correct`, checkpoints, the
Tier 0 gate, `orca chain`, the control foundation) is in [docs/cli.md](docs/cli.md).

- **People:** read top to bottom.
- **Coding agents operating Orca:** [Configure](#configure) and [Safety](#safety-what-orca-will-and-will-not-do)
  are the parts you must not skip.
- **Agents developing Orca itself:** read [CLAUDE.md](CLAUDE.md) and [docs/handoff/handoff.md](docs/handoff/handoff.md)
  first; this README does not replace them.

## What Orca is

Orca is the system layer. Some pieces are separate projects:

| Piece | Role | Required? |
|---|---|---|
| **Orca** (this repository) | Decides which tasks run, in what order and what in parallel; keeps budgets; records its choices in a decision ledger (`.decisions/`); serves the Web panel. | yes |
| **ccloop** | Runs **one** task as a loop with an agent CLI (`claude` or `codex`). A separate repository, pinned as a git dependency in `package.json` and installed by `npm install`. | yes |
| **ccmem** | A memory layer. The panel can show it read-only. | optional |
| **syncskill** | Supplies skills to tasks. | optional |

The flow: an **idea** becomes a **requirement**, the requirement becomes a **group of tasks**, each task is **one
ccloop run**, every finished task is merged onto the branch **`orca/<groupId>`**, and **you** decide whether that branch
goes into `main`.

## Requirements

- macOS or Linux (`package.json` lists only `darwin` and `linux`).
- Node.js 22.13.1 or newer (the control store uses Node's built-in SQLite).
- git.
- At least one agent CLI, installed and logged in: Claude Code (`claude`) and/or Codex (`codex`).

## Install

```sh
git clone <orca-repository-url> <path-to-orca>
cd <path-to-orca>
npm install                       # also installs the pinned ccloop
npm run build --workspace web     # builds the panel; without it the panel refuses to start (panel-dist-missing)
```

`package.json` declares no `bin`, so there is no global `orca` command. Run every command from the Orca checkout as

```sh
node_modules/.bin/tsx src/cli.ts <command> ...
```

(`npm run ledger -- <command> ...` is the same thing through npm.) Below, `orca <command>` is short for that.

## Configure

All configuration is environment variables and command-line flags. Nothing is read from a config file in the
repository you work on.

### 1. Agents table (needed to run any work)

```sh
export ORCA_AGENTS_TABLE="$HOME/.orca/agents.json"
orca agents init     # asks ccloop which agents are installed and writes the table
orca agents show     # validates the table and prints each installation's default model; exit 1 if any entry is refused
```

- `orca agents init` writes to `$ORCA_AGENTS_TABLE` (default `$HOME/.orca/agents.json`). A new directory is created
  `0700` and a new file `0600`. An existing table is **never overwritten**: the new detection goes to
  `<table>.draft.json` and the difference is printed.
- The panel itself does not fall back to the default path: **`ORCA_AGENTS_TABLE` must be set when you start the
  panel**, or it starts without an execution port (see below).

### 2. ccloop

| `ORCA_CCLOOP_BIN` | Meaning |
|---|---|
| unset | use the ccloop package `npm install` put in `node_modules` (the normal case) |
| an absolute path | use that ccloop build's `dist/cli.js` instead |
| empty string | no execution port: the panel serves reads only |

The panel can start work only when it has **both** a ccloop and `ORCA_AGENTS_TABLE`. With either missing it still
starts, still shows recovery and evidence, and refuses to start work with `control-port-unconfigured`.

### 3. Estimator profile (needed to import a plan or open a requirement)

Two flags go together, both or neither:

```
--estimator-profile <profileId> --estimate-mode strict|soft
```

plus one or more `--profile <snapshot.json>` files that define that profile. Without them the panel starts, but
cannot import a plan or turn a requirement into tasks.

A profile snapshot is a JSON file of schema `orca-execution-profile-snapshot-v2`. **No Orca command generates it
today**; you write it by hand. A minimal one, the shape the live acceptance script
`scripts/live-panel-http-acceptance.ts` uses:

```json
{
  "schema": "orca-execution-profile-snapshot-v2",
  "profile": {
    "profileId": "all",
    "allowedWorkKinds": ["budget-estimate", "goal-review", "handoff", "task"],
    "contextTokenizer": null,
    "workMaxOutputTokens": 1000,
    "capabilities": {
      "usageObservation": "phase-end",
      "budgetEnforcement": "soft",
      "contextObservation": "unavailable",
      "handoffControl": "durable",
      "handoffExecution": "mechanical-in-run-v1",
      "contextWindowTokens": null,
      "requestBoundProof": null
    },
    "estimatorPreflight": {
      "instructionVersion": "1",
      "schemaVersion": "budget-estimate-v1",
      "maxOutputTokens": 64000,
      "framingTokenOverhead": 17,
      "tokenizer": { "kind": "utf8-upper-bound", "numerator": 2, "denominator": 3, "proofRef": "proof" }
    }
  },
  "resolved": {
    "proofDocumentContentHashes": ["cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"],
    "tokenizerArtifactHashes": [],
    "secretValueHashes": []
  }
}
```

With `"contextWindowTokens": null` the budget estimate ends in state **`blocked-capability`**: no model is called to
estimate, and each task starts from default budget allocations that you edit by hand in Task control. Use it with
`--estimator-profile all --estimate-mode soft`. In `soft` mode an overrun is settled after the fact, not prevented.

### 4. Repositories and where state lives

- `--repo <key>=<path-to-repo>` registers a repository you want Orca to work on. Repeatable. **Projects are fixed at
  launch**: to add one, restart the panel.
- Control state (a SQLite store, plus run copies and workspaces beside it) lives under `$ORCA_CONTROL_DIR`
  (default `$HOME/.orca/control/<repo key>`). With more than one `--repo` there is no single key to name it after,
  so you must also pass `--control-state-dir <path>`.
- Decisions and Metrics read the `.decisions/` ledgers of every `--repo`, plus every repository found under
  `--root <dir>` if you pass it.
- Reviews and corrections you record in the panel go to `$ORCA_CORRECTIONS_DIR` (default `$HOME/.orca`).
- `--no-control` starts the panel without the task control plane (decisions, metrics, chains and memory only).

### 5. Plans for Task control (optional)

You can reach tasks two ways:

1. **From an idea**, in the Requirements section. No plan file is needed.
2. **From a plan file** you wrote, registered at launch with `--plan <planId>=<repoId>=<path-to-plan.json>`. The
   panel only ever reads plans named on its command line.

`<repoId>` is **not** the `<key>` you gave `--repo`; it is that key encoded as `<key>-<first 8 hex of sha256(key)>`.
To compute it:

```sh
K=<key> node -e 'const k=process.env.K,r=k.replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^[^a-zA-Z0-9]+/,"").slice(0,60),h=require("crypto").createHash("sha256").update(k).digest("hex").slice(0,8);console.log(r?r+"-"+h:"repo-"+h)'
```

The plan file uses the schema described in [docs/cli.md](docs/cli.md#the-plan-files-shape), plus a top-level `goal`
and `successConditions`. A task may give a `loop` block instead of a `contract` file:

```json
{
  "targetRepo": "<path-to-repo>",
  "ccloopBin": "<path-to-orca>/node_modules/ccloop/dist/cli.js",
  "runsDir": "<a directory outside the repo>",
  "workBranch": "orca/unused",
  "policy": "local-merge",
  "ledgerMode": "out-of-repo",
  "goal": "What the whole group should achieve",
  "successConditions": ["How you will know it did"],
  "tasks": [
    {
      "taskId": "a",
      "dependsOn": [],
      "loop": {
        "plan": "standard",
        "goal": "Create answer.txt containing 42",
        "successCondition": "answer.txt holds exactly 42 and a newline",
        "targetPaths": ["answer.txt"],
        "checks": ["test \"$(cat answer.txt)\" = 42"]
      }
    }
  ]
}
```

The import button uses the **first** `--repo` and the **first** `--plan` only.

### 6. Optional integrations

| Variable | Effect |
|---|---|
| `ORCA_CCMEM_BIN` = absolute path to `ccmem` | turns on the read-only **Memory** section. Opening it starts ccmem, and ccmem may migrate its own data directory when it opens it. Unset: ccmem is never started. |
| `ORCA_SYNCSKILL_BIN` = absolute path to `syncskill` | lets a loop task declare `"skills": {"profile": "<name>"}` or `"skills": {"names": ["<skill>", ...]}`. Skills work only with **claude** installations; a task with skills on a codex agent is refused at confirm (`skills-unsupported-agent`). Unset: Orca never starts syncskill. |

## Start the panel

An example launch script (every `<...>` is yours to fill in):

```sh
#!/bin/sh
cd <path-to-orca>
export ORCA_AGENTS_TABLE="$HOME/.orca/agents.json"
# export ORCA_CCMEM_BIN=<absolute-path-to-ccmem>          # optional
# export ORCA_SYNCSKILL_BIN=<absolute-path-to-syncskill>  # optional
exec node_modules/.bin/tsx src/cli.ts panel \
  --by <you> \
  --port 7777 \
  --repo <key>=<path-to-repo> \
  --profile <path-to-profile.json> \
  --estimator-profile all --estimate-mode soft
  # --plan <planId>=<repoId>=<path-to-plan.json>          # optional, see "Plans for Task control"
```

- `--by <who>` is required: every review and correction is stamped with it.
- `--port` defaults to `0` (a random free port).
- On success it prints one line on stdout, `orca-panel ready url=http://127.0.0.1:7777`, and on stderr
  tells you to open the URL and log in. The page carries no credential.
- A refusal prints `rejected: <code>: <why>` and exits.
- If it says `control plane mounted with no execution port`, see [ccloop](#2-ccloop).
- Stop it with Ctrl-C. It drains before exiting; a second Ctrl-C exits at once, and the next start may then have to
  recover first.

### Logging in

The first start creates an owner named after `--by` and writes its initial password to
`$ORCA_CONTROL_DIR/initial-password` (default `$HOME/.orca/control/initial-password`); stderr names the file with
the line `orca-panel: initial password for <name> written to <path>`. Under `orca panel install`, that line is in
the service's log (`orca panel logs`). Log in with it and the panel asks you to choose your own password (at least 12
characters) before anything else; the file is deleted once you have. Add more people from the account menu in the
page (owners only) or with `orca user add <name> [--role owner|member]` in a terminal, which reads the password
twice from the TTY. Run `orca user` with the same `ORCA_CONTROL_DIR` as the panel (`orca panel install --dry-run`
shows the service's environment), or it opens a different accounts store; it prints the path it opened. A session
lasts `--session-days` (1-30, default 15) and is refreshed while you use the page; `orca user passwd <name>` resets a
forgotten password. Members can do everything except the human-only actions (group limits, spend caps, the usage
calendar), which only owners see.

## The sections

The left-hand navigation has six sections, ordered along the work. **Requirements** opens by default. The active
section is kept in the URL hash, so a reload stays put. The header also has a language switch (English / Chinese)
and a theme switch.

```
 idea ──> Requirements ──accept──> Task control ──runs──> branch orca/<groupId> ──> you merge (outside Orca)
                                        │
                                        └── choices agents record ──> Decisions ──> Metrics
 Memory: read-only, across everything        Chains: developing Orca itself, unrelated to groups
```

| Section | What it is for |
|---|---|
| Requirements | From an idea to a set of tasks, with a model. |
| Task control | Budget, configure, start and watch groups of tasks. |
| Decisions | Review the decisions agents recorded. |
| Memory | Read ccmem's memory (read-only). |
| Metrics | Correction rate, repair rate, review coverage. |
| Chains | Unattended Claude Code sessions that develop Orca itself. |

### Requirements

1. Pick a repository, type the idea, set a token limit, the content language and the agent, and press
   **Start clarifying**. This creates a group in state `clarifying`.
2. The model asks questions in rounds; each comes with a recommended answer and why. Accept the recommendation or
   write your own, and send. The panel shows the current understanding: statement, acceptance criteria, glossary,
   decisions, open branches.
3. When you agree (**We agree**), the model drafts a **split** into tasks: titles, loop plans, target paths, checks,
   dependencies and layers. Send it back with feedback, or **Accept this split**.
4. Accepting turns the **same group** into a `draft` group with those tasks; it now appears in Task control. The
   requirement document is committed as `.orca/requirements/<date>-<slug>.md` onto the branch `orca/<groupId>`; the
   group starts only once that commit exists.

Each model call is counted against the requirement's token limit. When the next call does not fit, it stops and asks
you to raise the limit.

### Task control

Groups come from an accepted requirement or from an imported plan (**Import plan**). For each group you can:

- **Budget:** see the proposal (per task and a group reserve), apply the estimator's suggestions or set the numbers
  yourself, set a group limit, then **Confirm budget**.
- **Agents:** choose the agent and model per group slot (worker, estimator, reconcile) and per task. An agents
  settings panel holds your defaults. Confirmation freezes the selection.
- **Change plan** for a task: its loop plan — `standard`, `bugfix` (red test first), `refactor` (no behaviour
  change), `design` (a document is the deliverable), `investigate` (findings to a report only) — and its inputs: goal,
  done-when, paths it may change, check commands, non-goals, relevant docs, paths it must not change, a file limit,
  its budget, and its skills.
- **Labels** per task, and a filter by label.
- **Start**, then pause, resume, or hand off; continue selected tasks; retry a run.
- **Watch:** a dependency graph, each task's status and progress, each run's phase, state, usage and evidence (which
  you can list and download), handoff requests and estimates.
- **Git:** each task runs in its own git worktree (default) or a private clone, selectable per repository; each
  finished task lands on `orca/<groupId>` as one merge commit. Merge into `main` and push are marked as waiting on a
  person: the panel has no button for either.
- **Recovery:** after a crash the panel reconciles before it accepts connections; anything it cannot settle is shown
  as a blocker, and it will not start new runs until recovery is observed.

Each task is one ccloop run, and **runs cost money** (see [Cost](#cost)).

### Decisions

The unreviewed high-tier decisions agents recorded in the `.decisions/` ledgers of your repositories, filterable by
kind, scope and repository. Open one to read what was chosen, why, and what was rejected, then:

- **Agree** marks it reviewed (it counts toward review coverage).
- **Correct** records a correction (`wrong`, `not_my_taste`, `stale`). It does **not** edit the ledger; closing a
  correction is `orca correct --close` ([docs/cli.md](docs/cli.md#orca-correct)).

### Memory

A read-only view of ccmem: global and project memory for a chosen repository, with search. Needs `ORCA_CCMEM_BIN`.
Nothing is read until you open the section.

### Metrics

The correction rate, the repair rate and review coverage across your repositories, with notes on how to read them
(the same numbers as `orca metrics`). Read-only.

### Chains

`orca chain` runs unattended Claude Code sessions, one after another, in a clone of an **Orca** checkout, to develop
Orca itself. It is unrelated to groups and tasks. The section shows each repository's latest chain, starts one (goal,
maximum sessions, a soft maximum cost in USD, session timeout) and stops one after its current session. Details in
[docs/cli.md](docs/cli.md#unattended-chains-orca-chain).

## Known limitations

- **No global project switcher.** Projects are fixed at launch by `--repo`. Requirements, Chains and Memory each have
  their own repository selector; **Task control uses the first `--repo` only**, and imports only the first `--plan`.
- No Orca command writes the profile snapshot; you write it by hand.
- Paid acceptance runs against real agents so far are **n=1** each: they show the path works, not how reliably.

## Safety: what Orca will and will not do

**Access**

- The panel listens on loopback (`127.0.0.1`) only, and every `/api` request needs a logged-in session (a cookie).
  Requests whose `Host` is not loopback or the bound address are refused.
- The page at `/` carries no credential. A process running as you can still read the panel's signing key and its
  stores, and so act as any user.
- `--bind <addr>` opens it to other machines and is refused unless you also pass `--i-know-this-is-exposed`. There
  is **no TLS**: passwords and the session cookie cross the network in clear text. Fit for you across your own
  machines, not for a team.
- **Anyone with a session can start paid agent work**, including unattended chains that commit.

**Git**

- Orca never pushes, never merges into `main`, never deletes branches or worktrees. Finished tasks land on
  `orca/<groupId>`; merging that into `main` is your job, in your own terminal.
- Agents change code in their own worktree or clone; what reaches your repository is the `orca/<groupId>` branch
  (and, in worktree mode, the worktree entries git records).

**What it writes outside your repositories**

| Path | Written by |
|---|---|
| `$ORCA_AGENTS_TABLE` (default `$HOME/.orca/agents.json`) | `orca agents init` |
| `$ORCA_CONTROL_DIR/<repo key>` and its `.runs` / `.workspaces` siblings, or `--control-state-dir` | the panel's control plane |
| `$ORCA_CORRECTIONS_DIR` (default `$HOME/.orca`) | reviews and corrections from the panel or `orca correct` |
| ccmem's data directory | ccmem itself, when the Memory section opens it (it may migrate it) |

Point these variables at a scratch directory when you are trying Orca out.

## Cost

Real agent runs spend money on your agent accounts: clarifying a requirement, splitting it, estimating (unless the
profile's context window is `null`), and every task run. Budgets in `soft` mode are settled after the fact, not
prevented. Chains have a soft cost limit checked after each session.

## More

- [docs/cli.md](docs/cli.md) — the CLI and development reference (the previous README).
- [CLAUDE.md](CLAUDE.md) — rules for agents developing Orca.
- [docs/handoff/handoff.md](docs/handoff/handoff.md) — current state and open work, for the next agent.
