# Orca × Codex skills — design

Status: design proposal for human review. This document describes H6 from
`docs/handoff/handoff.md` §4.0. It is not an implementation plan.

## 1. Goal

Allow a task with the existing `skills` declaration to use its frozen skill
snapshot in Codex plan, execute, and verify phases. Preserve the current
per-run lock record and keep runs without skills byte-identical. Do not write
skills into an attempt commit or modify the user's Codex home.

Success means:

- Orca accepts skills for installations whose ccloop-reported kind is
  `claude` or `codex`; unsupported kinds still fail before dispatch.
- The task's frozen skills are discoverable in all three Codex phases, and the
  injected root contains only that frozen set. Existing user-global and
  repository skills retain today's visibility.
- Codex sees the skills through its native `.agents/skills` discovery path,
  while the backing snapshot remains outside the attempt worktree and
  read-only.
- Existing `.agents/skills` directories and their contents survive unchanged.
  A selected skill name that already exists there is a named refusal; it is
  never overwritten or recursively removed.
- No injected path is staged or committed, including after a failed phase or
  a resumed run.
- Claude skill behavior and tasks without skills keep their existing wire
  fields, arguments, and behavior.

Out of scope: changing skill declarations or profile freezing; changing the
existing visibility of user-global Codex skills; paid/live model acceptance;
Codex app-server skill roots or Codex plugins; verifier-specific declarations.
Skills continue to apply to plan, execute, and verify as already ruled in the
syncskill integration.

## 2. Existing contract and measured facts

The current skill integration is documented in
`docs/superpowers/specs/2026-10-03-syncskill-integration-design.md` and its
§11–§12 corrections. Orca freezes names at confirm, injects a read-only
snapshot per run outside the git worktree, and records the lock on the drive
record. It currently permits only Claude skills. The ccloop protocol carries
`work.skillPluginDir`, and ccloop rejects that field for non-Claude agents.

The earlier Codex probe (codex-cli 0.155.1, recorded in the prior design)
found that Codex discovers `$CODEX_HOME/skills`, `<cwd>/.codex/skills`, and
`<cwd>/.agents/skills`. Its `skills.config` setting did not make an external
directory discoverable. A private per-run `CODEX_HOME` is unsuitable because
the configured Codex home can contain authentication and configuration.
The existing exposure of user-global skills predates this feature and remains
unchanged.

An isolated no-model probe was run on the installed codex-cli 0.160.0. With
`HOME` and `CODEX_HOME` directed to temporary directories, a temporary git
workspace, and `.agents/skills/h6-symlink-probe` linked to an external skill
snapshot, `codex debug prompt-input` listed that skill with the workspace's
`.agents/skills` as its root. This establishes discovery through a directory
symlink on 0.160.0. It does not establish that a model request used the skill,
nor does it establish behavior for every Codex version.

Each ccloop attempt has its own git worktree. `publishAttemptCommit` stages
with `git add -A`; therefore the temporary discovery links must be removed
before that function runs. The Codex adapter launches a separate CLI process
for each of plan, execute, and verify, so temporary links can be installed
and cleaned around each individual phase.

## 3. Chosen design

### 3.1 Wire contract

Add optional `work.codexSkillsDir` to protocol 3 loop work, alongside the
existing `skillPluginDir`. It is the canonical absolute path to the `skills`
directory in Orca's frozen, read-only per-run snapshot. The two fields are
mutually exclusive. At `accept`, ccloop requires the referenced directory to
exist and be canonical, and requires `codexSkillsDir` to be paired with a
Codex installation and `skillPluginDir` with a Claude installation. Both
fields remain absolute-path-only for later inspect, handoff, collect, and
read-evidence calls, because Orca removes the snapshot only after collection.

Orca selects the field from the frozen agent kind returned by ccloop's
`listAgents` view. This keeps ccloop's installed-agent table as the authority
for kind. The run drive record continues to store the same snapshot directory,
profile, and lock; only the protocol representation differs by agent kind.
Tasks with no skills omit both optional fields.

This is additive to protocol 3's strict schema. An old ccloop rejects the new
field, so rollout order remains ccloop change first, then Orca's pinned
dependency update. Development gates use an isolated ccloop clone through
`ORCA_CCLOOP_BIN`; publishing remains the human's responsibility.

### 3.2 Codex phase setup and cleanup

For each Codex phase, ccloop reads the frozen skill names from the snapshot
directory and exposes each selected skill at
`<attempt-worktree>/.agents/skills/<name>` as a directory symlink to
`<codexSkillsDir>/<name>`. It does not change `CODEX_HOME`, copy credentials,
or copy skill data into the attempt worktree. The source snapshot is already
read-only; the link itself is temporary.

The setup helper follows an ownership-based protocol:

1. Validate the snapshot root and each selected source skill as canonical
   directories inside the snapshot root.
2. Inspect `.agents` and `.agents/skills` with `lstat`. An existing component
   must be a real directory, not a symlink or another file type. Preserve any
   existing directory and all of its contents.
3. For each selected name, create a symlink only when that exact leaf is
   absent. If the leaf is already a symlink to the same canonical,
   run-specific snapshot skill, adopt it as stale residue from an interrupted
   phase and clean it after this phase. If the leaf exists in any other form,
   fail with `codex-skills-path-conflict:<name>` before starting Codex.
4. Record which parent directories and leaves this setup created or adopted.
   If setup fails partway through, clean only those owned/adopted leaves.
5. Run Codex, wait for the child process to exit, then unlink only selected
   leaves that still point to the expected run-specific snapshot paths. Never
   recursively remove `.agents`, `.agents/skills`, or any pre-existing skill.
   Remove a parent only if this setup created it and it is still empty.
6. If cleanup fails, fail the phase and prevent attempt publication. The
   normal ccloop worktree removal remains the final cleanup boundary for a
   process crash; resume must not publish an attempt that still contains an
   Orca skill link.

The per-phase lifetime avoids carrying generated paths between plan, execute,
and verify; each phase starts from the same immutable snapshot. A symlink to
the uniquely named run snapshot also makes ownership recognizable after a
crash without a marker file in the user's skill directory. An empty parent
left by a crash is harmless in the disposable attempt worktree and is never
recursively removed; normal attempt cleanup removes that worktree.

### 3.3 Refusals and compatibility

- Unsupported agent kinds keep the existing
  `skills-unsupported-agent:<task>:<installation>:<kind>` refusal.
- Existing selected-name paths produce `codex-skills-path-conflict:<name>`;
  the original content is untouched.
- Invalid snapshot roots, source skill paths, or failed cleanup block the
  ccloop phase with a specific error and do not silently run without skills.
- Runs without skills do not create `.agents/skills`, do not spawn additional
  processes, and omit `codexSkillsDir`; existing Claude argv and Codex argv
  remain unchanged.
- Snapshot removal continues to follow the current Orca workspace and run
  cleanup rules. The snapshot remains until ccloop no longer needs to
  revalidate the accepted envelope.

## 4. Verification design

Verification stays in isolated clones with `HOME`, all four XDG roots, and a
short real `TMPDIR` redirected. No gate reads or writes real `~/.orca/*`.
Fake Codex and fake syncskill fixtures prove the end-to-end control path; the
existing full suite's registered flakes and failures must be reported by
name, not summarized as green.

Required focused evidence:

- The symlink discovery probe is reproducible without a model request and
  asserts that the skill appears under `.agents/skills` with temporary
  `HOME`/`CODEX_HOME`.
- Unit tests cover: a pre-existing `.agents/skills/legacy/SKILL.md` survives
  byte-for-byte; unrelated children remain; a selected-name collision
  refuses before Codex starts and preserves the original; parent symlinks
  refuse without following them; partial setup cleans only owned leaves;
  stale links to the current run snapshot are recovered and removed; foreign
  links are preserved and refused.
- ccloop tests prove Codex receives the same skills during plan, execute, and
  verify, then sees no generated links before attempt publication. Claude's
  existing `skillPluginDir` path and no-skill argument goldens remain intact.
- Orca tests prove Codex skill declarations pass kind checking, select
  `codexSkillsDir`, retain the existing lock, and preserve the absent-field
  envelope golden for runs without skills.
- Existing ccloop protocol, Orca control, scheduler, panel, dependency-pin,
  workspace, and full-suite gates run only in isolated clones. A real Codex
  paid acceptance is not part of this design round.

## 5. Risks and limits

- The Codex symlink discovery result is measured on 0.160.0 only. The isolated
  probe must run against the supported Codex version used for acceptance; if
  symlink discovery changes, pause and revise the design before relying on
  copy-based fallback behavior.
- Name collisions with repository-provided skills are intentionally refused
  rather than shadowed. A later design may add an explicit precedence rule,
  but this feature will not infer one.
- An abrupt process crash can leave links in an abandoned worktree. They point
  only to the run-specific read-only snapshot and are removed with that
  worktree; recovery must confirm cleanup before any attempt commit is
  published.
- This work does not close the pre-existing visibility of user-global Codex
  skills. It adds only the task's frozen skills and does not change global
  discovery.

## 6. Human review

Please review the design above. Implementation planning starts only after this
written spec is approved; the plan will be a separate review gate.
