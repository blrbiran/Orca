// @vitest-environment jsdom
/**
 * Accounts spec §3.2-§3.4, §7: the page shows a login form until the panel knows the person, only the change-password
 * step while the initial password is still in use, then the panel under an account bar. A session that ends while the
 * page is open (a 401 `login-required` on any later request) takes the page back to the login form, so the person is
 * never left on a panel whose every read is refused. Owners see the security notices; members do not, and the server
 * answers them anyway.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJson, noteAnswer, recordReview } from "../src/api.js";
import { AuthGate } from "../src/AuthGate.js";
import { shouldRefresh } from "../src/auth.js";
import { fetchControlSummary, sendControlCommand } from "../src/controlApi.js";
import { enErrors } from "../src/locales/en.js";
import type { Me } from "../src/auth.js";

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LOGIN_REQUIRED = { code: "login-required", message: "log in to this panel" };
const u: Me["user"] = { id: "u1", name: "amy", roles: ["member"], mustChangePassword: false };
const DAY = 86_400_000;

interface Call { method: string; url: string; headers: Record<string, string>; body: unknown }
let calls: Call[];
let meAnswers: Array<{ status: number; body: unknown }>;
let notices: unknown[];
let routes: Record<string, () => Response>;

beforeEach(() => {
  calls = []; meAnswers = []; notices = []; routes = {};
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input), method = init?.method ?? "GET";
    calls.push({ method, url, headers: { ...(init?.headers as Record<string, string> | undefined) }, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    if (url === "/api/auth/me") {
      const next = meAnswers.length > 1 ? meAnswers.shift()! : meAnswers[0]!;
      return jsonResponse(next.body, next.status);
    }
    if (url === "/api/auth/notices") return jsonResponse({ notices });
    const route = routes[`${method} ${url}`];
    if (route) return route();
    if (method === "POST") return jsonResponse({});
    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

// A fresh 15-day session unless a criterion says otherwise, so no refresh is due.
const me = (user: Partial<Me["user"]> = {}, expiresAt = Date.now() + 14 * DAY): { status: number; body: Me } =>
  ({ status: 200, body: { user: { ...u, ...user }, expiresAt, sessionDays: 15 } });
const posts = (url: string): Call[] => calls.filter((call) => call.method === "POST" && call.url === url);

async function logInAs(name: string, password: string): Promise<void> {
  await screen.findByRole("form", { name: /log in/i });
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: /log in/i }));
}

describe("AuthGate (spec §7)", () => {
  it("shows the login form on 401 and the app after a successful login", async () => {
    meAnswers = [{ status: 401, body: LOGIN_REQUIRED }, me()];
    render(<AuthGate><p>app body</p></AuthGate>);
    await logInAs("amy", "amy's password");
    await screen.findByText("app body");
    expect(posts("/api/auth/login").map((call) => call.body)).toEqual([{ name: "amy", password: "amy's password" }]);
    expect(screen.getByText("amy")).toBeTruthy();
    expect(screen.getByRole("button", { name: /log out/i })).toBeTruthy();
  });

  it("keeps the login form and shows the refusal when the login is refused", async () => {
    meAnswers = [{ status: 401, body: LOGIN_REQUIRED }];
    routes["POST /api/auth/login"] = () => jsonResponse({ code: "login-failed", message: "the name or the password is wrong" }, 401);
    render(<AuthGate><p>app body</p></AuthGate>);
    await logInAs("amy", "wrong password");
    // Rewritten for spec 2026-10-08 §2.2(a) (human-approved): English shows the code's entry beside the code, not the server's message.
    await screen.findByText(enErrors["login-failed"]!);
    expect(screen.getByTestId("refusal-code").textContent).toBe("login-failed");
    expect(screen.queryByText("app body")).toBeNull();
    expect(screen.getByRole("form", { name: /log in/i })).toBeTruthy();
  });

  it("logs out: POSTs /api/auth/logout with the CSRF header and goes back to the login form", async () => {
    meAnswers = [me()];
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByText("app body");
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    await screen.findByRole("form", { name: /log in/i });
    expect(screen.queryByText("app body")).toBeNull();
    expect(posts("/api/auth/logout").map((call) => call.headers["x-orca-csrf"])).toEqual(["t"]);
  });

  it("returns to the login form when a request in the middle of a session answers 401 login-required", async () => {
    meAnswers = [me()];
    routes["GET /api/todo"] = () => jsonResponse({ code: "login-required", message: "log in to this panel" }, 401);
    function Reader({ path }: { path: string }): JSX.Element {
      return <button type="button" onClick={() => { void getJson(path).catch(() => undefined); }}>read {path}</button>;
    }
    render(<AuthGate><p>app body</p><Reader path="/api/todo" /></AuthGate>);
    await screen.findByText("app body");
    fireEvent.click(screen.getByRole("button", { name: "read /api/todo" }));
    await screen.findByRole("form", { name: /log in/i });
    expect(screen.queryByText("app body")).toBeNull();
    // And back in after logging in again.
    await logInAs("amy", "amy's password");
    await screen.findByText("app body");
  });

  it("also returns to the login form on a control read's 401, whose code is under error", async () => {
    meAnswers = [me()];
    routes["GET /api/control/summary"] = () => jsonResponse({ error: { code: "login-required", message: "log in to this panel", commandRevision: null, evidenceIds: [], retryable: false } }, 401);
    function Reader(): JSX.Element {
      return <button type="button" onClick={() => { void fetchControlSummary().catch(() => undefined); }}>read summary</button>;
    }
    render(<AuthGate><p>app body</p><Reader /></AuthGate>);
    await screen.findByText("app body");
    fireEvent.click(screen.getByRole("button", { name: "read summary" }));
    await screen.findByRole("form", { name: /log in/i });
    expect(screen.getByRole("status").textContent).toMatch(/session ended/i);
  });

  it("does not leave the session on a 401 that is not login-required", async () => {
    meAnswers = [me()];
    routes["GET /api/todo"] = () => jsonResponse({ code: "login-failed", message: "no" }, 401);
    let settled = false;
    function Reader(): JSX.Element {
      return <button type="button" onClick={() => { void getJson("/api/todo").catch(() => { settled = true; }); }}>read</button>;
    }
    render(<AuthGate><p>app body</p><Reader /></AuthGate>);
    await screen.findByText("app body");
    fireEvent.click(screen.getByRole("button", { name: "read" }));
    await waitFor(() => expect(settled).toBe(true));
    expect(screen.getByText("app body")).toBeTruthy();
  });

  it("refreshes on entering the panel when less than half the session is left, with the CSRF header, and uses the new expiry", async () => {
    const now = Date.now();
    meAnswers = [me({}, now + 2 * DAY)];
    routes["POST /api/auth/refresh"] = () => jsonResponse({ expiresAt: now + 15 * DAY });
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByText("app body");
    await waitFor(() => expect(posts("/api/auth/refresh")).toHaveLength(1));
    expect(posts("/api/auth/refresh")[0]!.headers["x-orca-csrf"]).toBe("t");
    // The new expiry is the one judged next: becoming visible again asks for nothing more.
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posts("/api/auth/refresh")).toHaveLength(1);
  });

  it("does not refresh a fresh session, then refreshes on the 10-minute check and on becoming visible once it is due", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const start = Date.now();
    meAnswers = [me({}, start + 10 * DAY)];
    routes["POST /api/auth/refresh"] = () => jsonResponse({ expiresAt: start + 10 * DAY });
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByText("app body");
    expect(posts("/api/auth/refresh")).toEqual([]);
    // Three days on, 7 days are left of 15: due. Becoming visible checks at once, without waiting for the interval.
    vi.setSystemTime(start + 3 * DAY);
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(posts("/api/auth/refresh")).toHaveLength(1));
    // The answer kept an expiry that is still due (a server clock behind this one): no loop, one ask per check period...
    await vi.advanceTimersByTimeAsync(60_000);
    expect(posts("/api/auth/refresh")).toHaveLength(1);
    // ...and the 10-minute interval asks again.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await waitFor(() => expect(posts("/api/auth/refresh")).toHaveLength(2));
  });

  it("returns to the login form when a command POST answers 401 login-required, on either POST path", async () => {
    meAnswers = [me()];
    routes["POST /api/control/groups/g/start"] = () => jsonResponse({ error: { code: "login-required", message: "log in to this panel", commandRevision: null, evidenceIds: [], retryable: false } }, 401);
    routes["POST /api/reviews"] = () => jsonResponse(LOGIN_REQUIRED, 401);
    function Senders(): JSX.Element {
      return (
        <>
          <button type="button" onClick={() => { void sendControlCommand("/api/control/groups/g/start", { commandId: "c1", expectedRevision: 1, payload: {} }); }}>start</button>
          <button type="button" onClick={() => { void recordReview("k", "d"); }}>review</button>
        </>
      );
    }
    render(<AuthGate><p>app body</p><Senders /></AuthGate>);
    await screen.findByText("app body");
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await screen.findByRole("form", { name: /log in/i });
    await logInAs("amy", "amy's password");
    await screen.findByText("app body");
    fireEvent.click(screen.getByRole("button", { name: "review" }));
    await screen.findByRole("form", { name: /log in/i });
  });

  it("does not say the session ended when a 401 lands after a deliberate logout", async () => {
    meAnswers = [me()];
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByText("app body");
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    await screen.findByRole("form", { name: /log in/i });
    // A read that was in flight at the logout answers now.
    act(() => noteAnswer(401, LOGIN_REQUIRED));
    expect(screen.queryByText(/session ended/i)).toBeNull();
  });

  it("shows only the change-password step while mustChangePassword is set, sends the CSRF header, then asks for a login with the new password", async () => {
    meAnswers = [me({ roles: ["owner"], mustChangePassword: true }), me({ roles: ["owner"], mustChangePassword: false })];
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByRole("form", { name: /change your password/i });
    expect(screen.queryByText("app body")).toBeNull();
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: "0123456789abcdef" } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "a long new password" } });
    fireEvent.change(screen.getByLabelText(/new password again/i), { target: { value: "a long new password" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    // Human ruling 2026-10-08: the server ended this session with the change, so the page goes to the login form and
    // says why, rather than asking /api/auth/me again (the second answer above is never read).
    await screen.findByRole("form", { name: /log in/i });
    expect(screen.getByRole("status").textContent).toMatch(/password changed/i);
    expect(screen.queryByText("app body")).toBeNull();
    const sent = posts("/api/auth/password");
    expect(sent.map((call) => call.body)).toEqual([{ current: "0123456789abcdef", next: "a long new password" }]);
    expect(sent[0]!.headers["x-orca-csrf"]).toBe("t");
  });

  it("checks a short or mistyped new password before sending it", async () => {
    meAnswers = [me({ mustChangePassword: true })];
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByRole("form", { name: /change your password/i });
    fireEvent.change(screen.getByLabelText(/current password/i), { target: { value: "0123456789abcdef" } });
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText(/new password again/i), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    await screen.findByText(/needs at least 12 characters/i);
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value: "a long new password" } });
    fireEvent.change(screen.getByLabelText(/new password again/i), { target: { value: "a long new passw0rd" } });
    fireEvent.click(screen.getByRole("button", { name: /change password/i }));
    await screen.findByText(/do not match/i);
    expect(posts("/api/auth/password")).toEqual([]);
  });

  it("refreshes when less than half the lifetime is left", () => {
    // A 15-day session: half is 7.5 days. Expiring at day 10, at day 2 it has 8 days left (no refresh), at day 3 it has
    // 7 (refresh). The brief's literal had the two booleans the other way round, against its own formula and spec §3.3.
    expect(shouldRefresh({ user: u, expiresAt: 10 * DAY, sessionDays: 15 }, 2 * DAY)).toBe(false);
    expect(shouldRefresh({ user: u, expiresAt: 10 * DAY, sessionDays: 15 }, 3 * DAY)).toBe(true);
  });

  it("shows owners the security notices and acknowledges one; members see none", async () => {
    notices = [
      { seq: 3, at: Date.UTC(2026, 9, 7, 12, 0), kind: "user-created", body: { userId: "u2", name: "bob", roles: ["member"], by: "user:u1" } },
      // password-changed records only the id: the owner's list of users names it.
      { seq: 5, at: Date.UTC(2026, 9, 7, 13, 0), kind: "password-changed", body: { userId: "u1", by: "user:u1" } },
      { seq: 6, at: Date.UTC(2026, 9, 7, 14, 0), kind: "user-disabled", body: { userId: "u9", by: "user:u1" } },
    ];
    routes["GET /api/auth/users"] = () => jsonResponse({ users: [{ id: "u1", name: "olga" }, { id: "u2", name: "bob" }] });
    meAnswers = [me({ name: "olga", roles: ["owner"] })];
    render(<AuthGate><p>app body</p></AuthGate>);
    const banner = await screen.findByRole("region", { name: /security notices/i });
    expect(banner.textContent).toContain("bob");
    expect(banner.textContent).toMatch(/user created/i);
    await waitFor(() => expect(banner.textContent).toMatch(/password changed: olga/i));
    // An id the list does not hold is shown as the id.
    expect(banner.textContent).toMatch(/user disabled: u9/i);
    notices = [];
    fireEvent.click(screen.getAllByRole("button", { name: /dismiss/i })[0]!);
    await waitFor(() => expect(screen.queryByRole("region", { name: /security notices/i })).toBeNull());
    expect(posts("/api/auth/notices/3/ack").map((call) => call.headers["x-orca-csrf"])).toEqual(["t"]);
    cleanup();

    calls = [];
    notices = [{ seq: 4, at: 0, kind: "user-created", body: { name: "eve" } }];
    meAnswers = [me()];
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByText("app body");
    expect(screen.queryByRole("region", { name: /security notices/i })).toBeNull();
    expect(calls.filter((call) => call.url === "/api/auth/notices")).toEqual([]);
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
  });

  it("lets an owner add a user, checking the password twice before sending it", async () => {
    meAnswers = [me({ name: "olga", roles: ["owner"] })];
    routes["POST /api/auth/users"] = () => jsonResponse({ user: { id: "u2", name: "bob" } }, 201);
    render(<AuthGate><p>app body</p></AuthGate>);
    await screen.findByText("app body");
    expect(screen.queryByRole("form", { name: /add user/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const form = await screen.findByRole("form", { name: /add user/i });
    fireEvent.change(screen.getByLabelText(/user name/i), { target: { value: "bob" } });
    fireEvent.change(screen.getByLabelText(/^role/i), { target: { value: "member" } });
    fireEvent.change(screen.getByLabelText(/^password for the user/i), { target: { value: "bob's long password" } });
    fireEvent.change(screen.getByLabelText(/password again/i), { target: { value: "bob's long password" } });
    fireEvent.submit(form);
    await screen.findByText(/added bob/i);
    const sent = posts("/api/auth/users");
    expect(sent.map((call) => call.body)).toEqual([{ name: "bob", role: "member", password: "bob's long password" }]);
    expect(sent[0]!.headers["x-orca-csrf"]).toBe("t");
  });
});

it("keeps the account bar and panel in the same viewport frame", async () => {
  meAnswers = [me()];
  render(<AuthGate><div className="shell"><main>Panel content</main></div></AuthGate>);
  const panel = await screen.findByText("Panel content");
  const frame = panel.closest(".authenticated-shell");
  expect(frame).not.toBeNull();
  expect(frame!.querySelector(":scope > .account-bar")).not.toBeNull();
  expect(frame!.querySelector(":scope > .shell")).not.toBeNull();
});
