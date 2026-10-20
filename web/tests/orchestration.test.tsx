// @vitest-environment jsdom
/**
 * Kanban spec 2026-10-20 §3.1-§3.2 (session 9ec98639): the group view says where a confirmed group is on its way to
 * starting on its own; a start refused again and again needs the person (and puts the group under attention); the
 * running-group cap is set in Global settings.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import { ControlGroupView } from "../src/ControlGroupView.js";
import type { GroupOrchestrationV1, GroupSummaryV1 } from "../src/controlTypes.js";
import { groupCategory } from "../src/groupCategory.js";
import { OrchestrationSettings } from "../src/OrchestrationSettings.js";
import type { Me } from "../src/auth.js";
import { config, view, workItem } from "./fixtures/board.js";

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };

const showGroup = (orchestration: GroupOrchestrationV1 | undefined) => {
  const base = view([workItem({ taskId: "a" })]);
  render(<ControlGroupView focus={{ kind: "group", groupId: "g", region: "progress", taskId: null, runId: null }}
    view={{ ...base, summary: { ...base.summary, state: "ready", ...(orchestration === undefined ? {} : { orchestration }) } }}
    config={config} uncertain={[]} drafts={{}} onDraft={vi.fn()} onCommand={vi.fn()} />);
};
const o = (over: Partial<GroupOrchestrationV1>): GroupOrchestrationV1 => ({ mode: "run", state: "queued", waitingFor: [], refusal: null, ...over });

afterEach(cleanup);

describe("the group's way to starting on its own (kanban spec §3.1-§3.4)", () => {
  it("says queued, held, waiting for a slot, waiting for a group, and a refusal being retried", () => {
    const lines: Array<[GroupOrchestrationV1, string]> = [
      [o({}), "Confirmed: starts on its own on the next pass."],
      [o({ mode: "hold", state: "held" }), "Confirmed only: not started. Start it when you are ready."],
      [o({ state: "waiting-slot" }), "Confirmed: waiting for a free slot (the running-group cap is reached)."],
      [o({ state: "waiting-prerequisite", waitingFor: ["g1", "g2"] }), "Confirmed: waiting for g1, g2 to land first."],
      [o({ state: "backoff", refusal: { code: "estimate-in-flight", count: 1, persistent: false } }), "The automatic start was refused (estimate-in-flight); it is tried again shortly."],
    ];
    for (const [value, text] of lines) {
      showGroup(value);
      expect(screen.getByTestId("orchestration-line").textContent).toBe(text);
      expect(screen.getByTestId("orchestration-line").getAttribute("role")).toBe("status");
      cleanup();
    }
  });

  it("a start refused again and again is an alert, and puts the group under attention", () => {
    const refused = o({ state: "backoff", refusal: { code: "recovery-blocked", count: 5, persistent: true } });
    showGroup(refused);
    // mutation: drop the persistent branch -> role status, red
    expect(screen.getByTestId("orchestration-line").getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("orchestration-line").textContent).toContain("refused 5 times in a row (recovery-blocked)");
    const summary = { groupId: "g", repoId: "r", state: "ready", commandRevision: 1, projectionSeq: 1, stopMode: null, stopState: null, claimBlocked: false, recoveryBlockerCount: 0 } as GroupSummaryV1;
    // mutation: drop the orchestration clause in needsAttention -> "not-started", red
    expect(groupCategory({ ...summary, orchestration: refused })).toBe("attention");
    expect(groupCategory({ ...summary, orchestration: o({ state: "backoff", refusal: { code: "x", count: 1, persistent: false } }) })).toBe("not-started");
  });

  it("says nothing once the group started, or with no orchestration at all", () => {
    showGroup(o({ state: "started" }));
    expect(screen.queryByTestId("orchestration-line")).toBeNull();
    cleanup();
    showGroup(undefined);
    expect(screen.queryByTestId("orchestration-line")).toBeNull();
  });
});

describe("the running-group cap setting (kanban spec §3.2)", () => {
  let posts: Array<{ url: string; body: unknown }>;
  beforeEach(() => {
    posts = [];
    document.cookie = "orca_csrf=t";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input), method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/control/orchestration") return jsonResponse({ schema: "orca-orchestration-v1", revision: 2, maxRunningGroups: 3, runningGroups: 1 });
      if (method === "POST") { posts.push({ url, body: JSON.parse(String(init!.body)) }); return jsonResponse({ schema: "orca-command-success-v1" }); }
      throw new Error(`unexpected request: ${method} ${url}`);
    }) as typeof fetch;
  });

  it("shows how many run and sends the new cap at the read revision", async () => {
    render(<AccountContext.Provider value={owner}><OrchestrationSettings /></AccountContext.Provider>);
    await waitFor(() => expect(screen.getByText("1 of at most 3 groups are running. A confirmed group starts on its own when a slot is free.")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("At most this many groups run at once"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ url: "/api/control/operator/set-orchestration-settings", body: { expectedRevision: 2, payload: { maxRunningGroups: 5 } } });
  });
});
