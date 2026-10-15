### Task S3 (ccloop): Retitle the context-window criterion (correction K8)

ccloop's own rules apply (its `CLAUDE.md` Rules 13-17): the human named this criterion (2026-10-15); title only, assertions unchanged; Rule 15(c) wants the ruling written beside it, and Rule 16 keeps the published comment at `:79` verbatim, so a comment line is **appended** after it.

**Files:** ccloop `tests/agents/registry.test.ts:79-80`.

- [ ] **Step 1: Worktree** (worktree creation is allowed; deleting it later is the human's)

```bash
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop status --porcelain > /private/tmp/oec/logs/s3-ccloop-status.log 2>&1
/usr/bin/git -C /Users/biran/code/skills/orca/ccloop worktree add -b test/registry-title-omp /Users/biran/code/skills/orca/ccloop-wt/registry-title main > /private/tmp/oec/logs/s3-wt.log 2>&1; echo rc=$? >> /private/tmp/oec/logs/s3-wt.log
ln -s /Users/biran/code/skills/orca/ccloop/node_modules /Users/biran/code/skills/orca/ccloop-wt/registry-title/node_modules
```
Read both logs (ccloop main = `dc51022…`, record the full sha). ccloop's `.gitignore` `node_modules/` does not match a symlink: `git status` shows `?? node_modules`; never `git add -A` there.

- [ ] **Step 2: Baseline** — `cd …/ccloop-wt/registry-title && ./node_modules/.bin/vitest run tests/agents/registry.test.ts --reporter=json --outputFile=/private/tmp/oec/logs/s3-before.json > /private/tmp/oec/logs/s3-before.log 2>&1`; read; note the pass count and every `fullName`.

- [ ] **Step 3: Edit** — keep line 79 (`// Spec §12 I6: a requested window is not an observation; only claude's verified 1M mapping is reported.`) verbatim; after it insert `  // Human ruling (2026-10-15, Orca session 026d10e3): title renamed only -- omp reports its catalog row's contextWindow (src/agents/omp.ts capabilities), which this criterion does not assert; its assertions are unchanged.`; line 80's title becomes `"reports claude's contextWindowTokens only for its verified 1M mapping and codex's as null (omp reads its own from its catalog row)"`.

- [ ] **Step 4: Verify** — the same run to `s3-after.json`/`s3-after.log`; `npm run typecheck > /private/tmp/oec/logs/s3-tc.log 2>&1`; `/usr/bin/git -C …/ccloop-wt/registry-title diff --stat > /private/tmp/oec/logs/s3-diffstat.log 2>&1` and `diff > s3-diff.log`. Read all: same pass count, the old title absent and the new present in `fullName`s, typecheck `rc=0`, the diff touches only `tests/agents/registry.test.ts` (1 insertion for the comment, 1 changed line). No mutation applies: no assertion or code changed (the criterion's existing mutation coverage is unaffected).

- [ ] **Step 5: Commit (ccloop)** — `/usr/bin/git -C …/ccloop-wt/registry-title add tests/agents/registry.test.ts`; message `test(agents): retitle the context-window criterion now that omp reports its catalog window` + trailer. Pushing, merging and the repin are the human's (`awaitingHuman`); Orca's pin does not need to move for a test-title change.

---

