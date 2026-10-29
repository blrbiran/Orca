// @vitest-environment jsdom
import { act, cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { AccountContext } from "../src/AuthGate.js";
import { decisionRow, installFakePanel } from "./fixtures/twoProjects.js";
import type { Me } from "../src/auth.js";
import { pickOption } from "./selectControl.js";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { window.location.hash = ""; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); window.localStorage.clear(); window.sessionStorage.clear(); });
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
function setup() {
 const panel = installFakePanel(); const base = globalThis.fetch;
 let todoFail = false; let hold: Promise<Response> | null = null;
 globalThis.fetch = (async (input, init) => {
  if (String(input) === "/api/control/overview") return json({ schema: "orca-control-overview-v1", epoch: panel.summary.epoch, changeSeq: panel.summary.changeSeq, groups: [], steps: [], issues: [] });
  if (String(input) === "/api/todo" && hold) { panel.requests.push("GET /api/todo"); return hold; }
  if (String(input) === "/api/todo" && todoFail) return json({ code: "todo-failed", message: "todo failed" }, 503);
  return base(input, init);
 }) as typeof fetch;
 return { panel, fail: () => { todoFail = true; }, hold: (value: Promise<Response> | null) => { hold = value; } };
}
it("shows independent todo changes at the next 5000ms refresh with unchanged control seq, and stops inactive reads", async () => {
 const { panel } = setup(); panel.todo = [decisionRow("alpha", "before")]; render(<App />); await flush();
 expect(within(screen.getByRole("region", { name: "Overview" })).getByRole("button", { name: /before/ })).toBeTruthy();
 panel.todo = [decisionRow("alpha", "after")]; await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
 const queue = within(screen.getByRole("region", { name: "Needs your attention" }));
 expect(queue.getByRole("button", { name: /after/ })).toBeTruthy(); expect(queue.queryByRole("button", { name: /before/ })).toBeNull();
 const reads = panel.requests.filter((r) => r === "GET /api/todo").length;
 fireEvent.click(screen.getByRole("link", { name: "Memory" })); await flush();
 await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
 expect(panel.requests.filter((r) => r === "GET /api/todo")).toHaveLength(reads);
 expect(panel.requests.filter((r) => r.startsWith("GET /api/decision?"))).toHaveLength(0); expect(panel.posts).toHaveLength(0);
});
it("a failed todo refresh retains explicitly stale rows and an unavailable badge, never a false empty queue", async () => {
 const { panel, fail } = setup(); panel.todo = [decisionRow("alpha", "retained")]; render(<App />); await flush(); fail();
 await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
 const page = within(screen.getByRole("region", { name: "Overview" }));
 expect(page.getByRole("button", { name: /retained/ })).toBeTruthy();
 expect(page.getByText(/Decisions.*stale/)).toBeTruthy(); expect(screen.getByTestId("nav-count-decisions").textContent).toBe("—");
 expect(page.queryByText("Nothing needs your attention.")).toBeNull();
});
it("an initial todo failure exposes unavailable, without inventing a zero count", async () => {
  // Ruling: human 「这次批准改写所有必要的判据」 (session b999cc81): a scope switch made through the sidebar picker drops late todo replies
 const source = setup(); source.fail(); render(<App />); await flush();
 expect(screen.getByTestId("nav-count-decisions").textContent).toBe("—");
 expect(within(screen.getByRole("region", { name: "Overview" })).getByText(/Decisions.*unavailable/)).toBeTruthy();
 expect(screen.queryByText(/Nothing to review/)).toBeNull();
 expect(screen.getByTestId("decision-count").textContent).toBe("—");
});
it.each(["scope", "epoch", "auth"])("drops late todo replies across %s identity", async (kind) => {
 const source = setup(); source.panel.todo = [decisionRow("alpha", "initial")];
 const me = (id: string): Me => ({ user: { id, name: id, roles: ["owner"], mustChangePassword: false }, expiresAt: 100000, sessionDays: 1 });
 const rendered = render(<AccountContext.Provider value={me("one")}><App /></AccountContext.Provider>); await flush();
 let release!: (value: Response) => void; source.hold(new Promise((resolve) => { release = resolve; }));
 await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
 source.hold(null); source.panel.todo = [decisionRow(kind === "scope" ? "beta" : "alpha", "current")];
 if (kind === "scope") await pickOption(screen.getByRole("combobox", { name: "Project" }), "Beta");
 if (kind === "epoch") { source.panel.summary.epoch = "epoch-b"; source.panel.recovery.epoch = "epoch-b"; await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); }
 if (kind === "auth") rendered.rerender(<AccountContext.Provider value={me("two")}><App /></AccountContext.Provider>);
 await flush();
 await act(async () => { release(json({ rows: [decisionRow("alpha", "obsolete")] })); }); await flush();
 const queue = within(screen.getByRole("region", { name: "Needs your attention" }));
 expect(queue.getByRole("button", { name: /current/ })).toBeTruthy(); expect(queue.queryByRole("button", { name: /obsolete/ })).toBeNull();
});
it("latest successful refresh wins over an older late request in the same scope", async () => {
 const source = setup(); render(<App />); await flush(); let release!: (value: Response) => void;
 source.hold(new Promise((resolve) => { release = resolve; })); await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
 source.hold(null); source.panel.todo = [decisionRow("alpha", "latest")]; await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
 await act(async () => { release(json({ rows: [decisionRow("alpha", "older")] })); }); await flush();
 const queue = within(screen.getByRole("region", { name: "Needs your attention" }));
 expect(queue.getByRole("button", { name: /latest/ })).toBeTruthy(); expect(queue.queryByRole("button", { name: /older/ })).toBeNull();
});

it.each(["progress", "recovery"])("%s failures retain stale facts while independent decision work stays visible", async (kind) => {
 const source = setup(); source.panel.todo = [decisionRow("alpha", "independent")]; const base = globalThis.fetch; let fail = false;
 globalThis.fetch = (async (input, init) => {
  if (String(input) === (kind === "progress" ? "/api/control/overview" : "/api/control/recovery") && fail) return json({ code: "source-failed", message: "source failed" }, 503);
  return base(input, init);
 }) as typeof fetch;
 render(<App />); await flush(); fail = true; await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
 const page = within(screen.getByRole("region", { name: "Overview" }));
 expect(page.getByRole("button", { name: /independent/ })).toBeTruthy();
 expect(page.getByText(new RegExp((kind === "progress" ? "Progress" : "Recovery") + ".*stale"))).toBeTruthy();
 expect(page.queryByText("Nothing needs your attention.")).toBeNull();
});
it.each(["progress", "recovery"])("drops late %s replies across epoch change rather than displacing current source", async (kind) => {
 const source = setup(); const base = globalThis.fetch; let held: Promise<Response> | null = null; let holds = 0;
 globalThis.fetch = (async (input, init) => {
  if (String(input) === (kind === "progress" ? "/api/control/overview" : "/api/control/recovery") && held && holds++ === (kind === "recovery" ? 1 : 0)) return held;
  return base(input, init);
 }) as typeof fetch;
 render(<App />); await flush(); let release!: (value: Response) => void;
 held = new Promise((resolve) => { release = resolve; }); await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
 held = null; source.panel.summary.epoch = "epoch-b"; source.panel.recovery.epoch = "epoch-b";
 await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); await flush();
 await act(async () => { release(json(kind === "progress"
  ? { schema: "orca-control-overview-v1", epoch: "epoch-a", changeSeq: 99, groups: [], steps: [], issues: [{ groupId: null, repoId: null, reason: "obsolete-projection" }] }
  : { schema: "orca-control-recovery-v1", epoch: "epoch-a", dispatchBlocked: true, blockers: [{ scope: "global", groupId: "x", runId: null, code: "obsolete-recovery", evidenceIds: [] }] })); }); await flush();
 const page = within(screen.getByRole("region", { name: "Overview" }));
 expect(page.queryByText(/obsolete-(projection|recovery)/)).toBeNull(); expect(page.getByText("Nothing needs your attention.")).toBeTruthy();
});

it("an older failed todo request cannot mark the latest successful source stale", async () => {
 const source = setup(); render(<App />); await flush(); let release!: (value: Response) => void;
 source.hold(new Promise((resolve) => { release = resolve; })); await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
 source.hold(null); source.panel.todo = [decisionRow("alpha", "successful")]; await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
 await act(async () => { release(json({ code: "late-failure", message: "late failure" }, 503)); }); await flush();
 expect(screen.getByTestId("nav-count-decisions").textContent).toBe("1");
 expect(within(screen.getByRole("region", { name: "Overview" })).queryByText(/Decisions.*stale/)).toBeNull();
});
it("a lower overview changeSeq cannot replace the most recently accepted projection", async () => {
 const source = setup(); const base = globalThis.fetch; let seq = 10;
 globalThis.fetch = (async (input, init) => String(input) === "/api/control/overview"
  ? json({ schema: "orca-control-overview-v1", epoch: "epoch-a", changeSeq: seq, groups: [], steps: [], issues: [{ groupId: null, repoId: null, reason: "projection-" + seq }] }) : base(input, init)) as typeof fetch;
 render(<App />); await flush(); seq = 9; await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
 const page = within(screen.getByRole("region", { name: "Overview" }));
 expect(page.getByText(/projection-10/)).toBeTruthy(); expect(page.queryByText(/projection-9/)).toBeNull();
});
