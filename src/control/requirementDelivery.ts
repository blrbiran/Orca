import type { MultiSplitOutput, SplitOutput } from "./requirementSchemas.js";
import { coversFullSuite, namedFullSuiteCommand } from "./fullSuiteRecognition.js";

/**
 * Tester #385, second shape (links-dogfood-20261120-1): a requirement can ask for a full-suite / overall verification,
 * and the split can hand every acceptance criterion to smaller tasks without any task running that suite. Acceptance
 * then proves the task checks but never the suite the requirement named. This is a hint only -- it never refuses a
 * draft -- and it is single-repository only (a multi draft's checks live per directory).
 */
export interface DeliveryProblem { problem: "missing-full-suite"; command: string }

const FULL_SUITE_WORDS = /full suite|entire suite|whole suite|整体验证|全量测试/i;
const taskChecks = (task: SplitOutput["tasks"][number]): string[] => {
  const checks = (task as unknown as { checks?: unknown }).checks;
  return Array.isArray(checks) ? checks.filter((value): value is string => typeof value === "string") : [];
};

export function deliveryProblems(document: string, output: SplitOutput | MultiSplitOutput): DeliveryProblem[] {
  const tasks = output.tasks as readonly SplitOutput["tasks"][number][];
  if (tasks.some((task) => "writes" in task)) return [];
  const named = namedFullSuiteCommand(document);
  if (named === null && !FULL_SUITE_WORDS.test(document)) return [];
  const command = named?.command ?? "the full suite";
  const checks = tasks.flatMap(taskChecks);
  return coversFullSuite(document, checks) ? [] : [{ problem: "missing-full-suite", command }];
}

/** The hint `orca requirement show` prints for one draft. */
export const deliveryProblemLine = (entry: DeliveryProblem): string =>
  `requirement-delivery: the requirement asks for ${entry.command}, and no task's checks run it`;