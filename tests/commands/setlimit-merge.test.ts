// Tester #386 (b): `group set-limit --limit` takes a partial budget (the group's current limit fills the rest) or a bare
// token count. The merge is CLI-side: the wire still carries the complete four-field budget, and the panel's strict
// `budgetAmountSchema` is untouched. Tester #389: `group cap` after Orca's automatic confirm says so and names set-limit.
import { describe, expect, it } from "vitest";
import { mergedLimit } from "../../src/commands/domains/work.js";
import { budgetAmountSchema } from "../../src/control/schema.js";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const current = { tokens: 1000, activeMs: 10, attempts: 2, sessions: 2 };

describe("group set-limit --limit merges a partial budget (#386 b)", () => {
  it.each([
    ["a partial object keeps the group's current dimensions", "{\"tokens\":2000}", { ...current, tokens: 2000 }],
    ["a bare number sets the tokens", "24000000", { ...current, tokens: 24000000 }],
    ["the whole object passes through", "{\"tokens\":9,\"activeMs\":1,\"attempts\":1,\"sessions\":1}", { tokens: 9, activeMs: 1, attempts: 1, sessions: 1 }],
    // The merge keeps null (unlimited) as a value, as budgetAmountSchema allows.
    ["null tokens with a partial object stay unlimited only for tokens", "{\"tokens\":null,\"attempts\":4}", { ...current, tokens: null, attempts: 4 }],
  ])("%s", async (_label, limit, expected) => {
    const w = await world();
    const out = await cli(["group", "set-limit", "g-alpha", "--limit", limit, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    const posts = w.posts();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ path: "groups/g-alpha/set-limit", expectedRevision: 5, payload: { limit: expected } });
  });

  it("names the invalid field and sends nothing", async () => {
    const w = await world();
    const out = await cli(["group", "set-limit", "g-alpha", "--limit", "{\"activeMs\":1.5}"], w.dir);
    // mutation: parse the object and send it as given -> the panel would refuse it; here it must not be sent.
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("activeMs");
    expect(out.stderr).toContain("non-negative safe integer");
    expect(w.posts()).toEqual([]);
  });

  it("names an unknown field and sends nothing", async () => {
    const w = await world();
    const out = await cli(["group", "set-limit", "g-alpha", "--limit", "{\"tokens\":9,\"rateLimit\":1}"], w.dir);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("rateLimit");
    expect(out.stderr).toContain("tokens, activeMs, attempts, sessions");
    expect(w.posts()).toEqual([]);
  });

  it("a value that is neither an object nor a token count is refused", async () => {
    const w = await world();
    const out = await cli(["group", "set-limit", "g-alpha", "--limit", "lots"], w.dir);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("--limit wants a budget object");
    expect(w.posts()).toEqual([]);
  });
});

describe("the wire schema stays strict (#386 b)", () => {
  it("the merge names the field it cannot fill when the current limit is incomplete", () => {
    // mutation: spread the current limit without checking it -> an incomplete payload would go on the wire.
    expect(() => mergedLimit("{\"tokens\":5}", { tokens: 1, activeMs: 1, attempts: 1 } as never)).toThrow(/sessions/);
  });

  it("refuses a genuinely incomplete budget, naming the missing field", () => {
    const parsed = budgetAmountSchema.safeParse({ tokens: 5, activeMs: 1, attempts: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.path.join("."))).toContain("sessions");
  });

  it("still refuses an unknown field", () => {
    expect(budgetAmountSchema.safeParse({ ...current, rateLimit: 1 }).success).toBe(false);
  });
});

describe("group cap after the automatic confirm says so (#389)", () => {
  it("names the auto-confirm and the set-limit that replaces cap", async () => {
    const w = await world();
    w.state.view.proposal.state = "confirmed";
    (w.state.view as { recentCommandIds?: string[] }).recentCommandIds = ["orca-auto-confirm-unlimited-v3"];
    const out = await cli(["group", "cap", "g-alpha", "--tokens", "500"], w.dir);
    // mutation: keep the old "needs an editable proposal" text -> red.
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("already auto-confirmed");
    expect(out.stderr).toContain("orca group set-limit g-alpha");
    expect(w.posts()).toEqual([]);
  });

  it("a proposal a person confirmed without the automatic pass keeps the old refusal", async () => {
    const w = await world();
    w.state.view.proposal.state = "confirmed";
    const out = await cli(["group", "cap", "g-alpha", "--tokens", "500"], w.dir);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("group cap needs an editable proposal");
    expect(w.posts()).toEqual([]);
  });
});
