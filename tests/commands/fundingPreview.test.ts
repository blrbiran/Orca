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

  // Tester #479: the panel's limitCheck warnings are printed before the rows, named by code, in proposal show and group
  // confirm; --json carries `limitCheck` after `funding` (only-add); a row the headroom leaves nothing is named; a refused
  // confirm names both ways past it.
  it("prints the limit's arithmetic warnings and budget-slice-zero, and --json carries limitCheck", async () => {
    const message = "allocations 3,400,000 > limit 3,000,000; the limit 3,000,000 pays goal-review (1,000,000) and handoffs (2,400,000) first; the lane share = remainder / concurrent candidates; each lane ≈ 607,979 (2 concurrent candidates)";
    const limitCheck = { limitTokens: 3_000_000, goalReviewTokens: 1_000_000, handoffTokens: 2_400_000, allocationTokens: 3_400_000, lanes: 2, laneTokens: 607_979, largestExpected: null, warnings: [{ code: "limit-below-allocations", message }] };
    const w = await world({}, { "GET groups/g-alpha/funding-preview": { status: 200, body: { schema: "orca-funding-preview-v1", groupId: "g-alpha", limitCheck, rows: [
      { taskId: "t1", authoredTokens: null, fundableTokens: 607_979, reason: null, expectation: true },
      { taskId: "t2", authoredTokens: null, fundableTokens: null, reason: "group-budget-unavailable", expectation: true, warning: "budget-slice-zero" },
    ] } } });
    for (const args of [["proposal", "show", "g-alpha"], ["group", "confirm", "g-alpha"]]) {
      const out = (await cli(args, w.dir)).stdout;
      // mutation: drop the warnings from fundingLines -> red
      expect(out).toContain(`warning: limit-below-allocations: ${message}`);
      expect(out).toContain("task t2: authored token expectation unset; claim unavailable (group-budget-unavailable) [budget-slice-zero: the group's headroom leaves this lane nothing now]");
    }
    const body = JSON.parse((await cli(["proposal", "show", "g-alpha", "--json"], w.dir)).stdout).body as Record<string, unknown>;
    expect(Object.keys(body).slice(-2)).toEqual(["funding", "limitCheck"]);
    expect(body.limitCheck).toEqual(limitCheck);
  });

  it("a confirm refused limit-below-allocations names set-limit and --accept-shortfall", async () => {
    const w = await world({}, { "POST groups/g-alpha/confirm": { status: 422, body: { error: { code: "limit-below-allocations", message: "limit-below-allocations:3400000>3000000", retryable: false } } } });
    const out = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(out.code).toBe(2);
    expect(out.stderr).toContain("orca: next: orca group set-limit g-alpha --limit <at least the allocations> --as-person");
    expect(out.stderr).toContain("orca: next: orca group confirm g-alpha --accept-shortfall");
  });

  it("a task with nothing fundable is named with its reason", async () => {
    const w = await world({}, { "GET groups/g-alpha/funding-preview": { status: 200, body: { schema: "orca-funding-preview-v1", groupId: "g-alpha", rows: [
      { taskId: "t1", authoredTokens: 600000, fundableTokens: null, reason: "group-budget-unavailable", minimumTokens: 300001 },
    ] } } });
    expect((await cli(["proposal", "show", "g-alpha"], w.dir)).stdout).toContain("task t1: authored 600000; a claim now funds nothing (group-budget-unavailable)");
  });

  it("names an expectation and its claim-time share without promising an unlimited run or a hard task cap (#291)", async () => {
    const w = await world({}, { "GET groups/g-alpha/funding-preview": { status: 200, body: { schema: "orca-funding-preview-v1", groupId: "g-alpha", rows: [
      { taskId: "t1", authoredTokens: null, fundableTokens: null, reason: null, expectation: true },
      { taskId: "t2", authoredTokens: 600000, fundableTokens: 159529, reason: null, expectation: true },
      { taskId: "t3", authoredTokens: 600000, fundableTokens: null, reason: "task-active", expectation: true },
      { taskId: "t4", authoredTokens: 600000, fundableTokens: null, reason: "task-done", expectation: true },
    ] } } });
    const out = (await cli(["proposal", "show", "g-alpha"], w.dir)).stdout;
    expect(out).toContain("task t1: authored token expectation unset; claim-time share unspecified; run ceiling follows any group limit or pause line");
    expect(out).toContain("task t2: authored token expectation 600000; claim-time share 159529; run ceiling follows any group limit or pause line");
    expect(out).toContain("task t3: already running (claim not applicable)");
    expect(out).toContain("task t4: already done (claim not applicable)");
    expect(out).not.toContain("a claim now funds unlimited");
  });

  it("states a person's hard task cap instead of calling the null allocation unlimited (#291 review)", async () => {
    const w = await world({}, { "GET groups/g-alpha/funding-preview": { status: 200, body: { schema: "orca-funding-preview-v1", groupId: "g-alpha", rows: [
      { taskId: "t1", authoredTokens: null, fundableTokens: null, reason: null, taskCapTokens: 400000 },
    ] } } });
    const out = (await cli(["proposal", "show", "g-alpha"], w.dir)).stdout;
    expect(out).toContain("task t1: hard task cap 400000 total; claim-time share unspecified; the run uses the remaining cap");
    expect(out).not.toContain("a claim now funds unlimited");
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
