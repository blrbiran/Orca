import type { MultiSplitOutput, SplitOutput } from "./requirementSchemas.js";

/**
 * Tester #385, second shape (links-dogfood-20261120-1): a requirement can ask for a full-suite / overall verification,
 * and the split can hand every acceptance criterion to smaller tasks without any task running that suite. Acceptance
 * then proves the task checks but never the suite the requirement named. This is a hint only -- it never refuses a
 * draft -- and it is single-repository only (a multi draft's checks live per directory).
 */
export interface DeliveryProblem { problem: "missing-full-suite"; command: string }

const FULL_SUITE = /\b(npm (?:run )?test|npm test|pytest|go test \.\/\.\.\.|cargo test|make test)\b/i;
const FULL_SUITE_WORDS = /full suite|entire suite|whole suite|整体验证|全量测试/i;

const taskTexts = (task: SplitOutput["tasks"][number]): string[] => {
  const record = task as unknown as { checks?: unknown; successCondition?: unknown; goal?: unknown };
  return [...(Array.isArray(record.checks) ? record.checks : []), record.successCondition, record.goal]
    .filter((value): value is string => typeof value === "string");
};

export function deliveryProblems(document: string, output: SplitOutput | MultiSplitOutput): DeliveryProblem[] {
  const tasks = output.tasks as readonly SplitOutput["tasks"][number][];
  if (tasks.some((task) => "writes" in task)) return [];
  const named = FULL_SUITE.exec(document);
  if (named === null && !FULL_SUITE_WORDS.test(document)) return [];
  const command = named?.[0] ?? "the full suite";
  const covered = tasks.some((task) => {
    const texts = taskTexts(task);
    return named !== null
      ? texts.some((text) => text.toLowerCase().includes(command.toLowerCase()))
      : texts.some((text) => FULL_SUITE.test(text) || FULL_SUITE_WORDS.test(text));
  });
  return covered ? [] : [{ problem: "missing-full-suite", command }];
}

/** The hint `orca requirement show` prints for one draft. */
export const deliveryProblemLine = (entry: DeliveryProblem): string =>
  `requirement-delivery: the requirement asks for ${entry.command}, and no task's checks run it`;