# Orca × syncskill: per-run skill snapshots — design

Session `08b1007d`, 2026-10-03. Repos touched: Orca (most), ccloop (one protocol field + adapter), syncskill (none).
Direction: goal.md §3.6, ruling G5 (i). syncskill side: its spec `2026-10-03-profile-inject-version-design.md` (§10 for `--sync-dir`).

## 1. Goal

A task can name the skills its agent should have. Every run of that task gets a pinned copy of exactly those skills,
the agent (claude) can see them, and afterwards Orca can answer "which version of each skill did this run use".
Nothing the injection writes may end up in the landing commit.

Success, as commands (each exits 0/non-0, details in §8):
- a fake-claude run of a task with skills receives `--plugin-dir <dir>` and no `--disable-slash-commands`, and the
  skills under `<dir>` match the lock recorded on the run;
- a run of a task without skills passes byte-identical claude arguments to today's;
- the landed commit of a run with skills contains no injected path.

## 2. Human rulings (this session)

- **H1** Drop `--disable-slash-commands` only for runs that have a skill set; runs without one keep it and behave as today.
- **H2** The skill set is declared on the task's loop plan (plan file `loop` object and `set-task-loop`).
- **H3** A profile is resolved to a skill-name list at confirm time and frozen; later profile edits do not reach a confirmed task.
- **H4** Approved direction: one `syncskill inject` per run, into a directory outside the git workspace, loaded as a
  claude plugin via `--plugin-dir`; the lock goes into the run's drive record, never into a commit.
- **H5** (review round) No paid real-claude acceptance this round. Agreed as written: a task with skills on a codex agent
  is refused at confirm; an inject failure blocks the run; ccloop is pushed before Orca is re-pinned.
- **H6** (review round) Codex skills: "this round or the next". Controller recommendation, pending the human: next round,
  because no measured codex route keeps the snapshot both out of the commit and away from the auth home (§3.1).

## 3. Measured facts this design rests on

All measured in session `08b1007d` on claude 2.1.288, HOME pointed at a temp dir, API pointed at a local recorder
(a ~10-line node HTTP server that saves each request body and answers 500), so no model call was made. The probe is to be re-run as a plan task and committed under `scripts/`. A skill counts as "reaching the model" when its
name appears in the recorded `POST /v1/messages` bodies.

| claude flags (all with `--setting-sources project,local --strict-mcp-config`) | `<cwd>/.claude/skills` | `--plugin-dir` skill | `~/.claude/skills` |
|---|---|---|---|
| with `--disable-slash-commands` (today's default, `ccloop/src/agents/claude.ts` draft args) | not sent | not sent | not sent |
| without it | sent | sent | not sent |

(`claude --help`: `--disable-slash-commands  Disable all skills`.) The debug log of the run without the flag also
reports 39 bundled skills; those reach the model too (accepted by H1).

### 3.1 Codex (codex-cli 0.155.1, same recorder method, `CODEX_HOME` and HOME at temp dirs)

| skill location | sent to the model |
|---|---|
| `$CODEX_HOME/skills/<name>` | yes |
| `<cwd>/.codex/skills/<name>` | yes |
| `<cwd>/.agents/skills/<name>` | yes |
| outside all of these, named by `-c 'skills.config=[{path=…,enabled=true}]'` | no |

Consequences: codex needs no flag to see skills, but the two cwd locations are inside the git worktree (committed,
§3 code facts), and `$CODEX_HOME` also holds the auth (`exec --help`: "auth still uses `CODEX_HOME`"), so a per-run
`CODEX_HOME` would have to carry credentials. The binary also names `SkillsExtraRootsSet` (an app-server call, not an
`exec` option) and codex plugins; neither was probed. **Existing gap, not introduced here:** today's codex runs already
see the person's `~/.codex/skills` and the target repository's own skills, whereas claude runs see none.

### 3.2 Code facts (read, not run)
- Orca makes one workspace per run (`ensureWorkspace`, `src/control/workspace.ts`); ccloop makes one worktree per
  attempt inside it, and plan/execute/verify share it. ccloop's attempt teardown and Orca's `commitAttempt` both run
  `git add -A`; harvest diffs `base..attemptSha` against the task's claimed paths and blocks `out-of-bounds:` otherwise.
  ⇒ anything written into the workspace or worktree would be committed and would block the run.
- Only direct children of `workspacesRoot` are the driver's to create or delete (`assertOwnPath`).
- `inject` refuses a target that already holds a skill or `syncskill-lock.json` (exit 7, `E_TARGET_OCCUPIED`), copies a
  dereferenced snapshot, and prints a JSON `result` whose summary is `{ target, lock, skills: LockSkill[] }`
  (`LockSkill = { name, source, resolved_commit, content_md5 }`).
- `syncskill --json profile ls <name>` answers `{ profiles: { <name>: string[] } }`, or `E_PROFILE_NOT_FOUND` (exit 2).
- syncskill exit codes Orca must not over-read: an unexpected error exits 1 with no JSON `error` event; commander usage
  errors exit 1, not 2.

## 4. Design

### 4.1 Declaration (Orca)

The plan file's `loop` object (`loopPlanFileSchema`) and the stored inputs (`loopInputsSchema`) gain an optional
`skills`, exactly one of:
- `{ "profile": "<name>" }` — name matches syncskill's `PROFILE_NAME_PATTERN` `^[a-zA-Z0-9_-]+$`;
- `{ "names": ["a", "b"] }` — non-empty; each name passes syncskill's `isSafeSkillName` rule (not empty, not starting
  with `.`, no `/`, `\`, NUL); stored sorted and de-duplicated.

The field is **omitted** when absent, never written as `null`, so every existing recipe, recipe hash and derived
contract stays byte-identical. `skills` is not part of the ccloop contract.

Refusals at import / `set-task-loop` (new `LoopRefusal` values): `skills-shape`.

### 4.2 Freeze at confirm (H3)

At confirm (and at a `set-task-loop` on a confirmed task, which already rewrites that task's snapshot entry via
`replaceTaskInSnapshot`), for each task with `skills`:
- `names` → frozen as is;
- `profile` → `syncskill --json profile ls <name>`, the member list frozen; the profile name is kept alongside.

The execution snapshot gains an optional `skills: Array<{ taskId, profile: string | null, names: string[] }>`, present
only when at least one task has skills (old snapshots and hashes unchanged). `readConfirmedTaskExecution` returns the
task's entry (or `null`).

Confirm fails, with the group left unconfirmed, when:
- a task has skills and `ORCA_SYNCSKILL_BIN` is not set → `syncskill-unconfigured`;
- a task with skills is assigned a non-claude agent → `skills-unsupported-agent` (codex skill discovery is unverified);
- the profile lookup fails → `syncskill-failed:<code>` (§4.5).

### 4.3 Injection at run start (Orca, step A2)

Right after `ensureWorkspace` and before the start envelope is written, for a run whose task has a frozen skill set:

1. `dir = <workspacesRoot>/skills-<runId>` (a direct child, so `assertOwnPath` / `removeOwnPath` apply).
2. If the drive record already holds `skills` for this run and `dir` exists, reuse it (an A2 retry). Otherwise
   `removeOwnPath(dir)`, then create `dir` (mode `0700`).
3. Spawn `<ORCA_SYNCSKILL_BIN> --json inject --skills <names joined by ,> --target <dir>/skills`
   (always `--skills` with the frozen list, even for a profile, so the snapshot cannot drift from the freeze).
4. Write `<dir>/.claude-plugin/plugin.json` = `{ "name": "orca-run-skills", "version": "0.0.0" }` (mode `0600`).
5. Parse the result summary; require `skills[].name` to equal the frozen list exactly. Record on the drive record:
   `skills: { dir, profile, lock: LockSkill[] }` (new field, `.default(null)` like `cleanupError`).
6. Put `skillPluginDir: dir` on the start envelope's loop work (§4.4).

Any failure blocks the run at A2 with `skills-inject-failed:<code>` — never a silent run without skills.
A new run (new `runId`) injects afresh. The directory is removed wherever the run's workspace is removed.
Estimate (single-call) runs and reconcile runs never get skills.

### 4.4 ccloop (protocol 3, additive)

- `loopWorkSchema` gains optional `skillPluginDir: string` (absolute). Absent ⇒ every byte and behaviour as today.
- The worker hands it to the agent config. The claude adapter, when it is set:
  - appends `--plugin-dir <dir>` to its extra args;
  - removes every element equal to `--disable-slash-commands` from the installation command for this call only;
  - records the effective command and args in `outcome.json` (it already records `claudeCommand` / `extraArgs`).
- The codex adapter refuses a run with `skillPluginDir` set (fail closed).

Order (memory `ccloop-repin-by-agent`): ccloop commit → human pushes ccloop → Orca agent runs
`node scripts/pin-ccloop.mjs <SHA>` → human pushes Orca. An older ccloop rejects the unknown field (strict schema), so a
mismatch fails loudly.

### 4.5 Calling syncskill (Orca)

New `src/skills/syncskill.ts`, modelled on `src/memory/ccmem.ts`:
- `ORCA_SYNCSKILL_BIN` must be an absolute path; read where `ORCA_CCMEM_BIN` is read; unset ⇒ skills unavailable.
- `execFile(bin, args, { env: process.env, timeout: 30_000, maxBuffer: 16 MiB, encoding: "utf8" })`, stdin closed.
- Errors: `syncskill-missing` (ENOENT/EACCES), `syncskill-timeout`, `syncskill-output-too-large`,
  `syncskill-failed:<E_CODE>` when a JSON `error` event names one, else `syncskill-failed:<exit status>`.
- Output is read strictly: the `result` event must parse with a zod schema mirroring `syncskill-lock-v1` entries;
  anything else ⇒ `syncskill-output-invalid`.

### 4.6 Panel

- The loop plan card's "Skill set: not supported yet" line shows the declared set (profile name and/or names).
- The run view shows the drive record's lock: each skill's name, `resolved_commit` (or "local"), `content_md5`.
- Both locales (en/zh) get the new strings.

## 5. Repository-external reads and writes (Rule 17)

- Orca writes only under its own `workspacesRoot` (`skills-<runId>`). Modes: dir `0700`, `plugin.json` `0600`
  (syncskill's copied files keep syncskill's modes).
- syncskill reads the person's `~/.syncskill` (or `SYNCSKILL_DIR`). Whether `inject` / `profile ls` write anything
  there (config diagnosis in syncskill's preflight) is **not yet measured**; the plan's first task measures it with a
  before/after snapshot and records the answer here as a correction.
- Every Orca criterion runs syncskill with `SYNCSKILL_DIR` (and HOME) pointed at a temp dir, plus a before/after
  snapshot of the real `~/.syncskill`.

## 6. Capacity (memory `orca-goal-massive-parallelism`)

Per run with skills: one extra short-lived process (`node` running syncskill) at A2, plus one per profile-based task at
confirm; 0 extra long-lived processes or fds while the run executes. Disk: one copy of the skill set per run, removed
with the workspace. Measured numbers (spawn time, bytes) are to be recorded by the plan's gate, not estimated here.

## 7. Error and edge cases

| Case | Behaviour |
|---|---|
| skill removed from syncskill between confirm and run | inject `E_SKILL_NOT_FOUND` ⇒ run blocked `skills-inject-failed:E_SKILL_NOT_FOUND` |
| leftover `skills-<runId>` from a crash, no drive record entry | removed and re-injected (step 2) |
| syncskill exits 1 without an `error` event | `syncskill-failed:1` |
| `ORCA_CCLOOP_BIN` points to a ccloop without the field | ccloop rejects the envelope ⇒ run blocked by name (existing path) |
| task has skills, agent table has no `--disable-slash-commands` | nothing to remove; `--plugin-dir` still added |

## 8. Criteria (each new branch gets a mutation that deletes it and is seen red)

| # | Criterion | Kills mutation |
|---|---|---|
| C1 | plan-file `skills` round-trips; absent ⇒ recipe bytes and contract hash identical to before | writing `skills: null` |
| C2 | bad shapes (both keys, empty names, unsafe name, bad profile name) refused `skills-shape` | dropping the shape check |
| C3 | confirm freezes a profile's members (fake syncskill answers), snapshot hash unchanged for a group without skills | freezing the profile name only |
| C4 | confirm refusals: unconfigured, codex agent, profile not found | each refusal removed |
| C5 | A2 with real syncskill (temp `SYNCSKILL_DIR`): `dir/skills/<name>/SKILL.md` present, `plugin.json` present, drive record lock equals the syncskill lock file | skipping `plugin.json`; recording `lock` from the frozen names instead of syncskill's output |
| C6 | envelope carries `skillPluginDir` only for runs with skills; without skills the envelope hash is unchanged | always setting it |
| C7 | ccloop: fake claude argv has `--plugin-dir <dir>` and no `--disable-slash-commands` when set; argv byte-identical when unset | not removing the flag; removing it unconditionally |
| C8 | ccloop codex adapter refuses `skillPluginDir` | removing the refusal |
| C9 | end-to-end (fake claude writes a file inside `targetPaths`): run lands, landed commit's tree has no `.claude/` and no `syncskill-lock.json` | injecting into the workspace instead of `skills-<runId>` |
| C10 | inject failure (`E_SKILL_NOT_FOUND`) blocks at A2 with the named reason | swallowing the error |
| C11 | workspace cleanup removes `skills-<runId>` | leaving it |
| C12 | real `~/.syncskill` snapshot unchanged around every file that spawns syncskill | — (guard) |

Not in this round: a paid real-claude acceptance (H5); codex skills (H6, facts in §3.1);
machine-level `link build`; panel editing of skills beyond what `set-task-loop` already offers.

## 9. Open points the plan must settle by measurement

- Whether claude treats the `syncskill-lock.json` file inside `<dir>/skills` as anything (expected: ignored, since a
  skill is a directory). If it does, Orca moves the lock to `<dir>/syncskill-lock.json` right after inject.
- Whether plugin skills are namespaced (`orca-run-skills:<name>`) in what the model sees, and whether that matters to
  prompts that name a skill.
- The §5 write question.
