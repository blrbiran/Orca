// @vitest-environment jsdom
/**
 * Accounts spec §5.3, §6, §7: the Usage panel shows what GET /api/control/usage answers -- headline totals, a row per
 * model (the null model is the unattributed bucket, never a model named "unattributed"), the unattributed and
 * mismatched counts, and each cap with used / committed / headroom. An owner sets and clears caps and the calendar in
 * place, at the view's spendRevision, with the CSRF header; a member gets none of those controls. With no cap the panel
 * says nothing is gated (spec §6.3 last line). The numbers are distinct, so no assertion passes on another field's value.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import type { UsageViewV1 } from "../src/controlTypes.js";
import { UsagePanel } from "../src/UsagePanel.js";
import i18n from "../src/i18n.js";

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const VIEW: UsageViewV1 = {
  schema: "orca-usage-view-v1", scope: "all", from: null, to: null, now: Date.UTC(2026, 9, 8), calendar: { timeZone: "Europe/Berlin", weekStart: 1 },
  spendRevision: 3,
  headline: { total: 98765, week: 4321, month: 8642 },
  range: {
    tokens: 7777,
    byModel: [
      { model: "claude-haiku-4-5", input: 11, output: 12, cacheRead: 13, cacheWrite: 14, tokens: 50 },
      { model: "claude-opus-5-5", input: 101, output: 102, cacheRead: 103, cacheWrite: 104, tokens: 410 },
      { model: null, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 7317 },
    ],
    groups: [{ key: "claude-haiku-4-5", tokens: 50 }, { key: "claude-opus-5-5", tokens: 410 }, { key: null, tokens: 7317 }],
  },
  counts: { unattributedRows: 1, breakdownMismatchRows: 2, unknownUsageRuns: 0 },
  caps: [{ scope: "all", period: "week", tokens: 1000, updatedAt: 1, updatedBy: "user:u1", used: 400, committed: 100, headroom: 500, from: 0, to: 1 }],
};

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };

interface Call { method: string; url: string; headers: Record<string, string>; body: unknown }
let calls: Call[];
let view: UsageViewV1;

beforeEach(() => {
  calls = []; view = VIEW;
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input), method = init?.method ?? "GET";
    calls.push({ method, url, headers: { ...(init?.headers as Record<string, string> | undefined) }, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    if (method === "GET" && url.startsWith("/api/control/usage?")) return jsonResponse(view);
    if (method === "POST" && url.startsWith("/api/control/operator/")) return jsonResponse({ schema: "orca-command-success-v1" });
    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); });

const reads = (): URLSearchParams[] => calls.filter((call) => call.method === "GET").map((call) => new URL(call.url, "http://panel.test").searchParams);
const lastRead = (): Record<string, string> => Object.fromEntries(reads().at(-1)!.entries());
function renderAs(me: Me | null, project: string | null = null): void {
  render(<AccountContext.Provider value={me}><UsagePanel project={project} /></AccountContext.Provider>);
}

describe("UsagePanel (spec §5.3, §6, §7)", () => {
  it("renders the headline, a row per model with the null model unattributed, the counts and the cap", async () => {
    renderAs(member);
    await screen.findByTestId("usage-total");
    expect(lastRead()).toEqual({ scope: "all", groupBy: "model" });
    expect(screen.getByTestId("usage-total").textContent).toBe("98765");
    expect(screen.getByTestId("usage-week").textContent).toBe("4321");
    expect(screen.getByTestId("usage-month").textContent).toBe("8642");
    const rows = screen.getAllByRole("row").map((row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent));
    expect(rows).toContainEqual(["claude-haiku-4-5", "11", "12", "13", "14", "50"]);
    expect(rows).toContainEqual(["claude-opus-5-5", "101", "102", "103", "104", "410"]);
    expect(rows).toContainEqual(["unattributed", "0", "0", "0", "0", "7317"]);
    expect(screen.getByTestId("usage-unattributed").textContent).toMatch(/unattributed[^0-9]*1$/i);
    expect(screen.getByTestId("usage-mismatch").textContent).toMatch(/2$/);
    expect(screen.getByTestId("usage-unknown").textContent).toMatch(/0$/);
    expect(rows).toContainEqual(["all projects", "weekly", "1000", "400", "100", "500"]);
  });

  // Spec §14 / final review Important 2: the total and the all-time caps count pre-ledger tokens that no range holds, so
  // with no range bounds the page names the difference (total - range) on one line, in each language; with bounds, or
  // with nothing before the ledger, it says nothing.
  it("names the tokens that predate per-model tracking when the total exceeds the all-time range, in English and Chinese", async () => {
    renderAs(member);
    expect((await screen.findByTestId("usage-pre-ledger")).textContent).toBe(
      "Total and all-time caps include 90988 tokens used before per-model tracking began; they are in no range.",
    );
    cleanup();
    await i18n.changeLanguage("zh");
    try {
      renderAs(member);
      expect((await screen.findByTestId("usage-pre-ledger")).textContent).toBe("总量和全期上限里有 90988 个 token 用在按模型统计开始之前；它们不属于任何区间。");
    } finally { await i18n.changeLanguage("en"); }
    cleanup();
    view = { ...VIEW, headline: { ...VIEW.headline, total: VIEW.range.tokens } };
    renderAs(member);
    await screen.findByTestId("usage-total");
    expect(screen.queryByTestId("usage-pre-ledger")).toBe(null);
    cleanup();
    view = { ...VIEW, from: 1, to: 2 };
    renderAs(member);
    await screen.findByTestId("usage-total");
    expect(screen.queryByTestId("usage-pre-ledger")).toBe(null);
  });

  it("gives an owner Set, Clear and the calendar form; Set POSTs set-spend-cap at the spend revision with the CSRF header", async () => {
    renderAs(owner);
    const row = await screen.findByTestId("cap-all/week");
    expect(within(row).getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByRole("form", { name: /usage calendar/i })).toBeTruthy();
    fireEvent.change(within(row).getByRole("textbox"), { target: { value: "2000" } });
    fireEvent.click(within(row).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(1));
    const [post] = calls.filter((call) => call.method === "POST");
    expect(post!.url).toBe("/api/control/operator/set-spend-cap");
    expect(post!.headers["x-orca-csrf"]).toBe("t");
    const body = post!.body as { commandId: unknown; expectedRevision: unknown; payload: unknown };
    expect(typeof body.commandId).toBe("string");
    expect(body).toEqual({ commandId: body.commandId, expectedRevision: 3, payload: { scope: "all", period: "week", tokens: 2000 } });
    // The answer is read back, not assumed.
    await waitFor(() => expect(reads().length).toBe(2));
  });

  it("shows a cap grouped, sends a typed grouped amount as an integer, and holds Set while the text is not an amount (spec §9.2 item 3)", async () => {
    view = { ...VIEW, caps: [{ ...VIEW.caps[0]!, tokens: 1_234_567 }] };
    renderAs(owner);
    const row = await screen.findByTestId("cap-all/week");
    const field = within(row).getByRole("textbox") as HTMLInputElement;
    expect(field.value).toBe("1,234,567");
    fireEvent.change(field, { target: { value: "2 500 000" } });
    fireEvent.change(field, { target: { value: "2.5" } });
    expect((within(row).getByRole("button", { name: "Set" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "2 500 000" } });
    fireEvent.click(within(row).getByRole("button", { name: "Set" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(1));
    expect((calls.find((call) => call.method === "POST")!.body as { payload: unknown }).payload).toEqual({ scope: "all", period: "week", tokens: 2_500_000 });
  });

  it("adds a cap from a grouped amount and not from invalid text", async () => {
    renderAs(owner);
    const form = await screen.findByRole("form", { name: "New spend cap" });
    const field = within(form).getByRole("textbox", { name: "cap" });
    const add = within(form).getByRole("button", { name: "Add cap" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "1e6" } });
    expect(add.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "3,000,000" } });
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(1));
    expect((calls.find((call) => call.method === "POST")!.body as { payload: { tokens: number } }).payload.tokens).toBe(3_000_000);
  });

  it("sends Clear and the calendar as their own verbs", async () => {
    renderAs(owner);
    const row = await screen.findByTestId("cap-all/week");
    fireEvent.click(within(row).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(1));
    fireEvent.change(screen.getByLabelText(/time zone/i), { target: { value: "Asia/Tokyo" } });
    fireEvent.change(screen.getByLabelText(/week starts on/i), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /save calendar/i }));
    await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(2));
    const posts = calls.filter((call) => call.method === "POST").map((call) => [call.url, (call.body as { payload: unknown }).payload]);
    expect(posts).toEqual([
      ["/api/control/operator/clear-spend-cap", { scope: "all", period: "week" }],
      ["/api/control/operator/set-usage-calendar", { timeZone: "Asia/Tokyo", weekStart: 7 }],
    ]);
  });

  it("looks an unanswered cap command up under @spend and shows the refusal it was given", async () => {
    let commandId = "";
    const answered = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === "/api/control/operator/clear-spend-cap") {
        commandId = (JSON.parse(String(init!.body)) as { commandId: string }).commandId;
        calls.push({ method: "POST", url, headers: {}, body: undefined });
        return jsonResponse({}, 503);
      }
      if (url.startsWith("/api/control/groups/")) {
        calls.push({ method: "GET", url, headers: {}, body: undefined });
        return jsonResponse({ schema: "orca-command-lookup-v1", originalStatus: 409, body: { error: { code: "revision-conflict", message: "the spend settings moved on", commandRevision: 4, evidenceIds: [], retryable: false } } });
      }
      return answered(input, init);
    }) as typeof fetch;
    renderAs(owner);
    const row = await screen.findByTestId("cap-all/week");
    fireEvent.click(within(row).getByRole("button", { name: "Clear" }));
    expect((await screen.findByTestId("refusal-code")).textContent).toBe("revision-conflict");
    expect(calls.map((call) => call.url)).toContain(`/api/control/groups/%40spend/commands/${commandId}`);
  });

  it("shows only the newest read when an older answer arrives late", async () => {
    let release: (() => void) | null = null;
    const answered = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      // The first (scope=all) read is held until after the project read has answered.
      if (url.startsWith("/api/control/usage?scope=all") && release === null) {
        await new Promise<void>((resolve) => { release = resolve; });
        return jsonResponse({ ...VIEW, headline: { ...VIEW.headline, total: 111 } });
      }
      return answered(input, init);
    }) as typeof fetch;
    view = { ...VIEW, scope: "repo:alpha-11111111", headline: { ...VIEW.headline, total: 222 } };
    renderAs(member, "alpha-11111111");
    await waitFor(() => expect(release).not.toBeNull());
    fireEvent.change(screen.getByLabelText(/^scope/i), { target: { value: "project" } });
    await waitFor(() => expect(screen.getByTestId("usage-total").textContent).toBe("222"));
    release!();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByTestId("usage-total").textContent).toBe("222");
  });

  it("keeps a failed re-read's refusal after a command that succeeded", async () => {
    renderAs(owner);
    const row = await screen.findByTestId("cap-all/week");
    const answered = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).startsWith("/api/control/usage?")) return jsonResponse({ error: { code: "usage-store-busy", message: "the store is busy", commandRevision: null, evidenceIds: [], retryable: true } }, 409);
      return answered(input, init);
    }) as typeof fetch;
    fireEvent.click(within(row).getByRole("button", { name: "Clear" }));
    expect((await screen.findByTestId("refusal-code")).textContent).toBe("usage-store-busy");
  });

  it("re-seeds the calendar form from the server after a refused save", async () => {
    renderAs(owner);
    await screen.findByTestId("usage-total");
    const answered = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input) === "/api/control/operator/set-usage-calendar") {
        calls.push({ method: "POST", url: String(input), headers: {}, body: undefined });
        // Another owner changed the calendar first.
        view = { ...VIEW, calendar: { timeZone: "America/New_York", weekStart: 7 }, spendRevision: 4 };
        return jsonResponse({ error: { code: "revision-conflict", message: "the spend settings moved on", commandRevision: 4, evidenceIds: [], retryable: false } }, 409);
      }
      return answered(input, init);
    }) as typeof fetch;
    fireEvent.change(screen.getByLabelText(/time zone/i), { target: { value: "Asia/Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: /save calendar/i }));
    expect((await screen.findByTestId("refusal-code")).textContent).toBe("revision-conflict");
    await waitFor(() => expect((screen.getByLabelText(/time zone/i) as HTMLInputElement).value).toBe("America/New_York"));
    expect((screen.getByLabelText(/week starts on/i) as HTMLSelectElement).value).toBe("7");
  });

  it("keeps an unresolved command's id and looks it up again on request", async () => {
    let lookups = 0;
    const answered = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === "/api/control/operator/clear-spend-cap") return jsonResponse({}, 503);
      if (url.startsWith("/api/control/groups/%40spend/commands/")) {
        lookups += 1;
        if (lookups === 1) return jsonResponse({ error: { code: "panel-internal-error", message: "try later", commandRevision: null, evidenceIds: [], retryable: true } }, 500);
        return jsonResponse({ schema: "orca-command-lookup-v1", originalStatus: 200, body: { schema: "orca-command-success-v1" } });
      }
      return answered(input, init);
    }) as typeof fetch;
    renderAs(owner);
    const row = await screen.findByTestId("cap-all/week");
    fireEvent.click(within(row).getByRole("button", { name: "Clear" }));
    const again = await screen.findByRole("button", { name: "Look it up again" });
    fireEvent.click(again);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Look it up again" })).toBeNull());
    expect(lookups).toBe(2);
  });

  it("says a lost cap command that never reached the ledger was not applied", async () => {
    const answered = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === "/api/control/operator/clear-spend-cap") return jsonResponse({}, 503);
      if (url.startsWith("/api/control/groups/%40spend/commands/")) return jsonResponse({ error: { code: "command-result-not-found", message: "No retained command result was found.", commandRevision: null, evidenceIds: [], retryable: false } }, 404);
      return answered(input, init);
    }) as typeof fetch;
    renderAs(owner);
    const row = await screen.findByTestId("cap-all/week");
    fireEvent.click(within(row).getByRole("button", { name: "Clear" }));
    expect((await screen.findByTestId("refusal-message")).textContent).toMatch(/not applied; try again/);
    expect(screen.queryByRole("button", { name: "Look it up again" })).toBeNull();
  });

  it("gives a member none of the controls", async () => {
    renderAs(member);
    const row = await screen.findByTestId("cap-all/week");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Set" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.queryByRole("form", { name: /usage calendar/i })).toBeNull();
    expect(screen.queryByRole("form", { name: /new spend cap/i })).toBeNull();
    expect(screen.getByTestId("usage-calendar").textContent).toContain("Europe/Berlin");
  });

  it("says nothing is gated when no cap is set", async () => {
    view = { ...VIEW, caps: [] };
    renderAs(owner);
    expect((await screen.findByTestId("usage-no-caps")).textContent).toBe("No cap set — nothing is gated.");
  });

  it("reads a project scope as repo:<id>, a custom range as from/to, and day/week/month as groupBy", async () => {
    renderAs(member, "alpha-11111111");
    await screen.findByTestId("usage-total");
    fireEvent.change(screen.getByLabelText(/^scope/i), { target: { value: "project" } });
    await waitFor(() => expect(lastRead()).toEqual({ scope: "repo:alpha-11111111", groupBy: "model" }));
    for (const groupBy of ["day", "week", "month"]) {
      fireEvent.change(screen.getByLabelText(/^period/i), { target: { value: groupBy } });
      await waitFor(() => expect(lastRead()).toEqual({ scope: "repo:alpha-11111111", groupBy }));
    }
    expect(screen.getByTestId("usage-groups")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^period/i), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText(/^from/i), { target: { value: "2026-10-01T00:00" } });
    fireEvent.change(screen.getByLabelText(/^to/i), { target: { value: "2026-10-08T12:30" } });
    await waitFor(() => expect(lastRead()).toEqual({
      scope: "repo:alpha-11111111", from: String(new Date("2026-10-01T00:00").getTime()), to: String(new Date("2026-10-08T12:30").getTime()), groupBy: "model",
    }));
  });

  it("offers only All projects when no control repository is chosen", async () => {
    renderAs(member, null);
    await screen.findByTestId("usage-total");
    const options = [...(screen.getByLabelText(/^scope/i) as HTMLSelectElement).options].map((option) => option.value);
    expect(options).toEqual(["all"]);
  });
});
