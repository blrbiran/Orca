// @vitest-environment jsdom
/**
 * Accounts spec §3.4: the page carries no credential of its own. The browser sends the session cookie; every
 * non-GET also sends the `orca_csrf` cookie's value back as `x-orca-csrf` (double submit), and a GET sends nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { csrfHeader, getJson, recordReview, renameProject } from "../src/api.js";
import { sendControlCommand } from "../src/controlApi.js";

let requests: Array<{ url: string; init: RequestInit | undefined }>;

const clearCookies = (): void => {
  for (const name of ["orca_csrf", "other"]) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
};

beforeEach(() => {
  requests = [];
  clearCookies();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    requests.push({ url: String(input), init });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(clearCookies);

describe("what the page puts on a request (accounts spec §3.4)", () => {
  it("reads the CSRF value from the orca_csrf cookie, and has none without it", () => {
    expect(csrfHeader()).toEqual({});
    document.cookie = "other=x; path=/";
    document.cookie = "orca_csrf=t; path=/";
    expect(csrfHeader()).toEqual({ "x-orca-csrf": "t" });
  });

  it("sends x-orca-csrf equal to the cookie on every POST and PATCH, and no header on a GET", async () => {
    document.cookie = "orca_csrf=t; path=/";
    await recordReview("p", "d/1");
    await renameProject("p1", "n");
    await sendControlCommand("/api/control/groups/g/start", { commandId: "c", expectedRevision: 0, payload: {} } as never);
    await getJson("/api/metrics");
    expect(requests.slice(0, 3).map((request) => request.init?.method)).toEqual(["POST", "PATCH", "POST"]);
    const posts = requests.slice(0, 3).map((request) => request.init?.headers);
    expect(posts).toEqual([0, 1, 2].map(() => ({ "content-type": "application/json", "x-orca-csrf": "t" })));
    expect(requests[3]).toEqual({ url: "/api/metrics", init: undefined });
  });
});
