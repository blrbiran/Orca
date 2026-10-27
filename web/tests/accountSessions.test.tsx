// @vitest-environment jsdom
/**
 * CLI v2 spec §15.3 (plan Task 11): the account settings list the person's sessions -- this browser, other browsers and
 * the CLI's person tokens (`orca login`) -- and revoke one. Revoking the CLI session is how a person ends a token they
 * did not log out of (a lost terminal, an agent they no longer trust).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountSettings, AuthGate } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import i18n from "../src/i18n.js";

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ME: Me = { user: { id: "u1", name: "ana", roles: ["member"], mustChangePassword: false }, expiresAt: Date.now() + 14 * 86_400_000, sessionDays: 15 };

let sessions: Array<{ sid: string; kind: string; createdAt: number; expiresAt: number; current: boolean }>;
let posted: string[];

beforeEach(() => {
  posted = [];
  sessions = [
    { sid: "s-web", kind: "browser", createdAt: 1, expiresAt: 2, current: true },
    { sid: "s-cli", kind: "cli", createdAt: 3, expiresAt: 4, current: false },
  ];
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input), method = init?.method ?? "GET";
    if (url === "/api/auth/me") return jsonResponse(ME);
    if (url === "/api/auth/notices") return jsonResponse({ notices: [] });
    if (method === "GET" && url === "/api/auth/sessions") return jsonResponse({ sessions });
    const revoke = /^\/api\/auth\/sessions\/([^/]+)\/revoke$/.exec(url);
    if (method === "POST" && revoke) {
      posted.push(revoke[1]!);
      sessions = sessions.filter((s) => s.sid !== revoke[1]);
      return jsonResponse({});
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  }) as typeof fetch;
});
afterEach(() => { cleanup(); });

describe("sessions in the account settings (CLI v2 spec §15.3)", () => {
  it("lists this browser and the CLI token, and revokes the CLI one", async () => {
    render(<AuthGate><AccountSettings /></AuthGate>);
    const region = await screen.findByRole("region", { name: /sessions/i });
    // Ruling: human 「这次批准改写所有必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- tester #66 renamed the CLI kind "Command line" and the current row "This browser" (was "Terminal (orca login)", "this session").
    await within(region).findByText(/command line/i);
    const rows = within(region).getAllByRole("listitem");
    // Ruling: human 「这次批准改写所有必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- same renames as above.
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringMatching(/browser.*this browser/i), expect.stringMatching(/command line/i)]);
    // This session is ended by logging out, not from the list.
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
    // Ruling: human 「这次批准改写所有必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- tester #66: the action is "Sign out", not "Revoke".
    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Sign out" }));
    // Ruling: human 「这次批准改写所有必要的判据」, Orca session 3cd8fb02, 2026-10-28 -- the CLI row is found by its new kind name.
    await waitFor(() => expect(within(region).queryByText(/command line/i)).toBeNull());
    expect(posted).toEqual(["s-cli"]);
  });

  // Tester #66 (spec §24, session 3cd8fb02): three rows all reading "Browser · since … · until … Revoke" looked like a
  // security problem. Each row says what kind of login it is, when it signed in and when it expires, the current one is
  // "This browser", the action is "Sign out", and one line says why there are several.
  it("says each session's kind, sign-in and expiry, marks this browser, and explains why there are several", async () => {
    render(<AuthGate><AccountSettings /></AuthGate>);
    const region = await screen.findByRole("region", { name: /sessions/i });
    await within(region).findByText(/command line/i);
    const at = (ms: number): string => new Date(ms).toLocaleString();
    // mutation: back to "since {{since}} · until {{until}}" / "Terminal (orca login)" / "this session" -> red
    expect(within(region).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      `Browser · signed in ${at(1)} · expires ${at(2)} · This browser`,
      `Command line · signed in ${at(3)} · expires ${at(4)}Sign out`,
    ]);
    // mutation: drop the explaining line -> red
    expect(region.textContent).toContain("Every browser or command-line login is its own session and ends by itself at its expiry date.");
    // mutation: back to "Revoke" -> no such button, red
    expect(within(region).queryByRole("button", { name: /revoke/i })).toBeNull();
  });

  it("reads 「退出登录」 and 「命令行」 in Chinese, never 「吊销」", async () => {
    await i18n.changeLanguage("zh");
    try {
      render(<AuthGate><AccountSettings /></AuthGate>);
      const region = await screen.findByRole("region", { name: "会话" });
      await within(region).findByText(/命令行/);
      // mutation: back to 「吊销」 -> red
      expect(within(region).getByRole("button", { name: "退出登录" })).toBeTruthy();
      expect(region.textContent).not.toContain("吊销");
      expect(region.textContent).toContain("本浏览器");
      expect(region.textContent).toContain("每次在浏览器或命令行登录都是一个独立的会话，到期后自动结束。");
    } finally { await i18n.changeLanguage("en"); }
  });
});
