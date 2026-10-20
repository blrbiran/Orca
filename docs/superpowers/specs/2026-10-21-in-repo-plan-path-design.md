# Register an in-repository plan file from the panel (#65) — design

- **Author:** Track E implementer, Orca session `9ec98639` (2026-10-21). **Status:** design + as-built in the same round.
- **Rulings:** triage 2026-10-14 (`docs/handoff/2026-10-14-feedback-triage.md`, #65, human agreed): no browser upload —
  "计划带 check 命令，登记计划是信任边界 ⇒ 改为 owner 在 projects.json 里登记计划（路径限在项目仓库内、文件记哈希）".
  Session `308b874c`: "#65 UI registration of in-repo plan paths 同意" — the person registers the path from the UI; the
  real path must be inside the repository; the content hash is recorded; only git-tracked files are accepted.
  Session `9ec98639`: open choices decided by the implementer (§5).

## 1. Today (Orca main `9d874ed1`)

- A plan becomes importable only through a panel boot flag `--plan <planId>=<repoId>=<path>`
  (`src/panel/controlOptions.ts`), checked once by `createTrustedControlConfig` (`src/panel/controlConfig.ts`: absolute
  canonical path, no symlink component, a regular file, inside its repository) and re-validated (same inode) on every
  `resolveTarget`. Adding a plan means editing the service's run script and restarting the panel.
- The import form (`web/src/ControlPanel.tsx` `ImportForm`) lists `config.plans` of the chosen repository and says
  "no plan" when there is none.
- In file mode the project list lives in `~/.orca/projects.json` (`src/panel/projectsFile.ts`), written only by the
  registry (`src/panel/projectRegistry.ts`; atomic temp+rename, base-hash check, 0600/0700 for new files).

## 2. Design

1. **Stored with the project.** A project entry in `projects.json` gains an optional `plans` array of
   `{ id, path, sha256 }`: `path` is the plan file's path **relative to the project's directory** (POSIX separators, no
   `..` segment, not absolute), `sha256` the hex digest of the file's bytes when it was registered. Strict schema
   (unknown keys refused, ids unique across the file, paths unique per project). Absent ⇔ no plans (the file of a
   person who never registered a plan stays byte-identical).
2. **Register = trust this content** (`POST /api/projects/:id/plans { path }`, registry `addPlan`). In order:
   project known and running; control plane present (else `plans-need-control`); `path` relative and normalised;
   the joined path's **real path** is a regular file **inside the project's real path** (a symlink that leads out is
   refused: `plan-path-outside-project`); the file is **tracked by git** (`git ls-files --error-unmatch`, else
   `plan-not-tracked`); then the digest is taken, the control plane pre-checks the entry, the file is written, and the
   plan joins the running control config. Registering a path that is already registered **refreshes its digest**
   (the same id) — that is how the person trusts edited content.
3. **Import checks the digest.** The control config keeps each registered plan's digest; `resolveTarget`'s descriptor
   check reads the opened file and refuses with `control-plan-rejected` detail `plan-changed-since-registration` when
   the bytes differ. Boot-flag plans carry no digest and are unchanged.
4. **Boot and hand edits.** At boot every running project's plans are re-checked (inside, tracked) and joined; a plan
   that fails is skipped and named in the registry's `fileError` (the panel still boots). A plan whose digest no
   longer matches is still joined — import refuses it by name (3.), so the person sees why and re-registers. A hand
   edit of a running project's `plans` waits for a restart and is named in `pendingRestart` (`plans:<projectId>`); a
   project added by hand edit joins with its plans.
5. **UI.** The import form, when a single repository is chosen and the panel is in file mode, shows "Register a plan
   file in this repository" (a repo-relative path and a button). On success the config is re-read, so the plan appears
   in the plan list. Refusals show the registry's code and message.

## 3. Out-of-repo writes (Rule 17)

The only writer is the existing registry write of `projects.json` (already registered by the project registry spec):
same path, same atomic write, same modes; the new content is the `plans` array. Criteria run against a temporary
`projects.json` (the registry tests' `world()` and `ORCA_PROJECTS_FILE`).

## 4. Tests (red first; each with the mutation that must turn it red)

`tests/panel/projectPlans.test.ts` (registry with a real git repository) and `tests/panel/controlConfigPlans.test.ts`:
1. register a tracked file: written to the file with its digest, joined to control; a second registration after an
   edit refreshes the digest under the same id. Mutations: skip the write; mint a new id on re-register.
2. refusals, each by name and writing nothing: untracked file, path outside via `..`, absolute path, symlink leading
   out, directory, unknown project, no control plane. Mutations: drop the tracked check; drop the inside check.
3. boot joins filed plans and names a missing/untracked one in `fileError`; a hand edit of `plans` is pending restart.
   Mutations: skip boot join; apply hand edits live.
4. control config: a registered plan whose bytes changed is refused at import with the detail; unchanged imports.
   Mutation: drop the digest comparison.
5. route: `POST /api/projects/:id/plans` 201 with the plan; command-line mode 409 `projects-from-command-line`.
6. web: the import form shows the register control only for one chosen repository and calls the callback with the
   repo id and the trimmed path. Mutation: drop the callback call.

## 5. Decisions (implementer's calls, reversible)

- **File mode only.** Command-line mode (`--repo`/`--root`) refuses registration like project add/rename do; boot
  `--plan` flags keep working there.
- **Id** = `<projectId>.<slug of the relative path>` (de-duplicated with `-2`, `-3`, …), fixed at first registration.
  Display name = the relative path.
- **No removal endpoint** in v1 (a hand edit plus restart removes one; it is named in `pendingRestart`).
- **The digest is enforced at import, not at boot**, so a changed plan stays visible with a reason instead of
  silently disappearing.
- Tracked-ness is checked at registration and boot, not at import (the digest already pins the content the person
  trusted).
