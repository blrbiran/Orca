# Acceptance integrity: test scope, cached suite counts, and visible failure identities

- **Author:** Codex session `d1cffe`, 2026-11-28.
- **Status:** User authorized implementation on 2026-11-28 after selecting one cached baseline per exact suite identity; final review is deferred to the end of this session.
- **Issues:** #562, #564, #558, #580.
- **Related designs:** `2026-11-26-acceptance-baselines-and-test-changes-design.md`; `2026-11-12-group-acceptance-full-suite-design.md`; `2026-11-23-split-instruction-v9-design.md`.

## 1. Intent

A task must not become accepted because a change silently made its test suite run fewer tests. Orca must also recognize common full-suite commands, preserve the existing protection against commands that hide failure, and tell a person why a red result could not be compared with the base.

Today the acceptance test-change scan sees test source paths but skips files that define test discovery. The shortfall rule uses a base test count only when red test identities caused a base run, so a green tip can pass without any base count. The identity reader accepts one TAP block, compares paths without resolving filesystem aliases, and its comparison reasons are largely absent from views. Split validation has a separate exact-string suite allowlist, so normal runner options are rejected while some requirement hints use a different definition.

## 2. Goals

1. Gate changes to existing test-discovery and check-definition files, including relevant package scripts, CI workflows, and known test-runner configuration files.
2. Compare a full-suite run with the test count observed at its frozen base, including green tip runs.
3. Reuse one durable count observation for the exact `{repo, base, command, setup, reporter}` identity. Do not rerun the base suite on each acceptance.
4. Fail acceptance when both counts are available and the tip ran fewer than half as many tests as the base, whether the tip exited green or red.
5. Keep the existing failure-identity rule: a red tip can pass relatively only when all observed tip failures are known at the exact base/setup/command identity; later success cannot hide a new failure.
6. Parse repeated TAP sections emitted by a safe same-suite retry command, normalize symlink aliases, and surface non-comparable reasons in CLI and Web views.
7. Use one bounded full-suite command recognizer in requirement delivery hints and delivery-graph validation. Accept common full-suite/reporting forms while refusing shell forms that can hide failures.

## 3. Non-goals

- Do not run a suggested full suite unless a person has adopted it.
- Do not execute or infer arbitrary shell commands to decide whether they run the full suite.
- Do not accept pipelines or unconditional-success shell tails as proof of a full suite.
- Do not expand failure identity support beyond the node:test TAP reporter in this change.
- Do not reinterpret old acceptance records or retroactively infer their test counts.
- Do not change requirement-review verdicts, landing permissions, or the existing waiver authority for ordinary command failures. A measured suite-count shortfall is not waivable because the acceptance lacks evidence that the intended full suite ran.

## 4. Approaches considered

### A. Run the base suite for every acceptance

This gives a fresh count for every tip but adds a full test run every time. It repeats user-supplied check side effects and conflicts with the existing design's rule to run the base only when needed.

### B. Cache one baseline count per exact identity — selected by the user

On the first accepted-suite run for a frozen base, run the exact suite with the exact setup once at the base if no count is already available from durable failure-baseline evidence. Persist the result under the exact repository, base commit, command, setup digest, and reporter. Later groups with that same identity reuse it. The first use still has one base run; later checks do not. Tip output lacking a supported count or base output lacking a count is reported as unavailable rather than fabricated.

### C. Leave the shortfall rule on red paths only

This avoids new base runs but leaves the reported all-green shortfall undetected. It does not meet the issue's core user-safety goal.

## 5. Design

### 5.1 Test-definition change gate (#562)

- Extend the existing test-path predicate with known discovery/configuration paths: Vitest, Jest, Playwright, Karma, Mocha, pytest, tox, and `conftest.py` configuration forms.
- Treat edits/removals of existing `package.json` script keys, edits/removals of existing CI workflows, and any change to a known test configuration as test-definition changes. A newly added test-discovery configuration is also gated because auto-discovery can select it immediately. Adding a test source file remains additive unless the existing skip/focus/todo rules detect a weakening; adding an unrelated new package script or workflow remains additive.
- Keep scanning of files directly invoked by required checks and setup commands. Pass the acceptance's actual check/setup command set into the scan and reuse the existing command-path analysis rather than executing scripts to discover dependencies.
- Report changed package script keys as `script-changed:<path>#<name>`; do not claim that static inspection proved the script narrower. The existing person-only test-change disposition remains the resolution path.
- Apply the same scan to group acceptance and delivered acceptance. A scan failure remains fail-closed.

### 5.2 Durable suite-count baseline (#564)

- Add a schema migration for a separate suite-count baseline table. Its exact primary key is `(repo_id, base, command, setup_digest, reporter)`. Store observation state, optional test count, exit, provenance, and observation time. A successful count is immutable for that key; an uncountable completed observation is also recorded so repeated acceptances do not rerun the same base command.
- The initial reporter is `node-test-tap-v1`; this table is distinct from `acceptance_failure_baselines`, which continues to store failing test identities.
- Reuse an existing test count from matching failure-identity rows only when every row agrees on one non-null count and one exit. The old reader's independent `MAX(tests)`/`MAX(exit)` values are not a coherent observation when rows disagree.
- When no count exists, run the exact accepted suite and setup at the frozen base once, even when the tip suite is green. Do this only after the tip suite has run. In-process concurrent requests for the same key share one promise; a controller restart after a completed observation reads the durable row.
- If that base run is already needed to collect failure identities, use the same output to populate the count cache and identity table. If the count-only path discovers complete red identities, persist those too, so a later red tip does not run the base again for the same command.
- The shortfall comparison covers every observed tip suite invocation and uses the minimum counted tip run. `evidence.tests` and `fullSuite.tests` report that minimum; the record also keeps per-invocation counts. If any counted run has `tipTests * 2 < baseTests`, record `evidence.shortfall` and return `failed`, including on an otherwise green tip. Exactly half is not shortfall, preserving the existing coarse threshold.
- If any invocation lacks a node:test count, keep the existing exit/identity result but record and render that at least one count comparison is unavailable. Never display a missing comparison as if it had been performed.
- Do not retry an unavailable base count within the same acceptance. Infrastructure failure does not create a completed cache row and may be retried by a later acceptance; a completed command with unsupported output is cached as unavailable.

### 5.3 Bounded full-suite command recognition (#580)

- Replace the local anchored regex in split validation with one shared recognizer used by both `deliveryProblems` and `deliveryGraphProblems`.
- Recognize established full-run forms including `npm test`, `npm run test`, `npm run test:full`, `npm run test:unit`, `pnpm test`, `yarn test`, `node --test`, `npx vitest run`, `pytest`, `go test ./...`, `cargo test`, and `make test`.
- Recognize established full-run forms including `npm test`, `npm run test`, `npm run test:full`, `npm run test:unit`, `pnpm test`, `yarn test`, `node --test`, `npx vitest run`, `pytest`, `go test ./...`, `cargo test`, and `make test`.
- Permit only bounded output-only options covered by command-shape tests (for example `pytest -q`, `npm test -- --reporter=dot`, and `npm test --silent`). Do not permit test selectors, file arguments, excludes, or other options that narrow discovery.
- Permit the existing trailing `&& true` form. Reject `&&` composition with other commands and all `||` forms in `finalVerification`; explain that suite and lint checks should be separate commands and that Orca already retries a red full-suite check while retaining both outcomes. Reject `|| true`, `; exit 0`, pipelines, arbitrary shell wrappers, and quoted mentions. This avoids accepting a command whose suite failure can be masked or whose preceding command changes the test environment.
- At runtime, recognize only an exact same-suite `suite || suite` retry for ordinary checks and run its two branches as separately recorded invocations under one shared time budget. Preserve both exits and outputs. If a red branch has unsupported or ambiguous output, the comparison is non-comparable and acceptance fails, even when the second branch exits zero. Other shell `||` shapes are not used as a suite retry.
- The recognizer is structural and bounded. It does not evaluate shell expansion or execute a command.

### 5.4 Failure identity and user-facing reasons (#558)

- Parse each top-level TAP block independently, validate its reported failure count against that block's identities, and combine identities by stable key. Resolve a working directory and absolute TAP locations to real paths before creating repository-relative keys. If a location cannot be resolved, preserve fail-closed behavior.
- For the narrowly recognized same-suite `suite || suite` check form, execute each branch separately under one shared timeout and store every branch exit/output. A red branch without a complete supported identity parse makes the command non-comparable; a later green branch cannot make it an ordinary pass. For other shell commands, retain the command's normal exit behavior.
- Compare every red branch identity with the exact base identity set. A new identity or an unparseable red branch fails acceptance even when the overall retry command exits zero. Store per-run test counts and compare the minimum observed count with the cached base count.
- Display `new-failure`, `non-comparable`, `baseline-unavailable`, and `base-green` in `group show`, `group brief`, and the Web acceptance problem. Preserve the command, branch exits, and normal exit details.

## 6. Compatibility and safety

- Bump the panel schema through the existing migration chain, including every still-supported pre-26 version path; old rows remain readable and do not gain inferred counts.
- Keep group acceptance and D3 delivered-acceptance test-change scans aligned. D3 retains the same count evidence and shortfall reason; a command waiver on the tip cannot waive a shortfall on the delivered tree.
- Reuse a cached full-suite count for D3 only when its exact `{repo, base, command, setup, reporter}` key matches. D3 may still need a base identity run for other red commands; if so, it writes both identity and count evidence from that same run.
- Preserve exact command and setup identity for failure baselines; no prefix matching is introduced.
- The new cache has no expiry because the base commit, command, setup digest, and reporter version fully identify the measurement. A changed setup or command creates a new key.
- A new test config or existing script-key change may require person disposition even when its semantic effect is unknown. This conservative review gate is intentional; the record names changed paths and script keys.
- A count-unavailable record is visible but does not alone convert an otherwise green unsupported runner into `failed`; only a measured shortfall changes that result. This keeps the count rule bounded to the reporter it can verify.

## 7. Acceptance criteria

1. Modifying an existing `package.json` test script, workflow, or known test-discovery config appears in `testChanges.paths`, and group/delivered acceptance requires the existing person-only disposition.
2. Adding a normal test file or adding an unrelated new package script remains additive and does not create the test-change gate.
3. A green tip with 79 tests in any observed suite invocation and a cached base count of 552 is `failed`, includes the lowest observed tip count and the base count, and neither group nor D3 can finish or waive the shortfall.
4. A green tip with 552 tests against a cached base count of 552 remains `passed` and does not run the base suite again.
5. On a cache miss, the exact suite plus setup runs once at the base after the tip run and stores its count; any complete red identities from that same base run are also stored. A second acceptance with the same exact key reuses both pieces of evidence. A different base, command, or setup digest gets a distinct observation.
6. A completed base observation with unsupported/missing counts is visible as unavailable and is not repeatedly rerun. An infrastructure failure that prevents a completed run does not poison the cache.
7. Repeated TAP blocks are parsed independently. A same-suite retry check is executed as separate branches; a red branch with a known identity can pass only relatively, a new identity fails, and a red branch without a complete supported identity fails non-comparably even if a later branch exits zero.
8. `/tmp` and `/private/tmp` aliases produce the same repository-relative failure identity when both refer to the same real path.
9. The split validator and requirement-delivery hint agree for each tested command shape: output-only options and `npx vitest run` are accepted; test selectors, wrappers, pipelines, and constant-success forms are rejected with a direct safe alternative. `suite && true` remains accepted. `suite || suite` is rejected for final verification with the suggestion to use the direct suite command, which Orca retries while retaining attempt evidence.
10. `group show`, `group brief`, Board, and the Web acceptance problem display the comparison reason and branch outcomes for a failed or non-comparable result. CLI and D3 views retain the shortfall counts.
11. Drafts without `deliveryGraph` retain their existing behavior; every supported old schema migrates to the new baseline table without losing existing data.

## 8. Verification

- Add focused unit cases for path classification, package scripts, safe command forms, TAP block aggregation, and realpath normalization.
- Add acceptance integration cases for green shortfall, baseline cache reuse, a cache miss, unavailable counts, repeated TAP with same/new identities, and a changed suite-definition path.
- Add schema migration coverage for fresh and version-26 stores.
- Run the repository's affected test gate and typecheck/build. Do not run the full release gate unless the user asks for a release.
