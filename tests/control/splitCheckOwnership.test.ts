import { describe, expect, it } from "vitest";
import { buildSplitPrompt } from "../../src/control/requirementSplit.js";

// #168: a documentation-only task was assigned a repository-wide test that already failed in unrelated source.
// The task could finish its document but had no writable path to repair that failure, so it exhausted its grant.
const instructionOf = (multi: boolean): string => {
  const prompt = buildSplitPrompt({ document: "Document how math.js increments a value.", overview: { canonicalJson: "{}", hash: "a".repeat(64) }, earlierDrafts: [], ...(multi ? { multi: true } : {}) });
  return prompt.slice(0, prompt.indexOf("\n\n<<<ORCA-DATA requirement-document "));
};

describe("a split assigns checks the task can satisfy (#168)", () => {
  for (const multi of [false, true]) {
    it(multi ? "several directories" : "one repository", () => {
      const instruction = instructionOf(multi);
      expect(instruction).toContain("You have no tools and the overview does not report test results. Without a documented passing baseline for the same commit, treat repository-wide tests as possibly failing; do not assign one to a documentation-only task that cannot repair its failures.");
      expect(instruction).toContain("A required check's failure must be fixable by this task within its writable target paths, or by dependencies already completed before it runs.");
      expect(instruction).toContain("For a documentation-only task, check the delivered document; do not assign a repository-wide test that already fails in unrelated source the task cannot change.");
      expect(instruction).toContain("A repository-wide test that already passes may still be required to stay passing. If it must be made to pass, assign it to a task allowed to change the failing source or tests.");
      expect(instruction.split("\n", 1)[0]).toBe(multi
        ? "Orca requirement split (several directories), instruction version 5."
        : "Orca requirement split, instruction version 5.");
    });
  }
});
