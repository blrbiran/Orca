// @vitest-environment jsdom
/**
 * Flow engine spec §9.3, §11.2, §21 C18 display half (plan Task 16): the flow settings of a project and of the global
 * layer, each field with the layer it came from and its lock -- a project value a lock ignores is shown struck through,
 * "overridden by lock", so the person sees why their value does not apply. Writes go to the layer's own route under
 * that layer's revision, read just before; only a person who may sends them (human-only verbs). Irreversible effects
 * are never offered `apply-flag` (refused from every channel in phase 1).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import type { FlowSettingsReadV1 } from "../src/controlTypes.js";
import { FlowSettings } from "../src/FlowSettings.js";
import "../src/i18n.js";

afterEach(cleanup);
const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const as = (me: Me, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;
const S = <T,>(value: T, source: "project" | "global" | "builtin" = "builtin", lockedBy: "global" | null = null, overriddenByLock?: T) =>
  ({ value, source, lockedBy, ...(overriddenByLock === undefined ? {} : { overriddenByLock }) });
const READ: FlowSettingsReadV1 = {
  effects: { local: S("apply-flag"), cost: S("confirm", "project"), external: S("stage-only", "global", "global", "apply-flag"), irreversible: S("confirm") },
  rerunReview: S("review"), rerunAskTimeoutSeconds: S(300), roles: S({}), allowedSkillSources: S(null), budgets: { tokensPerRun: S(2_000_000) }, locks: ["effects.external"],
};

let posts: Array<{ url: string; body: { expectedRevision: number; payload: unknown } }>;
let reads: string[];
function serve(answer: { status: number; body: unknown } = { status: 200, body: { schema: "orca-command-success-v1" } }): void {
  posts = []; reads = [];
  document.cookie = "orca_csrf=t";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if ((init?.method ?? "GET") === "POST") { posts.push({ url, body: JSON.parse(String(init!.body)) }); return new Response(JSON.stringify(answer.body), { status: answer.status }); }
    reads.push(url);
    if (url.endsWith("/workspace")) return new Response(JSON.stringify({ schema: "orca-repository-workspace-v1", repoId: "repo", workspaceMode: "worktree", revision: 7 }), { status: 200 });
    if (url === "/api/control/orchestration") return new Response(JSON.stringify({ revision: 4, maxRunningGroups: 3 }), { status: 200 });
    return new Response(JSON.stringify(READ), { status: 200 });
  }) as typeof fetch;
}
const field = (name: string): HTMLElement => screen.getByTestId(`flow-setting-${name}`);
const mount = async (me: Me, scope: "global" | { repoId: string }): Promise<void> => {
  render(as(me, <FlowSettings scope={scope} />));
  await waitFor(() => expect(screen.getByTestId("flow-setting-effects.local")).toBeTruthy());
};

describe("flow settings with source and lock (§11.2)", () => {
  it("badges each field with its layer, a locked one as locked, and strikes the project value a lock overrides", async () => {
    serve();
    await mount(owner, { repoId: "repo" });
    expect(reads).toContain("/api/control/flows/settings?repoId=repo");
    // mutation: show every source as built-in -> "built-in" for cost, red
    expect(["effects.local", "effects.cost", "effects.external"].map((n) => within(field(n)).getByTestId("flow-setting-source").textContent)).toEqual(["built-in", "project", "global"]);
    expect(within(field("effects.external")).getByTestId("flow-setting-locked").textContent).toBe("locked");
    expect(within(field("effects.cost")).queryByTestId("flow-setting-locked")).toBeNull();
    // mutation: drop the struck-through value -> null, red
    expect(within(field("effects.external")).getByTestId("flow-setting-overridden").textContent).toBe("run and flag for review");
    expect(field("effects.external").textContent).toContain("overridden by lock");
  });

  it("writes this project's layer under the repository settings' revision, and resets a field to the next layer", async () => {
    serve();
    await mount(owner, { repoId: "repo" });
    fireEvent.change(within(field("effects.local")).getByRole("combobox"), { target: { value: "confirm" } });
    fireEvent.click(within(field("effects.local")).getByRole("button", { name: "Override here" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toEqual({ url: "/api/control/repositories/repo/flows/settings", body: expect.objectContaining({ expectedRevision: 7, payload: { set: { effects: { local: "confirm" } }, clear: [] } }) });
    fireEvent.click(within(field("effects.cost")).getByRole("button", { name: "Reset to inherited" }));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(posts[1]!.body.payload).toEqual({ set: {}, clear: ["effects.cost"] });
  });

  it("never offers apply-flag for irreversible effects", async () => {
    serve();
    await mount(owner, { repoId: "repo" });
    const options = [...within(field("effects.irreversible")).getByRole("combobox").querySelectorAll("option")].map((o) => o.getAttribute("value"));
    // mutation: offer every level to irreversible -> apply-flag listed, red
    expect(options).toEqual(["confirm", "stage-only", "follow-template"]);
  });

  it("sets the global locks under @orchestration's revision", async () => {
    serve();
    await mount(owner, "global");
    expect(reads).toContain("/api/control/flows/settings");
    const locks = screen.getByRole("region", { name: "Locks" });
    fireEvent.click(within(locks).getByRole("checkbox", { name: "budgets.tokensPerRun" }));
    fireEvent.click(within(locks).getByRole("button", { name: "Save locks" }));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toEqual({ url: "/api/control/operator/flows/locks", body: expect.objectContaining({ expectedRevision: 4, payload: { locks: ["effects.external", "budgets.tokensPerRun"] } }) });
  });

  it("shows a refusal, and offers a member no editor", async () => {
    serve({ status: 409, body: { error: { code: "flow-setting-locked", message: "effects.external", retryable: false, commandRevision: 4 } } });
    await mount(owner, { repoId: "repo" });
    fireEvent.click(within(field("effects.local")).getByRole("button", { name: "Override here" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("flow-setting-locked"));
    cleanup();
    serve();
    await mount(member, { repoId: "repo" });
    // mutation: offer the editors to a member -> buttons exist, red
    expect(screen.queryByRole("button", { name: "Override here" })).toBeNull();
    expect(screen.getByText("Only the panel owner can change flow settings.")).toBeTruthy();
  });
});
