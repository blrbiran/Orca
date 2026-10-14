# Brief: feedback #62 (with #45/#48) — a Codex 429 shows only a raw code

Repository: Orca, worktree /Users/biran/code/skills/orca/Orca-wt/web-start-running, branch fix/web-start-group-running. Read /Users/biran/code/skills/orca/Orca-wt/omp-single-call/.superpowers/sdd/2026-10-14-omp-single-call/hard-rules.md (use THIS worktree), CLAUDE.md, web/DESIGN.md.

## Facts
- ccloop (pinned 3069dbf, Orca package.json) throws `codex-rate-limited: <evidenceDir>` when Codex answers HTTP 429 before work and its in-phase backoff (30/60/120 s) is used up, or after work (ccloop src/runtime/codex/codexAdapter.ts:69, main checkout /Users/biran/code/skills/orca/ccloop). Usage books 0 before work.
- Orca shows a run's failure / blocked reason through a code→friendly-text table: web/src/locales/en.ts `enErrors` and zh.ts `zhErrors` (key sets kept equal by tests/panel/refusalCoverage.test.ts, which also pins controlErrorCatalog() count — read it first), rendered by RunReason with the raw code beside it.
- Root cause is the provider's quota window (measured ~3.4 h to recover); triage: do the COPY only, no longer backoff.

## Do
1. Find how a run's failure reason code reaches RunReason (which table: enErrors/zhErrors, a separate run-reason table, or `diagnosis`) — read, do not guess. Find whether codes coming from ccloop (not Orca's own controlErrorCatalog) are looked up the same way, and how `{{detail}}` is derived (message after `<code>:` — here the evidence dir path).
2. Add `codex-rate-limited` with an en and zh text: says the provider rate-limited the Codex call (HTTP 429) and it should be retried later (e.g. after the provider's quota window), and that it booked no usage before work; do NOT interpolate the evidence-dir path into the sentence (it is a local path; the raw code stays visible beside it). Wording: plain, one or two sentences, matching neighbours.
3. If adding a key to that table changes a pinned count or catalog (refusalCoverage), follow the test's rule for where the key belongs; if keeping the test green needs editing the test itself, STOP and report.
4. Criterion (seen red first): a DOM test that a failed run whose reason is `codex-rate-limited: /x/y` shows the friendly en text AND the raw code, and in zh the full zh text; plus a "put the English back" mutation on the zh entry. Mutations in a `git clone --local` copy under /private/tmp/osc/mut/w62 (drop the entry; zh = en text) each red on its named assertion; restore via cat, sha256, git diff/--cached 0 bytes.
5. Gates: web tsc, web build, web full tests, root tests/panel (refusalCoverage, scanPanelText) and tests/metrics. Redirect to /private/tmp/osc/logs/w62-*.log, read whole, RC. Known web load flakes (3/3 alone): reviewApp, controlCommandRecovery, loopPlanDraft, projectSwitcher.
6. Commit `git commit -F`: fix(web): ... ; trailers per hard-rules.

## Report
You cannot write report files. Final message: the lookup path (file:line), the text added (en, zh), RED/GREEN, mutation table, gates with RC, commit. Then the short status contract.
