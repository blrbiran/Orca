### Task A4: `refusalExplain.ts` — decoded plan-rejection lists and run reasons

**Files:**
- Create `web/src/refusalExplain.ts`.
- Modify `web/src/locales/en.ts`: new top-level `refusal` subtree after `panelErrors` (line 724).
- Modify `web/src/locales/zh.ts`: mirrored `refusal` subtree after `panelErrors` (line 627).
- Test (create) `web/tests/refusalExplain.test.ts`.

**Interfaces:**
- Consumes: A3's `errorEntry`, `fillEntry`, `refusalDetail`, `refusalText`; A1's item vocabulary.
- Produces:
  - `export function explainRefusal(refusal: ControlRefusal): { text: string; items: string[] }` — for
    `control-plan-rejected` with a non-empty detail: `text` = `refusal.planRejected`, `items` = each `\n` item decoded;
    otherwise `text` = `refusalText(refusal)`, `items` = `[]`.
  - `export function planItemText(item: string): string` (spec §2.2(b)'s table; anything else verbatim).
  - `export function explainRunReason(reason: string): string | null` — entry for the prefix up to the first `:` with
    `{{detail}}` = the rest and `{{message}}` = the whole reason; `null` when no entry. Part D renders it in the runs table.

- [ ] **Step 1: Write the failing test** — create `web/tests/refusalExplain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { enErrors } from "../src/locales/en.js";
import { explainRefusal, explainRunReason } from "../src/refusalExplain.js";

/**
 * Spec 2026-10-08 §2.2(b): a refused plan's detail is a list, one item per line; the web turns each item into a line a
 * person can act on (anything it has no words for is shown verbatim), in the reader's language. A run's blocked reason is
 * explained by its prefix up to the first ':' (§2.2(a)).
 */
const rejected = (...items: string[]) => ({ status: 422, code: "control-plan-rejected", message: `control-plan-rejected:${items.join("\n")}`, commandRevision: null });

describe("explaining a refused plan (spec §2.2(b))", () => {
  it("turns every item kind into its English line, in order, and anything else verbatim", () => {
    const { text, items } = explainRefusal(rejected(
      "missing-target-version:a", "target-repo-mismatch", "missing-goal", "missing-success-conditions", "duplicate-success-condition",
      "duplicate-dependency:b", "dangling-dependency:c", "contract-json:d", "contract-shape:e", "contract-canonical:f",
      "malformed:tasks.0.labels: labels-invalid:Feature", "loop-plan-invalid:g:path-shape",
    ));
    expect(text).toBe("The plan was not imported. Fix each problem below in the plan file, then import it again.");
    expect(items).toEqual([
      "Task a has no targetVersion. Add a positive integer, usually 1.",
      "The plan's targetRepo is not this repository.",
      "The plan has no goal.",
      "The plan has no successConditions (at least one).",
      "Two success conditions are identical.",
      "Task b lists a dependency twice.",
      "Task c depends on a task that is not in the plan.",
      "Task d's contract file is not JSON.",
      "Task e's contract file does not match the contract format.",
      "Task f's contract file cannot be canonicalised.",
      "tasks.0.labels: labels-invalid:Feature",
      "loop-plan-invalid:g:path-shape",
    ]);
  });

  it("keeps a malformed item whose message holds commas whole", () => {
    expect(explainRefusal(rejected("malformed:<root>: Unrecognized key(s) in object: 'foo', 'bar'", "malformed:workBranch: String must contain at least 1 character(s)")).items)
      .toEqual(["<root>: Unrecognized key(s) in object: 'foo', 'bar'", "workBranch: String must contain at least 1 character(s)"]);
  });

  it("says the same in Chinese", async () => {
    await i18n.changeLanguage("zh");
    expect(explainRefusal(rejected("missing-target-version:a", "dangling-dependency:b", "malformed:goal: Required"))).toEqual({
      text: "计划没有导入。请在计划文件里改掉下面每一个问题，然后重新导入。",
      items: ["任务 a 没有 targetVersion。请填一个正整数，通常是 1。", "任务 b 依赖了一个计划里没有的任务。", "goal：Required"],
    });
  });

  it("lists nothing for any other refusal, and explains it by its entry with the detail", () => {
    expect(explainRefusal({ status: 422, code: "group-reserve-insufficient", message: "group-reserve-insufficient:tokens:1", commandRevision: 3 }))
      .toEqual({ text: enErrors["group-reserve-insufficient"]!.replace("{{detail}}", "tokens:1"), items: [] });
    expect(explainRefusal({ status: 422, code: "control-plan-rejected", message: "control-plan-rejected", commandRevision: null }))
      .toEqual({ text: "The plan was not imported: ", items: [] });
  });
});

describe("explaining a blocked run's reason (spec §2.2(a))", () => {
  it("explains it by its prefix up to the first ':', with the rest as the detail", () => {
    expect(explainRunReason("terminal:failed")).toBe("ccloop finished this run without success (outcome failed).");
    expect(explainRunReason("out-of-bounds:a.ts,b.ts")).toBe("The run changed files outside the paths it may change: a.ts,b.ts");
  });

  it("has nothing to say for free text or an Object.prototype name", () => {
    expect(explainRunReason("Error: socket hang up")).toBeNull();
    expect(explainRunReason("toString")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `cd web && ../node_modules/.bin/vitest run tests/refusalExplain.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1: cannot resolve `../src/refusalExplain.js`.

- [ ] **Step 3: Implement.**

  (a) `web/src/locales/en.ts`, after the `panelErrors` block (closing `},` at line 724):

```ts
  // Spec 2026-10-08 §2.2(b): a refused plan's items, one line each (web/src/refusalExplain.ts).
  refusal: {
    planRejected: "The plan was not imported. Fix each problem below in the plan file, then import it again.",
    planItem: {
      "missing-target-version": "Task {{task}} has no targetVersion. Add a positive integer, usually 1.",
      "target-repo-mismatch": "The plan's targetRepo is not this repository.",
      "missing-goal": "The plan has no goal.",
      "missing-success-conditions": "The plan has no successConditions (at least one).",
      "duplicate-success-condition": "Two success conditions are identical.",
      "duplicate-dependency": "Task {{task}} lists a dependency twice.",
      "dangling-dependency": "Task {{task}} depends on a task that is not in the plan.",
      "contract-json": "Task {{task}}'s contract file is not JSON.",
      "contract-shape": "Task {{task}}'s contract file does not match the contract format.",
      "contract-canonical": "Task {{task}}'s contract file cannot be canonicalised.",
      malformed: "{{path}}: {{msg}}",
    },
  },
```

  (b) `web/src/locales/zh.ts`, after its `panelErrors` block (closing `},` at line 627):

```ts
  refusal: {
    planRejected: "计划没有导入。请在计划文件里改掉下面每一个问题，然后重新导入。",
    planItem: {
      "missing-target-version": "任务 {{task}} 没有 targetVersion。请填一个正整数，通常是 1。",
      "target-repo-mismatch": "计划的 targetRepo 不是这个仓库。",
      "missing-goal": "计划没有 goal。",
      "missing-success-conditions": "计划没有 successConditions（至少要一条）。",
      "duplicate-success-condition": "有两条成功条件完全相同。",
      "duplicate-dependency": "任务 {{task}} 把同一个依赖列了两次。",
      "dangling-dependency": "任务 {{task}} 依赖了一个计划里没有的任务。",
      "contract-json": "任务 {{task}} 的契约文件不是 JSON。",
      "contract-shape": "任务 {{task}} 的契约文件不符合契约格式。",
      "contract-canonical": "任务 {{task}} 的契约文件无法规范化。",
      malformed: "{{path}}：{{msg}}",
    },
  },
```

  (c) Create `web/src/refusalExplain.ts`:

```ts
/**
 * Spec 2026-10-08 §2.2(a), (b): what a refusal and a blocked run's reason say in the reader's language. A refused plan's
 * detail is a list (one item per line, src/scheduler/planFile.ts); each item becomes a line a person can act on, and an
 * item this panel has no words for is shown verbatim. Pure apart from reading the current language.
 */
import type { ControlRefusal } from "./controlState.js";
import i18n, { errorEntry, fillEntry, refusalDetail, refusalText } from "./i18n.js";

const PLAN_REJECTED = "control-plan-rejected";
const PLAN_ITEMS = ["target-repo-mismatch", "missing-goal", "missing-success-conditions", "duplicate-success-condition"];
const TASK_ITEMS = ["missing-target-version", "duplicate-dependency", "dangling-dependency", "contract-json", "contract-shape", "contract-canonical"];

/** One item of a refused plan as a line (spec §2.2(b)'s table); anything else verbatim. */
export function planItemText(item: string): string {
  if (PLAN_ITEMS.includes(item)) return i18n.t(`refusal.planItem.${item}` as never) as string;
  const cut = item.indexOf(":");
  if (cut <= 0) return item;
  const kind = item.slice(0, cut);
  const rest = item.slice(cut + 1);
  if (TASK_ITEMS.includes(kind)) return i18n.t(`refusal.planItem.${kind}` as never, { task: rest } as never) as string;
  const split = rest.indexOf(": ");
  if (kind === "malformed" && split > 0) return i18n.t("refusal.planItem.malformed", { path: rest.slice(0, split), msg: rest.slice(split + 2) });
  return item;
}

/** A refusal's explanation, and for a refused plan its problems one per line (empty for every other refusal). */
export function explainRefusal(refusal: ControlRefusal): { text: string; items: string[] } {
  const detail = refusal.code === PLAN_REJECTED ? refusalDetail(refusal) : "";
  if (detail === "") return { text: refusalText(refusal), items: [] };
  return { text: i18n.t("refusal.planRejected"), items: detail.split("\n").map(planItemText) };
}

/** A blocked run's reason explained by its prefix up to the first ':' (the rest is its detail); null when there are no words for it. */
export function explainRunReason(reason: string): string | null {
  const cut = reason.indexOf(":");
  const entry = errorEntry(cut === -1 ? reason : reason.slice(0, cut));
  return entry === undefined ? null : fillEntry(entry, { message: reason, status: "", detail: cut === -1 ? "" : reason.slice(cut + 1) });
}
```

- [ ] **Step 4: Run, expect PASS** — `cd web && ../node_modules/.bin/vitest run tests/refusalExplain.test.ts tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx tests/i18nWidth.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0; web tsc ⇒ rc=0; root `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts > $S/out2.txt 2>&1; echo rc=$?` ⇒ rc=0 (the new module's literals are codes, not panel text).

- [ ] **Step 5: Mutation** — in `$M`:
  1. In `explainRefusal`, return `{ text: refusalText(refusal), items: [] }` unconditionally ⇒ "turns every item kind into its English line…" red.
  2. In `planItemText`, delete the `malformed` line ⇒ "keeps a malformed item whose message holds commas whole" red.
  3. In `explainRunReason`, look up the whole reason (`errorEntry(reason)`) ⇒ "explains it by its prefix…" red.

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add web/src/refusalExplain.ts web/src/locales/en.ts web/src/locales/zh.ts web/tests/refusalExplain.test.ts` and:

```
feat(web): decode a refused plan's problems into lines, and explain run reasons

explainRefusal turns control-plan-rejected's newline-separated items into one line each
(Task a has no targetVersion. Add a positive integer, usually 1.), in English and Chinese,
showing an unknown item verbatim; explainRunReason explains a blocked run's reason by its
prefix for the runs table.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

