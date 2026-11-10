// Tester follow-up B T2 (#202): `task retry --work` says what the next run will be funded -- authored + top-ups - lineage
// usage, which the panel's funding preview answers for that retry -- and warns when that is below what one attempt of the
// task has cost. Print-only: the request and the --json output are unchanged.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const preview = (freshTokens: number, perAttemptTokens: number) => ({ status: 200, body: { schema: "orca-funding-preview-v1", groupId: "g-alpha", rows: [],
  retry: { taskId: "t1", runId: "run-1", authoredTokens: 600000, lineageTokens: 540097, lineageAttempts: 1, freshTokens, perAttemptTokens } } });
const ARGS = ["task", "retry", "g-alpha", "t1", "--work", '{"tokens":300000}'];
const FUNDED = "the next run of t1 is funded at most 59903 tokens (authored 600000 with top-ups, minus 540097 used by its earlier runs)";
const WARNING = "warning: 59903 tokens is less than one attempt of t1 has cost (540097); the run may stop or overspend before it finishes an attempt";

describe("task retry --work states the fresh grant (#202)", () => {
  it("prints the fresh grant and warns when it is below one attempt's cost", async () => {
    const w = await world({}, { "GET groups/g-alpha/funding-preview?retry=t1&tokens=300000": preview(59903, 540097) });
    const out = await cli(ARGS, w.dir);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain(FUNDED);
    expect(out.stdout).toContain(WARNING);
    // The request is what it was.
    expect(w.posts().map((p) => p.payload)).toEqual([{ taskId: "t1", runId: "run-1", work: { tokens: 300000 } }]);
  });

  it("does not warn when the fresh grant covers an attempt", async () => {
    const w = await world({}, { "GET groups/g-alpha/funding-preview?retry=t1&tokens=300000": preview(59903, 50000) });
    const out = await cli(ARGS, w.dir);
    expect(out.stdout).toContain(FUNDED);
    expect(out.stdout).not.toContain("warning:");
  });

  it("keeps --json to the command's answer", async () => {
    const w = await world({}, { "GET groups/g-alpha/funding-preview?retry=t1&tokens=300000": preview(59903, 540097) });
    const out = await cli([...ARGS, "--json"], w.dir);
    expect(out.code).toBe(0);
    // The fake panel's answer (world.ts accept), nothing added.
    expect(JSON.parse(out.stdout)).toMatchObject({ status: 200, body: { commandId: expect.any(String), commandRevision: 6, result: { kind: "ok" } } });
    expect(Object.keys(JSON.parse(out.stdout).body).sort()).toEqual(["commandId", "commandRevision", "result"]);
    expect(out.stdout).not.toContain("freshTokens");
    expect(out.stdout).not.toContain("funded at most");
  });
});
