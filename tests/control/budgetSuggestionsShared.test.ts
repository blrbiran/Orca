import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Issue #156 (session 3cfc2e73): the budget-suggestion transform is one module that both the panel's budget editor and
// the CLI's `orca group apply-estimate` run, so "Apply all" and the CLI cannot drift apart. web/ bundles it, and task 8
// ruling K2 says a browser bundle cannot ship the server's module graph: the module must stay import-free, and the
// editor must take its suggestions from it rather than from a copy of its own.
const shared = readFileSync(new URL("../../src/control/budgetSuggestions.ts", import.meta.url), "utf8");
const editor = readFileSync(new URL("../../web/src/BudgetEditor.tsx", import.meta.url), "utf8");

describe("the shared budget-suggestion module (#156)", () => {
  it("imports nothing, so the browser bundle pulls in no server module", () => {
    expect(shared.match(/^\s*(import|export\s+[^;]*\sfrom)\s/gm)).toBeNull();
    expect(shared).not.toMatch(/\brequire\(|\bimport\(/);
  });

  it("is what the panel's budget editor uses, with no local copy of the transform", () => {
    expect(editor).toContain('from "../../src/control/budgetSuggestions.js"');
    expect(editor).not.toMatch(/function (adviceOf|suggestedOperations|suggestedLoopActions|suggestionActions|suggestedAmount)\b/);
  });
});
