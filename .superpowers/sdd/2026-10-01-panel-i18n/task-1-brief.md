### Task 1: The text-site scan and the inventory

Runs first, on the untouched base commit, so its output is the inventory below byte for byte.

**Files:**
- Create: `scripts/scan-panel-text.mjs`
- Create: `tests/panel/scanPanelText.test.ts`

**Interfaces:**
- Produces: `node scripts/scan-panel-text.mjs [--ui] [<repo root>]` — prints `<class>\t<file>:<line>\t<context>\t<text>` per site of `<root>/web/src/*.ts(x)` (not recursive: `web/src/locales/` is never read; `web/src/i18n.ts` is skipped); `--ui` prints only `ui` rows. Exit 0.

- [ ] **Step 1: Write the failing criterion** — `tests/panel/scanPanelText.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Panel i18n spec §3, §8: the inventory of text the panel shows comes from a TypeScript parse of web/src, not grep, and
 * every site is classified: `ui` is text a person reads (JSX text, a text attribute, a literal rendered directly, any
 * other literal of two words, a template whose static text has a word next to a space), `code` is the rest. The
 * resources themselves (web/src/i18n.ts, web/src/locales/) are never scanned. Task 11 relies on this classifier to pin
 * that nothing but a named allow-list is left untranslated, so each rule here must be able to go red.
 */
const SCRIPT = join(process.cwd(), "scripts", "scan-panel-text.mjs");
const SAMPLE = [
  'import { thing } from "./thing words.js";',
  'const LABEL = "Two words";',
  'const KEY = "single";',
  'export function Sample(props: { id: string; kind: "a b" }) {',
  '  if (props.id === "not ui words") return null;',
  "  return (",
  '    <section aria-label="Region name" className="some class">',
  "      <h2>Heading text</h2>",
  "      <p title={`Item ${props.id}`}>{\"Literal child\"}{`Count ${props.id}`}</p>",
  '      <a href="/x y">{LABEL}{KEY}</a>',
  "      {`/api/path/${props.id}/tail`}",
  "    </section>",
  "  );",
  "}",
  "export const message = (status: number): string => `answered ${status}`;",
  "export const path = (id: string): string => `/api/${id}/x`;",
  "",
].join("\n");

function scan(args: string[]): { rc: number | null; out: string } {
  const root = mkdtempSync(join(tmpdir(), "scan-"));
  mkdirSync(join(root, "web", "src", "locales"), { recursive: true });
  writeFileSync(join(root, "web", "src", "Sample.tsx"), SAMPLE);
  writeFileSync(join(root, "web", "src", "i18n.ts"), 'export const inI18n = "never scanned words";\n');
  writeFileSync(join(root, "web", "src", "locales", "en.ts"), 'export const en = { a: "never scanned words" };\n');
  const run = spawnSync(process.execPath, [SCRIPT, ...args, root], { encoding: "utf8" });
  return { rc: run.status, out: run.stdout };
}

describe("the panel text scan (spec §3, §8)", () => {
  it("prints every text site of web/src with its class, and skips imports, literal types and the resources", () => {
    const { rc, out } = scan([]);
    expect(rc).toBe(0);
    expect(out.split("\n")).toEqual([
      'ui\tweb/src/Sample.tsx:2\tconst:LABEL\t"Two words"',
      'code\tweb/src/Sample.tsx:3\tconst:KEY\t"single"',
      'code\tweb/src/Sample.tsx:5\tcompare\t"not ui words"',
      'ui\tweb/src/Sample.tsx:7\tattr:aria-label\t"Region name"',
      'code\tweb/src/Sample.tsx:7\tattr:className\t"some class"',
      "ui\tweb/src/Sample.tsx:8\tjsx-text\tHeading text",
      "ui\tweb/src/Sample.tsx:9\tattr:title\t`Item ${props.id}`",
      'ui\tweb/src/Sample.tsx:9\tjsx-expr\t"Literal child"',
      "ui\tweb/src/Sample.tsx:9\tjsx-expr\t`Count ${props.id}`",
      'code\tweb/src/Sample.tsx:10\tattr:href\t"/x y"',
      "ui\tweb/src/Sample.tsx:11\tjsx-expr\t`/api/path/${props.id}/tail`",
      "ui\tweb/src/Sample.tsx:15\treturn\t`answered ${status}`",
      "code\tweb/src/Sample.tsx:16\treturn\t`/api/${id}/x`",
      "",
    ]);
  });

  it("prints only the ui rows with --ui", () => {
    const { rc, out } = scan(["--ui"]);
    expect(rc).toBe(0);
    expect(out.split("\n").filter((line) => line !== "").every((line) => line.startsWith("ui\t"))).toBe(true);
    expect(out.split("\n").filter((line) => line !== "").length).toBe(8);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts > "$SCRATCH/t1-red.txt" 2>&1; echo rc=$?
```
Expected `rc=1`: both tests red (the script does not exist; `rc` is 1 from node, `out` empty).

- [ ] **Step 3: Implement** — `scripts/scan-panel-text.mjs`:

```js
#!/usr/bin/env node
// Panel i18n spec §3, §8: list every candidate text site in web/src (not grep: a TypeScript parse), one per line:
//   <class>\t<file>:<line>\t<context>\t<text>
// class "ui" is text a person reads (JSX text, a text attribute, a literal rendered directly, or any other literal with
// two words); "code" is everything else (keys, verbs, paths, comparisons). web/src/locales/ and web/src/i18n.ts are the
// resources themselves and are not scanned.
//   node scripts/scan-panel-text.mjs [--ui] [repo root]
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const uiOnly = args.includes("--ui");
const root = resolve(args.find((arg) => arg !== "--ui") ?? process.cwd());
const ts = createRequire(import.meta.url)("typescript");
const dir = join(root, "web", "src");
const files = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && f !== "i18n.ts").sort();
const TEXT_ATTRS = new Set(["aria-label", "title", "label", "placeholder", "alt"]);
const letters = /[A-Za-z一-鿿]/;
const twoWords = /[A-Za-z]+[^A-Za-z]*\s[^A-Za-z]*[A-Za-z]+/;

function context(node) {
  const p = node.parent;
  if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isLiteralTypeNode(p)) return null;
  if (ts.isPropertyAssignment(p) && p.name === node) return null;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return null;
  const attr = ts.isJsxAttribute(p) ? p : ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent) ? p.parent : null;
  if (attr) return `attr:${attr.name.getText()}`;
  if (ts.isJsxExpression(p)) return "jsx-expr";
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind)) return "compare";
  if (ts.isCaseClause(p)) return "case";
  if (ts.isCallExpression(p)) return `arg:${p.expression.getText().slice(0, 40)}`;
  if (ts.isPropertyAssignment(p)) return `prop:${p.name.getText()}`;
  if (ts.isVariableDeclaration(p)) return `const:${p.name.getText()}`;
  if (ts.isReturnStatement(p) || ts.isArrowFunction(p)) return "return";
  if (ts.isConditionalExpression(p)) return "cond";
  if (ts.isBinaryExpression(p)) return `binary:${p.operatorToken.getText()}`;
  if (ts.isArrayLiteralExpression(p)) return "array";
  return ts.SyntaxKind[p.kind];
}

// A template's static text with a word next to a space ("answered ${status}") is a sentence around data.
const wordBySpace = /[A-Za-z]{2,}\s|\s[A-Za-z]{2,}/;

function classOf(ctx, staticText, isTemplate) {
  if (ctx === "jsx-text" || ctx === "jsx-expr") return "ui";
  if (ctx.startsWith("attr:")) return TEXT_ATTRS.has(ctx.slice(5)) ? "ui" : "code";
  if (ctx === "compare" || ctx === "case") return "code";
  return twoWords.test(staticText) || (isTemplate && wordBySpace.test(staticText)) ? "ui" : "code";
}

const out = [];
for (const file of files) {
  const path = join(dir, file);
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const emit = (node, ctx, staticText, shown, isTemplate = false) => {
    if (ctx === null || !letters.test(staticText)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
    const cls = classOf(ctx, staticText, isTemplate);
    if (!uiOnly || cls === "ui") out.push(`${cls}\t${relative(root, path)}:${line + 1}\t${ctx}\t${shown}`);
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText().replace(/\s+/g, " ").trim();
      if (text !== "") emit(node, "jsx-text", text, text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      emit(node, context(node), node.text, JSON.stringify(node.text));
    } else if (ts.isTemplateExpression(node)) {
      emit(node, context(node), [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(""), node.getText(), true);
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
process.stdout.write(out.length === 0 ? "" : `${out.join("\n")}\n`);
```

- [ ] **Step 4: Run, expect PASS; record the inventory at the base commit**

```bash
./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts > "$SCRATCH/t1-green.txt" 2>&1; echo rc=$?
node scripts/scan-panel-text.mjs . > "$SCRATCH/t1-scan-all.txt" 2>&1; echo rc=$?
node scripts/scan-panel-text.mjs --ui . > "$SCRATCH/t1-scan-ui.txt" 2>&1; echo rc=$?
wc -l "$SCRATCH/t1-scan-all.txt" "$SCRATCH/t1-scan-ui.txt" > "$SCRATCH/t1-scan-count.txt" 2>&1; echo rc=$?
npm run typecheck > "$SCRATCH/t1-tsc.txt" 2>&1; echo rc=$?
```
Expected: all `rc=0`; counts 1089 and 387 (drafter's measurement at `ac969bb`). Read `t1-scan-ui.txt` whole and compare it with the inventory table below (same 387 rows, same order); a difference means the base moved — report it, do not edit the table.

- [ ] **Step 5: Mutations** (`$SCRATCH/mut-t1`; files `scripts/scan-panel-text.mjs tests/panel/scanPanelText.test.ts`; criterion: `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts` from `$M`)
  - MT1-1 JSX text dropped: delete the `if (ts.isJsxText(node)) { … }` branch's `emit(…)` line. Red: `… > prints every text site …` (no `Heading text` row).
  - MT1-2 text attributes dropped: `TEXT_ATTRS.has(ctx.slice(5)) ? "ui" : "code"` → `"code"`. Red: `… > prints every text site …` and `… > prints only the ui rows with --ui` (count 6, not 8).
  - MT1-3 two-word rule dropped: `twoWords.test(staticText) ||` deleted. Red: `… > prints every text site …` (`"Two words"` becomes `code`).
  - MT1-4 word-by-space rule dropped: `(isTemplate && wordBySpace.test(staticText))` → `false`. Red: `… > prints every text site …` (`answered ${status}` becomes `code`).
  - MT1-5 i18n.ts scanned: `&& f !== "i18n.ts"` deleted. Red: `… > prints every text site …` (an `inI18n` row appears).
  - MT1-6 comparisons as ui: delete the `if (ctx === "compare" || ctx === "case") return "code";` line. Red: `… > prints every text site …` (`"not ui words"` becomes `ui`).

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add scripts/scan-panel-text.mjs tests/panel/scanPanelText.test.ts
/usr/bin/git commit -F - <<'MSG'
feat(scripts): list every text site of the web panel by a TypeScript parse

Panel i18n spec §3 and §8 ask for the inventory of rendered text by a code
scan, not grep. The scan prints each site of web/src with its class (text a
person reads, or code) and skips the resources themselves; a criterion pins
each classification rule on a fixture tree.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GCbsgLfqFPgpeG3gTbBkbh
MSG
```

**Inventory (the drafter's run of the script above at `ac969bb`; the classification every later Task works from).**

*Code-class rows (702), by context — reviewed, none is text a person reads except the 32 one-word literals in the next table:* `attr` 218 (className, key, name, type, value, role, href, data-*, section, prefix, …), `compare` 126, `prop` 103 (command verbs, event types, reducer states, storage keys, payload fields), `array` 81 (dimension names, field names, section and theme ids — the rendered ones are enum families below), `arg` 73 (paths, draft keys, event names), `return` 25 (paths, draft keys), `binary` 24, `case` 22 (verbs), `cond` 16, `const` 14.

*One-word UI literals the classifier files as `code` (32; listed by hand):*

| Site | Text | Task |
|---|---|---|
| `Shell.tsx:12` | `"Decisions"`, `"Chains"`, `"Metrics"` (`LABELS`; `"Task control"` is a `ui` row) | 2 |
| `theme.ts:7` (rendered as `Shell.tsx:76` option text) | `"system"`, `"light"`, `"dark"` | 2 (`enums.theme`) |
| `controlTypes.ts:358` | `"Standard"` (`WEB_LOOP_PLANS`) | 3 |
| `LoopPlanCard.tsx:19` | `` `${plan.planName} · v${plan.planVersion} · ${how}…` `` | 3 |
| `MetricsView.tsx:21` | `"unknown"` (`UNKNOWN_RATE`) | 4 |
| `ChainPanel.tsx:23` | `` `stopped: ${…} (${…})` ``, `"unknown"` ×2 | 6 |
| `ChainPanel.tsx:24` | `"running"` | 6 |
| `ControlGroupView.tsx:92,93,134,135,136,188,270` | `"none"` ×8, `"n/a"` (92) | 7 |
| `ControlGroupView.tsx:157` | `"n/a"` | 7 |
| `EvidenceLink.tsx:25` | `"evidence"` | 7 |
| `TaskDetail.tsx:133` | `"plan"` (labels provenance) | 7 |
| `BudgetEditor.tsx:241` | `"unknown"` | 8 |
| `BudgetEditor.tsx:324` | `"none"` | 8 |
| `LoopPlanCard.tsx:26` | `"Goal"` (`FIELD_LABEL.goal`) | 8 |
| `LoopPlanCard.tsx:89` | units `"tokens"`, `"attempts"` | 8 |
| `AgentFields.tsx:155` | `"inherit"` | 9 |
| `AgentSelectionEditor.tsx:68` | `"rejected"` | 9 |
| `AgentSelectionEditor.tsx:189` | `"reconcile"` (a table cell) | 9 |

*Server fields rendered as text (22):*

| Field (web type) | Where shown | Handling |
|---|---|---|
| `loopPlan.planName` | `LoopPlanCard.tsx:19`, `ControlGroupView.tsx:132` | removed; key by plan version (Task 3) |
| `loopPlan.summary[]` | `LoopPlanCard.tsx:172` | removed; lines built by the panel (Task 3) |
| `review_coverage.reason` | `MetricsView.tsx:52` | `reasonCode` added (Task 4) |
| `correction_rate.caveats[]` | `MetricsView.tsx:34` | `caveatCodes` added (Task 4) |
| `repair_rate.caveats[]` | `MetricsView.tsx:42` | `caveatCodes` added (Task 4) |
| `repair_rate.stale_only.known_bias` | `MetricsView.tsx:47` | `knownBiasCode` added (Task 4) |
| `panel_review_coverage.caveat` | `MetricsView.tsx:56` | `caveatCode` added (Task 4) |
| refusal `message` (panel `/api/*`, control `error.message`) | `Refusal.tsx:29`, `ErrorPage.tsx:21`, `ControlPanel.tsx:171` | Chinese by `zhErrors[code]`, else as sent (Task 10) |
| chain repo `problem` | `ChainPanel.tsx:89` | as sent (spec §3.4) |
| chain `stop.reason`, `stop.awaitingHuman[]` | `ChainPanel.tsx:23`, banners `ChainPanel.tsx:42,46` | as sent (a supervisor code / human-facing items the chain wrote) |
| chain `goal`, `by` | `ChainPanel.tsx:95,97` | data |
| decision `question`, `chose`, `because`, `alternatives[]` | `DecisionList.tsx:76`, `DecisionDetail.tsx:68-92` | data (ledger text, §0.1) |
| group `plan.goal` | `ControlGroupView.tsx:88` | data |
| work item `objective`, loop `inputs` | `LoopPlanCard.tsx:159-160`, summary lines | data |
| estimate `groupRationale`, task `rationale`, `assumptions[]` | `BudgetEditor.tsx:389-394` | data (model text) |
| run `blockedReason`, `failureCode`; handoff `failureCode`; estimate `reasonCode`; blocker `code`; slot outcome `code` | `ControlGroupView.tsx:155-156,188,203`, `RecoveryView.tsx:37,46`, `AgentSelectionEditor.tsx:68` | codes, as sent |
| evidence entry `kind` | `TaskDetail.tsx:88` | open string, as sent (F6) |
| installation `kind`, `version`, `defaults.model`; selection `agent`, `model` | `AgentSettings.tsx:69`, `AgentFields.tsx:156`, `AgentSelectionEditor.tsx:56-57` | data (F6) |
| config `repositories[].displayName`, `plans[].displayName` | `ControlPanel.tsx:71` | data |
| profile ids and hashes | `BudgetEditor.tsx:324`, `ControlGroupView.tsx:169,202` | data |
| labels (plan and operator) | `TaskDetail.tsx:27,150`, `ControlGroupView.tsx:114` | data (F18) |
| decision `projectKey`, ids, dates | `DecisionList.tsx:73-77` | data |

*UI-class rows (387) and the Task that converts each (`kept: …` = stays as written, F18):*

```text
web/src/AgentFields.tsx:9	cond	"agent default"	T9
web/src/AgentFields.tsx:9	cond	`${value} tokens`	T9
web/src/AgentFields.tsx:144	jsx-text	ignore the plan's	T9
web/src/AgentFields.tsx:153	jsx-text	agent	T9
web/src/AgentFields.tsx:155	cond	`inherit (plan: ${props.planned.agent})`	T9
web/src/AgentFields.tsx:162	jsx-text	model	T9
web/src/AgentFields.tsx:167	jsx-text	context	T9
web/src/AgentFields.tsx:169	jsx-text	inherit	T9
web/src/AgentSelectionEditor.tsx:56	jsx-text	from	T9
web/src/AgentSelectionEditor.tsx:57	jsx-text	from	T9
web/src/AgentSelectionEditor.tsx:58	jsx-text	from	T9
web/src/AgentSelectionEditor.tsx:68	cond	"unavailable for now, Re-read to ask again"	T9
web/src/AgentSelectionEditor.tsx:103	attr:aria-label	"Agent selection"	T9
web/src/AgentSelectionEditor.tsx:104	jsx-text	Agents (frozen at confirmation)	T9
web/src/AgentSelectionEditor.tsx:106	jsx-text	slot	T9
web/src/AgentSelectionEditor.tsx:106	jsx-text	agent	T9
web/src/AgentSelectionEditor.tsx:106	jsx-text	model	T9
web/src/AgentSelectionEditor.tsx:106	jsx-text	context	T9
web/src/AgentSelectionEditor.tsx:111	jsx-text	not recorded	T9
web/src/AgentSelectionEditor.tsx:115	jsx-text	reconcile	T9
web/src/AgentSelectionEditor.tsx:116	jsx-text	not recorded	T9
web/src/AgentSelectionEditor.tsx:126	jsx-text	Re-read agent selections	T9
web/src/AgentSelectionEditor.tsx:132	attr:aria-label	"Agent selection"	T9
web/src/AgentSelectionEditor.tsx:133	jsx-text	Agents	T9
web/src/AgentSelectionEditor.tsx:134	jsx-text	Agent selections cannot be read ·	T9
web/src/AgentSelectionEditor.tsx:134	jsx-text	. Confirm is not offered without them.	T9
web/src/AgentSelectionEditor.tsx:140	attr:aria-label	"Agent selection"	T9
web/src/AgentSelectionEditor.tsx:140	jsx-text	Agents	T9
web/src/AgentSelectionEditor.tsx:140	jsx-text	Resolving agent selections…	T9
web/src/AgentSelectionEditor.tsx:157	attr:aria-label	"Agent selection"	T9
web/src/AgentSelectionEditor.tsx:158	jsx-text	Agents · proposal v	T9
web/src/AgentSelectionEditor.tsx:159	jsx-text	The resolution shown is for proposal v	T9
web/src/AgentSelectionEditor.tsx:159	jsx-text	; re-reading. Confirm waits for it.	T9
web/src/AgentSelectionEditor.tsx:160	jsx-text	A selection below did not resolve; confirm is not offered until every slot resolves.	T9
web/src/AgentSelectionEditor.tsx:168	attr:label	`Group ${slot}`	T9
web/src/AgentSelectionEditor.tsx:169	jsx-text	Set group	T9
web/src/AgentSelectionEditor.tsx:169	jsx-text	agent	T9
web/src/AgentSelectionEditor.tsx:170	jsx-text	Clear group	T9
web/src/AgentSelectionEditor.tsx:170	jsx-text	agent	T9
web/src/AgentSelectionEditor.tsx:173	jsx-text	Used from the next re-estimate on; like any proposal change it moves the proposal version.	T9
web/src/AgentSelectionEditor.tsx:179	jsx-text	slot	T9
web/src/AgentSelectionEditor.tsx:179	jsx-text	agent	T9
web/src/AgentSelectionEditor.tsx:179	jsx-text	model	T9
web/src/AgentSelectionEditor.tsx:179	jsx-text	context	T9
web/src/AgentSelectionEditor.tsx:179	jsx-text	this task's own layer	T9
web/src/AgentSelectionEditor.tsx:196	attr:label	`Task ${taskId}`	T9
web/src/AgentSelectionEditor.tsx:197	jsx-text	Set agent for task	T9
web/src/AgentSelectionEditor.tsx:198	jsx-text	Clear agent for task	T9
web/src/AgentSettings.tsx:50	attr:aria-label	"Agents settings"	T9
web/src/AgentSettings.tsx:51	jsx-text	Agents	T9
web/src/AgentSettings.tsx:53	jsx-text	Operator	T9
web/src/AgentSettings.tsx:53	jsx-text	· preferences revision	T9
web/src/AgentSettings.tsx:53	jsx-text	. A change reaches groups confirmed after it; a confirmed group keeps the selection it froze.	T9
web/src/AgentSettings.tsx:58	jsx-text	The installation table lists no agent. Run orca agents init, point ORCA_AGENTS_TABLE at the table it wrote (by default ~/.orca/agents.json) and restart the panel.	T9
web/src/AgentSettings.tsx:64	jsx-text	installation	T9
web/src/AgentSettings.tsx:64	jsx-text	kind	T9
web/src/AgentSettings.tsx:64	jsx-text	version	T9
web/src/AgentSettings.tsx:64	jsx-text	default model	T9
web/src/AgentSettings.tsx:64	jsx-text	default context	T9
web/src/AgentSettings.tsx:75	jsx-text	Default agent	T9
web/src/AgentSettings.tsx:77	jsx-text	none (every group has to choose one)	T9
web/src/AgentSettings.tsx:83	attr:label	`${row.id} defaults`	T9
web/src/AgentSettings.tsx:87	attr:label	"Estimator slot"	T9
web/src/AgentSettings.tsx:88	attr:label	"Reconcile slot"	T9
web/src/AgentSettings.tsx:89	jsx-text	Save agent preferences	T9
web/src/App.tsx:118	return	`Reading again in ${retry.delayMs / 1000} s (retry ${retry.attempt}/${AGENT_RETRY_DELAYS_MS.length}).`	T9
web/src/App.tsx:119	return	"Retrying is paused while the page is hidden; it resumes when you come back."	T9
web/src/App.tsx:120	return	`Stopped after ${AGENT_RETRY_DELAYS_MS.length} retries; Re-read asks again.`	T9
web/src/App.tsx:565	jsx-text	orca panel loading…	T2
web/src/App.tsx:580	arg:send	"Recorded as reviewed."	T5
web/src/App.tsx:585	arg:send	"Correction recorded."	T5
web/src/App.tsx:594	arg:send	"Correction recorded."	T5
web/src/App.tsx:620	array	`epoch ${summary.epoch}`	T2
web/src/App.tsx:620	cond	"dispatch blocked"	T2
web/src/App.tsx:620	cond	"dispatch live"	T2
web/src/App.tsx:630	jsx-text	Chains have not loaded.	T6
web/src/App.tsx:654	jsx-text	The task control plane is not available on this panel.	T7
web/src/BudgetEditor.tsx:42	PropertyAccessExpression	`model ${provenance.estimateId ?? ""}`	T8
web/src/BudgetEditor.tsx:43	cond	"complex-1m default"	T8
web/src/BudgetEditor.tsx:242	cond	"frozen at confirmation"	T8
web/src/BudgetEditor.tsx:313	attr:aria-label	"Budget proposal"	T8
web/src/BudgetEditor.tsx:314	jsx-text	Proposal v	T8
web/src/BudgetEditor.tsx:316	jsx-text	budget mode	T8
web/src/BudgetEditor.tsx:316	binary:??	"not chosen"	T8
web/src/BudgetEditor.tsx:316	jsx-text	· observed enforcement	T8
web/src/BudgetEditor.tsx:317	cond	" · soft: an overrun is settled after the fact, not prevented"	T8
web/src/BudgetEditor.tsx:320	jsx-text	context observation unavailable · the context watermark cannot hand off automatically	T8
web/src/BudgetEditor.tsx:324	jsx-text	profile	T8
web/src/BudgetEditor.tsx:324	jsx-text	: handoff control	T8
web/src/BudgetEditor.tsx:324	jsx-text	· handoff execution	T8
web/src/BudgetEditor.tsx:324	jsx-text	· work bound to it is not dispatched (claim-capability-unavailable)	T8
web/src/BudgetEditor.tsx:329	jsx-text	owner	T8
web/src/BudgetEditor.tsx:329	jsx-text	bucket	T8
web/src/BudgetEditor.tsx:329	jsx-text	state	T8
web/src/BudgetEditor.tsx:329	jsx-text	suggestion	T8
web/src/BudgetEditor.tsx:345	jsx-text	Change it in the plan card	T8
web/src/BudgetEditor.tsx:347	attr:aria-label	`use ${loopValue} for ${allocation.ownerId} ${allocation.bucket} ${dimension}`	T8
web/src/BudgetEditor.tsx:348	jsx-text	use	T8
web/src/BudgetEditor.tsx:368	attr:aria-label	`use ${fieldOperation.value} for ${allocation.ownerId} ${allocation.bucket} ${dimension}`	T8
web/src/BudgetEditor.tsx:369	jsx-text	use	T8
web/src/BudgetEditor.tsx:378	attr:aria-label	`Apply row ${allocation.ownerId} ${allocation.bucket}`	T8
web/src/BudgetEditor.tsx:378	jsx-text	Apply row	T8
web/src/BudgetEditor.tsx:384	jsx-text	This estimate predates a plan change; estimate again to update the suggestions	T8
web/src/BudgetEditor.tsx:385	jsx-text	Apply all suggestions	T8
web/src/BudgetEditor.tsx:388	jsx-text	Estimate rationale (	T8
web/src/BudgetEditor.tsx:393	jsx-text	· confidence	T8
web/src/BudgetEditor.tsx:401	jsx-text	Group limit	T8
web/src/BudgetEditor.tsx:412	jsx-text	Set limit	T8
web/src/BudgetEditor.tsx:415	jsx-text	Hand off at context tokens (blank keeps it unset)	T8
web/src/BudgetEditor.tsx:423	jsx-text	used	T8
web/src/BudgetEditor.tsx:423	jsx-text	· committed	T8
web/src/BudgetEditor.tsx:423	jsx-text	· reserve	T8
web/src/BudgetEditor.tsx:424	cond	` · deficit ${view.ledger.budgetDeficit.tokens}`	T8
web/src/BudgetEditor.tsx:425	cond	" · usage unknown"	T8
web/src/BudgetEditor.tsx:427	jsx-text	Save proposal	T8
web/src/BudgetEditor.tsx:428	jsx-text	Re-estimate	T8
web/src/BudgetEditor.tsx:429	jsx-text	Confirm waits for this proposal version's agent selections to resolve.	T8
web/src/BudgetEditor.tsx:430	jsx-text	Confirm budget	T8
web/src/ChainPanel.tsx:24	cond	"running (supervisor is gone)"	T6
web/src/ChainPanel.tsx:26	cond	"cost unreadable"	T6
web/src/ChainPanel.tsx:26	cond	`USD ${usd.toFixed(2)}`	T6
web/src/ChainPanel.tsx:29	return	`session ${n}; ${costText(chain.costUsd)}`	T6
web/src/ChainPanel.tsx:51	jsx-text	Got it	T6
web/src/ChainPanel.tsx:84	jsx-text	Chains	T6
web/src/ChainPanel.tsx:91	jsx-text	No chain yet.	T6
web/src/ChainPanel.tsx:94	jsx-text	Goal	T6
web/src/ChainPanel.tsx:96	jsx-text	By	T6
web/src/ChainPanel.tsx:98	jsx-text	Progress	T6
web/src/ChainPanel.tsx:100	jsx-text	State	T6
web/src/ChainPanel.tsx:107	jsx-text	Stop chain	T6
web/src/ChainPanel.tsx:109	jsx-expr	" Stops after the current session ends."	T6
web/src/ChainPanel.tsx:116	jsx-expr	"Repository "	T6
web/src/ChainPanel.tsx:126	jsx-expr	"Goal "	T6
web/src/ChainPanel.tsx:130	jsx-expr	"Max sessions "	T6
web/src/ChainPanel.tsx:134	jsx-expr	"Max cost in USD (a soft limit) "	T6
web/src/ChainPanel.tsx:138	jsx-expr	"Session timeout in minutes "	T6
web/src/ChainPanel.tsx:142	jsx-text	Start chain	T6
web/src/ChainPanel.tsx:145	jsx-expr	`Chain ${outcome.chainId} started.`	T6
web/src/ChainPanel.tsx:146	jsx-expr	`Chain ${outcome.chainId} will stop after the current session ends.`	T6
web/src/ControlGroupView.tsx:82	attr:aria-label	`Control group ${groupId}`	T7
web/src/ControlGroupView.tsx:84	jsx-text	· revision	T7
web/src/ControlGroupView.tsx:84	jsx-text	· projection	T7
web/src/ControlGroupView.tsx:86	jsx-text	claim blocked · new runs are not being started	T7
web/src/ControlGroupView.tsx:88	jsx-text	· plan	T7
web/src/ControlGroupView.tsx:88	jsx-text	· graph v	T7
web/src/ControlGroupView.tsx:92	jsx-text	stop	T7
web/src/ControlGroupView.tsx:92	jsx-text	· accepted	T7
web/src/ControlGroupView.tsx:92	jsx-text	· deadline	T7
web/src/ControlGroupView.tsx:93	jsx-text	frozen run(s):	T7
web/src/ControlGroupView.tsx:107	jsx-text	Work items	T7
web/src/ControlGroupView.tsx:109	attr:aria-label	"Filter work items by label"	T7
web/src/ControlGroupView.tsx:110	jsx-text	labels (any of)	T7
web/src/ControlGroupView.tsx:121	jsx-text	task	T7
web/src/ControlGroupView.tsx:121	jsx-text	status	T7
web/src/ControlGroupView.tsx:121	jsx-text	labels	T7
web/src/ControlGroupView.tsx:121	jsx-text	progress	T7
web/src/ControlGroupView.tsx:121	jsx-text	run	T7
web/src/ControlGroupView.tsx:121	jsx-text	pending	T7
web/src/ControlGroupView.tsx:121	jsx-text	depends on	T7
web/src/ControlGroupView.tsx:143	jsx-text	Runs	T7
web/src/ControlGroupView.tsx:146	jsx-text	run	T7
web/src/ControlGroupView.tsx:146	jsx-text	phase	T7
web/src/ControlGroupView.tsx:146	jsx-text	state	T7
web/src/ControlGroupView.tsx:146	jsx-text	profile	T7
web/src/ControlGroupView.tsx:146	jsx-text	used	T7
web/src/ControlGroupView.tsx:146	jsx-text	remaining	T7
web/src/ControlGroupView.tsx:146	jsx-text	evidence	T7
web/src/ControlGroupView.tsx:157	jsx-expr	` · attempt ${run.providerAttemptOrdinal} of claim ${run.claimOrdinal ?? "n/a"}`	T7
web/src/ControlGroupView.tsx:165	jsx-text	Retry run	T7
web/src/ControlGroupView.tsx:183	jsx-text	Handoff requests	T7
web/src/ControlGroupView.tsx:187	jsx-text	· run	T7
web/src/ControlGroupView.tsx:187	jsx-text	· deadline	T7
web/src/ControlGroupView.tsx:188	jsx-text	· evidence	T7
web/src/ControlGroupView.tsx:197	jsx-text	Estimates	T7
web/src/ControlGroupView.tsx:201	jsx-text	· v	T7
web/src/ControlGroupView.tsx:201	jsx-text	profile	T7
web/src/ControlGroupView.tsx:211	jsx-text	Waiting for the ledger to answer:	T7
web/src/ControlGroupView.tsx:214	jsx-text	Dispatch	T7
web/src/ControlGroupView.tsx:216	jsx-text	Start	T7
web/src/ControlGroupView.tsx:220	jsx-text	Pause dispatch	T7
web/src/ControlGroupView.tsx:221	jsx-text	Handoff stop	T7
web/src/ControlGroupView.tsx:225	jsx-text	Resume dispatch	T7
web/src/ControlGroupView.tsx:233	jsx-text	Continue selected tasks (	T7
web/src/ControlGroupView.tsx:247	jsx-text	Continue task	T7
web/src/ControlGroupView.tsx:259	jsx-text	Resume (no continuation)	T7
web/src/ControlGroupView.tsx:267	jsx-text	Retry recovery for	T7
web/src/ControlGroupView.tsx:270	jsx-text	Recent commands:	T7
web/src/ControlPanel.tsx:59	attr:aria-label	"Import plan"	T7
web/src/ControlPanel.tsx:60	jsx-text	Import a plan	T7
web/src/ControlPanel.tsx:63	jsx-text	No estimator profile is configured for this panel, so a plan cannot be imported. Restart it with --estimator-profile and --estimate-mode.	T7
web/src/ControlPanel.tsx:67	jsx-text	No trusted repository and plan are configured for this panel.	T7
web/src/ControlPanel.tsx:71	jsx-text	· estimate mode	T7
web/src/ControlPanel.tsx:71	binary:??	"not configured"	T7
web/src/ControlPanel.tsx:92	jsx-text	Import plan	T7
web/src/ControlPanel.tsx:105	attr:aria-label	"Task control"	T7
web/src/ControlPanel.tsx:106	jsx-text	Task control	T7
web/src/ControlPanel.tsx:108	jsx-text	epoch	T7
web/src/ControlPanel.tsx:108	jsx-text	· projection	T7
web/src/ControlPanel.tsx:109	cond	"dispatch blocked"	T7
web/src/ControlPanel.tsx:109	cond	"dispatch live"	T7
web/src/ControlPanel.tsx:119	jsx-text	no execution port configured · this panel serves recovery and evidence, and refuses to start work · set ORCA_CCLOOP_BIN and ORCA_AGENTS_TABLE and restart it	T7
web/src/ControlPanel.tsx:123	jsx-text	server reset required · this page must re-read before it trusts any cached view	T7
web/src/ControlPanel.tsx:124	jsx-text	projection refetch required · re-reading the open groups	T7
web/src/ControlPanel.tsx:125	jsx-text	dispatch blocked · recovery must be observed	T7
web/src/ControlPanel.tsx:131	attr:aria-label	"Control groups"	T7
web/src/ControlPanel.tsx:132	jsx-text	No control groups yet.	T7
web/src/ControlPanel.tsx:136	cond	` · ${group.completion.done}/${group.completion.total} done`	T7
web/src/ControlPanel.tsx:138	cond	` · ${group.recoveryBlockerCount} blocker(s)`	T7
web/src/ControlPanel.tsx:160	jsx-text	Reading	T7
web/src/ControlPanel.tsx:164	jsx-text	Command outcome unknown, being looked up:	T7
web/src/ControlPanel.tsx:170	cond	` · HTTP ${refusal.status}`	T10
web/src/ControlPanel.tsx:171	cond	` · server revision ${refusal.commandRevision}`	T10
web/src/DecisionDetail.tsx:47	const:AGREE_HELP	"Mark reviewed: I read this and it needs no change. Counts toward review coverage."	T5
web/src/DecisionDetail.tsx:49	const:CORRECT_NOTE	"This records a correction; it does not edit the ledger. To change the decision itself, close it with orca correct --close or let the fix agent do it."	T5
web/src/DecisionDetail.tsx:51	prop:wrong	"the choice was wrong"	T5
web/src/DecisionDetail.tsx:52	prop:not_my_taste	"defensible, but not what I would choose"	T5
web/src/DecisionDetail.tsx:53	prop:stale	"it was right then, no longer true"	T5
web/src/DecisionDetail.tsx:70	jsx-text	Chose	T5
web/src/DecisionDetail.tsx:76	jsx-text	Because	T5
web/src/DecisionDetail.tsx:83	jsx-text	Rejected alternatives	T5
web/src/DecisionDetail.tsx:100	jsx-text	Agree	T5
web/src/DecisionDetail.tsx:116	jsx-text	Kind	T5
web/src/DecisionDetail.tsx:126	jsx-text	Because	T5
web/src/DecisionDetail.tsx:130	jsx-text	Chose instead (optional)	T5
web/src/DecisionDetail.tsx:133	jsx-text	Correct	T5
web/src/DecisionList.tsx:42	const:NO_QUESTION	"(no question recorded)"	T5
web/src/DecisionsView.tsx:19	const:HIDDEN_BY_FILTER	"This decision is hidden by the current filters."	T5
web/src/DecisionsView.tsx:20	const:NOT_IN_LIST	"This decision is no longer in the list: it has been reviewed."	T5
web/src/DecisionsView.tsx:56	jsx-text	any	T5
web/src/DecisionsView.tsx:81	jsx-text	Unreviewed high-tier decisions	T5
web/src/DecisionsView.tsx:82	jsx-text	of	T5
web/src/DecisionsView.tsx:85	jsx-text	High-tier decisions an agent recorded that nobody has reviewed yet. Open one, read it, then Agree or Correct.	T5
web/src/DecisionsView.tsx:88	attr:label	"Kind"	T5
web/src/DecisionsView.tsx:89	attr:label	"Scope"	T5
web/src/DecisionsView.tsx:90	attr:label	"Repository"	T5
web/src/DecisionsView.tsx:95	jsx-text	Nothing to review. Every high-tier decision has been reviewed.	T5
web/src/DecisionsView.tsx:97	jsx-text	No decision matches these filters.	T5
web/src/DecisionsView.tsx:104	jsx-text	Select a decision to read it.	T5
web/src/ErrorPage.tsx:14	jsx-text	orca panel could not load	T10
web/src/ErrorPage.tsx:16	cond	"no answer from the panel"	T10
web/src/ErrorPage.tsx:16	cond	`answered ${failure.status}`	T10
web/src/EvidenceLink.tsx:26	jsx-expr	`evidence refused · ${refusal}`	T7
web/src/LoopPlanCard.tsx:18	cond	"chosen by hand"	T3
web/src/LoopPlanCard.tsx:18	cond	"no label, default"	T3
web/src/LoopPlanCard.tsx:18	cond	`chosen by label \`${plan.chosenByLabel}\``	T3
web/src/LoopPlanCard.tsx:26	prop:successCondition	"Done when"	T8
web/src/LoopPlanCard.tsx:26	prop:targetPaths	"Only changes (one path per line)"	T8
web/src/LoopPlanCard.tsx:26	prop:checks	"Check commands (one per line)"	T8
web/src/LoopPlanCard.tsx:27	prop:nonGoals	"Non-goals (one per line)"	T8
web/src/LoopPlanCard.tsx:27	prop:relevantDocs	"Relevant docs (one per line)"	T8
web/src/LoopPlanCard.tsx:27	prop:protectedPaths	"Must not change (one path per line)"	T8
web/src/LoopPlanCard.tsx:28	prop:maxFilesTouched	"Max files changed (blank for default)"	T8
web/src/LoopPlanCard.tsx:28	prop:tokens	"Token budget"	T8
web/src/LoopPlanCard.tsx:28	prop:activeMs	"Active time (ms)"	T8
web/src/LoopPlanCard.tsx:28	prop:attempts	"Max attempts"	T8
web/src/LoopPlanCard.tsx:30	const:BAD_BUDGET	"Budgets must be positive integers"	T8
web/src/LoopPlanCard.tsx:31	const:BAD_FILE_CAP	"Max files changed must be a positive integer"	T8
web/src/LoopPlanCard.tsx:89	array	"ms active time"	T8
web/src/LoopPlanCard.tsx:92	arg:parts.push	`Budget ${delta > 0 ? "+" : ""}${delta} ${unit}, ${delta > 0 ? "taken from the group reserve" : "returned to the group reserve"}; ${reserve[dimension] - delta} left`	T8
web/src/LoopPlanCard.tsx:92	cond	"taken from the group reserve"	T8
web/src/LoopPlanCard.tsx:92	cond	"returned to the group reserve"	T8
web/src/LoopPlanCard.tsx:93	binary:=	`Group reserve too small: ${dimension} short by ${delta - reserve[dimension]}`	T8
web/src/LoopPlanCard.tsx:95	cond	"Budget unchanged"	T8
web/src/LoopPlanCard.tsx:111	jsx-text	Started; the plan is frozen	T8
web/src/LoopPlanCard.tsx:115	jsx-text	The group is not open for changes; the plan is frozen	T8
web/src/LoopPlanCard.tsx:116	jsx-text	Change plan	T8
web/src/LoopPlanCard.tsx:123	attr:aria-label	`Change plan ${item.taskId}`	T8
web/src/LoopPlanCard.tsx:127	jsx-text	The plan changed after you started this draft (v	T8
web/src/LoopPlanCard.tsx:127	jsx-text	→ v	T8
web/src/LoopPlanCard.tsx:129	jsx-text	Plan	T8
web/src/LoopPlanCard.tsx:130	attr:aria-label	"Plan"	T8
web/src/LoopPlanCard.tsx:144	jsx-text	Discard plan draft	T8
web/src/LoopPlanCard.tsx:155	attr:aria-label	`Plan ${item.taskId}`	T8
web/src/LoopPlanCard.tsx:156	jsx-text	Hand-written contract	T8
web/src/LoopPlanCard.tsx:159	jsx-text	Goal:	T8
web/src/LoopPlanCard.tsx:160	jsx-text	Done when:	T8
web/src/LoopPlanCard.tsx:169	attr:aria-label	`Plan ${item.taskId}`	T8
web/src/LoopPlanCard.tsx:171	attr:aria-label	`Plan summary ${item.taskId}`	T3
web/src/LoopPlanCard.tsx:175	jsx-text	Check commands (	T8
web/src/LoopPlanCard.tsx:178	jsx-text	Budget:	T8
web/src/LoopPlanCard.tsx:178	jsx-text	tokens · active time	T8
web/src/LoopPlanCard.tsx:178	jsx-text	ms · max attempts	T8
web/src/LoopPlanCard.tsx:179	jsx-text	Git workspace: its own worktree, merged back into	T8
web/src/LoopPlanCard.tsx:179	jsx-text	orca/	T8
web/src/LoopPlanCard.tsx:179	jsx-text	; pushing is done by a person	T8
web/src/LoopPlanCard.tsx:180	jsx-text	Skill set: not supported yet	T8
web/src/MetricsView.tsx:31	jsx-text	Correction rate	T4
web/src/MetricsView.tsx:39	jsx-text	Repair rate	T4
web/src/MetricsView.tsx:50	jsx-text	Review coverage	T4
web/src/MetricsView.tsx:59	jsx-text	Unresolved decisions	T4
web/src/MetricsView.tsx:60	jsx-text	Unresolved decisions:	T4
web/src/MetricsView.tsx:62	jsx-text	Malformed lines	T4
web/src/MetricsView.tsx:63	jsx-text	Malformed lines:	T4
web/src/MetricsView.tsx:65	jsx-text	Excluded as future	T4
web/src/MetricsView.tsx:66	jsx-text	Excluded as future:	T4
web/src/RecoveryView.tsx:22	attr:aria-label	"Recovery"	T7
web/src/RecoveryView.tsx:22	jsx-text	No recovery blockers.	T7
web/src/RecoveryView.tsx:26	jsx-text	Retry recovery	T7
web/src/RecoveryView.tsx:30	attr:aria-label	"Recovery"	T7
web/src/RecoveryView.tsx:31	jsx-text	Recovery	T7
web/src/RecoveryView.tsx:32	jsx-text	dispatch blocked · the panel will not start new runs until recovery is observed	T7
web/src/RecoveryView.tsx:36	cond	"all groups"	T7
web/src/RecoveryView.tsx:37	cond	` · run ${blocker.runId}`	T7
web/src/RecoveryView.tsx:38	cond	` · evidence ${blocker.evidenceIds.join(", ")}`	T7
web/src/RecoveryView.tsx:46	cond	` · run ${blocker.runId}`	T7
web/src/RecoveryView.tsx:47	cond	` · evidence ${blocker.evidenceIds.join(", ")}`	T7
web/src/RecoveryView.tsx:50	attr:label	"run evidence"	T7
web/src/Refusal.tsx:32	jsx-text	Record another	T10
web/src/Shell.tsx:12	prop:tasks	"Task control"	T2
web/src/Shell.tsx:44	attr:title	"a chain is running"	T2
web/src/Shell.tsx:45	attr:title	"needs attention"	T2
web/src/Shell.tsx:60	attr:aria-label	"Sections"	T2
web/src/Shell.tsx:61	attr:title	"Leave it to Orca — every idea, made real."	T2
web/src/Shell.tsx:61	jsx-text	Orca	kept: brand name
web/src/Shell.tsx:75	jsx-text	Theme	T2
web/src/TaskDetail.tsx:23	jsx-text	none	T7
web/src/TaskDetail.tsx:27	cond	"label label-custom"	kept: className
web/src/TaskDetail.tsx:27	cond	"label label-system"	kept: className
web/src/TaskDetail.tsx:38	return	"no run"	T7
web/src/TaskDetail.tsx:39	binary:??	"not reported yet"	T7
web/src/TaskDetail.tsx:40	cond	"attempt unknown"	T7
web/src/TaskDetail.tsx:40	cond	`attempt ${progress.attempt.current}/${progress.attempt.max}`	T7
web/src/TaskDetail.tsx:42	cond	"tokens unknown"	T7
web/src/TaskDetail.tsx:44	cond	`tokens ${progress.tokens.used} of 0`	T7
web/src/TaskDetail.tsx:45	cond	`tokens ${Math.floor((progress.tokens.used * 100) / progress.tokens.grant)}% (reported at phase end)`	T7
web/src/TaskDetail.tsx:82	jsx-text	List evidence of	T7
web/src/TaskDetail.tsx:83	jsx-expr	`evidence refused · ${refusal}`	T7
web/src/TaskDetail.tsx:84	jsx-text	no evidence	T7
web/src/TaskDetail.tsx:85	attr:aria-label	`Evidence of ${props.runId}`	T7
web/src/TaskDetail.tsx:88	jsx-text	bytes	T7
web/src/TaskDetail.tsx:89	jsx-text	Download	T7
web/src/TaskDetail.tsx:130	attr:aria-label	`Task ${item.taskId}`	T7
web/src/TaskDetail.tsx:131	jsx-text	Task	T7
web/src/TaskDetail.tsx:133	jsx-text	labels from	T7
web/src/TaskDetail.tsx:133	jsx-text	· version	T7
web/src/TaskDetail.tsx:134	cond	" · unsaved draft"	T7
web/src/TaskDetail.tsx:138	jsx-text	labels changed since your draft (v	T7
web/src/TaskDetail.tsx:138	jsx-text	→ v	T7
web/src/TaskDetail.tsx:138	jsx-text	) · now:	T7
web/src/TaskDetail.tsx:141	attr:aria-label	`Labels of ${item.taskId}`	T7
web/src/TaskDetail.tsx:145	jsx-text	Remove	T7
web/src/TaskDetail.tsx:149	attr:aria-label	"System label"	T7
web/src/TaskDetail.tsx:152	jsx-text	Add system label	T7
web/src/TaskDetail.tsx:153	attr:aria-label	"Custom label"	T7
web/src/TaskDetail.tsx:154	jsx-text	Add custom label	T7
web/src/TaskDetail.tsx:155	jsx-text	Save labels	T7
web/src/TaskDetail.tsx:156	jsx-text	Discard draft	T7
web/src/TaskDetail.tsx:157	jsx-text	Restore plan labels	T7
web/src/TaskDetail.tsx:159	jsx-text	progress:	T7
web/src/TaskDetail.tsx:160	cond	` · last transition ${item.progress.lastTransitionAt}`	T7
web/src/TaskDetail.tsx:163	jsx-text	Runs of	T7
web/src/TaskDetail.tsx:164	jsx-text	none	T7
web/src/WorkspaceModeSelector.tsx:12	attr:aria-label	"Workspace mode"	T7
web/src/WorkspaceModeSelector.tsx:13	jsx-text	Workspace mode	T7
web/src/WorkspaceModeSelector.tsx:15	jsx-text	New runs in	T7
web/src/WorkspaceModeSelector.tsx:15	jsx-text	use	T7
web/src/WorkspaceModeSelector.tsx:15	cond	"a git worktree"	T7
web/src/WorkspaceModeSelector.tsx:15	cond	"a private clone"	T7
web/src/WorkspaceModeSelector.tsx:15	jsx-text	(setting revision	T7
web/src/WorkspaceModeSelector.tsx:15	jsx-text	). Runs already started keep theirs.	T7
web/src/WorkspaceModeSelector.tsx:26	cond	"git worktree (default)"	T7
web/src/WorkspaceModeSelector.tsx:26	cond	"private clone"	T7
web/src/api.ts:47	cond	`${what} answered ${status}`	T10
web/src/api.ts:76	arg:refusalFrom	`GET ${path}`	kept: HTTP method + path, the data part of a message
web/src/api.ts:87	arg:refusalFrom	`POST ${path}`	kept: HTTP method + path, the data part of a message
web/src/chainBanner.ts:9	prop:done	"Chain finished"	T6
web/src/chainBanner.ts:10	prop:blocked	"Chain is waiting for you"	T6
web/src/chainBanner.ts:11	prop:limit	"Chain stopped at a limit"	T6
web/src/chainBanner.ts:12	prop:anomaly	"Chain stopped on an anomaly"	T6
web/src/controlApi.ts:76	arg:refusalOf	`GET ${path}`	kept: HTTP method + path, the data part of a message
web/src/controlApi.ts:76	cond	"no answer"	T10
web/src/controlApi.ts:79	arg:refusalOf	`GET ${path}`	kept: HTTP method + path, the data part of a message
web/src/controlApi.ts:79	arg:refusalOf	`answered ${res.status}`	T10
web/src/controlApi.ts:138	arg:refusalOf	`GET ${entry.downloadUrl}`	kept: HTTP method + path, the data part of a message
web/src/controlApi.ts:138	cond	"no answer"	T10
web/src/controlApi.ts:140	arg:refusalOf	`GET ${entry.downloadUrl}`	kept: HTTP method + path, the data part of a message
web/src/controlApi.ts:140	arg:refusalOf	`answered ${res.status}`	T10
web/src/controlApi.ts:165	arg:refusalOf	`POST ${path}`	kept: HTTP method + path, the data part of a message
web/src/controlApi.ts:165	cond	"never answered"	T10
web/src/controlApi.ts:168	arg:refusalOf	`POST ${path}`	kept: HTTP method + path, the data part of a message
web/src/controlApi.ts:168	arg:refusalOf	"the panel may not have committed this command"	T10
web/src/controlApi.ts:178	binary:??	"The panel answered without a command outcome."	T10
web/src/controlTypes.ts:359	prop:name	"Bug fix (red first)"	T3
web/src/controlTypes.ts:360	prop:name	"Safe refactor"	T3
web/src/controlTypes.ts:361	prop:name	"Design / docs first"	T3
web/src/controlTypes.ts:362	prop:name	"Investigate only"	T3
web/src/main.tsx:8	NewExpression	"orca panel: #root is missing from index.html"	kept: developer error, never rendered
```

---

