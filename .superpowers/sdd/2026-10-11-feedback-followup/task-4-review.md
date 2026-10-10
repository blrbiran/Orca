
## Review coverage checkpoint 1
Read binding brief/global constraints/token-policy spec §1–6.5, complete current implementation rulings, report checkpoint/final sections, and diff lines 1–4086 (all production control/panel/scheduler changes). Truncated first output was repaired by reading 260–546 separately. No source/index/HEAD edits or tests run. Pending diff 4087–8427 and evidence companions. Named risk for focused follow-up: optional funded run settled-restartable appears to retain its numeric token commitment before next createStartingRun adds a fresh one; inspect matching test and no-start stop path.

## Final independent Task 4 review — c2a1f42..d72f05e

### Spec Compliance

- ❌ Issues found: the optional policy stop/restartable path violates actual-commitment conservation (I1), and the budget UI still rejects valid claim-funded authored ceiling edits (I2).
- ⚠️ This is the Task 4 gate. Producer semantics outside this diff rely on Task 3 review/paired evidence. Combined final schema11 migration, real tools/browser/cross-repository validation and human final audit remain later task boundaries. No final-round acceptance is asserted.

### Strengths

- `src/control/tokenPolicy.ts:11` and `src/control/usage.ts:36` keep nullable ceilings separate from validated finite observations, preserve all non-token dimensions, and book overshoot as actual usage.
- `src/control/fundedAllowance.ts:55` implements joint scoped minima before residual distribution, including fixed historical demand and exact group reservation credit. `src/control/webDispatch.ts:236` refreshes time after awaited probes and rechecks current finite proof requirements before claim.
- `src/control/fundedAllowance.ts:130` binds saved continuation identity, accepted contract, reachable artifact bytes, saved phase and all four authoritative usage dimensions. `src/control/webDispatch.ts:647` preserves protocol4 for a finite saved allowance after cap removal. The paired criteria assert no planning replay.
- `src/control/migrations.ts:110`, `src/control/loopPlans.ts:100`, and the explicit historical fixture changes preserve frozen old authority while applying nullable policy only to new or explicitly converted mutable records.

### Critical

None found.

### Important

**I1 — Release or transfer the funded reservation on a proved pre-provider stop.** `src/control/stopIntent.ts:772` deliberately excludes `settled-restartable` from the new optional release path. Its legacy branch at line780 retains the prior run's complete commitment and marks the task ready. The next `createStartingRun` in `src/control/webDispatch.ts:416` adds a new optional token commitment because no `fundingReleased` marker was set. This creates a phantom reservation on each stop/resume cycle; with a finite group binder the old retained amount can instead block a legitimate fresh claim. The existing new no-start criterion covers invalid first proof in `settleProviderAttempt`, not this handoff-stop branch.

Reproduced through actual `driverHarness` → claim → `handoffStop` before A1/provider start → driver settlement → `resumeFromHandoff({selections:[]})` → `deliverScheduledStart`. Authored task/group tokens are null; total spend cap is1,900,000. Each actual grant is1,600,000 work +300,000 handoff. First run is inactive `settled-restartable`, both unknown flags false, every usage counter zero, and fake provider accept count0. Group reserved tokens are3,150,000 before stop,3,150,000 after stop, and5,050,000 after the next claim. Active cap commitments correctly remain1,900,000 and only the second run is active: the extra1,900,000 exists only in the group ledger. Non-token commitments stay unchanged. Both funded records remain as historical identities, which is valid; retaining the old numeric reservation is not.

Fix the optional restartable transition so the exact real reservation is released/marked for fresh funding, or explicitly transferred once; preserve predecessor registration on stopped continuations and retain unknown holds. Add actual pre-provider stop/resume/claim regressions for uncapped and finite group/cap funding, and assert both group and cap commitment totals. Keep the historical fixed-grant branch unchanged.

Evidence: `/private/tmp/orca-followup-runs/task4-review-restartable-native/output.log`, `result.json`; RC1, one intended business AssertionError at reviewer test line19 (5,050,000 versus3,150,000). Reproduction source: `/private/tmp/orca-task4-review-20261011/tests/control/tokenPolicyReview.test.ts`.

**I2 — Stop applying legacy draft-reserve arithmetic to optional task token ceilings in the editor.** `web/src/LoopPlanCard.tsx:143` skips token shortfall computation only when the old/new amount or reserve is null. A new optional policy can have all three finite values, although its task token allocation is deliberately not draft-encumbered. The code then subtracts the entire authored ceiling increase from free group reserve and returns a false shortfall. The editor uses that result to disable submission at lines185–208. The backend correctly skips this token delta constraint for optional accounting at `src/control/webService.ts:946`.

Reproduced from an actual optional-policy import with a loop task ceiling99,000, finite group ceiling1,500,000, and reserve250,000 (the remaining1,250,000 is finite estimate/review commitment). Owner change to a task ceiling1,000,000 is accepted by the real `setTaskLoop` service without consuming extra draft tokens. Feeding that exact pre-edit server view to the browser's `consequenceOf` returns “Group reserve too small: tokens short by651000”, so the UI blocks the same edit. Finite authored demand must remain editable even when its eventual run will receive a smaller group/cap-funded allowance.

Expose/use the relevant accounting mode in the read model or otherwise make client consequence calculation agree with the server's optional-vs-legacy semantics; do not drop the legitimate old finite reservation safeguard. Add a rendered edit/submit test for finite optional task+group ceilings, retaining legacy insufficient-reserve tests.

Evidence: `/private/tmp/orca-followup-runs/task4-review-editor-server/output.log` and `result.json` (RC0,1 test); exact pre-edit view `/private/tmp/task4-review-optional-finite-view.json`; `/private/tmp/orca-followup-runs/task4-review-editor-client/output.log` and `result.json` (RC1,1 intended AssertionError). Reviewer tests are in the same isolated clone at `tests/control/tokenPolicyEditorReview.test.ts` and `web/tests/tokenPolicyEditorReview.test.tsx`.

### Minor / verification observations

- Supplied final Web build retains the640.18kB advisory; npm update notices and SQLite experimental warnings also occur. These are disclosed output noise, not failed Task4 business assertions or grounds to change thresholds.
- The exact existing-criterion inventory matches every added/deleted line for all52 previously tracked test/fixture files. Seven genuinely new test/fixture entries have empty inventory diffs because they were untracked when inventoried; their complete additions were reviewed from the final committed review package. No old business assertion waiver found.

### Coverage and verification

- Read the full8,427-line/640,345-byte review package, all111 file changes. Coverage checkpoint1 handled lines1–4086; remaining4087–8427 now complete. Two truncated tool displays were repaired by focused overlapping reads. No repeated product diff generation or broad code crawl.
- Read the brief, verbatim global constraints, complete latest implementation rulings, token policy spec including append-only§6.3–6.5, and the full append-only report with final gate/mutation overrides.
- Inspected all five evidence companions: final gates, final mutations, RED/GREEN, criterion inventory, initial-failure map. Independently checked every final9 gate log byte count/hash, all22 mutation raw byte counts/hashes, their precise mutations and intended AssertionError failure blocks, and zero restored source/index diff evidence. Read complete seven small final gate logs. Controller/implementer complete raw root/control audit is retained; reviewer verified root per-test JSON rather than rerunning those gates.
- Independently matched all92 initial failure mappings to passing final root assertions (3,679 passed,0 failed,7 named opt-ins). Final native control1,827/4opt-ins, Web905/0, paired4/0, package-pin3/0, types/build and panelPASS0–14 are supplied same-source evidence, not fresh reviewer suite claims. Real ccmem/syncskill/launchd opt-ins remain explicit scope boundaries.
- Focused outside-diff reads were limited to named risks: stopIntent's cut-off restartable branch and existing driverHandoff before-provider criterion; LoopPlanCard's cut-off submit wiring; controlViews progress producer (confirmed null grant passes through with finite used and unknown separately). No extra bug found in that progress producer.
- New tests ran only in a separate `git clone --no-hardlinks`, after checkout completion, clean status, exact HEADd72f05e and920-file SHA6aa31b916020bf7b446b37ee33982b669861cf230f62005f3a1e3fb351854f82 readiness checks. Used existing absolute Vitest path, isolated runner, real short0700 TMPDIR, fake-only harnesses and no package install/provider/real-data call. First sandbox attempt failed before tests at `ps EPERM`; its RC1 infrastructure log was retained and was not counted as product RED. Authorized isolated native retry then produced the business failure above.
- Product checkout source hash remains6aa31b916020bf7b446b37ee33982b669861cf230f62005f3a1e3fb351854f82 after review; no source/index/HEAD mutations. Only this requested append-only review artifact was written in the product checkout.

### Declined to judge

- Strict/hard enforcement implementation: explicitly remains strict-proof-unimplemented under the binding ruling; paired evidence is soft mode.
- Combined schema11 recovery/install tables, real tool acceptance, browser walkthrough and cross-repo final integration: reserved for later tasks, not silently waived.

### Assessment

**Task quality: Needs fixes.** The core nullable-policy, lineage and compatibility implementation is substantially covered, but a real stop/resume path corrupts numeric commitments and the browser blocks a supported authored-ceiling edit. Both are reproducible Task4 behavioral gaps; fix and perform scoped re-review before closure.

### Reviewer reproduction metadata

```json
[
  {
    "repo": "/private/tmp/orca-task4-review-20261011",
    "command": [
      "env",
      "TMPDIR=/private/tmp/t4r-vmbugi9w",
      "node",
      "/Users/biran/code/skills/loop/Orca/node_modules/vitest/vitest.mjs",
      "run",
      "tests/control/tokenPolicyReview.test.ts",
      "--maxWorkers=1"
    ],
    "rc": 1,
    "elapsedSeconds": 1.188476324081421,
    "log": "/private/tmp/orca-followup-runs/task4-review-restartable/output.log",
    "source": "d72f05e781f68ea499345a02b3c2af897b690a23",
    "sourceTreeSHA256": "100c56636c6d1176c668d90ba51aa276aae762c462866795bc33f56940fb2e68",
    "sourceFiles": 921,
    "rawBytes": 1475,
    "rawSHA256": "84f51e3963053731160ebef4987ed6b1685b9c39dce9654027373953f8ae6fb3"
  },
  {
    "repo": "/private/tmp/orca-task4-review-20261011",
    "command": [
      "env",
      "TMPDIR=/private/tmp/t4r-8uua6ztw",
      "node",
      "/Users/biran/code/skills/loop/Orca/node_modules/vitest/vitest.mjs",
      "run",
      "tests/control/tokenPolicyReview.test.ts",
      "--maxWorkers=1"
    ],
    "rc": 1,
    "elapsedSeconds": 1.492427110671997,
    "log": "/private/tmp/orca-followup-runs/task4-review-restartable-native/output.log",
    "source": "d72f05e781f68ea499345a02b3c2af897b690a23",
    "sourceTreeSHA256": "100c56636c6d1176c668d90ba51aa276aae762c462866795bc33f56940fb2e68",
    "sourceFiles": 921,
    "rawBytes": 2933,
    "rawSHA256": "f2a9274155a0d05ee7b7bb17412ba3453736fd0db2f75ad52c9b57750b74e5d9"
  },
  {
    "repo": "/private/tmp/orca-task4-review-20261011",
    "command": [
      "env",
      "TMPDIR=/private/tmp/t4e-uk3bnbie",
      "node",
      "/Users/biran/code/skills/loop/Orca/node_modules/vitest/vitest.mjs",
      "run",
      "tests/control/tokenPolicyEditorReview.test.ts",
      "--maxWorkers=1"
    ],
    "rc": 0,
    "elapsedSeconds": 1.2518250942230225,
    "log": "/private/tmp/orca-followup-runs/task4-review-editor-server/output.log",
    "source": "d72f05e781f68ea499345a02b3c2af897b690a23",
    "sourceTreeSHA256": "e61f6da79afb5a25c74e6f3094a5dbbfd0c5a2e9544ee3c9548bd42f86a5b5d0",
    "sourceFiles": 923,
    "rawBytes": 368,
    "rawSHA256": "06a3668def17f97b94e755b075bb4c0052c230f1f014edc285f7a47fec83cbd4"
  },
  {
    "repo": "/private/tmp/orca-task4-review-20261011",
    "command": [
      "env",
      "TMPDIR=/private/tmp/t4w-ouqkjhll",
      "node",
      "/Users/biran/code/skills/loop/Orca/node_modules/vitest/vitest.mjs",
      "run",
      "--root",
      "web",
      "tests/tokenPolicyEditorReview.test.tsx",
      "--maxWorkers=1"
    ],
    "rc": 1,
    "elapsedSeconds": 1.209414005279541,
    "log": "/private/tmp/orca-followup-runs/task4-review-editor-client/output.log",
    "source": "d72f05e781f68ea499345a02b3c2af897b690a23",
    "sourceTreeSHA256": "e61f6da79afb5a25c74e6f3094a5dbbfd0c5a2e9544ee3c9548bd42f86a5b5d0",
    "sourceFiles": 923,
    "rawBytes": 1363,
    "rawSHA256": "1a516bc939a286bff44adccbbfc7d620f1bb879445cc52415768c3c9509cb7b5"
  }
]
```

### Exact line reference correction
The I1 fresh-reservation expression is `src/control/webDispatch.ts:413` (line416 is the following outbox block). The I2 server optional-token exemption is `src/control/webService.ts:939` (not946). Strength references: saved validation function begins `src/control/fundedAllowance.ts:131`; saved finite allowance protocol predicate is `src/control/webDispatch.ts:655`. Findings and verdict unchanged.
