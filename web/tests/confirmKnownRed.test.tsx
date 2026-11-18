// @vitest-environment jsdom
/**
 * Pre-existing failures spec 2026-11-18 L4 (#341): the confirm step names each check Orca already knows was red at exactly
 * this group's base (its own read; nothing runs for it -- with no base known it may read the target's HEAD once, review I-1), so the person can settle "only add" against "all green"
 * before the first task meets it. Nothing is shown when nothing is known.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

let answer: Record<string, unknown>;
let asked: string[];
beforeEach(() => {
  answer = { knownRedAtBase: KNOWN }; asked = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    asked.push(String(input));
    return String(input).endsWith("/confirm-known-red") ? jsonResponse({ schema: "orca-confirm-known-red-v1", ...answer }) : jsonResponse({}, 404);
  }) as typeof fetch;
});
const confirmReads = () => asked.filter((url) => url.endsWith("/confirm-known-red")).length;
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
    expect(asked).toContain(`/api/control/groups/${encodeURIComponent(v.summary.groupId)}/confirm-known-red`);
  });

  // Task 4 review I-1: with no base known, the confirm read may predict from the target's current HEAD; worded as such.
  it("names a check red at the target's current HEAD as a prediction", async () => {
    answer = { atHead: { head: "abcdef0123456789abcdef0123456789abcdef01", known: [KNOWN[0]] } };
    editor(draft());
    // mutation: drop the atHead branch from ConfirmKnownRedNote -> red
    expect(await screen.findByText("At the target's current HEAD (abcdef0), npm test was red (group g-old's acceptance, 2026-11-17).")).toBeTruthy();
  });

  // Task 4 review minor 5: a view that changed (a new change sequence) asks again; the same view does not.
  it("asks again when the view's change sequence moves", async () => {
    const v = draft();
    const shown = editor(v);
    await screen.findByText(/npm test was red/);
    shown.rerender(<AccountContext.Provider value={owner}>
      <BudgetEditor view={{ ...v }} config={config} drafts={{}} onDraft={() => {}} onCommand={() => {}} selectionsHash={"9".repeat(64)} />
    </AccountContext.Provider>);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(confirmReads()).toBe(1);
    answer = {};
    shown.rerender(<AccountContext.Provider value={owner}>
      <BudgetEditor view={{ ...v, changeSeq: v.changeSeq + 1 }} config={config} drafts={{}} onDraft={() => {}} onCommand={() => {}} selectionsHash={"9".repeat(64)} />
    </AccountContext.Provider>);
    // mutation: drop the change sequence from the effect's dependencies -> one read, the line stays -> red
    await waitFor(() => expect(screen.queryByTestId("confirm-known-red")).toBeNull());
    expect(confirmReads()).toBe(2);
  });

  it("says nothing when the read has no such key", async () => {
    answer = {};
    editor(draft());
    await screen.findByRole("button", { name: "Confirm task plan" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(confirmReads()).toBe(1);
    expect(screen.queryByTestId("confirm-known-red")).toBeNull();
  });
});
