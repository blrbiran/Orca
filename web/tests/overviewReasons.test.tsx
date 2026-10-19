// @vitest-environment jsdom
/**
 * Issue #56: an Overview queue row said only the stored reason code (`Error: codex-result-invalid: ...`), so the person
 * jumping to the group did not know what had happened. The row explains the code the way the group view's RunReason does,
 * keeps the raw code beside it as secondary text, and shows an unknown code as sent. A decision's question and an
 * unresolved command's id are not codes and are shown as they are.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import i18n from "../src/i18n.js";
import { Overview } from "../src/Overview.js";
import type { OverviewModel, OverviewQueueRow } from "../src/overviewModel.js";

afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });
const row = (key: string, kind: OverviewQueueRow["kind"], reason: string): OverviewQueueRow => ({
  key, kind, reason, owner: "Orca", ownerUnknown: false, ownerRequired: false, priority: 0,
  target: kind === "decision-review" ? { kind: "decision", projectKey: "p", id: key } : { kind: "group", groupId: "g", region: "problem", taskId: "a", runId: "r" },
});
const model = (queue: OverviewQueueRow[]): OverviewModel => ({ progress: [], queue, issues: [], sources: [], scopeUnavailable: false, complete: true });
const mount = (queue: OverviewQueueRow[]) => render(<Overview model={model(queue)} onOpen={() => {}} onImport={() => {}} onRequirement={() => {}} />);
const RAW = "Error: codex-result-invalid: /runs/r/attempt-1";

it.each([["en", "The model did not answer in the required JSON format."], ["zh", "模型没有按要求的 JSON 格式作答。"]] as const)("explains a known reason code in %s and keeps the raw code as secondary text", async (language, words) => {
  await i18n.changeLanguage(language);
  mount([row("t", "task-attention", RAW)]);
  const item = screen.getByRole("listitem");
  const code = item.querySelector("small code");
  expect(code?.textContent, "raw code kept as secondary text").toBe(RAW);
  const shown = (item.textContent ?? "").replace(RAW, "");
  expect(shown).toContain(words);
});

it("shows an unknown reason code as sent, once, with no secondary copy", () => {
  mount([row("u", "recovery-review", "some-future-code")]);
  const item = screen.getByRole("listitem");
  expect(item.textContent).toContain("some-future-code");
  expect(item.textContent!.split("some-future-code")).toHaveLength(2);
  expect(item.querySelector("small code")).toBeNull();
});

it("never treats a decision's question or a command id as a code", () => {
  mount([row("d", "decision-review", "codex-result-invalid"), row("c", "command-unknown", "codex-result-invalid")]);
  for (const item of screen.getAllByRole("listitem")) {
    expect(item.textContent).not.toContain("The model did not answer");
    expect(item.querySelector("small code")).toBeNull();
  }
});
