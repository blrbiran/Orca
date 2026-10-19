// @vitest-environment jsdom
/**
 * Debug task plan Task 13 (controller rulings C10-C12, Task 7, withdraw Amendment items 3 and 5): the Corrections tab
 * offers what the server would accept for each correction -- Open for one with no debug group (expected revision 0),
 * Reopen once the newest is stopped or archived, Close by hand, and nothing for a withdrawn one -- and a failure says what
 * happened with a Retry that replays the SAME command only when the answer was lost (a booked refusal would replay
 * forever, so its Retry is a new command). The group view labels a debug group and shows 未复现 with its reason.
 * Fake fetch only (Rule 17).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { CorrectionListItemV1, GroupViewV1 } from "../src/controlTypes.js";
import { CorrectionsView } from "../src/CorrectionsView.js";
import i18n from "../src/i18n.js";
import { config, run, view, workItem } from "./fixtures/board.js";

const OPEN = "c_00000000000000a1", WITHDRAWN = "c_00000000000000b2", STOPPED = "c_00000000000000c3", LIVE = "c_00000000000000d4", PENDING = "c_00000000000000e5";
const item = (id: string, over: Partial<CorrectionListItemV1> = {}): CorrectionListItemV1 => ({
  correction: { id, projectKey: "git@x:p.git", decisionId: `run-${id}/1`, kind: "wrong", because: `because of ${id}`, at: "2026-10-18T02:00:00.000Z", by: "amy" },
  repoId: "repo", debugGroups: [], closed: { state: "open" }, closing: null, withdrawn: null, ...over,
});
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const opened = (groupId: string, correctionId: string): Response => json({
  schema: "orca-command-success-v1", commandId: "x", actorId: "web", verb: "correction-debug-open", target: { kind: "group", groupId },
  commandRevision: 1, projectionSeq: 1, effectivePayloadHash: "h", authorityCommandHash: "h", result: { kind: "debug-group-opened", groupId, correctionId, created: true },
});
const refused = (status: number, code: string, message: string): Response => json({ error: { code, message, commandRevision: null } }, status);

type Post = { url: string; body: { commandId: string; expectedRevision: number; payload: Record<string, unknown> } };
let list: CorrectionListItemV1[];
let posts: Post[];
let listReads: number;
/** What the next POST answers; a thrown error is a lost answer (sendControlCommand: uncertain). */
let answers: Array<(post: Post) => Response>;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  list = [];
  posts = [];
  listReads = 0;
  answers = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "/api/control/corrections" && (init?.method ?? "GET") === "GET") { listReads += 1; return json({ schema: "orca-correction-list-v1", corrections: list }); }
    if (init?.method === "POST") {
      const post = { url, body: JSON.parse(String(init.body)) as Post["body"] };
      posts.push(post);
      const next = answers.shift();
      if (next === undefined) throw new Error(`no answer for ${url}`);
      return next(post);
    }
    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rowOf = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-correction-id="${id}"]`)!;
const shown = async (id: string): Promise<HTMLElement> => { await waitFor(() => expect(rowOf(id)).not.toBeNull()); return rowOf(id); };
const lost = (): never => { throw new TypeError("network down"); };

describe("the Corrections list (Task 13)", () => {
  it("lists corrections without a debug group with an Open button, and a withdrawn one with who and when but no action", async () => {
    list = [item(OPEN), item(WITHDRAWN, { withdrawn: { by: "bob", at: "2026-10-18T05:00:00.000Z" } })];
    render(<CorrectionsView active />);
    const row = await shown(OPEN);
    // Withdraw Amendment items 3, 5: withdrawn, with who and when, and no Open, Close or Withdraw.
    const withdrawn = rowOf(WITHDRAWN);
    expect(within(withdrawn).getByTestId("correction-state").textContent).toBe("Withdrawn by bob at 2026-10-18T05:00:00.000Z");
    expect(withdrawn.classList.contains("correction-withdrawn")).toBe(true);
    // mutation: offer the actions on a withdrawn correction too -> red here
    expect(within(withdrawn).queryAllByRole("button")).toEqual([]);
    expect(within(row).getByTestId("correction-state").textContent).toBe("Open");
    // mutation M-13.2: hide Open when debugGroups is empty -> red here
    const open = within(row).getByRole("button", { name: "Open debug group" });
    expect(within(row).queryByRole("button", { name: "Reopen debug group" })).toBeNull();
    answers.push(() => opened(`debug-${OPEN}`, OPEN));
    const readsBefore = listReads;
    list = [item(OPEN, { debugGroups: [{ groupId: `debug-${OPEN}`, ordinal: 1, live: true, state: "draft" }] }), list[1]!];
    fireEvent.click(open);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toBe(`/api/control/corrections/${OPEN}/debug-group`);
    expect(posts[0]!.body.expectedRevision).toBe(0);
    expect(posts[0]!.body.payload).toEqual({ correctionId: OPEN });
    expect(await within(rowOf(OPEN)).findByText(`Debug group debug-${OPEN} opened.`)).toBeTruthy();
    // The list is read again, so the new group shows and Open is gone (a live group is not reopened).
    await waitFor(() => expect(listReads).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(rowOf(OPEN).querySelector(`[data-group-id="debug-${OPEN}"]`)).not.toBeNull());
    expect(within(rowOf(OPEN)).queryByRole("button", { name: "Open debug group" })).toBeNull();
    expect(within(rowOf(OPEN)).queryByRole("button", { name: "Reopen debug group" })).toBeNull();
  });

  it("a stopped or archived debug group shows Reopen, which sends reopen: true at revision 0", async () => {
    list = [
      item(STOPPED, { debugGroups: [{ groupId: `debug-${STOPPED}`, ordinal: 1, live: false, state: "ready" }] }),
      item(LIVE, { debugGroups: [{ groupId: `debug-${LIVE}`, ordinal: 1, live: true, state: "running" }] }),
    ];
    render(<CorrectionsView active />);
    const row = await shown(STOPPED);
    expect(within(row).queryByRole("button", { name: "Open debug group" })).toBeNull();
    expect(within(rowOf(LIVE)).queryByRole("button", { name: "Reopen debug group" })).toBeNull();
    answers.push(() => opened(`debug-${STOPPED}-2`, STOPPED));
    fireEvent.click(within(row).getByRole("button", { name: "Reopen debug group" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toBe(`/api/control/corrections/${STOPPED}/debug-group`);
    expect(posts[0]!.body.expectedRevision).toBe(0);
    expect(posts[0]!.body.payload).toEqual({ correctionId: STOPPED, reopen: true });
  });

  it("a failed open keeps the correction and shows the error in Chinese with Retry, a new command after a booked refusal", async () => {
    await i18n.changeLanguage("zh");
    list = [item(OPEN)];
    render(<CorrectionsView active />);
    const row = await shown(OPEN);
    answers.push(() => refused(404, "correction-repository-unknown", "correction-repository-unknown:git@x:p.git"));
    fireEvent.click(within(row).getByRole("button", { name: "开启调试组" }));
    const notice = await within(rowOf(OPEN)).findByTestId("correction-refusal");
    expect(notice.querySelector("p")?.textContent).toBe("这个面板管理的仓库里没有属于这条纠正所在项目（git@x:p.git）的。");
    expect(rowOf(OPEN)).not.toBeNull();
    expect(within(rowOf(OPEN)).getByTestId("correction-state").textContent).toBe("未关闭");
    answers.push(() => opened(`debug-${OPEN}`, OPEN));
    fireEvent.click(within(rowOf(OPEN)).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.body.payload).toEqual(posts[0]!.body.payload);
    // Ruling 3 (M-13.1, inverted): the refusal is booked under the first id and would replay forever -> red here if reused.
    expect(posts[1]!.body.commandId).not.toBe(posts[0]!.body.commandId);
    expect(await within(rowOf(OPEN)).findByText(`调试组 debug-${OPEN} 已开启。`)).toBeTruthy();
  });

  it("a lost answer is retried under the same command id, so the ledger replays it instead of opening twice", async () => {
    list = [item(OPEN)];
    render(<CorrectionsView active />);
    const row = await shown(OPEN);
    answers.push(lost);
    fireEvent.click(within(row).getByRole("button", { name: "Open debug group" }));
    expect(await within(rowOf(OPEN)).findByText(/The answer was lost/)).toBeTruthy();
    answers.push(() => opened(`debug-${OPEN}`, OPEN));
    fireEvent.click(within(rowOf(OPEN)).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    // Ruling 3: a fresh id after a transport failure -> red here.
    expect(posts[1]!.body).toEqual(posts[0]!.body);
  });

  it("an open refused for want of checks asks for them and resends the open with them, under a new id", async () => {
    list = [item(OPEN)];
    render(<CorrectionsView active />);
    const row = await shown(OPEN);
    answers.push(() => refused(409, "debug-checks-required", "debug-checks-required"));
    fireEvent.click(within(row).getByRole("button", { name: "Open debug group" }));
    // mutation: offer a plain Retry here instead of the checks input -> red here
    const box = await within(rowOf(OPEN)).findByRole("textbox", { name: "Checks the debug task is held to" });
    expect(within(rowOf(OPEN)).queryByTestId("attempt-retry")).toBeNull();
    const send = within(rowOf(OPEN)).getByRole("button", { name: "Open with these checks" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "npm test\n\n  npx vitest run tests/a.test.ts  \n" } });
    answers.push(() => opened(`debug-${OPEN}`, OPEN));
    fireEvent.click(send);
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.body.payload).toEqual({ correctionId: OPEN, checks: ["npm test", "npx vitest run tests/a.test.ts"] });
    expect(posts[1]!.body.commandId).not.toBe(posts[0]!.body.commandId);
  });

  it("close by hand sends the form (blank optional boxes left out) and shows the stop-first hint on debug-group-active", async () => {
    const pending = item(PENDING, { debugGroups: [] });
    const { decisionId: _decisionId, ...target } = pending.correction;
    list = [
      item(LIVE, { debugGroups: [{ groupId: `debug-${LIVE}`, ordinal: 1, live: true, state: "running" }] }),
      { ...pending, correction: { ...target, runId: "run-9", pendingId: "pending-run-9-0" } },
    ];
    render(<CorrectionsView active />);
    const row = await shown(LIVE);
    // Task 11, cross-plan 2: a pending-target correction can be closed by hand too.
    expect(within(rowOf(PENDING)).getByText("On refused decision pending-run-9-0 of run run-9")).toBeTruthy();
    expect(within(rowOf(PENDING)).getByRole("button", { name: "Close by hand" })).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: "Close by hand" }));
    const form = rowOf(LIVE).querySelector<HTMLFormElement>("form.close-form")!;
    expect(form.querySelector<HTMLInputElement>('input[name="undoHow"]')!.required).toBe(true);
    fireEvent.change(form.querySelector('input[name="undoHow"]')!, { target: { value: "git revert --no-edit abc" } });
    fireEvent.change(form.querySelector('input[name="undoCost"]')!, { target: { value: "one commit" } });
    answers.push(() => refused(409, "debug-group-active", `debug-group-active:debug-${LIVE}`));
    fireEvent.submit(form);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toBe(`/api/control/corrections/${LIVE}/close`);
    expect(posts[0]!.body.expectedRevision).toBe(0);
    expect(posts[0]!.body.payload).toEqual({ correctionId: LIVE, undoHow: "git revert --no-edit abc", undoCost: "one commit" });
    // mutation: no hint for debug-group-active -> red here
    const hint = await within(rowOf(LIVE)).findByTestId("stop-first-hint");
    expect(hint.textContent).toBe(`A live debug group holds this correction (debug-${LIVE}). Archive it if it is still a draft, or stop it; then close by hand.`);
    expect(within(rowOf(LIVE)).getByTestId("correction-refusal").querySelector("code")?.textContent).toBe("debug-group-active");
  });

  it("names the groups the refusal gives when the list it read shows none live (the stop-first hint's fallback)", async () => {
    list = [item(STOPPED, { debugGroups: [{ groupId: `debug-${STOPPED}`, ordinal: 1, live: false, state: "ready" }] })];
    render(<CorrectionsView active />);
    const row = await shown(STOPPED);
    fireEvent.click(within(row).getByRole("button", { name: "Close by hand" }));
    const form = rowOf(STOPPED).querySelector<HTMLFormElement>("form.close-form")!;
    fireEvent.change(form.querySelector('input[name="undoHow"]')!, { target: { value: "git revert --no-edit abc" } });
    answers.push(() => refused(409, "debug-group-active", `debug-group-active:debug-${STOPPED}-2`));
    fireEvent.submit(form);
    // mutation M-13.14: no fallback to the refusal's groups -> "()" here, red
    const hint = await within(rowOf(STOPPED)).findByTestId("stop-first-hint");
    expect(hint.textContent).toBe(`A live debug group holds this correction (debug-${STOPPED}-2). Archive it if it is still a draft, or stop it; then close by hand.`);
  });
});

const debugView = (): GroupViewV1 => {
  const base = view([workItem({ taskId: "a", status: "active", currentRunId: "run-2", lineageRunIds: ["run-1", "run-2"] })], [
    run({ runId: "run-1", state: "landed", createdOrdinal: 1, debugRepro: { state: "skipped", reason: "a naming taste is not testable" } }),
    run({ runId: "run-2", state: "running", createdOrdinal: 2, debugRepro: { state: "checking" } }),
  ]);
  return {
    ...base,
    summary: {
      ...base.summary,
      debug: {
        correctionId: OPEN, ordinal: 2, missing: ["objects", "contract"], agentFallback: { reason: "gone is not installed" },
        checks: { from: "original+named", namedBy: "human" }, closing: { state: "refused", reason: "ledger-conflict" },
      },
    },
  };
};

describe("a debug group in its group view (Task 13)", () => {
  it("labels the group, says what its frozen input lacks, why the agent fell back, where its checks came from, and shows 未复现 with its reason", async () => {
    await act(async () => { await i18n.changeLanguage("zh"); });
    render(<ControlGroupView view={debugView()} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByTestId("debug-badge").textContent).toBe("调试 #2");
    expect(screen.getByTestId("debug-badge").getAttribute("data-tone")).toBe("info");
    expect(screen.getByTestId("debug-mark").textContent).toContain(`为纠正 ${OPEN} 开启。`);
    expect(screen.getByTestId("debug-input").textContent).toBe("冻结的输入缺少：git 对象、原合同。");
    expect(screen.getByTestId("debug-fallback").textContent).toBe("没有使用原来的 agent：gone is not installed");
    expect(screen.getByTestId("debug-checks").textContent).toBe("检查：原合同的，加上人指定的。");
    expect(screen.getByTestId("debug-closing").textContent).toBe("调试运行落地时没能关闭它：ledger-conflict。");
    const repro = [...document.querySelectorAll('tr[data-run-id] [data-testid="debug-repro"]')].map((node) => node.textContent);
    // mutation: drop the run's debugRepro from the Runs table -> red here
    expect(repro).toEqual(["未复现：a naming taste is not testable", "正在进行先复现检查。"]);
  });

  it("a group no correction opened carries no debug mark", () => {
    const plain = view([workItem({ taskId: "a" })], [run({ runId: "run-1" })]);
    render(<ControlGroupView view={plain} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.queryByTestId("debug-mark")).toBeNull();
    expect(screen.queryByTestId("debug-repro")).toBeNull();
  });
});
