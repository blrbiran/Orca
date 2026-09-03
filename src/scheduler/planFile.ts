import { isAbsolute, relative } from "node:path";
import { z } from "zod";

export interface PlanTask {
  taskId: string;
  contract: string;
  dependsOn: string[];
}

export interface PlanFile {
  targetRepo: string;
  ccloopBin: string;
  runsDir: string;
  workBranch: string;
  policy: "local-merge";
  ledgerMode: "in-repo" | "out-of-repo";
  tasks: PlanTask[];
}

export type PlanRejection = { code: string; message: string };

const planTaskSchema = z
  .object({
    taskId: z.string().min(1),
    contract: z.string().min(1),
    dependsOn: z.array(z.string()),
  })
  .strict();

// Shape-only: policy and workBranch are checked for the well-formed literal
// values a valid plan could have, but the *content* checks (unsupported
// policy, workBranch == default) are spec-level rejections below, not schema
// failures — a caller should see "unsupported-policy", not a zod message.
const planFileSchema = z
  .object({
    targetRepo: z.string().min(1),
    ccloopBin: z.string().min(1),
    runsDir: z.string().min(1),
    workBranch: z.string().min(1),
    policy: z.string().min(1),
    ledgerMode: z.enum(["in-repo", "out-of-repo"]),
    tasks: z.array(planTaskSchema),
  })
  .strict();

/**
 * Standalone DFS, deliberately not shared with anything else yet.
 * Ruling R2 (SDD ledger, Task 2): Task 4 will export detectCycle(tasks) for
 * the graph layer, and this function is expected to converge with it — at
 * that point this body is replaced by a call to the shared one. Written
 * small and self-contained now so that replacement is a one-line change
 * rather than surgery.
 */
function planHasCycle(tasks: PlanTask[]): boolean {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const state = new Map<string, number>();

  function visit(id: string): boolean {
    const status = state.get(id) ?? WHITE;
    if (status === GRAY) return true;
    if (status === BLACK) return false;
    state.set(id, GRAY);
    const task = byId.get(id);
    if (task) {
      for (const dep of task.dependsOn) {
        if (visit(dep)) return true;
      }
    }
    state.set(id, BLACK);
    return false;
  }

  for (const task of tasks) {
    if (visit(task.taskId)) return true;
  }
  return false;
}

/**
 * A path counts as "inside" targetRepo only when it does not escape via
 * "..". node:path.relative is used rather than startsWith, which would
 * wrongly match a sibling directory that merely shares targetRepo as a
 * string prefix (e.g. targetRepo "/abs/repo" and contract "/abs/repo-2/x").
 */
function isInsideRepo(targetRepo: string, contract: string): boolean {
  const rel = relative(targetRepo, contract);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * The six up-front rejections from spec §2.3, all reported at once rather
 * than short-circuiting on the first — a caller who fixes one problem and
 * re-runs six times is a caller this function is wasting. This layer is pure:
 * no filesystem, no git. defaultBranch is passed in because discovering it
 * belongs to the CLI, against the target repo, not to this module.
 */
export function loadPlan(raw: unknown, defaultBranch: string): { plan: PlanFile } | { rejections: PlanRejection[] } {
  const parsed = planFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      rejections: parsed.error.issues.map((issue) => ({
        code: "malformed",
        message: `${issue.path.join(".") || "<root>"}: ${issue.message}`,
      })),
    };
  }
  const data = parsed.data;
  const rejections: PlanRejection[] = [];

  // 1. relative-path — every path field must be absolute. A relative path
  // resolves against whatever CWD the orchestrator happens to be in.
  const pathFields: Array<[string, string]> = [
    ["targetRepo", data.targetRepo],
    ["ccloopBin", data.ccloopBin],
    ["runsDir", data.runsDir],
  ];
  for (const task of data.tasks) {
    pathFields.push([`tasks[${task.taskId}].contract`, task.contract]);
  }
  for (const [field, value] of pathFields) {
    if (!isAbsolute(value)) {
      rejections.push({ code: "relative-path", message: `${field} must be an absolute path, got ${JSON.stringify(value)}` });
    }
  }

  // 2. duplicate-task-id — taskId is the join key everywhere downstream;
  // a duplicate would make dependsOn ambiguous.
  const seen = new Set<string>();
  for (const task of data.tasks) {
    if (seen.has(task.taskId)) {
      rejections.push({ code: "duplicate-task-id", message: `duplicate taskId: ${task.taskId}` });
    }
    seen.add(task.taskId);
  }

  // 3. cycle — a task graph with a cycle has no valid execution order.
  if (planHasCycle(data.tasks)) {
    rejections.push({ code: "cycle", message: "the task graph has a cycle" });
  }

  // 4. contract-inside-target-repo — the premise that lets the write set be
  // computed once, at graph construction time: a contract inside the repo
  // could be rewritten by an upstream task (spec §2.4.1).
  for (const task of data.tasks) {
    if (isInsideRepo(data.targetRepo, task.contract)) {
      rejections.push({
        code: "contract-inside-target-repo",
        message: `contract for ${task.taskId} lives inside targetRepo: ${task.contract}`,
      });
    }
  }

  // 5. work-branch-is-default — merging into the default branch is tier 0,
  // mechanically forbidden rather than a matter of policy.
  if (data.workBranch === defaultBranch) {
    rejections.push({ code: "work-branch-is-default", message: `workBranch must not equal the default branch (${defaultBranch})` });
  }

  // 6. unsupported-policy — rebase / pull-request are configuration this
  // version recognises and does not implement. Silently downgrading to a
  // local merge is the failure mode this rejects instead of hiding.
  if (data.policy !== "local-merge") {
    rejections.push({ code: "unsupported-policy", message: `unsupported policy: ${JSON.stringify(data.policy)}` });
  }

  if (rejections.length > 0) {
    return { rejections };
  }

  return { plan: { ...data, policy: "local-merge" } };
}
