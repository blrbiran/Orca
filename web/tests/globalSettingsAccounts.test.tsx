// @vitest-environment jsdom
/** Task 3: real AuthGate account ownership and CSRF boundary composed in App's global settings. */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { AuthGate } from "../src/AuthGate.js";
import { installFakePanel } from "./fixtures/twoProjects.js";
import type { Me } from "../src/auth.js";
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let me: Me;
let authCalls: { url: string; method: string; headers: HeadersInit | undefined; body: unknown }[];
let passwordStatus: number;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.location.hash = "global-settings"; document.cookie = "orca_csrf=account-token";
  me = { user: { id: "u1", name: "account-member", roles: ["member"], mustChangePassword: false }, expiresAt: Date.now() + 14 * 86400000, sessionDays: 15 };
  authCalls = []; passwordStatus = 200;
  installFakePanel(); const fetchPanel = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = String(input), method = init?.method ?? "GET";
    if (!url.startsWith("/api/auth/")) return fetchPanel(input, init);
    authCalls.push({ url, method, headers: init?.headers, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    if (url === "/api/auth/me") return json(me);
    if (url === "/api/auth/notices") return json({ notices: [{ seq: 1, at: 0, kind: "user-created", body: { name: "notice-user" } }] });
    if (url === "/api/auth/users" && method === "GET") return json({ users: [] });
    if (url === "/api/auth/users") return json({ user: { id: "u2", name: "bob" } }, 201);
    if (url === "/api/auth/password" && passwordStatus !== 200) return json({ code: "current-password-wrong", message: "wrong" }, passwordStatus);
    return json({});
  }) as typeof fetch;
});
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); window.location.hash = ""; });
const ui = <AuthGate><App /></AuthGate>;
const settings = (): HTMLElement => screen.getByRole("region", { name: "Global settings" });
const posts = (url: string) => authCalls.filter(c => c.method === "POST" && c.url === url);
async function password(current: string, next: string, again = next): Promise<void> {
  const form = await within(settings()).findByRole("form", { name: "Change your password" });
  fireEvent.change(within(form).getByLabelText("Current password"), { target: { value: current } });
  fireEvent.change(within(form).getByLabelText("New password"), { target: { value: next } });
  fireEvent.change(within(form).getByLabelText("New password again"), { target: { value: again } });
  fireEvent.submit(form);
}
describe("global account settings", () => {
  it("lets a member change their own password from settings with existing validation/CSRF and returns to login", async () => {
    render(ui); await screen.findByRole("region", { name: "Global settings" });
    expect(within(settings()).queryByRole("form", { name: "Add user" })).toBeNull();
    expect(settings().textContent).not.toContain("initial password");
    await password("old-password", "short");
    await screen.findByText(/needs at least 12 characters/); expect(posts("/api/auth/password")).toEqual([]);
    await password("old-password", "a long new password", "a different password");
    await screen.findByText(/do not match/); expect(posts("/api/auth/password")).toEqual([]);
    await password("old-password", "a long new password");
    await screen.findByRole("form", { name: "Log in" });
    expect(screen.getByRole("status").textContent).toContain("Password changed");
    expect(screen.queryByRole("region", { name: "Global settings" })).toBeNull();
    expect(posts("/api/auth/password").map(c => c.body)).toEqual([{ current: "old-password", next: "a long new password" }]);
    expect(new Headers(posts("/api/auth/password")[0]!.headers).get("x-orca-csrf")).toBe("account-token");
    expect(authCalls.filter(c => c.url === "/api/auth/me")).toHaveLength(1);
    expect(authCalls.filter(c => c.url === "/api/auth/notices")).toHaveLength(0);
  });
  it("keeps a refused ordinary password change in settings", async () => {
    passwordStatus = 403; render(ui); await screen.findByRole("region", { name: "Global settings" });
    await password("wrong", "a long new password");
    await screen.findByText("current-password-wrong");
    expect(within(settings()).getByRole("form", { name: "Change your password" })).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Log in" })).toBeNull();
  });
  it("mounts one owner Add user surface in settings and one global notice reader across navigation", async () => {
    me.user.roles = ["owner"]; render(ui);
    await screen.findByRole("region", { name: "Global settings" });
    const form = within(settings()).getByRole("form", { name: "Add user" });
    expect(screen.getAllByRole("form", { name: "Change your password" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Menu" })).toBeNull();
    fireEvent.change(within(form).getByLabelText("User name"), { target: { value: "bob" } });
    fireEvent.change(within(form).getByLabelText("Password for the user"), { target: { value: "bob's long password" } });
    fireEvent.change(within(form).getByLabelText("Password again"), { target: { value: "bob's long password" } });
    fireEvent.submit(form); await screen.findByText("Added bob.");
    expect(posts("/api/auth/users").map(c => c.body)).toEqual([{ name: "bob", role: "member", password: "bob's long password" }]);
    expect(new Headers(posts("/api/auth/users")[0]!.headers).get("x-orca-csrf")).toBe("account-token");
    await screen.findByRole("region", { name: "Security notices" });
    await act(async () => { window.location.hash = "tasks"; window.dispatchEvent(new Event("hashchange")); });
    expect(screen.getByRole("region", { name: "Security notices" }).closest('.section-pane')).toBeNull();
    expect(authCalls.filter(c => c.url === "/api/auth/notices")).toHaveLength(1);
    expect(authCalls.filter(c => c.url === "/api/auth/me")).toHaveLength(1);
    expect(screen.getAllByRole("form", { name: "Add user" })).toHaveLength(1);
    expect(screen.getByRole("navigation", { name: "Sections" }).closest('.authenticated-shell')).toBe(screen.getByRole("button", { name: "Log out" }).closest('.authenticated-shell'));
  });
  it("retains the mandatory first-password gate without mounting the panel or account surfaces", async () => {
    me.user.mustChangePassword = true; render(ui);
    await screen.findByRole("form", { name: "Change your password" });
    expect(screen.getByText(/logged in with the initial password/)).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("region", { name: "Global settings" })).toBeNull();
    expect(authCalls.filter(c => c.url === "/api/auth/notices")).toHaveLength(0);
  });
});
