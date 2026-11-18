// @vitest-environment jsdom
/**
 * Pre-existing failures spec 2026-11-18 L4 (#341): the confirm step names each check Orca already knows was red at exactly
 * this group's base (read from `group brief`; nothing runs for it), so the person can settle "only add" against "all green"
 * before the first task meets it. Nothing is shown when nothing is known.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccountContext } from "../src/AuthGate.js";
import type { Me } from "../src/auth.js";
import { BudgetEditor } from "../src/BudgetEditor.js";
import type { GroupViewV1, KnownRedAtBaseV1 } from "../src/controlTypes.js";
import { amount, config, view as boardView } from "./fixtures/board.js";
import "../src/i18n.js";

const owner: Me = { user: { id: "u1", name: "olga", roles: ["owner"], mustChangePassword: false }, expiresAt: 0, sessionDays: 15 };
const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const AT = Date.UTC(2026, 10, 17, 9, 30);
const KNOWN: KnownRedAtBaseV1[] = [
  { command: "npm test", base: "b".repeat(40), source: "acceptance", groupId: "g-old", at: AT },
  { command: "npm run lint", base: "b".repeat(40), source: "base-check", groupId: "g-sib", taskId: "t2", at: AT },
];

let known: KnownRedAtBaseV1[] | undefined;
let asked: string[];
beforeEach(() => {
  known = KNOWN; asked = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    asked.push(String(input));
    return String(input).endsWith("/brief") ? jsonResponse({ schema: "orca-group-brief-v1", ...(known === undefined ? {} : { knownRedAtBase: known }) }) : jsonResponse({}, 404);
  }) as typeof fetch;
});
afterEach(cleanup);

const draft = (): GroupViewV1 => {
  const base = boardView([]);
  return {
    ...base, summary: { ...base.summary, state: "draft" },
    proposal: { ...base.proposal, state: "editable", profiles: null, budgetMode: null, executionSnapshotHash: null },
    ledger: { ...base.ledger, groupLimit: amount(9_000_000), budgetDeficit: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 } },
  };
};
const editor = (v: GroupViewV1) => render(<AccountContext.Provider value={owner}>
  <BudgetEditor view={v} config={config} drafts={{}} onDraft={() => {}} onCommand={() => {}} selectionsHash={"9".repeat(64)} />
</AccountContext.Provider>);

describe("the confirm step names a check already known red at this base (#341 L4)", () => {
  it("shows one line per command, naming where Orca learned it", async () => {
    const v = draft();
    editor(v);
    // mutation: drop `<ConfirmKnownRedNote …/>` from BudgetEditor -> red
    expect(await screen.findByText("At this group's base, npm test was red (group g-old's acceptance, 2026-11-17).")).toBeTruthy();
    expect(screen.getByText("At this group's base, npm run lint was red (task t2 of group g-sib, run at the base, 2026-11-17).")).toBeTruthy();
    expect(asked).toContain(`/api/control/groups/${encodeURIComponent(v.summary.groupId)}/brief`);
  });

  it("says nothing when the brief has no such key", async () => {
    known = undefined;
    editor(draft());
    await screen.findByRole("button", { name: "Confirm task plan" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked.some((url) => url.endsWith("/brief"))).toBe(true);
    expect(screen.queryByTestId("confirm-known-red")).toBeNull();
  });
});
