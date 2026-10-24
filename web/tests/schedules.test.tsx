// @vitest-environment jsdom
/**
 * Scheduled flows and groups spec 2026-10-24 §13.3, §14, criterion C13 (plan Task 10, batch A): the project's schedules
 * beside Checks -- the next three slots, the last fire's late/missed/waiting words, Paused + Resume (M-C13b
 * `hide-paused`), "a newer version" with its provenance and Repin under the read revision; the add-group form's
 * confirm-mode line for a token limit and a delivery scheme, where a delivery must never read as `.auto` (M-C13c
 * `auto-with-delivery`); the add-flow form; the fire list; a member's read-only view; and `schedules.noPump`.
 * The schedules, slots, fires and confirm mode are the server's; these criteria assert the Web words them as sent.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createHash, webcrypto } from "node:crypto";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import type {
  Amount, ControlConfigV1, ControlSummaryV1, FlowExecutionViewV1, FlowListV1, FlowRunViewV1, FlowSpendV1,
  GroupViewV1, PlanLibraryEntryViewV1, PlanLibraryListViewV1, PlanLibraryVersionV1, RecoveryViewV1,
  RequirementViewV1, ScheduleFireViewV1, ScheduleViewV1, SchedulesViewV1,
} from "../src/controlTypes.js";
import { ScheduleDetail } from "../src/ScheduleDetail.js";
import { ScheduleSettings } from "../src/ScheduleSettings.js";
import { ProjectSettings } from "../src/ProjectSettings.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import { RequirementsPanel } from "../src/RequirementsPanel.js";
import { BoardView } from "../src/BoardView.js";
import { ControlPanel } from "../src/ControlPanel.js";
import { FlowRunPage } from "../src/FlowRunPage.js";
import { PlanLibraryView } from "../src/PlanLibraryView.js";
import { commandEnvelope, controlCommandPath, nextCommandId, scheduleIdFor, sendControlCommand, type ControlAction } from "../src/controlApi.js";
import { requirementView, summaryWith } from "./fixtures/requirement.js";
import "../src/i18n.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const as = (me: Me, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SLOT = Date.UTC(2026, 9, 26, 2, 0, 0);
const DAY = 86_400_000;
const OLD_SHA = "a".repeat(64);
const NEW_SHA = "b".repeat(64);
const slotText = (at: number): string => new Date(at).toLocaleString();
const DAYLIGHT = { delivery: "local" as const, trigger: "group" as const, method: "merge" as const, target: "main" };

const version = (over: Partial<PlanLibraryVersionV1> = {}): PlanLibraryVersionV1 =>
  ({ version: 1, sha256: OLD_SHA, by: "olga", via: "web", at: SLOT, origin: { kind: "group", groupId: "g1", planHash: "plan-h1" }, ...over });
const fire = (over: Partial<ScheduleFireViewV1> = {}): ScheduleFireViewV1 => ({
  seq: 1, slot: SLOT, at: SLOT + 60_000, lateMs: null, missed: 0, outcome: "started", reason: null, commandId: "cmd-1",
  flowRunId: "fr-00000000-0000-0000-0000-000000000001", groupId: null, creditedTo: "olga", confirm: null, by: "orca-auto", via: "schedule", ...over,
});
const schedule = (over: Partial<ScheduleViewV1> = {}): ScheduleViewV1 => ({
  id: "sch-nightly", projectId: "repo", name: "Nightly", kind: "group", cron: "0 2 * * *", enabled: true,
  start: { kind: "group", entryId: "lib-1", sha256: OLD_SHA, tokenLimit: null, integration: null },
  removed: false, revision: 4,
  createdBy: "olga", createdVia: "web", createdAt: 1, updatedBy: "olga", updatedVia: "web", updatedAt: 1,
  enabledBy: "olga", enabledVia: "web", enabledAt: 1,
  lastSlot: SLOT, tz: "UTC", failureStreak: 0, paused: false, pausedReason: null,
  nextSlots: [SLOT + DAY, SLOT + 2 * DAY, SLOT + 3 * DAY], lastFire: fire(), newerVersion: null, ...over,
});
const list = (...schedules: ScheduleViewV1[]): SchedulesViewV1 => ({ schema: "orca-schedules-v1", repoId: "repo", schedules });
const entry = (over: Partial<PlanLibraryEntryViewV1> = {}): PlanLibraryEntryViewV1 => ({
  schema: "orca-plan-library-entry-v1", entryId: "lib-1", projectId: "repo", name: "Nightly plan", state: "active",
  createdBy: "olga", createdVia: "web", createdAt: 1, head: version({ version: 2, sha256: NEW_SHA }), versionCount: 2,
  usedBy: ["sch-nightly"], versions: [version(), version({ version: 2, sha256: NEW_SHA })], ...over,
});
const libraryList = (entries = [entry()]): PlanLibraryListViewV1 => ({
  schema: "orca-plan-library-v1", repoId: "repo",
  entries: entries.map(({ versions: _versions, schema: _schema, ...rest }) => rest),
});
const config = (executionPort: ControlConfigV1["executionPort"] = "configured"): ControlConfigV1 => ({
  schema: "orca-control-config-v1", epoch: "e", repositories: [], plans: [], profiles: [], defaults: null, executionPort, errorCatalog: [],
});

type Posts = Array<{ url: string; body: { commandId: string; expectedRevision: number; payload: unknown } }>;
let posts: Posts;
let reads: string[];
type Answer = (url: string) => unknown;
const serve = (answer: Answer): void => {
  posts = []; reads = [];
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input), method = init?.method ?? "GET";
    if (method === "POST") { posts.push({ url, body: JSON.parse(String(init!.body)) }); return jsonResponse({ schema: "orca-command-success-v1" }); }
    reads.push(url);
    return jsonResponse(answer(url));
  }) as typeof fetch;
};
const region = (): HTMLElement => screen.getByRole("region", { name: "Schedules" });
const row = (id: string): HTMLElement => screen.getByTestId(`schedule-${id}`);

describe("the project's schedules (spec §13.3, C13)", () => {
  beforeEach(() => serve((url) => {
    if (url === "/api/control/config") return config();
    if (url.startsWith("/api/control/schedules?")) return list(
      schedule({
        paused: true, failureStreak: 3, pausedReason: "spawn failed", newerVersion: NEW_SHA,
        lastFire: fire({ lateMs: 125_000, missed: 2 }),
      }),
      schedule({
        id: "sch-waiting", name: "Waiting", kind: "flow", cron: "0 3 * * *",
        start: { kind: "flow", template: "builtin/dev@1", params: {} },
        lastFire: fire({ seq: 2, outcome: "waiting", reason: "budget-review", flowRunId: "fr-00000000-0000-0000-0000-000000000002" }),
      }),
    );
    if (url === "/api/control/plan-library/lib-1") return entry();
    return {};
  }));

  it("lists the next three slots, the last fire's late/missed and waiting words, and the fire's credit", async () => {
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} />));
    await waitFor(() => expect(screen.getByTestId("schedule-sch-nightly")).toBeTruthy());
    expect(reads).toContain("/api/control/schedules?repoId=repo");
    const next = screen.getByTestId("schedule-next-sch-nightly").textContent!;
    // mutation: render one slot, or drop the zone -> red
    expect(next).toBe(`Next: ${[SLOT + DAY, SLOT + 2 * DAY, SLOT + 3 * DAY].map(slotText).join(", ")} (UTC)`);
    const first = row("sch-nightly");
    expect(within(first).getByTestId("schedule-last-fire-sch-nightly").textContent).toContain(`Started fr-00000000-0000-0000-0000-000000000001 for ${slotText(SLOT)}`);
    expect(within(first).getByTestId("schedule-last-fire-sch-nightly").textContent).toContain("late by 2 min; 2 earlier slot(s) skipped while the panel was down");
    expect(within(first).getByTestId("schedule-fire-by-sch-nightly").textContent).toContain("by orca-auto via schedule sch-nightly, scheduled by olga");
    const waiting = row("sch-waiting");
    // mutation: render waiting as started (drop its reason) -> red
    expect(within(waiting).getByTestId("schedule-last-fire-sch-waiting").textContent).toContain(`Started fr-00000000-0000-0000-0000-000000000002 for ${slotText(SLOT)}; it waits for you (budget-review)`);
    // §13.3: a fire that names its run links to the board; the flow fire's link is the flow run.
    expect(within(first).getByTestId("schedule-last-fire-link-sch-nightly").getAttribute("href")).toBe("#board/flow/fr-00000000-0000-0000-0000-000000000001");
  });

  it("links a last fire to its group (spec §13.3)", async () => {
    serve((url) => {
      if (url === "/api/control/config") return config();
      if (url.startsWith("/api/control/schedules?")) return list(schedule({ lastFire: fire({ flowRunId: null, groupId: "g1" }) }));
      return {};
    });
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} />));
    await waitFor(() => expect(screen.getByTestId("schedule-last-fire-link-sch-nightly")).toBeTruthy());
    const link = screen.getByTestId("schedule-last-fire-link-sch-nightly");
    expect(link.getAttribute("href")).toBe("#tasks/g1");
    expect(link.textContent).toContain("g1");
  });

  it("M-C13b hide-paused: a paused row says so and offers Resume under the read revision", async () => {
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} />));
    await waitFor(() => expect(screen.getByTestId("schedule-paused-sch-nightly")).toBeTruthy());
    const paused = screen.getByTestId("schedule-paused-sch-nightly");
    // mutation: drop the paused branch -> no text and no Resume, red
    expect(paused.textContent).toContain("Paused after 3 failed starts in a row: spawn failed");
    fireEvent.click(within(paused).getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/control/schedules/sch-nightly/resume", body: expect.objectContaining({ expectedRevision: 4, payload: {} }) });
  });

  it("shows a newer version with its provenance, and Repin sends the new sha under the read revision", async () => {
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} />));
    await waitFor(() => expect(screen.getByTestId("schedule-provenance-sch-nightly")).toBeTruthy());
    const newer = screen.getByTestId("schedule-newer-sch-nightly");
    expect(newer.textContent).toContain("A newer version of this plan exists; this schedule still runs the pinned one.");
    const provenance = screen.getByTestId("schedule-provenance-sch-nightly").textContent!;
    // mutation: show the pinned sha, or drop by/via -> red
    expect(provenance).toContain(`Version bbbbbbb — saved by olga via web at ${slotText(SLOT)} from group g1`);
    fireEvent.click(within(newer).getByRole("button", { name: "Use the newest version" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: "/api/control/schedules/sch-nightly",
      body: expect.objectContaining({ expectedRevision: 4, payload: { set: { start: { kind: "group", entryId: "lib-1", sha256: NEW_SHA, tokenLimit: null, integration: null } } } }),
    });
  });

  it("sends the enable toggle under the read revision", async () => {
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} />));
    await waitFor(() => expect(screen.getByTestId("schedule-sch-nightly")).toBeTruthy());
    fireEvent.click(within(row("sch-nightly")).getByRole("checkbox", { name: "Enabled" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // mutation: drop expectedRevision (or send the new value as the revision) -> red
    expect(posts[0]).toEqual({
      url: "/api/control/schedules/sch-nightly/enable",
      body: expect.objectContaining({ expectedRevision: 4, payload: { enabled: false } }),
    });
  });

  it("sends Remove under the read revision", async () => {
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} />));
    await waitFor(() => expect(screen.getByTestId("schedule-sch-nightly")).toBeTruthy());
    fireEvent.click(within(row("sch-nightly")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // mutation: send under revision 0, or a payload that is not the verb's empty one -> red
    expect(posts[0]).toEqual({
      url: "/api/control/schedules/sch-nightly/remove",
      body: expect.objectContaining({ expectedRevision: 4, payload: {} }),
    });
  });

  it("disables Save for an edit that changes nothing", async () => {
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} />));
    await waitFor(() => expect(screen.getByTestId("schedule-sch-nightly")).toBeTruthy());
    fireEvent.click(within(row("sch-nightly")).getByRole("button", { name: "Edit" }));
    // mutation: enable Save unconditionally -> red
    expect((within(row("sch-nightly")).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(row("sch-nightly")).getByLabelText("Name"), { target: { value: "Nightly two" } });
    expect((within(row("sch-nightly")).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens the fire list from a row's Fires button", async () => {
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} />));
    await waitFor(() => expect(screen.getByTestId("schedule-sch-nightly")).toBeTruthy());
    serve((url) => {
      if (url === "/api/control/config") return config();
      if (url.startsWith("/api/control/schedules/sch-nightly/fires")) return { schema: "orca-schedule-fires-v1", scheduleId: "sch-nightly", fires: [fire({ by: "orca-auto", creditedTo: "olga" })] };
      return list(schedule());
    });
    fireEvent.click(within(row("sch-nightly")).getByRole("button", { name: "Fires" }));
    await waitFor(() => expect(screen.getByTestId("schedule-fire-1")).toBeTruthy());
    expect(reads).toContain("/api/control/schedules/sch-nightly/fires?limit=50");
    const fired = screen.getByTestId("schedule-fire-1");
    expect(fired.textContent).toContain(`Slot ${slotText(SLOT)} · fired ${slotText(SLOT + 60_000)} · started`);
    expect(fired.textContent).toContain("by orca-auto via schedule sch-nightly, scheduled by olga");
    // The by-orca line already names the person: no second "credited to" line.
    expect(fired.textContent).not.toContain("credited to");
    // §13.3: the fire row's link goes to the run on the board.
    expect(within(fired).getByTestId("schedule-fire-link-1").getAttribute("href")).toBe("#board/flow/fr-00000000-0000-0000-0000-000000000001");
  });
});

describe("the add-group form's confirm mode (spec §13.3, M-C13c auto-with-delivery)", () => {
  beforeEach(() => serve((url) => {
    if (url === "/api/control/config") return config();
    if (url.startsWith("/api/control/schedules?")) return list();
    if (url.startsWith("/api/control/plan-library?")) return libraryList();
    if (url === "/api/control/plan-library/lib-1") return entry();
    return {};
  }));

  const form = (): HTMLElement => screen.getByRole("region", { name: "Add group schedule" });
  const mode = (): string => within(form()).getByTestId("group-confirm-mode").textContent!;

  it("shows unlimited as auto, a token limit as limited, and a delivery as delivery -- never auto", async () => {
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} dir={false} defaultIntegration={DAYLIGHT} />));
    await waitFor(() => expect(screen.getByTestId("group-version-provenance")).toBeTruthy());
    expect(mode()).toBe("Each fired group confirms on its own (unlimited tokens, no delivery scheme).");
    const limit = within(form()).getByRole("spinbutton", { name: "Token limit (empty: unlimited)" });
    fireEvent.change(limit, { target: { value: "500000" } });
    // mutation: render auto for a limited group -> red
    expect(mode()).toBe("Each fired group waits for your click: it has a token limit.");
    fireEvent.change(limit, { target: { value: "" } });
    expect(mode()).toBe("Each fired group confirms on its own (unlimited tokens, no delivery scheme).");
    fireEvent.change(within(form()).getByRole("combobox", { name: "Delivery" }), { target: { value: "project" } });
    // M-C13c mutation: show `.auto` for a group with a delivery scheme -> red
    expect(mode()).toBe("Each fired group waits for your click: it delivers by merge into a local branch.");
    expect(mode()).not.toContain("confirms on its own");
  });

  it("sends one create with the pinned entry version, the delivery and the chosen token limit", async () => {
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} dir={false} defaultIntegration={DAYLIGHT} />));
    await waitFor(() => expect(screen.getByTestId("group-version-provenance")).toBeTruthy());
    expect(screen.getByTestId("group-version-provenance").textContent).toContain("Version bbbbbbb — saved by olga via web");
    expect(screen.getByTestId("group-version-provenance").textContent).toContain("from group g1");
    fireEvent.change(within(form()).getByRole("combobox", { name: "Version" }), { target: { value: OLD_SHA } });
    fireEvent.change(within(form()).getByLabelText("Name"), { target: { value: "Nightly two" } });
    fireEvent.change(within(form()).getByLabelText("Cron (minute hour day month weekday), at most hourly"), { target: { value: "0 4 * * *" } });
    fireEvent.change(within(form()).getByRole("combobox", { name: "Delivery" }), { target: { value: "project" } });
    fireEvent.click(within(form()).getByRole("button", { name: "Add group schedule" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: "/api/control/schedules/sch-nightly-two",
      body: expect.objectContaining({
        expectedRevision: 0,
        payload: { projectId: "repo", name: "Nightly two", cron: "0 4 * * *", enabled: true, start: { kind: "group", entryId: "lib-1", sha256: OLD_SHA, tokenLimit: null, integration: DAYLIGHT } },
      }),
    });
  });
});

describe("the add-flow form (spec §13.3)", () => {
  it("sends a flow start at the template's shipped version with its typed params and cron", async () => {
    serve((url) => {
      if (url === "/api/control/config") return config();
      if (url.startsWith("/api/control/schedules?")) return list();
      if (url === "/api/control/flows/templates") return {
        schema: "orca-flow-templates-v1",
        templates: [{ id: "dev", version: 3, title: { en: "Dev flow" }, params: [{ id: "idea", type: "text", required: true }], excludes: [] }],
      };
      return {};
    });
    render(as(owner, <ScheduleSettings scope={{ repoId: "folder-1" }} dir />));
    const form = await screen.findByRole("region", { name: "Add flow schedule" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Morning dev" } });
    fireEvent.change(within(form).getByLabelText("Cron (minute hour day month weekday), at most hourly"), { target: { value: "0 8 * * *" } });
    await waitFor(() => expect(within(form).getByTestId("flow-start-param-idea")).toBeTruthy());
    fireEvent.change(within(within(form).getByTestId("flow-start-param-idea")).getByRole("textbox"), { target: { value: "write the docs" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add flow schedule" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: "/api/control/schedules/sch-morning-dev",
      body: expect.objectContaining({
        expectedRevision: 0,
        payload: { projectId: "folder-1", name: "Morning dev", cron: "0 8 * * *", enabled: true, start: { kind: "flow", template: "builtin/dev@3", params: { idea: "write the docs" } } },
      }),
    });
  });
});

describe("a member and a panel without a pump (spec §13.3)", () => {
  beforeEach(() => serve((url) => {
    if (url === "/api/control/config") return config();
    if (url.startsWith("/api/control/schedules?")) return list(schedule({ paused: true, pausedReason: "spawn failed", newerVersion: NEW_SHA }));
    if (url === "/api/control/plan-library/lib-1") return entry();
    return {};
  }));

  it("a member reads the list but is offered no write control", async () => {
    render(as(member, <ScheduleSettings scope={{ repoId: "repo" }} dir={false} defaultIntegration={null} />));
    await waitFor(() => expect(screen.getByTestId("schedule-sch-nightly")).toBeTruthy());
    // mutation: render any write control for a member -> red
    expect(within(region()).queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use the newest version" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Add group schedule" })).toBeNull();
    expect(within(region()).getByRole("note").textContent).toBe("Only the panel owner can change schedules.");
    expect(within(region()).getByRole("button", { name: "Fires" })).toBeTruthy();
  });

  it("says schedules do not fire when the panel answers executionPort unconfigured", async () => {
    serve((url) => {
      if (url === "/api/control/config") return config("unconfigured");
      if (url.startsWith("/api/control/schedules?")) return list();
      if (url.startsWith("/api/control/plan-library?")) return libraryList();
      return {};
    });
    render(as(owner, <ScheduleSettings scope={{ repoId: "repo" }} />));
    expect(await screen.findByTestId("schedules-no-pump")).toBeTruthy();
    expect(screen.getByTestId("schedules-no-pump").textContent).toBe("This panel has no execution port, so schedules do not fire.");
  });
});

describe("project settings carry the schedules section (spec §13.3)", () => {
  it("renders the project's schedules beside its checks", async () => {
    document.cookie = "orca_csrf=t";
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.startsWith("/api/control/schedules?")) return jsonResponse(list(schedule()));
      return new Response(JSON.stringify({ error: { code: "not-found", message: "" } }), { status: 404 });
    }) as typeof fetch;
    render(
      <ProjectSettings repoId="repo" repoLabel="Repo" repoPath="/r/repo" dir={false} workspace={null} integration={null}
        onWorkspaceMode={vi.fn()} onIntegrationScheme={vi.fn()} />,
    );
    const section = await screen.findByRole("region", { name: "Schedules" });
    expect(within(section).getByTestId("schedule-sch-nightly")).toBeTruthy();
  });
});

describe("the schedule detail's fire list (spec §13.3)", () => {
  it("words a skipped fire by its previous run and shows the reader a failed read quietly", async () => {
    serve((url) => url.startsWith("/api/control/schedules/sch-nightly/fires")
      ? { schema: "orca-schedule-fires-v1", scheduleId: "sch-nightly", fires: [fire({ outcome: "skipped", reason: "previous-active:fr-old", flowRunId: null })] }
      : {});
    render(<ScheduleDetail scheduleId="sch-nightly" />);
    await waitFor(() => expect(screen.getByTestId("schedule-fire-1")).toBeTruthy());
    expect(screen.getByTestId("schedule-fire-1").textContent).toContain(`Slot ${slotText(SLOT)} · fired ${slotText(SLOT + 60_000)} · skipped`);
    expect(screen.getByTestId("schedule-fire-1").textContent).toContain("Reason: previous-active:fr-old");
    // §13.3: a fire naming neither a run nor a group has no link.
    expect(within(screen.getByTestId("schedule-fire-1")).queryByRole("link")).toBeNull();
    cleanup();
    // A fetch that throws is caught by controlGet; the read is quiet (no alert).
    globalThis.fetch = (async () => { throw new Error("down"); }) as typeof fetch;
    render(<ScheduleDetail scheduleId="sch-nightly" />);
    await waitFor(() => expect(screen.getByTestId("schedule-fires-unread")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a scheduled group's page (spec §13.3, C13)", () => {
  const amount = (tokens: number): Amount => ({ tokens, activeMs: 0, attempts: 0, sessions: 0 });
  const groupView = (summary: Partial<GroupViewV1["summary"]> = {}, over: Partial<GroupViewV1> = {}): GroupViewV1 => ({
    schema: "orca-control-group-v1", epoch: "epoch-a", changeSeq: 1, graphVersion: 1,
    summary: {
      groupId: "g1", repoId: "repo", state: "draft", commandRevision: 5, projectionSeq: 1,
      stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0, goal: "Nightly goal", ...summary,
    },
    plan: { repoId: "repo", planId: "plan-1", planHash: "h".repeat(64), goal: "Nightly goal", successConditions: [] },
    proposal: { state: "editable", proposalVersion: 1, planHash: "h".repeat(64), budgetMode: null, contextPolicy: { handoffAtContextTokens: null }, profiles: null, executionSnapshotHash: null },
    ledger: { groupLimit: amount(9_000_000), used: amount(0), committedRemaining: amount(3_000_000), explicitUnallocatedReserve: amount(6_000_000), budgetDeficit: amount(0), usageUnknown: false, unmeteredRuns: 0 },
    allocations: [], workItems: [], estimates: [], runs: [], checkpoints: [], handoffRequests: [], stop: null, recoveryBlockers: [], recentCommandIds: [],
    ...over,
  });
  const send = (action: ControlAction): void => { void sendControlCommand(controlCommandPath(action), commandEnvelope(nextCommandId(), action)); };
  const page = (view: GroupViewV1, me: Me = owner): JSX.Element => as(me,
    <ControlGroupView view={view} config={config()} uncertain={[]} drafts={{}} onDraft={() => {}} onCommand={send} />);

  beforeEach(() => serve((url) => url === "/api/control/config" ? config() : {}));

  it("M-C13d no-scheduled-waiting-reason: shows the schedule and the fire's waiting reason", () => {
    const scheduled = groupView({ scheduleStart: { scheduleId: "sch-nightly", name: "Nightly", slot: SLOT, waitingReason: "limited" } });
    const { container: first } = render(page(scheduled));
    const start = within(first).getByTestId("group-schedule-start");
    expect(start.textContent).toContain("Started by schedule Nightly");
    // mutation: drop the waiting line, or its reason -> red
    expect(within(first).getByTestId("group-schedule-waiting").textContent).toContain("limited");
    const { container: second } = render(page(groupView({ scheduleStart: { scheduleId: "sch-nightly", name: "Nightly", slot: SLOT, waitingReason: null } })));
    expect(within(second).getByTestId("group-schedule-start").textContent).toContain("Started by schedule Nightly");
    expect(within(second).queryByTestId("group-schedule-waiting")).toBeNull();
  });

  it("M-C13a group-page-sends-schedule-set: sends one schedule-from-group and never schedule-set", async () => {
    render(page(groupView()));
    fireEvent.click(screen.getByRole("button", { name: "Schedule this group…" }));
    const dialog = screen.getByRole("dialog", { name: "Schedule this group…" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Nightly two" } });
    fireEvent.change(within(dialog).getByLabelText("Cron (minute hour day month weekday), at most hourly"), { target: { value: "0 4 * * *" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // mutation: send schedule-set from the group page -> red; a scheme change of the id -> red
    expect(posts[0]!.url).toBe("/api/control/groups/g1/schedule");
    expect(posts[0]!.body).toEqual({
      commandId: expect.any(String),
      expectedRevision: 5,
      payload: { scheduleId: "sch-nightly-two-6irmhu", name: "Nightly two", cron: "0 4 * * *", enabled: true },
    });
    expect(posts.some((post) => post.url.startsWith("/api/control/schedules"))).toBe(false);
    // A name with no Latin letters gets an id of its own, never the shared `sch-schedule`.
    expect(scheduleIdFor("夜间流程", "g1\u00000 4 * * *")).not.toBe("sch-schedule");
    expect(scheduleIdFor("夜间流程", "g1\u00000 4 * * *")).toMatch(/^sch-[a-z0-9][a-z0-9-]{0,59}$/);
  });

  it("M-C13c auto-with-delivery: the group dialog's confirm mode names the group's delivery", () => {
    const withScheme = groupView({}, {
      integration: { scheme: DAYLIGHT, schemeHash: "h", frozen: false, state: "idle", reason: null, lastIntegrated: null, integratedCommit: null, pr: null },
    });
    render(page(withScheme));
    fireEvent.click(screen.getByRole("button", { name: "Schedule this group…" }));
    const mode = screen.getByTestId("group-schedule-mode").textContent!;
    // mutation: render `.auto` for a group with a delivery scheme -> red
    expect(mode).not.toBe("Each fired group confirms on its own (unlimited tokens, no delivery scheme).");
    expect(mode).toContain("local");
  });

  it("sends the group source when the plan is saved to the library", async () => {
    render(page(groupView()));
    fireEvent.click(screen.getByRole("button", { name: "Save plan to library" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toBe("/api/control/plan-library/save");
    expect(posts[0]!.body).toEqual({
      commandId: expect.any(String),
      expectedRevision: 0,
      payload: { source: { kind: "group", groupId: "g1" }, name: "Nightly goal" },
    });
  });

  it("offers a member neither group action", () => {
    render(page(groupView(), member));
    // mutation: render either action for a member -> red
    expect(screen.queryByRole("button", { name: "Save plan to library" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Schedule this group…" })).toBeNull();
  });

  it("offers an archived group neither group action", () => {
    render(page(groupView({ archived: true })));
    // mutation: render either action for an archived group -> red
    expect(screen.queryByRole("button", { name: "Save plan to library" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Schedule this group…" })).toBeNull();
  });

  it("sends the draft's own hash when its split is saved to the library", async () => {
    const base = requirementView("awaiting-review");
    const view: RequirementViewV1 = { ...base, drafts: [{ ...base.drafts[0]!, draftHash: OLD_SHA }] };
    render(as(owner,
      <RequirementsPanel config={config()} summary={summaryWith(view)} views={{ r: view }} selected="r" agents={null}
        language="en" onSelect={() => {}} onCommand={send} />));
    fireEvent.click(screen.getByRole("button", { name: "Save split to library" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // mutation: send the draft number without its hash -> red
    expect(posts[0]!.url).toBe("/api/control/plan-library/save");
    expect(posts[0]!.body).toEqual({
      commandId: expect.any(String),
      expectedRevision: 0,
      payload: { source: { kind: "requirement-draft", groupId: "r", draftNo: 1, draftHash: OLD_SHA }, name: "markdown-export" },
    });
  });
});

/** The plan-library reads: the list route, then each entry's detail route. */
const serveLibrary = (entries: PlanLibraryEntryViewV1[], detail: PlanLibraryEntryViewV1 = entry()): void =>
  serve((url) => {
    if (url.startsWith("/api/control/plan-library?")) return libraryList(entries);
    if (url.startsWith("/api/control/plan-library/")) return detail;
    return {};
  });

describe("the project's plan library (spec §13.3, §14)", () => {
  const versions = (): PlanLibraryVersionV1[] => [
    version({ version: 1, sha256: OLD_SHA, origin: { kind: "group", groupId: "g1", planHash: "plan-h1" } }),
    version({ version: 2, sha256: NEW_SHA, origin: { kind: "requirement-draft", groupId: "g2", draftNo: 3, draftHash: OLD_SHA } }),
    version({ version: 3, sha256: "c".repeat(64), origin: { kind: "import", fileName: "plan.json", fileSha256: NEW_SHA, format: "orca-plan-v1" } }),
  ];

  it("lists an entry's versions with short shas, provenance, origins, used-by and a download of each version", async () => {
    const detail = entry({ usedBy: ["sch-a", "sch-b"], versionCount: 3, versions: versions() });
    serveLibrary([entry({ usedBy: ["sch-a", "sch-b"], versionCount: 3 })], detail);
    render(as(owner, <PlanLibraryView scope={{ repoId: "repo" }} />));
    const row = await screen.findByTestId("plan-library-entry-lib-1");
    expect(row.textContent).toContain("Nightly plan");
    expect(within(row).getByTestId("plan-library-in-use-lib-1").textContent).toBe("Used by 2 schedule(s); archive is refused while any schedule uses it.");
    const first = within(row).getByTestId("plan-library-version-lib-1-1");
    // mutation: show the whole sha, or drop by/via/at -> red
    expect(first.textContent).toContain(`Version aaaaaaaaaa — saved by olga via web at ${slotText(SLOT)} from group g1`);
    expect(within(first).getByRole("link", { name: "Download" }).getAttribute("href")).toBe(`/api/control/plan-library/lib-1/versions/${OLD_SHA}`);
    expect(within(first).getByRole("link", { name: "Download" }).hasAttribute("download")).toBe(true);
    expect(within(row).getByTestId("plan-library-version-lib-1-2").textContent).toContain("requirement draft 3 of group g2");
    expect(within(row).getByTestId("plan-library-version-lib-1-3").textContent).toContain("imported file plan.json");
    expect(within(row).getByTestId("plan-library-version-lib-1-2").textContent).toContain("bbbbbbbbbb");
  });

  it("imports a file as its bytes' sha and parsed doc under revision 0, then reads the library again", async () => {
    vi.stubGlobal("crypto", webcrypto);
    serveLibrary([entry()]);
    render(as(owner, <PlanLibraryView scope={{ repoId: "repo" }} />));
    await screen.findByTestId("plan-library-entry-lib-1");
    const doc = { goal: "nightly" };
    const bytes = JSON.stringify(doc);
    const file = new File([bytes], "my-plan.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Import a plan file"), { target: { files: [file] } });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toBe("/api/control/plan-library/import");
    // mutation: hash the name, or send the raw file instead of the parsed doc -> red
    expect(posts[0]!.body).toEqual({
      commandId: expect.any(String), expectedRevision: 0,
      payload: {
        projectId: "repo", name: "my-plan", doc,
        provenance: { fileName: "my-plan.json", fileSha256: createHash("sha256").update(bytes).digest("hex"), format: "orca-plan-v1" },
      },
    });
    expect(reads.filter((url) => url.startsWith("/api/control/plan-library?"))).toHaveLength(2);
  });

  it("names an unparsable file as invalid and sends nothing", async () => {
    vi.stubGlobal("crypto", webcrypto);
    serveLibrary([entry()]);
    render(as(owner, <PlanLibraryView scope={{ repoId: "repo" }} />));
    await screen.findByTestId("plan-library-entry-lib-1");
    fireEvent.change(screen.getByLabelText("Import a plan file"), { target: { files: [new File(["not json"], "bad.json", { type: "application/json" })] } });
    const alert = await screen.findByTestId("plan-library-import-invalid");
    expect(alert.textContent).toBe("That file is not a plan file.");
    expect(posts).toHaveLength(0);
  });

  it("imports the head version into a new group through the import-plan route, naming that entry and no plan", async () => {
    serveLibrary([entry()]);
    render(as(owner, <PlanLibraryView scope={{ repoId: "repo" }} />));
    await screen.findByTestId("plan-library-entry-lib-1");
    fireEvent.click(screen.getByRole("button", { name: "Import into a new group" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const body = posts[0]!.body;
    const payload = body.payload as { groupId: string; repoId: string; libraryEntry: { entryId: string; sha256: string } };
    expect(posts[0]!.url).toBe("/api/control/groups/import-plan");
    expect(body.expectedRevision).toBe(0);
    expect(payload.groupId).toMatch(/^group-/);
    expect(payload).toEqual({ groupId: payload.groupId, repoId: "repo", libraryEntry: { entryId: "lib-1", sha256: NEW_SHA } });
    expect(JSON.stringify(payload)).not.toContain("planId");
  });

  it("schedules the head version with exactly one schedule-set and never the group route", async () => {
    serveLibrary([entry()]);
    render(as(owner, <PlanLibraryView scope={{ repoId: "repo" }} />));
    await screen.findByTestId("plan-library-entry-lib-1");
    fireEvent.click(screen.getByRole("button", { name: "Schedule…" }));
    const form = screen.getByTestId("plan-library-schedule-form-lib-1");
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Nightly two" } });
    fireEvent.change(within(form).getByLabelText("Cron (minute hour day month weekday), at most hourly"), { target: { value: "0 4 * * *" } });
    fireEvent.change(within(form).getByRole("spinbutton", { name: "Token limit (empty: unlimited)" }), { target: { value: "500000" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // mutation: send through /groups/:id/schedule, or under the entry's revision -> red
    expect(posts[0]!.url).toMatch(/^\/api\/control\/schedules\/sch-nightly-two-[a-z0-9]{6}$/);
    expect(posts[0]!.body).toEqual({
      commandId: expect.any(String), expectedRevision: 0,
      payload: {
        projectId: "repo", name: "Nightly two", cron: "0 4 * * *", enabled: true,
        start: { kind: "group", entryId: "lib-1", sha256: NEW_SHA, tokenLimit: 500000, integration: null },
      },
    });
    expect(posts.some((post) => post.url.includes("/groups/"))).toBe(false);
  });

  it("gives each Schedule… create its own id even for the same name and cron", async () => {
    serveLibrary([entry()]);
    render(as(owner, <PlanLibraryView scope={{ repoId: "repo" }} />));
    const open = (await screen.findByRole("button", { name: "Schedule…" })) as HTMLButtonElement;
    const create = async (): Promise<void> => {
      await waitFor(() => expect(open.disabled).toBe(false));
      fireEvent.click(open);
      const form = screen.getByTestId("plan-library-schedule-form-lib-1");
      fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Nightly two" } });
      fireEvent.change(within(form).getByLabelText("Cron (minute hour day month weekday), at most hourly"), { target: { value: "0 4 * * *" } });
      fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    };
    await create();
    await waitFor(() => expect(posts).toHaveLength(1));
    await create();
    await waitFor(() => expect(posts).toHaveLength(2));
    // mutation: derive the id from the entry alone -> the second create reuses the removed row's id
    expect(posts[0]!.url).toMatch(/^\/api\/control\/schedules\/sch-nightly-two-[a-z0-9]{6}$/);
    expect(posts[1]!.url).toMatch(/^\/api\/control\/schedules\/sch-nightly-two-[a-z0-9]{6}$/);
    expect(posts[0]!.url).not.toBe(posts[1]!.url);
    for (const post of posts) {
      expect(post.body.payload).toEqual({
        projectId: "repo", name: "Nightly two", cron: "0 4 * * *", enabled: true,
        start: { kind: "group", entryId: "lib-1", sha256: NEW_SHA, tokenLimit: null, integration: null },
      });
    }
  });

  it("refuses a plan file over 3 MiB before reading it and sends nothing", async () => {
    serveLibrary([entry()]);
    render(as(owner, <PlanLibraryView scope={{ repoId: "repo" }} />));
    await screen.findByTestId("plan-library-entry-lib-1");
    const huge = new File([new Uint8Array(3 * 1024 * 1024 + 1)], "huge.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Import a plan file"), { target: { files: [huge] } });
    await waitFor(() => expect(screen.getByTestId("refusal-code").textContent).toBe("plan-library-doc-too-large"));
    expect(posts).toHaveLength(0);
  });

  it("archives the entry under revision 0", async () => {
    serveLibrary([entry()]);
    render(as(owner, <PlanLibraryView scope={{ repoId: "repo" }} />));
    await screen.findByTestId("plan-library-entry-lib-1");
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: "/api/control/plan-library/archive",
      body: { commandId: expect.any(String), expectedRevision: 0, payload: { entryId: "lib-1" } },
    });
  });

  it("lets a member read the entries and offers no write control", async () => {
    serveLibrary([entry()]);
    render(as(member, <PlanLibraryView scope={{ repoId: "repo" }} />));
    await screen.findByTestId("plan-library-entry-lib-1");
    // mutation: render any write control for a member -> red
    expect(screen.queryByLabelText("Import a plan file")).toBeNull();
    expect(screen.queryByRole("button", { name: "Import into a new group" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Schedule…" })).toBeNull();
    expect(screen.getByRole("note").textContent).toBe("Only the panel owner can change schedules.");
    expect(screen.getByTestId("plan-library-version-lib-1-1")).toBeTruthy();
  });

  it("says the library is empty, and says a failed read is a failed read", async () => {
    serve((url) => url.startsWith("/api/control/plan-library?") ? libraryList([]) : {});
    render(as(owner, <PlanLibraryView scope={{ repoId: "repo" }} />));
    expect(await screen.findByText("No plans yet. Save one from a group or a requirement split, or import a plan file.")).toBeTruthy();
    cleanup();
    serve((url) => url.startsWith("/api/control/plan-library?") ? {} : {});
    render(as(owner, <PlanLibraryView scope={{ repoId: "repo" }} />));
    const unread = await screen.findByTestId("plan-library-unread");
    expect(unread.textContent).toBe("The plan library could not be read.");
  });
});

/** The import form's own reads need no groups; a project scope names its one repository. */
const importConfig = (): ControlConfigV1 => ({
  ...config(), repositories: [{ repoId: "orca", displayName: "Orca" }], plans: [],
});
const importSummary: ControlSummaryV1 = {
  schema: "orca-control-summary-v1", epoch: "e", changeSeq: 1, resetRequired: false, dispatchBlocked: false, groups: [],
};
const importRecovery: RecoveryViewV1 = { schema: "orca-control-recovery-v1", epoch: "e", dispatchBlocked: false, blockers: [] };
const panel = (onCommand: (action: ControlAction) => void, controlConfig: ControlConfigV1 = importConfig()): JSX.Element => as(owner,
  <ControlPanel config={controlConfig} summary={importSummary} recovery={importRecovery} groups={{}} selected={null}
    drafts={{}} uncertain={[]} refusal={null} refetchRequired={false} scope={{ kind: "project", repoId: "orca" }} repoId="orca"
    onSelect={() => {}} onCommand={onCommand} onDraft={() => {}} />);

describe("the import form reads the plan library beside registered plans (spec §13.3, §14)", () => {
  it("says there is no plan anywhere when the repository has none and its library read is empty", async () => {
    serve((url) => url.startsWith("/api/control/plan-library?") ? libraryList([]) : {});
    render(panel(vi.fn()));
    const note = await screen.findByText(/^No plan to import yet/);
    // mutation: keep the old repository-only copy here -> red
    expect(note.textContent).toBe("No plan to import yet: save one to the plan library from a group or a requirement split, import a plan file, or register a tracked plan file below.");
    expect((screen.getByRole("button", { name: "Import plan" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("import-library")).toBeNull();
  });

  it("says no plan is configured when the library read fails and no plan is registered", async () => {
    serve((url) => {
      if (url.startsWith("/api/control/plan-library?")) throw new Error("down");
      return {};
    });
    render(panel(vi.fn()));
    await waitFor(() => expect(reads).toContain("/api/control/plan-library?repoId=orca"));
    const note = await screen.findByText("No plan is configured for this repository, so nothing can be imported into it.");
    // mutation: claim the library is empty (or the repository unset) after a failed read -> red
    expect(note).toBeTruthy();
    expect(screen.queryByText(/^No plan to import yet/)).toBeNull();
    expect(screen.queryByText("No trusted repository and plan are configured for this panel.")).toBeNull();
    expect((screen.getByRole("button", { name: "Import plan" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Import for a selected entry with no head and does not fall back to the registered plan", async () => {
    const withPlan: ControlConfigV1 = { ...importConfig(), plans: [{ planId: "plan-1", repoId: "orca", displayName: "Registered plan" }] };
    const headless = entry({ entryId: "lib-empty", projectId: "orca", name: "Headless plan", usedBy: [], head: null, versionCount: 0, versions: [] });
    serve((url) => url.startsWith("/api/control/plan-library?") ? libraryList([headless]) : {});
    const onCommand = vi.fn();
    render(panel(onCommand, withPlan));
    const select = await screen.findByTestId("import-library");
    const option = within(select).getByRole("option", { name: "Headless plan" }) as HTMLOptionElement;
    fireEvent.change(select, { target: { value: option.value } });
    const button = screen.getByRole("button", { name: "Import plan" }) as HTMLButtonElement;
    // mutation: fall back to the registered plan -> enabled and an import dispatched
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("lists a library entry with its short sha and imports it instead of a registered plan", async () => {
    const one = entry({ entryId: "lib-9", projectId: "orca", name: "Plan nine", usedBy: [], head: version({ version: 1, sha256: NEW_SHA }), versions: [] });
    serve((url) => url.startsWith("/api/control/plan-library?") ? libraryList([one]) : {});
    const onCommand = vi.fn();
    render(panel(onCommand));
    const select = await screen.findByTestId("import-library");
    expect(within(select).getByRole("option", { name: `Plan nine · ${NEW_SHA.slice(0, 10)}` })).toBeTruthy();
    fireEvent.change(select, { target: { value: "lib-9" } });
    const button = screen.getByRole("button", { name: "Import plan" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onCommand).toHaveBeenCalledTimes(1);
    // mutation: send the registered plan (there is none) or omit the entry's sha -> red
    const action = onCommand.mock.calls[0]![0] as Extract<ControlAction, { verb: "import-plan" }>;
    expect(action.verb).toBe("import-plan");
    expect(action.payload).toEqual({ groupId: action.groupId, repoId: "orca", libraryEntry: { entryId: "lib-9", sha256: NEW_SHA } });
  });
});

describe("the board and the run page name the schedule that started a run (spec §13.3, §14)", () => {
  const flowRun = (over: Partial<FlowListV1["runs"][number]> = {}): FlowListV1["runs"][number] => ({
    flowRunId: "fr-a", groupId: "g", templateRef: "builtin/dev@1", state: "running", poolTokens: 1000, poolDrawn: 0,
    projectId: null, dir: null, needsYou: 0, scheduled: null, ...over,
  });

  it("badges a scheduled flow card and leaves a hand-started card bare", () => {
    render(<BoardView groups={[]} scope={{ kind: "project", repoId: "repo" }} onOpen={() => {}} onCommand={() => {}}
      flows={[flowRun({ scheduled: { scheduleId: "sch-a", name: "Nightly", slot: SLOT } }), flowRun({ flowRunId: "fr-b" })]} />);
    expect(within(screen.getByTestId("board-flow-fr-a")).getByTestId("board-flow-scheduled").textContent).toBe("scheduled · Nightly");
    expect(within(screen.getByTestId("board-flow-fr-b")).queryByTestId("board-flow-scheduled")).toBeNull();
  });

  const flowSpend = (tokens: number | null): FlowSpendV1 => ({ tokens, unknownReason: null, usd: null, usdReason: "the tool reports no money amount", runs: [] });
  const policy = { value: "confirm" as const, source: "schedule" as const, lockedBy: null };
  const ask = { kind: "effect-confirm" as const, recordId: "eff-1", stepKey: "send", effectKind: "wechat-draft", class: "external", policy, summary: "title: Tea, slowly" };
  const execution: FlowExecutionViewV1 = {
    seq: 1, state: "needs-person", reasons: [], planNo: null, childGroupId: null, by: "orca-auto", via: "orca", flags: [],
    failure: null, output: null, toolRules: null, ask, needsYou: null, reported: null, warnings: [], effectRecordId: "eff-1", spend: flowSpend(0),
  };
  const runView = (over: Partial<FlowRunViewV1> = {}): FlowRunViewV1 => ({
    schema: "orca-flow-run-view-v1", flowRunId: "fr-a", groupId: "g", templateRef: "builtin/dev@1", state: "running",
    params: {}, poolTokens: 1000, poolDrawn: 0, by: "olga", via: "web", dir: null,
    scheduled: { scheduleId: "sch-a", name: "Nightly", slot: SLOT }, template: { id: "dev", version: 1, title: null },
    steps: [{
      stepKey: "send", kind: "work", head: null, executor: null, parallelWith: null, effect: null, latest: execution, executions: [execution],
      clarify: null, clarifyRevision: null, mark: null, heldBy: [], deferHolds: [], whenParams: [], spend: flowSpend(0),
    }],
    openAsks: [{ stepKey: "send", seq: 1, ask }], plans: [], intakes: [], spend: flowSpend(0),
    effects: [{
      id: "eff-1", flowRunId: "fr-a", stepKey: "send", seq: 1, effectKind: "wechat-draft", class: "external", level: "confirm",
      policy, state: "staged", payloadHash: "p", remoteRef: null, by: "orca-auto", via: "orca", createdAt: 1, updatedAt: 1,
    }],
    decisions: [],
    ...over,
  });
  const journal = { schema: "orca-flow-journal-v1", flowRunId: "fr-a", messages: [] };

  it("badges the run and words both its confirm card and its effect row as held for the person", async () => {
    serve((url) => url.endsWith("/journal") ? journal : runView());
    render(as(owner, <FlowRunPage flowRunId="fr-a" />));
    await waitFor(() => expect(screen.getByTestId("flow-run-state")).toBeTruthy());
    expect(screen.getByTestId("flow-run-scheduled").textContent).toBe("scheduled · Nightly");
    // mutation: word a schedule-clamped policy as "level confirm, from schedule" -> red
    expect(within(screen.getByRole("group", { name: "Confirm send" })).getByTestId("flow-policy").textContent).toBe("held for you: started by a schedule");
    expect(within(screen.getByTestId("flow-effect-eff-1")).getByTestId("flow-policy").textContent).toBe("held for you: started by a schedule");
    cleanup();
    serve((url) => url.endsWith("/journal") ? journal : runView({ scheduled: null }));
    render(as(owner, <FlowRunPage flowRunId="fr-a" />));
    await waitFor(() => expect(screen.getByTestId("flow-run-state")).toBeTruthy());
    expect(screen.queryByTestId("flow-run-scheduled")).toBeNull();
  });
});
