// @vitest-environment jsdom
/**
 * Flow engine spec §14.1, §7.4, §9, §16.2, §21 C17 display half (plan Task 16): the flow run page. It shows the server's
 * run as it is -- steps in template order with state, the reasons each execution ran, red flags and ccloop's tool-rule
 * report row by row (a rule ccloop could not enforce is red: shown as anything else, a person would trust a guard that
 * does not exist) -- and every act on the run is one flow verb the person sends: feedback and edits, run commands, the
 * re-run plan with the model's proposed skips the person can overrule, answers, confirm cards, enact / discard, the pool.
 * The human-only verbs are not offered to someone who may not send them (§14.2).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import type { FlowExecutionViewV1, FlowJournalV1, FlowRunViewV1, FlowToolRulesReportV1 } from "../src/controlTypes.js";
import { FlowRunPage } from "../src/FlowRunPage.js";
import "../src/i18n.js";

afterEach(cleanup);
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
const exec = (seq: number, over: Partial<FlowExecutionViewV1> = {}): FlowExecutionViewV1 => ({
  seq, state: "done", reasons: ["never-succeeded"], planNo: null, childGroupId: null, by: "orca-auto", via: "orca", flags: [], failure: null,
  output: { kind: "commit", ref: "c".repeat(40), hash: "h".repeat(64) }, toolRules: null, ask: null, needsYou: null, reported: null, warnings: [], effectRecordId: null, ...over,
});
const step = (stepKey: string, kind: string, executions: FlowExecutionViewV1[], over: Partial<FlowRunViewV1["steps"][number]> = {}): FlowRunViewV1["steps"][number] => ({
  stepKey, kind, head: executions.filter((e) => e.state === "done").at(-1)?.seq ?? null, executor: null, parallelWith: null, effect: null,
  latest: executions.at(-1) ?? null, executions, clarify: null, ...over,
});
const policy = { value: "confirm" as const, source: "project" as const, lockedBy: null };
const CONFIRM_ASK = { kind: "effect-confirm" as const, recordId: "eff-00000000-0000-4000-8000-00000000000a", stepKey: "to-draft-box", effectKind: "wechat-draft", class: "external", policy, summary: "title: Tea, slowly" };
const PICK_ASK = { kind: "ask" as const, form: { title: { type: "text" } }, candidates: { title: ["Tea, slowly", "Slow tea", "Tea for engineers"] }, defaults: { title: "Tea, slowly" }, freeText: true };

function runView(over: Partial<FlowRunViewV1> = {}): FlowRunViewV1 {
  return {
    schema: "orca-flow-run-view-v1", flowRunId: RUN, groupId: "flow-g", templateRef: "builtin/wechat-article@1", state: "running",
    params: { idea: "Tea" }, poolTokens: 2_000_000, poolDrawn: 750_000, by: "olga", via: "web", dir: "/home/o/tea",
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
      chosen: null, by: "olga", via: "web",
    }],
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
function serve(view: FlowRunViewV1 = runView()): void {
  posts = []; reads = [];
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if ((init?.method ?? "GET") === "POST") { posts.push({ url, body: JSON.parse(String(init!.body)) }); return new Response(JSON.stringify({ schema: "orca-command-success-v1" }), { status: 200 }); }
    reads.push(url);
    return new Response(JSON.stringify(url.endsWith("/journal") ? JOURNAL : view), { status: 200 });
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
});

describe("who may act (§14.2)", () => {
  it("offers a member feedback and run commands, but not the human-only answer, re-run, effect or pool acts", async () => {
    await mount(member);
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(within(stepBox("voice")).getByRole("button", { name: "Send feedback" })).toBeTruthy();
    // mutation: offer the human-only acts to a member -> these buttons exist, red
    for (const name of ["Run these steps", "Confirm and run", "Enact", "Discard", "Send the answer", "Raise the pool"]) expect(screen.queryByRole("button", { name })).toBeNull();
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
