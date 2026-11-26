# Acceptance distinguishes known test failures from changed tests — design

- **Author:** controller of Orca session `2026-11-26`.
- **Status:** accepted for implementation by the user in this session on 2026-11-26; implementation is authorized under the user's same-session instruction to complete the work and report for review.
- **Issues:** #498 and #508.
- **Related designs:** `2026-11-16-baseline-aware-group-acceptance-design.md`, `2026-11-12-group-acceptance-full-suite-design.md`, `2026-11-18-preexisting-failures-design.md`, `2026-10-21-protect-acceptance-criteria-design.md`.

## 1. Intent

Acceptance must tell a person whether the delivered tree passed its checks, passed only because a pre-existing failure was tolerated, or passed after changing existing tests. Today those cases can collapse into a plain `passed`: the task-check union stops before base comparison, and a review-fix can alter an existing test before a later acceptance run. This has occurred in live Orca groups and has made a review-fix loop attempt to resolve a test-weakening finding by editing code again.

The goal is to support an explicitly known flaky failure without requiring repeated lucky runs, while preserving evidence that no new failure was introduced. Existing test changes must remain possible, but cannot silently turn a failed or suspect acceptance into an ordinary pass.

## 2. Goals

1. A red task check or full-suite check can be classified as pre-existing only when the same check at the group's frozen base identifies the same failing test cases and the tip introduces no additional failing cases.
2. The result and evidence identify every command run, its exit, the base used, and the failure identities compared. The group view explains why a relative pass is accepted.
3. Acceptance evaluates the task-check union and the full-suite command through the same baseline rule; a red union command cannot bypass comparison solely because the full suite did not run.
4. A change to an existing test file is visible in acceptance even if the changed path is inside `targetPaths`, a criteria-review flag was auto-ratified, or a later review reports a different result.
5. A test change does not block landing. It does prevent an unqualified acceptance pass until the change has an explicit disposition.
6. New test files and additive-only test changes do not create a human gate unless they contain a weakening signal.

## 3. Non-goals

- Inferring permission from free-form requirement prose such as “allow the known flake.” The system will use recorded evidence and explicit structured dispositions; no LLM or heuristic text parser will decide whether a test failure is exempt.
- Treating any historical non-zero exit for the same shell command as proof that every later failure is pre-existing.
- Rewriting or deleting tests automatically, automatically waiving acceptance, or changing whether a task may land.
- Making arbitrary shell commands comparable when their output does not expose stable test-case identities. Such checks remain failed/unknown and retain the existing human recovery path.
- Changing the independent requirement-review verdict or making acceptance and requirement review the same gate.

## 4. Approaches considered

### A. Compare command exit codes

Run the command at the tip and base; if both are red, mark `passed-relative`. This reuses the current full-suite model and supports arbitrary shell commands, but cannot establish “no new failures.” A command can retain one old failure while adding a new one. A cached red command also says nothing about which failure occurred.

### B. Compare structured failing-test identities, and separately gate existing-test changes — recommended

For supported test output formats, extract stable failing-test identities at the base and tip. Accept relatively only when all tip failures are present in the recorded base set. If parsing or evidence is missing, fail closed. Separately compare the group's final tree with its frozen base for modifications/deletions to existing test files; keep landing unchanged, but require an explicit disposition before the acceptance can be satisfied. This handles the user's stated “no new failures” goal while keeping legitimate test changes available through review.

Trade-off: the first implementation supports a bounded set of test reporters; projects using unrecognized output retain a human resolution path until a parser is added.

### C. Keep exit-code comparison and depend on model review

Keep current `passed-relative` behavior and use criteria-review/check-conflict to explain suspicious outcomes. This has the smallest implementation cost, but the live cases show that review can identify a problem after acceptance has already become green, can offer another review-fix as the only next step, and does not provide a mechanical guarantee that a new failure is absent.

## 5. Recommended design

### 5.1 Acceptance baseline evidence

An acceptance baseline is keyed by the exact confirmed command, repository, group's frozen base commit, setup-command digest, and reporter/parser version. It accumulates failure identities observed in red base runs; a later green run does not erase an earlier observed base failure, because the use case includes flaky tests. A baseline stores bounded output evidence, parser status, provenance, timestamp, and run identifier. A baseline with unknown setup or parser version is not reusable.

A tip failure may reuse only an exact-key baseline. Otherwise Orca runs the exact command with the acceptance's setup union once at the base in an isolated acceptance worktree. Do not run base checks before a tip failure. Existing `base_check_results` rows are reusable only if they can prove an exact setup digest and compatible parser version; current rows that lack that evidence are display-only. Timeouts, signals, setup failures, checkout failures, unsupported output, and parser ambiguity do not add failure identities.

The first implementation supports the reporter used by the affected dogfood repository (`node:test` TAP output). A failure identity includes the repository-relative test file, full nested test name, and a normalized failure diagnostic; it excludes TAP ordinal numbers and volatile line/stack positions. Repeated names are disambiguated by their parent path. A failed parent suite is omitted when its child failures fully explain it. A file-level failure before any test identity uses the normalized diagnostic with the file path. Ambiguous or malformed output fails closed rather than producing an empty set.

### 5.2 Relative acceptance rule

Run setup once, then run every required check in the union even after one check exits non-zero; one red check must not prevent an independent later check from exposing a new regression. A setup failure stops the union because its environment is not established. Preserve a result and bounded output for every attempted command.

For the configured full-suite command, retain the existing confirmation policy: run it after the union is complete; rerun once after a red result, or run a second confirmation when task history had already reported the suite red. If the exact full-suite command already ran as a union check, use that run as its first suite attempt rather than executing it twice immediately. Any red attempt contributes its failure identities; a subsequent green does not erase them.

For a command with accumulated base failure identity set `B` and all tip attempt failure identities `T`:

- If all tip attempts are green, the command passes (with flaky evidence if task history required a second confirmation).
- If any tip attempt is red, it is `passed-relative` only when every parsed identity in `T` is in `B` and there are no unparsed failures.
- Any new identity (`T - B`), missing baseline, non-comparable output, or uncertain run means `failed` with a named reason; a later green attempt cannot hide it.
- If a red tip has no baseline yet, run the exact command at the base with the exact setup digest. A green base gives no pre-existing failure identity and the tip stays failed. A red base adds its parsed identities to the accumulated baseline before comparison.

The same rule applies to exact commands in the task-check union and to the configured full-suite command. Never equate shell wrappers or command prefixes. A command in the union is compared under its own exact identity; the configured suite is not run as an unrelated extra command solely to classify a failed union check.

### 5.3 Existing-test change gate

At acceptance, compare the group's frozen base to the checked tip, independently of `targetPaths`, per-task flags, and criteria-review outcomes. Classify paths using the test-file rules in `criteriaProtection`:

- A newly added test file is scanned for skip/focus/todo signals before it can be treated as additive. Such a signal creates a disposition requirement.
- A purely additive edit to an existing test file with no weakening signal is informational.
- Any modification or deletion of a test file that existed at the frozen base creates a disposition requirement. This intentionally includes edits whose semantic effect cannot be judged mechanically; it avoids needing to infer intent from red-to-green timing or from an LLM verdict.
- Keep the existing mechanical weakening signals and add coverage for removed test declarations that assertion counts do not catch. Deletion, fewer assertions, new skip/focus/todo, or equivalent weakening signal is named in the record.

Use a distinct acceptance state/reason (`test-change-pending`) rather than writing `passed`. Keep task landing and the group branch intact. Add a person-only `group accept-test-changes <group> --note <why>` disposition bound to the checked tip and a digest of the affected paths. Record actor/note/time. A moved tip or changed path digest invalidates the disposition. This action only resolves the test-change gate; `waive-acceptance` only resolves command failure and cannot stand in for test-change approval.

The gate applies even when no full-suite command is configured or the single-landing shortcut would otherwise write `not-needed`; test changes are a separate acceptance fact. It also applies to the delivered tree checked by D3. A task may land or deliver under existing rules, but a group cannot become accepted/done while the disposition is pending.

An automatic criteria reviewer may add evidence, but its verdict alone cannot erase the acceptance record of an existing-test change. If requirement review finds only a test-change issue, it must not loop by offering another `review-fix` as the sole exit; show restore-and-recheck and the person-only disposition. Unrelated requirement findings continue through their existing review path.

### 5.4 Views and records

The persisted acceptance record and `group show` / `group brief` distinguish:

- `passed` — checks passed, with no unresolved existing-test change;
- `passed-relative` — every reported failure matches a parsed base failure identity, with baseline source and compared identities shown;
- `failed` — new or incomparable failure, with command and reason;
- a test-change disposition required — acceptance is not satisfied, and the view names changed paths, decision state, and the exact human next step.

When acceptance is satisfied but requirement review is not passed, the view says plainly that the two fields answer different questions: executable checks passed, while requirement coverage remains unresolved. Neither field overwrites the other.

Keep backward-compatible reads for existing acceptance records. Old records do not gain inferred baseline identities or a test-change disposition retroactively.

## 6. Constraints and compatibility

- The requirement-review verdict and `checkConflict` remain independent from command execution acceptance.
- Persist baseline identities durably under a key containing repository, base commit, exact command, setup-command digest, and parser version. Accumulate observed red identities; a later green does not erase a failure identity at the same frozen base/setup.
- Do not reuse an existing `base_check_results` row unless it can prove the same setup digest and compatible parser version. Current rows without those fields are display-only.
- Keep exact command matching. Do not equate shell wrappers such as `npm test || npm test` with `npm test`; run and baseline the exact command whose result is being classified.
- Persist bounded output/identity evidence with explicit size limits. Malformed, oversized, or unsupported output must fail closed and remain diagnosable.
- Run all union checks after a check-level red; setup failure is the only union condition that stops later checks. A suite command duplicated exactly in the union uses that invocation as its first suite attempt.
- Keep the acceptance runner's per-check timeout, cancellation, isolated worktree, and group frozen-base rules. D3 applies the same classification to the delivered tree.
- Keep old acceptance JSON readable; old records do not acquire inferred identities or approvals retroactively. The test-change gate is independent of a configured suite and applies before single-landing `not-needed`.

## 7. Acceptance criteria

1. A base and tip both fail the same parsed test identity, with no additional tip failures: acceptance records `passed-relative`, the exact base/setup/command, all tip/base exits, identities, and baseline source; the group can finish.
2. A base fails test A and the tip fails A plus new test B on either tip attempt: acceptance is `failed`, names B, and the group cannot finish, even if a later retry is green.
3. A base is green and the tip is red: acceptance is `failed`.
4. A task-check union command fails, but has matching recorded/collected base evidence: it follows the same comparison rule without requiring `suiteExits` to be non-empty; later union checks still run and are recorded.
5. The command or setup digest differs from a stored baseline: the record is not reused; a baseline is collected for the exact key or the result remains failed.
6. Unsupported/malformed reporter output, timeout, signal, setup failure, missing base, or ambiguous test identity cannot produce `passed-relative`.
7. A review-fix changes an existing test within `targetPaths`: acceptance is `test-change-pending`, evidence names the path, and the next step provides restore/recheck and the person-only disposition. This holds even if the check was green before the change or criteria-review auto-ratifies its flag.
8. A test weakening signal is detected in an added or modified test file, including `.only`/skip in a newly added file and removal of a test declaration with unchanged assertion count. The group's acceptance remains unsatisfied until disposition/restoration.
9. New test files without weakening signals and additive-only changes retain the no-extra-human-gate behavior.
10. The single-landing/no-full-suite path still evaluates test changes; `not-needed` cannot satisfy the group while a disposition is pending.
11. If the tip moves after a human disposition, the disposition no longer satisfies acceptance and checks rerun for the new tip.
12. D3 applies the baseline and test-change checks to the actual delivered commit; it cannot inherit a tip pass when the delivered tree differs.
13. `waive-acceptance` cannot clear the test-change gate. Accepting a test change cannot clear a separate command failure.
14. `group show` and `group brief` show why acceptance is relative/failed/awaiting disposition. If acceptance is satisfied and requirement review is not, they explain the two independent results and give the requirement-review next step.
15. Existing records and groups without a configured full suite preserve current command-check behavior unless a test-change disposition is pending.

## 8. Verification design

- Add direct runner tests for baseline evidence reuse, exact command matching, base collection after tip red, test-identity subset comparison, unsupported output, and cancellation/timeout refusal.
- Add an acceptance record/view test for the new result and all command attempts.
- Add an end-to-end driver test that lands a review-fix changing a pre-existing test inside `targetPaths`, runs the final acceptance, and proves it cannot become plain `passed` while unresolved.
- Add positive controls for a newly added test and an additive-only edit.
- Mutate each new gate independently: remove identity-subset comparison; permit exact-command mismatch; omit existing-test detection; allow auto-ratification to satisfy the acceptance gate; skip tip-move invalidation. Each mutation must make its named test fail.
- Preserve and rerun the existing baseline acceptance and criteria-protection criteria; do not weaken them as part of this work.

## 9. Decisions left to the human

## 9. Builder-check resolutions (controller calls, 2026-11-26)

The independent builder check raised questions about command ordering, flaky attempts, setup-sensitive cache reuse, TAP identity, single-landing shortcuts, waiver interactions, delivery-tail checks, and weaknesses in the existing test-change scanner. This design resolves them as follows:

1. Run every union check after a check-level red; only failed setup stops the union. A configured full suite that is also an exact union command reuses that invocation as its first attempt.
2. Aggregate failure identities across every tip attempt. A later green cannot erase a new red identity; known red identities may yield `passed-relative` only when every observed tip failure matches the baseline.
3. Baselines are scoped by the exact setup-command digest and parser version in addition to repo/base/command. Legacy base-check rows without that evidence are not reused. Green observations do not delete accumulated red identities for the same exact scope.
4. TAP identities include file path, nested test name, and normalized failure diagnostic; ambiguous identities, malformed TAP, and unexplained file-level failures are not comparable.
5. Every modification or deletion of an existing test file requires explicit disposition, regardless of current exit result. No test-file overlay run is needed to infer causality. New tests are checked for focus/skip signals; additive-only edits remain ungated.
6. The test-change gate runs even when full-suite acceptance is unset or the one-landing shortcut applies. It does not block landing, but it blocks group acceptance/done and delivery completion. It binds disposition to the checked tip/path digest.
7. Command waiver and test-change disposition are independent. Requirement-review runs for unrelated findings continue; a test-change-only finding offers restore/recheck or the person-only disposition, not only another review-fix.
8. D3 applies the same parser and test-change rules to the delivered commit. A previous tip's result is not inherited when the delivery tree differs.
9. Extend mechanical test classification to catch focus/skip/todo in added files and deleted test declarations, not only assertion-count drops.

These are the controller's reversible implementation calls for this session. They favor avoiding false acceptance over minimizing the human step when an existing test changes; the person can explicitly approve a justified test change without losing the original run evidence.
