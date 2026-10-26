# Orca

_Leave it to Orca — every idea, made real._

Orca turns an idea into tasks, runs those tasks with coding agents (Claude Code, Codex or OMP), and lands the results
on a git branch — or writes them into a folder — for you to review. It can also run a **flow**: a fixed sequence of
steps, some of them model calls and some of them effects outside Orca, against a folder. You drive it from a local Web
panel.

This README is about that panel: what Orca is, how to install and configure it, how to start the panel, what each
section does, and what is and is not safe. The command-line reference (`orca plan preview`, `orca dev correct`, checkpoints, the
Tier 0 gate, `orca dev chain`, the control foundation) is in [docs/cli.md](docs/cli.md).

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
| **ccloop** | Runs **one** task as a loop with an agent CLI (`claude`, `codex` or `omp`). A separate repository, pinned as a git dependency in `package.json` and installed by `npm install`. | yes |
| **ccmem** | A memory layer. The panel can show it read-only. | optional |
| **syncskill** | Supplies skills to tasks. | optional |

The flow: an **idea** becomes a **requirement**, the requirement becomes a **group of tasks**, and each task may have
more than one ccloop run after a retry or continuation. For a repository, finished work lands on **`orca/<groupId>`**;
what happens next is the project's integration scheme, and the default (`keep`) merges and pushes nothing. A **folder
project** gets its finished work written into the folder instead. A **multi-directory project** groups 2–8 projects and
lands each member by its own delivery, once per driver round.

## Requirements

- macOS or Linux (`package.json` lists only `darwin` and `linux`).
- Node.js 22.13.1 or newer (the control store uses Node's built-in SQLite).
- git.
- At least one agent CLI, installed and logged in: Claude Code (`claude`), Codex (`codex`) and/or OMP (`omp`, oh-my-pi).
  Orca does not install any of them. For OMP, the supported installation shape and a hand-written table entry are in
  ccloop's README, section 6.4 (`omp`); this README does not repeat an install command.

## Install

```sh
git clone <orca-repository-url> <path-to-orca>
cd <path-to-orca>
npm install                       # also installs the pinned ccloop
npm run build --workspace web     # builds the panel; without it the panel refuses to start (panel-dist-missing)
```

To get a global `orca` command, build once and link the checkout:

```sh
npm run build                     # compiles dist/cli.js, which bin/orca runs
npm link                          # puts orca on PATH (in the active node's global bin); npm unlink -g orca removes it
```

`bin/orca` runs `dist/cli.js` with `/usr/local/bin/node` when that exists, else with `node` from PATH, because
`orca panel install` records the node that ran it into the service config. Rebuild after pulling: `orca` runs the
compiled `dist/`, not `src/`. Without the link, run every command from the Orca checkout as

```sh
node_modules/.bin/tsx src/cli.ts <command> ...
```

(`npm run ledger -- <command> ...` is the same thing through npm.) `npm run build` (the root one, not only the `web`
one) compiles `dist/cli.js`; `orca panel install` needs it (see [Run the panel as a service](#run-the-panel-as-a-service)).

## Configure

All configuration is environment variables and command-line flags. Nothing is read from a config file in the
repository you work on.

### 1. Agents table (needed to run any work)

```sh
export ORCA_AGENTS_TABLE="$HOME/.orca/agents.json"
orca agent init     # asks ccloop which agents are installed and writes the table
orca agent show     # validates the table and prints each installation's default model; exit 1 if any entry is refused
```

- `orca agent init` writes to `$ORCA_AGENTS_TABLE` (default `$HOME/.orca/agents.json`). A new directory is created
  `0700` and a new file `0600`. An existing table is **never overwritten**: the new detection goes to
  `<table>.draft.json` and the difference is printed.
- The panel itself does not fall back to the default path: **`ORCA_AGENTS_TABLE` must be set when you start the
  panel**, or it starts without an execution port (see below).

#### After upgrading an agent CLI

The installation table records the CLI version, and ccloop refuses a mismatch as `agent-version-drift`. Orca records
the new version itself: when ccloop refuses a claim, start or resume with that drift, Orca has ccloop probe the
installation, writes the version it answers into the table (only that field; the previous file is kept as
`<table>.bak-auto`) and asks once more, so a group goes on under the new version. The Agents page refreshes the
versions when it loads and has a **Refresh versions** button; `orca agent refresh` does the same from a terminal
(exit 1 if a probe failed). A moved binary or a new agent is not a version change: for those, run `orca agent show`,
then `orca agent init` to detect the current installations. With an existing table, inspect `<table>.draft.json` and the printed differences. Preserve your existing
custom commands, configuration directories and defaults; back up the old table before deliberately replacing it with
reviewed values. Restart the panel to load the new table. Do not delete the only copy of your configuration.

#### Agent kinds and the installation table

The table is JSON of schema `ccloop-agents-table-v1`: `{ "schema": ..., "installations": { "<id>": { ... } } }`, one
entry per installed CLI, keyed by an id (letters, digits, `_`, `.`, `-`; it must start with a letter or digit). Orca does not
define the entry's shape: ccloop checks it (the fields below are from ccloop at the commit Orca pins, `src/agents/`),
and `orca agent show` runs that check. Every field is required; an unknown field is refused.

| Field | Kinds | Rule |
|---|---|---|
| `kind` | all | `claude`, `codex` or `omp` |
| `command` | all | array; the first element is an **absolute** path to the executable. `claude` and `codex` accept further arguments; `omp` accepts exactly one element |
| `version` | all | the CLI's version string, as detected; see "After upgrading an agent CLI" |
| `configDir` | all | an absolute path, or `null` |
| `timeoutMs` | all | positive integer |
| `killGraceMs` | all | integer 0 to 60000 |
| `sandbox` | `codex` | `read-only` or `workspace-write` |
| `budgetMode` | `codex` | only `soft` |
| `defaultModel` | `omp` | `<provider>/<model>` |
| `profile` | `omp` | `null`, or a profile name; a non-null `profile` together with a non-null `configDir` is refused |

`claude` has no extra fields. The file and its directory must belong to you and must not be group- or world-writable,
the file must be a regular file (not a symlink) at its own real path, and at most 1 MiB. Minimal entries, with
placeholder paths (let `orca agent init` fill `version`, and prefer its output to hand-writing: for `claude` it also
adds isolation arguments to `command` that these minimal examples leave out):

```json
{
  "schema": "ccloop-agents-table-v1",
  "installations": {
    "claude": { "kind": "claude", "command": ["<absolute-path-to-claude>"], "version": "<detected-version>",
                "configDir": null, "timeoutMs": 1800000, "killGraceMs": 5000 },
    "codex":  { "kind": "codex", "command": ["<absolute-path-to-codex>"], "version": "<detected-version>",
                "configDir": null, "timeoutMs": 1800000, "killGraceMs": 5000,
                "sandbox": "workspace-write", "budgetMode": "soft" },
    "omp":    { "kind": "omp", "command": ["<absolute-path-to-omp>"], "version": "<detected-version>",
                "configDir": null, "timeoutMs": 1800000, "killGraceMs": 5000,
                "profile": null, "defaultModel": "<provider>/<model>" }
  }
}
```

What each kind can do in Orca today: loop work runs on all three. Frozen task skills work on all three (see
[Optional integrations](#6-optional-integrations)). Clarifying and splitting a requirement, and estimating, run as one
**single call** with tools off, on all three kinds. `claude`, and `omp` for a model whose catalog row carries an output
cap, run it in either estimate mode. `codex` cannot cap a call's output, so its single call runs in soft estimate mode
only (`--estimate-mode soft`): the output is checked after the call, and any overrun is booked and shown on the run.
Strict estimate mode still refuses `codex` (`single-call-unavailable`).

#### Third-party models

`codex` and `omp` pointed at a non-native provider (a model their vendor does not ship) may not follow the plan phase's
JSON-only instructions. Such a run fails with a `*-result-invalid` code (for example `codex-result-invalid`), shown on
the run with its explanation; retrying the same model usually fails the same way. Use the agent's native model for
that work, or, when the run did save its output, **Verify saved results** on the failed run instead of re-running it.

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

With `"contextWindowTokens": null` the profile declares no window, and Orca uses the window ccloop reports for the
selected agent (claude, omp and codex report one), so the budget estimate calls the model. Only when ccloop reports no
window either does the estimate end in state **`blocked-capability`**: no model is called to estimate, and each task
starts from default budget allocations that you edit by hand in Task control. Use it with
`--estimator-profile all --estimate-mode soft`. In `soft` mode an overrun is settled after the fact, not prevented.

### 4. Repositories and where state lives

- **Projects.** With no `--repo` and no `--root`, the panel runs in *file mode*: its projects are the list in
  `$HOME/.orca/projects.json` (`$ORCA_PROJECTS_FILE` overrides the path):
  `{ "version": 1, "projects": [{ "id", "name", "path", "kind"?: "repo" | "dir", "plans"?: [...] }], "multiDirProjects"?: [{ "id", "name", "dirs": [...] }] }`.
  A missing file is an empty list. In the UI you can **add** a project (a name and the absolute path of a git repository's
  top-level directory), **rename** one, and **Group several projects** into a multi-directory project. Removing a
  project, changing its path, or adding a member's new path needs a restart; the panel names such pending changes. A
  hand edit that adds a project or changes a name applies without a restart; a file broken while the panel runs keeps
  the last good list, and one broken at start is refused (`projects-file-invalid`). In file mode the control state
  defaults to `$ORCA_CONTROL_DIR/panel` (or the file's `controlStateDir`), so `--control-state-dir` is not needed.
- **Folder projects.** A **folder project** is a directory registered by hand while the panel is stopped:
  `{ "id": "...", "name": "...", "path": "/abs/folder", "kind": "dir" }`. It need not be a git repository. Orca keeps
  its work in a private bare vault under `$ORCA_VAULT_DIR` (default `$HOME/.orca/vault`), commits there, and writes a
  group's finished work into the folder file by file. An installed service does not capture `ORCA_VAULT_DIR`, so it uses
  the default vault path. A folder project takes requirements and flows only: plan import
  is refused (`dir-project-plan-import-unsupported`), as are debug opens, and it has no integration scheme (delivery is
  the folder placement, `dir-group-delivery-fixed`). A requirement opened on a missing folder is refused
  (`dir-folder-missing`).
- **Multi-directory projects.** **Group several projects** makes a multi-directory project of 2–8 single projects, in
  an order you set; the first is the **primary** and keeps the group's decisions. Two members may not be the same
  directory or nest inside one another. A multi project takes requirements only: plan import, flow starts and debug
  opens are refused (`multi-dir-plan-import-unsupported`, `flow-project-multi-dir-unsupported`,
  `debug-multi-dir-unsupported`). Its settings live on its member projects. Delivery is frozen at split acceptance,
  per member: a folder member is written into its folder, a repository member uses that project's integration default,
  and `push-branch`/`github-pr` is refused (`multi-dir-delivery-unsupported`). Continuation and saved-result recovery
  are blocked on a multi group (`multi-dir-continuation-unsupported`, `multi-dir-recovery-unsupported`).
- `--repo <key>=<path-to-repo>` is the alternative: it registers a repository on the command line. Repeatable. With `--repo`
  (or `--root`) **projects are fixed at launch**, the UI cannot add or rename any (the server answers
  `projects-from-command-line`), and `--projects-file` together with `--repo`/`--root` is refused. To add one, restart the
  panel. A `--repo` project is always a repository: folder and multi-directory projects exist only in file mode. An
  installed service started with `--repo` is in this mode too: run `orca panel install` again without `--repo`
  to get file mode. That moves the panel to a different control store: with one `--repo` it was
  `$ORCA_CONTROL_DIR/<repo key encoded as in "Plans for Task control">`, in file mode it is `$ORCA_CONTROL_DIR/panel`, which starts
  empty. To keep the old store, point `controlStateDir` in `projects.json` (or `--control-state-dir`, which wins over it) at the
  old directory, and give the project the same `id` as the old `--repo` key, because the control repository id is derived from
  the id by the same encoding. A project id must match `[a-z0-9_]` then `[a-z0-9._-]*` ending in `[a-z0-9_]`, so a key with
  capitals cannot be reused.
- Control state (a SQLite store, plus run copies and workspaces beside it) lives under `$ORCA_CONTROL_DIR`
  (default `$HOME/.orca/control/<repo key>` with one `--repo`). With more than one `--repo` there is no single key to name it
  after, so you must also pass `--control-state-dir <path>`.
  This build upgrades that store (`control.sqlite`) to schema version 20 on its first start (from any older version),
  and the upgrade is one-way (an older build refuses a newer store with `control-schema-unsupported`). It writes a
  `VACUUM INTO` copy named `control.sqlite.pre-v<n>-<timestamp>` beside the store before it migrates, but still back up
  `control.sqlite` yourself before the first start of a new build.
- Decisions and Metrics read the `.decisions/` ledgers of every `--repo`, plus every repository found under
  `--root <dir>` if you pass it.
- Reviews and corrections you record in the panel go to `$ORCA_CORRECTIONS_DIR` (default `$HOME/.orca`).
- `--no-control` starts the panel without the task control plane (decisions, metrics, chains and memory only).

### 5. Plans for Task control (optional)

You can reach tasks two ways:

1. **From an idea**, in the Requirements section. No plan file is needed.
2. **From a plan file** you wrote, registered at launch with `--plan <planId>=<repoId>=<path-to-plan.json>`. The
   panel only ever reads plans named on its command line.

`<repoId>` is **not** the `<key>` you gave `--repo` (in file mode, the project's `id`); it is that key encoded as `<key>-<first 8 hex of sha256(key)>`.
To compute it:

```sh
K=<key> node -e 'const k=process.env.K,r=k.replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^[^a-zA-Z0-9]+/,"").slice(0,60),h=require("crypto").createHash("sha256").update(k).digest("hex").slice(0,8);console.log(r?r+"-"+h:"repo-"+h)'
```

The plan file uses the schema described in [docs/cli.md](docs/cli.md#the-plan-files-shape). **Import plan** accepts it
only when all of these hold; otherwise it refuses with every problem it can see, one per line, in the import form:

- `targetRepo` is the repository the plan is registered for;
- the plan has a `goal`;
- the plan has at least one `successConditions` entry, and no two are identical;
- every task has a `targetVersion` that is a positive integer (write `1` unless you mean otherwise);
- no task lists a dependency twice or depends on a task that is not in the plan;
- every task's `contract` file is valid JSON in ccloop's contract format, or its `loop` block is valid.

A task may give a `loop` block instead of a `contract` file:

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
      "targetVersion": 1,
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

The import form uses registered plans for the selected project; if several exist, choose one. In **All projects**, explicitly choose the target repository before importing. A folder project or a multi-directory project refuses an imported plan (`dir-project-plan-import-unsupported`, `multi-dir-plan-import-unsupported`): those reach tasks through a requirement (and a folder project also through a flow).

### 6. Optional integrations

| Variable | Effect |
|---|---|
| `ORCA_CCMEM_BIN` = absolute path to `ccmem` | turns on the read-only **Memory** section. Opening it starts ccmem, and ccmem may migrate its own data directory when it opens it. Unset: ccmem is never started. |
| `ORCA_SYNCSKILL_BIN` = absolute path to `syncskill` | lets a loop task declare `"skills": {"profile": "<name>"}` or `"skills": {"names": ["<skill>", ...]}`. Frozen task skills work with **Claude, Codex and OMP** installations. Other agent kinds are refused (`skills-unsupported-agent`); frozen task skills play no part in clarification or estimation. Unset: Orca never starts syncskill. |

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
  --profile <path-to-profile.json> \
  --estimator-profile all --estimate-mode soft
  # --repo <key>=<path-to-repo>                            # instead of the UI's project list: fixes the projects at launch
  # --plan <planId>=<repoId>=<path-to-plan.json>          # optional, see "Plans for Task control"
```

As written it runs in file mode (see [Repositories](#4-repositories-and-where-state-lives)): add your projects in the UI.

- `--by <who>` is required: every review and correction is stamped with it.
- `--port` defaults to `0` (a random free port).
- On success it prints one line on stdout, `orca-panel ready url=http://127.0.0.1:7777`, and on stderr
  tells you to open the URL and log in. The page carries no credential.
- A refusal prints `rejected: <code>: <why>` and exits.
- If it says `control plane mounted with no execution port`, see [ccloop](#2-ccloop).
- Stop it with Ctrl-C. It drains before exiting; a second Ctrl-C exits at once, and the next start may then have to
  recover first.

### Run the panel as a service

`orca panel <args>` is the same command as `orca panel run <args>` and runs in your terminal. To keep the panel running
without one, use the service commands (`orca panel ...`, from `src/cli.ts`):

| Command | What it does |
|---|---|
| `install [--dry-run] <panel run args>` | Records the args, and the `ORCA_*` path variables of your shell that the service needs (`ORCA_AGENTS_TABLE`, `ORCA_CCLOOP_BIN`, `ORCA_CCMEM_BIN`, `ORCA_SYNCSKILL_BIN`, `ORCA_CONTROL_DIR`, `ORCA_CORRECTIONS_DIR`, `ORCA_PROJECTS_FILE`, `SYNCSKILL_DIR`, `CCMEM_DATA_ROOT`), in `~/.orca/panel/service.json`, and installs a per-user service: a launchd LaunchAgent on macOS, a systemd user unit on Linux. `--dry-run` prints the files and runs nothing. |
| `start [--detach]` | Starts that service. Without a service manager it refuses unless you pass `--detach`, which starts a plain process that neither restarts after a crash nor survives a reboot. |
| `stop`, `restart`, `uninstall` | Drive the service. `restart` rewrites the service files from the recorded `service.json`; it does not pick up new args or variables. |
| `status` | The manager's view plus a real request to the panel. Exit 0 only if the panel answered; refuses with `service-not-installed` if nothing is installed. |
| `logs [-f] [-n <lines>]` | The panel's log files (macOS, detached) or its journal (Linux). Default 200 lines. |

Things the install checks: the service runs `node dist/cli.js`, so run `npm run build` first (`service-dist-missing`, or
`service-dist-stale` when a `src/**/*.ts` file is newer than `dist/cli.js`); every path in `--repo`, `--root`, `--profile`, `--plan`,
`--projects-file`, `--control-state-dir` and `--dist`, and every captured variable, must be absolute
(`service-path-not-absolute`); `--service` is added by Orca, leave it out; the args are checked with the panel's own parser.
To change args or variables, run `install` again (it is safe to repeat). Under launchd or systemd, `install`, `start` and `restart` wait until the panel answers
and say so, or exit 1. These commands change your running system, so a coding agent should ask you before running them.

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
forgotten password. Members can use ordinary task controls. Owners handle human-only actions: group limits, spend
caps, the usage calendar, integration choices, conservative unknown-usage settlement and installation updates. The
page shows members the relevant values; a member's new requirement gets the default limit.

## The sections

The sidebar has **Overview**, **Requirements**, **Task control**, **Board**, **Decisions**, **Memory**, **Metrics**,
**Global settings** and **Project settings**, plus **Continuous improvement (advanced)** when it is enabled. It keeps
the selected project visible across sections. The active section is in the URL hash. Language and theme switches are in
the sidebar.

```
 idea ──> Requirements ──accept──> Task control ──runs──> branch orca/<groupId> ──> delivery (default: you merge)
                                        │
                                        ├── Board: every group's column, plus flow runs
                                        └── choices agents record ──> Decisions ──> Metrics
 Memory: read-only, across everything        Continuous improvement: Orca development, unrelated to groups
```

| Section | What it is for |
|---|---|
| Overview | Open the selected project's next actions and groups. |
| Requirements | From an idea to a set of tasks, with a model. |
| Task control | Budget, configure, start and watch groups of tasks. |
| Board | Every group as a card in a column, plus flow runs. |
| Decisions | Review the decisions agents recorded. |
| Memory | Read ccmem's memory (read-only). |
| Metrics | Correction rate, repair rate, review coverage. |
| Continuous improvement (advanced) | Unattended Claude Code sessions that develop Orca itself; hidden by default in Global settings. An active chain still shows its status and stop control. A `#chains` link remains available. |
| Global settings | Agent preferences, installation review, usage caps and advanced navigation preference. |
| Project settings | Workspace, integration, checks, flow settings, schedules and the plan library for the selected project. |

### Requirements

Clarification, splitting and estimation each run as one **single call** with tools off. Claude, and OMP for a model
whose catalog row carries an output cap, run them in either estimate mode. Codex cannot cap a call's output, so it runs
them only when the panel uses `--estimate-mode soft`: each call's output is checked after the call, and an overrun is
booked at the observed usage and shown on the call's run row. With `--estimate-mode strict` the server refuses a Codex
selection (`agent-selection-rejected`, reason `single-call-unavailable`), and it refuses an OMP model without an output
cap in its catalog, or an OpenRouter one, in either mode. Then pick another agent, or write a plan using the
[Plans for Task control](#5-plans-for-task-control-optional) example and import it in **Task control**, and set task
budgets manually if no usable estimator is available. A default selection is also resolved by the server, so ensure
your default can run single calls in the panel's estimate mode.

1. Pick a project (a repository, a folder project, or a multi-directory project), type the idea, set a token limit, the
   content language and the agent, and press **Start clarifying**. This creates a group in state `clarifying`.
2. The model asks questions in rounds; each comes with a recommended answer and why. Accept the recommendation or
   write your own, and send. The panel shows the current understanding: statement, acceptance criteria, glossary,
   decisions, open branches.
3. When you agree (**We agree**), the model drafts a **split** into tasks: titles, loop plans, target paths, checks,
   dependencies and layers. Send it back with feedback, or **Accept this split**.
4. Accepting turns the **same group** into a `draft` group with those tasks; it now appears in Task control. The
   requirement document is committed as `.orca/requirements/<date>-<slug>.md` onto the branch `orca/<groupId>` (for a
   folder project, into its vault; a multi group exports it to its primary); the group starts only once that commit
   exists. **Go to task preparation** opens that exact group for review; acceptance does not confirm or start it.

Each model call is counted against the requirement's token limit. When the next call does not fit, it stops and asks
you to raise the limit.

### Task control

Quick start: select the target project, import a registered plan (or accept a requirement split), review the task goals,
acceptance, budgets, workspace and integration, choose the agents/models, **Confirm task plan**, then **Start**. Confirmation freezes the selection; choose
agents before confirming. The driver schedules eligible tasks and their dependencies automatically within the group.
You do not need to start each task separately. Watch the dependency graph and open a task for activity and evidence.

Groups come from an accepted requirement or from an imported plan (**Import plan**); a folder or multi-directory
project only from a requirement. For each group you can:

- **Budget:** see the proposal (per task and a group reserve), apply the estimator's suggestions or set the numbers
  yourself, set a group limit and optional explicit token policy, then **Confirm task plan**. A token ceiling is not
  implied by a spend cap or an unknown usage reading.
- **Agents and profiles:** choose Agent role overrides for worker, estimator and reconcile, with per-task worker
  overrides. Choose profile bindings for worker, handoff and goal review. Global settings holds Agent preferences;
  Project settings holds project defaults. Review the effective Agent selection and profile bindings before confirmation.
  Installation changes have separate observe, preview and owner apply steps.
- **Change plan** for a task: its loop plan — `standard`, `bugfix` (red test first), `refactor` (no behaviour
  change), `design` (a document is the deliverable), `investigate` (findings to a report only) — and its inputs: goal,
  done-when, paths it may change, check commands, non-goals, relevant docs, paths it must not change, a file limit,
  its budget, and its skills.
- **Labels** per task, and a filter by label.
- **Execution controls:** **Pause new tasks** stops future dispatch while running work continues; **Continue execution**
  resumes dispatch. **Save progress and stop** requests a safe handoff. **Stopping** means it is still settling;
  **Stopped** is shown only after authoritative stop facts, and does not mean every task is complete or recoverable.
  Continuable, retryable and unresolved work are shown separately.
- **Watch:** a dependency graph, each task's status and progress, each run's phase, state, usage and evidence (which
  you can list and download), handoff requests, estimates, and — for a run whose ccloop records one — a live
  **Transcript** of each agent call as it streams, with its size and whether it is still live or finished. A ccloop
  that records no transcript says so instead. Recording stops at 128 MiB per call; an oversized or unterminated line
  is kept as a single marker line.
- **Git:** each task runs in its own git worktree (default) or a private clone, selectable per repository; each
  finished task lands on `orca/<groupId>` as one merge commit. What happens to that branch is the project's integration
  scheme — default `keep` merges and pushes nothing (see
  [Safety](#safety-what-orca-will-and-will-not-do)). In a multi-directory group this lands per member by its frozen
  delivery, and a folder member is written into its folder.
- **Recovery:** after a crash the panel reconciles before it accepts connections; anything it cannot settle is shown
  as a blocker, and it will not start new runs until recovery is observed.

#### Group states

A group's `state` is one of seven values (the server's group summary). From the panel, a group moves as follows; the control store's direct API (`createGroup`, `putWork`) also writes `draft` and `ready`.

| State | Meaning, and what moves a group there |
|---|---|
| `clarifying` | A requirement still being clarified and split. Created by **Start clarifying**; accepting the split leaves it. |
| `draft` | Tasks exist but the plan is not confirmed. Accepting a split, or **Import plan**, creates it; changing a confirmed proposal's budget or selection reopens it. |
| `ready` | The plan is confirmed (**Confirm task plan**). **Start** is accepted only in this state. |
| `running` | Set by the control store's direct claim, continuation and retry paths, and when a handoff checkpoint settles on a group that is not stopped. A Web Start's first claim does not set it (see below). |
| `review` | Set when a run's checkpoint is committed, unless the group is `blocked`. It does not stop dispatch: `ready`, `running` and `review` all accept new runs. |
| `blocked` | A plan group whose run used more than its grant on some dimension. A later checkpoint does not clear it; **Retry task** moves it back to `running`. |
| `done` | Part of the vocabulary and shown as completed, but no code sets it on a group today. Progress is per task: `completion` counts finished tasks. |

A Web **Start** only queues a start wake and marks the task, so the group keeps state `ready` while its first run executes.
The summary therefore carries `executionPending` (an undelivered start, no-start, resume or continuation wake, an active run, or a
task that is running, active, starting, start-unknown, held or continuing), and the panel hides **Start** while it is true. Read `state` together
with it.

Stopping is separate from `state`. A group can also carry a stop intent: `stopMode` is `pause`, `shutdown` or `handoff`, and
`stopState` is `paused`, `handoff-pending`, `handoff-partial`, `handoff-unresolved` or `handoff-complete` (both `null` when
none). **Start** is refused with `stop-mode-conflict` while an intent exists.

The group and requirement cards have **More actions** for exact details, archive or unarchive, and copying the group id.
Archiving preserves records; it is refused while work or a stop is still in flight.

Completed groups open **Results** by default, including when no explanation was saved. To open an individual task,
select it in **Progress**, then choose **Results**; its controls and unfinished inputs stay mounted across region
changes. **Runs and evidence** retains the original permission-checked evidence downloads.

For a multi-directory group, **Results** also carries **Directories and landing**: each member's kind and delivery,
whether its work landed, and the group's one landing state. Landing is due once per driver round after integration;
it writes the whole plan to a journal, publishes it in member order, and never reverts a partial landing. When it
stops, the region gives the reason and the two answers a person can give: **Retry the rest** and **Mark resolved**. A
folder member whose folder changed or became unwritable has its own answers: **Take folder**, **Recheck**, and, when
files were withheld, **Withhold**. A single folder group's **Folder placement** region offers the same three folder
answers.

Results distinguish task acceptance, execution, actual controller verification, the Agent's explanation, goal review
and Git delivery. Missing or invalid explanation does not change a successful task's outcome. Verification says
`not-run`, `in-progress`, `passed`, `failed` or `unavailable` only from admitted controller evidence; an Agent's claim
is labelled as an explanation. A newer current attempt can have no saved report; older attempts and predecessor runs
remain explicitly saved history and never fill the current explanation. An unknown current attempt stays unknown.

Saved outputs show their run, generation, execution, attempt and immutable snapshot/observation/capture revision.
They contain the bytes captured during execution, not the current worktree or HEAD. Later verifier observations
reuse the original snapshot. Preview treats HTML, scripts, links and images as inert text. Binary and too-large text
may still offer **Download saved output** when authorized; downloads preserve the saved bytes and use the server's
output ID as the attachment name. Refused or unsafe outputs offer no invented content. Only an active Results pane
polls the saved read model; hiding it or changing account/project/epoch retires pending reads and downloads. These
reads do not call an Agent, summarize, backfill or reconstruct missing historical work.

The installed ccloop is the commit pinned in `package.json` (`npm run verify:ccloop-pin` checks it). An old peer reports source `unsupported` with missing explanation while
ordinary task execution continues. Live saved results require a paired ccloop build with the optional result channel;
local feature verification does not publish that build, repin the package, or change a running service. Publishing
the paired producer and deliberately repinning/restarting remain separate release steps.

On a failed run, **Runs and evidence** shows the recorded phase, a typed cause when saved producer evidence proves
one, and an explicit unknown cause otherwise. It keeps the raw code, run id and attempt. A decode failure is not a
token diagnosis. Open the permission-checked evidence list and the recent Activity window; the window contains the
newest 200 run entries displayed oldest to newest, not the full history. A valid run with no entries shows an empty
history; a missing run or damaged response shows an error. **Verify saved results** appears only after its separate
eligibility read accepts the source; it skips execution but validation and verification may still use a model. Ordinary
retry and recovery remain separate actions and only appear when their current server facts allow them.

Each run invokes ccloop, and **runs cost money** (see [Cost](#cost)). A task can have multiple runs after a retry or continuation.

### Board

The board is the whole queue at a glance: every group is a card in the column the server's summary puts it in —
**Clarifying**, **Awaiting confirmation**, **Queued**, **Running**, **Needs you**, **Done** — and **Archived** cards
show with a toggle. A card carries its goal, tokens used against its limit, decisions waiting for review, a failed
task's cause, and badges for a flow's template, a schedule, or the run's token pool. Dragging is deliberately weak:
only **pause**, **resume**, **archive** and **unarchive** send a command; any other drop is refused on the page and the
card stays where the summary puts it. The **Board** / **Group graph** switch draws the person's edges between groups
instead of columns.

**Flows** live here. **Start a flow** chooses one of the built-in templates this install ships (`flows/builtin/`), a
folder, and that template's parameters; a field left alone takes the project preset, then the global preset, then the
template's default, and a start with nobody to answer takes those defaults and records them as decisions. The folder
must be a registered folder project (`flow-dir-unregistered` otherwise). A flow run has its own page: its steps and
executions, each execution's output, the decisions it made, messages and feedback on the whole run, re-run plans (the
model proposes which steps to skip), the run's token pool, and effect records with **Enact** / **Discard**. An
irreversible step always asks for a confirm card in this version; an external step runs with a flag unless its settings
raise it to confirm, and a run started by a schedule waits for you before either. **Pause** is any signed-in person's;
**resume**, answers, re-runs, effects and raising the pool are the panel owner's. A **Note for the step** applies to the
next attempt only or to every remaining attempt; the child group stops at a phase boundary and continues with the
note. The tool rules ccloop held for each call are listed with their status: enforced, detected, recorded-only or
refused.

### Decisions

The unreviewed high-tier decisions agents recorded in the `.decisions/` ledgers of your repositories, filterable by
kind, scope and repository. Open one to read what was chosen, why, and what was rejected, then:

- **Agree** marks it reviewed (it counts toward review coverage).
- **Correct** records a correction (`wrong`, `not_my_taste`, `stale`). It does **not** edit the ledger; closing a
  correction is `orca dev correct --close` ([docs/cli.md](docs/cli.md#orca-dev-correct)).

### Memory

A read-only view of ccmem: global and project memory for a chosen repository, with search. Needs `ORCA_CCMEM_BIN`.
Nothing is read until you open the section.

### Metrics

The correction rate, the repair rate and review coverage across your repositories, with notes on how to read them
(the same numbers as `orca decision metrics`). Read-only.

### Continuous improvement (advanced)

`orca dev chain` runs unattended Claude Code sessions, one after another, in a clone of an **Orca** checkout, to develop
Orca itself. It is unrelated to groups and tasks. Enable its navigation in Global settings; recognized `#chains` links
remain available, and an active chain keeps its status and stop access. The section shows each repository's latest chain, starts one (goal,
maximum sessions, a soft maximum cost in USD, session timeout) and stops one after its current session. Details in
[docs/cli.md](docs/cli.md#unattended-chains-orca-dev-chain).

### Project settings

**Project settings** holds the selected project's workspace mode (worktree or clone), its integration scheme (delivery,
trigger, method, target and remote), its check commands, its flow settings (effect levels, re-run plan review, token
pool per run, allowed skill sources), its **Schedules**, and its **Plan library**. Each value names the layer it came
from (project, global or built-in) and whether a lock overrides it. A folder project shows no integration scheme and no
checks; its workspace mode, flow settings, schedules and plan library still apply, and it schedules flows only.

**Schedules** fire a flow or a group at a cron time (at most hourly). A schedule shows its next three slots, its last
fire, and whether that start was late, skipped because the previous run was still active, or waited for you. Three
failed starts in a row pause it until you resume it. A save is pinned to a plan version: a newer version is named, and
**Use the newest version** repins it. The server owns the cron, the slots and the fire outcome. A fired group either
confirms on its own (no limit, no delivery scheme) or waits for your click (a token limit or a delivery scheme); a
fired flow waits for you before any external or irreversible step. A panel with no execution port does not fire
schedules.

**Plan library** keeps the plans a project has saved (from a group or an accepted requirement split) and every version
of each, with its origin and provenance. An owner can import a plan file, import a version into a new group at once,
schedule it, download the version's bytes, or archive an entry. Importing a file trusts its tasks and their check
commands for that project. Archiving is refused while a schedule uses the entry.

## Known limitations

- With `--repo` or `--root`, projects are fixed at launch; in file mode (the default) the UI adds and renames projects,
  and removing one or changing its path needs a restart. The sidebar's selected project switches the panel's project
  views. A project's registered plans remain bound to its repository.
- A **folder project** has no UI form: add it to `projects.json` by hand while the panel is stopped. A
  **multi-directory project** takes requirements only — no imported plan, no flow, no debug open — and continuation,
  saved-result recovery and branch/PR delivery are refused on its groups.
- Flows ship with the templates under `flows/builtin/`; there is no UI to publish a new one.
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

**Git and folders**

- What happens to finished work is the project's **integration scheme**. Its default is `keep`: a group's commits are
  on `orca/<groupId>` in the project's own repository, and nothing is merged or pushed. An owner can set `local` (merge
  the group's commits into a local branch), `push-target` (merge and push the result to a named remote), `push-branch`
  (push `orca/<groupId>` itself) or `github-pr` (push the branch and open a pull request with `gh`). Orca never forces a
  push and never deletes branches or worktrees; it pushes only when the scheme says so.
- Agents change code in their own worktree or clone; what reaches your repository is the `orca/<groupId>` branch
  (and, in worktree mode, the worktree entries git records). A folder project's finished work is written into its
  folder instead, file by file; a file that changed under Orca or cannot be written stops the write (`folder-changed`,
  `folder-unwritable`) and waits for your answer. Nothing in the folder is overwritten in that case.

**What it writes outside your repositories**

| Path | Written by |
|---|---|
| `$ORCA_AGENTS_TABLE` (default `$HOME/.orca/agents.json`) | `orca agent init`; its `version` fields (and `<table>.bak-auto`) also `orca agent refresh`, the Agents page and the control plane on a version drift |
| `$ORCA_PROJECTS_FILE` (default `$HOME/.orca/projects.json`) | the panel, when you add, rename or group projects in the UI |
| `$ORCA_CONTROL_DIR/<repo key>` and its `.runs` / `.workspaces` siblings, or `--control-state-dir` | the panel's control plane |
| `$ORCA_CORRECTIONS_DIR` (default `$HOME/.orca`) | reviews and corrections from the panel or `orca dev correct` |
| `$ORCA_VAULT_DIR` (default `$HOME/.orca/vault`) | the flow kernel and control plane: one private bare repository per folder project or flow folder |
| a folder project's or a flow's folder | the driver: a group's finished work, written file by file (never over a file that changed under it) |
| ccmem's data directory | ccmem itself, when the Memory section opens it (it may migrate it) |

Point these variables at a scratch directory when you are trying Orca out.

## Cost

Real agent runs spend money on your agent accounts: clarifying a requirement, splitting it, estimating (unless neither the
profile nor ccloop reports a context window for the selected agent), and every task run. A flow spends model usage on
its steps, bounded by the run's token pool. Budgets in `soft` mode are settled after the fact, not
prevented. Verifying saved results skips execution but may still spend model usage on validation and verification.
Chains have a soft cost limit checked after each session.

## More

- [docs/cli.md](docs/cli.md) — the CLI and development reference (the previous README).
- [CLAUDE.md](CLAUDE.md) — rules for agents developing Orca.
- [docs/handoff/handoff.md](docs/handoff/handoff.md) — current state and open work, for the next agent.

## Troubleshooting the panel

| Symptom | Check and next action |
|---|---|
| No task control plane | Check whether the panel was started with `--no-control`. A missing execution port is different: reads work, but work cannot start. Check `ORCA_AGENTS_TABLE` and ccloop configuration in the panel process. An expired login requires logging in; it does not mean the control plane is missing. |
| `agent-version-drift` | Review a newly detected agents draft after upgrading the CLI, preserve custom configuration and restart the panel; see the agents-table instructions above. |
| Codex or OMP cannot clarify or estimate | Codex runs single calls only in soft estimate mode: under `--estimate-mode strict` it is refused (`single-call-unavailable`); start the panel with `--estimate-mode soft` or pick another agent. OMP is refused for a model without an output cap in its catalog, or an OpenRouter one; pick another model. A task worker may still use Codex or OMP. |
| Start is missing or `stop-mode-conflict` | Read the stop banner. Resume a pause with **Resume dispatch**. After a completed handoff, use the resume dialog; select no continuations when you only want to clear the completed stop before retrying a failed task. Pending/unresolved handoffs need recovery first; a partial handoff can be archived. Do not edit `stop_intents` or group JSON in SQLite. |
| A task ended failed | Inspect its failure reason, recent activity and evidence. **Retry task** creates a new task attempt when allowed; **Retry recovery** is for recoverable blocked runs, not terminal task failures. Unknown usage or insufficient budget can still prevent a retry. |
| Activity says `null` or reports no history for an invalid body | A valid empty run answers `{ "schema": "orca-run-activity-v1", "runId": "…", "entries": [] }`. A missing run or damaged row is an error. Re-read the run and inspect the named refusal; do not treat `null` as an empty feed. |
| A command response was lost | Check its retained result with the original command id. If the group no longer exists, the outcome cannot be confirmed; use **Check again** for one lookup or **Dismiss** the attention item. A refresh does not resend the command. |
| Unknown usage blocks admission | An owner can inspect and explicitly conservatively settle the remaining work and handoff grants in the Web UI. This charges remaining allowances as used; it is not a measured provider report and does not itself retry or clear a stop. |
| `recovery-blocked` | Read the named blocker and inspect evidence. If a database was manually edited, preserve a backup and diagnose the damaged record separately; refreshing cookies does not repair store data. |
| Started, but no task runs | Check the group stop banner, global recovery/admission blockers, budget/caps, dependencies, agent preview and execution-port configuration. Open the task activity and evidence before retrying. |
| Schedules do not fire | The panel has no execution port (see [ccloop](#2-ccloop)), or the schedule paused itself after three failed starts. The schedule row names the last fire and why it was late, skipped or failed. |
| A landing or folder placement stopped | Read the reason. A multi group offers **Retry the rest** and **Mark resolved**; a folder offers **Take folder**, **Recheck** and **Withhold**. A stopped write never overwrote anything in the folder. |

A requirement waiting for answers/review or a failed idle requirement can be archived from its detail. A drafting call
or unresolved stop must finish/recover first. Archiving keeps its records; the archived detail is read-only and offers
**Unarchive**. Recent task activity displays the latest returned window in chronological order; it is not the full run
history. Runs use K/M/B token units with exact counts in the tooltip, and keep raw identifiers in expandable details.

The genuine saved-result integration gate is `npm run verify:saved-result`. It uses isolated fake providers and requires three explicit paths: `ORCA_SAVED_RESULT_OLD_ORCA_ROOT` at immutable Orca `c2a1f4220006ca22b620bd81f390a728e5d07b8c`, `ORCA_SAVED_RESULT_OLD_CCLOOP_ROOT` at immutable ccloop `5b0adea413b885a1151259d5eb88d21eedcc2ce0`, and the built feature-capable `ORCA_SAVED_RESULT_CCLOOP_BIN`. Both historical producers must be built and have unchanged tracked source. The gate builds an immutable schema11 reader from the existing local f00bfdb797ee3f5de130585557fdf77dc421d535 Git object in its own private clone with existing dependencies, and proves genuine 10→11→12 migration plus old11 rejection of schema12 before dispatch; it never fetches or installs. Missing local source or a failed reader build fails the gate. The paired binary is separate from `ORCA_CCLOOP_BIN`; this gate never changes the default dependency pin. The gate fails on missing or invalid prerequisites and runs every genuine migration, owner-settlement and crash criterion with `ORCA_SAVED_RESULT_VERIFY=1`. Ordinary root tests explicitly skip that native integration file when this opt-in flag is absent; all synthetic controller, route and browser tests still run.
