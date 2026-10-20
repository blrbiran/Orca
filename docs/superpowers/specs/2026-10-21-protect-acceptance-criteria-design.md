# Allow agents to change tests, and make weakened acceptance criteria visible — design

- **Author:** controller of Orca session `308b874c` (2026-10-20/21), from a brainstorming conversation with the human.
- **Status:** design; not yet planned. Ledger: `.superpowers/sdd/2026-10-20-session-308b874c/progress.md`.
- **Related:** `docs/handoff/goal.md` §1.3/§1.4; `2026-10-20-kanban-and-group-orchestration-design.md` §9a (the
  `flagged` state on landed decisions is defined there and reused here).

## 1. Intent

Two needs, one design. The human earlier (session 3d229487): "orca 执行 group / task 时是都要允许改必要的 test 文件。否则很多改法都太受限了，或者只是一种workaround。"
And the risk (from the qoder analysis): ccloop runs the required checks **in the worktree the agent changed**, so an agent
that cannot fix a bug can make the check green by editing the test (`expect(true)`), deleting it, or turning the test
script into `exit 0`; an LLM verifier may not notice and the task lands as passed.

Rulings (this session, quoted):
- Test changes are allowed. When only the modified checks pass, or assertions were deleted/weakened: "可以先落地，不要block住，但是需要标红提醒人 review".
- A change that only adds tests: "不用提示，否则信息太多人反而不会看".
- An automatic reviewer judges a flagged change first: "同意加这个逻辑，但是这个逻辑也要能被关闭".

## 2. Goals, non-goals, anti-goals

**Goals**
1. Agents may change test files, test scripts and check scripts as part of a task.
2. Orca detects, by code, when a landed task's checks only pass because the checks changed, or when they were weakened,
   and flags it (red) after landing — never blocks.
3. Pure additions to tests produce no notice at all.
4. A flagged change is first judged by an automatic reviewer agent (switchable off); only unclear cases reach the person.

**Non-goals**
- Blocking or rejecting a landing because tests changed.
- A model deciding whether tests changed or got weaker (Rule 5): detection is code; the model only judges *justification*.
- Changing ccloop (this is all Orca-side, at landing).

**Anti-goals**
- Notifying the person about ordinary test growth (information overload — human).
- Silently reverting an agent's test change.

## 3. Which files define the checks (code-detected)
For a task, the **check-defining files** are:
1. files named by the contract's required check commands (path-like tokens resolved inside the repo);
2. test files matched by the repo's test configuration (vitest/jest `include`, `*.test.*`, `*.spec.*`, `tests/`,
   `__tests__/`) — read from config when present, else the default patterns;
3. `package.json` `scripts` (only the scripts object), and CI config files (`.github/workflows/*`).
Builder decides the exact resolution and records it; the set is computed from the task's base, not from the agent's tree.

## 4. Detection at landing (Orca side)
When a task's attempt changed any check-defining file (diff base..attempt):
1. **Classify the change by code:**
   - *Additive*: only new test files, or only added lines/test cases in existing test files, no deleted or modified lines
     in assertions, no `scripts` change ⇒ **no notice** (goal 3). Stop here.
   - *Weakening signals* (any ⇒ flag): fewer assertions in a modified test file (count `expect(`/`assert` calls — the
     builder fixes the counting rule per language and records it); added `.skip`/`.only`/`.todo`/`xit`/`it.skip`;
     a deleted test file; a test/check script in `scripts` replaced by a no-op (`exit 0`, `true`, `echo …` only) or
     removed; a required check's command target file deleted.
   - Otherwise *modified* (assertions changed, not obviously weaker).
2. **Base-version re-run** (for *modified* and *weakening*): overlay the base versions of the changed check-defining
   files onto the attempt's tree in a scratch worktree and run the required checks the way Orca already runs repro
   commands (`src/control/debugRepro.ts`: `sh -lc`, inherited env, as Orca, outside ccloop's sandbox).
   - Base-version checks also pass ⇒ the tests were extended/refactored and the code satisfies the old criteria too ⇒
     **no notice** (unless a weakening signal fired).
   - Base-version checks fail ⇒ "only the modified checks pass" ⇒ **flag**.
   - Base version cannot run (the old test references removed code the task legitimately deleted) ⇒ treat as *modified*
     and flag only if a weakening signal fired; record why.
3. **Flag** = write a major decision with `flagged` state (kanban spec §9a): question "Tests changed so the checks pass",
   the agent's stated reason (from its reported decisions / taskResult, if any), the test diff, which signal fired, and
   the base-version run result. Landing is not delayed.

Cost: the base-version run happens only when check-defining files were *modified* (not for pure additions or untouched
tests). Builder bounds it with the task's check timeout.

## 5. Automatic reviewer (switchable, default on)
- On each flag, Orca dispatches a reviewer agent (single call) with the flag's evidence and the task's goal.
- Verdict *justified* (the behaviour change requires the new criteria) ⇒ the flag is downgraded to a plain record
  (not red, not counted as needs-you).
- Verdict *not justified* ⇒ Orca opens a correction automatically (system-generated, so it starts without a click —
  kanban spec §9a item 3) whose debug task restores the stronger criteria and fixes the code.
- Verdict unclear / reviewer failed ⇒ the flag stays red for the person.
- A setting turns the reviewer off (per project, and a global default). Off ⇒ every flag stays red for the person.
- The person can always ratify (clear the flag) or correct, as for any flagged decision.

## 6. Constraints
- Rule 5: classification and the base-version decision are code; the model only judges justification.
- Rule 9: each detection rule gets a red-first test and a named mutation; include a must-flag and a must-not-flag sample
  set (the scanner lesson: a detector needs both).
- Rule 17: scratch worktrees under Orca's existing run/workspace roots; no new out-of-repo paths.

## 7. Left to the builder
- Assertion counting per language (start with JS/TS; others ⇒ only the file-level and script signals apply, recorded).
- Where the reviewer setting lives; the reviewer's prompt and answer schema (strict, bounded).
- How the agent's stated reason is extracted.
- Interaction with reconcile: a reconciliation that touches check-defining files goes through the same detection.

## 7a. Decisions after the builder check (controller's calls, session 308b874c, reversible)
1. **Where and when:** detection and the base-version re-run happen **before landing, in the run's own workspace**
   (`drive.sourceDir/repo`, where dependencies are installed), in `stepC` next to the debug repro check, with a
   crash-recovery marker like `debugRepro: checking`. Landing is delayed by the check time but never waits for a person.
   (§4's "scratch worktree" and "at landing" are corrected by this.) Commands = `verification.requiredChecks`, executed
   the way `debugRepro.ts` executes (`sh -lc`, inherited env, as Orca), each bounded by `executionPolicy.perAttemptTimeoutMs`.
2. **Storage:** the ledger is append-only and `.strict()`; the flag and its downgrade live in the control DB (the kanban
   plan builds the `flagged` state first; this plan comes after it). The decision row written at landing (`codeAuthored`)
   carries a short `evidence` string; the test diff and base-run output are stored as an artifact referenced from it.
3. **"Not justified" opens a debug task directly, not a correction row.** A correction stays a person's act (keeps the
   memory layer free of system-written rows). The same applies to the kanban spec's integration-check and model-review
   findings (kanban spec §7 corrected accordingly).
4. **Ambiguous base run** (fails vs cannot run — not distinguishable by exit code): **flag** (strict); the automatic
   reviewer downgrades justified cases. `package.json`: only the `scripts` object is reverted to base for the re-run.
5. **No loop:** a debug task whose purpose is restoring stronger criteria is exempt from automatic re-correction — if its
   own change is flagged, the flag goes to the person. Its reproduce-first check accepts modified (not only added) test
   files.

## 8. Open (not blocking)
- Thresholds (e.g. assertion count drop of 1 already flags) — start strict, revisit with data.

## 8. As-built (session 9ec98639, 2026-10-21; builder's calls, reversible — human ruling for this round: "这一轮执行过程中如果有问题，先按你的建议执行")

Built (`src/control/criteriaProtection.ts`, landing step D in `src/control/driverLanding.ts`):
- **Where:** at landing (step D), from git alone: `base..attempt` of the run, in the landing worktree. Detection is a few
  `git diff`/`git show` reads, so it runs inline; nothing is delayed beyond them and nothing is blocked.
- **Check-defining files (§3):** a path-like word of a required check command (`node check.js` ⇒ `check.js`), a test file
  by shape (`tests/`, `test/`, `__tests__/`, `spec/`, `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.*`), any
  `package.json` (only its `scripts` object counts), `.github/workflows/*`. The repository's own test configuration is
  not read in this version.
- **Classification (§4.1):** `additive` (new files, or only added lines, no new skip) ⇒ no notice; weakening signals —
  `deleted:<path>`, `fewer-assertions:<path>:<n>-><m>` (JS/TS `expect(` and `assert…(`/`assert x` counted per file),
  `skip-added:<path>` (`.skip`/`.only`/`.todo`, `xit`/`xdescribe`/`xtest`, `@pytest.mark.skip`, `t.skip(`),
  `script-removed:<file>#<name>`, `script-no-op:<file>#<name>` (`exit 0`, `true`, `:`, `echo …`); anything else
  `modified`.
- **Flag (§4.3):** weakening or modified ⇒ the run's ledger gets a code-authored major `criteria` decision
  `<runId>/orca-criteria` (signals and files as evidence, undo = restore the files from the run's base) and the landing's
  own write flags it (`source: test-change`, by `orca-auto`); crash-safe like pending decisions (staged as
  `stagedCriteriaFlag` before the swap, written by the landing's write).

Not built yet (each would only *reduce* flags or move them off the person; until then every flag stays red for the person,
which is the reviewer-off behaviour §5 already defines):
- **§4.2 base-version re-run** (needs the run's own workspace with dependencies before cleanup, §7a.1, with a restart
  marker like `debugRepro`); without it a `modified` change is flagged (the strict reading §7a.4 gives an ambiguous case).
- **§5 automatic reviewer** (a single call with a strict schema; justified ⇒ ratify as `orca-auto`, not justified ⇒ a
  system debug group `criteria-review`, system debug task spec 2026-10-21) and its on/off setting.
- **Reconciliation path (§7):** a reconcile run's own changes to check-defining files are not classified yet (step R).
