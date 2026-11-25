// Tester #499: `group set-limit` refused a limit the group cannot hold with a bare `group-budget-unavailable` -- neither
// the dimension that does not fit nor the gap was named -- and a board card's budget was tokens only. The refusal now
// carries the shortfall (in its message and in the wire body's `error.shortfall`), the card carries all four dimensions,
// and the CLI's next line names the dimensions that were short.
import { describe, expect, it } from "vitest";
import { createGroup, setGroupLimit } from "../../src/control/commands.js";
import { updateRevision } from "../../src/control/commandLedger.js";
import { ControlError } from "../../src/control/errors.js";
import { insertClarifyingGroup } from "../../src/control/requirementRecords.js";
import { WebControlService } from "../../src/control/webService.js";
import { readControlGroup, readGroupSummary } from "../../src/panel/controlViews.js";
import { cli, fakePanel, useFakePanels } from "../commands/fixtures/fakePanel.js";
import { clarifyingInput } from "./fixtures/requirement.js";
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

// Tester #499 review: set-limit has two more refusal paths that must say the same thing -- a clarifying group's reduced
// ledger (requirementRecords.setRequirementLimit) and the expectation-model top-up, whose proposed-limit conservation
// check used to answer recovery-blocked before the shortfall was seen.
describe("the same shortfall on set-limit's other paths (#499 review)", () => {
  it("a clarifying group's reduced ledger refuses with the same dimension and gap", async () => {
    const h = await webFixture();
    try {
      h.store.transaction(() => {
        insertClarifyingGroup(h.store, clarifyingInput("r"));
        updateRevision(h.store, "r", 1);
        h.store.db.prepare("UPDATE groups SET projection_seq=1 WHERE id='r'").run();
      });
      const service = new WebControlService({ ...h.deps, knownRepository: (id: string) => id === "repo" });
      const group = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body)) as {
        limit: { tokens: number | null; activeMs: number; attempts: number; sessions: number };
        used: { tokens: number }; ledger: { used: { tokens: number } } };
      group.used.tokens = 5; group.ledger.used.tokens = 5;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='r'").run(JSON.stringify(group));
      const refused = service.setLimit({ schema: "orca-raw-command-v1", commandId: "c-lower-r", actorId: "human", expectedRevision: 1,
        verb: "set-limit", target: { kind: "group", groupId: "r" }, payload: { limit: { ...group.limit, tokens: 4 } } } as never);
      expect(refused).toMatchObject({ error: { code: "group-budget-unavailable", shortfall: { tokens: { have: 5, need: 4 } } } });
      expect((refused as { error: { message: string } }).error.message).toBe("group-budget-unavailable:tokens:+1");
      // Refused atomically: the clarifying group keeps the limit it had.
      expect((JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='r'").get()!.body)) as { limit: { tokens: number | null } }).limit.tokens).toBe(10_000_000);
    } finally { await h.dispose(); }
  });

  it("an expectation-model top-up that still does not fit says which dimension is short, not recovery-blocked", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }], { modelVersion: "followup-g" });
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", { ...await h.confirmPayload(), budgetMode: "soft" }))).not.toHaveProperty("error");
      const body = groupBody(h), occupied = body.used.attempts + body.reserved.attempts;
      expect(occupied).toBeGreaterThan(1);
      const limit = { ...readControlGroup(h.store, "epoch", "g").ledger.groupLimit };
      expect(limit.tokens).not.toBeNull();
      // A real raise (tokens up, so the proposed-limit check runs) that still leaves attempts under what is held.
      const refused = service.setLimit(h.command("set-limit", { limit: { ...limit, tokens: (limit.tokens ?? 0) + 1_000, attempts: occupied - 1 } }));
      expect(refused).toMatchObject({ error: { code: "group-budget-unavailable", shortfall: { attempts: { have: occupied, need: occupied - 1 } } } });
      expect((refused as { error: { message: string } }).error.message).toBe("group-budget-unavailable:attempts:+1");
    } finally { await h.dispose(); }
  });

  it("a corrupt ledger still refuses recovery-blocked, even when the proposed limit is short", async () => {
    const h = await webFixture(profileSnapshot(), [{ taskId: "a" }], { modelVersion: "followup-g" });
    try {
      const service = new WebControlService(h.deps);
      expect(await service.confirm(h.command("confirm", { ...await h.confirmPayload(), budgetMode: "soft" }))).not.toHaveProperty("error");
      const limit = { ...readControlGroup(h.store, "epoch", "g").ledger.groupLimit };
      expect(limit.tokens).not.toBeNull();
      const body = JSON.parse(String(h.store.db.prepare("SELECT body FROM groups WHERE id='g'").get()!.body)) as {
        used: { attempts: number }; reserved: { attempts: number }; ledger: { explicitUnallocatedReserve: { tokens: number | null } } };
      const occupied = body.used.attempts + body.reserved.attempts;
      expect(occupied).toBeGreaterThan(1);
      // The group's ledger no longer mirrors its proposal's reserve: that corruption must win over the shortfall.
      body.ledger.explicitUnallocatedReserve.tokens = (body.ledger.explicitUnallocatedReserve.tokens ?? 0) + 12_345;
      h.store.db.prepare("UPDATE groups SET body=? WHERE id='g'").run(JSON.stringify(body));
      const refused = service.setLimit(h.command("set-limit", { limit: { ...limit, tokens: (limit.tokens ?? 0) + 1_000, attempts: occupied - 1 } }));
      expect(refused).toMatchObject({ error: { code: "recovery-blocked" } });
      expect((refused as { error: { shortfall?: unknown } }).error.shortfall).toBeUndefined();
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
    // The detail (which dimension, how much) is the refusal's message; the next line is a command a person can paste.
    expect(human.stderr).toContain("orca: group-budget-unavailable: attempts:+20");
    expect(human.stderr).toContain("orca: next: orca group set-limit g-alpha --limit '{\"tokens\":6000000,\"activeMs\":14400000,\"attempts\":80,\"sessions\":60}' --as-person\n");
    expect(human.stderr).not.toContain("(short: ");
  });

  it("the --json body keeps the panel's shortfall and gains the same next command", async () => {
    const p = await fakePanel(routes);
    const json = await cli([...ARGS, "--json"], p.dir);
    expect(json.code).toBe(2);
    const body = json.json().body as { error: { shortfall: { attempts: { have: number; need: number } } }; next?: string[] };
    expect(body.error.shortfall.attempts).toEqual({ have: 80, need: 60 });
    expect(body.next).toEqual(["orca group set-limit g-alpha --limit '{\"tokens\":6000000,\"activeMs\":14400000,\"attempts\":80,\"sessions\":60}' --as-person"]);
  });
});