# Task7 R1 independent scoped spec and quality review

Reviewer: original independent gpt-6.1-sol review seat, 2026-10-11 Asia/Shanghai. Scope: original I1/I2/M1 and introduced regressions, with the existing recovery guards needed to assess those fixes. No subagents, new test suites/probes, product edits, Git mutations, providers, service/data changes or publication. This report is the sole reviewer write. The original independent report remains unchanged.

## Source and evidence boundary

Immutable Orca range `847c9b2dc947d2c5a6abda23a4ce968702d97061..a3ac7f9135e5fbb5c67fc10bc9eba20bbe0d9832`. Nine product/test paths plus ten owned evidence/documentation paths, nineteen committed paths total. Task1 captureRevision fix is in BASE and separately independently Approved; it is outside this R1 diff.

Read every scoped product diff, the new genuine retry and bilingual component criteria, the existing command-ledger lookup/persistence and normal retry/scheduler guards, and committed R1 report/interfaces/evidence/source-manifest/source-qualification/skip-inventory/mutations. All934 immutable HEAD source hashes match the manifest; its source-path inventory matches the complete Git source inventory. Independently recomputed final source SHA256 `e06660e08eda57b03118ea1618d049f4f3a193b4b2c2416f9e3a0d84d9f2ae17`/934. Exact reversal of only the two documented UI public-state corrections reproduces the earlier file hashes and full `abcbe5ae37d2ca205a37fb05cbd717981b0d27131596d7c71ae103390e36c16e`/934. Diff whitespace check passes.

All30 committed evidence rows' raw hashes, byte counts and line counts match retained files. I read complete dedicated native23, four mutant, final Web failure/success and panel logs; inspected actual root JSON assertions/skip inventory and source-qualified result metadata. I did not independently reread every root stdout line or rerun the heavyweight suites; the implementer/controller's complete root read is retained and its raw identity and JSON totals independently checked here.

## Original findings

### I1 — Closed: Successful explicit normal retry can now create a fresh ordinary run

`src/control/retryTask.ts:50–58,149,174` records `savedOrdinaryRetryCommandId` only after the existing legitimate failed-recovery retry effects and funding validation, within the same command transaction. Both optional and legacy branches call it. A refused or rolled-back command cannot leave authorization. It retains the recovery mode, actual unsuccessful outcome, recoveryOf and booked usage; it does not rewrite failure to not-started.

`src/control/savedResultNoDispatch.ts:33–49` then requires a real successful ledger-version1 retry receipt, exact strict raw request/hash/actor/target/revision, canonical successful response identity/result/bytes, exact task/fromRunId, matching inactive run/header/generation, current/latest ready membership and no pending continuation/unknown usage. `lookupWebCommandReplay` is a read-only raw identity validator and does not require the scheduler to impersonate the historical request's principal. A marker or ready state alone cannot authorize a claim. The first real normal claim replaces current/latest membership, invalidating this predecessor's authorization. Command replay cannot reserve or claim again.

The NoDispatchConsumed path still obtains its authority from the unchanged positive never-submitted marker + actual absent inspection + known-unspent handoff proof and explicit one-time ledger consumption. The new normal-retry marker is separate. The automatic selector exclusion remains; absent/foreign/failed/altered receipt or generation mismatch is refused. No saved-interruption exception, missing-entry zero inference, provider replay or automatic ordinary resume was added.

The new native test actually follows reject, candidate modification and known verifier timeout through explicit retry, distinct normal claim and real fake-provider plan/execute/verify/settlement. It asserts prior source failure and paid recovery outcome/usage remain unchanged, replay preserves reservations, and authority disappears after claim. The reject criterion also proves unknown usage and stop refusal, failed/foreign/altered receipt refusal, generation mismatch refusal and current spend-cap refusal. Existing admission, reservation, four-dimensional group/policy accounting and fresh claim gates are unchanged; they remain authoritative. The original prepared-unaccepted/no-dispatch lifecycle is included in the full dedicated gate and exact final-source clone baseline.

### I2 — Closed: Completed/successful tasks no longer offer saved verification or a false retry promise

`web/src/TaskDetail.tsx:257` excludes the actual public `completed` task status and a successful current run. The final fixture uses the actual public completed/settled-recoverable DTO values, without casting impossible internal state names into the test. Both locale unavailable entries now state only that saved verification is unavailable. The precise reason remains; the existing qualified ordinary-retry control is unchanged.

The bilingual component criteria prove no source-eligibility GET/action on the completed/succeeded recovery and neutral copy for usage-unsettled, stop and archive refusals. They also prove polling emits no command. These are component/DTO proofs, not browser geometry claims.

### M1 — Closed: Historical source and mutation claims are qualified accurately

The original implementer report now expressly limits unchanged-source equivalence to historical backend/driver/funding/fixture/gate bytes and labels later UI evidence separately. It also calls lineage/copied-failure mutants necessary positive persistence plumbing instead of independent negative integrity assertions. Old failed evidence and the uncredited selector-survivor remain preserved. R1's report independently distinguishes actual abcbe native/root evidence from e066 UI/types/build evidence; the exact two-file qualification is independently reproduced.

## Verification audit

- Dedicated `task7-r1-final-native01`: RC0,2 files/23pass/0skip at abcbe. Actual argv uses the configured old Orca/old ccloop/current CLI and `npm run verify:saved-result` through the owned short TMP wrapper. The gate builds exact immutable f00 schema11 locally, build RC0/clean tracked diff/storeSHA32c186…, and selects both native files. Full93-line/6534-byte raw SHA256 `2b41fc1ef5c13e7b10ddfe839009b1c942dbfc5144d79ee0471bd94da7212f45` was read. Its full backend/native/fixture/gate bytes equal final e066.
- Combined `task7-r1-final-root01`: RC0 at abcbe; actual JSON391files/3725assertions =3695pass+30skip, with no other statuses. Control169files/1840pass+27skip; panel73files/608pass. JSON SHA256 `c17962e9801971a40ff0b198aaa96e3a2da81b4798e21e00328838b2989f17d7`; raw SHA256 `f693d58dc5fb2914be6e1cc2967a2af6fb2c572b70b514fc873f54a0fea9dd5e`. This is the approved combined root/control invocation, not a claim that a separate verify:control command ran. All30 skipped names/conditions are inventoried:23 opt-in native criteria plus7 existing opt-ins. Their skips are not counted as native acceptance.
- Final e066: types/build/assets RC0; full Web106files/926tests/0skip; actual HTTP panel15 PASS steps0–14. The earlier Web RC2 with internal done/settled names remains failed evidence; the two public-state corrections are exactly the qualified UI differences from abcbe. Historical abcbe root is not relabeled final-UI root.
- Four exact e066 clone mutants: receipt and generation deletions each produce intended claimable-versus-null RC1; completed/success suppression and old bilingual copy each produce the intended rendering RC1. Native mutants have2 named filter skips, UI mutants have no skips; these are narrower than full native23. Exact source-matched native/UI baselines pass. All934 restored clone hashes equal final HEAD, and restored build RC0/e066 is retained. These R1 mutations directly test negative authority/rendering conditions, unlike the historical positive-plumbing pair.

Durable exact command/RC/source/raw records are in committed `task-7-r1-evidence.json` and `task-7-r1-mutations.json`, with raw logs under `/private/tmp/orca-followup-runs/task7-r1-*`. No source-mixed pass or failed gate is credited.

## New findings

None. No remaining P1/P2 or new scoped regression was found. I1's authorization is explicit and ledger-backed, I2's presentation is truthful, and M1's evidence claims match the actual source identities.

## CannotVerify

- Fresh full merged-tree/native/root execution: controller's one fresh integration pass remains pending; this review accepts the proved per-file backend/UI qualification and does not call abcbe a final e066 whole-tree run.
- Real paid providers, live user database/owner upgrade, real services, real default installed pin or browser geometry: not exercised or authorized here.
- Universal saved-result availability or exactly-once external effects through an unobservable crash: original standard-old-ref/current-invalid/Claude limits and known-versus-unknown settlement boundaries remain unchanged.

## Declined-to-judge

- Tasks8–14, repin/release/remote publication and whole-round acceptance: expressly deferred by the human; not R1 requirements.
- Task1 captureRevision implementation: separately independently Approved in BASE, outside this scoped diff; not re-reviewed here.
- Known old Claude publication/exit races: diagnosed deferred Task14 work, unchanged by R1; no serial-green waiver.
- A production or concurrent old-owner migration: not performed or claimed; schema12's existing reopen boundary is unchanged.

## Verdicts

**Scoped spec verdict: Approved.** Original I1/I2/M1 are closed, with their recovery/accounting/explicit-intent safeguards preserved.

**Scoped quality verdict: Approved.** No remaining review blocker for Task7 R1 at exact HEAD a3ac7f9135e5fbb5c67fc10bc9eba20bbe0d9832. Proceed to the already authorized local-main handoff and one fresh merged-source verification pass; Tasks8–14 remain deferred. This is scoped code-review approval, not a claim that the pending integration gates or production deployment have already occurred.
