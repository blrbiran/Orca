// Tester #365(a) (batch D C4): a group delivered with `keep` leaves its files on orca/<group>, not in the person's working
// tree, and nothing said so. `group show` and `group brief` of such a done group name the branch (and the tip when the
// view has one), the commands that list and take the files, and local delivery as the alternative. A keep group has no
// integration record at all (newGroupIntegration returns null for keep; the view then has no `integration`), so a missing
// record is keep.
import { describe, expect, it } from "vitest";
import { formatWithUnestimated } from "../../src/commands/domains/verbs.js";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";

useFakePanels();

const TIP = "abcdef0123456789abcdef0123456789abcdef01";
type Over = { state?: string; delivery?: string; tip?: string | null; folders?: boolean; multi?: boolean };
const summary = (over: Over) => ({ groupId: "g-alpha", state: over.state ?? "done",
  ...(over.tip === null ? {} : { acceptance: { tip: over.tip ?? TIP, result: "passed", commands: [] } }),
  ...(over.folders === true ? { placement: { state: "idle" } } : {}), ...(over.multi === true ? { multiDir: { dirs: [] } } : {}) });
// The real server shape: no `integration` for keep; a record with its scheme otherwise.
const body = (over: Over = {}) => ({ summary: summary(over), ...(over.delivery === undefined ? {} : { integration: { scheme: { delivery: over.delivery } } }), workItems: [], runs: [] });
const lines = (b: unknown) => formatWithUnestimated(b).split("\n");

const KEPT = [
  "delivery: keep -- the files are on orca/g-alpha (tip abcdef012345), not in your working tree",
  "  list them: git diff --name-only HEAD...orca/g-alpha",
  "  take them: git checkout orca/g-alpha -- <paths>   (this overwrites uncommitted edits in those paths)",
  "  or deliver this group locally (needs a person token): orca group set-integration g-alpha --delivery local --target <branch>",
  "  for later groups: orca project set-integration --delivery local --target <branch>",
];

describe("a kept delivery says where its files are (#365a)", () => {
  it("group show of a done group with no integration record (keep) names the branch, tip, commands and local delivery", () => {
    const out = lines(body());
    // mutation: read a missing integration as not keep -> red here.
    for (const line of KEPT) expect(out).toContain(line);
  });

  it("an explicit keep scheme reads the same", () => {
    const out = lines(body({ delivery: "keep" }));
    for (const line of KEPT) expect(out).toContain(line);
  });

  it("leaves the tip out when the view has none", () => {
    // mutation: always print the tip clause -> red here.
    expect(lines(body({ tip: null }))).toContain("delivery: keep -- the files are on orca/g-alpha, not in your working tree");
  });

  it("says nothing for a group not done, another delivery, a folder group or a multi-directory group", () => {
    for (const b of [body({ state: "running" }), body({ delivery: "local" }), body({ folders: true }), body({ multi: true })]) {
      expect(formatWithUnestimated(b)).not.toContain("not in your working tree");
    }
  });

  it("group brief prints the same lines from the brief's delivery, and none when the brief does not say", async () => {
    const brief = (extra: Record<string, unknown>) => fakePanel({
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "done", commandRevision: 7 }] } },
      "GET groups/g-alpha/brief": { status: 200, body: { schema: "orca-group-brief-v1", ...summary({}), commandRevision: 7, ...extra } },
    });
    const kept = await cli(["group", "brief", "g-alpha"], (await brief({ delivery: "keep" })).dir);
    expect(kept.code, kept.stderr).toBe(0);
    // mutation: drop keptLines from the brief formatter -> red here.
    for (const line of KEPT) expect(kept.stdout.split("\n")).toContain(line);
    expect((await cli(["group", "brief", "g-alpha"], (await brief({ delivery: "local" })).dir)).stdout).not.toContain("not in your working tree");
    expect((await cli(["group", "brief", "g-alpha"], (await brief({})).dir)).stdout).not.toContain("not in your working tree");
  });
});
