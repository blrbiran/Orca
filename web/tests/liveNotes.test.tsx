// @vitest-environment jsdom
/**
 * Tester follow-up G Part 5 in the Web: under each task in Live, its notes with where each one is, and a box that sends
 * add-live-note. The server bounds a note in UTF-8 bytes (2048), so the box counts bytes, not characters; a finished task
 * or an archived group takes no note, and the box says why.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

it("sends add-live-note with the text for the running task and clears the box on success", async () => {
  const onCommand = vi.fn(async () => 7);
  const value = running();
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} now={NOW} />);
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  const box = within(screen.getByRole("tabpanel", { name: "Live" })).getByRole("group", { name: "Note for a" });
  const area = within(box).getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement;
  fireEvent.change(area, { target: { value: "the fixture lives in test/data" } });
  fireEvent.click(within(box).getByRole("button", { name: "Send note" }));
  expect(onCommand).toHaveBeenCalledWith({ verb: "add-live-note", groupId: value.summary.groupId, taskId: "a", expectedRevision: value.summary.commandRevision, payload: { text: "the fixture lives in test/data" } });
  await act(async () => { await onCommand.mock.results[0]!.value; });
  expect(area.value).toBe("");
});

// A rejected or uncertain command must leave the person's draft available, while a pending command cannot be sent twice.
it("keeps the draft until confirmation and does not resend while pending", async () => {
  let answer!: (value: number | null) => void;
  const onCommand = vi.fn(() => new Promise<number | null>((resolve) => { answer = resolve; }));
  render(<LiveNoteBox view={running()} taskId="a" archived={false} onCommand={onCommand} />);
  const area = screen.getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement;
  fireEvent.change(area, { target: { value: "check the README example" } });
  fireEvent.click(screen.getByRole("button", { name: "Send note" }));
  expect(area.value).toBe("check the README example");
  fireEvent.keyDown(area, { key: "Enter", code: "Enter" });
  expect(onCommand).toHaveBeenCalledTimes(1);
  await act(async () => answer(null));
  expect(area.value).toBe("check the README example");
});

it("keeps an unsent draft when the Live tab is closed and reopened", () => {
  const value = running();
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} now={NOW} />);
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Note for the agent" }), { target: { value: "keep this idea" } });
  fireEvent.click(screen.getByRole("tab", { name: "Progress" }));
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  expect((screen.getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement).value).toBe("keep this idea");
});

it("clears a confirmed note after the person switches away while it sends", async () => {
  let answer!: (value: number | null) => void;
  const onCommand = vi.fn(() => new Promise<number | null>((resolve) => { answer = resolve; }));
  render(<ControlGroupView view={running()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} now={NOW} />);
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Note for the agent" }), { target: { value: "sent in background" } });
  fireEvent.click(screen.getByRole("button", { name: "Send note" }));
  fireEvent.click(screen.getByRole("tab", { name: "Progress" }));
  await act(async () => answer(7));
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  expect((screen.getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement).value).toBe("");
});

it("does not submit a second command after switching tabs while the first is pending", () => {
  const onCommand = vi.fn(() => new Promise<number | null>(() => {}));
  render(<ControlGroupView view={running()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} now={NOW} />);
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Note for the agent" }), { target: { value: "only once" } });
  fireEvent.click(screen.getByRole("button", { name: "Send note" }));
  fireEvent.click(screen.getByRole("tab", { name: "Progress" }));
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  fireEvent.click(screen.getByRole("button", { name: "Send note" }));
  expect(onCommand).toHaveBeenCalledTimes(1);
});

it("keeps an uncertain send blocked across tab switches until the person edits the draft", async () => {
  const onCommand = vi.fn(async () => null);
  render(<ControlGroupView view={running()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} now={NOW} />);
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Note for the agent" }), { target: { value: "check status first" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send note" })); await onCommand.mock.results[0]!.value; });
  fireEvent.click(screen.getByRole("tab", { name: "Progress" }));
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  expect(screen.getByRole("status").textContent).toContain("Delivery is not confirmed");
  expect((screen.getByRole("button", { name: "Send note" }) as HTMLButtonElement).disabled).toBe(true);
});

it("shows an uncertain result on the remounted note box immediately", async () => {
  let answer!: (value: number | null) => void;
  const onCommand = vi.fn(() => new Promise<number | null>((resolve) => { answer = resolve; }));
  render(<ControlGroupView view={running()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} now={NOW} />);
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Note for the agent" }), { target: { value: "one note" } });
  fireEvent.click(screen.getByRole("button", { name: "Send note" }));
  fireEvent.click(screen.getByRole("tab", { name: "Progress" }));
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  await act(async () => answer(null));
  expect(screen.getByRole("status").textContent).toContain("Delivery is not confirmed");
  expect((screen.getByRole("button", { name: "Send note" }) as HTMLButtonElement).disabled).toBe(true);
});

it("does not erase a newer draft when an earlier send resolves after remount", async () => {
  let answer!: (value: number | null) => void;
  const onCommand = vi.fn(() => new Promise<number | null>((resolve) => { answer = resolve; }));
  render(<ControlGroupView view={running()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} now={NOW} />);
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Note for the agent" }), { target: { value: "old note" } });
  fireEvent.click(screen.getByRole("button", { name: "Send note" }));
  fireEvent.click(screen.getByRole("tab", { name: "Progress" }));
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Note for the agent" }), { target: { value: "new draft" } });
  await act(async () => answer(7));
  fireEvent.click(screen.getByRole("tab", { name: "Progress" }));
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  expect((screen.getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement).value).toBe("new draft");
});

it("keeps a draft when the command handler throws", async () => {
  const onCommand = vi.fn(async () => { throw new Error("connection lost"); });
  render(<LiveNoteBox view={running()} taskId="a" archived={false} onCommand={onCommand} />);
  const area = screen.getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement;
  fireEvent.change(area, { target: { value: "still unsent" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send note" })); await onCommand.mock.results[0]!.value.catch(() => {}); });
  expect(area.value).toBe("still unsent");
  expect(screen.getByRole("status").textContent).toContain("Delivery is not confirmed");
});

// A confirmed send must not erase a newer draft written while the network request was in flight.
it("clears only the confirmed draft, preserving text typed during the send", async () => {
  let answer!: (value: number | null) => void;
  const onCommand = vi.fn(() => new Promise<number | null>((resolve) => { answer = resolve; }));
  render(<LiveNoteBox view={running()} taskId="a" archived={false} onCommand={onCommand} />);
  const area = screen.getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement;
  fireEvent.change(area, { target: { value: "first note" } });
  fireEvent.click(screen.getByRole("button", { name: "Send note" }));
  fireEvent.change(area, { target: { value: "new draft" } });
  await act(async () => answer(7));
  expect(area.value).toBe("new draft");
});

// A task waiting for its first run accepts a note at its next A2, even when another task owns the Live transcript.
it("offers the waiting task's note box before it has a run", () => {
  const value = running({
    workItems: [running().workItems[0]!, workItem({ taskId: "b", status: "ready", category: "waiting", currentRunId: null })],
    liveNotes: [note({ noteId: "waiting-b", taskId: "b", text: "remember the fixture" })],
  });
  const onCommand = vi.fn(async () => 7);
  render(<ControlGroupView view={value} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand} now={NOW} />);
  fireEvent.click(screen.getByRole("tab", { name: "Live" }));
  expect(within(screen.getByRole("tabpanel", { name: "Live" })).queryByRole("region", { name: "Notes for b" })).toBeNull();
  expect(within(screen.getByRole("tabpanel", { name: "Live" })).getAllByRole("textbox")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Notes for other tasks (1)" }));
  const waiting = within(screen.getByRole("tabpanel", { name: "Live" })).getByRole("region", { name: "Notes for b" });
  expect(within(waiting).getByRole("listitem").textContent).toContain("queued");
  const box = within(waiting).getByRole("group", { name: "Note for b" });
  fireEvent.change(within(box).getByRole("textbox", { name: "Note for the agent" }), { target: { value: "read before coding" } });
  fireEvent.click(within(box).getByRole("button", { name: "Send note" }));
  expect(onCommand).toHaveBeenCalledWith({ verb: "add-live-note", groupId: "g", taskId: "b", expectedRevision: value.summary.commandRevision, payload: { text: "read before coding" } });
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
  expect(items()).toEqual(["one (queued — waiting for a later phase or attempt (not this call))", "two (delivered at execute (attempt 2))", "three (not delivered — added to the task's handoff)"]);
  rerender(<LiveNoteList notes={notes.slice(0, 1)} running={false} />);
  expect(items()).toEqual(["one (queued — waiting for the next phase, attempt or continuation)"]);
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
const box = (onCommand = vi.fn(async (_action: unknown) => 7)) => {
  render(<LiveNoteBox view={running()} taskId="a" archived={false} onCommand={onCommand} />);
  const area = screen.getByRole("textbox", { name: "Note for the agent" }) as HTMLTextAreaElement;
  return { onCommand, area };
};

// mutation M-I1a: drop the Enter handler -> Enter never sends, red
it("sends once on Enter and clears the box after confirmation", async () => {
  const { onCommand, area } = box();
  fireEvent.change(area, { target: { value: "use v2" } });
  const notCancelled = fireEvent.keyDown(area, { key: "Enter", code: "Enter" });
  expect(notCancelled).toBe(false);
  expect(onCommand).toHaveBeenCalledTimes(1);
  expect(onCommand.mock.calls[0]?.[0]).toMatchObject({ verb: "add-live-note", taskId: "a", payload: { text: "use v2" } });
  await act(async () => { await onCommand.mock.results[0]!.value; });
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
