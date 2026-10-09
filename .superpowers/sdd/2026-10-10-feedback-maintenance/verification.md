# Feedback maintenance verification

Controller, 2026-10-10 Asia/Shanghai. Executed in the primary checkout on `codex/feedback-maintenance-20261010`; tested uncommitted source anchored by `source-proof.json` (observed documentation commit 09d01dd). All 243 backend source files and package/lock bytes equal that observation; installed hidden lock and manifest pin are ab824d16004de2d3c1613a76ec0431520aa16cc9. Web final source hashes remained stable through close. No backend/protocol/schema/pin changes.

## Final evidence

| Actual command (through saved-environment run.py) | Exit / observed result |
|---|---|
| node_modules/.bin/vitest run --maxWorkers=2 | 0; 371 files, 3505 passed, zero failed, four skipped; 1250.23 s |
| npm run --workspace web check -- --maxWorkers=2 | 0; TypeScript plus 92 files, 751 passed, zero failed/skipped |
| npm run build; npm run typecheck | both 0 |
| npm run build --workspace web (web-build-accepted) | 0; JS 592.97 kB, gzip 182.58 kB; 500 kB warning retained |
| npm run verify:panel | 0; actual PASS 0–14 |
| npm run verify:ccloop-pin | 0; inner 3 passed/zero failed/zero skipped |
| clone-final-green: six final web criterion files | 0; 60 passed |
| node scripts/check-tmp-leak.mjs --root web [six same files] --maxWorkers=2 | outer 0 AND inner Vitest 0, 60 tests, zero entries |
| tests/entry/skill.test.ts; tests/panel/refusalCoverage.test.ts; tests/panel/webParity.test.ts | 0; 6, 5 and 5 respectively, separately recorded |
| official skill-creator quick_validate.py skills/orca-control | 0; Skill is valid |
| node scripts/check-claude-md-lines.mjs; check-hooks-path.mjs | both 0 |
| node dist/cli.js validate .decisions | 2; seven pre-existing bound-row tier-0 downgrades, ledger bytes unchanged |

The root command's actual control subset is 155 files/1735 passed/three default-pin skips; scheduler subset is 56 files/202 passed. This is actual root-run inclusion, not a separate rerun of verify:control/verify:scheduler wrappers. All protocol criteria and isolated ccmem/syncskill real CLI criteria executed; full file counts are in root-file-counts.json. Default-pin skips have independent pin 3/3. The fourth skip is real launchd (tests/service/realSmoke.test.ts), which was not authorized/run.

Runtime HOME, XDG, TMPDIR, CCMEM_DATA_ROOT and corrections use owned temporary roots. CCMEM_CONFIG_PATH removed. ORCA_CCLOOP_BIN is fixed-pin clone build absolute path; agents table points at that clone's fake codex integration fixture. Real CLI import/export/skills checks remain isolated. No paid provider, real database upgrade, daemon or human panel action. Web build preceded panel verification.

## Regression and review

First-pass independent review: 0 Critical/2 Important/1 Minor; scoped first follow-up retained one accepted-requirement edge. Final scoped review: Ready, 0 Critical/0 Important/0 Minor; historical findings preserved in final-review.md. Actual App tests cover archive success/refusal, clarifying/accepted unarchive, real persisted lost-result lookup for both states, and no additional POST. Component tests cover custom installation kind, default delegation, pending calls/stops, archived read-only variants/filter and exact diagnostic access.

Final-mutations.json records 20 independent deletion variants on the final source clone, each RC1 at its intended business assertion, with git working AND cached diff 0 bytes after each restoration. The earlier 17 full-focused and 17 qualified campaigns are retained at their own source snapshots, not substituted for final coverage. Final restored clone passed all 60 focused tests. No mutation touched primary product files.

## Preserved failures and limitations

Native logs/paired RCs remain unchanged: initial web baseline overlapped a new styles test and is not an untouched baseline; initial RED expected missing behaviors; bad new button wording, old-alert wait, wrong persisted-key exporter, wrong accepted fake epoch and nonoptional owner variable were diagnosed individually. Full-web intermediate failures were catalogue expectations or test/TypeScript setup errors, not registered flakes. All final checks above supersede those results for acceptance without rewriting them. The earlier tsx ledger attempt failed at sandbox IPC listen EPERM (RC1), then native built CLI returned the actual historical ledger RC2.

The official skill validator initially failed on three installed interpreters missing PyYAML. PyYAML6.0.3 was installed only in an owned temporary target, without repo/system dependency changes; final official validator returned RC0. Wrapper calls that named nonexistent refusalCoverage/webParity paths are explicitly not claimed as those checks; the real panel-path files were run separately.

Actual browser geometry is unverified. CUA denied a file URL by protocol policy; no alternate surface/HTTP workaround was attempted. Passing DOM wrapper and CSS criteria do not prove real desktop/mobile/short-height scrolling. This remains a human visual acceptance item. SQLite experimental warnings, Vite size warning and seven historical ledger downgrades remain. No production-readiness or performance change claim.

Raw evidence includes complete native logs, paired RCs, exact argv, review diffs, source hashes, mutation scripts/results and clone anchors. It excludes environment files, credentials, user databases and dependency packages. Whole-buffer audit records native lengths/SHA, named failures and summaries; every archive member was reread and compared.

Archive: evidence.tar.gz, 253 members / 265725 bytes, SHA256 ff37c346f313f2bed54bf3da26ce3582266d4f70b713cc6961dd1ae7740f7e2e.

Final product observation: local commit7832457 (`fix(panel): clarify capabilities and complete requirement archive controls`) contains the identical tested backend/Web source bytes. Subsequent changes are handoff/plan-progress/evidence documentation only; current HEAD is not fixed by this report. No Orca main integration/push/runtime switch.
