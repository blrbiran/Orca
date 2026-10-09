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

