import { sha256Canonical } from "./canonicalJson.js";
import type { MultiSplitOutput, SplitOutput } from "./requirementSchemas.js";

/** A multi-directory draft's secondary writes are accepted from its output, not from its expanded plan. */
export function requirementDraftHash(plan: unknown, output: SplitOutput | MultiSplitOutput): string {
  return sha256Canonical(output.tasks.some((task) => "writes" in task) ? { plan, output } : plan);
}
