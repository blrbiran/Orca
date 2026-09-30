# Task 1 review — text-site scan and inventory (a404adb..57c84da)

Reviewer: task-reviewer subagent of session `e604b1ba` controller, 2026-10-01, reviewing commit `57c84da` (parent `a404adb`). Read-only on the repository; every reviewer run was in `$SCRATCH/rev-t1` (a plain copy of the script and test plus a `node_modules` symlink), not in the main tree.
`SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`

### Spec Compliance

- ✅ Spec compliant. Both files are byte-identical to the brief's Step 1 and Step 3 blocks: `cmp` of the blocks extracted by awk against `tests/panel/scanPanelText.test.ts` and `scripts/scan-panel-text.mjs` gave rc=0 for both (`$SCRATCH/rev-t1/cmp1.txt`, `cmp2.txt` are empty). Running the committed script against the repo at `57c84da` gives 1089 rows (`$SCRATCH/rev-t1/base-all.txt`), the same as the brief's count. Interface matches the brief: `[--ui] [<root>]`, not recursive (`scan-panel-text.mjs:17` uses `readdirSync`), `i18n.ts` skipped (`:17`), exit 0.
- ⚠️ Cannot verify from diff: that the 387 ui rows match the inventory table byte for byte. The implementer reports `cmp` rc=0 (`$SCRATCH/t1-inventory-cmp.txt`). I did not repeat it. The total count I measured (1089) agrees.

### Strengths

- The script and the criterion are exactly what the brief specified (mechanical extraction; I confirmed it with `cmp`).
- The implementer added two mutations the brief left out (MT1-7 import skip, MT1-8 literal-type skip). Both showed red, and the implementer reported the branches that remain unpinned instead of leaving them out. The restore proofs are `cmp`-based.
- The criterion checks the full output with `toEqual` on the whole line list (`scanPanelText.test.ts:47-63`). So a changed label, class, line number or order in any fixture row turns it red. It is not a substring check.
- The `mkdtemp` roots are not removed by the test. That is fine: `vitest.config.ts` loads `tests/setup/scopeTmpdir.ts`, and the implementer's `check-tmp-leak` run reports `2 tests, 0 entries left` (`$SCRATCH/t1-tmp-leak.txt`).

### Issues

#### Critical (Must Fix)

None.

#### Important (Should Fix)

1. **Several classification/skip branches can be deleted and the criterion stays green (Rule 9; Global Constraints "Every new branch gets a named deletion mutation seen red"). This comes from the plan: the fixture and mutation list are the brief's own.** I ran each deletion on a scratch copy of the script with an exact, once-only replacement (`$SCRATCH/rev-t1/mut.cjs`). For each one I ran the criterion (`$X-test.txt`) and a scan of the real repo, diffed against the unmutated scan (`$X-realdiff.txt`):

   | Mutation (scan-panel-text.mjs line) | Criterion | Real-repo scan diff | Direction if it regresses |
   |---|---|---|---|
   | A: drop `\|\| ts.isExportDeclaration(p)` (:24) | green | 0 lines | extra rows |
   | B: drop property-name skip (:25) | green | 12 lines (`prop:"x-orca-token"` etc.) | extra rows |
   | C: drop element-access skip (:26) | green | 0 lines | extra rows |
   | D: drop `if (ts.isCaseClause(p)) return "case";` (:31) | green | 76 lines (22 case rows relabelled `CaseClause`) | wrong labels; a two-word `case` literal would become `ui` |
   | E: drop `\|\| ctx === "case"` in `classOf` (:47) | green | 0 lines | a two-word `case` literal would become `ui` |
   | F: drop `\|\| ts.isNoSubstitutionTemplateLiteral(node)` (:66) | green | 0 lines | **sites disappear**: a `` `plain words` `` literal is never listed |
   | I: drop the `!letters.test(staticText)` gate (:57) | green | 290 lines, 37 of them new `ui` rows (`(`, `)`, `·`) | extra rows |

   F is the dangerous one. Task 11 uses this scan to pin "nothing but the allow-list is untranslated". Losing a whole literal kind silently makes Task 11 blind to it, and nothing here would notice. D/E and I cannot hide untranslated text, but they change the inventory's output, and nothing pins them. The three the implementer flagged (A, B, C) are real gaps too, but they are the least harmful: they only add rows.
   Fix: add one fixture line per branch to `SAMPLE`: `export { thing as other } from "./other words.js";`, an object with a quoted two-word key, a `MAP["two word key"]` access, a `switch` with `case "two case words":`, a `` const NOSUB = `plain template words`; `` (this should appear as a `ui` row), and a `{" · "}` JSX child (this should appear as no row). Update test 1's expected list and test 2's count to match, then add mutations MT1-9…MT1-15 for A–F and I, each seen red.

#### Minor (Nice to Have)

1. The `--ui` filter mutation was not run by the implementer. I ran it (G: `if (!uiOnly || cls === "ui")` → `if (true)`). Result: rc=1, and `prints only the ui rows with --ui` is red at `scanPanelText.test.ts:70` (`every(startsWith("ui\t"))` false) (`$SCRATCH/rev-t1/G-test.txt`). The branch is pinned. It only needs listing as a mutation in the controller's record.
2. Context labels `arg:`, `prop:`, `cond`, `binary:`, `array` and the `SyntaxKind` fallback (`scan-panel-text.mjs:32-40`) have no fixture row. Deleting any of them changes only the label in real output, not the class (the class comes from the generic two-word rule). They are cosmetic for Task 11, but the inventory prints them.
3. `args.find((arg) => arg !== "--ui")` (`:14`) treats any other flag (such as a mistyped `--iu`) as the root path. The script then fails with an ENOENT stack instead of a usage error. Harmless for the plan's fixed invocations.

For the record, check H: dropping the `jsx-expr` context (`:29`) turns the criterion red (`H-test.txt` rc=1), so that branch is pinned.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** The code is exactly what the plan asked for, and the base inventory reproduces. But seven branches, including one that would silently drop a whole kind of literal from the scan Task 11 depends on, can be deleted with the criterion still green. That breaks the plan's own binding mutation rule, and the fix is a few fixture lines plus their mutations.

## Re-review (fix round 1)

Re-reviewer: scoped re-review subagent of session `e604b1ba` controller, 2026-10-01, reviewing fix `57c84da..fdc7343` (diff `review-57c84da..fdc7343.diff`). Read-only on the repository. Mutations ran only in `$SCRATCH/rerev-t1`, a `git clone --local` checked out at `fdc7343` with a `node_modules` symlink. Each edit was an exact, once-only replacement (`$SCRATCH/rr-mut.cjs` exits 2 unless there is exactly one match). Every restore `cmp` gave rc=0 (`$SCRATCH/rr-<X>-restore.txt`). At the end the clone's `git diff` and `git diff --cached` were both 0 bytes.

### Finding Verdicts

- **Important 1: seven branches deletable with the criterion green** (`scripts/scan-panel-text.mjs` :24 export-from, :25 quoted key, :26 `x["key"]`, :31 `isCaseClause`, :48 `ctx === "case"`, :66 `isNoSubstitutionTemplateLiteral`, :57 letters gate; line numbers from the file at `fdc7343`). **ADDRESSED.** `tests/panel/scanPanelText.test.ts:35-40` adds fixture lines `Sample.tsx:17-22`, one per branch. `:74-75` adds the expected `case` (code) and `const:NOSUB` (ui) rows, and `:82` moves the ui count from 8 to 9. The script is unchanged in the fix diff (the diff touches only the test file). I spot-checked four of the seven mutations myself. Each one turned both tests red on exactly the fixture row it targets:
  - Baseline at `fdc7343`: rc=0, 2 passed (`$SCRATCH/rr-base.txt`).
  - F, delete ` || ts.isNoSubstitutionTemplateLiteral(node)`: rc=1 (`rr-F.txt`). The `ui :21 const:NOSUB "plain template words"` row disappears, and the count fails with 8 ≠ 9. This was the dangerous gap (a literal kind disappearing silently), and it is now pinned.
  - E, delete ` || ctx === "case"`: rc=1 (`rr-E.txt`). Row `:20` flips from `code` to `ui`, and the count fails with 10 ≠ 9.
  - I, delete ` || !letters.test(staticText)`: rc=1 (`rr-I.txt`). The row `+ ui :22 jsx-expr " · "` appears, and the count fails with 10 ≠ 9.
  - A, delete ` || ts.isExportDeclaration(p)`: rc=1 (`rr-A.txt`). The row `+ ui :17 ExportDeclaration "./other words.js"` appears, and the count fails with 10 ≠ 9.
  - I did not repeat B, C and D (MT1-10, -11, -12). The implementer's report lists each with evidence files and specific red diffs. Their fixture lines (18, 19, 20) contain two-word text, so deleting the skip or the case context would add a row or relabel one, and the whole-list `toEqual` catches both.

### New Breakage in the Fix Diff

None. The added lines are appended after the old line 16, so the existing rows keep their line numbers. The comment sits in the array literal as a TS comment, not inside the fixture string.

### Out-of-Scope Observations

None beyond the original review's Minor 2 and 3, which remain as filed.

### Verdict

**Fix round:** All findings addressed, no new Critical/Important breakage.
