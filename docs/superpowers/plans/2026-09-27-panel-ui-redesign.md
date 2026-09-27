# Panel UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Orca panel a sidebar-sectioned, themed layout and make the unreviewed-decision list readable (question summary on each row, a list/detail split, and actions that say what they do).

**Architecture:** The server adds `question` to list rows by reading each repository's ledger once per request. The web app gets one plain-CSS token sheet, a pure `Shell` (sidebar + content), pure `sections`/`theme` helpers, and a pure `DecisionsView`. `App` keeps every section mounted and marks the active one with `data-active`; CSS hides the rest.

**Tech Stack:** TypeScript, React 19, Vite 6, Vitest 2 (+ jsdom / @testing-library/react in web tests), Express 5 on the server. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-27-panel-ui-redesign-design.md` (read it first; §2 explains what ruling U1 overturned).

## Global Constraints

- 🔴 **Work only in this worktree, on branch `ui/panel-redesign`.** Another agent works on `main` in `/Users/biran/code/skills/loop/Orca`. Never check out, commit to, merge into, or run builds/tests in that tree. Never `git push`. Merging and removing the worktree are the human's (CLAUDE.md Rule 15).
- Worktree path: `/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/a50f4d80-40a9-4f62-a015-a75849f2a241/scratchpad/orca-ui`. Every command below runs from there.
- `node_modules` does not exist in a fresh worktree. Task 0 links it from the main tree **read-only** (a symlink; never `npm install` through it).
- No new dependencies (spec §3). No Tailwind, no component library, no router library, no web fonts from the network (spec §5.3).
- Anchors existing criteria use must stay byte-identical (spec §3 item 6): heading text `Unreviewed high-tier decisions`; selector `.decision-list li button`; button names `Agree`, `Correct`; `form.correction-form`; `textarea[name="because"]`; `input[name="chose_instead"]`; every `data-testid="decision-*"` / `alternative-*`; the loading text containing `orca panel`. Every other component's visible text, button names, `aria-label`, `data-*` and `data-testid` stay unchanged too.
- Sections are never unmounted and never get a `hidden` attribute (spec §5.1 🔴). Only the class rule in `styles.css` hides a pane.
- Only these four existing criteria may be rewritten (human ruling U4), and each rewrite carries a comment naming U1/U2 and session `a50f4d80`:
  1. `tests/panel/decisionsApi.test.ts` › `returns list rows DEEP-EQUAL to the frozen projection, not merely lacking a summary`
  2. `tests/panel/todo.test.ts` › `(e) answers with exactly the unreviewed high-tier decision, deep-equal to its LIST_FIELDS projection, and records nothing`
  3. `web/tests/decisionList.test.tsx` › `renders only the list fields, never an extra field on the row`
  4. `web/tests/panelHome.test.tsx` › `shows the todo rows' ids, with the todo heading before the metrics heading` (the file is deleted along with `PanelHome.tsx`; its intent moves to `web/tests/decisionsView.test.tsx`)
  Any other existing criterion that turns red is a **stop**: report it, do not edit it.
- Copy that goes on screen verbatim (spec §5.2):
  - Agree help: `Mark reviewed: I read this and it needs no change. Counts toward review coverage.`
  - Correct note: `This records a correction; it does not edit the ledger. To change the decision itself, close it with orca correct --close or let the fix agent do it.`
  - Kind lines: `wrong — the choice was wrong`, `not_my_taste — defensible, but not what I would choose`, `stale — it was right then, no longer true`
  - Null question: `(no question recorded)`
- Evidence discipline (CLAUDE.md Rule 14): verification runs are redirected to a file and read back whole — never piped through `grep`/`tail`/`head`.
- Mutations (Rule 15): only in a `git clone --local` copy of this branch under the scratchpad (`…/scratchpad/mut-<task>`), with `node_modules` symlinked; the worktree is never mutated. Delete the clone with `/bin/rm -rf` afterwards (it is our own scratch copy, not a worktree).
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Order inside every task: tests green → commit → mutate a clone of the committed branch** (Task 1 Step 12 is the procedure). Where a task lists its Mutations step before its Commit step, run the Commit step first. Mutations never touch the worktree.

## Review Focus

1. **A question that is one long unbroken token** (a sha, a path, a URL) — the row must wrap it and clamp to two lines, never widen the list column. Pinned in Task 4 (`styles.test.ts` asserts the `.row-question` rule).
2. **The to-do list is empty** — the Decisions pane says `Nothing to review.` and the detail side shows its placeholder; no blank pane. Pinned in Task 4.
3. **Filters that match nothing** — the list side says `No decision matches these filters.` and the header still shows `0 of M`. Pinned in Task 4.
4. **A row whose question is `null`** (ledger line missing, or `question` not a string) — the row shows `(no question recorded)` and stays clickable. Pinned in Task 1 (server) and Task 4 (web).
5. **The page URL carries `?token=…` and a hash** — navigation links are bare `#section` hrefs so the token query survives, and an unknown hash falls back to Decisions. Pinned in Task 3.

---

### Task 0: Worktree readiness (no commit)

- [ ] **Step 1: Confirm location and branch**

```bash
cd /private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/a50f4d80-40a9-4f62-a015-a75849f2a241/scratchpad/orca-ui
git branch --show-current
```
Expected: `ui/panel-redesign`. Anything else: stop.

- [ ] **Step 2: Link dependencies (read-only symlinks)**

```bash
ln -s /Users/biran/code/skills/loop/Orca/node_modules node_modules
ln -s /Users/biran/code/skills/loop/Orca/web/node_modules web/node_modules
git status --porcelain > ../status.txt; cat ../status.txt
```
Expected: `git status` shows nothing (both paths are gitignored). If it lists `node_modules`, stop.

- [ ] **Step 3: Baseline**

```bash
npm run typecheck > ../t0-typecheck.log 2>&1; echo TYPECHECK_RC=$?
npm run build --workspace web > ../t0-build.log 2>&1; echo BUILD_RC=$?
./node_modules/.bin/vitest run > ../t0-vitest.log 2>&1; echo VITEST_RC=$?
npm run --ws check > ../t0-ws.log 2>&1; echo WS_RC=$?
```
Read each log whole. Record the file/test counts and any red by full name. Known load flakes are listed in `docs/handoff/handoff.md` §一 (re-run a red file alone; green alone = not a regression). Every later task compares against this baseline.

---

### Task 1: Server — list rows carry `question`

**Files:**
- Modify: `src/panel/decisionSource.ts` (append two functions)
- Modify: `src/panel/listProjection.ts` (type, `projectForList`, ERRATUM at the end of the top comment block)
- Modify: `src/panel/api.ts:190-207` (`/api/todo`, `/api/decisions`)
- Modify: `web/src/types.ts:177-178` (`DecisionListRow`)
- Create: `tests/panel/loadQuestions.test.ts`
- Rewrite: `tests/panel/decisionsApi.test.ts` › criterion 1; `tests/panel/todo.test.ts` › criterion (e)

**Interfaces:**
- Produces: `loadQuestions(repoPath: string): Promise<Map<string, string>>`; `loadQuestionsOrEmpty(repoPath: string): Promise<Map<string, string>>`; `projectForList(decision: DecisionObservation, question: string | null): DecisionListRow`; `DecisionListRow = Pick<DecisionObservation, "projectKey"|"id"|"at"|"kind"|"scope"|"verdict"> & { question: string | null }` (server and web).
- `LIST_FIELDS` and `WEB_LIST_FIELDS` are unchanged (six observation fields). `tests/panel/webParity.test.ts` is not edited.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/panel/loadQuestions.test.ts`:

```ts
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDecisionRow, loadQuestions, loadQuestionsOrEmpty } from "../../src/panel/decisionSource.js";

/**
 * Panel UI redesign spec §4 (human ruling U1, session a50f4d80): list rows carry the
 * decision's question. The ledger is written as raw lines on purpose -- the ledger
 * writer validates, and a real ledger can still hold a line it would refuse.
 */
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await chmod(join(root, ".decisions", "a.jsonl"), 0o600).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

async function repoWith(files: Record<string, unknown[]>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "orca-questions-"));
  roots.push(root);
  await mkdir(join(root, ".decisions"));
  for (const [name, rows] of Object.entries(files)) {
    await writeFile(join(root, ".decisions", name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  return root;
}

describe("loadQuestions (panel UI redesign spec §4)", () => {
  it("maps each decision id to its question and leaves out a question that is missing, empty or not a string", async () => {
    const repo = await repoWith({
      "a.jsonl": [
        { ev: "decision", id: "r/1", question: "which lock" },
        { ev: "decision", id: "r/2", question: 42 },
        { ev: "decision", id: "r/3", question: "" },
        { ev: "decision", id: "r/4" },
        { ev: "bound", id: "r/5", question: "not a decision line" },
      ],
    });
    const questions = await loadQuestions(repo);
    expect([...questions.entries()]).toStrictEqual([["r/1", "which lock"]]);
  });

  it("lets the first line win for a repeated id, the same line loadDecisionRow opens", async () => {
    const repo = await repoWith({
      "a.jsonl": [{ ev: "decision", id: "r/1", question: "first" }],
      "b.jsonl": [{ ev: "decision", id: "r/1", question: "second" }],
    });
    const questions = await loadQuestions(repo);
    const detail = (await loadDecisionRow(repo, "r/1")) as { question: string };
    expect(questions.get("r/1")).toBe("first");
    expect(questions.get("r/1")).toBe(detail.question);
  });

  it("answers an empty map, not a failure, when a ledger file cannot be read", async () => {
    const repo = await repoWith({ "a.jsonl": [{ ev: "decision", id: "r/1", question: "which lock" }] });
    await chmod(join(repo, ".decisions", "a.jsonl"), 0o000);
    await expect(loadQuestions(repo)).rejects.toBeDefined();
    const questions = await loadQuestionsOrEmpty(repo);
    expect(questions.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see it fail**

```bash
./node_modules/.bin/vitest run tests/panel/loadQuestions.test.ts > ../t1-red.log 2>&1; echo RC=$?; cat ../t1-red.log
```
Expected: RC 1, `loadQuestions` / `loadQuestionsOrEmpty` not exported.

- [ ] **Step 3: Implement in `src/panel/decisionSource.ts`** (append after `loadDecisionRow`)

```ts
/**
 * Panel UI redesign spec §4 (human ruling U1, session a50f4d80): the list rows now
 * carry each decision's question. Same file set and order as `loadDecisionRow`, and
 * the FIRST line for an id wins -- the same line `loadDecisionRow` opens -- so the
 * summary on a row and the detail behind it are never two different decisions.
 */
export async function loadQuestions(repoPath: string): Promise<Map<string, string>> {
  const questions = new Map<string, string>();
  // An id is claimed by its FIRST decision line even when that line's question is
  // unusable, so a later line can never lend a question to a detail that shows another.
  const seen = new Set<string>();
  for (const file of await ledgerFiles(repoPath)) {
    const read = await readLedgerLeniently(file);
    for (const row of read.rows) {
      if (row.kind !== "decision") continue;
      const value = row.value as { id?: unknown; question?: unknown };
      if (typeof value.id !== "string" || seen.has(value.id)) continue;
      seen.add(value.id);
      if (typeof value.question !== "string" || value.question === "") continue;
      questions.set(value.id, value.question);
    }
  }
  return questions;
}

/**
 * The list is a to-do list: a summary that cannot be read must not take the rows
 * away with it. `ledgerFiles` already swallows a readdir failure; what can still
 * throw is reading one ledger file.
 */
export async function loadQuestionsOrEmpty(repoPath: string): Promise<Map<string, string>> {
  try {
    return await loadQuestions(repoPath);
  } catch {
    return new Map();
  }
}
```

Also add this case to `tests/panel/loadQuestions.test.ts` (inside the `describe`), before running Step 2 again:

```ts
  it("does not borrow a later line's question when the first line for the id has none", async () => {
    const repo = await repoWith({
      "a.jsonl": [{ ev: "decision", id: "r/1", question: 7 }],
      "b.jsonl": [{ ev: "decision", id: "r/1", question: "later" }],
    });
    expect((await loadQuestions(repo)).has("r/1")).toBe(false);
  });
```

- [ ] **Step 4: Run the unit tests green**

```bash
./node_modules/.bin/vitest run tests/panel/loadQuestions.test.ts > ../t1-green.log 2>&1; echo RC=$?; cat ../t1-green.log
```
Expected: RC 0, 4 passed (three from Step 1, one added in Step 3).

- [ ] **Step 5: Change the projection** — `src/panel/listProjection.ts`

Replace the type and function:

```ts
export type DecisionListRow = Pick<DecisionObservation, (typeof LIST_FIELDS)[number]> & { question: string | null };

export function projectForList(decision: DecisionObservation, question: string | null): DecisionListRow {
  const row = {} as Record<string, unknown>;
  for (const field of LIST_FIELDS) row[field] = decision[field];
  row.question = question;
  return row as DecisionListRow;
}
```

Append at the end of the comment block above `LIST_FIELDS` (keep every existing line):

```ts
 *
 * *** ERRATUM (2026-09-27, session a50f4d80, branch ui/panel-redesign, human ruling U1) ***
 * The paragraph above no longer governs the list. The human, shown "keep the spec and fix
 * only the layout" as the recommended option, chose "show the question on the list".
 * Rows now carry `question` (the ledger's own value, or null) beside these six fields;
 * `reviewed` is still the only numerator of coverage, and `opened` is now weaker still.
 * See docs/superpowers/specs/2026-09-27-panel-ui-redesign-design.md §2. Text above kept verbatim.
```

- [ ] **Step 6: Wire the routes** — `src/panel/api.ts`

Import: `import { loadDecisionRow, loadQuestionsOrEmpty } from "./decisionSource.js";` and `import type { DecisionListRow } from "./listProjection.js";`.

Add above `registerApiRoutes`'s first route (a module-level helper):

```ts
/** One ledger read per repository per request; a repository whose ledger cannot be read gets null summaries. */
async function listRows(
  repos: ReadonlyArray<{ projectKey: string; path: string }>,
  decisions: readonly DecisionObservation[],
): Promise<DecisionListRow[]> {
  const byRepo = new Map<string, Map<string, string>>();
  for (const repo of repos) byRepo.set(repo.projectKey, await loadQuestionsOrEmpty(repo.path));
  return decisions.map((d) => projectForList(d, byRepo.get(d.projectKey)?.get(d.id) ?? null));
}
```

Then:

```ts
      res.json({ rows: await listRows(observations.repos, unreviewedHighTier(observations.decisions, reviews)) });
```
in `/api/todo`, and

```ts
      res.json({ rows: await listRows(observations.repos, observations.decisions) });
```
in `/api/decisions`. Leave both routes' comments as they are.

- [ ] **Step 7: Mirror the web type** — `web/src/types.ts`

```ts
/** Mirrors src/panel/listProjection.ts's DecisionListRow (question: panel UI redesign spec §4, ruling U1). */
export type DecisionListRow = Pick<DecisionObservation, "projectKey" | "id" | "at" | "kind" | "scope" | "verdict"> & { question: string | null };
```
`WEB_LIST_FIELDS` stays as is.

- [ ] **Step 8: Rewrite criterion 1** — `tests/panel/decisionsApi.test.ts`

Keep the test name and everything up to `const observations = await collect(…)`. Replace the `expected` construction with a value read independently of the code under test:

```ts
          // REWRITTEN (panel UI redesign spec §2/§6.1, human ruling U1, authorised as U4 in
          // session a50f4d80): rows now carry `question`. The expected value is still built
          // by hand -- not by projectForList or loadQuestions -- so the equality cannot move
          // together with the implementation. Both decisions in this ledger were written
          // from ORIGINAL, whose question is a literal the fixture owns.
          const expected = observations.decisions.map((d) => ({
            ...Object.fromEntries(LIST_FIELDS.map((f) => [f, d[f]])),
            question: ORIGINAL.question,
          }));
          expect(body.rows).toStrictEqual(expected);
          expect(body.rows.length).toBeGreaterThan(1);
```

- [ ] **Step 9: Rewrite criterion (e)** — `tests/panel/todo.test.ts`

Replace `expectedRow` with:

```ts
          // REWRITTEN (panel UI redesign spec §2/§6.1, human ruling U1, authorised as U4 in
          // session a50f4d80): the row now also carries the ledger's question. Built by hand,
          // not by projectForList -- same tautology guard as before.
          const expectedRow = {
            ...Object.fromEntries(
              LIST_FIELDS.map((field) => {
                const value: Record<string, unknown> = {
                  projectKey: "proj",
                  id: second.id,
                  at: second.at,
                  kind: second.kind,
                  scope: second.scope,
                  verdict: "ok",
                };
                return [field, value[field]];
              }),
            ),
            question: second.question,
          };
          expect(body.rows).toStrictEqual([expectedRow]);
```
The "records nothing" half below stays byte-identical.

- [ ] **Step 10: Run the panel suite, typecheck, web tsc**

```bash
./node_modules/.bin/vitest run tests/panel > ../t1-panel.log 2>&1; echo RC=$?
npm run typecheck > ../t1-tc.log 2>&1; echo TC=$?
(cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json) > ../t1-webtsc.log 2>&1; echo WEBTSC=$?
cat ../t1-panel.log ../t1-tc.log ../t1-webtsc.log
```
Expected: all RC 0. `webParity` stays green without edits.

- [ ] **Step 11: Commit** (mutations run against the committed branch in Step 12)

```bash
git add src/panel/decisionSource.ts src/panel/listProjection.ts src/panel/api.ts web/src/types.ts tests/panel/loadQuestions.test.ts tests/panel/decisionsApi.test.ts tests/panel/todo.test.ts
git commit -m "feat(panel): carry each decision's question on list rows (ruling U1)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 12: Mutations (clone, never the worktree) — each must be seen red**

The standard clone procedure, used by every later task with its own `mut-tN` name:

```bash
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/a50f4d80-40a9-4f62-a015-a75849f2a241/scratchpad
git clone -q --local --branch ui/panel-redesign "$PWD" $S/mut-t1
cd $S/mut-t1 && ln -s /Users/biran/code/skills/loop/Orca/node_modules node_modules && ln -s /Users/biran/code/skills/loop/Orca/web/node_modules web/node_modules
git log -1 --format=%s > ../mut-t1-head.txt; cat ../mut-t1-head.txt   # must be this task's commit subject
```
Build the web dist in the clone first (`npm run build --workspace web`), because panel criteria serve it. Run each mutation, revert it with `git checkout -- <file>`, and record RC + the red test's full name:

| Mutation | File | Expected red |
|---|---|---|
| M1-a: drop `typeof value.question !== "string"` check | `src/panel/decisionSource.ts` | `maps each decision id to its question…` |
| M1-b: remove `seen.add(value.id)` | same | `does not borrow a later line's question…` |
| M1-c: `loadQuestionsOrEmpty` rethrows | same | `answers an empty map…` |
| M1-d: `listRows` passes `null` for every row | `src/panel/api.ts` | both rewritten criteria |

Then `cd` back to the worktree and `/bin/rm -rf $S/mut-t1`. A mutation that stays green is a finding: report it, do not weaken or drop the row.

---

### Task 2: Token stylesheet and theme preference

**Files:**
- Create: `web/src/styles.css`
- Create: `web/src/theme.ts`
- Modify: `web/src/main.tsx`
- Create: `web/tests/theme.test.ts`

**Interfaces:**
- Produces: `THEME_KEY = "orca.panel.theme"`; `type ThemePref = "system" | "light" | "dark"`; `THEME_PREFS: readonly ThemePref[]`; `readTheme(storage: Pick<Storage, "getItem"> | undefined): ThemePref`; `writeTheme(storage: Pick<Storage, "setItem"> | undefined, pref: ThemePref): void`; `applyTheme(root: Pick<HTMLElement, "setAttribute" | "removeAttribute">, pref: ThemePref): void`.
- CSS classes later tasks use: `.shell .sidebar .brand .brand-dot .nav .nav-item .nav-count .dot .dot-ok .dot-danger .sidebar-foot .theme-pick .content .section-pane .section-head .section-lede .count .filters .split .split-list .split-detail .empty .decision-list .decision-row .row-meta .row-project .row-at .row-question .row-id .pill .pill-warn .detail-block .detail-help .actions .btn .btn-primary .chain-banners`.

- [ ] **Step 1: Write the failing test** — `web/tests/theme.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { THEME_KEY, applyTheme, readTheme, writeTheme } from "../src/theme.js";

/** Panel UI redesign spec §5.1 (ruling U3): the theme choice is a per-browser convenience that must never break the page. */
describe("theme preference (ruling U3)", () => {
  it("reads a stored choice and falls back to system for a missing, unknown or unreadable one", () => {
    expect(readTheme({ getItem: (k) => (k === THEME_KEY ? "dark" : null) })).toBe("dark");
    expect(readTheme({ getItem: () => null })).toBe("system");
    expect(readTheme({ getItem: () => "sepia" })).toBe("system");
    expect(readTheme({ getItem: () => { throw new Error("SecurityError"); } })).toBe("system");
    expect(readTheme(undefined)).toBe("system");
  });

  it("swallows a storage that refuses writes", () => {
    expect(() => writeTheme({ setItem: () => { throw new Error("QuotaExceededError"); } }, "light")).not.toThrow();
  });

  it("sets data-theme for an explicit choice and removes it for system", () => {
    const attrs = new Map<string, string>();
    const root = { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
    applyTheme(root, "light");
    expect(attrs.get("data-theme")).toBe("light");
    applyTheme(root, "system");
    expect(attrs.has("data-theme")).toBe(false);
  });
});
```

- [ ] **Step 2: Run red**

```bash
cd web && ../node_modules/.bin/vitest run tests/theme.test.ts > ../../t2-red.log 2>&1; echo RC=$?; cd ..; cat ../t2-red.log
```
Expected: RC 1, module `../src/theme.js` not found.

- [ ] **Step 3: Implement** — `web/src/theme.ts`

```ts
/**
 * Panel UI redesign spec §5.1 (ruling U3). "system" follows prefers-color-scheme; the
 * other two pin a theme. The choice lives in this browser only, so every storage call
 * is wrapped: a private window or blocked site data must leave the page working.
 */
export const THEME_KEY = "orca.panel.theme";
export const THEME_PREFS = ["system", "light", "dark"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];

export function readTheme(storage: Pick<Storage, "getItem"> | undefined): ThemePref {
  try {
    const value = storage?.getItem(THEME_KEY) ?? null;
    return (THEME_PREFS as readonly string[]).includes(value ?? "") ? (value as ThemePref) : "system";
  } catch {
    return "system";
  }
}

export function writeTheme(storage: Pick<Storage, "setItem"> | undefined, pref: ThemePref): void {
  try {
    storage?.setItem(THEME_KEY, pref);
  } catch {
    // A lost preference only costs one click next time.
  }
}

export function applyTheme(root: Pick<HTMLElement, "setAttribute" | "removeAttribute">, pref: ThemePref): void {
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}
```

- [ ] **Step 4: Stylesheet** — `web/src/styles.css`

```css
/* Panel UI redesign spec §5.3. Tokens after openclaw ui/src/styles/base.css; accent is the info blue, not coral. */
:root {
  color-scheme: dark;
  --bg: #0e1015;
  --bg-elevated: #191c24;
  --bg-hover: #1f2330;
  --card: #161920;
  --border: #1e2028;
  --border-strong: #2e3040;
  --text: #bcbcc0;
  --text-strong: #f4f4f5;
  --muted: #8b8b94;
  --accent: #60a5fa;
  --accent-subtle: rgba(96, 165, 250, 0.12);
  --ok: #22c55e;
  --ok-subtle: rgba(34, 197, 94, 0.08);
  --warn: #f59e0b;
  --warn-subtle: rgba(245, 158, 11, 0.08);
  --danger: #f87171;
  --danger-subtle: rgba(248, 113, 113, 0.08);
  --info: #60a5fa;
  --info-subtle: rgba(96, 165, 250, 0.08);
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --text-xs: 12px;
  --text-sm: 13px;
  --text-md: 14px;
  --text-lg: 16px;
  --radius-sm: 6px;
  --radius: 10px;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  --nav-width: 240px;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #faf9f7; --bg-elevated: #ffffff; --bg-hover: #f1efeb; --card: #ffffff;
  --border: #e6e2da; --border-strong: #d6d0c4; --text: #403c35; --text-strong: #1c1a17; --muted: #6e6960;
  --accent: #2563eb; --accent-subtle: rgba(37, 99, 235, 0.1);
  --ok: #15803d; --warn: #b45309; --danger: #b91c1c; --info: #2563eb;
  --shadow: 0 1px 2px rgba(28, 26, 23, 0.08);
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --bg: #faf9f7; --bg-elevated: #ffffff; --bg-hover: #f1efeb; --card: #ffffff;
    --border: #e6e2da; --border-strong: #d6d0c4; --text: #403c35; --text-strong: #1c1a17; --muted: #6e6960;
    --accent: #2563eb; --accent-subtle: rgba(37, 99, 235, 0.1);
    --ok: #15803d; --warn: #b45309; --danger: #b91c1c; --info: #2563eb;
    --shadow: 0 1px 2px rgba(28, 26, 23, 0.08);
  }
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: var(--text-md)/1.55 var(--font); }
h1, h2, h3 { color: var(--text-strong); margin: 0 0 8px; line-height: 1.3; }
h1 { font-size: 20px; } h2 { font-size: var(--text-lg); } h3 { font-size: var(--text-md); }
p { margin: 0 0 8px; }
code, .row-id, .row-at { font-family: var(--mono); }
a { color: var(--accent); }

/* Shell */
.shell { display: grid; grid-template-columns: var(--nav-width) minmax(0, 1fr); min-height: 100vh; }
.sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; gap: 16px; padding: 16px 12px; background: var(--bg-elevated); border-right: 1px solid var(--border); }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; color: var(--text-strong); font-size: var(--text-lg); padding: 0 8px; }
.brand-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
.nav { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.nav-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: var(--radius-sm); color: var(--text); text-decoration: none; font-size: var(--text-sm); }
.nav-item:hover { background: var(--bg-hover); }
.nav-item[aria-current="page"] { background: var(--accent-subtle); color: var(--text-strong); font-weight: 600; }
.nav-count { min-width: 22px; padding: 0 6px; border-radius: 999px; background: var(--border-strong); color: var(--text-strong); font-size: var(--text-xs); text-align: center; }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot-ok { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
.dot-danger { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
.sidebar-foot { margin-top: auto; font-size: var(--text-xs); color: var(--muted); padding: 0 8px; overflow-wrap: anywhere; }
.theme-pick { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.content { padding: 24px; min-width: 0; }
.section-pane:not([data-active="true"]) { display: none; }
.chain-banners:empty { display: none; }
.chain-banners { margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px; }

/* Generic surfaces inside panes: styles existing components without editing them */
.section-pane > section, .section-pane section[aria-label], .detail-block, .split-list, .split-detail {
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow);
}
.section-pane section { padding: 16px; margin-bottom: 16px; }
.section-pane section section { background: var(--bg); box-shadow: none; }
.section-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 4px; }
.section-lede { color: var(--muted); font-size: var(--text-sm); margin-bottom: 12px; }
.count { color: var(--muted); font-size: var(--text-sm); font-family: var(--mono); }
.empty { color: var(--muted); border: 1px dashed var(--border-strong); border-radius: var(--radius); padding: 18px; text-align: center; margin: 12px; }

/* Alerts and notes rendered by existing components */
[role="alert"], .chain-banner, .callout {
  border: 1px solid color-mix(in srgb, var(--danger) 34%, var(--border)); background: var(--danger-subtle);
  color: var(--text-strong); border-radius: var(--radius-sm); padding: 10px 12px; margin: 0 0 8px; font-size: var(--text-sm);
}
[role="note"], [role="status"] {
  border: 1px solid color-mix(in srgb, var(--info) 34%, var(--border)); background: var(--info-subtle);
  border-radius: var(--radius-sm); padding: 10px 12px; margin: 0 0 8px; font-size: var(--text-sm);
}
[role="status"] { border-color: color-mix(in srgb, var(--ok) 34%, var(--border)); background: var(--ok-subtle); }

/* Controls */
button, .btn {
  font: inherit; font-size: var(--text-sm); padding: 7px 14px; border-radius: var(--radius-sm); cursor: pointer;
  background: var(--bg-elevated); color: var(--text-strong); border: 1px solid var(--border-strong);
}
button:hover { background: var(--bg-hover); }
button[type="submit"], .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
input, select, textarea {
  font: inherit; font-size: var(--text-sm); color: var(--text-strong); background: var(--bg);
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 6px 8px;
}
textarea { min-height: 72px; width: 100%; resize: vertical; }
label { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-xs); color: var(--muted); margin-bottom: 10px; }
form { margin: 8px 0; }
table { border-collapse: collapse; width: 100%; font-size: var(--text-sm); }
th { text-align: left; color: var(--muted); font-weight: 600; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.04em; }
th, td { padding: 6px 8px; border-bottom: 1px solid var(--border); }

/* Pills */
.pill { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: var(--text-xs); border: 1px solid var(--border-strong); background: var(--bg-elevated); color: var(--text); }
.pill-warn { color: var(--warn); background: var(--warn-subtle); border-color: color-mix(in srgb, var(--warn) 34%, var(--border)); }

/* Decisions */
.filters { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.filters label { flex-direction: row; align-items: center; margin: 0; }
.split { display: grid; grid-template-columns: minmax(280px, 2fr) minmax(0, 3fr); gap: 16px; align-items: start; }
.split-list { max-height: calc(100vh - 180px); overflow-y: auto; }
.split-detail { padding: 20px; position: sticky; top: 24px; max-height: calc(100vh - 48px); overflow-y: auto; }
.decision-list { list-style: none; margin: 0; padding: 0; }
.decision-list li + li { border-top: 1px solid var(--border); }
.decision-row { display: flex; flex-direction: column; gap: 6px; width: 100%; text-align: left; border: 0; border-radius: 0; background: transparent; padding: 12px 14px; color: var(--text); }
.decision-row:hover { background: var(--bg-hover); }
.decision-row[aria-current="true"] { background: var(--accent-subtle); box-shadow: inset 3px 0 0 var(--accent); }
.row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: var(--text-xs); color: var(--muted); }
.row-project { font-weight: 600; }
.row-question {
  color: var(--text-strong); font-size: var(--text-sm); overflow-wrap: anywhere;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
}
.row-id { font-size: var(--text-xs); color: var(--muted); }
.decision-detail h2 { font-size: 18px; overflow-wrap: anywhere; }
.detail-block { padding: 12px 14px; margin: 12px 0; background: var(--bg); box-shadow: none; }
.detail-block h3 { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.detail-block p, .alternatives li { overflow-wrap: anywhere; }
.alternatives { margin: 0; padding-left: 18px; }
.alternatives .option { display: block; color: var(--text-strong); }
.alternatives .why-not { display: block; color: var(--muted); font-size: var(--text-sm); }
.actions { border-top: 1px solid var(--border); margin-top: 16px; padding-top: 16px; }
.detail-help { color: var(--muted); font-size: var(--text-xs); margin: 6px 0 14px; }

/* Metrics (existing MetricsView markup) */
.section-pane [data-testid$="-rate"], .section-pane [data-testid="panel-coverage-rate"] { font-size: 24px; font-weight: 700; color: var(--text-strong); letter-spacing: -0.03em; }
.caveats, .caveat, .stale-bias { color: var(--muted); font-size: var(--text-xs); }

@media (max-width: 760px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; }
  .nav { flex-direction: row; flex-wrap: wrap; }
  .sidebar-foot { margin-top: 0; width: 100%; }
  .split { grid-template-columns: 1fr; }
  .split-detail { position: static; max-height: none; }
  .content { padding: 16px; }
}
```

- [ ] **Step 5: Load CSS and apply theme at startup** — `web/src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";
import { applyTheme, readTheme } from "./theme.js";

const host = document.getElementById("root");
if (!host) throw new Error("orca panel: #root is missing from index.html");
let storage: Storage | undefined;
try {
  storage = window.localStorage;
} catch {
  storage = undefined;
}
applyTheme(document.documentElement, readTheme(storage));
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Green + build + served-asset check**

```bash
cd web && ../node_modules/.bin/vitest run tests/theme.test.ts > ../../t2-green.log 2>&1; echo RC=$?; cd ..
npm run build --workspace web > ../t2-build.log 2>&1; echo BUILD=$?
ls web/dist > ../t2-dist.txt; cat ../t2-green.log ../t2-build.log ../t2-dist.txt
```
Expected: RC 0; build RC 0; `web/dist` lists `index.html`, `index.js`, `index.css` (flat names; `staticFiles.ts` serves by exact name). If the CSS file has any other name, stop and report — do not change `staticFiles.ts`.

- [ ] **Step 7: Commit, then mutate (clone `mut-t2`, Task 1 Step 12 procedure)** — commit first with the Step 8 command, then M2-a: remove the `try/catch` in `readTheme` ⇒ expect `reads a stored choice…` red. Same clone procedure as Task 1 Step 11 (`mut-t2`), then `/bin/rm -rf`.

- [ ] **Step 8: The commit command for Step 7**

```bash
git add web/src/styles.css web/src/theme.ts web/src/main.tsx web/tests/theme.test.ts
git commit -m "feat(web): add the token stylesheet and a per-browser theme preference (ruling U3)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Sections and the Shell

**Files:**
- Create: `web/src/sections.ts`
- Create: `web/src/Shell.tsx`
- Create: `web/tests/shell.test.tsx`

**Interfaces:**
- Consumes: `ThemePref`, `THEME_PREFS` (Task 2).
- Produces:
  - `SECTIONS = ["decisions", "chains", "tasks", "metrics"] as const`; `type Section`; `DEFAULT_SECTION: Section = "decisions"`; `sectionFromHash(hash: string): Section`; `hashFor(section: Section): string`.
  - `interface ControlAlertInput { executionPort: string; resetRequired: boolean; refetchRequired: boolean; dispatchBlocked: boolean; blockers: number; refusal: boolean }`; `controlAlert(input: ControlAlertInput | null): boolean`.
  - `interface ShellBadges { unreviewed: number; chainRunning: boolean; controlAlert: boolean }`.
  - `Shell(props: { active: Section; badges: ShellBadges; footer: readonly string[]; theme: ThemePref; onTheme?: (pref: ThemePref) => void; banners?: ReactNode; children: ReactNode }): JSX.Element`.
  - `SectionPane(props: { section: Section; active: Section; children: ReactNode }): JSX.Element` — renders `<div className="section-pane" data-section={section} data-active={"true"|"false"}>`.

- [ ] **Step 1: Write the failing test** — `web/tests/shell.test.tsx`

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SECTIONS, hashFor, sectionFromHash } from "../src/sections.js";
import { SectionPane, Shell, controlAlert } from "../src/Shell.js";
import type { ControlAlertInput } from "../src/Shell.js";

/** Panel UI redesign spec §5.1 (ruling U2): a sidebar of sections, one visible at a time, none unmounted. */
describe("sections (ruling U2)", () => {
  it("round-trips every section through its hash and sends an empty or unknown hash to decisions", () => {
    for (const s of SECTIONS) expect(sectionFromHash(hashFor(s))).toBe(s);
    expect(sectionFromHash("")).toBe("decisions");
    expect(sectionFromHash("#")).toBe("decisions");
    expect(sectionFromHash("#nope")).toBe("decisions");
    // Review Focus 5: a link is a bare hash, so the ?token= query of the page URL survives a click.
    for (const s of SECTIONS) expect(hashFor(s)).toMatch(/^#[a-z]+$/);
  });
});

const quiet: ControlAlertInput = {
  executionPort: "configured", resetRequired: false, refetchRequired: false, dispatchBlocked: false, blockers: 0, refusal: false,
};

describe("controlAlert (spec §5.1, the six alert conditions ControlPanel renders)", () => {
  it("is false when nothing is wrong and when the control plane is not mounted", () => {
    expect(controlAlert(quiet)).toBe(false);
    expect(controlAlert(null)).toBe(false);
  });

  it("is true for each condition on its own", () => {
    expect(controlAlert({ ...quiet, executionPort: "unconfigured" })).toBe(true);
    expect(controlAlert({ ...quiet, resetRequired: true })).toBe(true);
    expect(controlAlert({ ...quiet, refetchRequired: true })).toBe(true);
    expect(controlAlert({ ...quiet, dispatchBlocked: true })).toBe(true);
    expect(controlAlert({ ...quiet, blockers: 1 })).toBe(true);
    expect(controlAlert({ ...quiet, refusal: true })).toBe(true);
  });
});

describe("Shell and SectionPane", () => {
  const render = (badges: { unreviewed: number; chainRunning: boolean; controlAlert: boolean }): string =>
    renderToStaticMarkup(
      <Shell active="chains" badges={badges} footer={["epoch e-1 · dispatch live"]} theme="system">
        <SectionPane section="decisions" active="chains"><p>pane-d</p></SectionPane>
        <SectionPane section="chains" active="chains"><p>pane-c</p></SectionPane>
      </Shell>,
    );

  it("marks only the active pane and nav item, and still renders every pane", () => {
    const html = render({ unreviewed: 118, chainRunning: false, controlAlert: false });
    expect(html).toContain('data-section="decisions" data-active="false"');
    expect(html).toContain('data-section="chains" data-active="true"');
    expect(html).toContain("pane-d");
    expect(html).toContain("pane-c");
    expect(html).toMatch(/href="#chains"[^>]*aria-current="page"/);
    expect(html).not.toMatch(/href="#decisions"[^>]*aria-current/);
    expect(html).not.toMatch(/\shidden(=|\s|>)/);
    expect(html).toContain("epoch e-1 · dispatch live");
  });

  it("shows the unreviewed count, and the chain and task dots only when they apply", () => {
    const off = render({ unreviewed: 118, chainRunning: false, controlAlert: false });
    expect(off).toMatch(/data-testid="nav-count-decisions"[^>]*>118</);
    expect(off).not.toContain('data-testid="nav-dot-chains"');
    expect(off).not.toContain('data-testid="nav-dot-tasks"');
    const on = render({ unreviewed: 0, chainRunning: true, controlAlert: true });
    expect(on).toContain('data-testid="nav-dot-chains"');
    expect(on).toContain('data-testid="nav-dot-tasks"');
  });
});
```

Add `// @vitest-environment node` is not needed (web vitest default env is `node`).

- [ ] **Step 2: Run red**

```bash
cd web && ../node_modules/.bin/vitest run tests/shell.test.tsx > ../../t3-red.log 2>&1; echo RC=$?; cd ..; cat ../t3-red.log
```
Expected: RC 1, modules not found.

- [ ] **Step 3: Implement** — `web/src/sections.ts`

```ts
/** Panel UI redesign spec §5.1 (ruling U2). The active section lives in the URL hash, so a reload stays put. */
export const SECTIONS = ["decisions", "chains", "tasks", "metrics"] as const;
export type Section = (typeof SECTIONS)[number];
export const DEFAULT_SECTION: Section = "decisions";

export function sectionFromHash(hash: string): Section {
  const name = hash.replace(/^#/, "");
  return (SECTIONS as readonly string[]).includes(name) ? (name as Section) : DEFAULT_SECTION;
}

export const hashFor = (section: Section): string => `#${section}`;
```

`web/src/Shell.tsx`:

```tsx
/**
 * Panel UI redesign spec §5.1 (ruling U2). Pure: App hands it everything. Every pane stays
 * mounted -- App-level criteria find Task control's buttons by role from the default
 * section, and `getByRole` skips anything `hidden` -- so only styles.css hides a pane.
 */
import type { JSX, ReactNode } from "react";
import { SECTIONS, hashFor } from "./sections.js";
import type { Section } from "./sections.js";
import { THEME_PREFS } from "./theme.js";
import type { ThemePref } from "./theme.js";

const LABELS: Record<Section, string> = { decisions: "Decisions", chains: "Chains", tasks: "Task control", metrics: "Metrics" };

/** The six conditions under which ControlPanel renders a role="alert" line. */
export interface ControlAlertInput {
  executionPort: string;
  resetRequired: boolean;
  refetchRequired: boolean;
  dispatchBlocked: boolean;
  blockers: number;
  refusal: boolean;
}

export function controlAlert(input: ControlAlertInput | null): boolean {
  if (input === null) return false;
  return (
    input.executionPort === "unconfigured" ||
    input.resetRequired ||
    input.refetchRequired ||
    input.dispatchBlocked ||
    input.blockers > 0 ||
    input.refusal
  );
}

export interface ShellBadges {
  unreviewed: number;
  chainRunning: boolean;
  controlAlert: boolean;
}

function Badge({ section, badges }: { section: Section; badges: ShellBadges }): JSX.Element | null {
  if (section === "decisions") return <span className="nav-count" data-testid="nav-count-decisions">{badges.unreviewed}</span>;
  if (section === "chains" && badges.chainRunning) return <span className="dot dot-ok" data-testid="nav-dot-chains" title="a chain is running" />;
  if (section === "tasks" && badges.controlAlert) return <span className="dot dot-danger" data-testid="nav-dot-tasks" title="needs attention" />;
  return null;
}

export function Shell(props: {
  active: Section;
  badges: ShellBadges;
  footer: readonly string[];
  theme: ThemePref;
  onTheme?: (pref: ThemePref) => void;
  banners?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Sections">
        <div className="brand"><span className="brand-dot" />Orca</div>
        <ul className="nav">
          {SECTIONS.map((section) => (
            <li key={section}>
              <a className="nav-item" href={hashFor(section)} aria-current={section === props.active ? "page" : undefined}>
                <span>{LABELS[section]}</span>
                <Badge section={section} badges={props.badges} />
              </a>
            </li>
          ))}
        </ul>
        <div className="sidebar-foot">
          {props.footer.map((line) => <p key={line}>{line}</p>)}
          <label className="theme-pick">
            Theme
            <select name="theme" value={props.theme} onChange={(e) => props.onTheme?.(e.currentTarget.value as ThemePref)}>
              {THEME_PREFS.map((pref) => <option key={pref} value={pref}>{pref}</option>)}
            </select>
          </label>
        </div>
      </nav>
      <main className="content">
        <div className="chain-banners">{props.banners}</div>
        {props.children}
      </main>
    </div>
  );
}

export function SectionPane(props: { section: Section; active: Section; children: ReactNode }): JSX.Element {
  return (
    <div className="section-pane" data-section={props.section} data-active={props.section === props.active ? "true" : "false"}>
      {props.children}
    </div>
  );
}
```

- [ ] **Step 4: Run green**

```bash
cd web && ../node_modules/.bin/vitest run tests/shell.test.tsx > ../../t3-green.log 2>&1; echo RC=$?; cd ..; cat ../t3-green.log
```
Expected: RC 0, 5 passed.

- [ ] **Step 5: Mutations (clone `mut-t3`)**

| Mutation | Expected red |
|---|---|
| M3-a: `data-active` always `"true"` | `marks only the active pane…` |
| M3-b: drop `input.dispatchBlocked \|\|` | `is true for each condition on its own` |
| M3-c: drop `input.blockers > 0 \|\|` | same |
| M3-d: `sectionFromHash` unknown ⇒ `"metrics"` | `round-trips every section…` |
| M3-e: `Badge` returns the tasks dot unconditionally | `shows the unreviewed count…` |

- [ ] **Step 6: Commit**

```bash
git add web/src/sections.ts web/src/Shell.tsx web/tests/shell.test.tsx
git commit -m "feat(web): add the sidebar shell and hash-addressed sections (ruling U2)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The Decisions pane

**Files:**
- Modify: `web/src/DecisionList.tsx` (render function + an ERRATUM on its header comment)
- Modify: `web/src/DecisionDetail.tsx` (layout + help copy)
- Create: `web/src/DecisionsView.tsx`
- Delete: `web/src/PanelHome.tsx`, `web/tests/panelHome.test.tsx`
- Rewrite: `web/tests/decisionList.test.tsx` › criterion 3
- Create: `web/tests/decisionsView.test.tsx`, `web/tests/styles.test.ts`

**Interfaces:**
- Consumes: `DecisionListRow` with `question` (Task 1); CSS classes (Task 2).
- Produces:
  - `DecisionList(props: { rows: readonly DecisionListRow[]; selected?: Pick<DecisionListRow, "projectKey" | "id"> | null; onOpen?: (row: DecisionListRow) => void })`; `NO_QUESTION = "(no question recorded)"`; `rowKey` unchanged.
  - `interface DecisionFilter { kind: string; scope: string; projectKey: string }` (`""` = any); `NO_FILTER`; `filterRows(rows, filter): DecisionListRow[]`.
  - `DecisionsView(props: { rows: readonly DecisionListRow[]; filter: DecisionFilter; onFilter?: (f: DecisionFilter) => void; selected?: Pick<DecisionListRow, "projectKey" | "id"> | null; onOpen?: (row: DecisionListRow) => void; detail?: ReactNode })`.
  - `DecisionDetail` props unchanged.

- [ ] **Step 1: Rewrite criterion 3** — `web/tests/decisionList.test.tsx`

Replace the first `it(...)` (keep the name) with:

```tsx
  // REWRITTEN (panel UI redesign spec §2/§6.1, human ruling U1, authorised as U4 in session
  // a50f4d80). The question now belongs on the row; the half of this criterion that still
  // matters is "the component never spreads the row", so a DIFFERENT extra field probes it.
  it("renders only the list fields, never an extra field on the row", () => {
    const row = {
      projectKey: "proj",
      id: "run/1",
      at: "2026-09-01T00:00:00.000Z",
      kind: "interface",
      scope: "repo",
      verdict: "ok",
      question: "the question text that now belongs on the row",
      because: "a reasoning value that must never leak into the list",
    } as unknown as DecisionListRow;

    const html = renderToStaticMarkup(<DecisionList rows={[row]} />);
    expect(html).toContain("run/1");
    expect(html).toContain("the question text that now belongs on the row");
    expect(html).not.toContain("a reasoning value that must never leak into the list");
  });
```
Update the file's header comment above `describe` with one line: `REWRITTEN under ruling U1 -- see the comment on the first criterion.`

- [ ] **Step 2: Write the new tests** — `web/tests/decisionsView.test.tsx`

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_QUESTION } from "../src/DecisionList.js";
import { DecisionsView, NO_FILTER, filterRows } from "../src/DecisionsView.js";
import type { DecisionListRow } from "../src/types.js";

const row = (over: Partial<DecisionListRow>): DecisionListRow => ({
  projectKey: "proj", id: "run/1", at: "2026-09-01T00:00:00.000Z", kind: "interface", scope: "repo", verdict: "ok", question: "q", ...over,
});
const rows = [
  row({ id: "run/1", kind: "interface", question: "first question" }),
  row({ id: "run/2", kind: "boundary", scope: "cross-repo", question: null }),
  row({ id: "run/3", projectKey: "other", kind: "interface" }),
];

/**
 * Carries the intent of the deleted panelHome criterion (task 8 ruling K5, rewritten under ruling U2
 * and authorised as U4 in session a50f4d80): the first screen is the work a person owes, so the
 * Decisions pane shows the to-do heading and the rows; sections.ts makes it the default section.
 */
describe("DecisionsView (rulings U1, U2; K5's intent)", () => {
  it("shows the to-do heading, every row's id and question, and N of M", () => {
    const html = renderToStaticMarkup(<DecisionsView rows={rows} filter={NO_FILTER} />);
    expect(html).toContain("Unreviewed high-tier decisions");
    for (const r of rows) expect(html).toContain(r.id);
    expect(html).toContain("first question");
    expect(html).toMatch(/data-testid="decision-count"[^>]*>3 of 3</);
  });

  it("shows the placeholder for a null question, and the row stays a button (Review Focus 4)", () => {
    const html = renderToStaticMarkup(<DecisionsView rows={[rows[1]!]} filter={NO_FILTER} />);
    expect(html).toContain(NO_QUESTION);
    expect(html).toMatch(/<li><button type="button"/);
  });

  it("filters by kind, scope and repository, each empty value meaning any", () => {
    expect(filterRows(rows, NO_FILTER).map((r) => r.id)).toEqual(["run/1", "run/2", "run/3"]);
    expect(filterRows(rows, { ...NO_FILTER, kind: "interface" }).map((r) => r.id)).toEqual(["run/1", "run/3"]);
    expect(filterRows(rows, { ...NO_FILTER, scope: "cross-repo" }).map((r) => r.id)).toEqual(["run/2"]);
    expect(filterRows(rows, { ...NO_FILTER, projectKey: "other" }).map((r) => r.id)).toEqual(["run/3"]);
  });

  it("says nothing is left to review when the list is empty (Review Focus 2)", () => {
    const html = renderToStaticMarkup(<DecisionsView rows={[]} filter={NO_FILTER} />);
    expect(html).toContain("Nothing to review.");
    expect(html).toContain("Select a decision to read it.");
  });

  it("says the filters match nothing, with 0 of M (Review Focus 3)", () => {
    const html = renderToStaticMarkup(<DecisionsView rows={rows} filter={{ ...NO_FILTER, kind: "abandon" }} />);
    expect(html).toContain("No decision matches these filters.");
    expect(html).toMatch(/data-testid="decision-count"[^>]*>0 of 3</);
  });

  it("marks the selected row and renders the detail it is given", () => {
    const html = renderToStaticMarkup(
      <DecisionsView rows={rows} filter={NO_FILTER} selected={{ projectKey: "proj", id: "run/2" }} detail={<p>detail-slot</p>} />,
    );
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain("detail-slot");
    expect(html).not.toContain("Select a decision to read it.");
  });
});
```

`web/tests/styles.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
};

/** jsdom never applies this sheet, so the two visual promises the spec makes are pinned on the sheet itself. */
describe("styles.css", () => {
  it("wraps a question with no break opportunity and clamps it to two lines (Review Focus 1)", () => {
    const q = rule(".row-question");
    expect(q).toContain("overflow-wrap: anywhere");
    expect(q).toContain("-webkit-line-clamp: 2");
  });

  it("hides inactive panes by class, the only thing allowed to hide one (spec §5.1)", () => {
    expect(rule('.section-pane:not([data-active="true"])')).toContain("display: none");
  });
});
```

- [ ] **Step 3: Run red**

```bash
cd web && ../node_modules/.bin/vitest run tests/decisionList.test.tsx tests/decisionsView.test.tsx tests/styles.test.ts > ../../t4-red.log 2>&1; echo RC=$?; cd ..; cat ../t4-red.log
```
Expected: RC 1 — `DecisionsView.js` missing, `NO_QUESTION` missing, the rewritten criterion red on the question assertion. `styles.test.ts` is already green (Task 2 wrote the rules); that is expected — its red is shown by mutation in Step 8.

- [ ] **Step 4: Implement `DecisionList.tsx`**

Replace `DecisionList` (keep `rowKey` and its comment unchanged):

```tsx
export const NO_QUESTION = "(no question recorded)";

export function DecisionList({
  rows,
  selected,
  onOpen,
}: {
  rows: readonly DecisionListRow[];
  selected?: Pick<DecisionListRow, "projectKey" | "id"> | null;
  onOpen?: (row: DecisionListRow) => void;
}): JSX.Element {
  const selectedKey = selected ? rowKey(selected) : null;
  return (
    <ul className="decision-list">
      {rows.map((row) => {
        const key = rowKey(row);
        return (
          <li key={key}>
            <button type="button" className="decision-row" aria-current={key === selectedKey ? "true" : undefined} onClick={() => onOpen?.(row)}>
              <span className="row-meta">
                <span className="pill field-kind">{String(row.kind)}</span>
                <span className="pill field-scope">{String(row.scope)}</span>
                {row.verdict !== "ok" && <span className="pill pill-warn field-verdict">{String(row.verdict)}</span>}
                <span className="row-project field-projectKey">{String(row.projectKey)}</span>
                <time className="row-at field-at" dateTime={String(row.at)}>{String(row.at).slice(0, 10)}</time>
              </span>
              <span className="row-question">{row.question ?? NO_QUESTION}</span>
              <span className="row-id field-id">{String(row.id)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```
Remove the now-unused `WEB_LIST_FIELDS` import. Append to the file's first comment block:

```tsx
 *
 * *** ERRATUM (2026-09-27, session a50f4d80, human ruling U1) ***
 * The row now also shows `question` (panel UI redesign spec §2). What still holds: this
 * component reads each field by name and never spreads the row, so any OTHER key on the
 * object still cannot reach the markup. Text above kept verbatim.
```

- [ ] **Step 5: Implement `DecisionsView.tsx`**

```tsx
/**
 * Panel UI redesign spec §5.1 (rulings U1, U2). Pure: App owns the fetches, the selection
 * and the detail; this lays out the heading, the filters, the list and the detail slot.
 * It takes over PanelHome's job (task 8 ruling K5): the Decisions pane is the default
 * section, so the first screen is still the work a person owes.
 */
import type { JSX, ReactNode } from "react";
import { DecisionList } from "./DecisionList.js";
import type { DecisionListRow } from "./types.js";

export interface DecisionFilter {
  kind: string;
  scope: string;
  projectKey: string;
}
export const NO_FILTER: DecisionFilter = { kind: "", scope: "", projectKey: "" };

export function filterRows(rows: readonly DecisionListRow[], filter: DecisionFilter): DecisionListRow[] {
  return rows.filter(
    (r) =>
      (filter.kind === "" || r.kind === filter.kind) &&
      (filter.scope === "" || r.scope === filter.scope) &&
      (filter.projectKey === "" || r.projectKey === filter.projectKey),
  );
}

const distinct = (rows: readonly DecisionListRow[], pick: (r: DecisionListRow) => string): string[] =>
  [...new Set(rows.map(pick))].sort();

function FilterSelect(props: {
  label: string;
  name: keyof DecisionFilter;
  values: string[];
  filter: DecisionFilter;
  onFilter?: (f: DecisionFilter) => void;
}): JSX.Element {
  return (
    <label>
      {props.label}
      <select
        name={`filter-${props.name}`}
        value={props.filter[props.name]}
        onChange={(e) => props.onFilter?.({ ...props.filter, [props.name]: e.currentTarget.value })}
      >
        <option value="">any</option>
        {props.values.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
    </label>
  );
}

export function DecisionsView(props: {
  rows: readonly DecisionListRow[];
  filter: DecisionFilter;
  onFilter?: (f: DecisionFilter) => void;
  selected?: Pick<DecisionListRow, "projectKey" | "id"> | null;
  onOpen?: (row: DecisionListRow) => void;
  detail?: ReactNode;
}): JSX.Element {
  const shown = filterRows(props.rows, props.filter);
  return (
    <div className="decisions">
      <div className="section-head">
        <h1>Unreviewed high-tier decisions</h1>
        <span className="count" data-testid="decision-count">{shown.length} of {props.rows.length}</span>
      </div>
      <p className="section-lede">
        High-tier decisions an agent recorded that nobody has reviewed yet. Open one, read it, then Agree or Correct.
      </p>
      <div className="filters">
        <FilterSelect label="Kind" name="kind" values={distinct(props.rows, (r) => String(r.kind))} filter={props.filter} onFilter={props.onFilter} />
        <FilterSelect label="Scope" name="scope" values={distinct(props.rows, (r) => String(r.scope))} filter={props.filter} onFilter={props.onFilter} />
        <FilterSelect label="Repository" name="projectKey" values={distinct(props.rows, (r) => r.projectKey)} filter={props.filter} onFilter={props.onFilter} />
      </div>
      <div className="split">
        <div className="split-list">
          {props.rows.length === 0 ? (
            <p className="empty">Nothing to review. Every high-tier decision has been reviewed.</p>
          ) : shown.length === 0 ? (
            <p className="empty">No decision matches these filters.</p>
          ) : (
            <DecisionList rows={shown} selected={props.selected} onOpen={props.onOpen} />
          )}
        </div>
        <div className="split-detail">{props.detail ?? <p className="empty">Select a decision to read it.</p>}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Restyle `DecisionDetail.tsx`** (props, test ids, names, form fields unchanged)

Replace the returned JSX with:

```tsx
    <article className="decision-detail">
      <p className="row-id">{decision.id}</p>
      <h2 data-testid="decision-question">{decision.question}</h2>
      <div className="detail-block">
        <h3>Chose</h3>
        <p className="chose" data-testid="decision-chose">{decision.chose}</p>
      </div>
      <div className="detail-block">
        <h3>Because</h3>
        <p className="because" data-testid="decision-because">{decision.because}</p>
      </div>
      {decision.alternatives.length > 0 && (
        <div className="detail-block">
          <h3>Rejected alternatives</h3>
          <ul className="alternatives">
            {decision.alternatives.map((alt) => (
              <li key={alt.option}>
                <span className="option" data-testid="alternative-option">{alt.option}</span>
                <span className="why-not" data-testid="alternative-why-not">{alt.why_not}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn-primary" onClick={onAgree}>Agree</button>
        <p className="detail-help">{AGREE_HELP}</p>
        <form className="correction-form" onSubmit={/* unchanged handler */}>
          <label>
            Kind
            <select name="kind" defaultValue={WEB_CORRECTION_KINDS[0]}>
              {WEB_CORRECTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>{`${kind} — ${KIND_HELP[kind]}`}</option>
              ))}
            </select>
          </label>
          <label>
            Because
            <textarea name="because" required />
          </label>
          <label>
            Chose instead (optional)
            <input name="chose_instead" type="text" />
          </label>
          <button type="submit">Correct</button>
          <p className="detail-help">{CORRECT_NOTE}</p>
        </form>
      </div>
    </article>
```
Keep the existing `onSubmit` arrow function body byte-identical. Add above the component:

```tsx
export const AGREE_HELP = "Mark reviewed: I read this and it needs no change. Counts toward review coverage.";
export const CORRECT_NOTE =
  "This records a correction; it does not edit the ledger. To change the decision itself, close it with orca correct --close or let the fix agent do it.";
export const KIND_HELP: Record<CorrectionKind, string> = {
  wrong: "the choice was wrong",
  not_my_taste: "defensible, but not what I would choose",
  stale: "it was right then, no longer true",
};
```
⚠️ The alternatives block was always rendered before; now it is omitted when there are none. `decisionDetail.test.tsx` always passes one alternative, so it is unaffected — confirm in Step 7.

Add to `web/tests/decisionsView.test.tsx`:

```tsx
import { DecisionDetail, CORRECT_NOTE, AGREE_HELP } from "../src/DecisionDetail.js";

describe("DecisionDetail's action copy (spec §5.2)", () => {
  it("says what Agree records and that Correct does not edit the ledger", () => {
    const html = renderToStaticMarkup(
      <DecisionDetail decision={{ id: "run/1", question: "q", chose: "c", because: "b", alternatives: [] }} />,
    );
    expect(html).toContain(AGREE_HELP);
    expect(html).toContain("it does not edit the ledger");
    expect(html).toContain(CORRECT_NOTE);
  });
});
```

- [ ] **Step 7: Delete PanelHome, run the web suite**

```bash
git rm -q web/src/PanelHome.tsx web/tests/panelHome.test.tsx
```
`App.tsx` still imports `PanelHome` — Task 5 replaces that import. To keep this task green on its own, change App's one usage now:

```tsx
import { DecisionsView, NO_FILTER } from "./DecisionsView.js";
…
      <DecisionsView rows={home.todo} filter={NO_FILTER} selected={selected} onOpen={setSelected} />
      <MetricsView report={home.report} coverage={home.coverage} />
```
(import `MetricsView` from `./MetricsView.js`; delete the `PanelHome` import). Then:

```bash
cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > ../../t4-tsc.log 2>&1; echo TSC=$?
../node_modules/.bin/vitest run > ../../t4-web.log 2>&1; echo RC=$?; cd ..; cat ../t4-tsc.log ../t4-web.log
```
Expected: TSC 0, RC 0. `appSelection.test.tsx` and `decisionDetail.test.tsx` must be green **unedited**.

- [ ] **Step 8: Mutations (clone `mut-t4`)**

| Mutation | Expected red |
|---|---|
| M4-a: `row-question` renders `""` instead of the question | rewritten criterion 3; `shows the to-do heading…` |
| M4-b: `DecisionList` spreads the row into the button (`<button {...(row as object)}`) — or renders `row.because` | rewritten criterion 3 (`because` leaks) |
| M4-c: `filterRows` ignores `scope` | `filters by kind, scope and repository…` |
| M4-d: delete the `rows.length === 0` branch | `says nothing is left to review…` |
| M4-e: delete `<p className="detail-help">{CORRECT_NOTE}</p>` | `says what Agree records…` |
| M4-f: remove `overflow-wrap: anywhere` from `.row-question` | `wraps a question with no break opportunity…` |

- [ ] **Step 9: Commit**

```bash
git add -A web/src web/tests
git commit -m "feat(web): split the decisions pane into a filtered list and an explained detail (rulings U1, U2)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Assemble App inside the Shell

**Files:**
- Modify: `web/src/ChainPanel.tsx` (extract `ChainBanners`; markup byte-identical)
- Modify: `web/src/App.tsx`
- Modify: `web/tests/chainPanel.test.tsx` — **no**; must stay green unedited.

**Interfaces:**
- Consumes: everything above.
- Produces: `ChainBanners(props: { banners: readonly Banner[]; onDismiss?: (chainId: string) => void }): JSX.Element` exported from `ChainPanel.tsx`.

- [ ] **Step 1: Extract `ChainBanners`**

In `ChainPanel.tsx`, move the `{banners.map((b) => ( <div … role="alert" …> … </div> ))}` block verbatim into:

```tsx
export function ChainBanners({ banners, onDismiss }: { banners: readonly Banner[]; onDismiss?: (chainId: string) => void }): JSX.Element {
  return <>{banners.map((b) => (/* the moved JSX, unchanged */))}</>;
}
```
and render `<ChainBanners banners={banners} onDismiss={onDismiss} />` where the block was. Then:

```bash
cd web && ../node_modules/.bin/vitest run tests/chainPanel.test.tsx > ../../t5-chain.log 2>&1; echo RC=$?; cd ..; cat ../t5-chain.log
```
Expected: RC 0 unedited.

- [ ] **Step 2: Wire App**

Imports to add: `Shell, SectionPane, controlAlert` from `./Shell.js`; `sectionFromHash, DEFAULT_SECTION` and `type Section` from `./sections.js`; `readTheme, writeTheme, applyTheme` and `type ThemePref` from `./theme.js`; `ChainBanners` from `./ChainPanel.js`; `DecisionFilter` type from `./DecisionsView.js`.

State (next to the existing `useState`s):

```tsx
  const [section, setSection] = useState<Section>(() =>
    typeof window === "undefined" ? DEFAULT_SECTION : sectionFromHash(window.location.hash),
  );
  const [filter, setFilter] = useState<DecisionFilter>(NO_FILTER);
  const [theme, setTheme] = useState<ThemePref>(() => readTheme(browserStorage()));

  useEffect(() => {
    const onHash = (): void => setSection(sectionFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
```

Replace the final `return ( <main> … </main> );` of the loaded state with:

```tsx
  const dismiss = (chainId: string): void => {
    const next = new Set(dismissed);
    next.add(chainId);
    setDismissed(next);
    writeDismissed(browserStorage(), next);
  };
  const summary = controlConfig !== null && control.recovery !== null ? summaryView(control) : null;
  const detail =
    selected !== null && decision !== null ? (
      <>
        {/* the existing <DecisionDetail …/>, status line and <Refusal …/> JSX, moved verbatim */}
      </>
    ) : null;

  return (
    <Shell
      active={section}
      badges={{
        unreviewed: home.todo.length,
        chainRunning: chains?.some((r) => r.chain?.state === "running") ?? false,
        controlAlert: controlAlert(
          summary === null || controlConfig === null || control.recovery === null
            ? null
            : {
                executionPort: controlConfig.executionPort,
                resetRequired: summary.resetRequired,
                refetchRequired: control.refetchRequired,
                dispatchBlocked: summary.dispatchBlocked || control.recovery.dispatchBlocked,
                blockers: control.recovery.blockers.length,
                refusal: control.refusal !== null,
              },
        ),
      }}
      footer={summary === null ? [] : [`epoch ${summary.epoch}`, summary.dispatchBlocked ? "dispatch blocked" : "dispatch live"]}
      theme={theme}
      onTheme={(pref) => {
        setTheme(pref);
        writeTheme(browserStorage(), pref);
        applyTheme(document.documentElement, pref);
      }}
      banners={chains !== null ? <ChainBanners banners={bannersFor(chains, dismissed)} onDismiss={dismiss} /> : null}
    >
      <SectionPane section="decisions" active={section}>
        <DecisionsView rows={home.todo} filter={filter} onFilter={setFilter} selected={selected} onOpen={setSelected} detail={detail} />
      </SectionPane>
      <SectionPane section="chains" active={section}>
        {chains !== null ? (
          <ChainPanel repos={chains} banners={[]} outcome={chainOutcome} onDismiss={dismiss} onStart={/* unchanged */} onStop={/* unchanged */} />
        ) : (
          <p className="empty">Chains have not loaded.</p>
        )}
      </SectionPane>
      <SectionPane section="tasks" active={section}>
        {controlConfig !== null && control.recovery !== null ? (
          <ControlPanel /* every prop exactly as today */ />
        ) : (
          <p className="empty">The task control plane is not available on this panel.</p>
        )}
      </SectionPane>
      <SectionPane section="metrics" active={section}>
        <MetricsView report={home.report} coverage={home.coverage} />
      </SectionPane>
    </Shell>
  );
```
Check the exact field names against `controlTypes.ts` / `controlState.ts` before writing (`ControlConfigV1.executionPort`, `ControlSummaryV1.resetRequired`, `RecoveryViewV1.blockers`, `ControlClientState.refusal`). If one does not exist under that name, stop and report — do not invent it.

`ChainPanel` now gets `banners={[]}`, so a banner renders once (in the shell), not twice. The `ErrorPage` and loading returns above stay as they are (App.test pins `orca panel` in the loading text).

Also update App's header comment: append

```tsx
 *
 * *** ERRATUM (2026-09-27, session a50f4d80, rulings U1/U2) ***
 * PanelHome is gone: the default view is the Decisions pane (DecisionsView), inside Shell.
 * Every pane stays mounted and only styles.css hides the inactive ones (spec §5.1).
```

- [ ] **Step 3: Full web suite and tsc**

```bash
cd web && ../node_modules/.bin/tsc --noEmit -p tsconfig.json > ../../t5-tsc.log 2>&1; echo TSC=$?
../node_modules/.bin/vitest run > ../../t5-web.log 2>&1; echo RC=$?; cd ..; cat ../t5-tsc.log ../t5-web.log
```
Expected: TSC 0, RC 0 with `agentPreviewRefresh`, `controlCommandRecovery`, `appSelection`, `App`, `chainPanel` all green **unedited**. A red here in any of them is a stop.

- [ ] **Step 4: Mutation (clone `mut-t5`)** — M5-a: render `<SectionPane>` children only when active (`{props.section === props.active && props.children}`) ⇒ expect `agentPreviewRefresh.test.tsx` red. This proves the "always mounted" rule is load-bearing for an existing criterion, not just for `shell.test.tsx`.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/ChainPanel.tsx
git commit -m "feat(web): assemble the panel inside the shell with every section mounted (ruling U2)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Whole-branch verification and a live look

- [ ] **Step 1: The success criterion (spec §6.3)** — each redirected, each read back whole:

```bash
npm run typecheck > ../v-typecheck.log 2>&1; echo TYPECHECK_RC=$?
./node_modules/.bin/vitest run > ../v-vitest.log 2>&1; echo VITEST_RC=$?
npm run build --workspace web > ../v-build.log 2>&1; echo BUILD_RC=$?
npm run --ws check > ../v-ws.log 2>&1; echo WS_RC=$?
npm run verify:panel > ../v-panel.log 2>&1; echo PANEL_RC=$?
```
All five RC 0. Compare counts with Task 0's baseline: new test files add, `panelHome.test.tsx` subtracts one. Report every number with the command and the branch HEAD it ran on.

- [ ] **Step 2: Live panel with redirected data**

```bash
S=/private/tmp/claude-501/-Users-biran-code-skills-loop-Orca/a50f4d80-40a9-4f62-a015-a75849f2a241/scratchpad
mkdir -p -m 700 $S/ui-data
ORCA_CORRECTIONS_DIR=$S/ui-data ORCA_CONTROL_DIR=$S/ui-data/control \
  ./node_modules/.bin/tsx src/cli.ts panel --by ui-check --port 7788 --repo orca=$PWD > $S/ui-panel.log 2>&1 &
```
Wait for `orca-panel ready` in the log, then `curl -s -o /dev/null -w "%{http_code}"` for `/?token=…`, `/index.js`, `/index.css` — all 200. `curl` `/api/todo` with the token and confirm rows carry non-null `question` for this repository's own ledger. Take a screenshot of `#decisions` (a row opened) and `#tasks`, once with the theme set to light and once dark (Playwright via the `webapp-testing` or `playwright` skill). Stop the panel and confirm port 7788 is free. Show the screenshots to the human; visual acceptance is theirs.

- [ ] **Step 3: Report** — what landed (commit subjects), the five RCs with counts, every mutation's red, anything skipped. Remind: merging `ui/panel-redesign` into `main` (`--ff-only` is impossible if `main` has moved — the human decides rebase vs merge) and removing the worktree are the human's.
