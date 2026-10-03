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

Code facts (read, not run):
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

Not in this round: a paid real-claude acceptance (needs its own criterion and cost cap, reported first); codex skills;
machine-level `link build`; panel editing of skills beyond what `set-task-loop` already offers.

## 9. Open points the plan must settle by measurement

- Whether claude treats the `syncskill-lock.json` file inside `<dir>/skills` as anything (expected: ignored, since a
  skill is a directory). If it does, Orca moves the lock to `<dir>/syncskill-lock.json` right after inject.
- Whether plugin skills are namespaced (`orca-run-skills:<name>`) in what the model sees, and whether that matters to
  prompts that name a skill.
- The §5 write question.

## 10. Review round (session `08b1007d`, 2026-10-03) — corrections and additions

**§1–§9 above are the text as published (commit `docs(spec): per-run skill snapshots from syncskill, …`) and are kept
verbatim. Where they disagree with this section, this section wins.** Sources: an independent review of §1–§9 against
the code (every load-bearing claim re-read by the controller before being accepted), a codex probe, and the human's
review answers.

### 10.1 Human rulings

- **H5** No paid real-claude acceptance this round. Agreed as written: a task with skills on a codex agent is refused;
  an inject failure blocks the run; ccloop is pushed before Orca is re-pinned.
- **H6** Codex skills go to the next round (human: "codex 放下一轮，同意") — facts in §10.2.

### 10.2 Codex probe (codex-cli 0.155.1, same recorder method as §3, `CODEX_HOME` and HOME at temp dirs)

| skill location | sent to the model |
|---|---|
| `$CODEX_HOME/skills/<name>` | yes |
| `<cwd>/.codex/skills/<name>` | yes |
| `<cwd>/.agents/skills/<name>` | yes |
| outside all of these, named by `-c 'skills.config=[{path=…,enabled=true}]'` | no |

The cwd locations are inside the attempt worktree (committed); `$CODEX_HOME` also holds the auth, so a per-run
`CODEX_HOME` would carry credentials. Not probed: the `SkillsExtraRootsSet` app-server call and codex plugins.
**Existing gap, not introduced here:** today's codex runs already see the person's `~/.codex/skills` and the target
repository's own skills; claude runs see none.

### 10.3 Corrections to §3.2 / §3 "Code facts"

- ✗ "anything written into the workspace … would be committed". ccloop creates each attempt worktree with
  `git worktree add --detach` from the workspace's **HEAD** (`ccloop/src/workspace/worktreeManager.ts`), so uncommitted
  files in Orca's workspace never reach the attempt, its commit or the landing. The commit risk is real only for the
  attempt worktree, which Orca never writes into. `copyLiveWorkspace` copies only the attempt worktree.
- Orca keeps its own strict copy of the envelope schema (`src/control/schema.ts`, `loopWorkSchema`), checked by
  `toStartEnvelope`; ccloop's copy is `ccloop/src/control/protocol.ts`. Both must gain the field.
- `syncskill profile ls` runs the manifest auto-refresh (only `inject` skips it), so it writes under the sync dir unless
  `--no-refresh` is given. This answers the §5 / §9 write question for `profile ls`.
- `inject --skills` splits on `,` and trims, while `isSafeSkillName` allows `,` and spaces.

### 10.4 Declaration — replaces §4.1

- `skills` lives on the **recipe**, as a sibling of `inputs` (`loopRecipeSchema`), not inside `loopInputsSchema`
  (whose convention is "every optional field filled"). The plan file's `loop` object and the set-task-loop payload each
  gain an optional `skills` with the shapes of §4.1.
- Name rule: syncskill's `isSafeSkillName` **plus** no `,` and no leading/trailing whitespace. Profile rule unchanged.
- Absent ⇒ the key is omitted (conditional spread; an explicit `undefined` throws `control-non-canonical-json`), so
  archived plan bytes, `planHash`, recipe and contract hashes are unchanged. `expandRecipe` builds the contract field by
  field, so `skills` cannot reach the ccloop contract.
- set-task-loop: `skills` is left out of the `kept` comparison (a skills-only change must not re-expand a v1 recipe at
  the current plan version) and is part of the no-op test (a skills-only change is not a no-op). The panel's
  set-task-loop payload (`web/src/LoopPlanCard.tsx`) carries the current `skills` through unchanged.

### 10.5 Freeze — replaces §4.2

- confirm: profile lookups run in the async step before the transaction (next to `resolveGroupSelections`); a lookup
  failure is thrown inside the transaction after every existing check, as slot failures are.
- set-task-loop becomes async the same way. On a confirmed task it refuses `skills-unsupported-agent` (the agent is
  already frozen), and `replaceTaskInSnapshot` adds, rewrites or removes that task's `skills` entry, dropping the
  top-level key when no task has skills.
- Profile lookup: `syncskill --json --no-refresh profile ls <name>`. Members are normalised (sorted, de-duplicated) and
  validated with the §10.4 name rule; an empty profile is refused at confirm (`skills-profile-empty`).
- Snapshot schema: `skills` sorted and unique by `taskId`, each `taskId` among `derivedContracts`.
- `readConfirmedTaskExecution` checks it: an entry exists exactly when the task's effective recipe has `skills`; for
  `names` the lists are equal, for `profile` the profile names are equal; anything else ⇒ `recovery-blocked`.
- `ORCA_SYNCSKILL_BIN` is plumbed into both `WebControlService` and `ExecutionDriverDeps` (`controlAssembly.ts`).

### 10.6 Injection — replaces §4.3 steps 1–2 and 5, and the cleanup sentence

- `skillsPathOf(roots, runId) = <workspacesRoot>/skills-<runId>` next to `landingPathOf` (runIds are `run-<uuid>`, so no
  collision with `<runId>`, `landing-`, `conflict-`, `reconcile-`).
- No reuse branch: A2 writes the drive record only once, together with `prepared: true`, so while A2 runs there is never
  a recorded `skills`. A2 always `removeOwnPath(skillsPathOf)`, creates `<dir>`, `<dir>/skills` and
  `<dir>/.claude-plugin` with mode `0700` (inject accepts an existing empty target), injects, and records
  `skills: { dir, profile, lock: LockSkill[] }` in the same final write as `envelopeHash`.
- `ORCA_SYNCSKILL_BIN` unset at A2 for a task with skills ⇒ blocked `skills-inject-failed:syncskill-unconfigured`.
- After inject: `chmod -R a-w <dir>/skills` so the agent cannot edit the snapshot it is given.
- Cleanup keys on the runId, not on `drive.skills`: `cleanupRunWorkspace` removes `skillsPathOf` unconditionally, which
  covers step E, a continuation's predecessor cleanup, and `restartRun` (runs whose A2 crashed before its write).
- `newDrive` adds `skills: null` (the drive record schema is strict).
- Lock meaning, stated plainly: with `--skills` the lock's `profile` is `null` (Orca records the profile itself);
  `resolved_commit` is the source's materialised commit, not proof of the copied bytes — `content_md5` is that proof;
  a continuation run injects afresh, so two runs of one task may differ if syncskill's content changed in between.

### 10.7 ccloop — replaces §4.4 bullets 2 and 3

- `skillPluginDir` is **not** put into `MaterializedAgentConfigV1` (sealed and hash-checked at accept). The worker reads
  it from `envelope.json` (re-read on relaunch) and passes it to the claude adapter as a separate optional option.
- `acceptStart` refuses a run with `skillPluginDir` whose agent is not claude (next to `single-call-unsupported`), so
  nothing is persisted; Orca blocks it as `accept-refused:`. `validateEnvelopePaths` checks `skillPluginDir` like
  `sourceDir` (absolute, existing, canonical).
- The plugin dir applies to all three phases (plan, execute, verify). Controller ruling, for the human to review: a
  skill is a capability, not a constraint, so it is not withheld from the verifier the way loop constraints are.

### 10.8 Criteria — replaces §8 (C1–C12 keep their numbers where unchanged)

| # | Criterion | Mutation that must turn it red |
|---|---|---|
| C1 | plan-file `skills` round-trips; a golden fixture without skills keeps its exact archive bytes, `planHash` and contract hash | writing `skills: null` / `undefined` |
| C2 | bad shapes refused `skills-shape`: both keys, empty names, unsafe name, name with `,` or edge whitespace, bad profile name | each check removed |
| C3 | confirm freezes a fake syncskill's profile members (normalised); a golden group without skills keeps its exact snapshot hash | freezing the profile name only; no normalisation |
| C4 | confirm refusals: unconfigured, codex agent, profile not found, empty profile | each refusal removed |
| C5 | A2 with real syncskill (temp `SYNCSKILL_DIR`): skills present, `plugin.json` present, dirs `0700`, snapshot read-only, drive record `lock` equals the lock file's `skills[]` | skip `plugin.json`; lock from frozen names; skip chmod |
| C6 | envelope carries `skillPluginDir` only with skills; a golden run without skills keeps its exact envelope hash; Orca's schema accepts it | always set it; Orca schema without the field |
| C7 | ccloop: fake claude argv has `--plugin-dir <dir>` and no `--disable-slash-commands` in every phase when set; argv byte-identical when unset | flag not removed; removed unconditionally |
| C8 | ccloop `acceptStart` refuses `skillPluginDir` with a codex agent, persisting nothing; refuses a non-canonical path | each refusal removed |
| C9 | **smoke, no mutation**: a run with skills lands; the landed tree has no `.claude/` and no `syncskill-lock.json` | — |
| C10 | inject failure (`E_SKILL_NOT_FOUND`) and unset bin at A2 block with the named reasons | swallowing the error |
| C11 | `cleanupRunWorkspace` removes `skills-<runId>`, including for a `restartRun` run with no `drive.skills` | keying cleanup on `drive.skills` |
| C12 | guard: the real `~/.syncskill` is unchanged around every file that spawns syncskill. Its red proof points the "real" path at a decoy HOME, never at the real one (Rule 17) | the spawned syncskill given no `SYNCSKILL_DIR` (decoy only) |
| C13 | set-task-loop: a skills-only change is accepted (not `no-op-command`) and keeps a v1 recipe at v1 | `skills` in the `kept` comparison; `skills` out of the no-op test |
| C14 | the panel's budget edit keeps `skills` | payload built without it |
| C15 | set-task-loop on a confirmed task rewrites, adds and removes the snapshot entry | `replaceTaskInSnapshot` unchanged |
| C16 | a tampered snapshot `skills` entry ⇒ `recovery-blocked` | the check removed |
| C17 | a continuation run gets its own `skills-<runId>` and the predecessor's is removed | — (covered by C11's mutation; shown red there) |
| C18 | `profile ls` is spawned with `--no-refresh`; the temp sync dir is byte-identical after a confirm | flag dropped |
| C19 | panel: the loop card shows the declared set; the run view shows each lock entry (both locales) | each rendering removed |

### 10.9 Residue left on failure (adds to §5)

A blocked run keeps its `skills-<runId>` until its workspace is cleaned; a killed `inject` may leave
`<dir>/skills/.syncskill-inject-*` (removed with `<dir>`). Neither is outside `workspacesRoot`.

## 11. Implementation corrections (session `08b1007d`, 2026-10-03, SDD round)

**§1–§10 above stay verbatim; where they disagree with this section, this section wins.** Every item below is a
controller ruling recorded with its cost in `.superpowers/sdd/2026-10-03-syncskill-integration/progress.md`
(the human asked for the round to run unattended and to review all rulings at the end).

### 11.1 Agent kind: ccloop is the only authority

- ✗ §4.2 / §10.5 / §10.8 C4 "a task with skills assigned a non-claude agent → `skills-unsupported-agent`" at confirm and
  at set-task-loop. A frozen selection's `agent` is an agents-table **installation id**, not a kind (ccloop
  `src/agents/materialize.ts` `resolveAgent`: kind = `table.installations[id].kind`), and Orca neither reads the table nor
  freezes the kind. Orca therefore has no agent-kind check; `skills-unsupported-agent` exists only in ccloop's
  `acceptStart`, which refuses before persisting anything. Orca records the run as blocked
  `accept-refused:2:skills-unsupported-agent` (pinned by the codex variant in `tests/control/skillsE2E.test.ts`).
- **Real cost (final review I1):** such a task cannot be changed afterwards (set-task-loop answers
  `task-already-started`), and a recovery retry or a restart sends the same frozen agent again, so only stopping the group
  ends it. Accepted because next round's codex skill support (H6) removes the path; until then, do not pair codex with
  skills.

### 11.2 set-task-loop (replaces the set-task-loop parts of §10.4 / §10.5)

- A payload without `skills` removes the task's skills: the payload is the full desired state, like `inputs`. The panel
  (loop card budget edit and the BudgetEditor estimate suggestion) sends the current `skills` back unchanged.
- A draft task never spawns syncskill (confirm freezes it later).
- On a confirmed task, an **unchanged** declaration keeps its frozen snapshot entry and spawns nothing (H3: later
  profile edits never reach a confirmed task, not even through a budget edit). A **changed** declaration is resolved:
  a profile is looked up; names are taken as given; with `ORCA_SYNCSKILL_BIN` unset either kind is refused
  `syncskill-unconfigured` (as confirm does).
- A task read as a draft before the transaction but confirmed inside it, with a changed declaration, is refused
  `proposal-version-conflict`.
- A skills-only change does not set `planChanged` (that flag is about the contract; skills are not in it).

### 11.3 Smaller corrections

- §7 row "skill removed between confirm and run": the block reason is `skills-inject-failed:syncskill-failed:E_SKILL_NOT_FOUND`
  (`skills-inject-failed:<SyncskillError code>`), not `skills-inject-failed:E_SKILL_NOT_FOUND`. A failure that is not a
  SyncskillError is `skills-inject-failed:<error text>`.
- §10.8 C2: both keys, empty `names` and a bad profile name are refused by the plan-file schema
  (`malformed: tasks.N.loop.skills: Invalid input`); only skill-name-rule violations answer
  `loop-plan-invalid:<task>:skills-shape`.
- §4.3 step 6: `skillPluginDir` (and the drive record's `dir`) is the **realpath** of `skills-<runId>`, because ccloop's
  accept requires a canonical directory. The panel's run view does not expose `dir`.
- ccloop's worker re-validates `skillPluginDir` as an accept on every (re)start, and a replayed `accept` after the
  directory is gone answers `control-request-invalid`. Orca keeps `skills-<runId>` until the run's workspace is cleaned.
- Profile lookups always pass `--no-refresh`. Only the fake-syncskill argv test proves it: on a seeded sync dir with no
  servers, real `profile ls` writes nothing with or without the flag.
- Error codes registered in Orca: `syncskill-unconfigured`, `syncskill-missing`, `syncskill-timeout`,
  `syncskill-output-too-large`, `syncskill-failed` (detail = syncskill's code or exit status), `syncskill-output-invalid`,
  `skills-profile-empty`, `skills-shape` (all durable 422); `skills-unsupported-agent` is not an Orca code.

### 11.4 §9 answered by measurement

`scripts/probe-claude-skills.mjs` (committed; offline recorder, no model call), run once on claude 2.1.288 with a plugin
dir laid out as A2 lays it out, read-only:
- the skill reaches the model **namespaced, as `orca-run-skills:<name>`**, never under its bare name — a prompt that
  names a skill must use the namespaced form or rely on claude matching it by description;
- nothing from `skills/syncskill-lock.json` reaches the model, so the lock stays where inject puts it;
- a read-only plugin dir loads, and claude does not modify it.
The §5 write question for `profile ls` is answered in §10.3 (it refreshes unless `--no-refresh`); `inject` skips the
refresh by itself.

### 11.5 §6 capacity, measured

Command: `node <syncskill clone>/dist/index.js --json inject --skills alpha --target <dir>` with `HOME` and `SYNCSKILL_DIR` at
temp dirs, one one-file skill, five runs; syncskill at its main (`docs(sdd): record the --sync-dir follow-up …`), Orca
session `08b1007d`, 1-minute load 4.1. Result: 214–293 ms per inject (first run slowest), 8 KiB on disk per run.
`--json --no-refresh profile ls`: 206–210 ms (three runs). The cost is one short-lived `node` process per run at A2 (and
one per changed profile at confirm / set-task-loop); nothing stays alive while the run executes. Larger skill sets were
not measured.
