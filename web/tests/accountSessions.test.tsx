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
    await within(region).findByText(/terminal \(orca login\)/i);
    const rows = within(region).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([expect.stringMatching(/browser.*this session/i), expect.stringMatching(/terminal \(orca login\)/i)]);
    // This session is ended by logging out, not from the list.
    expect(within(rows[0]!).queryByRole("button")).toBeNull();
    fireEvent.click(within(rows[1]!).getByRole("button", { name: /revoke/i }));
    await waitFor(() => expect(within(region).queryByText(/terminal \(orca login\)/i)).toBeNull());
    expect(posted).toEqual(["s-cli"]);
  });
});
