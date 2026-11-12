// @vitest-environment jsdom
/**
 * Tester follow-up G §6.3 (#189): every request a person may let through offers two buttons -- "Allow this kind in this
 * group" first (the default) and "Allow this one" -- and the group lists what it allows, an owner revoking an active one.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AllowRequestButtons } from "../src/AllowRequestButtons.js";
import { GroupAllowances } from "../src/GroupAllowances.js";
import i18n from "../src/i18n.js";
import type { GroupAllowanceV1 } from "../src/controlTypes.js";
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const ALLOWANCES: GroupAllowanceV1[] = [
  { allowanceId: "allow-1", request: { type: "path", paths: [{ repoKey: null, path: "docs/notes.md" }] }, from: { runId: "run-1" }, by: "ana", via: "web", principal: "user:ana", commandId: "c1", at: 1 },
  { allowanceId: "allow-2", request: { type: "pending-decision", kind: "interface", scope: "task" }, from: { pendingId: "p1" }, by: "ana", via: "web", principal: "user:ana", commandId: "c2", at: 2, revoked: { by: "ana", via: "web", commandId: "c3", at: 3 } },
];

describe("the allow buttons (tester follow-up G §6.3)", () => {
  it("the default button allows the kind in the group; the second only this one", () => {
    const onCommand = vi.fn();
    render(<AllowRequestButtons groupId="g" revision={6} request={{ kind: "pending-decision", pendingId: "p1" }} archived={false} onCommand={onCommand} />);
    const [first, second] = screen.getAllByRole("button");
    expect(first!.textContent).toBe("Allow this kind in this group");
    fireEvent.click(first!);
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "allow-request", groupId: "g", expectedRevision: 6, payload: { request: { kind: "pending-decision", pendingId: "p1" }, scope: "group" } });
    fireEvent.click(second!);
    expect(onCommand).toHaveBeenLastCalledWith({ verb: "allow-request", groupId: "g", expectedRevision: 6, payload: { request: { kind: "pending-decision", pendingId: "p1" }, scope: "one" } });
  });

  it("shows nothing in an archived group, and speaks Chinese", async () => {
    const { container } = render(<AllowRequestButtons groupId="g" revision={6} request={{ kind: "path", runId: "run-1" }} archived={true} onCommand={vi.fn()} />);
    expect(container.textContent).toBe("");
    cleanup();
    await i18n.changeLanguage("zh");
    render(<AllowRequestButtons groupId="g" revision={6} request={{ kind: "path", runId: "run-1" }} archived={false} onCommand={vi.fn()} />);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["本组同类都放行", "只放行这一条"]);
  });
});

describe("the group's allowance list (tester follow-up G §6.3)", () => {
  it("the group lists allowances and an owner revokes one", () => {
    const onCommand = vi.fn();
    const { container } = render(<GroupAllowances groupId="g" revision={6} allowances={ALLOWANCES} roles={["owner"]} archived={false} onCommand={onCommand} />);
    expect(screen.getByText("Allowed in this group")).toBeTruthy();
    expect(container.querySelector("[data-allowance='allow-2']")!.textContent).toContain("revoked");
    expect(container.querySelector("[data-allowance='allow-1']")!.textContent).toContain("from run-1");
    const revoke = screen.getAllByRole("button", { name: "Revoke" });
    expect(revoke).toHaveLength(1);
    fireEvent.click(revoke[0]!);
    expect(onCommand).toHaveBeenCalledWith({ verb: "revoke-allowance", groupId: "g", expectedRevision: 6, payload: { allowanceId: "allow-1" } });
  });

  it("a member sees no Revoke; an empty list shows nothing", () => {
    render(<GroupAllowances groupId="g" revision={6} allowances={ALLOWANCES} roles={["member"]} archived={false} onCommand={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
    cleanup();
    const { container } = render(<GroupAllowances groupId="g" revision={6} allowances={[]} roles={["owner"]} archived={false} onCommand={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
