import { describe, expect, it } from "vitest";
import { buildSplitPrompt, NO_VERIFY_ONLY_RULE } from "../../src/control/requirementSplit.js";

// Issue #136 (session 3cfc2e73): a split wrote a verify-only task checked by `git diff --name-only HEAD | grep -x
// src/math.js`; the work it verified had already landed, so the agent added a meaningless comment to make a diff. The
// single-repository instruction now forbids verify-only tasks, "file was changed" checks and commit/base-sha checks, in
// words written out here, so dropping the rule from the prompt the model reads turns this red.
const instruction = (() => {
  const prompt = buildSplitPrompt({ document: "D.", overview: { canonicalJson: "{}", hash: "b".repeat(64) }, earlierDrafts: [] });
  return prompt.slice(0, prompt.indexOf("\n\n<<<ORCA-DATA requirement-document "));
})();

describe("the split instruction's no-verify-only rule (#136)", () => {
  it("no verify-only tasks, no check that some file changed, no commit id or base sha checks; checks are runnable commands", () => {
    expect(NO_VERIFY_ONLY_RULE).toBe("- Do not write verify-only tasks: every task changes files, and verifying earlier work belongs in that work's own checks. A check must not require that some file was changed (such as `git diff --name-only HEAD`) and must not check commit ids or base shas; checks are runnable commands that read the delivered files or run the repository's tests.");
    expect(instruction).toContain(NO_VERIFY_ONLY_RULE);
  });

  it("stays instruction version 3", () => {
    expect(instruction.split("\n", 1)[0]).toBe("Orca requirement split, instruction version 3.");
  });
});
