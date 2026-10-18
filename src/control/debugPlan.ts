import type { z } from "zod";
import { taskContractSchema, type SchedulerControlPlanSource } from "../scheduler/planFile.js";
import type { PartialSelection } from "./agentSelection.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { DEBUG_DIFF_INLINE_MAX_BYTES, debugDiffCommand, debugRunIdOf, type DebugInputV1 } from "./debugInput.js";
import { TASK_WORK } from "./estimator.js";
import { correctionTargetOf } from "../corrections/target.js";

type TaskContract = z.infer<typeof taskContractSchema>;

/**
 * Debug-task design §4.1, §4.3 / plan Task 4: the debug group's one-task plan, built from the frozen input alone. No
 * model call and no I/O (Rule 5): the same input gives the same plan bytes.
 */
export const DEBUG_TASK_ID = "debug";
/** Design §9a: the test directories added to the write set, those of them that exist at the repository root. */
export const DEBUG_TEST_DIRS = ["test", "tests", "__tests__", "spec"] as const;
/** Design §4.3, §12.8: the requirement Orca's own check enforces after the attempt; the plan's first success condition. */
export const DEBUG_REPRODUCTION_CONDITION = "the reproduction test added by the debug task fails at the run's base and passes at its attempt";

/**
 * Used only when the original contract is missing (§12.7). Every value is an existing default, none invented:
 * maxAttempts, totalRuntimeBudgetMs and tokenBudget are TASK_WORK's (src/control/estimator.ts:16);
 * perAttemptTimeoutMs is the current loop plans' phase timeout (src/control/loopPlans.ts:56, V2_DEFAULTS, also v3's);
 * partialOutcomeRecoveryWindowMs is the loop plans' (src/control/loopPlans.ts:113, EXECUTION_POLICY);
 * autonomyLevel and worktreeRequired are the only values the contract schema admits (src/scheduler/planFile.ts:208-210).
 */
export const DEBUG_DEFAULT_EXECUTION_POLICY: TaskContract["executionPolicy"] = Object.freeze({
  autonomyLevel: "L2", maxAttempts: TASK_WORK.attempts, perAttemptTimeoutMs: 10_800_000,
  totalRuntimeBudgetMs: TASK_WORK.activeMs, tokenBudget: TASK_WORK.tokens, worktreeRequired: true,
  partialOutcomeRecoveryWindowMs: 60_000,
});
/** No contract: the plan's own placeholders (plan Task 4 Step 3); the human edits the write set before confirming. */
export const DEBUG_DEFAULT_TARGET_PATHS = ["."] as const;
export const DEBUG_DEFAULT_BUILD_TEST_COMMANDS = ["<to be named by the agent as reproCommand>"] as const;
/** No contract: no file cap, as the current loop plans (src/control/loopPlans.ts:56, V2_DEFAULTS.defaultMaxFilesTouched). */
export const DEBUG_DEFAULT_MAX_FILES_TOUCHED = Number.MAX_SAFE_INTEGER;
/**
 * The debug contract's verifier, with or without an original: its checks are commands, and the reproduction is checked
 * by Orca (§12.8), not by a model. "command" and ["nonzero exit"] are what Orca's other generated contracts use
 * (src/scheduler/reconcile.ts:402-406, src/control/integrationResolve.ts:147).
 */
export const DEBUG_VERIFIER_TYPE = "command" as const;
export const DEBUG_REJECT_ON = ["nonzero exit"] as const;

export function debugPlanId(groupId: string): string {
  return `${groupId}-plan`;
}

const KIND_INSTRUCTION: Record<DebugInputV1["correction"]["kind"], (alternative: string | undefined) => string> = {
  wrong: () => "fix what is wrong",
  not_my_taste: (alternative) => `change to ${alternative}`,
  stale: () => "bring it up to date",
};

/** One sentence per missing piece (§4.2, §12.7): the agent is told what it was not given, and why. */
function missingSentence(piece: DebugInputV1["missing"][number], input: DebugInputV1): string {
  switch (piece) {
    case "run": return `The original run ${debugRunIdOf(correctionTargetOf(input.correction))} is not a control run Orca can read: its commits and contract are unavailable.`;
    case "base": return "The original run recorded no base commit: its diff is unavailable.";
    case "attemptSha": return "The original run recorded no attempt commit: its diff is unavailable.";
    case "objects": return "The original run's commits are no longer in the repository: its diff is unavailable.";
    case "contract": return "The original task's contract could not be read: this task's write set, checks and budgets are Orca's defaults.";
  }
}

/** The longest prefix of `text` that fits in `maxBytes` of UTF-8 and ends on a character boundary. */
function utf8Prefix(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let end = maxBytes;
  // A continuation byte (10xxxxxx) at the cut means the character straddles it: cut before its lead byte.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

function diffSection(commits: NonNullable<DebugInputV1["commits"]>): string[] {
  const inlined = utf8Prefix(commits.diff, DEBUG_DIFF_INLINE_MAX_BYTES);
  const lines = [`The original run's diff (base ${commits.base}, attempt ${commits.attemptSha}, without .decisions/):`];
  if (inlined !== commits.diff) {
    lines.push(`It is ${Buffer.byteLength(commits.diff, "utf8")} bytes; the first ${Buffer.byteLength(inlined, "utf8")} are below. Read the whole of it with: ${debugDiffCommand(commits.base, commits.attemptSha)}`);
  }
  // A fence longer than any backtick run in the diff, so the diff cannot close it early.
  const fence = "`".repeat(Math.max(3, ...[...inlined.matchAll(/`+/g)].map((run) => run[0].length + 1)));
  lines.push(`${fence}diff`, inlined, fence);
  return lines;
}

/** Design §4.3: the decision, what was chosen, the human's reason and alternative, and the reproduce-first steps. */
export function debugGoalText(input: DebugInputV1): string {
  const { correction, decision, pending, originalRun, commits, contract } = input;
  const lines = [
    `Debug task for correction ${correction.id} (${correction.kind}, by ${correction.by} at ${correction.at}).`,
    `The human's reason: ${correction.because}`,
  ];
  if (correction.chose_instead !== undefined) lines.push(`The human's alternative: ${correction.chose_instead}`);
  lines.push(`Instruction: ${KIND_INSTRUCTION[correction.kind](correction.chose_instead)}.`, "");
  if (decision !== null) {
    lines.push(
      `The corrected decision ${decision.id} (read from the ${input.decisionWhere} ledger):`,
      `- question: ${decision.question}`,
      `- chose: ${decision.chose}`,
      ...decision.alternatives.map((alternative) => `- alternative: ${alternative.option} (not chosen: ${alternative.why_not})`),
      `- because: ${decision.because}`,
      `- undo: ${decision.undo.how}`,
      `- scope: ${decision.scope}`,
    );
  }
  if (pending !== null) {
    lines.push(
      `The corrected decision was pending: entry ${pending.pendingId} of run ${pending.ledgerRun}, refused at landing (${pending.reason}). The entry as the agent wrote it:`,
    );
    // Verbatim, so a question with quotes or backslashes reads as written (the JSON below escapes them).
    const entry = pending.entry;
    if (typeof entry === "object" && entry !== null && typeof (entry as { question?: unknown }).question === "string") {
      lines.push(`question: ${(entry as { question: string }).question}`);
    }
    lines.push(JSON.stringify(entry ?? null, null, 2));
  }
  lines.push(
    "",
    "Reproduce first:",
    "1. add a test that fails on the current code and expresses the correction;",
    "2. declare `reproTests` (the paths of the tests you added) and `reproCommand` (the command that runs them) in your result;",
    "3. then change the code until that test and the existing checks pass.",
    "Orca runs `reproCommand` with only your tests applied at the code you started from (it must fail) and at your attempt (it must pass).",
    "",
  );
  if (originalRun !== null) lines.push(`The original run: ${originalRun.runId} (group ${originalRun.groupId}, task ${originalRun.taskId}).`);
  if (contract !== null) {
    lines.push(`The original task's goal: ${contract.objective.goal}`);
    // Context only: the debug contract carries neither list (they could forbid the reproduction test itself).
    if (contract.objective.nonGoals.length > 0) lines.push(`The original task's non-goals (context; not binding on this task): ${contract.objective.nonGoals.join("; ")}`);
    if (contract.context.constraints.length > 0) lines.push(`The original task's constraints (context; not binding on this task): ${contract.context.constraints.join("; ")}`);
    // The denylist is inherited unchanged; the agent is told, so a refused test path is not a surprise.
    if (contract.safetyPolicy.denylistPaths.length > 0) lines.push(`Paths this task may not write (inherited from the original task): ${contract.safetyPolicy.denylistPaths.join(", ")}`);
  }
  lines.push(...input.missing.map((piece) => missingSentence(piece, input)));
  if (commits !== null) lines.push("", ...diffSection(commits));
  return lines.join("\n") + "\n";
}

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();
const unique = (values: readonly string[]): string[] => [...new Set(values)];

/** Design §4.3: the debug contract. Budgets and checks come from the original when there is one. */
function debugContract(input: DebugInputV1, opts: { repoPath: string; existingTestDirs: string[]; checks?: readonly string[] }): TaskContract {
  const original = input.contract;
  const targetPaths = sortedUnique([
    ...(original?.context.targetPaths ?? DEBUG_DEFAULT_TARGET_PATHS),
    ...(original?.safetyPolicy.allowlistPaths ?? []),
    ...opts.existingTestDirs.map((dir) => `${dir}/**`),
  ]);
  // Named checks (the open verb's `checks`) replace both the original's and the placeholder.
  const buildTestCommands = [...(opts.checks ?? original?.context.buildTestCommands ?? DEBUG_DEFAULT_BUILD_TEST_COMMANDS)];
  return taskContractSchema.parse({
    objective: { taskId: DEBUG_TASK_ID, goal: debugGoalText(input), successCondition: DEBUG_REPRODUCTION_CONDITION, nonGoals: [] },
    context: { repoPath: opts.repoPath, targetPaths, relevantDocs: [...(original?.context.relevantDocs ?? [])], buildTestCommands, constraints: [] },
    executionPolicy: { ...(original?.executionPolicy ?? DEBUG_DEFAULT_EXECUTION_POLICY) },
    safetyPolicy: {
      // An empty allowlist allows every path (ccloop pathPolicy); a non-empty one must admit the new test files too.
      allowlistPaths: original === null || original.safetyPolicy.allowlistPaths.length === 0 ? [] : targetPaths,
      denylistPaths: [...(original?.safetyPolicy.denylistPaths ?? [])],
      maxFilesTouched: original?.safetyPolicy.maxFilesTouched ?? DEBUG_DEFAULT_MAX_FILES_TOUCHED,
      humanGateConditions: [...(original?.safetyPolicy.humanGateConditions ?? [])],
    },
    verification: { verifierType: DEBUG_VERIFIER_TYPE, requiredChecks: unique(buildTestCommands), rejectOn: [...DEBUG_REJECT_ON], evidenceRequired: [] },
    escalationAndExit: {},
  });
}

/** The source normalizeControlPlan takes (with repoId and planId); the contract inline, canonical, as parseContract keeps it. */
export function buildDebugPlanSource(
  input: DebugInputV1,
  opts: { repoPath: string; existingTestDirs: string[]; agent: PartialSelection | undefined; checks?: readonly string[] },
): SchedulerControlPlanSource {
  const contract = debugContract(input, opts);
  return {
    // A short label for the group; the whole text stays in the task's objective.goal.
    goal: contract.objective.goal.split("\n", 1)[0]!,
    // normalizeControlPlan refuses a repeated condition (planImport.ts:90).
    successConditions: unique([DEBUG_REPRODUCTION_CONDITION, ...contract.context.buildTestCommands]),
    ...(opts.agent ? { agent: opts.agent } : {}),
    tasks: [{
      taskId: DEBUG_TASK_ID, dependencyTaskIds: [], targetVersion: 1,
      originalContract: contract, originalContractCanonicalJson: canonicalBytes(contract).toString("utf8"), originalContractHash: sha256Canonical(contract),
    }],
  };
}
