# Task 1 report — text-site scan and inventory

Implementer: subagent of session `e604b1ba` controller, 2026-10-01. Worked on local `main`, BASE `a404adb`.
`SCRATCH=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/e604b1ba-577a-4ce7-8f12-db0a3ee0d5b1/scratchpad`

## Status: DONE

## What was built

- `scripts/scan-panel-text.mjs` — verbatim from the brief's Step 3 block (extracted mechanically from the brief's fenced block, not retyped).
- `tests/panel/scanPanelText.test.ts` — verbatim from the brief's Step 1 block (same extraction).

## Commit

- `57c84da` feat(scripts): list every text site of the web panel by a TypeScript parse (parent `a404adb`).
  Message read back with `/usr/bin/git log -1 --format=%B > $SCRATCH/t1-commit-msg.txt`: ends with exactly the two trailer lines.

## Commands and evidence (all run with `export TMPDIR=$(mktemp -d /private/tmp/cl-XXXX) ECC_GATEGUARD=off DISABLE_OMC=1`)

| Step | Command | Output file | Result |
|---|---|---|---|
| 2 red | `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts` (test file only, no script) | `$SCRATCH/t1-red.txt` | rc=1; both tests red at `expect(rc).toBe(0)` (received 1: node cannot find the script) |
| 4 green | same | `$SCRATCH/t1-green.txt` | rc=0; 2 passed |
| 4 scan all | `node scripts/scan-panel-text.mjs .` | `$SCRATCH/t1-scan-all.txt` | rc=0 |
| 4 scan ui | `node scripts/scan-panel-text.mjs --ui .` | `$SCRATCH/t1-scan-ui.txt` | rc=0, read whole |
| 4 counts | `wc -l` of both | `$SCRATCH/t1-scan-count.txt` | 1089 and 387 — matches the drafter's measurement at `ac969bb` |
| 4 typecheck | `npm run typecheck` | `$SCRATCH/t1-tsc.txt` | rc=0 |
| 4 inventory compare | brief's inventory block rewritten as `ui\t<site>\t<ctx>\t<text>` (task column dropped) → `$SCRATCH/t1-inventory-as-scan.txt`; `cmp` against `t1-scan-ui.txt` | `$SCRATCH/t1-inventory-cmp.txt` | rc=0, empty: the 387 ui rows are byte-identical to the inventory table, same order. The base did not move. |
| 4 code breakdown | node count of code rows by context prefix | `$SCRATCH/t1-code-breakdown.txt` | 702 rows: attr 218, compare 126, prop 103, array 81, arg 73, return 25, binary 24, case 22, cond 16, const 14 — matches the brief exactly |
| extra | `node scripts/check-tmp-leak.mjs tests/panel/scanPanelText.test.ts` | `$SCRATCH/t1-tmp-leak.txt` | rc=0, 0 entries left |

The scans ran before the commit, with web/src untouched since `a404adb`, so they are the base inventory.

## Mutations (clone `$SCRATCH/mut-t1`, `git clone --local` at `a404adb`; kept)

Clone: `$SCRATCH/t1-clone.txt` rc=0; copy: `$SCRATCH/t1-copy.txt` empty. Each edit was an exact, once-only string replacement (`$SCRATCH/t1-mutate.cjs` exits 2 unless there is exactly 1 match); criterion run from `$M`; restore `cmp` rc=0 with an empty file every time (`$SCRATCH/t1-MT1-N-restore.txt`). The clone's `git diff` is 0 bytes at the end.

| Mutation | Edit | Evidence | Seen red |
|---|---|---|---|
| MT1-1 JSX text dropped | deleted `if (text !== "") emit(node, "jsx-text", text, text);` | `t1-MT1-1.txt` rc=1 | test 1: `Heading text` row missing; test 2 also red (7 ≠ 8) |
| MT1-2 text attributes dropped | `TEXT_ATTRS.has(ctx.slice(5)) ? "ui" : "code"` → `"code"` | `t1-MT1-2.txt` rc=1 | test 1: aria-label and title rows become `code`; test 2: 6 ≠ 8 |
| MT1-3 two-word rule dropped | deleted `twoWords.test(staticText) || ` | `t1-MT1-3.txt` rc=1 | test 1: `"Two words"` becomes `code`; test 2: 7 ≠ 8 |
| MT1-4 word-by-space rule dropped | `(isTemplate && wordBySpace.test(staticText))` → `false` | `t1-MT1-4.txt` rc=1 | test 1: `answered ${status}` becomes `code`; test 2: 7 ≠ 8 |
| MT1-5 i18n.ts scanned | deleted ` && f !== "i18n.ts"` | `t1-MT1-5.txt` rc=1 | test 1: `web/src/i18n.ts:1 const:inI18n` row appears; test 2: 9 ≠ 8 |
| MT1-6 comparisons as ui | deleted `if (ctx === "compare" || ctx === "case") return "code";` | `t1-MT1-6.txt` rc=1 | test 1: `"not ui words"` becomes `ui`; test 2: 9 ≠ 8 |
| MT1-7 (added) import skip dropped | deleted `ts.isImportDeclaration(p) || ` | `t1-MT1-7.txt` rc=1 | test 1: `ImportDeclaration "./thing words.js"` row appears; test 2: 9 ≠ 8 |
| MT1-8 (added) literal-type skip dropped | deleted ` || ts.isLiteralTypeNode(p)` | `t1-MT1-8.txt` rc=1 | test 1: `LiteralType "a b"` row appears; test 2: 9 ≠ 8 |

## Deviations from the brief

- The brief predicted MT1-1, MT1-3, MT1-4, MT1-5 and MT1-6 would turn only test 1 red. In practice test 2 (the ui count) also went red for each of them. That is extra red, not missing red, and the named test was red and read every time.
- Added MT1-7 and MT1-8 for the import and literal-type skip branches, which the test's title claims but the brief's mutation list did not cover (Rule 9: every branch needs a deletion mutation seen red).

## Concerns

- Branches still without a deletion mutation: the `ExportDeclaration`, property-name and element-access-argument skips in `context()`, and the `--ui` filter itself. For `--ui`, test 2's `every(startsWith("ui\t"))` plus the count 8 would catch a dropped filter (the count would be 14), but that was not run as a mutation. The fixture has no `export … from "…"`, no quoted property name and no `x["key"]`, so the first three branches are unpinned. These are left for the controller to decide on, since the brief did not name them.
- Clone `$SCRATCH/mut-t1` is kept (deleting it needs the human).

---

## Fix round 1 (review `task-1-review.md`, Important finding 1)

Implementer: the same subagent of session `e604b1ba` controller, 2026-10-01. Fixed on top of `57c84da`. Following the controller's ruling, only the fixture and expectations changed: `scripts/scan-panel-text.mjs` is byte-unchanged (`/usr/bin/git diff --stat HEAD -- scripts` → `$SCRATCH/t1f-script-diff.txt`, empty).

Note: the review's line numbers are one higher than the committed file's (the review's :25 export skip is file line 24). Mutations were anchored on code text, not line numbers.

### Test change (`tests/panel/scanPanelText.test.ts`)

Six fixture lines were appended as `Sample.tsx` lines 17–22, so the existing rows keep their line numbers. There is also a comment stating what they pin:

| Fixture line | Pins | Expected |
|---|---|---|
| 17 `export { thing as other } from "./other words.js";` | export-from skip | no row |
| 18 `const TABLE = { "two key words": 1 };` | quoted-key skip | no row |
| 19 `const pick = TABLE["two key words"];` | element-access skip | no row |
| 20 `switch (KEY) { case "two case words": break; }` | `isCaseClause` context + `ctx === "case"` class | `code … :20 case "two case words"` |
| 21 ``const NOSUB = `plain template words`;`` | `isNoSubstitutionTemplateLiteral` | `ui … :21 const:NOSUB "plain template words"` |
| 22 `export const Dot = () => <i>{" · "}</i>;` | `letters` gate | no row |

Test 1's expected list gained the two rows above. Test 2's ui count is now 8 → 9.

### Commands (all with `export TMPDIR=$(mktemp -d /private/tmp/cl-XXXX) ECC_GATEGUARD=off DISABLE_OMC=1`)

| Command | Output | Result |
|---|---|---|
| `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts` | `$SCRATCH/t1f-green.txt` | rc=0, 2 passed |
| `npm run typecheck` | `$SCRATCH/t1f-tsc.txt` | rc=0 |
| `node scripts/scan-panel-text.mjs .` / `--ui .` | `$SCRATCH/t1f-scan-all.txt`, `t1f-scan-ui.txt` | rc=0 both |
| `wc -l` | `$SCRATCH/t1f-scan-count.txt` | 1089 / 387 |
| `cmp t1f-scan-ui.txt t1-inventory-as-scan.txt` | `$SCRATCH/t1f-inventory-cmp.txt` | rc=0, empty (still byte-identical to the inventory) |
| `cmp t1f-scan-all.txt t1-scan-all.txt` | `$SCRATCH/t1f-all-cmp.txt` | rc=0, empty (full scan unchanged) |
| copy script+test into the kept clone `$SCRATCH/mut-t1` | `$SCRATCH/t1f-copy.txt` | empty |
| criterion in clone before mutating | `$SCRATCH/t1f-clone-green.txt` | rc=0, 2 passed |

Red-before: the script is deliberately unchanged, so the new expectations are green on it by construction. Their red evidence is the mutations below. Each deletes the branch the line pins.

### Mutations (kept clone `$SCRATCH/mut-t1`; exact once-only replacement via `$SCRATCH/t1-mutate.cjs`; each restore `cmp` rc=0 with an empty `$SCRATCH/t1-MT1-N-restore.txt`)

| Mutation | Edit | Evidence | Seen red (test 1 diff; test 2) |
|---|---|---|---|
| MT1-9 export-from skip | deleted ` \|\| ts.isExportDeclaration(p)` | `t1-MT1-9.txt` rc=1 | `+ ui :17 ExportDeclaration "./other words.js"`; 10 ≠ 9 |
| MT1-10 quoted-key skip | deleted `if (ts.isPropertyAssignment(p) && p.name === node) return null;` | `t1-MT1-10.txt` rc=1 | `+ ui :18 prop:"two key words"`; 10 ≠ 9 |
| MT1-11 element-access skip | deleted `if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return null;` | `t1-MT1-11.txt` rc=1 | `+ ui :19 ElementAccessExpression "two key words"`; 10 ≠ 9 |
| MT1-12 case context | deleted `if (ts.isCaseClause(p)) return "case";` | `t1-MT1-12.txt` rc=1 | `:20` becomes `ui … CaseClause`; 10 ≠ 9 |
| MT1-13 case class rule | deleted ` \|\| ctx === "case"` | `t1-MT1-13.txt` rc=1 | `:20` becomes `ui … case`; 10 ≠ 9 |
| MT1-14 plain template literal | deleted ` \|\| ts.isNoSubstitutionTemplateLiteral(node)` | `t1-MT1-14.txt` rc=1 | `- ui :21 const:NOSUB` (the row vanishes); 8 ≠ 9 |
| MT1-15 letters gate | deleted ` \|\| !letters.test(staticText)` | `t1-MT1-15.txt` rc=1 | `+ ui :22 jsx-expr " · "`; 10 ≠ 9 |

The review's minor finding 1 (the `--ui` filter) was already shown red by the reviewer (`$SCRATCH/rev-t1/G-test.txt`), so it was not repeated. MT1-1..MT1-8 were not re-run against the extended fixture. Every added line only adds expected rows or rows that must stay absent, so their diffs are unaffected. Minor findings 2 and 3 were left as the review filed them (not in the controller's ruling).
