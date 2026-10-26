// @vitest-environment jsdom
/**
 * Flow engine spec §14.1, §7.4, §9, §16.2, §21 C17 display half (plan Task 16): the flow run page. It shows the server's
 * run as it is -- steps in template order with state, the reasons each execution ran, red flags and ccloop's tool-rule
 * report row by row (a rule ccloop could not enforce is red: shown as anything else, a person would trust a guard that
 * does not exist) -- and every act on the run is one flow verb the person sends: feedback and edits, run commands, the
 * re-run plan with the model's proposed skips the person can overrule, answers, confirm cards, enact / discard, the pool.
 * The human-only verbs are not offered to someone who may not send them (§14.2).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import type { FlowExecutionViewV1, FlowIntakeV1, FlowJournalV1, FlowRunViewV1, FlowSpendV1, FlowToolRulesReportV1, RoundBodyV1 } from "../src/controlTypes.js";
import { FlowRunPage, spendText } from "../src/FlowRunPage.js";
import i18n from "../src/i18n.js";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); answerWith = () => ({ schema: "orca-command-success-v1" }); laterViews = []; journals = []; uploadFails = false; });
const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const as = (me: Me, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;
const RUN = "fr-00000000-0000-4000-8000-000000000001";

const REPORT: FlowToolRulesReportV1 = { schema: "ccloop-tool-rules-report-v1", agentKind: "omp", baseline: "b", rules: [
  { rule: { kind: "exact", value: "npm test" }, status: "enforced", reason: null, phases: ["execute"] },
  { rule: { kind: "prefix", value: "md2wechat" }, status: "detected", reason: null, phases: ["execute"] },
  { rule: { kind: "commands-closed" }, status: "recorded-only", reason: null, phases: ["execute"] },
  { rule: { kind: "network", value: false }, status: "recorded-only", reason: null, phases: ["execute"] },
  { rule: { kind: "prefix", value: "bun x" }, status: "refused", reason: "not expressible", phases: ["execute"] },
  { rule: { kind: "secretEnv", name: "WECHAT_SECRET" }, status: "recorded-only", reason: null, phases: ["execute"], present: false },
] };
const spent = (tokens: number | null, unknownReason: string | null = null): FlowSpendV1 => ({ tokens, unknownReason, usd: null, usdReason: "the tool reports no money amount", runs: [] });
const exec = (seq: number, over: Partial<FlowExecutionViewV1> = {}): FlowExecutionViewV1 => ({
  seq, state: "done", reasons: ["never-succeeded"], planNo: null, childGroupId: null, by: "orca-auto", via: "orca", flags: [], failure: null,
  output: { kind: "commit", ref: "c".repeat(40), hash: "h".repeat(64) }, toolRules: null, ask: null, needsYou: null, reported: null, warnings: [], effectRecordId: null, spend: spent(1200), ...over,
});
const step = (stepKey: string, kind: string, executions: FlowExecutionViewV1[], over: Partial<FlowRunViewV1["steps"][number]> = {}): FlowRunViewV1["steps"][number] => ({
  stepKey, kind, head: executions.filter((e) => e.state === "done").at(-1)?.seq ?? null, executor: null, parallelWith: null, effect: null,
  latest: executions.at(-1) ?? null, executions, clarify: null, clarifyRevision: null, mark: null, heldBy: [], deferHolds: [], whenParams: [], spend: spent(1200), ...over,
});
const policy = { value: "confirm" as const, source: "project" as const, lockedBy: null };
const CONFIRM_ASK = { kind: "effect-confirm" as const, recordId: "eff-00000000-0000-4000-8000-00000000000a", stepKey: "to-draft-box", effectKind: "wechat-draft", class: "external", policy, summary: "title: Tea, slowly" };
const PICK_ASK = { kind: "ask" as const, form: { title: { type: "text" } }, candidates: { title: ["Tea, slowly", "Slow tea", "Tea for engineers"] }, defaults: { title: "Tea, slowly" }, freeText: true };

function runView(over: Partial<FlowRunViewV1> = {}): FlowRunViewV1 {
  return {
    schema: "orca-flow-run-view-v1", flowRunId: RUN, groupId: "flow-g", templateRef: "builtin/wechat-article@1", state: "running",
    params: { idea: "Tea" }, poolTokens: 2_000_000, poolDrawn: 750_000, by: "olga", via: "web", dir: "/home/o/tea", scheduled: null, lastError: null,
    template: { id: "wechat-article", version: 1, title: { en: "WeChat article", zh: "公众号文章" } },
    steps: [
      step("brief", "clarify", [exec(1, { output: { kind: "artifact", ref: "a".repeat(64), hash: "b".repeat(64) } })]),
      step("outline", "work", [
        exec(1, { state: "failed", failure: "gate-failed", output: null, flags: ["tool-rule:refused"] }),
        exec(2, { childGroupId: "flow-c-2", reasons: ["feedback"], toolRules: REPORT, flags: ["tool-rule:detected", "tool-rule:recorded-only", "tool-rule:refused"] }),
      ]),
      step("voice", "work", [exec(1)]),
      step("pick-title", "ask", [exec(1, { state: "needs-person", output: null, ask: PICK_ASK })], { executor: "either" }),
      step("cover", "work", [exec(1, { state: "staged", output: null, effectRecordId: "eff-00000000-0000-4000-8000-00000000000b" })], { effect: { kind: "image-generate", class: "cost" }, parallelWith: "article" }),
      step("to-draft-box", "work", [exec(1, { state: "needs-person", output: null, ask: CONFIRM_ASK })], { effect: { kind: "wechat-draft", class: "external" } }),
    ],
    openAsks: [{ stepKey: "pick-title", seq: 1, ask: PICK_ASK }, { stepKey: "to-draft-box", seq: 1, ask: CONFIRM_ASK }],
    plans: [{
      flowRunId: RUN, planNo: 1, state: "proposed",
      candidates: { list: [{ stepKey: "voice", reasons: ["feedback"] }, { stepKey: "pick-title", reasons: ["upstream-changed:voice"] }, { stepKey: "cover", reasons: ["upstream-changed:voice"] }], feedback: { voice: ["warmer"] }, edits: [], trigger: "feedback" },
      proposal: { retries: 0, lastInvalid: null, skips: [{ stepKey: "cover", reason: "the cover does not depend on the wording" }], exhausted: null },
      chosen: null, by: "olga", via: "web", spend: spent(300),
    }],
    intakes: [], spend: spent(9000),
    effects: [
      { id: "eff-00000000-0000-4000-8000-00000000000a", flowRunId: RUN, stepKey: "to-draft-box", seq: 1, effectKind: "wechat-draft", class: "external", level: "confirm", policy, state: "staged", payloadHash: "p", remoteRef: null, by: "orca-auto", via: "orca", createdAt: 1, updatedAt: 1 },
      { id: "eff-00000000-0000-4000-8000-00000000000b", flowRunId: RUN, stepKey: "cover", seq: 1, effectKind: "image-generate", class: "cost", level: "stage-only", policy: { value: "stage-only", source: "global", lockedBy: "global" }, state: "staged", payloadHash: "p", remoteRef: null, by: "orca-auto", via: "orca", createdAt: 2, updatedAt: 2 },
      { id: "eff-00000000-0000-4000-8000-00000000000c", flowRunId: RUN, stepKey: "voice", seq: 1, effectKind: "wechat-draft", class: "external", level: "apply-flag", policy: { value: "apply-flag", source: "builtin", lockedBy: null }, state: "applied", payloadHash: "p", remoteRef: "media-123", by: "orca-auto", via: "orca", createdAt: 3, updatedAt: 3 },
    ],
    decisions: [
      { seq: 1, grade: "major", stepKey: "outline", body: { kind: "outline-shape", text: "three parts" }, by: "agent" },
      { seq: 2, grade: "minor", stepKey: null, body: { kind: "rerun-skip", stepKey: "cover" }, by: "orca-auto" },
    ],
    ...over,
  };
}
const JOURNAL: FlowJournalV1 = { schema: "orca-flow-journal-v1", flowRunId: RUN, messages: [
  { flowRunId: RUN, seq: 1, requestId: "r1", kind: "feedback", target: "step", body: { text: "warmer, please", target: { kind: "step", stepKey: "voice" } }, by: "olga", via: "web", state: "applied", reason: null, at: 1 },
  { flowRunId: RUN, seq: 2, requestId: "r2", kind: "command", target: "run", body: { command: "budget", target: { kind: "run" } }, by: "agent-1", via: "socket", state: "rejected", reason: "flow-command-budget", at: 2 },
] };

let posts: Array<{ url: string; body: { expectedRevision: number; payload: Record<string, unknown> } }>;
let reads: string[];
/** Gaps spec §4.7: the attachment uploads (raw bytes, one per screenshot), in order. */
let uploads: Array<{ url: string; type: string | null; name: string }>;
/** What a command POST answers (default: a plain success); a test may answer a flow message as stored `rejected`. */
let answerWith: (url: string) => unknown = () => ({ schema: "orca-command-success-v1" });
/** Fix round 1: the view the server holds after the n-th POST (the last one stays), the journal at the n-th journal read. */
let laterViews: FlowRunViewV1[] = [];
let journals: FlowJournalV1[] = [];
let uploadFails = false;
function serve(view: FlowRunViewV1 = runView()): void {
  posts = []; reads = []; uploads = [];
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if ((init?.method ?? "GET") === "POST" && url.endsWith("/attachments")) {
      const file = init!.body as File;
      uploads.push({ url, type: new Headers(init!.headers).get("content-type"), name: file.name });
      if (uploadFails) return new Response(JSON.stringify({ error: { code: "flow-attachment-invalid", message: "flow-attachment-invalid:larger than 5242880 bytes" } }), { status: 400 });
      return new Response(JSON.stringify({ schema: "orca-flow-attachment-v1", id: `${"a".repeat(63)}${uploads.length}.png` }), { status: 200 });
    }
    if ((init?.method ?? "GET") === "POST") { posts.push({ url, body: JSON.parse(String(init!.body)) }); return new Response(JSON.stringify(answerWith(url)), { status: 200 }); }
    reads.push(url);
    // Plan Task 10-B: the folder's images, for an image param's picker.
    if (url.startsWith("/api/control/flows/images?")) return new Response(JSON.stringify({ schema: "orca-flow-folder-images-v1", dir: "/home/o/tea", files: ["covers/a.png", "covers/tea.png"], truncated: false, limit: 200 }), { status: 200 });
    const views = [view, ...laterViews];
    const journalReads = reads.filter((r) => r.endsWith("/journal")).length;
    const journal = journals.length === 0 ? JOURNAL : journals[Math.min(journalReads - 1, journals.length - 1)]!;
    return new Response(JSON.stringify(url.endsWith("/journal") ? journal : views[Math.min(posts.length, views.length - 1)]), { status: 200 });
  }) as typeof fetch;
}
const mount = async (me: Me = owner, view?: FlowRunViewV1): Promise<void> => {
  serve(view);
  render(as(me, <FlowRunPage flowRunId={RUN} />));
  await waitFor(() => expect(screen.getByTestId("flow-run-state")).toBeTruthy());
};
const stepBox = (key: string): HTMLElement => screen.getByTestId(`flow-step-${key}`);
const lastPost = () => posts.at(-1)!;

describe("the run's steps (§14.1)", () => {
  beforeEach(() => undefined);

  it("lists steps in template order with their state, the active execution, why it ran and its red flags", async () => {
    await mount();
    expect(reads).toContain(`/api/control/flows/${RUN}`);
    expect(screen.getAllByTestId(/^flow-step-(?!state)/).map((s) => s.getAttribute("data-testid"))).toEqual(
      ["flow-step-brief", "flow-step-outline", "flow-step-voice", "flow-step-pick-title", "flow-step-cover", "flow-step-to-draft-box"]);
    const outline = stepBox("outline");
    expect(within(outline).getByTestId("flow-step-state").textContent).toBe("done");
    expect(outline.textContent).toContain("Why it ran: feedback");
    expect(outline.textContent).toContain("Child group flow-c-2");
    expect(within(within(outline).getByTestId("flow-execution-2")).getAllByTestId("flow-flag").map((f) => [f.textContent, f.getAttribute("data-tone")])).toEqual(
      [["tool-rule:detected", "danger"], ["tool-rule:recorded-only", "danger"], ["tool-rule:refused", "danger"]]);
    expect(within(stepBox("pick-title")).getByTestId("flow-step-state").textContent).toBe("needs you");
    // The earlier, failed execution stays readable (history), folded.
    expect(within(outline).getByText("1 earlier execution").closest("details")!.open).toBe(false);
    expect(within(outline).getByTestId("flow-execution-1").textContent).toContain("Failed: gate-failed");
  });

  it("shows each tool rule's status as ccloop reported it; detected, recorded-only network, refused and a missing secret are red", async () => {
    await mount();
    const rows = within(within(stepBox("outline")).getByTestId("flow-execution-2")).getAllByTestId("flow-tool-rule");
    // mutation: render `detected` as `enforced` -> the second row reads "enforced", red
    expect(rows.map((r) => within(r).getByTestId("flow-tool-rule-status").textContent)).toEqual(
      ["enforced", "detected", "recorded-only", "recorded-only", "refused", "recorded-only · not present on this machine"]);
    // mutation: drop the network clause of ruleIsRed -> the network row loses its tone, red
    expect(rows.map((r) => r.getAttribute("data-tone"))).toEqual([null, "danger", null, "danger", "danger", "danger"]);
  });

  it("says publishing is the person's click in the WeChat backend, on the article flow only", async () => {
    await mount();
    expect(screen.getByTestId("flow-publish-note").textContent).toContain("Publishing is your own click in the WeChat backend");
    cleanup();
    await mount(owner, runView({ template: { id: "other", version: 1, title: null } }));
    expect(screen.queryByTestId("flow-publish-note")).toBeNull();
  });
});

describe("the re-run plan (§7.4)", () => {
  it("ticks the candidates, leaves the model's proposed skips unticked with their reasons, and runs the person's choice", async () => {
    await mount();
    const plan = screen.getByRole("region", { name: "Re-run plan 1" });
    const box = (key: string) => within(within(plan).getByTestId(`flow-plan-${key}`)).getByRole("checkbox") as HTMLInputElement;
    expect([box("voice").checked, box("pick-title").checked, box("cover").checked]).toEqual([true, true, false]);
    expect(within(plan).getByTestId("flow-plan-cover").textContent).toContain("The model proposes to skip it: the cover does not depend on the wording");
    // The person unticks pick-title too, and adds a non-candidate.
    fireEvent.click(box("pick-title"));
    fireEvent.click(within(plan).getByRole("checkbox", { name: "outline" }));
    fireEvent.click(within(plan).getByRole("button", { name: "Run these steps" }));
    await waitFor(() => expect(posts.length).toBe(1));
    // mutation: send the model's skips instead of the person's ticks -> skip ["cover"], red
    expect(lastPost()).toEqual({ url: "/api/control/flows/rerun", body: expect.objectContaining({ expectedRevision: 0, payload: { runId: RUN, planNo: 1, skip: ["pick-title", "cover"], add: ["outline"] } }) });
  });

  // T18 enact: the person withdraws a plan they do not want run (its feedback is excluded server side).
  it("discards the plan instead of running it", async () => {
    await mount();
    const plan = screen.getByRole("region", { name: "Re-run plan 1" });
    fireEvent.click(within(plan).getByRole("button", { name: "Discard this plan" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost()).toEqual({ url: "/api/control/flows/rerun", body: expect.objectContaining({ expectedRevision: 0, payload: { runId: RUN, planNo: 1, discard: true } }) });
  });
});

describe("asks, confirm cards and effect records (§4.4, §9)", () => {
  it("answers an ask from its candidates", async () => {
    await mount();
    const form = within(stepBox("pick-title")).getByRole("form", { name: "Answer pick-title" });
    fireEvent.click(within(form).getByRole("radio", { name: "Slow tea" }));
    fireEvent.click(within(form).getByRole("button", { name: "Send the answer" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().url).toBe("/api/control/flows/answer");
    expect(lastPost().body.payload).toEqual({ runId: RUN, stepKey: "pick-title", values: { title: "Slow tea" } });
  });

  it("shows a confirm card with the level's provenance and confirms it", async () => {
    await mount();
    const card = screen.getByRole("group", { name: "Confirm to-draft-box" });
    expect(within(card).getByTestId("flow-policy").textContent).toBe("level confirm, from this project");
    fireEvent.click(within(card).getByRole("button", { name: "Confirm and run" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost()).toEqual({ url: "/api/control/flows/effect", body: expect.objectContaining({ payload: { recordId: CONFIRM_ASK.recordId, action: "confirm" } }) });
  });

  it("enacts or discards a staged record, and flags an applied one with its remote id", async () => {
    await mount();
    const staged = screen.getByTestId("flow-effect-eff-00000000-0000-4000-8000-00000000000b");
    expect(within(staged).getByTestId("flow-policy").textContent).toBe("level stage-only, from global settings · locked");
    fireEvent.click(within(staged).getByRole("button", { name: "Enact" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toEqual({ recordId: "eff-00000000-0000-4000-8000-00000000000b", action: "enact" });
    fireEvent.click(within(screen.getByTestId("flow-effect-eff-00000000-0000-4000-8000-00000000000b")).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(lastPost().body.payload).toEqual({ recordId: "eff-00000000-0000-4000-8000-00000000000b", action: "discard" });
    const applied = screen.getByTestId("flow-effect-eff-00000000-0000-4000-8000-00000000000c");
    expect(within(applied).getByTestId("flow-remote-id").textContent).toBe("remote id media-123");
    expect(within(applied).getByText("applied").getAttribute("data-tone")).toBe("danger");
    // A confirm card's record is confirmed from the card, not enacted from the list.
    expect(within(screen.getByTestId("flow-effect-eff-00000000-0000-4000-8000-00000000000a")).queryByRole("button")).toBeNull();
  });
});

describe("messages, run commands and the pool (§8, §6.3)", () => {
  it("shows the stream with refusals and sends feedback on a step or one execution", async () => {
    await mount();
    await waitFor(() => expect(screen.getAllByTestId("flow-message")).toHaveLength(2));
    const [first, second] = screen.getAllByTestId("flow-message");
    expect(first!.textContent).toContain("feedback · voice · warmer, please · by olga via web · applied");
    expect(second!.getAttribute("data-tone")).toBe("danger");
    expect(second!.textContent).toContain("refused (flow-command-budget)");
    const box = within(stepBox("outline")).getByRole("form", { name: "Message about outline" });
    fireEvent.change(within(box).getByRole("combobox", { name: "About" }), { target: { value: "2" } });
    fireEvent.change(within(box).getByRole("textbox", { name: "Your feedback" }), { target: { value: "shorter" } });
    fireEvent.click(within(box).getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost()).toEqual({ url: "/api/control/flows/messages", body: expect.objectContaining({ payload: { runId: RUN, kind: "feedback", target: { kind: "execution", stepKey: "outline", seq: 2 }, body: { text: "shorter" } } }) });
  });

  it("edits a step's record as the person's own output", async () => {
    await mount();
    const box = within(stepBox("brief")).getByRole("form", { name: "Message about brief" });
    fireEvent.change(within(box).getByRole("combobox", { name: "Message kind" }), { target: { value: "edit-record" } });
    fireEvent.change(within(box).getByRole("textbox", { name: "Fields, one field=value per line" }), { target: { value: "title = Tea, slowly\n" } });
    fireEvent.click(within(box).getByRole("button", { name: "Save as my output" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "edit", target: { kind: "step", stepKey: "brief" }, body: { record: { title: "Tea, slowly" } } });
  });

  it("pauses, rewinds and raises the pool, showing only the pool and what was drawn", async () => {
    await mount();
    expect(screen.getByTestId("flow-pool").textContent).toBe("Pool: 750K of 2M tokens drawn by steps");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "pause" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Rewind to step or step#n" }), { target: { value: "voice#1" } });
    fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "rewind", toStep: "voice", toSeq: 1 } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Tokens to add to the pool" }), { target: { value: "500000" } });
    fireEvent.click(screen.getByRole("button", { name: "Raise the pool" }));
    await waitFor(() => expect(posts.length).toBe(3));
    expect(lastPost()).toEqual({ url: "/api/control/flows/pool", body: expect.objectContaining({ payload: { runId: RUN, raiseTokens: 500_000 } }) });
  });

  it("shows major decisions and folds the minor ones (P5)", async () => {
    await mount();
    expect(screen.getAllByTestId("flow-decision").map((d) => d.textContent)).toEqual([expect.stringContaining("major")]);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show 1 minor decision" }));
    expect(screen.getAllByTestId("flow-decision")).toHaveLength(2);
  });

  it("shows the last pass's diagnostic", async () => {
    await mount(owner, runView({ lastError: { message: "flow-pause-stop-incomplete:voice:handoff-partial", at: 7 } }));
    const alert = screen.getByTestId("flow-last-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.getAttribute("data-tone")).toBe("danger");
    expect(alert.textContent).toBe("The last pass reported a problem: flow-pause-stop-incomplete:voice:handoff-partial. Orca retries when the run advances.");
  });
});

describe("who may act (§14.2)", () => {
  it("offers a member feedback and run commands, but not the human-only answer, re-run, effect or pool acts", async () => {
    await mount(member);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(within(stepBox("voice")).getByRole("button", { name: "Send feedback" })).toBeTruthy();
    // mutation: offer the human-only acts to a member -> these buttons exist, red
    for (const name of ["Run these steps", "Discard this plan", "Confirm and run", "Enact", "Discard", "Send the answer", "Raise the pool"]) expect(screen.queryByRole("button", { name })).toBeNull();
  });
});

describe("a step that asks the person (§4.3, §10)", () => {
  it("answers an agent's question as text, and a clarify round with recommended or own answers", async () => {
    const view = runView();
    const question = { kind: "input" as const, question: "Which tone?", candidates: ["plain", "warm"] };
    const result = { slug: "tea", statement: "An article on tea.", acceptanceCriteria: [], frontierEmpty: false, openBranches: [], glossary: [], adrs: [],
      questions: [{ id: "R1.Q1", key: "reader", question: "Who reads it?", recommendedAnswer: "engineers", why: "the account's readers", dependsOn: [] },
        { id: "R1.Q2", key: "length", question: "How long?", recommendedAnswer: "1500 words", why: "a usual post", dependsOn: [] }] };
    const round = { roundNo: 1, state: "awaiting-answers" as const, retries: 0, lastInvalidReason: null, waiting: null, result, answers: null,
      glossaryDecisions: null, adrDecisions: null, answeredAt: null, closedByConsensus: false, reasonCode: null, calls: [] };
    view.steps = [
      step("brief", "clarify", [exec(1, { state: "needs-person", output: null, ask: { kind: "clarify-round", roundNo: 1 } })], { clarify: { rounds: [round], chain: [1] } }),
      step("article", "work", [exec(1, { state: "needs-person", output: null, ask: question })]),
    ];
    await mount(owner, view);
    const needs = within(stepBox("article")).getByRole("form", { name: "article asks you" });
    fireEvent.click(within(needs).getByRole("button", { name: "warm" }));
    fireEvent.click(within(needs).getByRole("button", { name: "Send the answer" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toEqual({ runId: RUN, stepKey: "article", text: "warm" });
    const clarify = within(stepBox("brief")).getByRole("form", { name: "brief: round 1" });
    fireEvent.change(within(clarify).getByRole("textbox", { name: "R1.Q2: your own answer (empty takes the recommended one)" }), { target: { value: "800 words" } });
    fireEvent.click(within(clarify).getByRole("button", { name: "Send this round" }));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(lastPost().body.payload).toEqual({ runId: RUN, stepKey: "brief", clarify: { roundNo: 1,
      answers: [{ id: "R1.Q1", kind: "recommended" }, { id: "R1.Q2", kind: "text", text: "800 words" }], glossaryDecisions: [], adrDecisions: [] } });
    fireEvent.click(within(stepBox("brief")).getByRole("button", { name: "We agree" }));
    await waitFor(() => expect(posts.length).toBe(3));
    expect(lastPost().body.payload).toEqual({ runId: RUN, stepKey: "brief", consensus: true });
  });
});

/**
 * Gaps spec §14 (G12, plan Task 10-A): the run page surfaces of the phase-1 gaps. Each act is the one flow verb the
 * server takes for it; what the page must never do is guess -- show 0 for a spend the tool did not give, pick a hit for
 * the person, push a held external step on its own, or ask about effects a defer does not hold.
 */
/** A screenshot the feedback carried (fix round 1, I1: every replacement must keep it). */
const SHOT = `${"b".repeat(64)}.png`;
const intake = (over: Partial<FlowIntakeV1> = {}): FlowIntakeV1 => ({
  messageSeq: 7, state: "needs-location", text: "this sentence drags", stepKey: null, anchors: [{ quote: "Tea slows you down" }],
  results: [{ anchor: { quote: "Tea slows you down" }, hits: [
    { file: "tea.md", paragraph: 2, headingPath: ["Why"], excerpt: "Tea slows you down, they say." },
    { file: "tea.md", paragraph: 9, headingPath: [], excerpt: "Tea slows you down again." },
  ], more: 0 }],
  ambiguousFiles: [], targets: [], restated: null, flags: [], planNo: null, asIs: false, attachments: [SHOT], clarify: null, spend: spent(null, "no tool runs"), ...over,
});

describe("feedback on the whole run and its intake (§4, §14.1-§14.2)", () => {
  it("sends run-level feedback with its anchors, the uploaded screenshots' ids and 'use my words as they are'", async () => {
    await mount();
    const box = screen.getByRole("form", { name: "Feedback on the whole run" });
    fireEvent.change(within(box).getByRole("textbox", { name: "Your feedback" }), { target: { value: " too slow here " } });
    fireEvent.change(within(box).getByRole("textbox", { name: "A passage as it reads in the article" }), { target: { value: "Tea slows you down" } });
    fireEvent.change(within(box).getByRole("textbox", { name: "Under the heading" }), { target: { value: "Why" } });
    fireEvent.change(within(box).getByRole("spinbutton", { name: "Paragraph number" }), { target: { value: "2" } });
    const shots = [new File([new Uint8Array([0x89, 0x50])], "one.png", { type: "image/png" }), new File([new Uint8Array([0xff, 0xd8])], "two.jpg", { type: "image/jpeg" })];
    fireEvent.change(within(box).getByLabelText("Screenshots (png, jpg or webp, at most 4)"), { target: { files: shots } });
    fireEvent.click(within(box).getByRole("checkbox", { name: "Use my words as they are" }));
    fireEvent.click(within(box).getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(posts.length).toBe(1));
    // mutation: send the feedback without uploading -> no uploads, no attachments, red
    expect(uploads).toEqual([{ url: `/api/control/flows/${RUN}/attachments`, type: "image/png", name: "one.png" }, { url: `/api/control/flows/${RUN}/attachments`, type: "image/jpeg", name: "two.jpg" }]);
    // mutation: drop the anchors from the body -> red
    expect(lastPost()).toEqual({ url: "/api/control/flows/messages", body: expect.objectContaining({ payload: { runId: RUN, kind: "feedback", target: { kind: "run" }, body: {
      text: "too slow here", anchors: [{ quote: "Tea slows you down" }, { heading: "Why", paragraph: 2 }], attachments: [`${"a".repeat(63)}1.png`, `${"a".repeat(63)}2.png`], asIs: true,
    } } }) });
  });

  it("refuses to send five screenshots, and a step's feedback box carries the same anchors", async () => {
    await mount();
    const box = screen.getByRole("form", { name: "Feedback on the whole run" });
    fireEvent.change(within(box).getByRole("textbox", { name: "Your feedback" }), { target: { value: "x" } });
    fireEvent.change(within(box).getByLabelText("Screenshots (png, jpg or webp, at most 4)"), { target: { files: [1, 2, 3, 4, 5].map((i) => new File(["x"], `${i}.png`, { type: "image/png" })) } });
    expect((within(box).getByRole("button", { name: "Send feedback" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(box).getByRole("status").textContent).toBe("At most 4 screenshots per message.");
    const step = within(stepBox("voice")).getByRole("form", { name: "Message about voice" });
    fireEvent.change(within(step).getByRole("textbox", { name: "Your feedback" }), { target: { value: "warmer" } });
    fireEvent.change(within(step).getByRole("textbox", { name: "A passage as it reads in the article" }), { target: { value: "Tea slows you down" } });
    fireEvent.click(within(step).getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "feedback", target: { kind: "step", stepKey: "voice" }, body: { text: "warmer", anchors: [{ quote: "Tea slows you down" }] } });
    expect(uploads).toEqual([]);
  });

  it("a quote found twice lists both places; 'this one' replaces the message with that hit, never a guess", async () => {
    await mount(owner, runView({ intakes: [intake(), intake({ messageSeq: 3, state: "planned" })] }));
    // Only open intakes have cards.
    expect(screen.queryByTestId("flow-intake-3")).toBeNull();
    const card = screen.getByRole("region", { name: "Feedback #7" });
    expect(within(card).getByText("needs a location").getAttribute("data-tone")).toBe("warn");
    const hits = within(card).getAllByTestId("flow-intake-hit");
    expect(hits.map((h) => h.textContent)).toEqual([expect.stringContaining("tea.md · paragraph 2 · Why"), expect.stringContaining("tea.md · paragraph 9")]);
    expect(posts).toEqual([]);
    fireEvent.click(within(hits[1]!).getByRole("button", { name: "This one" }));
    await waitFor(() => expect(posts.length).toBe(1));
    // mutation: send the hit 0-based -> hit 1, red. The picked hit replaces the anchors; the screenshot stays (I1).
    // mutation: replacement drops attachments -> no `attachments`, red
    expect(lastPost()).toEqual({ url: "/api/control/flows/messages", body: expect.objectContaining({ payload: { runId: RUN, kind: "feedback", target: { kind: "run" }, body: { text: "this sentence drags", replaces: 7, attachments: [SHOT], hit: 2 } } }) });
    fireEvent.click(within(card).getByRole("button", { name: "Rewrite" }));
    const rewrite = within(card).getByRole("form", { name: "Rewrite" });
    fireEvent.change(within(rewrite).getByRole("textbox", { name: "A passage as it reads in the article" }), { target: { value: "they say" } });
    fireEvent.click(within(rewrite).getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "feedback", target: { kind: "run" }, body: { text: "this sentence drags", replaces: 7, attachments: [SHOT], anchors: [{ quote: "they say" }] } });
    expect(within(card).getByTestId("flow-spend").textContent).toBe("Spend: not available (no tool runs) · money: not available — the tool reports none");
  });

  it("a vague intake's clarify round is answered by feedback number; 'use my words' and 'change target' replace it", async () => {
    const clarifying = intake({ state: "clarifying", results: [], targets: [{ stepKey: "voice", why: "the tone" }], flags: ["triage-defaulted"],
      clarify: { roundNo: 1, questions: [{ id: "R1.Q1", question: "What feels wrong?", recommendedAnswer: "too stiff" }] } });
    await mount(owner, runView({ intakes: [clarifying] }));
    const card = screen.getByRole("region", { name: "Feedback #7" });
    expect(within(card).getByTestId("flow-intake-target").textContent).toBe("Goes to voice: the tone");
    expect(within(card).getByTestId("flow-intake-flag").textContent).toBe("triage-defaulted");
    const form = within(card).getByRole("form", { name: "Feedback #7: questions" });
    fireEvent.click(within(form).getByRole("button", { name: "Send this round" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost()).toEqual({ url: "/api/control/flows/answer", body: expect.objectContaining({ payload: { runId: RUN, feedback: 7, clarify: { roundNo: 1, answers: [{ id: "R1.Q1", kind: "recommended" }], glossaryDecisions: [], adrDecisions: [] } } }) });
    fireEvent.click(within(form).getByRole("button", { name: "Use my words as they are" }));
    await waitFor(() => expect(posts.length).toBe(2));
    // I1: the replacement keeps the location and the screenshot; it only adds "as they are".
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "feedback", target: { kind: "run" }, body: { text: "this sentence drags", replaces: 7, attachments: [SHOT], anchors: [{ quote: "Tea slows you down" }], asIs: true } });
    fireEvent.change(within(card).getByRole("combobox", { name: "Change target" }), { target: { value: "outline" } });
    fireEvent.click(within(card).getByRole("button", { name: "Change target" }));
    await waitFor(() => expect(posts.length).toBe(3));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "feedback", target: { kind: "step", stepKey: "outline" }, body: { text: "this sentence drags", replaces: 7, attachments: [SHOT], anchors: [{ quote: "Tea slows you down" }] } });
  });
});

describe("a running plan's questions and accepts (§5, §14.3)", () => {
  const DEADLINE = new Date(2026, 9, 23, 14, 5, 0).getTime();
  const runningPlan = (): FlowRunViewV1["plans"][number] => ({
    flowRunId: RUN, planNo: 2, state: "running", by: "olga", via: "web", spend: spent(null, "partial: 1 runs unknown"),
    candidates: { list: [{ stepKey: "cover", reasons: ["upstream-changed:voice"] }, { stepKey: "outline", reasons: ["feedback"] }], feedback: {}, edits: [], trigger: "feedback" },
    proposal: { retries: 0, lastInvalid: null, skips: [], unsure: [{ stepKey: "cover", question: "Does the new tone change the cover?" }], exhausted: null },
    chosen: { steps: ["outline"], skips: [], added: [],
      pending: [{ stepKey: "cover", question: "Does the new tone change the cover?", askedAt: DEADLINE - 300_000, deadline: DEADLINE, answer: null }],
      accepted: [{ stepKey: "voice", seq: 1, by: "orca-auto", via: "orca", at: 1, source: "timeout" }, { stepKey: "brief", seq: 1, by: "olga", via: "web", at: 1, source: "person" }] },
  });
  const withPlan = () => {
    const view = runView({ plans: [runningPlan()] });
    view.steps[1] = step("outline", "work", [exec(1), exec(2, { planNo: 2 })]);
    return view;
  };

  it("asks the pending question with its deadline and sends 'run it' or 'accept as unchanged' as flow-plan-step", async () => {
    await mount(owner, withPlan());
    const plan = screen.getByRole("region", { name: "Re-run plan 2" });
    const item = within(plan).getByTestId("flow-pending-cover");
    expect(item.textContent).toContain("Does the new tone change the cover?");
    // mutation: show the asked time instead of the deadline -> 14:00, red
    expect(item.textContent).toContain("keeps the current output at 14:05");
    expect(within(item).getByTestId("flow-remaining")).toBeTruthy();
    expect(within(plan).getByTestId("flow-plan-depends").textContent).toContain("the steps after cover depend on it in this template");
    fireEvent.click(within(item).getByRole("button", { name: "Run it" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost()).toEqual({ url: "/api/control/flows/plan-step", body: expect.objectContaining({ expectedRevision: 0, payload: { runId: RUN, planNo: 2, stepKey: "cover", choice: "run" } }) });
    fireEvent.click(within(item).getByRole("button", { name: "Accept as unchanged" }));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(lastPost().body.payload).toEqual({ runId: RUN, planNo: 2, stepKey: "cover", choice: "accept-unchanged" });
    // A step the plan ran may be accepted as unchanged too; accepts made are labelled with who made them.
    fireEvent.click(within(within(plan).getByTestId("flow-plan-ran-outline")).getByRole("button", { name: "Accept as unchanged" }));
    await waitFor(() => expect(posts.length).toBe(3));
    expect(lastPost().body.payload).toEqual({ runId: RUN, planNo: 2, stepKey: "outline", choice: "accept-unchanged" });
    expect(within(plan).getByTestId("flow-plan-accepted-voice").textContent).toBe("voice: accepted as unchanged (by the timeout)");
    expect(within(plan).getByTestId("flow-plan-accepted-brief").textContent).toBe("brief: accepted as unchanged (by you)");
  });

  it("offers a member neither answer (flow-plan-step is the person's)", async () => {
    await mount(member, withPlan());
    const plan = screen.getByRole("region", { name: "Re-run plan 2" });
    expect(within(plan).getByTestId("flow-pending-cover").textContent).toContain("keeps the current output at 14:05");
    expect(within(plan).queryByRole("button", { name: "Run it" })).toBeNull();
    expect(within(plan).queryByRole("button", { name: "Accept as unchanged" })).toBeNull();
  });

  it("a proposed plan under review shows the unsure question beside its ticked candidate", async () => {
    const view = runView();
    view.plans[0]!.proposal!.unsure = [{ stepKey: "pick-title", question: "Does the title still fit?" }];
    await mount(owner, view);
    const plan = screen.getByRole("region", { name: "Re-run plan 1" });
    expect(within(plan).getByTestId("flow-plan-pick-title").textContent).toContain("The model is not sure it needs to run: Does the title still fit?");
    expect((within(within(plan).getByTestId("flow-plan-pick-title")).getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
  });
});

describe("skip, defer, fill and held effects (§6, §14.4)", () => {
  it("defers at once when nothing after it would be held; asks in a dialog, preselected wait, when an external step would be", async () => {
    const view = runView();
    view.steps[2] = step("voice", "work", [exec(1)], { deferHolds: ["to-draft-box"] });
    await mount(owner, view);
    // outline holds nothing (deferHolds empty): no dialog.
    fireEvent.click(within(stepBox("outline")).getByRole("button", { name: "Defer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "step", stepKey: "outline" }, body: { command: "defer" } });
    fireEvent.click(within(stepBox("voice")).getByRole("button", { name: "Defer" }));
    // mutation: never show the defer dialog (send at once) -> no dialog, a second post, red
    const dialog = within(stepBox("voice")).getByRole("dialog", { name: "Defer voice" });
    expect(posts.length).toBe(1);
    expect((within(dialog).getByRole("radio", { name: "Wait" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Defer" }));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "step", stepKey: "voice" }, body: { command: "defer", effects: { "to-draft-box": "wait" } } });
    fireEvent.click(within(stepBox("voice")).getByRole("button", { name: "Defer" }));
    fireEvent.click(within(within(stepBox("voice")).getByRole("dialog")).getByRole("radio", { name: "Go ahead without it" }));
    fireEvent.click(within(within(stepBox("voice")).getByRole("dialog")).getByRole("button", { name: "Defer" }));
    await waitFor(() => expect(posts.length).toBe(3));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "step", stepKey: "voice" }, body: { command: "defer", effects: { "to-draft-box": "proceed" } } });
  });

  it("skips a step, badges a marked one and fills it; a clarify or ask step offers neither", async () => {
    const view = runView();
    view.steps[2] = step("voice", "work", [exec(1), exec(2, { state: "skipped", output: null })], { mark: { kind: "defer", messageSeq: 4, effects: {} } });
    await mount(owner, view);
    fireEvent.click(within(stepBox("outline")).getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "step", stepKey: "outline" }, body: { command: "skip" } });
    expect(within(stepBox("voice")).getByTestId("flow-mark").textContent).toBe("deferred: fill it in when ready");
    expect(within(stepBox("voice")).queryByRole("button", { name: "Skip" })).toBeNull();
    fireEvent.click(within(stepBox("voice")).getByRole("button", { name: "Fill it in" }));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "step", stepKey: "voice" }, body: { command: "fill" } });
    for (const key of ["brief", "pick-title"]) for (const name of ["Skip", "Defer"]) expect(within(stepBox(key)).queryByRole("button", { name })).toBeNull();
  });

  it("a held effect card pushes now by re-sending the defer with proceed; a member's push is refused and shown, not taken for done", async () => {
    const view = runView();
    view.steps[4] = step("cover", "work", [exec(1, { state: "failed", failure: "no image key", output: null }), exec(2, { state: "skipped", output: null })],
      { effect: { kind: "image-generate", class: "cost" }, parallelWith: "article", mark: { kind: "defer", messageSeq: 5, effects: { other: "wait" } } });
    view.steps[5] = step("to-draft-box", "work", [exec(1, { state: "parked", output: null, needsYou: { reason: "deferred-upstream" } })], { effect: { kind: "wechat-draft", class: "external" }, heldBy: ["cover"] });
    answerWith = () => ({ schema: "orca-command-success-v1", result: { kind: "flow-message-stored", flowRunId: RUN, seq: 9, state: "rejected", reason: "flow-effect-needs-person:to-draft-box", deduped: false } });
    await mount(member, view);
    const card = within(stepBox("to-draft-box")).getByRole("group", { name: "to-draft-box is held" });
    expect(card.getAttribute("data-tone")).toBe("warn");
    fireEvent.click(within(card).getByRole("button", { name: "Push now without cover" }));
    await waitFor(() => expect(posts.length).toBe(1));
    // The deferred step's own defer, its other choices kept, now saying proceed for this effect.
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "step", stepKey: "cover" }, body: { command: "defer", effects: { other: "wait", "to-draft-box": "proceed" } } });
    // mutation: ignore a 200 answer whose message was rejected -> no refusal shown, red
    await waitFor(() => expect(screen.getByTestId("refusal-code").textContent).toBe("flow-effect-needs-person"));
    expect(screen.getByTestId("refusal-message").textContent).toContain("only the person can allow");
    fireEvent.click(within(card).getByRole("button", { name: "Wait" }));
    expect(within(card).queryByRole("button", { name: "Push now without cover" })).toBeNull();
    expect(posts.length).toBe(1);
  });

  it("offers 'set coverImage instead' on the failed cover and sends a params command; not on a step that did not fail", async () => {
    const view = runView();
    view.steps[4] = step("cover", "work", [exec(1, { state: "failed", failure: "no image key", output: null })],
      { effect: { kind: "image-generate", class: "cost" }, whenParams: [{ id: "coverImage", type: "image" }] });
    view.steps[2] = step("voice", "work", [exec(1)], { whenParams: [{ id: "language", type: "enum" }] });
    await mount(owner, view);
    expect(within(stepBox("voice")).queryByRole("button", { name: "Set language instead" })).toBeNull();
    fireEvent.click(within(stepBox("cover")).getByRole("button", { name: "Set coverImage instead" }));
    const form = within(stepBox("cover")).getByRole("form", { name: "Set coverImage instead" });
    fireEvent.change(within(form).getByRole("textbox", { name: "coverImage: a file in the folder (relative path)" }), { target: { value: "covers/tea.png" } });
    fireEvent.click(within(form).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost()).toEqual({ url: "/api/control/flows/messages", body: expect.objectContaining({ payload: { runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "params", set: { coverImage: "covers/tea.png" } } } }) });
  });

  it("'set coverImage instead' reuses the start dialog's picker over the run's folder (plan Task 10-B)", async () => {
    const view = runView();
    view.steps[4] = step("cover", "work", [exec(1, { state: "failed", failure: "no image key", output: null })],
      { effect: { kind: "image-generate", class: "cost" }, whenParams: [{ id: "coverImage", type: "image" }] });
    await mount(owner, view);
    fireEvent.click(within(stepBox("cover")).getByRole("button", { name: "Set coverImage instead" }));
    const form = within(stepBox("cover")).getByRole("form", { name: "Set coverImage instead" });
    const picker = await waitFor(() => within(form).getByRole("combobox", { name: "coverImage: an image in the folder" }));
    // mutation: list another folder or template -> url differs, red
    expect(reads).toContain(`/api/control/flows/images?dir=${encodeURIComponent("/home/o/tea")}&template=wechat-article`);
    fireEvent.change(picker, { target: { value: "covers/a.png" } });
    fireEvent.click(within(form).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost()!.body).toEqual(expect.objectContaining({ payload: { runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "params", set: { coverImage: "covers/a.png" } } } }));
  });
});

describe("spend, the tool's numbers only (§10, §14.7)", () => {
  it("renders a null spend as not available with its reason, never 0; money is never a number; the run's note says whose numbers they are", async () => {
    const view = runView({ spend: spent(null, "partial: 2 runs unknown") });
    view.steps[2] = step("voice", "work", [exec(1, { spend: spent(null, "the tool reported 0 tokens") })], { spend: spent(null, "the tool reported 0 tokens") });
    view.steps[1] = step("outline", "work", [exec(1, { spend: spent(4200, "partial: 1 runs unknown") })], { spend: spent(4200, "partial: 1 runs unknown") });
    await mount(owner, view);
    // mutation: render null spend as 0 -> "0 tokens", red
    expect(within(within(stepBox("voice")).getByTestId("flow-execution-1")).getByTestId("flow-spend").textContent)
      .toBe("Spend: not available (the tool reported 0 tokens) · money: not available — the tool reports none");
    // Fix round 1 (M1): a check that can fail -- no spend line of the step shows a token number (its spend is unknown).
    expect(within(stepBox("voice")).getAllByTestId("flow-spend").map((e) => e.textContent).filter((text) => /^Spend: [\d,]+ tokens/.test(text ?? ""))).toEqual([]);
    // A partial sum keeps the known part and says how much is unknown.
    expect(within(within(stepBox("outline")).getByTestId("flow-execution-1")).getByTestId("flow-spend").textContent).toBe("Spend: 4,200 tokens (partial: 1 runs unknown) · money: not available — the tool reports none");
    expect(screen.getByTestId("flow-run-spend").textContent).toBe("Spend: not available (partial: 2 runs unknown) · money: not available — the tool reports none · tool-reported, not an estimate");
  });
});

describe("revise a round of a flow clarify step (§9, §14.6)", () => {
  const result = { slug: "tea", statement: "An article on tea.", acceptanceCriteria: [], frontierEmpty: true, openBranches: [], glossary: [], adrs: [],
    questions: [{ id: "R1.Q1", key: "reader", question: "Who reads it?", recommendedAnswer: "engineers", why: "the account's readers", dependsOn: [] }] };
  const answered = (roundNo: number, over: Partial<RoundBodyV1> = {}): RoundBodyV1 => ({ roundNo, state: "answered", retries: 0, lastInvalidReason: null, waiting: null, result,
    answers: [{ id: "R1.Q1", kind: "recommended", text: "engineers" }], glossaryDecisions: [], adrDecisions: [], answeredAt: "t", closedByConsensus: false, reasonCode: null, calls: [], ...over });

  it("revises an answered round with the Requirements revise form and sends it as an edit at that round", async () => {
    const view = runView();
    view.steps[0] = step("brief", "clarify", [exec(1, { output: { kind: "artifact", ref: "a".repeat(64), hash: "b".repeat(64) } })], { clarify: { rounds: [answered(1)], chain: [1] } });
    await mount(owner, view);
    const rounds = within(stepBox("brief")).getByTestId("flow-rounds");
    fireEvent.click(within(rounds).getByRole("button", { name: "Revise this round" }));
    const form = within(rounds).getByRole("form", { name: "Revise round 1" });
    fireEvent.click(within(form).getByRole("radio", { name: "Own answer" }));
    fireEvent.change(within(form).getByRole("textbox", { name: "R1.Q1: your own answer" }), { target: { value: "designers" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send revision" }));
    // The cost is stated before anything is sent (the Requirements dialog).
    expect(posts).toEqual([]);
    fireEvent.click(within(within(form).getByRole("dialog")).getByRole("button", { name: "Revise and spend one call" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost()).toEqual({ url: "/api/control/flows/messages", body: expect.objectContaining({ payload: { runId: RUN, kind: "edit", target: { kind: "round", stepKey: "brief", roundNo: 1 },
      body: { answers: [{ id: "R1.Q1", kind: "text", text: "designers" }], glossaryDecisions: [], adrDecisions: [] } } }) });
  });

  it("while a revision is at work, its rounds are shown as the revision and its waiting round is the one answered", async () => {
    const view = runView();
    const waiting: RoundBodyV1 = { ...answered(3), state: "awaiting-answers", answers: null, answeredAt: null };
    view.steps[0] = step("brief", "clarify", [exec(1), exec(2, { state: "needs-person", output: null, ask: { kind: "clarify-round", roundNo: 3 } })], {
      head: 1, clarify: { rounds: [answered(1)], chain: [1] }, clarifyRevision: { seq: 2, state: "needs-person", rounds: [answered(1), answered(2, { revises: 1 }), waiting], chain: [2, 3] } });
    await mount(owner, view);
    const brief = stepBox("brief");
    expect(within(brief).getByTestId("flow-rounds").textContent).toContain("A revision is in progress (execution #2)");
    expect(within(brief).getByTestId("flow-rounds").textContent).toContain("The active output stays execution #1 until the revision reaches agreement.");
    // mutation: look the waiting round up in the active execution's rounds -> no round 3 there, no form, red
    fireEvent.click(within(within(brief).getByRole("form", { name: "brief: round 3" })).getByRole("button", { name: "Send this round" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toMatchObject({ runId: RUN, stepKey: "brief", clarify: { roundNo: 3 } });
  });
});

/**
 * Task 10-A fix round 1 (review M2-M7): the branches the first round left without a criterion, the bounded re-reads,
 * what survives a re-mount, re-marking, and spend reasons.
 */
describe("fix round 1: replacements keep the feedback (I1)", () => {
  it("an as-is intake picked by hit keeps both its screenshot and as-is", async () => {
    await mount(owner, runView({ intakes: [intake({ asIs: true })] }));
    fireEvent.click(within(screen.getAllByTestId("flow-intake-hit")[0]!).getByRole("button", { name: "This one" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "feedback", target: { kind: "run" }, body: { text: "this sentence drags", replaces: 7, attachments: [SHOT], asIs: true, hit: 1 } });
  });
});

describe("fix round 1: branches with a criterion now (M2)", () => {
  it("an upload the server refuses shows the refusal and sends no feedback (the screenshots are not dropped silently)", async () => {
    uploadFails = true;
    await mount();
    const box = screen.getByRole("form", { name: "Feedback on the whole run" });
    fireEvent.change(within(box).getByRole("textbox", { name: "Your feedback" }), { target: { value: "see the picture" } });
    fireEvent.change(within(box).getByLabelText("Screenshots (png, jpg or webp, at most 4)"), { target: { files: [new File(["x"], "big.png", { type: "image/png" })] } });
    fireEvent.click(within(box).getByRole("button", { name: "Send feedback" }));
    await waitFor(() => expect(screen.getByTestId("refusal-code").textContent).toBe("flow-attachment-invalid"));
    expect(uploads).toHaveLength(1);
    // mutation: upload failure still sends -> a messages post without the screenshot, red
    expect(posts).toEqual([]);
    // The person's words are still in the box, to send again.
    expect((within(box).getByRole("textbox", { name: "Your feedback" }) as HTMLTextAreaElement).value).toBe("see the picture");
  });

  it("the countdown shows the time left to the deadline", async () => {
    const now = new Date(2026, 9, 23, 14, 0, 0).getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const view = runView({ plans: [{ flowRunId: RUN, planNo: 2, state: "running", by: "olga", via: "web", spend: spent(null, "no tool runs"),
      candidates: { list: [{ stepKey: "cover", reasons: ["upstream-changed:voice"] }], feedback: {}, edits: [], trigger: "feedback" },
      proposal: { retries: 0, lastInvalid: null, skips: [], exhausted: null },
      chosen: { steps: [], skips: [], added: [], pending: [{ stepKey: "cover", question: "Keep the cover?", askedAt: now - 175_000, deadline: now + 125_000, answer: null }] } }] });
    await mount(owner, view);
    // mutation: count the whole timeout instead of the time left -> "5:00 left", red
    expect(screen.getByTestId("flow-remaining").textContent).toBe("2:05 left");
    expect(screen.getByTestId("flow-pending-cover").textContent).toContain("keeps the current output at 14:02");
  });

  it("a needs-location intake says why: an ambiguous reading file names its files, otherwise the passage was not found; a located one shows its excerpt", async () => {
    await mount(owner, runView({ intakes: [
      intake({ messageSeq: 7, results: [], ambiguousFiles: ["tea.md", "tea.wechat.md"] }),
      intake({ messageSeq: 8, results: [] }),
      intake({ messageSeq: 9, state: "triaging", results: [{ anchor: { quote: "Tea slows you down" }, located: { file: "tea.md", paragraph: 2, headingPath: ["Why"], excerpt: "Tea slows you down, they say." } }] }),
    ] }));
    // mutation: swap the ambiguous and not-found lines -> red
    expect(screen.getByTestId("flow-intake-7").textContent).toContain("so this cannot be placed: tea.md, tea.wechat.md");
    expect(screen.getByTestId("flow-intake-8").textContent).toContain("The passage was not found in the article.");
    // mutation: drop the located excerpt -> red
    expect(within(screen.getByTestId("flow-intake-9")).getByText("Tea slows you down, they say.").closest("blockquote")!.textContent).toContain("tea.md · paragraph 2 · Why");
  });

  it("an accept carried from an earlier plan says which plan", async () => {
    const view = runView({ plans: [{ flowRunId: RUN, planNo: 3, state: "running", by: "olga", via: "web", spend: spent(null, "no tool runs"),
      candidates: { list: [], feedback: {}, edits: [], trigger: "feedback" }, proposal: { retries: 0, lastInvalid: null, skips: [], exhausted: null },
      chosen: { steps: [], skips: [], added: [], accepted: [{ stepKey: "cover", seq: 1, by: "olga", via: "web", at: 1, source: "carried", fromPlan: 2 }] } }] });
    await mount(owner, view);
    // mutation: label a carried accept as the timeout's -> red
    expect(screen.getByTestId("flow-plan-accepted-cover").textContent).toBe("cover: accepted as unchanged (carried from plan 2)");
  });

  it("'set <param> instead' on a deferred step sends a bool as a bool and an int as a number", async () => {
    const view = runView();
    view.steps[2] = step("voice", "work", [exec(1), exec(2, { state: "skipped", output: null })], { mark: { kind: "defer", messageSeq: 4, effects: {} },
      whenParams: [{ id: "illustrations", type: "bool" }, { id: "words", type: "int" }] });
    await mount(owner, view);
    // mutation: offer it only on a failed step -> no button on the deferred voice, red
    fireEvent.click(within(stepBox("voice")).getByRole("button", { name: "Set illustrations instead" }));
    const flag = within(stepBox("voice")).getByRole("form", { name: "Set illustrations instead" });
    fireEvent.click(within(flag).getByRole("checkbox", { name: "illustrations" }));
    fireEvent.click(within(flag).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "params", set: { illustrations: true } } });
    fireEvent.click(within(stepBox("voice")).getByRole("button", { name: "Set words instead" }));
    const words = within(stepBox("voice")).getByRole("form", { name: "Set words instead" });
    fireEvent.change(within(words).getByRole("spinbutton", { name: "words" }), { target: { value: "800" } });
    fireEvent.click(within(words).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(posts.length).toBe(2));
    // mutation: send an int param as its text -> "800", red
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "params", set: { words: 800 } } });
  });

  it("a member sees an intake's clarify questions as the owner's to answer, and may still send the words as they are", async () => {
    await mount(member, runView({ intakes: [intake({ state: "clarifying", results: [], clarify: { roundNo: 1, questions: [{ id: "R1.Q1", question: "What feels wrong?", recommendedAnswer: "too stiff" }] } })] }));
    const card = screen.getByRole("region", { name: "Feedback #7" });
    // mutation: give a member the clarify form -> the form exists, red
    expect(within(card).queryByRole("form", { name: "Feedback #7: questions" })).toBeNull();
    expect(card.textContent).toContain("Only the panel owner can do this here.");
    fireEvent.click(within(card).getByRole("button", { name: "Use my words as they are" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toMatchObject({ kind: "feedback", body: { replaces: 7, asIs: true } });
  });

  it("a stopped run offers no marks, no feedback box, no params change and no held card", async () => {
    const view = runView({ state: "stopped" });
    view.steps[4] = step("cover", "work", [exec(1, { state: "failed", failure: "no image key", output: null })], { whenParams: [{ id: "coverImage", type: "image" }] });
    view.steps[5] = step("to-draft-box", "work", [exec(1, { state: "parked", output: null })], { effect: { kind: "wechat-draft", class: "external" }, heldBy: ["cover"] });
    await mount(owner, view);
    // mutation: drop the `open` gate -> these appear, red
    for (const name of ["Skip", "Defer", "Set coverImage instead", "Push now without cover"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("form", { name: "Feedback on the whole run" })).toBeNull();
  });
});

describe("fix round 1: bounded re-reads (M4)", () => {
  it("a member's push-now at a running step comes back accepted; the later rejection is read and shown on the card", async () => {
    const view = runView();
    view.steps[4] = step("cover", "work", [exec(1, { state: "skipped", output: null })], { mark: { kind: "defer", messageSeq: 5, effects: {} } });
    view.steps[5] = step("to-draft-box", "work", [exec(1, { state: "parked", output: null })], { effect: { kind: "wechat-draft", class: "external" }, heldBy: ["cover"] });
    const push = { flowRunId: RUN, seq: 9, requestId: "r9", kind: "command", target: "step", by: "amy", via: "web", reason: null, at: 9,
      body: { command: "defer", effects: { "to-draft-box": "proceed" }, target: { kind: "step", stepKey: "cover" } } };
    answerWith = () => ({ schema: "orca-command-success-v1", result: { kind: "flow-message-stored", flowRunId: RUN, seq: 9, state: "accepted", reason: null, deduped: false } });
    journals = [JOURNAL, { ...JOURNAL, messages: [...JOURNAL.messages, { ...push, state: "accepted" as const }] },
      { ...JOURNAL, messages: [...JOURNAL.messages, { ...push, state: "rejected" as const, reason: "flow-effect-needs-person:to-draft-box" }] }];
    await mount(member, view);
    fireEvent.click(within(stepBox("to-draft-box")).getByRole("button", { name: "Push now without cover" }));
    await waitFor(() => expect(posts.length).toBe(1));
    // Accepted for now: no refusal yet, nothing shown as done either.
    expect(screen.queryByTestId("refusal-code")).toBeNull();
    // mutation: no follow-up read while a sent message waits -> the rejection is never read, red
    await waitFor(() => expect(screen.getByTestId("refusal-code").textContent).toBe("flow-effect-needs-person"), { timeout: 5000 });
    // mutation: drop the card's refused line -> red
    expect(within(stepBox("to-draft-box")).getByTestId("flow-held-refused").textContent).toBe("Not let through: only the person (the panel owner) can let to-draft-box go ahead.");
  });

  it("reads once more just after a shown deadline passes", async () => {
    const view = runView({ plans: [{ flowRunId: RUN, planNo: 2, state: "running", by: "olga", via: "web", spend: spent(null, "no tool runs"),
      candidates: { list: [{ stepKey: "cover", reasons: ["upstream-changed:voice"] }], feedback: {}, edits: [], trigger: "feedback" },
      proposal: { retries: 0, lastInvalid: null, skips: [], exhausted: null },
      chosen: { steps: [], skips: [], added: [], pending: [{ stepKey: "cover", question: "Keep the cover?", askedAt: Date.now() - 299_800, deadline: Date.now() + 200, answer: null }] } }] });
    await mount(owner, view);
    const before = reads.filter((r) => !r.endsWith("/journal")).length;
    // mutation: no re-read at the deadline -> the count stays, red
    await waitFor(() => expect(reads.filter((r) => !r.endsWith("/journal")).length).toBe(before + 1), { timeout: 3000 });
  });

  it("while an intake locates it reads again a bounded number of times, each later than the last, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount(owner, runView({ intakes: [intake({ state: "locating", results: [] })] }));
    const views = () => reads.filter((r) => !r.endsWith("/journal")).length;
    const start = views();
    const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
    await advance(1600);
    expect(views()).toBe(start + 1);
    // 1.5 s, then 3, 6, 12 and 24 s later: five follow-ups in all.
    for (let i = 0; i < 40; i += 1) await advance(5_000);
    // mutation: follow up without a bound -> more than 5, red
    expect(views()).toBe(start + 5);
    for (let i = 0; i < 40; i += 1) await advance(15_000);
    expect(views()).toBe(start + 5);
  });
});

describe("fix round 1: what survives a re-mount (M5), re-marking (M6), spend reasons (M7)", () => {
  it("a half-written run feedback and a held card's 'wait' survive an act that re-mounts the run's body", async () => {
    const view = runView();
    view.steps[5] = step("to-draft-box", "work", [exec(1, { state: "parked", output: null })], { effect: { kind: "wechat-draft", class: "external" }, heldBy: ["cover"] });
    const after = runView();
    after.steps[5] = view.steps[5]!;
    after.steps[1] = step("outline", "work", [exec(1), exec(2), exec(3, { state: "skipped", output: null })]);
    laterViews = [after];
    await mount(owner, view);
    const box = screen.getByRole("form", { name: "Feedback on the whole run" });
    fireEvent.change(within(box).getByRole("textbox", { name: "Your feedback" }), { target: { value: "half a thought" } });
    fireEvent.click(within(stepBox("to-draft-box")).getByRole("button", { name: "Wait" }));
    fireEvent.click(within(stepBox("outline")).getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(within(stepBox("outline")).getByTestId("flow-step-state").textContent).toBe("skipped"));
    // mutation: keep the feedback box inside the re-mount key -> its text is gone, red
    expect((within(screen.getByRole("form", { name: "Feedback on the whole run" })).getByRole("textbox", { name: "Your feedback" }) as HTMLTextAreaElement).value).toBe("half a thought");
    // mutation: keep "wait" in the card's own state -> the push button is back, red
    expect(within(stepBox("to-draft-box")).getByText("It keeps waiting.")).toBeTruthy();
  });

  it("a marked step may be marked again: a skip becomes a defer, a defer a skip, and a defer's choices change", async () => {
    const view = runView();
    view.steps[1] = step("outline", "work", [exec(1)], { mark: { kind: "skip", messageSeq: 3, effects: {} }, deferHolds: ["to-draft-box"] });
    view.steps[2] = step("voice", "work", [exec(1)], { mark: { kind: "defer", messageSeq: 4, effects: { "to-draft-box": "proceed" } }, deferHolds: ["to-draft-box"] });
    await mount(owner, view);
    // mutation: offer only Fill on a marked step -> no "Defer instead", red
    fireEvent.click(within(stepBox("outline")).getByRole("button", { name: "Defer instead" }));
    const dialog = within(stepBox("outline")).getByRole("dialog", { name: "Defer outline" });
    expect((within(dialog).getByRole("radio", { name: "Wait" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(stepBox("voice")).getByRole("button", { name: "Skip instead" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "step", stepKey: "voice" }, body: { command: "skip" } });
    fireEvent.click(within(stepBox("voice")).getByRole("button", { name: "Change what waits" }));
    const choices = within(stepBox("voice")).getByRole("dialog", { name: "Defer voice" });
    // The standing choice is preselected, not reset to wait.
    expect((within(choices).getByRole("radio", { name: "Go ahead without it" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(choices).getByRole("radio", { name: "Wait" }));
    fireEvent.click(within(choices).getByRole("button", { name: "Defer" }));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(lastPost().body.payload).toEqual({ runId: RUN, kind: "command", target: { kind: "step", stepKey: "voice" }, body: { command: "defer", effects: { "to-draft-box": "wait" } } });
  });

  it("a spend with no reason reads 'not available', and the server's reasons read in the page's language", () => {
    const en = i18n.getFixedT("en"), zh = i18n.getFixedT("zh");
    // mutation: no fallback for a missing reason -> "not available ()", red
    expect(spendText(spent(null), en)).toBe("Spend: not available · money: not available — the tool reports none");
    // mutation: show the server's English reason in zh -> red
    expect(spendText(spent(null, "the tool reported 0 tokens"), zh)).toBe("花费：不可用（工具报告了 0 token） · 金额：不可用——工具不报告金额");
    expect(spendText(spent(null, "3 runs unknown"), zh)).toBe("花费：不可用（3 次运行用量未知） · 金额：不可用——工具不报告金额");
    expect(spendText(spent(1200, "partial: 1 runs unknown"), en)).toContain("(partial: 1 runs unknown)");
    // A reason the page does not know is shown as the server sent it.
    expect(spendText(spent(null, "something new"), zh)).toContain("不可用（something new）");
  });
});

// Task 11 acceptance (session ffec7b28) on the run page: the spend line twice, marks on a finished run, unlabelled inputs.
describe("run page details from the Task 11 acceptance", () => {
  // Mutation "always render the step's spend": a one-execution step shows the same line twice.
  it("shows a step's own spend line only when it has more than one execution", async () => {
    const view = runView();
    view.steps[2] = step("voice", "work", [exec(1, { spend: spent(92_842, null) })], { spend: spent(92_842, null) });
    await mount(owner, view);
    expect(within(stepBox("voice")).getAllByTestId("flow-spend")).toHaveLength(1);
    // outline has two executions: each execution's line, then the step's sum.
    expect(within(stepBox("outline")).getAllByTestId("flow-spend").length).toBeGreaterThan(stepBox("outline").querySelectorAll(".flow-execution").length);
  });
  // Mutation "marks on a done run": Skip and Defer come back on the finished run's steps.
  it("offers no skip or defer once the run is done, but a marked step can still be filled", async () => {
    const view = runView({ state: "done" });
    view.steps[2] = step("voice", "work", [exec(1), exec(2, { state: "skipped", output: null })], { mark: { kind: "skip", messageSeq: 4, effects: {} } });
    await mount(owner, view);
    for (const name of ["Skip", "Defer"]) expect(within(stepBox("outline")).queryByRole("button", { name })).toBeNull();
    expect(within(stepBox("voice")).getByRole("button", { name: "Fill it in" })).toBeTruthy();
  });
  // Mutation "aria-label only": the inputs keep their names but show no text beside them.
  it("gives the rewind, pool and location inputs visible labels", async () => {
    await mount(owner, runView());
    for (const name of ["Rewind to step or step#n", "Tokens to add to the pool"]) expect(screen.getByLabelText(name).closest("label")?.textContent).toContain(name);
    for (const name of ["A passage as it reads in the article", "Under the heading", "Paragraph number"]) {
      const inputs = screen.getAllByLabelText(name);
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) expect(input.closest("label")?.textContent).toContain(name);
    }
  });
});

/**
 * Live transcript spec §10.4.4: each execution lists its Orca runs (its single calls, then its child group's runs) with a
 * collapsed transcript each; nothing is asked until one is opened, and a legacy entry (no run id) lists nothing.
 */
describe("the execution's transcripts (live transcript §10.4.4)", () => {
  it("shows one collapsed transcript per run of the execution, and asks for a run's listing only when it is opened", async () => {
    const runs = [{ runId: "run-call-1", purpose: "flow-draft", tokens: 10 }, { runId: "run-child-1", purpose: "work", tokens: 20 }, { runId: "legacy:voice#1", purpose: "work", tokens: null }];
    const view = runView({ steps: [step("voice", "work", [exec(1, { spend: { ...spent(30), runs } })])] });
    await mount(owner, view);
    const execution = within(stepBox("voice")).getByTestId("flow-execution-1");
    const buttons = within(execution).getAllByRole("button", { name: "Transcript" });
    expect(buttons).toHaveLength(2);
    expect(reads.filter((url) => url.includes("/transcripts"))).toEqual([]);
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(reads).toContain("/api/control/runs/run-child-1/transcripts"));
    expect(reads.filter((url) => url.includes("/transcripts"))).toEqual(["/api/control/runs/run-child-1/transcripts"]);
  });
});

/**
 * Flow engine spec §10.5: a paused run is resumed by the owner only (a member sees why), and while a work step runs the
 * owner may leave it a note -- for the step's next attempt or every remaining one.
 */
describe("a pause, a resume and a note (§10.5)", () => {
  const runningWork = (): FlowRunViewV1 => runView({ steps: [step("voice", "work", [exec(1, { state: "running", output: null })])] });

  it("gives the owner the pause and a note form on a running work step, and sends the note", async () => {
    await mount(owner, runningWork());
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.queryByTestId("flow-resume-owner-only")).toBeNull();
    const form = within(stepBox("voice")).getByRole("form", { name: "Note for voice" });
    const text = within(form).getByRole("textbox", { name: "Note for the step" });
    const send = within(form).getByRole("button", { name: "Send the note" }) as HTMLButtonElement;
    // mutation: enable the send on an empty text -> enabled, red
    expect(send.disabled).toBe(true);
    fireEvent.change(text, { target: { value: "   " } });
    expect(send.disabled).toBe(true);
    // 4096 ASCII bytes is the cap; 4097 is one over.
    fireEvent.change(text, { target: { value: "a".repeat(4096) } });
    expect(send.disabled).toBe(false);
    fireEvent.change(text, { target: { value: "a".repeat(4097) } });
    expect(send.disabled).toBe(true);
    expect(form.textContent).toContain("The note is longer than 4096 bytes; shorten it.");
    // é is two bytes in UTF-8: 2049 of them are 4098 bytes, 2048 are exactly 4096.
    fireEvent.change(text, { target: { value: "é".repeat(2049) } });
    // mutation: count characters instead of bytes -> still enabled, red
    expect(send.disabled).toBe(true);
    fireEvent.change(text, { target: { value: "é".repeat(2048) } });
    expect(send.disabled).toBe(false);
    fireEvent.change(text, { target: { value: "  keep the metaphors  " } });
    fireEvent.change(within(form).getByRole("combobox", { name: "When the note applies" }), { target: { value: "remaining-attempts" } });
    fireEvent.click(send);
    await waitFor(() => expect(posts.length).toBe(1));
    expect(lastPost()).toEqual({ url: "/api/control/flows/messages", body: expect.objectContaining({ payload: {
      runId: RUN, kind: "command", target: { kind: "step", stepKey: "voice" }, body: { command: "note", text: "keep the metaphors", scope: "remaining-attempts" } } }) });
    // The text is cleared after a send.
    expect((text as HTMLTextAreaElement).value).toBe("");
  });

  it("gives the owner the resume on a paused run, and no owner-only line", async () => {
    await mount(owner, runView({ state: "paused" }));
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    expect(screen.queryByTestId("flow-resume-owner-only")).toBeNull();
  });

  it("lets a member pause, but shows no resume and no note form", async () => {
    await mount(member, runningWork());
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    // mutation: render the note form for every reader -> the form exists, red
    expect(within(stepBox("voice")).queryByRole("form", { name: "Note for voice" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send the note" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });

  it("shows a member a paused run's resume as the owner's own act", async () => {
    await mount(member, runView({ state: "paused" }));
    // mutation M11: render resume for everyone -> the member's Resume button exists, red
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    const line = screen.getByTestId("flow-resume-owner-only");
    expect(line.getAttribute("role")).toBe("note");
    expect(line.textContent).toBe("Only the panel owner can do this here.");
  });
});
