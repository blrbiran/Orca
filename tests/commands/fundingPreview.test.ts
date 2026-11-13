// Issue #212: an authored work allocation is a request; the group limit funds less. `proposal show` and `group confirm`
// print what a claim would actually grant now.
// Ruling (2026-11-12, tester follow-up G): #212 asks for the funded grant in --json too (agents read JSON), so "JSON is
// unchanged" is replaced: the document's own fields stay as they were and `funding` (the preview's rows) follows them.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const LINE = "task t1: authored 600000; a claim now funds 159529";
const preview = { status: 200, body: { schema: "orca-funding-preview-v1", groupId: "g-alpha", rows: [
  { taskId: "t1", authoredTokens: 600000, fundableTokens: 159529, reason: null },
] } };
const routes = { "GET groups/g-alpha/funding-preview": preview };

describe("the grant a claim would fund is shown (#212)", () => {
  it("proposal show prints it, and JSON carries the same rows after the document's own fields", async () => {
    const w = await world({}, routes);
    const shown = await cli(["proposal", "show", "g-alpha"], w.dir);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain(LINE);
    const json = await cli(["proposal", "show", "g-alpha", "--json"], w.dir);
    const body = JSON.parse(json.stdout).body as Record<string, unknown>;
    expect(JSON.parse(json.stdout)).toMatchObject({ status: 200, body: { schema: "orca-proposal-view-v1" } });
    expect(Object.keys(body)).toEqual(["schema", "groupId", "revision", "proposal", "allocations", "groupLimit", "funding"]);
    expect(body.funding).toEqual(preview.body.rows);
  });

  it("group confirm prints it before the command's own answer", async () => {
    const w = await world({}, routes);
    const confirmed = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(confirmed.code).toBe(0);
    expect(confirmed.stdout).toContain(LINE);
  });

  it("a task with nothing fundable is named with its reason", async () => {
    const w = await world({}, { "GET groups/g-alpha/funding-preview": { status: 200, body: { schema: "orca-funding-preview-v1", groupId: "g-alpha", rows: [
      { taskId: "t1", authoredTokens: 600000, fundableTokens: null, reason: "group-budget-unavailable", minimumTokens: 300001 },
    ] } } });
    expect((await cli(["proposal", "show", "g-alpha"], w.dir)).stdout).toContain("task t1: authored 600000; a claim now funds nothing (group-budget-unavailable)");
  });

  it("a funded claim with no token amount reads unlimited, and a task waiting for its dependencies says so (tester follow-up I)", async () => {
    const w = await world({}, { "GET groups/g-alpha/funding-preview": { status: 200, body: { schema: "orca-funding-preview-v1", groupId: "g-alpha", rows: [
      { taskId: "t1", authoredTokens: null, fundableTokens: null, reason: null },
      { taskId: "t2", authoredTokens: null, fundableTokens: null, reason: "dependencies-pending" },
    ] } } });
    const out = (await cli(["proposal", "show", "g-alpha"], w.dir)).stdout;
    // mutation K-D3: fundingLines reads a null amount as nothing -> "funds nothing (unavailable)", red
    expect(out).toContain("task t1: authored unlimited; a claim now funds unlimited");
    // mutation K-D4: no dependencies-pending words -> "funds nothing (dependencies-pending)", red
    expect(out).toContain("task t2: authored unlimited; a claim now funds nothing yet (it waits for its dependencies)");
  });
});
