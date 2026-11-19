# Requirement review for folder and multi-directory groups (#337, logic half) — design

- **Who:** a design subagent (Claude Opus 5.5) spawned by Orca control session `3ba26002`, 2026-11-19.
  - The first draft, commit `969e02ec`, read `main` at `4f53a087`.
  - **This revision (r2)** answers an independent review that the controller relayed, and the controller's
    decisions on it (§15). It reads the #377 branch `fix/g-review` at `b7db89c9`
    (worktree `/Users/biran/code/skills/orca/.wt-g-review`), which lands first (§15 D1).
  - Every `file:line` below was measured on `b7db89c9` with `grep -n` / `sed -n`. Re-measure before citing (Rule 14).
  - No code was changed and no test was run.
- **Status:** design, not built. The direction is agreed by the human (§1). r2 must be reviewed before a plan is written.
- **Scope:** the requirement review (`src/control/requirementReview.ts`) for **folder (`dir`) groups** and
  **multi-directory groups**. Repository groups do not change, except for one prompt sentence (§6).

## 1. Human rulings (verbatim)

1. #337, session `543e800e` (ledger `.superpowers/sdd/2026-11-18-tester-pm/progress.md:17`):
   「orca 设计的初衷就是不要卡在人这里。可以派agent审。不要卡在」. The message was cut off there.
2. This session (`3ba26002`), 「同意」 to the controller's reading of (1):
   - folder and multi-directory groups get an agent review;
   - a review that does not pass gets the automatic fix rounds, as a repository group's does;
   - a review still not passed after those rounds is shown as a problem but **does NOT block done**.
3. This session, #377, 「同意」: a criterion that fails only because the base was already red is a relative pass. The
   group carries a note and reaches done. #377 has been built on `fix/g-review`; §5.4 says how this spec relates to it.
4. This session: 「这次批准改写所有必要的判据」. The criteria rewrites this needs are approved; they are listed in §11.
5. This session, on the review of r1: 「先按你的建议执行」. The controller's decisions in §15 are made under it and
   are reversible.
6. Earlier, session `4389b15f`: 「#337 done 门不改只改文案」.
   - **What changes for the done gate:** for these groups it now **waits while the review runs and its fix tasks
     run**. Today it never waits, because `not-run` is satisfied at once.
   - **What stays:** the wait is narrowed and never permanent. Every review of these groups ends in a satisfied state
     (`passed`, `accepted` or the new `noted`), and no path leaves one waiting on a person (§5.1, §5.6).
   - The human approved this narrowing with ruling 2.

## 2. What happens today (measured at `b7db89c9`)

### 2.1 Review state and group kinds

| Fact | Where |
|---|---|
| The review pass writes `{state:"not-run", why:"multi-repo"\|"dir"}` for a multi, dir or dir-flow group and never claims a call | `requirementReview.ts:280-285` |
| `not-run` counts as satisfied | `requirementReviewRecord.ts:64` (`SATISFIED`), used by `groupEdges.ts:103` |
| Group acceptance is `not-run` (tip `null`) for both kinds. The code comment calls it "a known gap: no single tree to check" | `groupAcceptance.ts:31`, `:176-178`; `groupAcceptanceRecord.ts:85-86` |

### 2.2 Folder groups and the vault

- A dir group works in a git **vault**:
  - the base is an import of the folder (`refs/orca/group/<g>/base`, create-only);
  - the work branch is `orca/<g>` in the vault;
  - placement copies the landed tip into the folder.
  - Where: `dirGroup.ts:49-61`, `requirementExport.ts:69-80`; DIR spec `2026-10-24-dir-project-requirements-design.md` §2, §6.4, §8.
- The import (`importSnapshot`, `snapshot.ts:28-63`) leaves these out:
  - any file over 50 MiB, and anything past 500 MiB in total (`snapshot.ts:22,49`);
  - files `--exclude-standard` drops (`.gitignore`d) and the vault's `DEFAULT_EXCLUDES` `.git/`, `node_modules/`,
    `.DS_Store` (`snapshot.ts:32`, `vault.ts:25`);
  - nested repositories and special files (`snapshot.ts:41,48`);
  - `DIR_EXCLUDES` `/.decisions/` (`dirWorkspace.ts:25,67`).
- The control plane keeps no list of what was left out: `grep -rn overCap src/control` finds nothing.
- The vault's `orca/<g>` also holds Orca's own files:
  - the `.decisions/` ledger (DIR §10);
  - the requirement document a dir group's export commits on its base (`requirementExport.ts:166`).
- Placement may withhold paths (`placement.withheld`, `dirGroup.ts:85`).

### 2.3 Multi groups

| Fact | Where |
|---|---|
| A multi group has no single repository: `groupRepoId` throws `multi-dir-group-no-single-repo` | `dirGroup.ts:53` |
| Each member is a dir target with its own `orca/<g>` | `multiGroup.ts:117-122` |
| A multi run records each written directory's base on `drive.dirs[]` | `executionDriver.ts:655-657` |
| A multi task's `writes` live on its work item; a task without them is blocked at A2 (`multi-dir-writes-missing`) | `requirementRecords.ts:255-268`; `executionDriver.ts:574-575` |
| A2 blocks `multi-dir-contract:<key>` unless the contract's `additionalRepos` keys equal the written non-primary keys. A2 replaces every `repoPath` with its own workspace | `executionDriver.ts:617-628` |
| The contract's `repoKey` is present exactly when `additionalRepos` is; `additionalRepos` holds 1–7 entries `{key, repoPath, targetPaths(min 1), allowlistPaths?, denylistPaths?, requiredChecks?}` | `src/scheduler/planFile.ts:201-226` |

### 2.4 Fix tasks

- `fixTaskContract` (`requirementReview.ts:718-750`) spreads the source task's archived context (`:740`). Its fallback
  write set is the union of every task's `context.targetPaths` (`:729`), which are primary-only for a multi task. Its
  checks are the group's `acceptanceCommands` union (`:737`), which mixes every task's primary checks. A multi fix task
  built this way would block at A2.
- `appendConfirmedTaskInTransaction` writes no `writes` (`groupTaskAppend.ts:30-88`).
- `fixTaskPaths` drops every path starting `orca:` (`requirementReview.ts:762`). The token grammar of
  `missingTextPaths` (`:779`) has no `:`.
- #377 on this branch:
  - clamps the automatic fix grant by the group's remainder (`openFixTask` `:821-836`, `autoFixTokenCeiling`);
  - records `round.relativePass` (`requirementReviewRecord.ts:32-39`; `relativePasses` `requirementReview.ts:472-494`);
  - shows it in `reviewLines` (`verbs.ts:337-405`) and in the Web `data-relative-pass` block (`RequirementReviewPanel.tsx:70-75`).

### 2.5 The review pass's waits, failure paths and prompt

- **Waits:** the acceptance-tip waits are at `requirementReview.ts:294-295`, and `deliverySettled` at `:298` needs
  one repository.
- **Missing work branch:** `workBranchKnownMissing` → `continue` (`:289`). `recordWorkBranchMissing` overwrites the
  acceptance record with `not-run: work-branch-missing` (`groupAcceptance.ts:114-117`). After that, a dir group gets
  no review record and is never done.
- **Claim-path throws** are caught and logged once, then retried every round (`requirementReview.ts:317-321`).
  Examples: `requirement-review-profile` (`:243`, via `reviewerOf` `:309`), `requirement-review-criteria-missing`,
  `requirement-review-base-missing`.
- **Paths that write `not-passed`:**

  | Line | Path | Activity it writes |
  |---|---|---|
  | `:305` | claim-time unfunded | `:306` |
  | `:378` | unprepared | `:379`, with the literal `state:"not-passed"` |
  | `:642` | check-conflict | `:644`, `state: next.state` |
  | `settleNotPassed` `:655-672` | every other not-passed round, through `:641` | `:644` |

- **A second call for the same round:** `askReviewAgain` (`:550`) claims it with identity `{roundNo, tip}` (`:559`).
- **Prompt:** the repository diff heading is at `:147`, the `fixableBy` "repository" sentence at `:157`, and the
  delivery line at `:436-438`.
- **Tester's prompt point 3 is already done:** `grep -c "binary file you cannot see" src/control/requirementReview.ts`
  gives `0`, and `tests/control/requirementReviewDelivery.test.ts:91` pins it.
- **Web panel:** the buttons show only on `not-passed` (`RequirementReviewPanel.tsx:77`), and the tone at `:36`.
- **Overview precedent** for a row that is shown but is not "needs you": `acceptance-warning`
  (`controlOverview.ts:126-128`, `PRIORITY` `:17-20`, `PROBLEM_KINDS` `:53`).

## 3. Design summary

**Folder group:**
- reviewed like a repository group, in its vault;
- before = the folder copy imported when the work started;
- after = the vault's `orca/<g>`, with Orca's own files filtered out.

**Multi-directory group:**
- reviewed in one call, with one labelled section per directory;
- evidence is written `<key>:<path>`.

**Fix rounds:** the existing ones, as #377 left them.
- A multi fix task is built from stored records only, with per-directory `writes`, `repoKey` / `additionalRepos` and
  per-directory checks.

**When a review of these groups does not pass** (including a missing work branch and a claim that cannot be made),
it ends in a new satisfied state, `noted`:
- shown as a warn-tone `review-note` row and note;
- not counted as "needs you";
- not a done blocker.

**Also:**
- #377's relative pass keeps its own surface.
- External artefacts are out of scope.
- No backfill.

## 4. Evidence the reviewer sees

### 4.1 Folder group (a)

**Repository, base, tip:**
- Repository: `deps.resolveRepository(groupRepoId(...))`, which is already the vault (`dirGroup.ts:56-57`).
- Base: `groupBaseCommit`.
- Tip: `workBranchTip`.

**`groupChanges`** (`:500`) runs as today:
- the change list with status, bytes, sha256 and `binaryFacts`;
- the unified diff. For text it shows the before and after content of every changed line and the whole of a new file.
- Unchanged files are not shown.

**Filtered out of the change list and the diff** (via the pathspec `:(exclude)` on both git calls):
- `.decisions/`
- the requirement document's path, `requirement.export.path`

These are Orca's files, not the work. **Repository groups are not filtered** (Rule 3).

**Heading** (a folder group only, in place of `The group's diff against its base:`):
`The folder's changes: before = the copy of the folder Orca took when the work started; after = the work Orca will place into the folder:`

**Fact lines** (in "What Orca recorded beyond the diff"; the numbers and lists are read from `DEFAULT_CAPS`,
`DEFAULT_EXCLUDES` and `DIR_EXCLUDES`, never typed in):
- `Orca's copy of the folder leaves out: any file over 50 MiB and anything past 500 MiB in total; files the folder's .gitignore excludes; .git/, node_modules/, .DS_Store; nested repositories and special files; .decisions/. A criterion about such a file cannot be judged from this review.`
- When `placement.withheld` is not empty:
  `Placement withheld these paths from the folder (they are in the work below but not in the person's folder): <paths, at most STOP_KEPT>`.
  Withheld paths stay in the diff, because the work did produce them. The fact line lets a criterion about the
  folder's final content be judged correctly.

### 4.2 Multi-directory group (b)

**Per directory, in registered order:**
- `base_k` = the `drive.dirs[]` base for `k` on the group's first work run (rowid order) that wrote `k`. This is
  `groupBaseCommit`'s rule.
- `tip_k` = `refTip(<dir target k>, orca/<g>)`.
- No run wrote `k`, or `base_k === tip_k`: one line, `Directory <key>: no changes.`
- Missing `orca/<g>` in `k`: `Directory <key>: Orca's work branch is gone; not shown.`. No acceptance record is written.
- §4.1's filter and fact lines apply to a folder member, and the `.decisions/` filter to the primary.

**Section heading per changed directory:**
`Directory <key> (<repository | folder>): files changed and diff, before = <base_k short>, after = <tip_k short>:`

**Evidence `<key>:<path>`:**
- Classification is code (Rule 5), done in this order:
  1. The three record pseudo-paths `orca:acceptance`, `orca:delivery` and `orca:delivered-acceptance` are matched as
     exact strings.
  2. Every other path is split on its **first** `:`. The left part must be a known member key; the right part is the
     path.
- `classifyReviewOutput` takes an optional `dirKeys`. When it is given, a path that fails step 2 is
  `invalid: evidence-dir:<path>`.

**Call identity:**
- The claim identity and the call contract gain `tips: Record<key, sha>` (§15 D3: **not** on `ReviewRound`).
- `round.tip` is the primary's `tip_k`. When the primary's `orca/<g>` is missing, it is the first member in registered
  order that has one. The export creates every member's `orca/<g>` (multi spec §6.4), so this is a fallback only.
- `prepare` reads the tips from the identity.
- `askReviewAgain` (`:550-559`) copies `tips` from the failed run's identity into its new claim.
- `closeUnpreparedReview` (`:355-380`) needs no tips, because it records only `round.tip`.

### 4.3 External artefacts (c): out of scope

**Why it is out of scope:**
- No contract field declares an external artefact.
- An unverified reference is only the agent's claim. Orca does not make up the other side's observation (handoff §5.2.8).
- The command that would verify it is the group acceptance, which these groups do not run.

**What happens to such a criterion now:** it is `cannot-judge`, `fixableBy: person`. For these groups that ends
`noted` (§5).

**Direction left open:** a task declares `artefacts: [{ref, verify}]`, and the recorded exit becomes an
`orca:artefact:<ref>` record.

### 4.4 Shared lines for both kinds

**Acceptance line** (`:431`), when the acceptance is `not-run` with `why` `dir` / `multi-repo`:
`Acceptance: not run -- Orca runs no group-wide check on a folder or multi-directory group; each task's own checks ran on its attempt.`

**Delivery line** (`:436-438`) for these groups:
`Delivery: Orca places the work into the person's folder or branches by itself; this review judges Orca's work branches, not the person's folder or branches.`

**No wait on delivery:** `deliverySettled` (`:298`) is skipped for them.

## 5. Outcomes, fix rounds and the note

### 5.1 `noted`

- **The state:** `ReviewState` gains `noted` (`requirementReviewRecord.ts:40`). It keeps the existing `why`.
  `SATISFIED` (`:64`) adds `noted`. `not-run` stays satisfied for old records (§9).
- **The mapping:** the predicate is **`isDirGroup(store, groupId) || isMultiGroup(store, groupId)`**, never the
  record's `why`. One function, `settledReview(store, groupId, review)`, turns `not-passed` into `noted` under that
  predicate. It is applied **before** both the `saveReview` and the `recordActivity` at every not-passed site:
  - claim-time unfunded, `:305` / `:306`;
  - unprepared, `:378` / `:379`; its literal `"not-passed"` becomes `next.state`;
  - check-conflict and `settleNotPassed`, through `:641-644`;
  - the new sites of §5.6.

  Activity rows therefore say `noted` too.
- **Repository groups are untouched.** Their reviews still save `not-passed` exactly as today.

### 5.2 Fix rounds (rules unchanged)

**Routing is as built on `fix/g-review`.**
- `settleNotPassed` sends `work` criteria to a fix, as S5 does, and skips relative passes (#377).
- At most `MAX_AUTO_FIX_ROUNDS` (2) automatic rounds.
- The grant is clamped by the group's remainder (`openFixTask`, #377).

**Tip waits:**
- `:294-295` and `deliverySettled` `:298` run only when **not** `isDirGroup || isMultiGroup`.
- For these groups a round is due when the fix task is done (`roundDue` `:247`).
- **Repository groups keep both waits**: there is a converse criterion in §11.

**A fix task that fails or is blocked** follows the ordinary task escalation.
- The review stays `fixing`, and `tasksDone` holds the next round.
- The group shows the task's problem, as for any task. This is a task waiting, not the review stopping.

**Folder fix:** `fixTaskContract` / `openFixTask` are unchanged. The fix works in and lands on the vault, and
placement carries it into the folder.

### 5.3 The multi fix task (store-only builder)

`settleNotPassed` cannot call `expandMultiSplitDraft`, because that needs `ccloopBin`, `runsDir` and resolved paths
(`requirementSplit.ts:486`). A new `multiFixTask(store, groupId, scope, ...)` builds the fix from stored records only.

**1. Writes per key.**
- Source: each unmet finding's paths, classified per key by the I-4 steps (§5.4b).
- Fallback when no finding names a path: for each key that some task wrote, the union of that key's stored
  `writes[].targetPaths` across the group's tasks (`taskWrites`).
- `checks_k` = the union of `writes[].checks` for `k` across the group's tasks, minus the `baseRed` command as
  `fixTaskContract` already removes it (`:733-736`).

**2. Primary.**
- The primary is the first written key in registered order.
- Its `checks` must be non-empty (multi spec §6.1). Otherwise the fix is refused `failed`, detail
  `multi-fix-checks:<key>`, and the review ends `noted` (§5.1).

**3. Contract.**
- Start from the source task's archived contract, as `fixTaskContract` does: objective, goal, `setupCommands` and
  safety policy.
- Then overwrite:
  - `context.targetPaths` = the primary's paths;
  - `verification.requiredChecks` = the primary's `checks`;
  - `context.repoKey` = the primary key;
  - `context.additionalRepos` = one entry per other written key: `{key, repoPath, targetPaths, allowlistPaths: targetPaths, requiredChecks: checks_k}`.
- `repoPath` comes from any archived contract in the group that names that key: its `context.repoPath` when it is
  that task's primary, else its `additionalRepos[].repoPath`. A2 replaces it anyway (`executionDriver.ts:626-628`).
- When only one key is written, both `repoKey` and `additionalRepos` are dropped, as for a one-directory task
  (multi spec §6.1).
- The allowlist and denylist are those of the primary alone (`fixTaskAllowlist` over the tasks whose primary is that key).

**4. Recording it.**
- `AppendTaskInput` gains optional `writes`, stored on the work item.
- `openFixTask` passes it, so `stepA2Multi` finds it (`executionDriver.ts:574`).

### 5.4 Paths from findings (I-4)

**a) `fixTaskPaths` stays as it is for non-multi groups.**

**b) Multi groups use `multiFixPaths(unmet, keys)`:**
1. Drop the three pseudo-paths by **exact match** (not by the `orca:` prefix). A member keyed `orca` keeps its
   `orca:<path>` paths.
2. **Evidence:** split on the first `:`. The left part must be a known key; the right part must pass the same
   checks as `missingTextPaths`: `targetShapeOk`, no segment starting with `-`, not `**`.
3. **`missing` text:** the token grammar is extended to `<key>:<path>`.
   - A backticked span, or a bare run of `[A-Za-z0-9._-]+:[A-Za-z0-9._/*-]+`, whose left part is a known key.
   - The right part goes through `missingTextPaths`'s existing rules.
   - A token with no known key is ignored.

### 5.5 Where `noted` shows (I-1, I-2: these are separate from #377's surface)

| Surface | Change |
|---|---|
| `requirementReviewRecord.ts` | `reviewNote(review)` → `requirement-review-noted:<why>` for `noted`, else null. `reviewProblem` is unchanged |
| `webProtocol.ts:1794` | the state enum adds `noted` |
| `webProtocol.ts:1793-1812` | the strict `requirementReview` object gains optional `note` (non-empty string) |
| `webProtocol.ts:1896` | the overview step `kind` enum adds `review-note` |
| `web/src/controlTypes.ts:740` | the state union |
| `controlTypes.ts` `RequirementReviewV1` | `note?` |
| `controlTypes.ts:1298` | the step kind union |
| `controlViews.ts:880` | fills `requirementReview.note`. `groupProblemOf` (`:706-712`) is unchanged, so `groupProblem` stays null |
| `controlOverview.ts:135-136` | adds a `review-note` row: destination the group's Problems region, tone `warn` |
| `controlOverview.ts:17-20` | `PRIORITY` gets `review-note: 4`, the same as `acceptance-warning` |
| `controlOverview.ts:53` | `review-note` is **not** in `PROBLEM_KINDS` |
| `web/src/overviewModel.ts:60` | `review-note` is added to the priority-1 list beside `acceptance-warning` |
| `locales/en.ts:261`, `zh.ts:110` | step labels: "Read review note" / 「查看复核备注」 |
| `locales/en.ts:928`, `zh.ts:768` | state label `noted`: "review not passed; the group finished anyway (folder or multi-directory group)" / 「复核未通过；该组仍已完成（文件夹或多目录组）」 |
| `verbs.ts:402` (`reviewLines`) | `review: noted (<why>)`, `note: requirement-review-noted:<why>`, the last round's criteria lines, and `next:` per §5.7 |
| `RequirementReviewPanel.tsx:36` | tone `warn` for `noted` |
| `RequirementReviewPanel.tsx:77` | only the Accept button for `noted` (§5.7) |

`orca status` does not change (§15 D4).

**#377 is separate (§15 D2).** As built, it records `round.relativePass`, and `reviewLines` and the Web
`data-relative-pass` block (`RequirementReviewPanel.tsx:70-75`) show it. Its round result is `passed`, so the group
reaches done without a row. Neither surface reads the other's field.
- `reviewNote` covers `noted` only.
- A round of a folder or multi group never has a `relativePass`, because #377 needs a `passed-relative` acceptance and
  these groups have none.

### 5.6 Missing work branch and claim-path throws (I-3, I-6)

**Missing work branch.**
- For these groups, the review pass does not call `recordWorkBranchMissing`, and does not consult
  `workBranchKnownMissing` (`:289-291`), so the acceptance record is never overwritten.
- A folder group whose vault `orca/<g>` is gone saves a `failed` round with summary `the work branch orca/<g> is gone`.
  It ends `noted` (§5.1).
- In a multi group, each missing member's section says so (§4.2). Only when **every** member's branch is gone does the
  round end `failed` → `noted`.

**Claim-path throws.**
- For these groups, a `ControlError` with code `recovery-blocked` thrown while claiming ends the review: a `failed`
  round, `noted`, with the error's detail as the summary. Such errors are deterministic, for example
  `requirement-review-profile`, `-criteria-missing` and `-base-missing`.
- The decision is made by error class, in code (Rule 5).
- Any other error, such as a lock or a git failure, keeps today's retry with one log line (`:317-321`).
- A `noted` review gets no new round, so the group never waits on a person for its review.

### 5.7 The person's verbs on `noted` (a change)

- **`review-accept` is newly accepted on `noted`.** `notPassed()` (`requirementReviewCommands.ts:22-27`) admits
  `noted` for accept only. Accepting makes the review `accepted` and the row goes away.
- `review-rerun` and `review-fix` stay refused with `requirement-review-not-open:noted`. Reopening a group that may be
  done and delivered is a separate decision (Q2).
- `next:` offers `review-accept`, then "open a new requirement on the project for further work".

## 6. Prompt changes (the tester's three points)

| Point | Verdict | Change |
|---|---|---|
| 1. The prompt frames all evidence as a diff | Mostly done already (delivery tail D4, `:120-121`) | Headings per kind (§4.1, §4.2). Repository groups keep `The group's diff against its base:` byte for byte (`tests/control/requirementReview.test.ts:85`, `requirementReviewPrepare.test.ts:34`) |
| 2. Evidence forms | Adopted, except "external ref" | `path` + `line:null` and the `orca:*` records already exist (`:154`). Multi adds `<key>:<path>`. External ref is rejected (§4.3) |
| 3. Drop "binary file you cannot see" | Already done (§2.5) | none |

**Sentence change at `:157`:** "changing files in the repository" becomes "changing files in the repository (or,
for a folder group, the folder)".

**Not adopted:**
- PDF/docx text extraction (`binaryFacts.ts:3-5`).
- Choosing the strategy from the requirement's class.

## 7. Bounds

**Diff:** `REVIEW_DIFF_MAX_BYTES` (200,000) per call.
- A multi group gives each changed directory `floor(200000 / n)` bytes, where n ≤ 8 (`multiGroup.ts:63`).
- Each cut section ends with `(Directory <key>: the diff was cut at <m> bytes; the rest was not shown to you.)`.
- The share is equal, so one large directory cannot hide the others.

**Files:** no new bound on the list (parity with repository groups).
- Each blob read keeps the 256 MiB limit.
- A blob over it fails `prepare`. The round is `failed` and the review ends `noted`.

**Past a bound:** the prompt says what was cut. A criterion that depends on it is `cannot-judge` and ends `noted`.

## 8. Flow groups

Out of scope.
- A flow group has no `requirement`, so `reviewRequired` is false (`requirementReviewRecord.ts:58-62`).
- The `:280` branch is narrowed to `isDirFlowGroup` only (Rule 3).

## 9. Migration

**No backfill.** An existing `not-run` record stays satisfied, and `roundDue` is false for it.
- Those groups are finished.
- A review now could open fix tasks nobody asked for.
- The 「done 门不改」 ruling accepted them.

**Web label for `not-run`:** "not reviewed (finished before Orca reviewed folder or multi-directory groups)" /
「未复核（该组在 Orca 开始复核文件夹和多目录组之前就已完成）」.

**A group with no review record yet** is reviewed normally.

**No schema migration:** the change adds enum values and optional fields in the group body JSON.

## 10. Alternatives considered and objections

**Alternatives**
- A1. Let the review block done. Rejected by ruling 2.
- A2. One call per directory. Rejected:
  - criteria span directories;
  - it would cost n grants;
  - the verdict per criterion must be single.
- A3. An `evidence.dir` field in the response schema. Rejected: it changes the strict schema for every group.
- A4. Snapshot the live folder for "after". Rejected: placement writes the vault tip, and the folder may hold the
  person's own edits.
- A5. An opt-in `review-rerun` on old `not-run` records. Deferred to Q2.
- A6. One shared note surface with #377. Rejected by §15 D2: #377 is a pass and is already built.

**Objections**
- O1. "`noted` is a quiet failure."
  - Answer: it is a Problems row, a warn tone and a `group show` line.
  - It is not "needs you", because nothing waits on a person. This is the `acceptance-warning` balance.
- O2. "Fix rounds now cost tokens on folder groups."
  - Answer: the bound is the same as for repository groups, clamped by #377.
  - Ruling 2 asks for it.
- O3. "Placement may write the folder before the review passes."
  - Answer: yes. A fix lands and is placed again.
  - A repository group's delivery also comes before its review.
- O4. "A member keyed `orca`."
  - Answer: exact-match classification keeps it (§5.4).
  - The only edge left: a real file named exactly `acceptance`, `delivery` or `delivered-acceptance` at the root of a
    member keyed `orca` reads as the record. This is a registered known edge.
- O5. "The mapping is hidden in a writer."
  - Answer: it is one named function applied before both the save and the activity at each listed site.
  - M1 kills it.

## 11. Acceptance criteria (each a command; exit 0 = pass)

### 11.1 Fixtures and gate

**Fixtures:**
- the dir-group world of `tests/control/dirRequirementExport.test.ts`;
- for multi: `tests/control/multiDirDispatch.test.ts`'s world, which reaches `prepared:true` at A2;
- fake single-call answers.

**Redirects:** `ORCA_VAULT_DIR`, the control state and the projects file go to temp dirs (Rule 17). No paid call.

**Rule 9:** each new branch is killed by its own mutation, and the mutation is seen red.

### 11.2 New criteria

**C1 `npx vitest run tests/control/requirementReviewDir.test.ts`** — folder review, fixes, filters and fact lines

| Asserts | Killed by |
|---|---|
| A dir group claims a review call instead of writing `not-run` | M1: drop `settledReview` for dir groups (red: `not-passed`, never done) |
| Prompt: the folder heading, both fact lines (exclusions; withheld paths when set), and a PNG pixel line | M8: drop the exclusion fact line. M9: drop the withheld line |
| The change list has no `.decisions/` and no requirement document | M10: drop the `:(exclude)` pathspecs |
| A not-met `work` finding opens `review-fix-1` in the vault | M2: keep `:294-295` for dir groups (red: no round 2) |
| Three not-met rounds end `noted` / `rounds-exhausted`, with activity `state:"noted"` | M11: map after `recordActivity` (red: activity says `not-passed`) |
| `prerequisiteDone` is true at the end | — |

**C2 `npx vitest run tests/control/requirementReviewMulti.test.ts`** — multi review and the multi fix task

| Asserts | Killed by |
|---|---|
| A repo+folder multi group makes one call with two labelled sections, each with its own base and diff, and `tips` in the identity | M3: `base_k` = the primary's base for every key |
| `askReviewAgain` carries `tips` into its new claim | M12: drop `tips` from the re-ask |
| Evidence without `<key>:` → `invalid: evidence-dir:` | M13: skip the `dirKeys` check |
| Equal diff share with a per-directory cut line | M14: one shared 200,000-byte cut (red: the second directory is unseen) |
| `deliverySettled` is not called for multi (no `multi-dir-group-no-single-repo` throw logged) | M15: call it for multi |
| A not-met finding on `docs:guide.md` gives a fix work item with `writes:[{dir:"docs",…}]` | M4: omit `writes` (red: `multi-dir-writes-missing`) |
| The fix run reaches `prepared:true` with the expected `additionalRepos` keys and per-key `requiredChecks` | M16: keep the source context (red: `multi-dir-contract:<key>`) |
| A finding on `orca:notes.md` in a member keyed `orca` is kept | M17: filter by the `orca:` prefix |
| `missing` text `` `docs:guide.md` `` is read | M18: no `<key>:` token grammar |

**C3 `npx vitest run tests/control/requirementReviewNoted.test.ts`** — repository groups unchanged, every other
not-passed site maps

| Asserts | Killed by |
|---|---|
| A repository group with the same rounds still ends `not-passed` | M5: map every group |
| `noted` is satisfied | M6: drop `noted` from `SATISFIED` |
| Claim-time `unfunded` ends `noted` for a dir group | M19: the `:305` site unmapped |
| An unprepared `failed` round ends `noted`, with activity `noted` | M20: the `:378-379` site unmapped |
| A missing vault `orca/<g>` ends `noted` and leaves the acceptance record `not-run: dir` | M21: call `recordWorkBranchMissing` (red: the acceptance is overwritten, never done) |
| A `requirement-review-profile` throw ends `noted` | M22: keep the retry for `recovery-blocked` |
| `review-accept` is accepted on `noted`; rerun and fix are refused | M23: admit `noted` for rerun |
| An existing `not-run` record claims nothing | — |

**C4 `npx vitest run tests/control/requirementReviewAcceptanceGate.test.ts tests/control/requirementReviewCommands.test.ts tests/control/requirementReviewShapeRetry.test.ts`**
- Converse: repository groups still wait for the acceptance tip.
- Killed by M24: drop the `:294-295` waits for all groups.

**C5 `npx vitest run tests/panel/reviewNoteRow.test.ts`**
- The overview has a `review-note` row that is not needs-you; `groupProblem` is null; `requirementReview.note` is set;
  `group show` prints the note and `next:`.
- Killed by M7: emit the row as `task-attention`.

**C6 `npm --prefix web exec vitest run tests/requirementReviewPanel.test.tsx`**
- A `noted` panel shows the warn tone, the `noted` label in en and zh, and exactly one button (Accept).
- The new `not-run` label.
- Killed by M25: render the `not-passed` buttons for `noted`.

**C7 `npx vitest run tests/control/requirementReview.test.ts tests/control/requirementReviewPrepare.test.ts tests/control/requirementReviewDelivery.test.ts tests/control/requirementReviewFix.test.ts tests/control/requirementReviewRelativePass.test.ts tests/control/requirementReviewFixFunding.test.ts`**
- Repository prompts, fixes, #377's relative pass and its clamp are unchanged except for the `:157` sentence.

**C8 gate:** `npm test` (quick tier); `npm run test:wide` at the merge.

### 11.3 Existing criteria to rewrite (approved, ruling 4)

- **`web/tests/requirementReviewPanel.test.tsx:112-124`** (line numbers on `b7db89c9`) asserts the old `not-run`
  labels in en and zh.
  - Rewrite it to the §9 labels.
  - Keep the `not.toContain("tree")` / `代码树` assertions.
- **Candidate rewrites, which run only in `test:wide`:**
  - `tests/control/dirRequirementE2E.test.ts`;
  - any multi end-to-end test that drives a followup-G requirement group to done.

  These now claim a review call, and need a fake answer or a review record. The implementer measures the actual reds
  and reports each one. Nothing is edited silently.
- **Unaffected** (acceptance records, not reviews), measured with `grep -rn -E "multi-repo|state: \"not-run\"" tests web/tests`:
  - `tests/commands/groupShowAcceptance.test.ts:43`;
  - `tests/panel/fullSuiteUnsetLabel.test.ts:40`;
  - `web/tests/groupAcceptanceProblem.test.tsx:78`.

## 12. Corrections to published specs (pointers only; append there, never edit)

- `2026-11-12-tester-followup-g-design.md` §3, items 5–6. Append after #377's Correction (`:613`): folder and multi
  groups end `noted` and are done.
- `2026-11-17-delivery-tail-design.md:47` and `:241-242`: superseded by §4 and §9.
- `2026-11-17-stuck-runs-and-impossible-fixes-design.md` S5 (`:110-112`). Append after `:222`: the prompt wording now
  includes the folder.
- `2026-10-24-multi-dir-projects-design.md`: a review fix task gets `writes` from §5.3, not from a split.
- `src/control/groupAcceptance.ts:31` is a code comment, not a spec. The implementer updates it in place.

## 13. Rule 17

- **No new writes outside the repository.** The review reads the vault (`$ORCA_VAULT_DIR`, DIR spec §14).
- **Fix tasks** write only through the existing task, landing and placement paths.
- **Tests** redirect every out-of-repo path to temp dirs.

## 14. Open questions for the human

- **Q1.** Every non-pass outcome of these groups ends `noted`: `invalid`, `failed` (including a missing branch or a
  `recovery-blocked` claim error) and `unfunded`. This is the plain reading of 「不要卡在」, and it is reversible.
- **Q2.** Should `review-rerun` / `review-fix` be allowed on `noted`? They can reopen a done, delivered group. The
  design says accept only.

## 15. Controller decisions on the r1 review (session `3ba26002`, 2026-11-19)

These are under 「先按你的建议执行」 and are reversible.

**Decisions**
- **D1.** Merge order: #377 (`fix/g-review`) lands first. This spec is measured on `b7db89c9` and builds on its
  `openFixTask` funding clamp and its `relativePass` round field.
- **D2.** I-1: two separate surfaces. `reviewNote` / `review-note` covers `noted` only. #377's relative pass stays as
  built (§5.5).
- **D3.** I-2: `tips` lives on the call identity and contract only, never on `ReviewRound`. Every strict schema or type
  touched is listed in §5.5.
- **D4.** Minor: no `orca status` count (Rule 2).

**Where each review finding is answered:**

| Finding | Answered in |
|---|---|
| C-1 | §5.3, C2 M16 |
| I-3 | §5.6, C3 M21 |
| I-4 | §5.4, C2 M17/M18 |
| I-5 | §11 M8–M25, C4 |
| I-6 | §5.2, §5.6, C3 M22 |
| Minors | §1.6, §4.1, §4.2, §5.1, §5.7, §11.3 |
