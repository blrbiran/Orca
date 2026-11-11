// @vitest-environment jsdom
/**
 * CLI browser login spec (2026-11-11) §6, the page's half (#208): `orca auth login` opens `<panel>/#cli-login/<CODE>`. The
 * hash survives the login form, so a person not yet signed in logs in first and lands on the approval page. The page shows
 * what the requester reported about itself, labelled unverified (§6.2), the code, when it was asked and expires, the
 * account it will log in as and the token's lifetime, and offers Approve (the one primary button) and Deny. It never sees
 * the request id or the token: those stay on the panel's socket.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthGate } from "../src/AuthGate.js";
import { parseCliLoginHash } from "../src/cliLogin.js";
import { en, enErrors } from "../src/locales/en.js";
import type { Me } from "../src/auth.js";

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const owner: Me = { user: { id: "u1", name: "ana", roles: ["owner"], mustChangePassword: false }, expiresAt: Date.now() + 14 * 86_400_000, sessionDays: 15 };
const VIEW = {
  code: "ABCD-EFGH", state: "pending", requestedAt: Date.UTC(2026, 10, 11, 9, 0), expiresAt: Date.UTC(2026, 10, 11, 9, 5),
  reported: { client: "cli:claude", pid: 4242, ppid: 4241, cwd: "/work/repo", startedAt: Date.UTC(2026, 10, 11, 8, 59), verified: false },
  account: { name: "ana" }, tokenDays: 15,
};

interface Call { method: string; url: string; headers: Record<string, string> }
let calls: Call[];
let meAnswers: Array<{ status: number; body: unknown }>;
let routes: Record<string, () => Response>;

beforeEach(() => {
  calls = []; routes = {}; meAnswers = [{ status: 200, body: owner }];
  document.cookie = "orca_csrf=csrf-value";
  window.location.hash = "#cli-login/ABCD-EFGH";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input), method = init?.method ?? "GET";
    calls.push({ method, url, headers: { ...(init?.headers as Record<string, string> | undefined) } });
    if (url === "/api/auth/me") { const next = meAnswers.length > 1 ? meAnswers.shift()! : meAnswers[0]!; return jsonResponse(next.body, next.status); }
    if (url === "/api/auth/notices") return jsonResponse({ notices: [] });
    const route = routes[`${method} ${url}`];
    if (route) return route();
    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); window.location.hash = ""; });

describe("the CLI login approval page (CLI browser login spec §6)", () => {
  it("reads the code from the hash, and nothing else", () => {
    expect(parseCliLoginHash("#cli-login/ABCD-EFGH")).toBe("ABCD-EFGH");
    for (const hash of ["", "#", "#cli-login/", "#cli-login/abcd-efgh", "#cli-login/ABCD-EFGH/x", "#cli-login/../../api", "#group/g1", "#cli-login/ABCDEFGHJK"]) {
      expect(parseCliLoginHash(hash), hash).toBeNull();
    }
  });

  it("shows the request, labelled unverified, in place of the panel; Approve is the one primary button and POSTs with CSRF", async () => {
    routes["GET /api/auth/cli-login/ABCD-EFGH"] = () => jsonResponse(VIEW);
    routes["POST /api/auth/cli-login/ABCD-EFGH/approve"] = () => jsonResponse({ state: "approved" });
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByText("ABCD-EFGH");
    expect(screen.queryByText("app body")).toBeNull();
    const page = screen.getByRole("main");
    for (const text of ["cli:claude", "4242", "4241", "/work/repo", "ana", en.cliLogin.unverified, en.cliLogin.warning]) expect(page.textContent, text).toContain(text);
    expect(page.textContent).toContain("15");
    const primary = page.querySelectorAll(".btn-primary");
    expect([...primary].map((button) => button.textContent)).toEqual([en.cliLogin.approve]);
    fireEvent.click(screen.getByRole("button", { name: en.cliLogin.approve }));
    await screen.findByText(en.cliLogin.approved);
    const approve = calls.find((call) => call.method === "POST")!;
    expect([approve.url, approve.headers["x-orca-csrf"]]).toEqual(["/api/auth/cli-login/ABCD-EFGH/approve", "csrf-value"]);
    expect(screen.queryByRole("button", { name: en.cliLogin.approve })).toBeNull();
  });

  it("Deny POSTs deny and says the terminal was refused", async () => {
    routes["GET /api/auth/cli-login/ABCD-EFGH"] = () => jsonResponse(VIEW);
    routes["POST /api/auth/cli-login/ABCD-EFGH/deny"] = () => jsonResponse({ state: "denied" });
    render(<AuthGate><p>app body</p></AuthGate>);
    fireEvent.click(await screen.findByRole("button", { name: en.cliLogin.deny }));
    await screen.findByText(en.cliLogin.denied);
    expect(calls.filter((call) => call.method === "POST").map((call) => call.url)).toEqual(["/api/auth/cli-login/ABCD-EFGH/deny"]);
  });

  it("a person not signed in logs in first, then lands on the page (the hash survives the login form)", async () => {
    meAnswers = [{ status: 401, body: { code: "login-required", message: "log in to this panel" } }, { status: 200, body: owner }];
    routes["POST /api/auth/login"] = () => jsonResponse({ user: owner.user });
    routes["GET /api/auth/cli-login/ABCD-EFGH"] = () => jsonResponse(VIEW);
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByRole("form", { name: /log in/i });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "ana" } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /log in/i }));
    await screen.findByText("ABCD-EFGH");
    expect(screen.queryByText("app body")).toBeNull();
  });

  it("a refused read (a member, an expired code) shows the refusal and no Approve", async () => {
    routes["GET /api/auth/cli-login/ABCD-EFGH"] = () => jsonResponse({ code: "cli-login-expired", message: "expired" }, 409);
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByText(enErrors["cli-login-expired"]!);
    expect(screen.queryByRole("button", { name: en.cliLogin.approve })).toBeNull();
  });

  it("a request the terminal cancelled says so and offers nothing to approve", async () => {
    routes["GET /api/auth/cli-login/ABCD-EFGH"] = () => jsonResponse({ code: "ABCD-EFGH", state: "cancelled" });
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByText(en.cliLogin.cancelled);
    expect(screen.queryByRole("button", { name: en.cliLogin.approve })).toBeNull();
  });

  it("Back to the panel clears the hash and shows the panel", async () => {
    routes["GET /api/auth/cli-login/ABCD-EFGH"] = () => jsonResponse(VIEW);
    render(<AuthGate><p>app body</p></AuthGate>);
    fireEvent.click(await screen.findByRole("button", { name: en.cliLogin.back }));
    await screen.findByText("app body");
    await waitFor(() => expect(window.location.hash).toBe(""));
  });
});
