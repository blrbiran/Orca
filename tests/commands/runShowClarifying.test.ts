// Tester #374 (c): `orca run show <run>` of a requirement call refused with requirement-not-split while the group was
// still clarifying (the group view it read is refused for such a group), and without --group it scanned every group's
// view before giving up with run-not-found. It now reads the run's entry by its id (GET runs/:runId): the clarifying
// group's call shows its phase and purpose, with or without --group, and no group view is read.
import { describe, expect, it } from "vitest";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const RUN = "run-e55c";
const SUMMARY = { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "pc-1", state: "clarifying", commandRevision: 2 }, { groupId: "other", state: "running", commandRevision: 1 }] } };
const REFUSED = { status: 422, body: { error: { code: "requirement-not-split", message: "requirement-not-split", retryable: false } } };
const ENTRY = { status: 200, body: { schema: "orca-run-entry-v1", groupId: "pc-1", run: { runId: RUN, taskId: null, phase: "single-call", purpose: "clarify", state: "settled-restartable", agent: { installation: "codex", model: "group/never-stuck" } } } };
const routes = {
  "GET summary": SUMMARY, "GET groups/pc-1": REFUSED, "GET groups/other": { status: 200, body: { summary: { groupId: "other" }, runs: [] } },
  [`GET runs/${RUN}`]: ENTRY,
  [`GET runs/${RUN}/activity`]: { status: 200, body: { schema: "orca-run-activity-v1", runId: RUN, entries: [{ kind: "run-started", at: 1, body: {} }] } },
  [`GET runs/${RUN}/evidence`]: { status: 200, body: { schema: "orca-run-evidence-v1", runId: RUN, entries: [] } },
};

describe("run show reads a clarifying group's requirement call (#374 c)", () => {
  it("with --group: the call's entry, phase and purpose; no group view read", async () => {
    const p = await fakePanel(routes);
    const out = await cli(["run", "show", RUN, "--group", "pc-1"], p.dir);
    // mutation: read the run's entry from the group view again -> requirement-not-split, exit 2, red
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain("group pc-1");
    expect(out.stdout).toContain('"phase":"single-call"');
    expect(out.stdout).toContain('"purpose":"clarify"');
    expect(p.requests.map((r) => r.path)).not.toContain("groups/pc-1");
  });

  it("without --group: found by its id alone, no scan of the groups", async () => {
    const p = await fakePanel(routes);
    const out = await cli(["run", "show", RUN, "--json"], p.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.json().body).toMatchObject({ schema: "orca-run-show-v1", groupId: "pc-1", run: { runId: RUN, phase: "single-call", purpose: "clarify" } });
    // mutation: keep the scan (groupOfRun) -> groups/... read, red
    expect(p.requests.map((r) => r.path).filter((path) => path.startsWith("groups/"))).toEqual([]);
  });

  it("--group naming another group: run-not-found, as before (#242)", async () => {
    const p = await fakePanel(routes);
    const out = await cli(["run", "show", RUN, "--group", "other"], p.dir);
    // mutation: drop the membership check on the entry's group -> exit 0, red
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("run-not-found");
    expect(out.stderr).toContain(`run ${RUN} is not in group other`);
  });
});
