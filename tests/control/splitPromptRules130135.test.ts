import { describe, expect, it } from "vitest";
import { buildSplitPrompt, CHECK_SOURCE_RULE, NO_LOCKFILE_RULE } from "../../src/control/requirementSplit.js";

// Issues #130 and #135 (session 3cfc2e73): the split told setup to use the lockfile's clean installer (`npm ci`), which
// fails in a repository with no lockfile; and with no tools it wrote `node -e "require(...)"` checks in an ESM repository
// and asserted contents of files it was never shown. The single-repository instruction now states both rules, in words
// written out here, so dropping either from the prompt the model reads turns this red.
const instruction = (() => {
  const prompt = buildSplitPrompt({ document: "D.", overview: { canonicalJson: "{}", hash: "b".repeat(64) }, earlierDrafts: [] });
  return prompt.slice(0, prompt.indexOf("\n\n<<<ORCA-DATA requirement-document "));
})();

describe("the split instruction's setup and check rules (#130, #135)", () => {
  it("#130: no lockfile means no setup when nothing needs installing, else npm install --no-package-lock", () => {
    expect(NO_LOCKFILE_RULE).toBe("When \"manifests\" shows no lockfile, omit \"setup\" if nothing needs installing, else use npm install --no-package-lock (never npm ci, which needs a lockfile).");
    expect(instruction).toContain(NO_LOCKFILE_RULE);
  });

  it("#135: the repository's own test scripts, no ad-hoc node -e module loading (manifests' type says ESM), nothing about unseen files", () => {
    expect(CHECK_SOURCE_RULE).toBe("- Prefer the repository's own test scripts (as \"manifests\" lists them) as checks. Do not write ad-hoc `node -e` checks that load modules: a package's \"type\" in \"manifests\" says whether it is an ES module (\"module\") or CommonJS. Do not assert facts about the contents of files you were not shown.");
    expect(instruction).toContain(CHECK_SOURCE_RULE);
  });

  it("uses instruction version 4", () => {
    expect(instruction.split("\n", 1)[0]).toBe("Orca requirement split, instruction version 4.");
  });
});
