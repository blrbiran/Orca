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

### Task A1: Plan import collects every problem in one refusal, one item per line

**Files:**
- Modify `src/scheduler/planFile.ts`: `sourceRejected` (lines 254-256), `schedulerControlPlanSourceOf` (lines 291-327).
- Test (create) `tests/scheduler/planSourceItems.test.ts`.

**Interfaces:**
- Consumes: `loadPlan`, `parseContract`, `expandPlanFileLoop`, `isLoopPlanTask`, `ControlError` (all existing).
- Produces: `control-plan-rejected` whose `detail` is the items joined by `"\n"`; item vocabulary
  `target-repo-mismatch`, `missing-goal`, `missing-success-conditions`, `duplicate-success-condition`,
  `duplicate-dependency:<task>`, `dangling-dependency:<task>`, `missing-target-version:<task>`, the task's contract
  item (`contract-json:<task>`, `contract-shape:<task>`, `contract-canonical:<task>`, `loop-plan-invalid:<task>:<reason>`,
  or a read failure's own detail such as `unsafe-source-file`), and stage 1's `malformed:<path>: <msg>` / bare codes.
  `control-metadata` and `task-control-metadata:<task>` are gone. A `\n` or `\r` inside one item is written as the two
  characters `\n` / `\r`, so the separator is unambiguous.

- [ ] **Step 1: Write the failing test** — create `tests/scheduler/planSourceItems.test.ts`:

```ts
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ControlError } from "../../src/control/errors.js";
import { schedulerControlPlanSourceOf } from "../../src/scheduler/planFile.js";

/**
 * Spec 2026-10-08 §2.2(b), (c): Web import names every problem it can see in ONE refusal, one item per line. Stage 1 is
 * loadPlan's schema check (its issues are the whole list); otherwise stage 2 collects the plan-level items, then each
 * task's in plan order -- so a person fixes a plan in one round instead of one import per problem.
 */
const LOOP = { plan: "bugfix", goal: "fix login", successCondition: "the login test passes", targetPaths: ["src/auth/**", "tests/auth/**"], checks: ["npm test"] };
const BASE = { targetRepo: "/abs/repo", ccloopBin: "/abs/cli.js", runsDir: "/abs/runs", workBranch: "orca/w/x", policy: "local-merge", ledgerMode: "out-of-repo" };
const GOOD = { ...BASE, goal: "ship", successConditions: ["passes"] };
const task = (taskId: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({ taskId, loop: LOOP, dependsOn: [], targetVersion: 1, ...over });

/** The refused plan's items, read back from the one ControlError the import throws. */
function itemsOf(read: () => unknown): string[] {
  try {
    read();
  } catch (error) {
    if (error instanceof ControlError && error.code === "control-plan-rejected") return (error.detail ?? "").split("\n");
    throw error;
  }
  throw new Error("the plan was not refused");
}

describe("Web import names every problem of a plan at once (spec 2026-10-08 §2.2(c))", () => {
  it("names five problems of one plan in one refusal, in the spec's order", () => {
    const { targetVersion: _none, ...withoutVersion } = task("a");
    const plan = { ...BASE, tasks: [withoutVersion, task("b", { dependsOn: ["ghost"] })] };
    expect(itemsOf(() => schedulerControlPlanSourceOf(plan, "/abs/other"))).toEqual([
      "target-repo-mismatch", "missing-goal", "missing-success-conditions", "missing-target-version:a", "dangling-dependency:b",
    ]);
  });

  it("gives a plan with one problem exactly one item", () => {
    const plan = { ...GOOD, tasks: [task("a"), task("b", { dependsOn: ["a", "a"] })] };
    expect(itemsOf(() => schedulerControlPlanSourceOf(plan, "/abs/repo"))).toEqual(["duplicate-dependency:b"]);
  });

  it("orders one task's items: repeated dependency, dangling dependency, missing targetVersion, then its contract", () => {
    const { targetVersion: _none, ...withoutVersion } = task("b", { dependsOn: ["a", "a", "ghost"], loop: { ...LOOP, targetPaths: ["src/*.ts"] } });
    const plan = { ...GOOD, successConditions: ["same", "same"], tasks: [task("a"), withoutVersion] };
    expect(itemsOf(() => schedulerControlPlanSourceOf(plan, "/abs/repo"))).toEqual([
      "duplicate-success-condition", "duplicate-dependency:b", "dangling-dependency:b", "missing-target-version:b", "loop-plan-invalid:b:path-shape",
    ]);
  });

  it("names every task's broken contract file, not only the first", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "orca-plan-items-")));
    await mkdir(join(root, "contracts"));
    const a = join(root, "contracts", "a.json"), b = join(root, "contracts", "b.json");
    await writeFile(a, "not json");
    await writeFile(b, "{}");
    const plan = { ...GOOD, tasks: [{ taskId: "a", contract: a, dependsOn: [], targetVersion: 1 }, { taskId: "b", contract: b, dependsOn: [], targetVersion: 1 }] };
    expect(itemsOf(() => schedulerControlPlanSourceOf(plan, "/abs/repo"))).toEqual(["contract-json:a", "contract-shape:b"]);
  });

  it("keeps a schema issue whose message holds commas as one item (stage 1)", () => {
    const items = itemsOf(() => schedulerControlPlanSourceOf({ ...GOOD, workBranch: "", foo: 1, bar: 2, tasks: [] }, "/abs/repo"));
    expect([...items].sort()).toEqual([
      "malformed:<root>: Unrecognized key(s) in object: 'foo', 'bar'",
      "malformed:workBranch: String must contain at least 1 character(s)",
    ]);
  });

  it("writes a newline inside an item as \\n, so the separator stays unambiguous", () => {
    expect(itemsOf(() => schedulerControlPlanSourceOf({ ...GOOD, "a\nb": 1, tasks: [] }, "/abs/repo"))).toEqual([
      "malformed:<root>: Unrecognized key(s) in object: 'a\\nb'",
    ]);
  });

  it("still imports a plan with no problem", () => {
    const source = schedulerControlPlanSourceOf({ ...GOOD, tasks: [task("a"), task("b", { dependsOn: ["a"] })] }, "/abs/repo");
    expect(source.tasks.map((entry) => [entry.taskId, entry.dependencyTaskIds, entry.targetVersion])).toEqual([["a", [], 1], ["b", ["a"], 1]]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/scheduler/planSourceItems.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1. Expected reds: "names five problems…" (gets `["control-metadata"]`), "orders one task's items…" (gets `["duplicate-success-condition"]`), "names every task's broken contract file…" (gets `["contract-json:a"]`), "keeps a schema issue…" (the items are comma-joined into one), "writes a newline…" (the raw newline splits it into two). "gives a plan with one problem exactly one item" and "still imports a plan with no problem" pass already.

- [ ] **Step 3: Implement** — in `src/scheduler/planFile.ts` replace lines 254-256:

```ts
function sourceRejected(detail: string): never {
  throw new ControlError("control-plan-rejected", detail);
}
```

with:

```ts
function sourceRejected(detail: string): never {
  throw new ControlError("control-plan-rejected", detail);
}

/**
 * Spec 2026-10-08 §2.2(b): one refusal carries every item, one per line. A JSON key or a contract path can hold a line
 * break, so one inside an item is written as the two characters `\n` (`\r` likewise) and the separator stays unambiguous.
 */
function rejectItems(items: readonly string[]): never {
  return sourceRejected(items.map(item => item.replace(/\r/g, "\\r").replace(/\n/g, "\\n")).join("\n"));
}

type TaskOriginal = { value: unknown; canonicalJson: string; hash: string; recipe?: LoopRecipe };

/** A task's contract (or loop expansion), or the item naming why it cannot be read -- so stage 2 sees every task's. */
function originalOrItem(task: PlanTask | LoopPlanTask, targetRepo: string): TaskOriginal | string {
  try {
    return isLoopPlanTask(task) ? expandPlanFileLoop(task, targetRepo) : { ...parseContract(task.contract, task.taskId), recipe: undefined };
  } catch (error) {
    if (error instanceof ControlError && error.code === "control-plan-rejected") return error.detail ?? error.code;
    throw error;
  }
}
```

and replace lines 291-327 (`/** N1 spec §8.3.1 … */` through the function's closing `}`) with:

```ts
/**
 * N1 spec §8.3.1: the Web import's checks over a plan object, with no file read (the split validator calls it too).
 * Spec 2026-10-08 §2.2(c): stage 1 is loadPlan's schema check -- its issues are the whole list, there is no plan to check
 * further; otherwise stage 2 collects the plan-level items, then each task's in plan order, and only a plan with none is
 * imported. A plan with one problem is refused exactly as before: one item, the same code and status.
 */
export function schedulerControlPlanSourceOf(raw: unknown, repositoryPath: string): SchedulerControlPlanSource {
  const loaded = loadPlan(raw, "");
  // Labels and progress spec §8 R12: a malformed plan's message -- which names a refused label -- travels in its item.
  if ("rejections" in loaded) return rejectItems(loaded.rejections.map(item => item.code === "malformed" ? `malformed:${item.message}` : item.code));
  const plan = loaded.plan;
  const items: string[] = [];
  if (plan.targetRepo !== repositoryPath) items.push("target-repo-mismatch");
  if (plan.goal === undefined) items.push("missing-goal");
  if (plan.successConditions === undefined || plan.successConditions.length === 0) items.push("missing-success-conditions");
  else if (new Set(plan.successConditions).size !== plan.successConditions.length) items.push("duplicate-success-condition");
  const taskIds = new Set(plan.tasks.map(task => task.taskId));
  const originals = new Map<string, TaskOriginal>();
  for (const task of plan.tasks) {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) items.push(`duplicate-dependency:${task.taskId}`);
    if (task.dependsOn.some(dependency => !taskIds.has(dependency))) items.push(`dangling-dependency:${task.taskId}`);
    if (task.targetVersion === undefined) items.push(`missing-target-version:${task.taskId}`);
    const original = originalOrItem(task, plan.targetRepo);
    if (typeof original === "string") items.push(original);
    else originals.set(task.taskId, original);
  }
  if (items.length > 0) return rejectItems(items);
  return {
    // No item above means goal, a non-empty successConditions and every targetVersion are present.
    goal: plan.goal!,
    successConditions: [...plan.successConditions!],
    ...(plan.agent ? { agent: plan.agent } : {}),
    ...(plan.reconcileAgent ? { reconcileAgent: plan.reconcileAgent } : {}),
    tasks: plan.tasks.map(task => {
      const original = originals.get(task.taskId)!;
      return {
        taskId: task.taskId,
        dependencyTaskIds: [...task.dependsOn],
        targetVersion: task.targetVersion!,
        ...(task.agent ? { agent: task.agent } : {}),
        ...(task.labels && task.labels.length > 0 ? { labels: [...task.labels] } : {}),
        ...(original.recipe ? { loop: original.recipe } : {}),
        originalContract: original.value,
        originalContractCanonicalJson: original.canonicalJson,
        originalContractHash: original.hash,
      };
    }),
  };
}
```

(`PlanTask`, `LoopPlanTask`, `LoopRecipe`, `isLoopPlanTask` are already declared/imported in this file: lines 11, 13, 28, 37.)

- [ ] **Step 4: Run, expect PASS** — the new file, then the files that pin this function's refusals:
  `./node_modules/.bin/vitest run tests/scheduler/planSourceItems.test.ts tests/scheduler/planFileLoop.test.ts tests/control/planImport.test.ts tests/control/loopPlanSkills.test.ts tests/control/loopPlanImport.test.ts tests/control/agentPlanImport.test.ts tests/control/targetVersion.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0 (read whole). `npm run typecheck > $S/tsc.txt 2>&1; echo rc=$?` ⇒ rc=0. (`tests/control/requirementSplit.test.ts` goes red here on `import:control-metadata`; A2 rewrites it. Run it to see exactly that one red.)

- [ ] **Step 5: Mutation** — in `$M`:
  1. Early return restored: insert `if (items.length > 0) return rejectItems(items);` right after the `duplicate-success-condition` line ⇒ `tests/scheduler/planSourceItems.test.ts` "names five problems of one plan in one refusal, in the spec's order" red (3 items).
  2. Contract items not collected: in `originalOrItem` replace `return error.detail ?? error.code;` with `throw error;` ⇒ "names every task's broken contract file, not only the first" red (thrown with `contract-json:a` alone).
  3. Separator: in `rejectItems` replace `.join("\n")` with `.join(",")` ⇒ "keeps a schema issue whose message holds commas as one item (stage 1)" red.
  4. Escape removed: replace the `.map(...)` in `rejectItems` with `.map(item => item)` ⇒ "writes a newline inside an item as \n…" red (two items).

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add src/scheduler/planFile.ts tests/scheduler/planSourceItems.test.ts` and:

```
fix(import): report every plan problem in one refusal, one item per line

Web import used to stop at its first problem and lumped a wrong targetRepo, a missing
goal and missing success conditions into control-metadata. Stage 1 keeps loadPlan's
issues; stage 2 now collects the plan-level items and each task's (dependencies,
targetVersion, its contract) in plan order, joined by a newline. control-metadata and
task-control-metadata:<task> are renamed to target-repo-mismatch, missing-goal,
missing-success-conditions and missing-target-version:<task>.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

### Task A2: The requirement split validator hands back one reason per import item

**Files:**
- Modify `src/control/requirementSplit.ts`: doc comment lines 81-85, the catch at lines 111-114.
- Modify (rewrite, approved) `tests/control/requirementSplit.test.ts`: comment lines 77-78, test at lines 86-91.
- Test (create) `tests/control/requirementSplitItems.test.ts`.

**Interfaces:**
- Consumes: A1's `\n`-separated detail.
- Produces: `export function importReasons(error: ControlError): string[]` — `(error.detail ?? error.code).split("\n").map(item => "import:" + item)`; `validateSplitDraft`'s import refusal reasons are `importReasons(error)`.

- [ ] **Step 1: Write the failing tests.**

  (a) Rewrite in `tests/control/requirementSplit.test.ts`. Current lines 77-78:

```ts
  // The Web import stops at its first refusal; a repeated dependency and repeated criterion texts are named beside every
  // other reason (here a missing target), not only when they are the draft's one fault.
```

  replaced by:

```ts
  // The Web import is only asked once every other check passed, so the split validator names a repeated dependency and
  // repeated criterion texts itself, beside every other reason (here a missing target), not only as the draft's one fault.
```

  Current lines 86-91:

```ts
  // What only the Web import itself decides (here: a plan with no success condition) still reaches the person by name.
  it("hands back what the Web import refuses beyond the checks above, by its detail", async () => {
    const traced = { ...VALID_SPLIT, tasks: VALID_SPLIT.tasks.map((t) => ({ ...t, traces: ["R1.ADR1"] })) };
    const out = await validate(traced, [], []);
    expect(out).toMatchObject({ ok: false, reasons: ["import:control-metadata"], layers: null, implicitEdges: null });
  });
```

  replaced by (spec §2.2(c) renames `control-metadata`; rewrite approved per §2.3 last bullet):

```ts
  // What only the Web import itself decides (here: a plan with no success condition) still reaches the person by name.
  // Rewritten for spec 2026-10-08 §2.2(c): the import names the missing piece (missing-success-conditions) instead of
  // the old catch-all control-metadata.
  it("hands back what the Web import refuses beyond the checks above, by its detail", async () => {
    const traced = { ...VALID_SPLIT, tasks: VALID_SPLIT.tasks.map((t) => ({ ...t, traces: ["R1.ADR1"] })) };
    const out = await validate(traced, [], []);
    expect(out).toMatchObject({ ok: false, reasons: ["import:missing-success-conditions"], layers: null, implicitEdges: null });
  });
```

  (b) Create `tests/control/requirementSplitItems.test.ts` (its own file: `vi.mock` is file-wide). No plan the split
  expands can carry two import problems through `validateSplitDraft` (every other import check is made earlier by the
  validator itself), so the import is replaced by one that refuses with two items, and the real validator is run:

```ts
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expandSplitDraft, importReasons, validateSplitDraft } from "../../src/control/requirementSplit.js";
import { ControlError } from "../../src/control/errors.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Spec 2026-10-08 §2.2(c): the Web import's refusal can carry several items; the split validator hands each back as
// its own `import:` reason, so the model's feedback stays one problem per line.
vi.mock("../../src/scheduler/planFile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/scheduler/planFile.js")>();
  const { ControlError: Refusal } = await import("../../src/control/errors.js");
  return { ...actual, schedulerControlPlanSourceOf: () => { throw new Refusal("control-plan-rejected", "missing-goal\nmissing-success-conditions"); } };
});

let root = "", repo = "", commit = "";
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "orca-split-items-")));
  repo = join(root, "repo"); await mkdir(join(repo, "src"), { recursive: true });
  const g = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main"); await writeFile(join(repo, "README.md"), "r"); await writeFile(join(repo, "src", "a.ts"), "a"); g("add", "-A"); g("commit", "-qm", "base");
  commit = g("rev-parse", "HEAD");
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("the split validator and a Web import refusal with several items (spec 2026-10-08 §2.2(c))", () => {
  it("hands back one import reason per item", async () => {
    const criteria = [{ id: "AC1", text: "An exported note opens as CommonMark." }, { id: "AC2", text: "Images in the note are links in the file." }];
    const plan = expandSplitDraft(VALID_SPLIT, { targetRepo: repo, ccloopBin: "/opt/ccloop/dist/cli.js", runsDir: "/var/orca/runs", groupId: "r", statement: "Export notes.", acceptanceCriteria: criteria });
    const out = await validateSplitDraft({ output: VALID_SPLIT, plan, repo, commit, criterionIds: ["AC1", "AC2"], adrIds: ["R1.ADR1"] });
    expect(out).toMatchObject({ ok: false, reasons: ["import:missing-goal", "import:missing-success-conditions"], layers: null, implicitEdges: null });
  });

  it("hands back a refusal with no detail by its code", () => {
    expect(importReasons(new ControlError("group-not-found"))).toEqual(["import:group-not-found"]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `./node_modules/.bin/vitest run tests/control/requirementSplitItems.test.ts tests/control/requirementSplit.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1: `requirementSplitItems.test.ts` fails to import `importReasons` (not exported); in `requirementSplit.test.ts` the rewritten test now passes (A1 landed) and every other test passes.

- [ ] **Step 3: Implement** — in `src/control/requirementSplit.ts` replace lines 81-85:

```ts
/**
 * N1 spec §8.3-§8.4 (Rule 5: code decides): every reason, in check order -- loadPlan's, the Web import's own dependency
 * and success-condition checks (which the import stops at the first of), each task's expansion, each target path
 * against the overview's commit, each trace -- and only for a draft with none, the import itself and the layers.
 */
```

with:

```ts
/**
 * Spec 2026-10-08 §2.2(c): the Web import's refusal as split reasons, one per item of its detail, so the model's
 * feedback stays one problem per line. A refusal with no detail is handed back by its code.
 */
export function importReasons(error: ControlError): string[] {
  return (error.detail ?? error.code).split("\n").map((item) => `import:${item}`);
}

/**
 * N1 spec §8.3-§8.4 (Rule 5: code decides): every reason, in check order -- loadPlan's, the Web import's own dependency
 * and success-condition checks, each task's expansion, each target path against the overview's commit, each trace --
 * and only for a draft with none, the import itself (one reason per item it names) and the layers.
 */
```

and line 113:

```ts
    return { ok: false, reasons: [`import:${error.detail ?? error.code}`], layers: null, implicitEdges: null };
```

with:

```ts
    return { ok: false, reasons: importReasons(error), layers: null, implicitEdges: null };
```

- [ ] **Step 4: Run, expect PASS** — same command as Step 2 ⇒ rc=0; then `./node_modules/.bin/vitest run tests/control/requirement*.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0; `npm run typecheck` ⇒ rc=0.

- [ ] **Step 5: Mutation** — in `$M`, revert line 113 to `reasons: [\`import:${error.detail ?? error.code}\`]` ⇒ `tests/control/requirementSplitItems.test.ts` "hands back one import reason per item" red (one reason `import:missing-goal\nmissing-success-conditions`).

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add src/control/requirementSplit.ts tests/control/requirementSplit.test.ts tests/control/requirementSplitItems.test.ts` and:

```
fix(requirements): hand back one split reason per Web import item

The split validator wrapped the import's whole detail as one import: reason; with the
import now naming every problem, each item becomes its own reason so the model reads
one problem per line. The control-metadata criterion is rewritten to the new name.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

### Task A3: English and Chinese refusal tables, `{{detail}}`, and the coverage criterion

**Files:**
- Modify `web/src/locales/en.ts`: append `export const enErrors` after the closing `} as const;` of `en` (line 770).
- Modify `web/src/locales/zh.ts`: `zhErrors` (lines 720-958): the `command-result-not-found` entry, and the view-shown reasons appended before the closing `};`.
- Modify `web/src/i18n.ts`: import line 10, `refusalText` and its doc (lines 92-106).
- Modify `web/src/Refusal.tsx`: doc lines 4-9 (now false for English).
- Modify (rewrite, approved) `tests/panel/refusalCoverage.test.ts` (whole file, 49 lines).
- Modify (rewrite, approved) `web/tests/refusalText.test.tsx`: header comment lines 2-6, the first test (lines 49-58); add one test.
- Modify (rewrite, approved) `web/tests/decisionsStatusFilter.test.tsx`: one assertion (line 171) and an import.

**Interfaces:**
- Produces (in `web/src/locales/en.ts`): `export const enErrors: Record<string, string>` — the same keys as `zhErrors`.
- Produces (in `web/src/i18n.ts`):
  - `export function errorEntry(code: string): string | undefined` — the current language's entry, own properties only.
  - `export function fillEntry(entry: string, values: { message: string; status: string; detail: string }): string`.
  - `export function refusalDetail(refusal: { code: string; message: string }): string` — `""` when the message is the code; the text after `<code>:` when it starts so; else the whole message.
  - `refusalText(refusal)` (same signature): current language's entry with `{{message}}`, `{{status}}`, `{{detail}}` filled, else the message as sent (unchanged fallback).
- Produces the coverage set's fourth list `VIEW_REASONS` (in the test) that Parts C/D/E extend; any code a later part adds gets an en and a zh entry in the same task.

- [ ] **Step 1: Write the failing tests.**

  (a) Replace `tests/panel/refusalCoverage.test.ts` whole (rewrite approved, spec §2.2(a), §2.3 first bullet):

```ts
import { describe, expect, it } from "vitest";
import { controlErrorCatalog } from "../../src/panel/controlErrors.js";
import { enErrors } from "../../web/src/locales/en.js";
import { zhErrors } from "../../web/src/locales/zh.js";

/**
 * Panel i18n spec §3.2, §6.4; spec 2026-10-08 §2.2(a): every refusal code with a machine-readable source has an entry in
 * BOTH languages -- every code of the control error catalog, every code the web itself makes (http-<n> is the one entry
 * http-status), the inline server codes without a catalog (listed here by hand, plan Task 10), and the reasons a group
 * view shows on a blocked run. A code with no entry falls back to the message as sent (web/tests/refusalText.test.tsx), so
 * a missing entry is visible, but it is a gap this criterion names. Internal codes that never reach the browser (they are
 * sent as control-internal-error) have no entry.
 * Rewritten for spec 2026-10-08 §2.3 (human-approved): English added, view-shown reasons added, `detail` allowed.
 */
const WEB_MADE = ["http-status", "http-unreachable", "panel-unreachable", "command-result-invalid"];
const BY_HAND = [
  // src/panel/api.ts, src/panel/reviewsLock.ts, src/panel/compactReviews.ts
  "decision-not-found", "panel-bad-request", "panel-internal-error", "reviews-store-busy", "reviews-store-is-symlink",
  // src/corrections/* (POST /api/corrections)
  "correction-row-invalid", "correction-already-recorded", "duplicate-correction-id", "correction-not-found", "corrections-store-busy",
  // src/metrics/* (the E2 gate, 409 on every read)
  "unresolved-project-keys", "key-matches-multiple-paths", "repo-path-missing", "archive-name-ambiguous", "future-rows-without-as-of", "as-of-not-a-timestamp",
  // src/panel/chains.ts and the ChainRejection codes its "rejected:" log line relays
  "repo-not-found", "chain-args-invalid", "chain-start-failed", "chain-start-timeout", "chain-not-found", "chain-not-running",
  "chain-config-invalid", "chain-config-missing", "chain-id-exists", "chain-id-invalid", "chain-lock-stale", "chain-logs-not-ignored",
  "chain-record-invalid", "chain-running", "claude-not-found", "detached-head", "gate-check-failed", "level-config-invalid",
  "model-window-unknown", "nested-chain", "no-chain-lock", "no-running-chain", "not-a-repository", "not-repository-top-level",
  "record-commit-refused", "repo-lock-held", "tsx-missing", "worktree-dirty",
  // src/panel/projects.ts, src/panel/projectRegistry.ts (project registry spec §6)
  "projects-from-command-line", "project-path-missing", "project-path-not-repository-root", "project-path-taken", "project-path-refused",
  "project-name-invalid", "project-name-taken", "project-unknown", "projects-file-invalid", "projects-file-changed",
  // src/panel/authRoutes.ts, src/panel/accounts/store.ts (accounts spec §3.2-§3.3, §8)
  "login-failed", "login-throttled", "csrf-required", "password-too-short", "user-name-invalid", "user-name-taken", "owner-required",
  "user-role-invalid", "notice-not-found", "user-not-found",
  // src/control/spendCaps.ts gateClaim (accounts spec §6.3.1): projected on a group view, never a command outcome
  "spend-cap-reached",
];
/**
 * Spec 2026-10-08 §2.2(a): a blocked run's reason (drive.blockedReason), matched by its prefix up to the first ':'
 * (web/src/refusalExplain.ts explainRunReason). The literal reasons of src/control/executionDriver.ts's blockRun calls and
 * of the single-call purposes' prepare/usageUnknownReason, at b04e2cb; a reason that is free text (describeError) has no
 * entry and is shown as sent. Part D adds ccloop's stop reasons here.
 */
const VIEW_REASONS = [
  // src/control/executionDriver.ts blockRun(...)
  "agent-unfrozen", "repository-path", "continuation-registration", "skills-unsupported-agent", "skills-inject-failed",
  "config-hash-mismatch", "stop-proof-generation", "inspect-unknown", "accept-refused", "candidate-without-terminal", "terminal",
  "out-of-bounds", "single-call-record-invalid", "single-call-prompt-mismatch", "settle-incomplete",
  // src/control/requirementCalls.ts, src/control/singleCallPurposes.ts (prepare's `blocked`, `usageUnknownReason`)
  "requirement-call-target-moved", "estimate-request-missing", "requirement-usage-unknown", "estimate-usage-unknown",
];
const TABLES = { zh: zhErrors, en: enErrors } as const;
const has = (table: Record<string, string>, code: string): boolean => Object.prototype.hasOwnProperty.call(table, code);
const required = (): string[] => [...controlErrorCatalog().map((entry) => entry.code), ...WEB_MADE, ...BY_HAND, ...VIEW_REASONS];

describe("refusal coverage in both languages (panel i18n spec §6.4; spec 2026-10-08 §2.2(a))", () => {
  it.each(Object.keys(TABLES) as Array<keyof typeof TABLES>)("has a %s entry for every catalog code, web-made code, hand-listed code and view-shown reason", (lang) => {
    // 149 catalog codes at b04e2cb (./node_modules/.bin/tsx -e 'import("./src/panel/controlErrors.ts").then(m=>console.log(m.controlErrorCatalog().length))').
    expect(controlErrorCatalog().length).toBeGreaterThanOrEqual(149);
    expect(required().filter((code) => !has(TABLES[lang], code))).toEqual([]);
  });

  it("keeps the two tables over the same codes", () => {
    expect(Object.keys(enErrors).sort()).toEqual(Object.keys(zhErrors).sort());
  });

  it("interpolates nothing but the refusal's message, status and detail, and has no empty entry", () => {
    for (const [lang, table] of Object.entries(TABLES)) {
      for (const [code, text] of Object.entries(table)) {
        expect(text.trim(), `${lang} ${code}`).not.toBe("");
        expect([...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).filter((name) => !["message", "status", "detail"].includes(name!)), `${lang} ${code}`).toEqual([]);
      }
    }
  });

  // The code is on screen beside the explanation (spec §2.2(a)); the English text never repeats it, so it interpolates
  // the detail (the message after `<code>:`), not the whole message. http-status's message carries no code.
  it("never repeats the code in English", () => {
    for (const [code, text] of Object.entries(enErrors)) {
      expect(text.includes(code), code).toBe(false);
      if (code !== "http-status") expect(text.includes("{{message}}"), code).toBe(false);
    }
  });
});
```

  (b) In `web/tests/refusalText.test.tsx`: add `import { enErrors } from "../src/locales/en.js";` after the `i18n` import (line 14). Replace header lines 2-6:

```ts
/**
 * Panel i18n spec §3.2, §3.3, §6.4: an English refusal shows the server's message byte for byte (the refusal, the error
 * page, the control line); Chinese shows the entry for its code, with the server's detail where the entry carries it, and
 * the message as sent for a code with no entry (Review Focus 4) -- the code stays on screen either way. The web's own
 * messages are built in the reader's language.
 */
```

  with:

```ts
/**
 * Panel i18n spec §3.2, §3.3, §6.4; spec 2026-10-08 §2.2(a): a refusal shows the current language's entry for its code
 * (English and Chinese alike), with the server's detail where the entry carries it, and the message as sent, byte for
 * byte, for a code with no entry (Review Focus 4) -- the code stays on screen either way. The web's own messages are
 * built in the reader's language.
 */
```

  Replace the first test (lines 49-58), whose current assertions are:

```ts
    render(<Refusal refusal={{ status: 409, code: "revision-conflict", message: SENT }} />);
    expect(screen.getByTestId("refusal-message").textContent).toBe(SENT);
    ...
    render(<ErrorPage failure={{ status: 409, code: "unresolved-project-keys", message: SENT }} />);
    expect(screen.getByTestId("error-message").textContent).toBe(SENT);
    ...
    expect(controlLine({ status: 409, code: "revision-conflict", message: SENT, commandRevision: 7 })).toBe(`revision-conflict · HTTP 409 · server revision 7 · ${SENT}`);
```

  with (spec §2.1 root cause 1: English used to show machine text; rewrite approved):

```tsx
  // Rewritten for spec 2026-10-08 §2.2(a) (human-approved): English shows its own entry for a known code -- it used to show
  // the server's message, e.g. `control-plan-rejected:task-control-metadata:a`. The message as sent, byte for byte, is
  // still the fallback for a code with no entry, in every place a refusal is shown.
  it("renders an English refusal's entry for a known code, and the message byte for byte for a code with none, in the refusal, the error page and the control line", () => {
    render(<Refusal refusal={{ status: 409, code: "revision-conflict", message: SENT }} />);
    expect(screen.getByTestId("refusal-message").textContent).toBe(enErrors["revision-conflict"]);
    cleanup();
    render(<Refusal refusal={{ status: 409, code: "a-code-nobody-listed", message: SENT }} />);
    expect(screen.getByTestId("refusal-message").textContent).toBe(SENT);
    cleanup();
    render(<ErrorPage failure={{ status: 409, code: "a-code-nobody-listed", message: SENT }} />);
    expect(screen.getByTestId("error-message").textContent).toBe(SENT);
    expect(screen.getByTestId("error-status").textContent).toBe("answered 409");
    cleanup();
    expect(controlLine({ status: 409, code: "revision-conflict", message: SENT, commandRevision: 7 })).toBe(`revision-conflict · HTTP 409 · server revision 7 · ${enErrors["revision-conflict"]}`);
    cleanup();
    expect(controlLine({ status: 409, code: "a-code-nobody-listed", message: SENT, commandRevision: 7 })).toBe(`a-code-nobody-listed · HTTP 409 · server revision 7 · ${SENT}`);
  });

  it("fills {{detail}} with the message after `<code>:`, the whole message when it has no such prefix, and nothing when it is the code", () => {
    expect(refusalText({ code: "labels-invalid", message: "labels-invalid:count:17", status: 422 })).toBe("The labels are not valid: count:17");
    expect(refusalText({ code: "labels-invalid", message: "17 labels are too many", status: 422 })).toBe("The labels are not valid: 17 labels are too many");
    expect(refusalText({ code: "labels-invalid", message: "labels-invalid", status: 422 })).toBe("The labels are not valid: ");
    expect(refusalText({ code: "http-502", message: "POST /x: the panel may not have committed this command", status: 502 }))
      .toBe("The panel answered HTTP 502 without an error code: POST /x: the panel may not have committed this command");
  });
```

  (c) In `web/tests/decisionsStatusFilter.test.tsx` add `import { enErrors } from "../src/locales/en.js";` to the imports, and in "opens a reviewed decision with the correction form, and a second correction shows the refusal" replace line 171:

```ts
    expect((await screen.findByTestId("refusal-message")).textContent).toBe(ALREADY.message);
```

  with (spec §2.2(a): English shows the code's entry; rewrite approved):

```ts
    // Rewritten for spec 2026-10-08 §2.2(a) (human-approved): English shows the code's own entry, as Chinese always did.
    expect((await screen.findByTestId("refusal-message")).textContent).toBe(enErrors["correction-already-recorded"]);
```

- [ ] **Step 2: Run it, expect FAIL** — root: `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1 (`enErrors` is not exported: every test fails on the import / `undefined`). Web: `cd web && ../node_modules/.bin/vitest run tests/refusalText.test.tsx tests/decisionsStatusFilter.test.tsx > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1 (`enErrors` undefined; the `{{detail}}` test gets the message as sent).

- [ ] **Step 3: Implement.**

  (a) `web/src/locales/zh.ts`. Replace the entry

```ts
  "command-result-not-found": "台账里没有这条命令的结果。",
```

  with (the web composes this code's message itself, `UsagePanel.tsx` line 101, so the entry must carry it — today Chinese drops the "not applied; try again" sentence):

```ts
  "command-result-not-found": "台账里没有这条命令的结果：{{detail}}",
```

  and append before the table's closing `};` (line 958):

```ts
  // Spec 2026-10-08 §2.2(a): the reasons a group view shows on a blocked run, by prefix up to the first ':'
  // (web/src/refusalExplain.ts explainRunReason; tests/panel/refusalCoverage.test.ts VIEW_REASONS).
  "agent-unfrozen": "运行的 agent 与确认时冻结的不一致，所以没有启动。",
  "continuation-registration": "这个运行要续接的续跑没有登记，所以没有启动。",
  "skills-inject-failed": "给运行注入技能失败（{{detail}}）；修好 syncskill 后重试运行。",
  "config-hash-mismatch": "ccloop 接受这个运行时用的配置与冻结的不一致，所以停在这里。",
  "stop-proof-generation": "ccloop 的停止证明属于这个运行的另一代。",
  "inspect-unknown": "多次检查后 ccloop 仍说不清这个运行是否还活着；ccloop 能回答后再重试运行。",
  "accept-refused": "ccloop 拒绝接受这个运行：{{detail}}",
  "candidate-without-terminal": "ccloop 停止了这个运行，但没有最终报告，所以无法结算。",
  "terminal": "ccloop 结束了这个运行，但没有成功（结果 {{detail}}）。",
  "out-of-bounds": "运行改了允许范围之外的文件：{{detail}}",
  "single-call-record-invalid": "单次调用的记录读不懂。",
  "single-call-prompt-mismatch": "单次调用回答的不是发出去的那个提示。",
  "settle-incomplete": "运行没有结算完；请重试运行。",
  "requirement-call-target-moved": "这次调用开始前需求已经往前走了，所以没有发出。",
  "estimate-request-missing": "这份估算没有冻结的请求，所以无法运行。",
  "requirement-usage-unknown": "这次需求调用的用量未知，所以它的预算无法结算。",
  "estimate-usage-unknown": "这次估算调用的用量未知，所以它的预算无法结算。",
  "repository-path": "解析不到这个组的仓库路径；确认仓库仍已登记并且存在，然后重试运行。",
```

  (`skills-unsupported-agent` already has a zh entry from the catalog.)

  (b) `web/src/locales/en.ts`: append after line 770 (`} as const;`):

```ts

/**
 * Spec 2026-10-08 §2.2(a): the English text shown for a refusal code (and a blocked run's reason) in place of the
 * server's message, keyed exactly as zhErrors (tests/panel/refusalCoverage.test.ts keeps the two key sets equal). Each
 * entry says what happened and, where there is one, what to do next; it interpolates {{detail}} (the message after
 * `<code>:`) wherever the Chinese entry carries the message, so the code shown beside it is never repeated. Not part of
 * the `en` key set, like zhErrors.
 */
export const enErrors: Record<string, string> = {
  // ... generated per the rule below, in zhErrors' order and with its section comments in English ...
};
```

  **Generation rule (the executor writes every entry; `tests/panel/refusalCoverage.test.ts` is the acceptance):**
  1. One English entry for every key of `zhErrors` after (a) above — same keys, same order, same section comments
     translated to English. Nothing else.
  2. Text: one sentence saying what happened, then — when the code's meaning implies something the person can do in the
     panel or at the command line — one short imperative sentence saying it. Meaning comes from the zh entry, the code's
     registration in `src/control/errors.ts` (status: 409 = someone else moved first / state conflict, 422 = request not
     acceptable now, 404 = not found, 423 = locked by recovery, 503 = try again later), and the throw sites found with
     `grep -rn '"<code>"' src` (read them; do not guess). No second sentence when there is no honest action (an internal
     identity conflict, an invariant). Button names are quoted as `en.ts` spells them ("Retry run", "Import plan",
     "Record another", "Resume dispatch").
  3. Placeholders: wherever the zh entry has `{{message}}`, the English entry has `{{detail}}` instead, placed where the
     server's words read naturally; `http-status` keeps `{{status}}` and `{{message}}` (its message carries no code). No
     other placeholder; the text never contains its own code.
  4. Plain ASCII punctuation, sentence case, ending with a period unless it ends in a placeholder.
  5. These entries are written verbatim (some are pinned by criteria):

```ts
  "control-plan-rejected": "The plan was not imported: {{detail}}",
  "stop-mode-conflict": "The group's current stop does not allow this command. Leave the stop first (\"Resume dispatch\", or the resume offered after a handoff), then try again.",
  "revision-conflict": "Another tab or session changed this group first. The group is read again; check it, then try again.",
  "group-state-invalid": "The group's current state does not allow this command. Only the buttons its view shows apply now.",
  "group-reserve-insufficient": "The group's unallocated reserve is too small ({{detail}}). Raise the group limit or lower another allocation in the budget editor, then try again.",
  "panel-draining": "The panel is shutting down and accepts no commands. Start it again, then retry.",
  "recovery-blocked": "Recovery is blocked: {{detail}}. Clear what the Recovery section names, then retry.",
  "control-port-unconfigured": "This panel has no execution port, so it serves only recovery and evidence. Restart it with an agents table to run work.",
  "group-stopped": "The group is stopped. Resume it before sending this command.",
  "dependency-not-done": "A task this one depends on is not done yet. Wait for it to finish.",
  "estimate-in-flight": "An estimate is already running for this group. Wait for it to finish, then try again.",
  "work-already-active": "This task already has an active run. Wait for it to settle.",
  "command-result-not-found": "The ledger has no result for this command: {{detail}}",
  "control-internal-error": "The control plane failed internally: {{detail}}. Retry; if it repeats, read the panel's log.",
  "http-status": "The panel answered HTTP {{status}} without an error code: {{message}}",
  "panel-unreachable": "Could not reach the panel: {{detail}}. Check that it is running, then reload the page.",
  "csrf-required": "The request lacks its CSRF header. Reload the page, then try again.",
  "correction-already-recorded": "You already recorded a correction on this decision. To record a second, separate one, choose \"Record another\"; it is kept alongside the first rather than replacing it.",
  "labels-invalid": "The labels are not valid: {{detail}}",
  "terminal": "ccloop finished this run without success (outcome {{detail}}).",
  "out-of-bounds": "The run changed files outside the paths it may change: {{detail}}",
```

  (c) `web/src/i18n.ts`: line 10 `import { en } from "./locales/en.js";` becomes `import { en, enErrors } from "./locales/en.js";`. Replace lines 92-106 (the `refusalText` doc comment and function) with:

```ts
/** The current language's refusal table (spec 2026-10-08 §2.2(a)). */
function errorTable(): Record<string, string> {
  return currentLanguage() === "zh" ? zhErrors : enErrors;
}

/** The current language's entry for a code; hasOwnProperty, so a code such as "toString" never finds an Object.prototype member. */
export function errorEntry(code: string): string | undefined {
  const table = errorTable();
  return Object.prototype.hasOwnProperty.call(table, code) ? table[code] : undefined;
}

/** An entry with its {{message}}, {{status}} and {{detail}} filled. */
export function fillEntry(entry: string, values: { message: string; status: string; detail: string }): string {
  return entry.replace(/\{\{(message|status|detail)\}\}/g, (_match: string, name: "message" | "status" | "detail") => values[name]);
}

/** Spec 2026-10-08 §2.2(a): the server's words after `<code>:` -- nothing when the message is the code, all of it when it has no such prefix. */
export function refusalDetail(refusal: { code: string; message: string }): string {
  if (refusal.message === refusal.code) return "";
  const prefix = `${refusal.code}:`;
  return refusal.message.startsWith(prefix) ? refusal.message.slice(prefix.length) : refusal.message;
}

/**
 * Spec §3.2; spec 2026-10-08 §2.2(a): what a refusal says -- the current language's entry for its code (http-<n> is the
 * one entry http-status), with {{message}}, {{status}} and {{detail}} filled from the refusal, else the message as sent.
 * The code is on screen beside it, so the fallback is visible.
 */
export function refusalText(refusal: { code: string; message: string; status: number | null }): string {
  const key = /^http-\d+$/.test(refusal.code) ? "http-status" : refusal.code;
  const entry = errorEntry(key);
  if (entry === undefined) return refusal.message;
  return fillEntry(entry, { message: refusal.message, status: String(refusal.status ?? ""), detail: refusalDetail(refusal) });
}
```

  (d) `web/src/Refusal.tsx` lines 4-9:

```ts
 * `renderToStaticMarkup` (plan ruling 2). The server's `code` and `message`
 * are shown as sent -- in English; in Chinese the message is the entry for its
 * code when there is one (panel i18n spec §3.2) -- the message is the panel's
 * own sentence (spec §4.4), and for a failed `reviewed` mark it is the only
 * place the person learns the correction landed but the mark did not (spec
 * §4.3.1), so the Chinese entries for the codes that path relays carry it.
```

  become:

```ts
 * `renderToStaticMarkup` (plan ruling 2). The server's `code` is shown as
 * sent; the message is the current language's entry for its code when there is
 * one (panel i18n spec §3.2, spec 2026-10-08 §2.2(a)) -- the message is the panel's
 * own sentence (spec §4.4), and for a failed `reviewed` mark it is the only
 * place the person learns the correction landed but the mark did not (spec
 * §4.3.1), so both languages' entries for the codes that path relays carry it.
```

- [ ] **Step 4: Run, expect PASS** — root: `./node_modules/.bin/vitest run tests/panel/refusalCoverage.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0; `npm run typecheck` ⇒ rc=0. Web: `cd web && ../node_modules/.bin/vitest run tests/refusalText.test.tsx tests/decisionsStatusFilter.test.tsx tests/usagePanel.test.tsx tests/i18nKeys.test.ts tests/i18nPseudo.test.tsx > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0. Then the whole web suite: `npm run --workspace web check > $S/web.txt 2>&1; echo rc=$?` ⇒ rc=0. If any other web test is red, stop and report it by name (Rule 12): only the three rewrites above are approved.

- [ ] **Step 5: Mutation** — in `$M`:
  1. Delete the `enErrors` entry `"group-not-found"` ⇒ `refusalCoverage.test.ts` "has a en entry for every …" red, and "keeps the two tables over the same codes" red.
  2. Delete the `zhErrors` entry `"group-not-found"` ⇒ "has a zh entry for every …" red.
  3. Write `"labels-invalid": "The labels are not valid: {{message}}"` in `enErrors` ⇒ "never repeats the code in English" red.
  4. In `refusalText`, pass `detail: refusal.message` ⇒ `web/tests/refusalText.test.tsx` "fills {{detail}} …" red.
  5. Restore `if (currentLanguage() !== "zh") return refusal.message;` as `refusalText`'s first line ⇒ "renders an English refusal's entry for a known code …" red.

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add web/src/locales/en.ts web/src/locales/zh.ts web/src/i18n.ts web/src/Refusal.tsx tests/panel/refusalCoverage.test.ts web/tests/refusalText.test.tsx web/tests/decisionsStatusFilter.test.tsx` and:

```
feat(web): explain every refusal in English and Chinese

English showed the server's machine text (control-plan-rejected:task-control-metadata:a).
enErrors now covers the same codes as zhErrors, entries say what happened and what to do,
and {{detail}} (the message after <code>:) keeps the code from being repeated beside
itself. The coverage criterion checks both languages, the reasons a blocked run shows,
and the new placeholder.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

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

### Task A5: Refusal state per group, per import, per panel; cleared by the next success

**Files:**
- Modify `web/src/controlState.ts`: `ControlClientState` (lines 30-43), `ControlClientEvent` (lines 45-49), `initialControlState` (lines 51-56), the reducer's `refusal` case (lines 152-160).
- Modify `web/src/App.tsx`: every `dispatchControl({ type: "refusal", … })` (lines 320, 329, 338, 356, 360, 381, 395, 438, 505, 506, 514, 515, 525, 526, 717), the success path after line 385, the `controlAlert` input (line 877), the `ControlPanel` props (line 962), the comment at line 269.
- Modify `web/src/ControlPanel.tsx`: props (lines 32-91) only — rendering is A6.
- Modify (rewrite, approved) `web/tests/controlState.test.ts`: "clears the conflicted group cache on a revision conflict without touching drafts" (lines 136-148); add three tests.

**Interfaces:**
- Produces in `web/src/controlState.ts`:
  - `export type RefusalPlace = "group" | "import" | "panel";`
  - state fields `refusals: Record<string, ControlRefusal>`, `importRefusal: ControlRefusal | null`, `panelRefusal: ControlRefusal | null` (the field `refusal` is removed);
  - events `{ type: "refusal"; place: "group"; groupId: string; value: ControlRefusal }`,
    `{ type: "refusal"; place: "import" | "panel"; groupId: string | null; value: ControlRefusal }`,
    `{ type: "command-succeeded"; place: "group" | "import"; groupId: string }`.
- Produces in `ControlPanelProps`: `groupRefusals?: Record<string, ControlRefusal>`, `importRefusal?: ControlRefusal | null`; `refusal` now means the panel refusal (name kept so the existing criteria that pass it keep compiling).

- [ ] **Step 1: Write the failing tests** — in `web/tests/controlState.test.ts` add `ControlRefusal` to the type import from `../src/controlState.js`. Replace lines 136-148:

```ts
  it("clears the conflicted group cache on a revision conflict without touching drafts", () => {
    const populated = populatedState();
    const next = reduceControlState(populated, {
      type: "refusal",
      groupId: "g",
      value: { status: 409, code: "revision-conflict", message: "expectedRevision is stale", commandRevision: 8 },
    });
    expect(next.canonical).toEqual({});
    expect(next.refetchRequired).toBe(true);
    expect(next.drafts).toEqual(populated.drafts);
    expect(next.refusal?.code).toBe("revision-conflict");
    expect(next.refusal?.commandRevision).toBe(8);
  });
```

  with (spec §2.2(d): one refusal per group, not one global; rewrite approved per §2.3):

```ts
  // Rewritten for spec 2026-10-08 §2.2(d) (human-approved): the refusal is kept under its group, not in one global slot.
  it("clears the conflicted group cache on a revision conflict without touching drafts", () => {
    const populated = populatedState();
    const next = reduceControlState(populated, {
      type: "refusal",
      place: "group",
      groupId: "g",
      value: { status: 409, code: "revision-conflict", message: "expectedRevision is stale", commandRevision: 8 },
    });
    expect(next.canonical).toEqual({});
    expect(next.refetchRequired).toBe(true);
    expect(next.drafts).toEqual(populated.drafts);
    expect(next.refusals.g?.code).toBe("revision-conflict");
    expect(next.refusals.g?.commandRevision).toBe(8);
    expect(next.panelRefusal).toBeNull();
  });

  // Spec 2026-10-08 §2.2(d): a refusal is shown where the person acted, until the next success there.
  const refused = (code: string): ControlRefusal => ({ status: 409, code, message: code, commandRevision: 6 });

  it("keeps one refusal per group, and a success for one group clears only that group's", () => {
    let state = reduceControlState(initialControlState(), { type: "refusal", place: "group", groupId: "g1", value: refused("stop-mode-conflict") });
    state = reduceControlState(state, { type: "refusal", place: "group", groupId: "g2", value: refused("group-state-invalid") });
    expect(state.refusals).toEqual({ g1: refused("stop-mode-conflict"), g2: refused("group-state-invalid") });
    state = reduceControlState(state, { type: "command-succeeded", place: "group", groupId: "g2" });
    expect(state.refusals).toEqual({ g1: refused("stop-mode-conflict") });
    state = reduceControlState(state, { type: "command-succeeded", place: "group", groupId: "g1" });
    expect(state.refusals).toEqual({});
  });

  it("keeps an import refusal apart from every group, cleared only by a successful import", () => {
    let state = reduceControlState(initialControlState(), { type: "refusal", place: "import", groupId: "group-c1", value: refused("control-plan-rejected") });
    state = reduceControlState(state, { type: "command-succeeded", place: "group", groupId: "group-c1" });
    expect(state.importRefusal).toEqual(refused("control-plan-rejected"));
    expect(state.refusals).toEqual({});
    state = reduceControlState(state, { type: "command-succeeded", place: "import", groupId: "group-c2" });
    expect(state.importRefusal).toBeNull();
  });

  it("keeps a refusal of no group and no import on the panel, untouched by any success", () => {
    let state = reduceControlState(initialControlState(), { type: "refusal", place: "panel", groupId: null, value: refused("http-503") });
    state = reduceControlState(state, { type: "command-succeeded", place: "group", groupId: "g" });
    state = reduceControlState(state, { type: "command-succeeded", place: "import", groupId: "group-c1" });
    expect(state.panelRefusal).toEqual(refused("http-503"));
    expect(state.refusals).toEqual({});
    expect(state.importRefusal).toBeNull();
  });
```

- [ ] **Step 2: Run it, expect FAIL** — `cd web && ../node_modules/.bin/vitest run tests/controlState.test.ts > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1: the four tests fail (`refusals` undefined, `command-succeeded` unknown).

- [ ] **Step 3: Implement.**

  (a) `web/src/controlState.ts`. In `ControlClientState`, replace `  refusal: ControlRefusal | null;` with:

```ts
  /** Spec 2026-10-08 §2.2(d): each group's last refusal, shown at the top of its view until a later success of that group. */
  refusals: Record<string, ControlRefusal>;
  /** The last import's refusal, shown in the import form until an import succeeds. */
  importRefusal: ControlRefusal | null;
  /** A refusal that belongs to no group and no import (a poll, the agents table, a repository's settings): the panel's own line. */
  panelRefusal: ControlRefusal | null;
```

  Add above `export interface ControlClientState`:

```ts
/** Where a refusal is shown (spec 2026-10-08 §2.2(d)). */
export type RefusalPlace = "group" | "import" | "panel";
```

  Replace the event line `  | { type: "refusal"; groupId: string | null; value: ControlRefusal };` with:

```ts
  // groupId on a panel refusal is the scope a revision conflict voids (e.g. @repository:<id>), never where it is shown.
  | { type: "refusal"; place: "group"; groupId: string; value: ControlRefusal }
  | { type: "refusal"; place: "import" | "panel"; groupId: string | null; value: ControlRefusal }
  | { type: "command-succeeded"; place: "group" | "import"; groupId: string };
```

  In `initialControlState`, replace `uncertainCommandIds: [], refusal: null,` with `uncertainCommandIds: [], refusals: {}, importRefusal: null, panelRefusal: null,`.

  Replace the reducer's `case "refusal": { … }` (lines 152-160) with:

```ts
    case "refusal": {
      const next: ControlClientState = event.place === "group"
        ? { ...state, refusals: { ...state.refusals, [event.groupId]: event.value } }
        : event.place === "import" ? { ...state, importRefusal: event.value } : { ...state, panelRefusal: event.value };
      // Another tab committed first: the cached revision is the server's older self, so
      // the only safe move is to drop it and re-read before offering the command again.
      if (event.value.code !== "revision-conflict" || event.groupId === null) return next;
      const canonical = { ...next.canonical };
      delete canonical[event.groupId];
      return { ...next, canonical, refetchRequired: true };
    }
    case "command-succeeded": {
      if (event.place === "import") return { ...state, importRefusal: null };
      if (!Object.prototype.hasOwnProperty.call(state.refusals, event.groupId)) return state;
      const refusals = { ...state.refusals };
      delete refusals[event.groupId];
      return { ...state, refusals };
    }
```

  (b) `web/src/App.tsx` — each dispatch gains a `place` (the person acted in a group view → `group`; in the import form → `import`; nothing the person pressed in a group → `panel`):

| Line | Site | New event |
|---|---|---|
| 320 | `readControlTick` catch | `{ type: "refusal", place: "panel", groupId: null, value: controlFailureFrom(err) }` |
| 329 | `readControlGroup` catch | `{ type: "refusal", place: "group", groupId, value: controlFailureFrom(err) }` |
| 338 | `readRequirement` catch (a clarifying group has no group view; Requirements has its own line) | `{ type: "refusal", place: "panel", groupId, value: controlFailureFrom(err) }` |
| 356 | `resolveUncertain`, lookup did not conclude (the panel did not answer; the command is still listed as unknown on the panel line) | `{ type: "refusal", place: "panel", groupId: command.groupId, value: result.refusal }` |
| 360 | `resolveUncertain`, `absent` (the command never reached the ledger: its outcome) | `{ type: "refusal", place: "group", groupId: command.groupId, value: result.refusal }` |
| 381 | `sendControl`, uncertain answer | `{ type: "refusal", place, groupId: action.groupId, value: answer.refusal }` |
| 395 | `sendControl`, refusal answer | `{ type: "refusal", place, groupId: action.groupId, value: refusal }` |
| 438 | `loadAgents` catch | `{ type: "refusal", place: "panel", groupId: null, value: refusal }` |
| 505, 506, 514, 515, 525, 526 | workspace mode / integration scheme / agent preferences (`scope` = `@repository:…` / `@operator:…`) | `{ type: "refusal", place: "panel", groupId: scope, value: … }` (value unchanged) |
| 717 | agent preview read failure (the open group's) | `{ type: "refusal", place: "group", groupId, value: controlFailureFrom(err) }` |

  In `sendControl`, after line 373 (`const command = { groupId: action.groupId, commandId };`) add:

```ts
    // Spec 2026-10-08 §2.2(d): an import's refusal is shown in the import form, every other command's in its group.
    const place = action.verb === "import-plan" ? ("import" as const) : ("group" as const);
```

  and after line 385 (`dispatchControl({ type: "command-resolved", value: command });`) add:

```ts
    // A success clears the refusal shown where the person acted; another group's stays (spec 2026-10-08 §2.2(d)).
    if (answer.status < 400) dispatchControl({ type: "command-succeeded", place, groupId: action.groupId });
```

  Line 877 `refusal: control.refusal !== null,` becomes:

```ts
                refusal: control.panelRefusal !== null || control.importRefusal !== null || Object.keys(control.refusals).length > 0,
```

  Line 962 `refusal={control.refusal}` becomes three lines:

```tsx
          refusal={control.panelRefusal}
          groupRefusals={control.refusals}
          importRefusal={control.importRefusal}
```

  Line 269's comment `/** The last refusal of a command sent from Requirements, shown there (Task control keeps showing every refusal). */` becomes `/** The last refusal of a command sent from Requirements, shown there (Task control shows a group's at the top of its view). */`.

  (c) `web/src/ControlPanel.tsx` props: replace line 40 `  refusal: ControlRefusal | null;` with:

```ts
  /** Spec 2026-10-08 §2.2(d): a refusal that belongs to no group and no import, on the panel's own line. */
  refusal: ControlRefusal | null;
  /** Each group's last refusal, shown at the top of that group's view. */
  groupRefusals?: Record<string, ControlRefusal>;
  /** The last import's refusal, shown inside the import form. */
  importRefusal?: ControlRefusal | null;
```

- [ ] **Step 4: Run, expect PASS** — `cd web && ../node_modules/.bin/vitest run tests/controlState.test.ts tests/shell.test.tsx tests/controlCommandRecovery.test.tsx > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0; web tsc ⇒ rc=0 (every `type: "refusal"` site now names a place; a missed one is a compile error).

- [ ] **Step 5: Mutation** — in `$M`:
  1. In the `command-succeeded` case, clear every group (`return { ...state, refusals: {} }` for the group place) ⇒ "keeps one refusal per group, and a success for one group clears only that group's" red.
  2. Make `place === "import"` store under `refusals` ⇒ "keeps an import refusal apart from every group…" red.

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add web/src/controlState.ts web/src/App.tsx web/src/ControlPanel.tsx web/tests/controlState.test.ts` and:

```
feat(web): keep a refusal per group, per import and per panel

The control state kept one global refusal that nothing cleared. A command's refusal is
now kept under its group (an import's in its own slot, anything else on the panel), and
a later successful command of the same group clears it without touching another group's.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

### Task A6: Show a refusal where the person acted

**Files:**
- Create `web/src/RefusalNotice.tsx`.
- Modify `web/src/ControlGroupView.tsx`: imports (lines 10-29), props interface (lines 45-72), after the claim-blocked line (line 105).
- Modify `web/src/ControlPanel.tsx`: imports (lines 11-30), `ImportFormProps` (lines 93-100), `ImportForm` after `<h3>` (line 123), the `ImportForm` element (lines 241-244), the `ControlGroupView` element (after line 286).
- Modify `web/src/styles.css`: one rule after line 67 (`code, .row-id, .row-at { … }`).
- Test (create) `web/tests/groupRefusal.test.tsx`.

**Interfaces:**
- Consumes: A4's `explainRefusal`; A5's props and App wiring.
- Produces: `export function RefusalNotice(props: { refusal: ControlRefusal; testId: string }): JSX.Element` — `role="alert"`, the explanation, the decoded list (`<ul>`, only when there are items), and the raw code in `<code class="refusal-code">`. Test ids `group-refusal`, `import-refusal`. `ControlGroupViewProps.refusal?: ControlRefusal | null`.

- [ ] **Step 1: Write the failing test** — create `web/tests/groupRefusal.test.tsx`:

```tsx
// @vitest-environment jsdom
/**
 * Spec 2026-10-08 §2.2(d), §2.3: a refusal is shown where the person acted. A group command's refusal is at the top of
 * that group's view, above its actions; it stays while another group is used and goes with the next successful command
 * of the same group. An import's refusal is inside the import form, the plan's problems one per line, in English and
 * Chinese. The panel's own line is not used for either. Fake fetch only (Rule 17).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import i18n from "../src/i18n.js";
import { enErrors } from "../src/locales/en.js";
import { ALPHA, groupSummary, installFakePanel, planGroupView } from "./fixtures/twoProjects.js";
import type { FakePanel } from "./fixtures/twoProjects.js";

let panel: FakePanel;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refused = (status: number, code: string, message: string): Response =>
  json({ error: { code, message, commandRevision: 6, evidenceIds: [], retryable: false } }, status);
const success = (): Response => json({ schema: "orca-command-success-v1", commandRevision: 7 });

beforeEach(() => {
  panel = installFakePanel();
  const g1 = groupSummary("g1", ALPHA), g2 = groupSummary("g2", ALPHA);
  panel.summary = { ...panel.summary, groups: [g1, g2] };
  panel.groupViews = { g1: planGroupView(g1), g2: planGroupView(g2) };
});
afterEach(() => { cleanup(); window.sessionStorage.clear(); window.localStorage.clear(); vi.restoreAllMocks(); });

/** Open a group from Task control's list and answer its view's region once it is the one shown. */
async function openGroup(groupId: string): Promise<HTMLElement> {
  const nav = await screen.findByRole("navigation", { name: "Control groups" });
  fireEvent.click(await within(nav).findByRole("button", { name: new RegExp(`^${groupId} · `) }));
  return await screen.findByRole("region", { name: `Control group ${groupId}` });
}
const groupReads = (groupId: string): number => panel.requests.filter((request) => request === `GET /api/control/groups/${groupId}`).length;

describe("a group's refusal stays with its group (spec §2.2(d))", () => {
  it("is shown at the top of its group's view, kept through another group's success, and cleared by its own group's next success", async () => {
    let refuseG1 = true;
    panel.onPost = async (url) => {
      if (url === "/api/control/groups/g1/pause-dispatch" && refuseG1) {
        refuseG1 = false;
        return refused(409, "stop-mode-conflict", "stop-mode-conflict:pause");
      }
      return success();
    };
    render(<App />);
    let g1 = await openGroup("g1");
    fireEvent.click(within(g1).getByRole("button", { name: "Pause dispatch" }));
    const notice = await within(g1).findByTestId("group-refusal");
    expect(notice.textContent).toContain(enErrors["stop-mode-conflict"]);
    expect(within(notice).getByText("stop-mode-conflict").tagName).toBe("CODE");
    // At the top: before the actions and before the budget editor.
    const pause = within(g1).getByRole("button", { name: "Pause dispatch" });
    expect(notice.compareDocumentPosition(pause) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.compareDocumentPosition(within(g1).getByRole("region", { name: "Budget proposal" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Only there: the code is on screen once (not also on the panel's own line).
    expect(screen.getAllByText(/stop-mode-conflict/)).toHaveLength(1);

    const g2 = await openGroup("g2");
    expect(within(g2).queryByTestId("group-refusal")).toBeNull();
    const before = groupReads("g2");
    fireEvent.click(within(g2).getByRole("button", { name: "Pause dispatch" }));
    // The success is recorded before the group is read again, so this read means g2's success was handled.
    await waitFor(() => expect(groupReads("g2")).toBeGreaterThan(before));

    g1 = await openGroup("g1");
    expect(within(g1).getByTestId("group-refusal").textContent).toContain(enErrors["stop-mode-conflict"]);
    fireEvent.click(within(g1).getByRole("button", { name: "Pause dispatch" }));
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Control group g1" })).queryByTestId("group-refusal")).toBeNull());
  });
});

describe("an import's refusal stays in the import form (spec §2.2(d))", () => {
  it("lists the plan's problems one per line, in English and in Chinese", async () => {
    panel.onPost = async (url) => (url === "/api/control/groups/import-plan"
      ? refused(422, "control-plan-rejected", "control-plan-rejected:missing-target-version:a\ndangling-dependency:b")
      : success());
    render(<App />);
    const form = await screen.findByRole("region", { name: "Import plan" });
    fireEvent.click(await within(form).findByRole("button", { name: "Import plan" }));
    const notice = await within(form).findByTestId("import-refusal");
    expect(within(notice).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Task a has no targetVersion. Add a positive integer, usually 1.",
      "Task b depends on a task that is not in the plan.",
    ]);
    expect(within(notice).getByText("control-plan-rejected").tagName).toBe("CODE");
    expect(screen.getAllByText(/control-plan-rejected/)).toHaveLength(1);
    await act(async () => { await i18n.changeLanguage("zh"); });
    expect(within(screen.getByTestId("import-refusal")).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "任务 a 没有 targetVersion。请填一个正整数，通常是 1。",
      "任务 b 依赖了一个计划里没有的任务。",
    ]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** — `cd web && ../node_modules/.bin/vitest run tests/groupRefusal.test.tsx > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1: `findByTestId("group-refusal")` and `findByTestId("import-refusal")` time out (nothing renders them; the refusals reach only the state since A5).

- [ ] **Step 3: Implement.**

  (a) Create `web/src/RefusalNotice.tsx`:

```tsx
/**
 * Spec 2026-10-08 §2.2(d): a refusal where the person acted -- what happened and what to do, a refused plan's problems one
 * per line, and the server's code as sent (small, monospace) so the explanation can always be checked against it.
 */
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import type { ControlRefusal } from "./controlState.js";
import { explainRefusal } from "./refusalExplain.js";

export function RefusalNotice({ refusal, testId }: { refusal: ControlRefusal; testId: string }): JSX.Element {
  useTranslation(); // re-render when the language changes: explainRefusal reads it
  const { text, items } = explainRefusal(refusal);
  return (
    <div className="refusal" role="alert" data-testid={testId} data-status={refusal.status ?? ""}>
      <p>{text}</p>
      {items.length > 0 && (
        <ul>
          {items.map((item, index) => <li key={index}>{item}</li>)}
        </ul>
      )}
      <p><code className="refusal-code">{refusal.code}</code></p>
    </div>
  );
}
```

  (b) `web/src/ControlGroupView.tsx`: add imports `import type { ControlRefusal, UncertainCommand } from "./controlState.js";` (replacing line 25's `import type { UncertainCommand } from "./controlState.js";`) and `import { RefusalNotice } from "./RefusalNotice.js";` after the `GroupIntegrationConfirm` import. In `ControlGroupViewProps`, before the closing `}` (line 72) add:

```ts
  /** Spec 2026-10-08 §2.2(d): this group's last refusal, shown at the top until a later success of this group. */
  refusal?: ControlRefusal | null;
```

  After line 105 (`{view.summary.claimBlocked && <p role="alert">{t("control.group.claimBlocked")}</p>}`) add:

```tsx
      {/* Spec 2026-10-08 §2.2(d), §6.5: the group's refusal is among the alerts at the top, above every action. */}
      {props.refusal ? <RefusalNotice refusal={props.refusal} testId="group-refusal" /> : null}
```

  (c) `web/src/ControlPanel.tsx`: add `import { RefusalNotice } from "./RefusalNotice.js";` after the `RecoveryView` import. In `ImportFormProps` add before its closing `}`:

```ts
  /** Spec 2026-10-08 §2.2(d): the last import's refusal, with the refused plan's problems one per line. */
  refusal?: ControlRefusal | null;
```

  After line 123 (`<h3>{t("control.import.title")}</h3>`) add:

```tsx
      {props.refusal ? <RefusalNotice refusal={props.refusal} testId="import-refusal" /> : null}
```

  In the `<ImportForm … />` element (lines 241-244) add the attribute `refusal={props.importRefusal ?? null}`. In the `<ControlGroupView … />` element, after `integrationFor={props.integrationFor}` (line 286) add `refusal={props.groupRefusals?.[view.summary.groupId] ?? null}`.

  (d) `web/src/styles.css`, after line 67:

```css
.refusal-code { font-size: 0.85em; }
```

- [ ] **Step 4: Run, expect PASS** — `cd web && ../node_modules/.bin/vitest run tests/groupRefusal.test.tsx tests/controlPanel.test.tsx tests/refusalText.test.tsx tests/i18nPseudo.test.tsx > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=0; web tsc ⇒ rc=0; root `./node_modules/.bin/vitest run tests/panel/scanPanelText.test.ts > $S/out2.txt 2>&1; echo rc=$?` ⇒ rc=0; then the whole web suite `npm run --workspace web check > $S/web.txt 2>&1; echo rc=$?` ⇒ rc=0. A red outside the approved rewrites is reported by name, not rewritten (Rule 12).

- [ ] **Step 5: Mutation** — in `$M`:
  1. Delete the `RefusalNotice` line in `ControlGroupView.tsx` ⇒ `groupRefusal.test.tsx` "is shown at the top of its group's view…" red.
  2. In `App.tsx`, delete the `command-succeeded` dispatch ⇒ the same test red at its last `waitFor`.
  3. In `App.tsx`, make `place` always `"group"` ⇒ "lists the plan's problems one per line…" red (no `import-refusal`).
  4. Move the `RefusalNotice` line in `ControlGroupView.tsx` to just before the closing `</section>` ⇒ "is shown at the top…" red at the `compareDocumentPosition` assertion.

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add web/src/RefusalNotice.tsx web/src/ControlGroupView.tsx web/src/ControlPanel.tsx web/src/styles.css web/tests/groupRefusal.test.tsx` and:

```
feat(web): show a refusal at the top of its group and inside the import form

A refused command used to appear as one line at the bottom of Task control, far from
the button. The group view now shows its group's refusal among the alerts at the top,
explained, with the raw code; the import form shows an import's refusal with the plan's
problems one per line. The panel's own line keeps only refusals of no group or import.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```

---

### Task A7: Document what Web import requires

**Files:**
- Modify `README.md`: §5 lines 168-169 (the sentence before the example) and the example task (lines 183-185).
- Modify `docs/cli.md`: insert a section after "### The up-front rejections" ends (before `### Exit codes`, line 111).

**Interfaces:** none (documentation). Success criterion: the README example is a plan Web import accepts — A1's
`tests/scheduler/planSourceItems.test.ts` "still imports a plan with no problem" covers the same shape; Step 4 below
runs the README's own JSON through `schedulerControlPlanSourceOf`.

- [ ] **Step 1: Write the failing check** — a throwaway script in the executor's scratchpad (not committed), `$S/readme-plan.mjs`:

```js
// Extracts README §5's JSON example and runs it through the Web import's checks with its own targetRepo.
import { readFileSync } from "node:fs";
const readme = readFileSync("/Users/biran/code/skills/loop/Orca-issues/README.md", "utf8");
const section = readme.slice(readme.indexOf("### 5. Plans for Task control"), readme.indexOf("### 6. Optional integrations"));
const json = section.slice(section.indexOf("```json") + 7, section.indexOf("```", section.indexOf("```json") + 7));
const plan = JSON.parse(json.replaceAll("<path-to-repo>", "/abs/repo").replaceAll("<path-to-orca>", "/abs/orca").replaceAll("<a directory outside the repo>", "/abs/runs"));
const { schedulerControlPlanSourceOf } = await import("/Users/biran/code/skills/loop/Orca-issues/src/scheduler/planFile.ts");
try { schedulerControlPlanSourceOf(plan, "/abs/repo"); console.log("accepted"); } catch (error) { console.log(String(error)); process.exit(1); }
```

- [ ] **Step 2: Run it, expect FAIL** — `cd /Users/biran/code/skills/loop/Orca-issues && ./node_modules/.bin/tsx $S/readme-plan.mjs > $S/out.txt 2>&1; echo rc=$?` ⇒ rc=1, output `ControlError: control-plan-rejected:missing-target-version:a`.

- [ ] **Step 3: Implement.**

  (a) `README.md` lines 168-169:

```md
The plan file uses the schema described in [docs/cli.md](docs/cli.md#the-plan-files-shape), plus a top-level `goal`
and `successConditions`. A task may give a `loop` block instead of a `contract` file:
```

  become:

```md
The plan file uses the schema described in [docs/cli.md](docs/cli.md#the-plan-files-shape). **Import plan** accepts it
only when all of these hold; otherwise it refuses with every problem it can see, one per line, in the import form:

- `targetRepo` is the repository the plan is registered for;
- the plan has a `goal`;
- the plan has at least one `successConditions` entry, and no two are identical;
- every task has a `targetVersion` that is a positive integer (write `1` unless you mean otherwise);
- no task lists a dependency twice or depends on a task that is not in the plan;
- every task's `contract` file is valid JSON in ccloop's contract format, or its `loop` block is valid.

A task may give a `loop` block instead of a `contract` file:
```

  and in the example, lines 183-185:

```json
    {
      "taskId": "a",
      "dependsOn": [],
```

  become:

```json
    {
      "taskId": "a",
      "dependsOn": [],
      "targetVersion": 1,
```

  (b) `docs/cli.md`, insert before `### Exit codes` (line 111):

```md
### What Web import also requires

The panel's **Import plan** (Task control) reads the same file and adds its own checks. It accepts a plan only when:

- `targetRepo` is the repository the plan is registered for (`--plan <planId>=<repoId>=<path>`);
- the plan has a `goal`;
- the plan has at least one `successConditions` entry, and no two are identical;
- every task has a `targetVersion` that is a positive integer (write `1` unless you mean otherwise);
- no task lists a dependency twice or depends on a task that is not in the plan;
- every task's `contract` file is valid JSON in ccloop's contract format (or its `loop` block is valid).

A plan that fails is refused with `control-plan-rejected`, listing every problem it can see at once, one per line:
`target-repo-mismatch`, `missing-goal`, `missing-success-conditions`, `duplicate-success-condition`, then per task
`duplicate-dependency:<task>`, `dangling-dependency:<task>`, `missing-target-version:<task>` and the task's contract
problem (`contract-json:<task>`, `contract-shape:<task>`, `contract-canonical:<task>`, `loop-plan-invalid:<task>:<reason>`).
A file that does not match the schema at all is refused with its `malformed:<path>: <message>` lines alone. The panel
explains each line in English or Chinese.
```

- [ ] **Step 4: Run, expect PASS** — the Step 2 command ⇒ rc=0, output `accepted`. Read `git -C /Users/biran/code/skills/loop/Orca-issues diff -- README.md docs/cli.md > $S/diff.txt` whole.

- [ ] **Step 5: Mutation** — in `$M`, delete the README's `"targetVersion": 1,` line and run the script against `$M/README.md` (edit the script's path) ⇒ rc=1 with `missing-target-version:a`.

- [ ] **Step 6: Commit** — `git -C /Users/biran/code/skills/loop/Orca-issues add README.md docs/cli.md` and:

```
docs: list what Web import requires, and give the README example its targetVersion

README §5's example plan had no targetVersion, so Web import refused it. README and
docs/cli.md now list every Web-import requirement in one place and the refusal's items.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
```
