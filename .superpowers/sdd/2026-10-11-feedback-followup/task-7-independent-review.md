# Task 7 independent spec and quality review

Reviewer: independent gpt-6.1-sol seat, 2026-10-11 Asia/Shanghai. No subagents. Product and shared Git review was read-only; this report is the sole shared-checkout write. Essential probes used a separate no-hardlink private clone, isolated HOME/XDG/TMPDIR/CCMEM, no CCMEM_CONFIG_PATH, existing dependencies, and fake providers only.

## Scope and source

Exact range: `f00bfdb797ee3f5de130585557fdf77dc421d535..be35141f778c2773ab75cd2af6be5901b027ee53`. Inspected immutable Git show/diff rather than newer working-tree edits. Independently recomputed HEAD's source-tree SHA256 as `89f7d125db6c9cca01cf0288959db8c663a0c888145dc630e4c7ce92fba5d357`, 932 files. All 47 committed product/source manifest hashes match HEAD; the range has 47 product/test/documentation paths plus 8 owned evidence paths. Diff whitespace check passes.

Read RTK, the requesting-code-review skill and template, full independent brief, Task7 brief/context, saved-result design including 6.1–6.14, token-policy design, global constraints/rulings, Task6 final interfaces, and Task7 committed report/interfaces/manifest/evidence/mutations/skip inventory. Task6 producer is separately approved `299da37f5b9781f79f530b871b37218a3cef7bec`, source `76f6212…`; this review does not reopen its unrelated implementation.

Human scope is completion/review of Task7 followed by local-main handoff. Tasks8–14 remain deferred. This report does not approve overall integration while the separately confirmed Task1 persistent captureRevision P2 is open.

## Strengths and specification assessment

- Admission uses actual owner database membership, latest/current lineage, frozen graph/target/derived contract and archived plan identity, known accounting/high-water, the existing validated owner receipt, and the existing ledger transaction. Async preparation is followed by fresh authoritative reads. The original failed source remains separately recorded.
- Fresh F/H is genuinely reserved under current all-dimensional group headroom/caps and exclusion. Recovery funding distinguishes legacy per-run authority from optional cumulative policy, binds allocation labels to the actual reservation tuple, uses safe `T=I+F`, and books new V rather than repeating I. The legacy native fixture authorizes spare limits before its original execution and uses the real owner settlement path.
- Private RPCs and strict mirrors preserve core protocol3 projections. Package/fence directories must be private and canonical; source aliases and copied bytes are hash validated. Revision changes revoke the recovery fence. Missing or ambiguous acceptance does not become zero usage. Mechanical settlement requires producer ownership/reaping proof; prepared pre-entry and known post-entry interruption qualify through explicit new authorization, while rejection/modification/known timeout do not.
- Section6.13's proof binds positive never-submitted state, real inspect(absent), a successful known-unspent handoff, exact latest inactive claim/envelope/reservation/funding, and one command-ledger consumption. The dedicated no-dispatch test now exercises actual scheduler delivery. Automatic checkpoint/resume paths are fenced.
- Schema12 is a marker-only 11→12 change. Genuine old10→immutable-f00/11→current12 preservation and actual old11 reopen refusal precede dispatch in the native fixture. Future-schema tests keep their unchanged-byte rejection predicates while moving their unsupported marker to13.
- The standard old detached result namespace stays unavailable; the positive legacy case explicitly archives the genuine runtime publication primitive. Current malformed capsules remain invalid under strict normalization, and transformed old Claude output remains unsupported. Those limits are qualified rather than fabricated away.

The implementation meets most of the scoped admission, accounting, ownership, migration and lineage requirements. A required ordinary-retry flow is broken by the new scheduler exclusion, and the new UI makes false availability claims. These are current Task7 defects, not missing deferred features.

## Findings

### I1 — P2: Explicit ordinary retry after a failed verification remains permanently unclaimable

**Location:** `src/control/webDispatch.ts:355–356`, with `src/control/savedResultNoDispatch.ts:32–36` and the normal retry effects in `src/control/retryTask.ts:150–163`.

**Trigger:** A genuine admitted saved-result verification ends in verifier rejection (also applicable by the same branch to modification or timeout); the caller explicitly issues `retry-task` and receives `task-retried`.

**Problem/impact:** The normal retry path correctly settles the recovery as historical, reserves the ordinary grant, and puts the task back in `ready`, preserving its recovery mode. The new scheduler guard rejects every recovery predecessor unless `hasSavedOrdinaryRetryAuthorization` passes. That helper recognizes only the special consumed no-dispatch proof with `outcome:'not-started'`; a lawful retry of a recovery that actually verified has no such proof. `nextClaimableTask` therefore returns null, replenishment creates no wake, and actual delivery remains idle. The accepted retry cannot execute, so the required ordinary retry after unsuccessful verification is stranded with reservations held.

**Independent witness:** Private clone `/private/tmp/t7-independent-review-be35141` at exact HEAD, with only an untracked reviewer test. A genuine schema10 migration/owner settlement/rejected fake-worker verification followed by explicit retry returned success, then `claimable:null`, `wakes:[]`, `delivered:{kind:'idle'}`; calls stayed `['plan','execute','verify']`. Intended business assertion failed, RC1, not infrastructure. Full raw read:

Exact command (authorized isolated native process-identity access):

```sh
rtk proxy python3 /private/tmp/orca-followup-run.py /private/tmp/t7-independent-review-be35141 task7-independent-retry01 env ORCA_SAVED_RESULT_VERIFY=1 ORCA_SAVED_RESULT_SCHEMA11_ROOT=/private/tmp/orca-t7-schema11-reader-20261011 ORCA_SAVED_RESULT_OLD_ORCA_ROOT=/private/tmp/orca-t7-schema10-producer-20261011 ORCA_SAVED_RESULT_OLD_CCLOOP_ROOT=/private/tmp/ccloop-task6-legacy-producer ORCA_SAVED_RESULT_CCLOOP_BIN=/private/tmp/ccloop-feedback-followup-20261011/dist/cli.js node node_modules/vitest/vitest.mjs run tests/control/task7IndependentRetry.test.ts --maxWorkers=1
```

- `/private/tmp/orca-followup-runs/task7-independent-retry01/output.log`
- `/private/tmp/orca-followup-runs/task7-independent-retry01/result.json`
- Raw SHA256 `61eabddd3048444e950ae7fcc8439a2d8761d64f301a928c40ebb38d72cfbde2`, 7889 bytes/43 lines; source HEAD `be35141…`, probe tree `75993180803ac7f0cbced1e15849dbeb9b6fc908d6a35a829db3b1d965780a66`/933 files.

**Required correction:** Recognize the successful explicit ordinary-retry ledger authority for actually failed recovery predecessors as well as the narrow no-dispatch case. Preserve recovery history/mode, current claim/cap/policy checks, and refusal of empty-selection resume or any automatic fallback. Add a genuine reject→explicit retry→new normal claim/plan/execute criterion; preserve the no-dispatch negative criteria. Do not remove the exclusion guard wholesale.

### I2 — P2: The saved-result UI claims ordinary retry is available when it is forbidden

**Location:** `web/src/TaskDetail.tsx:257,284`, `web/src/locales/en.ts:319` and `web/src/locales/zh.ts:205` (the new `savedResult.unavailable` entries).

**Trigger:** A saved-result recovery has successfully settled and its task is done; or eligibility refuses with `saved-result-usage-unsettled` while ordinary retry is blocked by unknown usage. Stop/archive conditions produce the same unconditional copy problem.

**Problem/impact:** The task detail renders this action for every current `recoveryOf` run, including success. The backend then correctly returns source-stale for a done task, but the UI displays “Saved results are unavailable for verification; ordinary retry is available.” The same text is rendered for unknown usage even though `retryTask.ts:103` refuses it. The UI contradicts the successful result and advertises a recovery action that cannot be taken, obscuring whether the user should settle usage or do nothing.

**Independent witness:** Exact HEAD clone jsdom render of actual TaskDetail done/succeeded recovery and SavedResultAction usage-unsettled response. Both intended truthful-copy assertions fail, RC1; this proves component behavior, not browser geometry. Full raw read:

Exact command:

```sh
rtk proxy python3 /private/tmp/orca-followup-run.py /private/tmp/t7-independent-review-be35141 task7-independent-copy01 node node_modules/vitest/vitest.mjs run --root web tests/task7IndependentCopy.test.tsx --maxWorkers=1
```

- `/private/tmp/orca-followup-runs/task7-independent-copy01/output.log`
- `/private/tmp/orca-followup-runs/task7-independent-copy01/result.json`
- Raw SHA256 `73df173c9a2f00a102b8c504f2598686b55b6adeb7f2267d721381df021b0d23`, 2285 bytes/69 lines; source HEAD `be35141…`, probe tree `2df8c42850853821e52b35995babecd25d0e3b514caf65f1849b9034af1748a0`/934 files.

**Required correction:** Omit the saved recovery control for done/successful tasks. Use neutral unavailable wording, or condition the retry-available statement on the real retry/stop/archive qualification. Keep the precise unavailable reason and actual ordinary retry button. Add done and usage-unsettled UI criteria in both languages.

### M1 — P3: Opening report qualification conflicts with the later final-source qualification

**Location:** `task-7-report.md:7` versus `:61`.

The opening “Final product source is unchanged between the full dedicated gate and the final test source” is too broad because TaskDetail's product predicate/key and catalogs changed later. The later source paragraph correctly qualifies that backend/driver/funding/fixture/gate bytes remained unchanged and final UI had separate gates. Rewrite the opening statement to match that narrower fact. Do not relabel the 18ed native gate as an 89f run.

## Evidence audit and practical limits

All 82 evidence rows' retained raw SHA256, byte count and line count independently match their files. I read the complete dedicated20 log, schema/UI failure diagnostics, the nine credited mutant logs, and the controller's complete-root audit. The root audit is independently controller-authored and says all3405 lines were read; I did not independently reread every root stdout line. Root02 raw identity was recomputed, and its JSON/skip/source qualifications were checked against the inventory.

Historical native gate `task7-final-paired01` is RC0/20pass/0skip at `18ed8be…`, not final89f. The strengthened actual-check-counter criterion subsequently passed at50a45; final scheduler-negative coverage is newer again. Root02/formal-control is RC0 atdb65, 390 files/3695pass/27 named skips; control1840pass/24skip. Final Web check is89f/912tests/105files/0skip; panel script is15 steps; focused final UI root is76tests/7files/0skip. The 27 root skips are20 opt-in native cases plus7 named existing prerequisites, not full native acceptance. Root01 RC1/five failures remains diagnostic; its socket path failures and catalog/archive-verb failures are not recast as passing.

The nine mutant RC1s are real intended assertions. Semantic/cap/reservation/no-dispatch/auto-fallback/version/check mutants directly expose their missing integrity condition. Lineage and original-failure field mutants instead fail positive plumbing with blocked-versus-settled; they support necessary persistence, not an independent negative integrity assertion. The earlier auto-fallback01 survivor remains an acknowledged gap; auto-fallback02 exposes actual claimed-versus-idle after strengthened scheduler coverage. Restored Orca clone backend/native bytes match the committed manifest; its two UI files predate final UI and are not claimed as latest UI mutation coverage. No shared product mutation or model call occurred.

## CannotVerify

- Fresh full20 native acceptance at final exact89f (or a subsequent fix HEAD): not run yet; controller's fresh integration gate is still required. The historical20 plus focused strengthenings are narrower evidence.
- Actual paid-provider enforcement/external effects, deployment, default installed pin, real ccmem/syncskill/launchd, or live owner migration: not exercised or authorized by this review. Soft adapters remain soft.
- Real browser geometry/interaction: component/jsdom checks and HTTP panel script do not establish it.
- Universal historical recovery: standard old missing-ref archives, current strict-invalid capsules and transformed Claude proof remain unavailable. Genuine complete-archive primitive success does not establish the ordinary old archive lifecycle.
- Exactly-once external validation effects across unobservable crashes: incomplete post-entry effects remain known/unknown settlement cases, not replay proof.

## Declined-to-judge

- Tasks8–14 features, repin/publication and whole-round acceptance: explicitly deferred by the human; their absence is not a Task7 implementation finding.
- Task1 persistent captureRevision defect: separately confirmed and queued outside this range; not a new Task7 regression. Overall merge approval remains withheld until it is closed.
- The diagnosed unchanged old Claude parallel publication/exit races: deferred Task14 repair; serial green evidence does not waive or resolve them.
- A production upgrade/hot concurrent old owner: no such operation is claimed; schema12 is a reopen boundary and real retirement/backup remains a later deployment responsibility.

## Verdicts

**Spec verdict: With fixes; not complete.** I1 violates the specified ordinary retry after unsuccessful verification, and I2 violates truthful recovery availability/output presentation. Other inspected Task7 authority and accounting paths are aligned with the binding scoped design and its explicit limits.

**Quality verdict: With fixes; not ready to merge.** No P1 was found. Two P2 findings are independently reproduced and must be fixed and scoped re-reviewed. Preserve the source-qualified gates and run the actual fresh final dedicated native gate during handoff. This review does not authorize Tasks8–14 implementation or overall merge with the separate Task1 P2 still open.
