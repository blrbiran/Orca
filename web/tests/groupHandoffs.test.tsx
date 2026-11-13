// @vitest-environment jsdom
/**
 * Tester follow-up G Part 4.7 in the Web: each task's handoffs, versions by run, the summary shown and the handoff text read
 * only when a version is opened; a group with none shows nothing.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GroupHandoffs } from "../src/GroupHandoffs.js";
import type { GroupViewV1, TaskHandoffViewV1 } from "../src/controlTypes.js";
import { view, workItem } from "./fixtures/board.js";

afterEach(() => { cleanup(); });

const STORED = { state: "stored" as const, reason: null, bytes: 5 };
const entry = (over: Partial<TaskHandoffViewV1>): TaskHandoffViewV1 => ({ taskId: "a", runId: "run-1", outcome: "succeeded", handoff: STORED, summary: STORED, summaryText: "did a\n", recordedAt: 1, notesMerged: 0, ...over });

it("shows nothing for a group without handoffs", () => {
  const { container } = render(<GroupHandoffs view={view([workItem({ taskId: "a" })])} />);
  expect(container.textContent).toBe("");
});

it("lists each task's handoff versions with the summary; opening one fetches and shows the handoff text", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ schema: "orca-task-handoff-v1", groupId: "g", taskId: "a", runId: "run-2", record: entry({ runId: "run-2" }), handoff: "# Learned\nX\n", summary: "did a again\n" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const value: GroupViewV1 = { ...view([workItem({ taskId: "a" }), workItem({ taskId: "b" })]), handoffs: [
    entry({ runId: "run-1", outcome: "failed", handoff: { state: "invalid", reason: "too-large", bytes: 9000 } }),
    entry({ runId: "run-2", summaryText: "did a again\n" }),
    entry({ taskId: "b", runId: "run-3", handoff: { state: "missing", reason: null, bytes: null }, summary: { state: "missing", reason: null, bytes: null }, summaryText: null }),
  ] };
  render(<GroupHandoffs view={value} />);
  const a = screen.getByRole("region", { name: "Task a" });
  const versions = within(a).getAllByRole("group");
  expect(versions.map((version) => version.querySelector("summary")!.textContent)).toEqual([
    "run run-1 (failed): handoff invalid (too-large), summary stored", "run run-2 (succeeded): handoff stored, summary stored",
  ]);
  expect(within(screen.getByRole("region", { name: "Task b" })).getByText("run run-3 (succeeded): handoff missing, summary missing")).toBeTruthy();
  expect(urls).toEqual([]);
  const second = versions[1] as HTMLDetailsElement;
  await act(async () => { second.open = true; fireEvent(second, new Event("toggle")); await Promise.resolve(); await Promise.resolve(); });
  expect(urls).toEqual([`/api/control/groups/${value.summary.groupId}/handoffs/a/run-2`]);
  expect(await within(second).findByLabelText("Handoff")).toHaveProperty("textContent", "# Learned\nX\n");
  expect(within(second).getByLabelText("Summary").textContent).toBe("did a again\n");
});

// Tester #309 (follow-up J): a summary kept as its first lines reads "truncated (too-many-lines)", not stored or invalid.
it("names a truncated summary", async () => {
  const value: GroupViewV1 = { ...view([workItem({ taskId: "a" })]), handoffs: [entry({ summary: { state: "truncated", reason: "too-many-lines", bytes: 793 }, summaryText: "l0\n… (truncated)\n" })] };
  render(<GroupHandoffs view={value} />);
  // mutation (no truncated word: it falls through to invalid) -> red here.
  expect(screen.getByText("run run-1 (succeeded): handoff stored, summary truncated (too-many-lines)")).toBeTruthy();
});
