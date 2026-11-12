# Group acceptance runs the project's full suite — design (#279, #280)

- **Author:** implementer seat `accept-web` of Orca session `7e164691` (tester follow-up H), 2026-11-12, at Orca main
  `7c6e62f8`. Design given by the controller; this spec records it and the builder's reversible choices.
- **Status:** design; built in round H on branch `worktree-agent-a96d09e584f1c9e51`.
- **Human rulings (verbatim, this session):** 「方案A」 (no command set: acceptance runs as today and passes; Problems
  shows a warning) and 「人采纳才用。如果没设或人没采纳，就默认没有，不跑测试。」 (a detected command is only a
  suggestion; it runs only after a person adopts it).
- **Tester write-ups:** `orca_archived_files/issue-20261023.md` §Issue 279, §Issue 280 (group `dogfood-20261112-5`).

## 1. The problem

Group acceptance (`src/control/groupAcceptance.ts`, tester follow-up E §5) runs the union of the done tasks' required
checks on the group's final tip. Nobody runs the repository's whole test suite, so a group can be `done, acceptance
passed` with a regression between two tasks' areas (#279: 6/6 done, 8 focused checks green, the full suite red on a
behaviour no task's check touched). And because nothing else owned "all existing tests still pass", the split handed
that criterion to a documentation task that was told to change no code; it ran the suite four times and could fix
nothing (#280: 53 min, 25.9 M tokens, 42 % of the group).

## 2. The full-suite command is the integration-check command

The repository settings already hold `checks.integrationCheck.command` (checks spec 2026-10-22 §4.1): "the project's
integration command", run on a merged target *instead of* the landed groups' own checks. That is the same thing the
acceptance needs — one command that checks a merged tree whole — so acceptance reuses it, read the same way
(`effectiveChecks`: project > global > built-in `null`, under the global lock of §4.2), **independent of `enabled`**,
which keeps meaning only "the integration check's event trigger is on". No sibling setting: a second command with the
same meaning, security class (it runs in Orca's environment outside the sandbox) and lock would be two values that can
disagree about what "the project's tests" are.

## 3. Suggestion and adoption

- Code detects a suggestion (Rule 5) from the repository's checkout, first match wins: root `package.json` with a
  `scripts.test` that is not npm's placeholder (`no test specified`) ⇒ `npm test`; `pytest.ini`, or `pyproject.toml` /
  `setup.cfg` / `tox.ini` naming pytest ⇒ `pytest`; `go.mod` ⇒ `go test ./...`; `Cargo.toml` ⇒ `cargo test`. Nothing
  else; unreadable files suggest nothing.
- A suggestion is **never run**. It is shown (a) in the Checks settings of the project, next to the empty command, with
  **Adopt**, and (b) in the group's Problems warning (§5), also with **Adopt** for a person who may.
- Adopting is setting the command: the Web button and `orca check adopt` (CLI) send `set-check-settings` to the
  repository layer with `{kind: "integration-check", set: {command: <suggestion>}}` — the same verb, tier (`human-only`
  on the Web; a person token on the socket, as a custom command is) and lock rule as typing the command. No new verb.
- The read `GET /api/control/checks?repoId=` carries `suggestedCommand` (null for the global read, and when the
  effective command is set).

## 4. What acceptance runs

- **Unset** (no effective command): exactly as today (「方案A」). The record gains `fullSuite: {command: null,
  suggestion, exits: [], flaky: false}`.
- **Set:** the union first (setup, then checks, first red stops — unchanged); if it is green, the command once, in the
  same scratch worktree, with the same bound (the longest `perAttemptTimeoutMs`) and abort signal. If it exits non-zero
  it runs once more:
  - green on the retry ⇒ `passed`, `fullSuite.flaky: true`;
  - red twice ⇒ `failed`, the group is not done; the exits stay those of today (`recheck-acceptance`, waive, and the
    requirement review's fix path where it applies). No new exit.
  Both runs are appended to `commands` (named by the command) and their exits kept in `fullSuite.exits`.
- **When an acceptance is needed:** today at least two landed tasks. With a command set, at least **one**: the
  single-landing shortcut ("its own checks ran on that tree") does not hold for the suite. Builder's choice
  (reversible): otherwise a one-task group would be the one shape whose regression criterion nobody checks, once §6
  tells the split to leave such criteria to acceptance. The gate (`acceptanceSatisfied`) reads the setting for a group
  with no record yet, so a one-landing group waits for the run instead of being done before it.
- **The landing watch** (#269, `landingWatch.ts`) keeps running only the union. The suite is an end-of-group cost.

## 5. Problems

The group's Problems region shows, besides a failed acceptance (unchanged):

- a **warning** when the recorded acceptance ran with no command: "No full test suite ran at acceptance", with the
  suggestion when there is one and Adopt (owner, as the settings page);
- a **warning** when the suite was flaky: it failed once and passed on the retry, naming the command.

Neither counts as a blocking problem; neither keeps the group from done.

## 6. The split (#280)

- **Code:** `check-docs-only-suite` also refuses a repository-wide suite check (`runsRepositorySuite`, unchanged) on any
  task whose deliverable is a document — its plan (`loopPlan`, else by labels) is `design` ("The deliverable is a
  document; change no code.") or `investigate` ("…change nothing else"; builder's choice: the same can-not-repair
  reason) — whatever its target paths, so `README.md` + `test/readme.test.js` no longer slips through on the `.js`.
- **Instruction:** a new rule line (version stays 5: an added rule, as #130/#135/#136 kept theirs): a criterion that
  only asks that existing behaviour keep working across the repository ("all existing tests still pass") is checked
  by group acceptance on the final tree with the project's full-suite command; it is no single task's job — never
  trace it to a documentation or investigate task, do not add the repository-wide suite to a task's checks for it, and
  trace it to the tasks that change source. (Every criterion must still be traced: `untraced` is unchanged, and code
  cannot tell a regression criterion from another — Rule 5 — so this half is instruction only.)

## 7. Criteria (each seen red by a named mutation; table in the seat's `mutations.md`)

1. Unset ⇒ no suite run; the record names the suggestion; the Problems warning shows it.
2. A suggestion is not run until adopted; after adopting (the command set), the next acceptance runs it.
3. Set ⇒ the suite runs after the union, in the acceptance's scratch tree.
4. Red then green ⇒ `passed`, `flaky: true`.
5. Red twice ⇒ `failed`; the group is not done.
6. Landing watch unchanged (no suite command in its record).
7. A `design` task with `npm test` is refused `check-docs-only-suite` even with a `.js` target path.
8. Suggestion detection: each manifest kind, npm's placeholder, nothing.
