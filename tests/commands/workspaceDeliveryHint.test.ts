// Tester #328: `workspaceMode=worktree` gives the run a read-only view of the shared Git directory, so an agent cannot
// write `main` (or a group branch) itself. The supported answers are a `clone` workspace or `working-tree` delivery; the
// combination is not refused (the group model still lands on `orca/<group>`), but confirm says so before the spend.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { groupView, world } from "./fixtures/world.js";

useFakePanels();

const LOCAL = { scheme: { delivery: "local", trigger: "group", method: "merge", target: "main" }, schemeHash: "a".repeat(64), frozen: true, state: "idle", reason: null, lastIntegrated: null, integratedCommit: null, pr: null };
const KEEP = { scheme: { delivery: "keep" }, schemeHash: "b".repeat(64), frozen: true, state: "idle", reason: null, lastIntegrated: null, integratedCommit: null, pr: null };
const HINT = "the agent cannot write the shared Git directory";

describe("confirm names a worktree workspace that cannot write the delivery target (#328)", () => {
  it("worktree + local: the line and --json warnings both carry the hint", async () => {
    const view = groupView({ integration: LOCAL });
    const routes = { "GET groups/g-alpha": { status: 200, body: view } };
    const w = await world({}, routes);
    const confirmed = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(confirmed.code, confirmed.stderr).toBe(0);
    expect(confirmed.stdout).toContain(HINT);
    expect(confirmed.stdout).toContain("--delivery working-tree");
    const json = await cli(["group", "confirm", "g-alpha", "--json"], (await world({}, routes)).dir);
    expect(JSON.parse(json.stdout).body.warnings).toEqual(expect.arrayContaining([expect.stringContaining(HINT)]));
  });

  it("clone + local: no hint", async () => {
    const view = groupView({ integration: LOCAL });
    const w = await world({}, {
      "GET groups/g-alpha": { status: 200, body: view },
      "GET repositories/repo-1/workspace": { status: 200, body: { schema: "orca-repository-workspace-v1", repoId: "repo-1", workspaceMode: "clone", revision: 7 } },
    });
    const confirmed = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(confirmed.code, confirmed.stderr).toBe(0);
    expect(confirmed.stdout).not.toContain(HINT);
  });

  it("worktree + keep: no hint", async () => {
    const w = await world({}, { "GET groups/g-alpha": { status: 200, body: groupView({ integration: KEEP }) } });
    const confirmed = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(confirmed.code, confirmed.stderr).toBe(0);
    expect(confirmed.stdout).not.toContain(HINT);
  });

  it("a panel without the workspace read says nothing", async () => {
    const w = await world({}, {
      "GET groups/g-alpha": { status: 200, body: groupView({ integration: LOCAL }) },
      "GET repositories/repo-1/workspace": { status: 404, body: { error: { code: "not-found", message: "no", evidenceIds: [], retryable: false } } },
    });
    const confirmed = await cli(["group", "confirm", "g-alpha"], w.dir);
    expect(confirmed.code, confirmed.stderr).toBe(0);
    expect(confirmed.stdout).not.toContain(HINT);
  });
});
