// @vitest-environment jsdom
/**
 * Tester follow-up G Part 5 in the Web: under each task in Live, its notes with where each one is, and a box that sends
 * add-live-note. The server bounds a note in UTF-8 bytes (2048), so the box counts bytes, not characters; a finished task
 * or an archived group takes no note, and the box says why.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { LiveNoteBox, LiveNoteList } from "../src/LiveNotes.js";
import type { GroupViewV1, LiveNoteViewV1 } from "../src/controlTypes.js";
import { config, run, view, workItem } from "./fixtures/board.js";

beforeEach(() => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ schema: "orca-run-transcripts-v1", runId: "run-a", available: true, calls: [] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(() => { cleanup(); });

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const running = (over: Partial<GroupViewV1> = {}): GroupViewV1 => ({
  ...view([workItem({ taskId: "a", status: "active", category: "running", currentRunId: "run-a", lineageRunIds: ["run-a"] })],
    [run({ runId: "run-a", taskId: "a", state: "running", phase: "work", startedAt: NOW - 60_000 })]),
  ...over,
});
const note = (over: Partial<LiveNoteViewV1>): LiveNoteViewV1 => ({ noteId: "n1", taskId: "a", text: "use v2", at: NOW, by: "human", state: "queued", delivered: null, ...over });

it("sends add-live-note with the text for the running task and clears the box on success", () => {
  const onCommand = vi.fn();
  const value = running();
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} now={NOW} />);
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  const box = within(screen.getByRole("tabpanel", { name: "Live" })).getByRole("group", { name: "Note for a" });
  const area = within(box).getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement;
  fireEvent.change(area, { target: { value: "the fixture lives in test/data" } });
  fireEvent.click(within(box).getByRole("button", { name: "Send note" }));
  expect(onCommand).toHaveBeenCalledWith({ verb: "add-live-note", groupId: value.summary.groupId, taskId: "a", expectedRevision: value.summary.commandRevision, payload: { text: "the fixture lives in test/data" } });
  expect(area.value).toBe("");
});

// mutation M-O6a: count `text.length` instead of UTF-8 bytes -> 1025 × "é" (2050 bytes) still enables Send, red
it("counts UTF-8 bytes and disables Send above 2048", () => {
  render(<LiveNoteBox view={running()} taskId="a" archived={false} onCommand={vi.fn()} />);
  const area = screen.getByRole("textbox", { name: "Note for the agent" });
  const send = screen.getByRole("button", { name: "Send note" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(area, { target: { value: "é".repeat(1024) } });
  expect(screen.getByText("2048 / 2048 bytes")).toBeTruthy();
  expect(send.disabled).toBe(false);
  fireEvent.change(area, { target: { value: "é".repeat(1025) } });
  expect(screen.getByText("2050 / 2048 bytes")).toBeTruthy();
  expect(send.disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("The note is longer than 2048 bytes.");
});

it("shows queued / delivered at execute (attempt 2) / not delivered", () => {
  const notes = [note({ noteId: "n1", text: "one" }), note({ noteId: "n2", text: "two", state: "delivered", delivered: { runId: "run-a", phase: "execute", attempt: 2, at: "2026-11-12T12:00:00.000Z" } }), note({ noteId: "n3", text: "three", state: "undelivered" })];
  const { rerender } = render(<LiveNoteList notes={notes} running />);
  const items = () => screen.getAllByRole("listitem").map((item) => item.textContent);
  expect(items()).toEqual(["one (queued — delivered at the next step)", "two (delivered at execute (attempt 2))", "three (not delivered — added to the task's handoff)"]);
  rerender(<LiveNoteList notes={notes.slice(0, 1)} running={false} />);
  expect(items()).toEqual(["one (queued — delivered when the task continues)"]);
});

// mutation M-O6b: the box ignores a completed task -> Send is enabled for it, red
it("disables the box for a completed task and in an archived group", () => {
  const done = running({ workItems: [workItem({ taskId: "a", status: "completed", category: "done", currentRunId: "run-a", lineageRunIds: ["run-a"] })] });
  render(<LiveNoteBox view={done} taskId="a" archived={false} onCommand={vi.fn()} />);
  expect((screen.getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Send note" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("note").textContent).toBe("This task has finished; a note can no longer reach it.");
  cleanup();
  render(<LiveNoteBox view={running()} taskId="a" archived onCommand={vi.fn()} />);
  expect((screen.getByRole("button", { name: "Send note" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("note").textContent).toBe("This group is archived.");
});

/*
 * #243 (tester follow-up I): the box behaves like a chat composer. Enter sends once, Shift+Enter is a new line, and an
 * Enter that confirms an input-method composition (Chinese, Japanese) must never send the half-typed note.
 */
const box = (onCommand = vi.fn()) => {
  render(<LiveNoteBox view={running()} taskId="a" archived={false} onCommand={onCommand} />);
  const area = screen.getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement;
  return { onCommand, area };
};

// mutation M-I1a: drop the Enter handler -> Enter never sends, red
it("sends once on Enter and clears the box", () => {
  const { onCommand, area } = box();
  fireEvent.change(area, { target: { value: "use v2" } });
  const notCancelled = fireEvent.keyDown(area, { key: "Enter", code: "Enter" });
  expect(notCancelled).toBe(false);
  expect(onCommand).toHaveBeenCalledTimes(1);
  expect(onCommand.mock.calls[0]?.[0]).toMatchObject({ verb: "add-live-note", taskId: "a", payload: { text: "use v2" } });
  expect(area.value).toBe("");
  expect(screen.getByText("Enter to send, Shift+Enter for a new line")).toBeTruthy();
});

// mutation M-I1b: ignore shiftKey -> Shift+Enter sends, red
it("Shift+Enter does not send and leaves the newline to the textarea", () => {
  const { onCommand, area } = box();
  fireEvent.change(area, { target: { value: "line one" } });
  const notCancelled = fireEvent.keyDown(area, { key: "Enter", code: "Enter", shiftKey: true });
  expect(notCancelled).toBe(true);
  expect(onCommand).not.toHaveBeenCalled();
  expect(area.value).toBe("line one");
});

// mutations M-I1c (drop the compositionstart/end flag), M-I1d (drop isComposing), M-I1e (drop keyCode 229): each red
it("Enter during an IME composition never sends; Enter after compositionend does", () => {
  const { onCommand, area } = box();
  fireEvent.change(area, { target: { value: "用 v2" } });
  fireEvent.compositionStart(area);
  fireEvent.keyDown(area, { key: "Enter", code: "Enter" });
  expect(onCommand).not.toHaveBeenCalled();
  fireEvent.compositionEnd(area);
  fireEvent.keyDown(area, { key: "Enter", code: "Enter", isComposing: true });
  expect(onCommand).not.toHaveBeenCalled();
  fireEvent.keyDown(area, { key: "Enter", code: "Enter", keyCode: 229 });
  expect(onCommand).not.toHaveBeenCalled();
  expect(area.value).toBe("用 v2");
  fireEvent.keyDown(area, { key: "Enter", code: "Enter" });
  expect(onCommand).toHaveBeenCalledTimes(1);
  expect(onCommand.mock.calls[0]?.[0]).toMatchObject({ payload: { text: "用 v2" } });
});

// mutation M-I1f: send on Enter without checking canSend -> an empty note is sent, red
it("Enter on an empty box, a too-large note or a finished task sends nothing", () => {
  const { onCommand, area } = box();
  fireEvent.keyDown(area, { key: "Enter", code: "Enter" });
  fireEvent.change(area, { target: { value: "é".repeat(1025) } });
  fireEvent.keyDown(area, { key: "Enter", code: "Enter" });
  expect(onCommand).not.toHaveBeenCalled();
  cleanup();
  const done = running({ workItems: [workItem({ taskId: "a", status: "completed", category: "done", currentRunId: "run-a", lineageRunIds: ["run-a"] })] });
  const onDone = vi.fn();
  render(<LiveNoteBox view={done} taskId="a" archived={false} onCommand={onDone} />);
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Note for the agent" }), { key: "Enter", code: "Enter" });
  expect(onDone).not.toHaveBeenCalled();
});
