## Part A — Refusals (spec §2)

> **Controller amendment (2026-10-08, binding).** Review Focus 3 and 5 (plan index): A1's five-problem criterion uses a
> task id containing a non-ASCII character (e.g. `任务a`) in `missing-target-version:` and keeps the comma-in-zod-message
> case; A4's decode test feeds that same detail. A3 adds a criterion that an English viewer shown a code with **no**
> `enErrors` entry sees the server message next to the raw code (the fallback).

Measured at commit `b04e2cb` (`docs(spec): revise the issue-fixes design after independent review`) in the worktree
`/Users/biran/code/skills/loop/Orca-issues`. Every line range below is from that commit; an executor re-reads the
anchor text, not the number, before editing.

Existing tests this part rewrites (the human approved rewriting tests the spec requires):

| File | Test | Why (spec) |
|---|---|---|
| `tests/control/requirementSplit.test.ts` | "hands back what the Web import refuses beyond the checks above, by its detail" | `import:control-metadata` no longer exists; the same plan is now `import:missing-success-conditions` (§2.2(c), §2.3 last bullet). The comment above "hands back a repeated dependency and repeated criterion texts (Web import) beside every other reason" says the import stops at its first refusal, which becomes false; only that comment changes. |
| `tests/panel/refusalCoverage.test.ts` | "has a Chinese entry for every catalog code, every web-made code and every hand-listed code"; "interpolates nothing but the refusal's message and status, and has no empty entry" | Extended to English and to view-shown reasons; the placeholder allowlist gains `detail` (§2.2(a), §2.3 first bullet). |
| `web/tests/refusalText.test.tsx` | "renders an English refusal's message byte for byte in the refusal, the error page and the control line" | English now shows its own entry for a known code (§2.1 root cause 1, §2.2(a)); byte-for-byte stays the fallback for a code with no entry. |
| `web/tests/controlState.test.ts` | "clears the conflicted group cache on a revision conflict without touching drafts" | The reducer keeps one refusal per group instead of one global `refusal` (§2.2(d), §2.3 last bullet). |
| `web/tests/decisionsStatusFilter.test.tsx` | "opens a reviewed decision with the correction form, and a second correction shows the refusal" | It pins the English refusal text to the fixture's server message byte for byte; English now shows the `correction-already-recorded` entry (§2.2(a)). |

How tests run in this part:

- Root (server, coverage): `cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/vitest run <file> > $S/out.txt 2>&1; echo rc=$?`, then read `$S/out.txt` whole (`$S` = the executor's scratchpad).
- Web: `web/package.json` has no `test` script (only `check` = `tsc --noEmit -p tsconfig.json && vitest run`), and `web/node_modules/.bin` does not exist (the workspace is hoisted). A single web file runs from `web/` with the root binary, which picks up `web/vite.config.ts` (jsdom per file, `tests/setup.ts` forces English):
  `cd /Users/biran/code/skills/loop/Orca-issues/web && ../node_modules/.bin/vitest run tests/<file> > $S/out.txt 2>&1; echo rc=$?`.
- Web typecheck: `cd /Users/biran/code/skills/loop/Orca-issues/web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > $S/tsc.txt 2>&1; echo rc=$?`. Root typecheck: `npm run typecheck` (it includes `tests/**/*.ts`, so it also type-checks the coverage test's import of `web/src/locales/en.ts`).
- Mutation clone (every Step 5): `M=$S/mut-<task> && git clone --local /Users/biran/code/skills/loop/Orca-issues "$M" && ln -s /Users/biran/code/skills/loop/Orca-issues/node_modules "$M/node_modules" && ln -s /Users/biran/code/skills/loop/Orca-issues/web/node_modules "$M/web/node_modules"`, then copy this task's changed files into `$M` (`cp` each path under **Files**), apply the named mutation in `$M` only, run the named test in `$M`, read the output whole, and check `git -C /Users/biran/code/skills/loop/Orca-issues diff --stat` is byte-identical before and after.

---

