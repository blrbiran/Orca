// Tester #499: `group set-limit` refused a limit the group cannot hold with a bare `group-budget-unavailable` -- neither
// the dimension that does not fit nor the gap was named -- and a board card's budget was tokens only. The refusal now
// carries the shortfall (in its message and in the wire body's `error.shortfall`), the card carries all four dimensions,
// and the CLI's next line names the dimensions that were short.
import { describe, expect, it } from "vitest";
import { createGroup, setGroupLimit } from "../../src/control/commands.js";
import { ControlError } from "../../src/control/errors.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup, readGroupSummary } from "../../src/panel/controlViews.js";
import { cli, fakePanel, useFakePanels } from "../commands/fixtures/fakePanel.js";
import { openTestStore } from "./fixtures/store.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";

type Fixture = Awaited<ReturnType<typeof webFixture>>;
const groupBody = (h: Fixture) => JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as {
  used: { tokens: number; activeMs: number; attempts: number; sessions: number };
  reserved: { tokens: number; activeMs: number; attempts: number; sessions: number };
  limit: { tokens: number | null; activeMs: number; attempts: number; sessions: number };
};

describe("a group limit that does not fit (#499)", () => {
  it("names the short dimension and the gap in the refusal, and carries it on the wire", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }], { tokenPolicy: "optional-v1" });
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", { ...await h.confirmPayload(), budgetMode: "soft" }))).not.toHaveProperty("error");
      const body = groupBody(h), occupied = body.used.attempts + body.reserved.attempts;
      expect(occupied).toBeGreaterThan(0);
      const limit = { ...readControlGroup(h.store, "epoch", "g").ledger.groupLimit };
      const refused = service.setLimit(h.command("set-limit", { limit: { ...limit, attempts: occupied - 1 } }));
      // The stored body (what the CLI receives as its 422) carries the dimension, what it holds and what the limit allows.
      expect(refused).toMatchObject({ error: { code: "group-budget-unavailable", shortfall: { attempts: { have: occupied, need: occupied - 1 } } } });
      expect(Object.keys((refused as { error: { shortfall: object } }).error.shortfall)).toEqual(["attempts"]);
      // ... and the human-readable detail names the same dimension and its gap (the #311 form, `dimension:+missing`).
      expect((refused as { error: { message: string } }).error.message).toBe("group-budget-unavailable:attempts:+1");
      // Refused atomically: the limit the group holds is unchanged.
      expect(readControlGroup(h.store, "epoch", "g").ledger.groupLimit).toEqual(limit);
    } finally { await h.dispose(); }
  });

  it("a board card's budget carries all four dimensions, used and limit", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }], { tokenPolicy: "optional-v1" });
    try {
      // Nonzero use in the three finite dimensions: a card pinned to 0 (the fresh fixture's use) could not tell a read
      // from a constant, and this criterion must go red when the card stops reading them.
      const current = groupBody(h);
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify({ ...current,
        used: { ...current.used, activeMs: 1_234, attempts: 2, sessions: 3 } }));
      const body = groupBody(h);
      // The card is read through the strict group-summary schema, so a body missing one of the six fields fails here.
      expect(readGroupSummary(h.store, "g").card!.budget).toEqual({
        usedTokens: body.used.tokens, limitTokens: body.limit.tokens, reservedTokens: body.reserved.tokens,
        headroomTokens: body.limit.tokens === null ? null : Math.max(0, body.limit.tokens - body.used.tokens - body.reserved.tokens),
        usedActiveMs: body.used.activeMs, limitActiveMs: body.limit.activeMs,
        usedAttempts: body.used.attempts, limitAttempts: body.limit.attempts,
        usedSessions: body.used.sessions, limitSessions: body.limit.sessions,
      });
    } finally { await h.dispose(); }
  });
it("the store-level writer (commands.setGroupLimit) carries the same shortfall", async () => {
    const h = await openTestStore();
    try {
      createGroup(h.store, { groupId: "g1", projectKey: "example/repo", goal: "Ship", successConditions: ["checks pass"],
        limit: { tokens: 100, activeMs: 10_000, attempts: 10, sessions: 10 },
        reviewReserve: { tokens: 10, activeMs: 1_000, attempts: 1, sessions: 1 }, deadlineAt: null },
      { commandId: "create", expectedRevision: 0, by: "human" });
      let refused: ControlError | undefined;
      try { setGroupLimit(h.store, "g1", { tokens: 9, activeMs: 10_000, attempts: 10, sessions: 10 }, { commandId: "lower", expectedRevision: 1, by: "human" }); }
      catch (error) { refused = error as ControlError; }
      expect(refused).toBeInstanceOf(ControlError);
      expect(refused!.code).toBe("group-budget-unavailable");
      expect(refused!.message).toBe("group-budget-unavailable:tokens:+1");
      expect(refused!.details?.shortfall).toEqual({ tokens: { have: 10, need: 9 } });
    } finally { await h.dispose(); }
  });
});

useFakePanels();

describe("group set-limit's refusal names the dimension that was short (#499)", () => {
  const LIMIT = { tokens: 6_000_000, activeMs: 14_400_000, attempts: 60, sessions: 60 };
  const routes = {
    "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "running", commandRevision: 5 }] } },
    "GET groups/g-alpha": { status: 200, body: {
      schema: "orca-control-group-v1", summary: { groupId: "g-alpha", repoId: "repo-1", state: "running", commandRevision: 5 },
      proposal: { proposalVersion: 3 }, ledger: { groupLimit: LIMIT },
    } },
    "POST groups/g-alpha/set-limit": { status: 422, body: { error: { code: "group-budget-unavailable", message: "group-budget-unavailable:attempts:+20",
      commandRevision: 5, evidenceIds: [], retryable: false, shortfall: { attempts: { have: 80, need: 60 } } } } },
  };
  const ARGS = ["group", "set-limit", "g-alpha", "--limit", "{\"attempts\":60}"];

  it("the next line names the short dimension and the complete limit that holds it", async () => {
    const p = await fakePanel(routes);
    const human = await cli(ARGS, p.dir);
    expect(human.code).toBe(2);
    expect(human.stderr).toContain("orca: next: orca group set-limit g-alpha --limit '{\"tokens\":6000000,\"activeMs\":14400000,\"attempts\":80,\"sessions\":60}' --as-person");
    expect(human.stderr).toContain("(short: attempts by 20)");
  });

  it("the --json body keeps the panel's shortfall and gains the same next command", async () => {
    const p = await fakePanel(routes);
    const json = await cli([...ARGS, "--json"], p.dir);
    expect(json.code).toBe(2);
    const body = json.json().body as { error: { shortfall: { attempts: { have: number; need: number } } }; next?: string[] };
    expect(body.error.shortfall.attempts).toEqual({ have: 80, need: 60 });
    expect(body.next).toEqual(["orca group set-limit g-alpha --limit '{\"tokens\":6000000,\"activeMs\":14400000,\"attempts\":80,\"sessions\":60}' --as-person  (short: attempts by 20)"]);
  });
});