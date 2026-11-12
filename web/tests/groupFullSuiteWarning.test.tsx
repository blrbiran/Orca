// @vitest-environment jsdom
/**
 * Full suite spec 2026-11-12 §3, §5 (#279): a group's acceptance that ran no full suite (none set) warns in Problems with
 * the command Orca detected -- only a suggestion, sent nowhere until a person who may adopts it (human: 「人采纳才用」); a
 * flaky suite (red, then green on the retry) warns too. Neither is a blocking problem. The project's Checks settings show
 * the same suggestion with Adopt, which sets the integration-check command as typing it would.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { ChecksSettings } from "../src/ChecksSettings.js";
import { GroupFullSuiteWarning } from "../src/GroupFullSuiteWarning.js";
import type { ChecksReadV1, CheckTriggerV1, GroupAcceptanceV1 } from "../src/controlTypes.js";
import i18n from "../src/i18n.js";

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const as = (me: Me, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const TRIGGER: CheckTriggerV1 = { all: [{ any: [{ kind: "queue-idle" }] }] };
const S = <T,>(value: T) => ({ value, source: "builtin" as const, lockedBy: null });
const read = (suggestedCommand: string | null): ChecksReadV1 => ({
  schema: "orca-checks-v1", repoId: "repo",
  kinds: {
    "integration-check": { enabled: S(false), trigger: S(TRIGGER), command: S<string | null>(null) },
    "model-review": { enabled: S(true), trigger: S(TRIGGER), budgetTokens: S(1_000_000), maxGroupsPerReview: S(12) },
  },
  scheduled: [], locks: [], state: [], revision: 5, nextSlots: {}, suggestedCommand,
});

let posts: Array<{ url: string; body: { expectedRevision: number; payload: unknown } }>;
beforeEach(() => {
  posts = [];
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? "GET") === "POST") { posts.push({ url: String(input), body: JSON.parse(String(init!.body)) }); return jsonResponse({ schema: "orca-command-success-v1" }); }
    return jsonResponse(read("npm test"));
  }) as typeof fetch;
});
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const NOT_SET: GroupAcceptanceV1 = {
  tip: "c".repeat(40), result: "passed", commands: [{ command: "npm test -- a.test.js", exit: "0", ms: 5 }], at: 1,
  fullSuite: { command: null, suggestion: "npm test", exits: [], flaky: false }, warning: "full-suite-not-set",
};
const FLAKY: GroupAcceptanceV1 = {
  ...NOT_SET, commands: [...NOT_SET.commands, { command: "npm test", exit: "1", ms: 9 }, { command: "npm test", exit: "0", ms: 9 }],
  fullSuite: { command: "npm test", suggestion: null, exits: ["1", "0"], flaky: true }, warning: "full-suite-flaky:npm test",
};

describe("the full-suite warnings in Problems (spec §5)", () => {
  it("no command set: warns, names the suggestion, and sends nothing until an owner adopts it", async () => {
    const { container } = render(as(owner, <GroupFullSuiteWarning repoId="repo" acceptance={NOT_SET} archived={false} />));
    expect(container.querySelector("code")?.textContent).toBe("full-suite-not-set");
    expect(screen.getByText("Orca detected npm test; it runs only once adopted.")).toBeTruthy();
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Adopt npm test" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/control/repositories/repo/checks/settings",
      body: expect.objectContaining({ expectedRevision: 5, payload: { kind: "integration-check", set: { command: "npm test" }, clear: [] } }) });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Adopted: the next acceptance runs it."));
  });

  it("a member sees the warning and the suggestion but no Adopt; an archived group offers none either", () => {
    render(as(member, <GroupFullSuiteWarning repoId="repo" acceptance={NOT_SET} archived={false} />));
    expect(screen.getByText("Orca detected npm test; it runs only once adopted.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    render(as(owner, <GroupFullSuiteWarning repoId="repo" acceptance={NOT_SET} archived />));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("no suggestion: the warning alone", () => {
    render(as(owner, <GroupFullSuiteWarning repoId="repo" acceptance={{ ...NOT_SET, fullSuite: { ...NOT_SET.fullSuite!, suggestion: null } }} archived={false} />));
    expect(screen.getByText(/No full test suite ran at acceptance/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("a flaky suite warns, naming the command", () => {
    const { container } = render(as(owner, <GroupFullSuiteWarning repoId="repo" acceptance={FLAKY} archived={false} />));
    expect(container.querySelector("code")?.textContent).toBe("full-suite-flaky:npm test");
    expect(screen.getByText(/The full suite npm test failed once and passed on the retry/)).toBeTruthy();
  });

  it("nothing when the record has no warning", () => {
    const { container } = render(as(owner, <GroupFullSuiteWarning repoId="repo" acceptance={{ ...FLAKY, fullSuite: { command: "npm test", suggestion: null, exits: ["0"], flaky: false }, warning: undefined }} archived={false} />));
    expect(container.textContent).toBe("");
  });

  it("says it in Chinese", async () => {
    await i18n.changeLanguage("zh");
    render(as(owner, <GroupFullSuiteWarning repoId="repo" acceptance={NOT_SET} archived={false} />));
    expect(screen.getByRole("button", { name: "采纳 npm test" })).toBeTruthy();
  });
});

describe("the suggestion in the project's Checks settings (spec §3)", () => {
  it("shows the detected command and Adopt sets it as the project's integration-check command", async () => {
    render(as(owner, <ChecksSettings scope={{ repoId: "repo" }} />));
    await waitFor(() => expect(screen.getByTestId("check-suggested-command")).toBeTruthy());
    expect(screen.getByTestId("check-suggested-command").textContent).toContain("Detected: npm test (not run until adopted)");
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Adopt" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ url: "/api/control/repositories/repo/checks/settings",
      body: expect.objectContaining({ expectedRevision: 5, payload: { kind: "integration-check", set: { command: "npm test" }, clear: [] } }) });
  });

  it("a member sees the suggestion without Adopt", async () => {
    render(as(member, <ChecksSettings scope={{ repoId: "repo" }} />));
    await waitFor(() => expect(screen.getByTestId("check-suggested-command")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Adopt" })).toBeNull();
  });
});
