// Tester follow-up G §6.3 (#189): `orca decision allow` / `allow-paths` / `revoke-allowance` -- one POST each, group revision;
// "every request of this kind in this group" is the default, --one narrows it. `group show` lists what the group allows.
import { describe, expect, it } from "vitest";
import { allowanceLines } from "../../src/commands/domains/verbs.js";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const MAPPINGS: Array<[string[], string, unknown]> = [
  [["decision", "allow", "g-alpha", "pending-r-0"], "groups/g-alpha/allowances/allow", { request: { kind: "pending-decision", pendingId: "pending-r-0" }, scope: "group" }],
  [["decision", "allow", "g-alpha", "pending-r-0", "--one"], "groups/g-alpha/allowances/allow", { request: { kind: "pending-decision", pendingId: "pending-r-0" }, scope: "one" }],
  [["decision", "allow", "g-alpha", "r1/orca-criteria"], "groups/g-alpha/allowances/allow", { request: { kind: "flagged-decision", decisionId: "r1/orca-criteria" }, scope: "group" }],
  [["decision", "allow-paths", "g-alpha", "--run", "run-1"], "groups/g-alpha/allowances/allow", { request: { kind: "path", runId: "run-1" }, scope: "group" }],
  [["decision", "allow-paths", "g-alpha", "--run", "run-1", "--one"], "groups/g-alpha/allowances/allow", { request: { kind: "path", runId: "run-1" }, scope: "one" }],
  [["decision", "revoke-allowance", "g-alpha", "allow-1"], "groups/g-alpha/allowances/revoke", { allowanceId: "allow-1" }],
];

describe("decision allow sends a group-scoped allow by default and --one narrows it", () => {
  it.each(MAPPINGS)("orca %j sends one POST %s", async (argv, path, payload) => {
    const w = await world();
    const out = await cli([...argv, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(w.posts().map((p) => ({ path: p.path, expectedRevision: p.expectedRevision, payload: p.payload }))).toEqual([{ path, expectedRevision: 5, payload }]);
  });
});

describe("group show lists what is allowed in the group", () => {
  it("names each allowance with what, who, how, when, from where, and a revoke", () => {
    expect(allowanceLines([
      { allowanceId: "allow-1", request: { type: "path", paths: [{ repoKey: null, path: "docs/notes.md" }] }, from: { runId: "run-1" }, by: "ana", via: "web", at: Date.UTC(2026, 10, 12) },
      { allowanceId: "allow-2", request: { type: "pending-decision", kind: "interface", scope: "task" }, from: { pendingId: "pending-r-0" }, by: "agent:cli:claude", via: "cli:claude", at: Date.UTC(2026, 10, 12, 1),
        revoked: { by: "ana", at: Date.UTC(2026, 10, 12, 2) } },
    ])).toEqual([
      "allowed in this group:",
      "  allow-1: paths docs/notes.md by ana via web at 2026-11-12T00:00:00.000Z from run-1",
      "  allow-2: pending decisions of kind interface scope task by agent:cli:claude via cli:claude at 2026-11-12T01:00:00.000Z from pending-r-0 (revoked by ana at 2026-11-12T02:00:00.000Z)",
    ]);
    expect(allowanceLines(undefined)).toEqual([]);
  });
});
