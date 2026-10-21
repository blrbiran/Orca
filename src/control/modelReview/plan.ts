import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { taskContractSchema, type SchedulerControlPlanSource } from "../../scheduler/planFile.js";
import type { PartialSelection } from "../agentSelection.js";
import { canonicalBytes, sha256Canonical } from "../canonicalJson.js";
import { DEBUG_DEFAULT_EXECUTION_POLICY, DEBUG_REJECT_ON, DEBUG_TASK_ID, DEBUG_VERIFIER_TYPE } from "../debugPlan.js";
import { SYSTEM_DEBUG_INPUT_SCHEMA, systemDebugGoalText, type SystemDebugSource } from "../systemDebug.js";

/**
 * Checks spec 2026-10-22 §6.1 step 0–2: the model review's one-task plan, built by its own builder (the system debug
 * builder hard-codes the write set `**`). The review may write only its findings file and its own decision ledger
 * (ccloop's write-set and path policy enforce it inside the run; Orca checks the attempt's diff after it, Task 9); its
 * denylist is the union of the range groups' contract denylists (Rule 16: never looser than the repository's own); its
 * required check is Orca's validator by absolute path; its token budget is the review budget. Same input ⇒ same bytes.
 */
export const FINDINGS_PATH = ".orca-review/findings.json";
export const REVIEW_WRITE_SET = [FINDINGS_PATH, ".decisions/**"] as const;
// src/control/modelReview/plan.ts and dist/control/modelReview/plan.js are both three levels below Orca's root.
const ORCA_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const quote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

export function validatorCommand(from: string, to: string): string {
  return `node ${quote(join(ORCA_ROOT, "dist", "control", "validateFindings.js"))} ${FINDINGS_PATH} ${from} ${to}`;
}

export interface ModelReviewPlanInput {
  source: Extract<SystemDebugSource, { kind: "model-review" }>;
  /** The absolute directory holding the review's input files (§6.2) and the sha256 of its index.json. */
  inputDir: string; inputSha256: string;
  groups: string[];
  budgetTokens: number;
  denylistPaths: string[];
}

export function buildModelReviewPlanSource(input: ModelReviewPlanInput, repoPath: string, agent?: PartialSelection): SchedulerControlPlanSource {
  const { source } = input;
  const check = validatorCommand(source.from, source.to);
  const goal = systemDebugGoalText({
    schema: SYSTEM_DEBUG_INPUT_SCHEMA, source, stackOn: null, repoId: source.repoId, checks: [check],
    facts: [
      `the range ${source.from}..${source.to} on ${source.target}; read the diff with git (git diff ${source.from} ${source.to})`,
      `the groups landed in it: ${input.groups.join(", ")}`,
      `the review's inputs (one JSON per item, index.json first; sha256 ${input.inputSha256}): ${input.inputDir}`,
      `write the findings to ${FINDINGS_PATH} (schema orca-model-review-findings-v1, range from ${source.from} to ${source.to}); change no other file`,
    ],
  }, null);
  const contract = taskContractSchema.parse({
    objective: { taskId: DEBUG_TASK_ID, goal, successCondition: `the findings file passes: ${check}`, nonGoals: ["changing any file other than the findings file"] },
    context: { repoPath, targetPaths: [...REVIEW_WRITE_SET], relevantDocs: [], buildTestCommands: [check], constraints: [] },
    executionPolicy: { ...DEBUG_DEFAULT_EXECUTION_POLICY, tokenBudget: input.budgetTokens },
    safetyPolicy: { allowlistPaths: [...REVIEW_WRITE_SET], denylistPaths: [...new Set(input.denylistPaths)], maxFilesTouched: 64, humanGateConditions: [] },
    verification: { verifierType: DEBUG_VERIFIER_TYPE, requiredChecks: [check], rejectOn: [...DEBUG_REJECT_ON], evidenceRequired: [] },
    escalationAndExit: {},
  });
  return {
    goal: goal.split("\n", 1)[0]!,
    successConditions: [contract.objective.successCondition],
    ...(agent ? { agent } : {}),
    tasks: [{
      taskId: DEBUG_TASK_ID, dependencyTaskIds: [], targetVersion: 1,
      originalContract: contract, originalContractCanonicalJson: canonicalBytes(contract).toString("utf8"), originalContractHash: sha256Canonical(contract),
    }],
  };
}
