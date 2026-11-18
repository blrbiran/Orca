// Tester #365(a) (batch D C4): a group delivered with `keep` leaves its files on orca/<group>, not in the person's working
// tree, and nothing said so. `group show` of such a done group names the branch (and the tip when the view has one), the
// commands that list and take the files, and local delivery as the alternative.
import { describe, expect, it } from "vitest";
import { formatWithUnestimated } from "../../src/commands/domains/verbs.js";

const TIP = "abcdef0123456789abcdef0123456789abcdef01";
const body = (over: { state?: string; delivery?: string; tip?: string | null; folders?: boolean } = {}) => ({
  summary: { groupId: "g-alpha", state: over.state ?? "done", ...(over.tip === null ? {} : { acceptance: { tip: over.tip ?? TIP, result: "passed", commands: [] } }),
    ...(over.folders === true ? { placement: { state: "placed" } } : {}) },
  integration: { scheme: { delivery: over.delivery ?? "keep" } }, workItems: [], runs: [],
});
const lines = (b: unknown) => formatWithUnestimated(b).split("\n");

describe("a kept delivery says where its files are (#365a)", () => {
  it("names the branch and tip, how to list and take the files, and local delivery", () => {
    const out = lines(body());
    // mutation: drop keptLines from formatWithUnestimated -> red here.
    expect(out).toContain("delivery: keep -- the files are on orca/g-alpha (tip abcdef012345), not in your working tree");
    expect(out).toContain("  list them: git diff --name-only HEAD...orca/g-alpha");
    expect(out).toContain("  take them: git checkout orca/g-alpha -- <paths>");
    expect(out).toContain("  or: local delivery merges them into a local branch for groups confirmed after: orca project set-integration --delivery local --target <branch>");
  });

  it("leaves the tip out when the view has none", () => {
    // mutation: always print the tip clause -> red here.
    expect(lines(body({ tip: null }))).toContain("delivery: keep -- the files are on orca/g-alpha, not in your working tree");
  });

  it("says nothing for a group not done, another delivery, or a folder group", () => {
    for (const b of [body({ state: "running" }), body({ delivery: "local" }), body({ folders: true })]) {
      expect(formatWithUnestimated(b)).not.toContain("not in your working tree");
    }
  });
});
