# Requirement review for folder and multi-directory groups (#337, logic half) — design

- **Who:** a design subagent (Claude Opus 5.5) spawned by Orca control session `3ba26002`, 2026-11-19. It read Orca
  `main` at `4f53a087` in the worktree `/Users/biran/code/skills/orca/.wt-spec-337` (branch `docs/spec-337`). No code
  was changed and no test was run. Every `file:line` below was measured at `4f53a087` with `grep -n` / `sed -n` on that
  tree; re-measure before citing (Rule 14).
- **Status:** design, not built. The human has agreed to the direction (rulings below). The controller should review
  it before a plan is written.
- **Scope:** the requirement review (`src/control/requirementReview.ts`) for **folder (`dir`) groups** and
  **multi-directory groups**. Repository groups do not change, except for one prompt sentence (§6) and the shared
  "done with a note" surfaces (§5), which #377 will reuse.

## 1. Human rulings (verbatim)

1. #337, session `543e800e` (ledger `.superpowers/sdd/2026-11-18-tester-pm/progress.md:17`):
   「orca 设计的初衷就是不要卡在人这里。可以派agent审。不要卡在」 (the message was cut there).
2. This session (`3ba26002`), 「同意」 to the controller's reading of (1): **folder and multi-directory groups get an
   agent review; a review that does not pass gets the same automatic fix rounds as a repository group's review; a
   review still not passed after those rounds is shown as a problem but does NOT block done.**
3. This session, #377, 「同意」: **a criterion that fails only because the base was already red is a relative pass;
   the group carries a note and reaches done.** This spec must stay consistent with that ruling (§5.4).
4. This session: 「这次批准改写所有必要的判据」 (criteria rewrites for this change are approved; listed in §11).
5. Earlier, session `4389b15f`: 「#337 done 门不改只改文案」. This design keeps it. The done gate still lets these
   groups through. What changes is that a review now runs and that its outcome is shown.

## 2. What happens today (measured at `4f53a087`)

| Fact | Where |
|---|---|
| The review pass writes `{state:"not-run", why:"multi-repo"\|"dir"}` for a multi, dir or dir-flow group and never claims a call | `requirementReview.ts:280-285` |
| `not-run` counts as satisfied for the done gate | `requirementReviewRecord.ts:57`, used by `groupEdges.ts:103` |
| Group acceptance is `not-run` (tip `null`) for the same groups: "a known gap: no single tree to check" | `groupAcceptance.ts:31`, `:176-178`; `groupAcceptanceRecord.ts:85-86` |
| A dir group's work lives in a git **vault** (`flow-vault-<vaultId>`): base = an import of the folder (`refs/orca/group/<g>/base`, create-only), work branch `orca/<g>` in the vault, placement copies the landed tip into the folder | `dirGroup.ts:49-61`, `requirementExport.ts:69-80`; DIR spec `2026-10-24-dir-project-requirements-design.md` §2, §6.4, §8 |
| The vault import leaves out files over 50 MiB (500 MiB a snapshot) and `.git/`, `node_modules/`, `.DS_Store`. It lists them, but the control plane does not keep that list | `src/flow/vault/snapshot.ts:22,49`; `vault.ts:25`; `grep -rn overCap src/control` finds nothing |
| A multi group has no single repository (`groupRepoId` throws `multi-dir-group-no-single-repo`). Each member is a **dir target** (its repo, or its folder's vault) with its own `orca/<g>` | `dirGroup.ts:53`; `multiGroup.ts:117-122`; multi spec `2026-10-24-multi-dir-projects-design.md` §2 |
| A multi run records each written directory's base on `drive.dirs[] = {key, targetRepo, base, workspacePath}` | `executionDriver.ts:655-657` |
| A multi task's per-directory `writes` sit on its work item. A task without them is blocked at A2 (`multi-dir-writes-missing`) | `requirementRecords.ts:255-268`; `executionDriver.ts:574-575` |
| `appendConfirmedTaskInTransaction` (the fix task) writes no `writes` field | `groupTaskAppend.ts:30-88` |
| The review's tip waits: `accepted.tip !== tip` and `state==="fixing" && accepted?.tip !== tip` | `requirementReview.ts:294-295` |
| `reviewFacts` says "Delivery: none configured -- the work stays on orca/<group>" when there is no integration record (true of dir and multi groups, which deliver by placement / multi landing) | `requirementReview.ts:436-438` |
| The prompt's `fixableBy` text says "changing files in the repository" | `requirementReview.ts:157` |
| The tester's prompt point 3 ("binary file you cannot see" example) is already gone: `grep -c "binary file you cannot see" src/control/requirementReview.ts` → `0` | `requirementReview.ts:156`; pinned by `tests/control/requirementReviewDelivery.test.ts:91` |
| Overview precedent for a row that is shown but is not "needs you": `acceptance-warning` | `src/panel/controlOverview.ts:126-128` |

## 3. Design in one paragraph

Remove the `not-run` branch for dir and multi groups. A **folder group** is reviewed exactly like a repository group,
in its vault. Before = the folder copy Orca imported when the work started (the group's base), after = the vault's
`orca/<g>`. A **multi-directory group** is reviewed in one call whose prompt has one labelled section per directory:
that directory's changed files and diff between its base and its tip. Evidence paths are written `<key>:<path>`. The
automatic fix rounds are the existing ones (`MAX_AUTO_FIX_ROUNDS = 2`, S5 `fixableBy` routing). A multi fix task gets
per-directory `writes`. Any review of these groups that ends not passed is saved as a new **satisfied** state,
`noted`. It does not block done. It is shown as a warning-tone problem row and note (card, brief, `group show`,
`orca status`, Web). It is not counted as "needs you". External artefacts stay out of scope. No backfill.

## 4. Evidence the reviewer sees

### 4.1 Folder group (a)

- **Repository:** `deps.resolveRepository(groupRepoId(...))`, which is already the vault (`dirGroup.ts:56-57`).
  **Base:** `groupBaseCommit` (first work run's `drive.base`, as today). **Tip:** `workBranchTip` of the vault.
  `groupChanges` (`:476`) runs unchanged. It gives the change list (status, path, bytes, sha256, binary facts from
  `binaryFacts.ts`, as today) and the unified text diff. For text files, the diff shows the before and after
  contents of every changed line, and the whole content of a new file. Unchanged files are not shown, as in a
  repository.
- **Heading** (in place of `The group's diff against its base:`, for a folder group only):
  `The folder's changes: before = the copy of the folder Orca took when the work started; after = the work Orca will place into the folder:`
- **Fact line** added to "What Orca recorded beyond the diff":
  `Orca's copy of the folder leaves out files over 50 MiB, and .git/, node_modules/ and .DS_Store; a criterion about such a file cannot be judged from this review.`
  The numbers are read from `DEFAULT_CAPS` / `DEFAULT_EXCLUDES`, never typed in.

### 4.2 Multi-directory group (b)

- **Per directory, in registered order (`multiDir.dirs`):**
  - **base_k** = the `base` of `drive.dirs[]` entry `k` on the group's first work run (rowid order) that wrote `k`.
    This is the same rule `groupBaseCommit` uses for one repository.
  - **tip_k** = `refTip(<dir target k>, orca/<g>)`.
  - A directory that no run wrote, or where `base_k === tip_k`, gets the one line `Directory <key>: no changes.`
  - A missing `orca/<g>` gets `Directory <key>: Orca's work branch is gone; not shown.` No acceptance-style
    missing-branch record is written.
- **Section per changed directory:** `Directory <key> (<repository | folder>): files changed and diff, before = <base_k
  short>, after = <tip_k short>:`, followed by that directory's `groupChanges` output (file list and diff). A folder
  member's section also carries §4.1's fact line once.
- **Evidence form:** every file evidence is `<key>:<path>`. The three record pseudo-paths (`orca:acceptance`,
  `orca:delivery`, `orca:delivered-acceptance`) are matched **as exact strings first**, so a member keyed `orca` does
  not collide unless its file is literally named `acceptance` and so on. That case is registered as a known edge
  (§10 O4). `classifyReviewOutput` takes an optional `dirKeys`. When it is given, a non-pseudo evidence path without a
  known `<key>:` prefix is `invalid: evidence-dir:<path>` (code, Rule 5).
- **Round identity:** `ReviewRound.tip` stays a string (the primary's tip). The round and the call identity gain
  optional `tips: Record<key, sha>`. `prepare` reads the tips from the identity, not from the live refs, so the
  prompt shows what the round was claimed for.

### 4.3 External artefacts (c): out of scope

- **Why:** (1) No contract field declares an external artefact today, so there is nothing to carry. (2) A reference
  a task reports without a check Orca runs is the agent's claim. The reviewer cannot tell it from a fabrication, and
  Orca does not make up the other side's observation (handoff §5.2.8). (3) The command that would verify it (network,
  credentials) is exactly what group acceptance does not run for these groups (`not-run`).
- **Effect today:** such a criterion is `cannot-judge`, `fixableBy: person`. For a folder or multi group it becomes a
  `noted` review (§5) and the group finishes. For a repository group it stops as today.
- **Direction left open (not designed):** a task declares `artefacts: [{ref, verify: <command>}]`, and the group
  acceptance's recorded exit enters the prompt as an `orca:artefact:<ref>` record.

### 4.4 Shared prompt lines for both kinds

- The acceptance fact line (`:431`) for a `not-run` acceptance of these groups reads:
  `Acceptance: not run -- Orca runs no group-wide check on a folder or multi-directory group; each task's own checks ran on its attempt.`
- The delivery line (`:436-438`) for these groups reads:
  `Delivery: Orca places the work into the person's folder or branches by itself; this review judges Orca's work branches, not the person's folder or branches.`
  The review does **not** wait for placement or the multi landing (`deliverySettled` is skipped; it needs one
  repository).

## 5. Outcomes, fix rounds and "done with a note"

### 5.1 The record

- `ReviewState` gains **`noted`**: the review ended not passed and Orca did not stop on it. `why` keeps the existing
  `ReviewWhy` (`rounds-exhausted`, `not-fixable-by-work`, `cannot-judge`, `invalid`, `failed`, `unfunded`,
  `check-conflict`).
- **One choke point:** `saveReview` (`requirementReview.ts:215`) saves a `not-passed` review of a dir or multi group
  as `noted`, with the same `why` and rounds. Every path that writes `not-passed` today goes through it: claim-time
  unfunded `:305`, unprepared `:378`, check-conflict `:611`, `settleNotPassed` `:623-639`. So no path can miss it.
  Repository groups are untouched.
- `SATISFIED` (`requirementReviewRecord.ts:57`) adds `noted`. `not-run` stays in the set for old records (§9).

### 5.2 Fix rounds (unchanged rules)

- Each not-met round goes through `settleNotPassed` as today: S5 routing (`work` only), at most
  `MAX_AUTO_FIX_ROUNDS` (2) automatic fix tasks, `autoFixTokenCeiling`. Only the end state differs (`noted`).
- **Tip waits:** the two waits at `:294-295` apply only when group acceptance runs on the group. Otherwise a fix in
  a folder group would wait forever for an acceptance tip that is always `null`. With acceptance `not-run`, a new
  round is due when the fix task is done (`roundDue`), as for any group.
- **Folder fix task:** `fixTaskContract` / `openFixTask` work unchanged in the vault. The fix lands on the vault's
  `orca/<g>`, and placement carries it into the folder (DIR §8).
- **Multi fix task:**
  - `writes` per directory: each `<key>` the unmet findings name (evidence `<key>:<path>`, and `<key>:<path>` tokens
    in `missing`) gets those paths. When nothing is named, every directory any task wrote gets the union of its
    tasks' `targetPaths`, mirroring `fixTaskContract`'s single-repository fallback (`:694`). `checks` for a
    directory = the union of that directory's `writes[].checks` across the group's tasks.
  - The ccloop primary is the first written directory in registered order. Its `checks` must be non-empty (multi
    spec §6.1). Otherwise the fix is refused `failed` with detail `multi-fix-checks:<key>`, and the review ends
    `noted`.
  - The contract is built by the same per-directory expansion an accepted multi task gets (multi spec §6.2,
    `expandMultiSplitDraft`). `AppendTaskInput` gains optional `writes`, stored on the work item so `stepA2Multi`
    can dispatch it.
  - `fixTaskPaths` keeps its single-repository behaviour. A multi variant splits the paths by key first.

### 5.3 Where it shows (and where it does not)

| Surface | Change |
|---|---|
| `requirementReviewRecord.ts` | new `reviewNote(review)` → `requirement-review-noted:<why>` for `noted`, else null (§5.4 adds #377's case); `reviewProblem` unchanged (only `not-passed`) |
| `webProtocol.ts:1793-1795` | state enum adds `noted`; the summary's `requirementReview` gains optional `note` (the code) |
| `controlViews.ts:880` | fills `requirementReview.note`; `groupProblemOf` (`:706-712`) unchanged, so `groupProblem` stays null and `orca status` "needing you" (`status.ts:95`) is not raised |
| `controlOverview.ts:135-136` | a row of a **new kind `review-note`**, not in `PROBLEM_KINDS` (the `acceptance-warning` precedent `:126-128`), destination the group's Problems region, tone `warn` |
| `group brief` / `group show` (`verbs.ts:397`) | `review: noted (<why>)`, `note: requirement-review-noted:<why>`, `next:` from `reviewAnswers` restricted per §5.5 |
| `orca status` | one more fact, `N done with a review note`, only when N > 0 |
| Web | card chip and the group's Problems region show the note in `data-tone="warn"`; the review panel's state label `noted` (en/zh, `locales/en.ts:928`, `zh.ts:768`) |

### 5.4 Consistency with #377 (relative pass)

- Both rulings mean "done, with a note the person can read". They share **one reader** (`reviewNote`), **one row
  kind** (`review-note`), the same tone, and the same done-gate meaning (satisfied).
- #377's own spec decides how a relative pass is recorded. The suggested form is a `passed` round whose `relative`
  lists the criterion ids, with `reviewNote` answering `requirement-review-relative:<ids>`. #377 adds a case to
  `reviewNote` and to the locale strings; it does not add a second surface. This spec does not build #377.

### 5.5 The person's verbs on a `noted` review

- `review-accept` is accepted on `noted` as on `not-passed` (`requirementReviewCommands.ts:22-27`). It turns the
  review into `accepted` and the note goes away.
- `review-rerun` and `review-fix` stay refused on `noted` (`requirement-review-not-open:noted`). The group may
  already be `done`, and reopening a done, possibly delivered group is a separate decision (open question Q2). The
  `next:` lines are `review-accept` and "open a new requirement on the project for further work".

## 6. Prompt changes (the tester's three points)

| Tester point | Verdict | Change |
|---|---|---|
| 1. The opening frames everything as diff evidence | **Mostly done** (delivery tail D4 line `:120-121`). Adopt the rest | Headings per kind (§4.1, §4.2). Repository groups keep `The group's diff against its base:` byte for byte (pinned by `tests/control/requirementReview.test.ts:85`, `requirementReviewPrepare.test.ts:34`) |
| 2. Evidence forms: path without line, artefact hash, command + exit, external ref | **Adopted except external ref** | `path` + `line:null` and `orca:acceptance` already exist (`:154`). Multi adds `<key>:<path>`. External ref is rejected (§4.3) |
| 3. Drop "binary file you cannot see" from cannot-judge | **Already done** (measured, §2) | none |

The one repository-visible change is `:157`: "changing files in the repository" becomes "changing files in the
repository (or, for a folder group, the folder)". "a fact outside the repository" stays. The response schema does
not change.

Not adopted: extracting PDF/docx text (`binaryFacts.ts:3-5` already explains why), and steering by requirement
classification (the evidence depends on the group's kind, not on the requirement's kind).

## 7. Bounds

- **Diff bytes:** `REVIEW_DIFF_MAX_BYTES` (200,000) per call, as today. For a multi group, each directory with
  changes gets `floor(200000 / n)` bytes (n ≤ 8, `multiGroup.ts:63`). Each cut section ends with
  `(Directory <key>: the diff was cut at <m> bytes; the rest was not shown to you.)`. An equal share is used so one
  large directory cannot hide the others.
- **Files:** no new bound on the file list, as for repository groups (#334 measured a 2,449-file list working). Each
  blob read keeps the 256 MiB `REVIEW_GIT_LIST_MAX_BYTES` bound. A larger blob fails `prepare`, the call is
  `failed`, and the review ends `noted` for these groups.
- **Past the bound:** what was cut is said in the prompt. A criterion that depends on it is `cannot-judge` and ends
  `noted`.

## 8. Flow groups

Out of scope. A flow group has no `requirement` block, so `reviewRequired` is false
(`requirementReviewRecord.ts:51-55`) and the pass never reaches the `isDirFlowGroup` arm. That arm stays as it is,
narrowed to `isDirFlowGroup` alone (Rule 3).

## 9. Migration

- **No backfill.** A group that already has `not-run` keeps it. It stays satisfied, and `roundDue` is false for it,
  so no call is claimed.
  - Those groups are finished, and in most cases placed or landed.
  - A review now could open a fix task on finished work and spend tokens nobody asked for.
  - The 「done 门不改」 ruling already accepted them.
- The Web label for `not-run` changes to: "not reviewed (finished before Orca reviewed folder or multi-directory
  groups)" / 「未复核（该组在 Orca 开始复核文件夹和多目录组之前就已完成）」.
- A dir or multi group that has no review record when the new code starts is reviewed normally.
- No schema migration. The record lives in the group body JSON, and `noted` only adds an enum value.

## 10. Alternatives considered, objections

**Alternatives**
- A1. *Make `not-run` / `noted` block done.* Rejected by ruling 2.
- A2. *A multi review as one call per directory.* Rejected. A criterion often spans directories (e.g. "the docs folder
  describes the API change"). n calls cost n grants, and the outcome has to be one verdict per criterion.
- A3. *A schema field `evidence.dir`.* Rejected. It changes the strict response schema for every group, and every
  repository answer would carry `dir:null`. The `<key>:` prefix only touches multi groups, and code checks it.
- A4. *Snapshot the real folder for "after".* Rejected. The vault's `orca/<g>` is what placement writes. The live
  folder can hold the person's own edits (DIR §9 drift).
- A5. *Opt-in `review-rerun` on old `not-run` records.* Deferred. It needs a reviewed path back out of `done` (Q2).

**Objections and answers**
- O1. *"A noted review is a quiet failure."* It is a row in Problems, a warn chip, a status count and a `group show`
  line. It is not counted as "needs you", because nothing waits on a person (ruling 2). That is the Rule 12 balance
  that `acceptance-warning` already strikes.
- O2. *"The fix rounds now spend tokens on folder groups that used to be free."* The bound is the same as for
  repository groups (2 rounds, `autoFixTokenCeiling`), and ruling 2 asks for it.
- O3. *"Placement may write the folder before the review passes."* Yes. The review judges the work branch, and a fix
  lands and is placed again. A repository group's delivery also comes before its review (`deliverySettled`).
- O4. *"A member keyed `orca`."* Exact-string matching keeps the three pseudo-paths apart. A real file literally at
  `acceptance`, `delivery` or `delivered-acceptance` in a member keyed `orca` would be read as the record. This is a
  registered known edge, not fixed (Rule 2).
- O5. *"`saveReview` mapping hides a state change inside a writer."* It is the one place every `not-passed` write
  passes through, so no path can miss it. Its test (§11, M1) kills the mapping and shows the folder group stuck red.

## 11. Acceptance criteria (each a command; exit 0 = pass)

Fixtures: the dir-group world of `tests/control/dirRequirementExport.test.ts` and
`tests/control/fixtures/multiLandingWorld.ts`, with `ORCA_VAULT_DIR` and every other out-of-repo path redirected to a
temp dir (Rule 17). Fake single-call answers only, no paid call.

| # | Command | Intent | Mutation that must turn it red (Rule 9) |
|---|---|---|---|
| C1 | `npx vitest run tests/control/requirementReviewDir.test.ts` | A followup-G dir group with all tasks done claims a review call (not `not-run`). The prompt has the folder heading, the fact line and a PNG line with its pixel size. A not-met `work` answer opens `review-fix-1` whose run targets the vault. Three not-met rounds end `noted`/`rounds-exhausted`. `prerequisiteDone` is true | M1: drop the dir/multi mapping in `saveReview` (red: `not-passed`, done blocked). M2: keep the `:294-295` waits for dir groups (red: no round 2) |
| C2 | `npx vitest run tests/control/requirementReviewMulti.test.ts` | A repo+folder multi group: one call, two labelled sections each with its own diff, `tips` in the identity. Evidence without `<key>:` is `invalid`. A not-met finding on `docs:guide.md` opens a fix task whose work item has `writes:[{dir:"docs",…}]` and is dispatched (not `multi-dir-writes-missing`). Equal diff share per directory | M3: base_k from the primary's base for every key (red: wrong diff). M4: omit `writes` on the fix (red: A2 block) |
| C3 | `npx vitest run tests/control/requirementReviewNoted.test.ts` | A repository group with the same rounds still ends `not-passed`. `noted` is satisfied, `not-run` stays satisfied. `review-accept` works on `noted`; `review-rerun` / `review-fix` are refused `requirement-review-not-open:noted`. An existing `not-run` dir record claims nothing | M5: map every group (red on the repository case). M6: drop `noted` from `SATISFIED` |
| C4 | `npx vitest run tests/panel/reviewNoteRow.test.ts` | The overview has a `review-note` row, not counted as needs-you. `groupProblem` is null and `requirementReview.note` is set. `group show` prints the note and `next:` | M7: emit it as `task-attention` (red: needs-you) |
| C5 | `npm --prefix web exec vitest run tests/requirementReviewPanel.test.tsx` | `noted` and the new `not-run` labels in en and zh | — (string test) |
| C6 | `npx vitest run tests/control/requirementReview.test.ts tests/control/requirementReviewPrepare.test.ts tests/control/requirementReviewDelivery.test.ts tests/control/requirementReviewFix.test.ts` | Repository-group prompts and fixes unchanged except the `:157` sentence | — |
| C7 | `npm test` (quick tier, Rule 18), then `npm run test:wide` at the merge | gate | — |

**Existing criteria to rewrite (approved, ruling 4):**
- `web/tests/requirementReviewPanel.test.tsx:96-107`: asserts the old `not-run` label "not reviewed (Orca cannot
  review folder or multi-repository groups yet)" and 「未复核（Orca 暂时还不能复核文件夹或多仓库的任务组）」. Rewrite it
  to the §9 labels, keeping the `not.toContain("tree")` / `代码树` assertions.
- No other test asserts the dir/multi `not-run` review. Measured with
  `grep -rn -E "multi-repo|state: \"not-run\"" tests web/tests`: the remaining hits are acceptance records
  (`groupShowAcceptance.test.ts:43`, `fullSuiteUnsetLabel.test.ts:40`), which do not change. The implementer
  re-measures, and reports any further red as a candidate rewrite. They must not edit it silently.

## 12. Corrections to published specs (pointers only; append there, never edit)

- `2026-11-12-tester-followup-g-design.md` §3 Behaviour 5–6: for folder and multi groups, "stops in Problems" /
  "done only when passed or accepted" becomes "ends `noted`, done" (this spec §5).
- `2026-11-17-delivery-tail-design.md:47` (Non-goals, "unchanged: `not-run`") and `:241-242` (the `not-run` Web
  label): superseded by §4 and §9.
- `2026-11-17-stuck-runs-and-impossible-fixes-design.md` S5 (`:110-112`, "`work` = changing repository files"):
  the prompt wording now includes the folder (§6). Routing is unchanged.
- `src/control/groupAcceptance.ts:31` is a code comment, not a spec. The implementer updates it in place.

## 13. Rule 17

Nothing new is written outside the repository. The review reads the vault (`$ORCA_VAULT_DIR`, already registered in
DIR spec §14). Fix tasks write the vault and the person's folder only through the existing task, landing and
placement paths, which the DIR and multi specs already register. Every new test redirects `ORCA_VAULT_DIR`, the
control state and the projects file to temp dirs.

## 14. Open questions for the human

- **Q1.** Every non-pass outcome of a folder or multi group ends `noted`, including `invalid`, `failed` and
  `unfunded`, where the review never really judged the work. This is the plain reading of 「不要卡在」. The
  narrower reading would keep those three stopping as today. The design takes the plain reading; it is reversible.
- **Q2.** On a `noted` review, should `review-rerun` / `review-fix` be allowed, which would reopen a possibly done
  and delivered group? The design says no (accept only) until a reviewed "reopen a done group" path exists.
