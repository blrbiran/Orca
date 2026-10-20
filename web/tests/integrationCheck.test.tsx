// @vitest-environment jsdom
/**
 * Kanban spec 2026-10-20 §7 layer 1: the repository's integration check in Project settings. An owner turns it on and
 * may name a command; the setting is sent under the revision the section was read at; the newest result is shown; a
 * member reads it and cannot save.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import type { IntegrationCheckV1 } from "../src/controlTypes.js";
import { IntegrationCheck } from "../src/IntegrationCheck.js";
import "../src/i18n.js";

afterEach(cleanup);

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const member: Me = { user: { id: "u2", name: "amy", roles: ["member"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const as = (me: Me, node: JSX.Element): JSX.Element => <AccountContext.Provider value={me}>{node}</AccountContext.Provider>;
const OFF: IntegrationCheckV1 = { enabled: false, command: null, last: null };

describe("the integration check section", () => {
  it("turns the check on with a command, sent once under the read revision", () => {
    const onSave = vi.fn();
    render(as(owner, <IntegrationCheck check={OFF} revision={4} onSave={onSave} />));
    const region = screen.getByRole("region", { name: "Integration check" });
    const save = within(region).getByRole("button", { name: "Save" });
    // mutation: `changed` always true -> an unchanged form can be saved, red
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(region).getByRole("checkbox"));
    fireEvent.change(within(region).getByLabelText(/Command/), { target: { value: "  npm ci && npm test  " } });
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ enabled: true, command: "npm ci && npm test" }, 4);
  });

  it("shows how the newest check ended, naming the debug task a red one opened", () => {
    render(as(owner, <IntegrationCheck check={{ enabled: true, command: null, last: { state: "failed", at: 1, commit: "a".repeat(40), groups: ["g1", "g2"], detail: "npm test", debugGroupId: "sysdebug-integration-check-0123456789abcdef" } }} revision={5} onSave={vi.fn()} />));
    expect(screen.getByTestId("integration-check-last").textContent).toBe("The last check failed (groups g1, g2): npm test. Debug task: sysdebug-integration-check-0123456789abcdef.");
  });

  it("lets a member read it but not save", () => {
    render(as(member, <IntegrationCheck check={OFF} revision={4} onSave={vi.fn()} />));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
