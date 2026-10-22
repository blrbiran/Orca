/**
 * Flow engine spec §6.2 (plan Task 10): the one-task plan a `work` execution's hidden child group runs. Precedent:
 * buildSystemDebugPlanSource (systemDebug.ts). Pure: the same input gives the same bytes, so a restart rebuilds the same
 * plan and the child's idempotent open sees no change.
 *
 * - taskId `step`, labels none, no dependencies, the vault as `repoPath`, the whole tree (`**`, as the debug plans:
 *   writeSet.ts normalises it to the whole repository).
 * - Checks: the step's gate checks; without any, the default gate "the attempt changed at least one path" (ccloop needs
 *   at least one check, ccloop src/contract/schema.ts `buildTestCommands`/`requiredChecks` `.min(1)`).
 * - Effect-classed steps (§9.6): `maxAttempts: 1`, no default changed-path gate (an upload may change no file), the
 *   no-op gate when the template names none, and the effect record id in the prompt as idempotency key and as
 *   `--confirmed-by-orca` (§4.3 rule 2, §16.4).
 * - `executionPolicy.toolRules` only when the step has `tools` (§16.2): absent, the contract is byte-equal to today's.
 */
import { taskContractSchema, type SchedulerControlPlanSource } from "../scheduler/planFile.js";
import type { PartialSelection } from "./agentSelection.js";
import { canonicalBytes, sha256Canonical } from "./canonicalJson.js";
import { DEBUG_DEFAULT_EXECUTION_POLICY, DEBUG_DEFAULT_MAX_FILES_TOUCHED, DEBUG_REJECT_ON, DEBUG_VERIFIER_TYPE } from "./debugPlan.js";
import { ControlError } from "./errors.js";
import { stepToolsToToolRules } from "../flow/toolRulesMap.js";
import type { FlowStep } from "../flow/template/schema.js";

export const FLOW_STEP_TASK_ID = "step";
export const FLOW_STEP_TARGET_PATH = "**";
/** §9.6: an effect step's gate when the template names none (ccloop requires one check; this one always passes). */
export const NO_OP_GATE = "true";
/**
 * §6.2 default gate (writer's call on the spelling): the attempt's tree differs from the composition it started from,
 * committed or not, or it added an untracked file. `baseCommit` is a 40-hex commit id, so it needs no quoting.
 */
export const DEFAULT_CHANGED_GATE = (baseCommit: string): string =>
  `! { git diff --quiet ${baseCommit} -- && test -z "$(git ls-files --others --exclude-standard)"; }`;

export interface FlowStepPlanInput {
  flowRunId: string;
  step: FlowStep;
  seq: number;
  baseCommit: string;
  /** The vault (§5.2): the child's target repository. */
  vaultPath: string;
  /** The kernel's rendered envelope (§12.1) for this execution. */
  promptEnvelope: string;
  /** The step's gate checks (`acceptance.checks` with `role: gate`). */
  gates: readonly string[];
  /** §9.6: the effect record this execution is confirmed by; required for an effect-classed step. */
  effectRecordId?: string | null;
  agent?: PartialSelection;
}

export const isEffectStep = (step: FlowStep): boolean => step.kind === "work" && step.effect !== undefined;

function effectLines(recordId: string): string {
  return [
    "",
    `Orca effect record: ${recordId}. This step's side effect is confirmed by that record.`,
    `Use it as the idempotency key wherever the target API accepts one, and pass --confirmed-by-orca '${recordId}' to every skill that has that switch.`,
    "Report the remote id as flow.effect.remoteId either way. Do the side effect at most once; do not retry it.",
    "",
  ].join("\n");
}

export function buildFlowStepPlanSource(input: FlowStepPlanInput): SchedulerControlPlanSource {
  const { step } = input;
  if (step.kind !== "work") throw new ControlError("control-argument-invalid", `flow-step-not-work:${step.id}`);
  const effect = isEffectStep(step);
  const recordId = input.effectRecordId ?? null;
  if (effect && recordId === null) throw new ControlError("control-argument-invalid", `effect-record-missing:${step.id}`);
  const gates = [...new Set(input.gates)];
  const checks = gates.length > 0 ? gates : effect ? [NO_OP_GATE] : [DEFAULT_CHANGED_GATE(input.baseCommit)];
  const goal = `Flow step ${step.id} (run ${input.flowRunId}, execution ${input.seq}).\n\n${input.promptEnvelope}${effect ? effectLines(recordId!) : ""}`;
  const successCondition = gates.length > 0 ? `the step's gates pass: ${gates.join("; ")}`
    : effect ? "the step's side effect is done once and reported" : "the attempt changed at least one path";
  const contract = taskContractSchema.parse({
    objective: { taskId: FLOW_STEP_TASK_ID, goal, successCondition, nonGoals: [] },
    context: { repoPath: input.vaultPath, targetPaths: [FLOW_STEP_TARGET_PATH], relevantDocs: [], buildTestCommands: checks, constraints: [] },
    executionPolicy: {
      ...DEBUG_DEFAULT_EXECUTION_POLICY,
      ...(effect ? { maxAttempts: 1 } : {}),
      ...(step.tools === undefined ? {} : { toolRules: stepToolsToToolRules(step.tools) }),
    },
    safetyPolicy: { allowlistPaths: [], denylistPaths: [], maxFilesTouched: DEBUG_DEFAULT_MAX_FILES_TOUCHED, humanGateConditions: [] },
    verification: { verifierType: DEBUG_VERIFIER_TYPE, requiredChecks: checks, rejectOn: [...DEBUG_REJECT_ON], evidenceRequired: [] },
    escalationAndExit: {},
  });
  return {
    goal: `Flow step ${step.id} (${input.flowRunId}#${input.seq})`,
    successConditions: [successCondition],
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    tasks: [{
      taskId: FLOW_STEP_TASK_ID, dependencyTaskIds: [], targetVersion: 1,
      originalContract: contract, originalContractCanonicalJson: canonicalBytes(contract).toString("utf8"), originalContractHash: sha256Canonical(contract),
    }],
  };
}
