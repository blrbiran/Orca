// @vitest-environment jsdom
/**
 * Issue #220 follow-up: a refused requirement command led with its raw code (`code · words`), so the reader met the
 * machine's word first. The words lead now and the code stays visible after them, for a search or a report.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import type { ControlRefusal } from "../src/controlState.js";
import { config, requirementView, summaryWith } from "./fixtures/requirement.js";
afterEach(cleanup);

function alertFor(refusal: ControlRefusal): string {
  const view = requirementView("failed");
  render(<RequirementsPanel config={config} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={null} language="en"
    onSelect={vi.fn()} onCommand={vi.fn()} refusal={refusal} />);
  const line = screen.getAllByRole("alert").find((element) => element.textContent?.includes(refusal.code));
  expect(line, "the refusal line").toBeDefined();
  return line!.textContent ?? "";
}
const refusal = (code: string, message: string): ControlRefusal => ({ code, message, status: 409, commandRevision: null, evidenceIds: [], retryable: false } as ControlRefusal);

describe("a refused requirement command says its words before its code", () => {
  // mutation: the line goes back to `code · words` -> starts with the code -> red
  it("for a requirement reason the section explains", () => {
    const text = alertFor(refusal("requirement-budget-exhausted", "spent"));
    expect(text.startsWith("requirement-budget-exhausted")).toBe(false);
    expect(text).toMatch(/^.+ · requirement-budget-exhausted$/);
  });

  it("for any other refusal, explained by the shared refusal words", () => {
    const text = alertFor(refusal("group-not-found", "r"));
    expect(text.startsWith("group-not-found")).toBe(false);
    expect(text).toMatch(/^.+ · group-not-found$/);
  });
});
