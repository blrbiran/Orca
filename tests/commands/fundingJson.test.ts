// Issue #212: the grant a claim would fund was printed for a person only; an agent reads --json. `proposal show --json` and
// `group confirm --json` now carry the funding preview's rows as `funding`, after the body's own fields (only-add), and
// leave the field out when the preview has no rows.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const ROWS = [
  { taskId: "t1", authoredTokens: 600000, fundableTokens: 159529, reason: null },
  { taskId: "t2", authoredTokens: 300000, fundableTokens: null, reason: "group-budget-unavailable" },
];
const routes = { "GET groups/g-alpha/funding-preview": { status: 200, body: { schema: "orca-funding-preview-v1", groupId: "g-alpha", rows: ROWS } } };

describe("the funded grant reaches --json (#212)", () => {
  it("proposal show --json: the document's fields as before, then funding", async () => {
    const w = await world({}, routes);
    const body = (await cli(["proposal", "show", "g-alpha", "--json"], w.dir)).json().body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["schema", "groupId", "revision", "proposal", "allocations", "groupLimit", "funding"]);
    expect(body.funding).toEqual(ROWS);
  });

  it("proposal show without --json prints the funding lines, not the rows", async () => {
    const out = await cli(["proposal", "show", "g-alpha"], (await world({}, routes)).dir);
    expect(out.stdout).toContain("task t1: authored 600000; a claim now funds 159529");
    expect(out.stdout).not.toContain("fundableTokens");
  });

  it("group confirm --json: the answer gains funding", async () => {
    const w = await world({}, routes);
    const out = await cli(["group", "confirm", "g-alpha", "--json"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect((out.json().body as { funding?: unknown }).funding).toEqual(ROWS);
  });

  it("no rows: no funding field", async () => {
    const w = await world();
    expect((await cli(["proposal", "show", "g-alpha", "--json"], w.dir)).json().body).not.toHaveProperty("funding");
    expect((await cli(["group", "confirm", "g-alpha", "--json"], w.dir)).json().body).not.toHaveProperty("funding");
  });
});
