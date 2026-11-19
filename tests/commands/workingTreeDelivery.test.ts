// Working-tree delivery spec 2026-11-19 §4.6, §6 (#365): what `group brief` says about a working-tree group -- pending,
// written, blocked (with its next step) -- from the integration record alone. Any other delivery prints nothing new.
import { describe, expect, it } from "vitest";
import { formatWithUnestimated, workingTreeLines } from "../../src/commands/domains/verbs.js";
import { cli, fakePanel, useFakePanels } from "./fixtures/fakePanel.js";
import { world } from "./fixtures/world.js";

useFakePanels();

const WT = { scheme: { delivery: "working-tree" }, state: "idle", reason: null, lastIntegrated: null };
const TIP = "a".repeat(40);

describe("group brief's working-tree lines (spec §4.6)", () => {
  it("says nothing for any other delivery or no record", () => {
    expect(workingTreeLines("g", { state: "done" }, undefined)).toEqual([]);
    expect(workingTreeLines("g", { state: "done" }, { ...WT, scheme: { delivery: "local" } })).toEqual([]);
  });
  it("pending before the group is done; not written yet once done; written once lastIntegrated is the accepted tip", () => {
    expect(workingTreeLines("g", { state: "running" }, WT)).toEqual(["delivery: working-tree -- will be written into your working tree once the group is accepted"]);
    expect(workingTreeLines("g", { state: "done", acceptance: { tip: TIP } }, WT)).toEqual(["delivery: working-tree -- not written yet; a driver round writes it into your working tree"]);
    // mutation: drop the lastIntegrated == tip comparison -> an older delivery reads as written, red
    expect(workingTreeLines("g", { state: "done", acceptance: { tip: TIP } }, { ...WT, lastIntegrated: "b".repeat(40) }))
      .toEqual(["delivery: working-tree -- not written yet; a driver round writes it into your working tree"]);
    expect(workingTreeLines("g", { state: "done", acceptance: { tip: TIP } }, { ...WT, lastIntegrated: TIP })).toEqual([
      "delivery: working-tree -- written into your working tree (uncommitted, tip aaaaaaaaaaaa), including Orca's decision records under .decisions/",
      "  review: git status", "  the same files: git diff --name-only HEAD...orca/g"]);
  });
  it("blocked: the reason as recorded, and its next step (written paths included for write-failed)", () => {
    expect(workingTreeLines("g", { state: "done" }, { ...WT, state: "blocked", reason: "integration-working-tree-conflict:a.txt" })).toEqual([
      "delivery: working-tree blocked: integration-working-tree-conflict:a.txt",
      "  next: commit, move or discard your copies of these paths, then Retry; or take the files yourself: git checkout orca/g -- <path>; or orca group set-integration g --delivery keep; orca group retry-integration g"]);
    expect(workingTreeLines("g", { state: "done" }, { ...WT, state: "blocked", reason: "integration-working-tree-write-failed:n2.txt:ENOSPC:written 1 (n1.txt)" })).toEqual([
      "delivery: working-tree blocked: integration-working-tree-write-failed:n2.txt:ENOSPC:written 1 (n1.txt)",
      "  next: fix the cause, then Retry; files already written are kept and skipped; orca group retry-integration g"]);
  });
});

// spec §4.4 step 1, §4.6: the server names the stacked prerequisite this group's delivery waits for (`waitingFor`).
describe("the waiting row (spec §4.6)", () => {
  it("a done group whose delivery waits for a prerequisite says which one", () => {
    // mutation: drop the waitingFor branch -> "not written yet", red
    expect(workingTreeLines("g", { state: "done", acceptance: { tip: TIP } }, { ...WT, waitingFor: "g-pre" }))
      .toEqual(["delivery: working-tree -- waiting for g-pre to be written into your working tree first"]);
    // A group not done yet keeps its pending line: waiting is about the write, not the work.
    expect(workingTreeLines("g", { state: "running" }, { ...WT, waitingFor: "g-pre" }))
      .toEqual(["delivery: working-tree -- will be written into your working tree once the group is accepted"]);
  });
});

// spec §4.2 item 3: the first-use question, only for a done keep group of a project nobody chose a delivery for.
const QUESTION = [
  "delivery: not chosen for this project yet (a person's choice; needs a person token)",
  "  put this group's files in your working tree (uncommitted): orca group set-integration g-alpha --delivery working-tree",
  "  and for later groups: orca project set-integration --delivery working-tree   (or --delivery keep)",
];
const KEPT_FIRST = "delivery: keep -- the files are on orca/g-alpha (tip aaaaaaaaaaaa), not in your working tree";
const doneKeep = (extra: Record<string, unknown>) => ({ summary: { groupId: "g-alpha", state: "done", acceptance: { tip: TIP, result: "passed", commands: [] } }, workItems: [], runs: [], ...extra });

describe("the first-use question in the CLI (spec §4.2 item 3)", () => {
  it("group show asks it before the kept lines only when the view says the project's delivery was never chosen", () => {
    const out = formatWithUnestimated(doneKeep({ projectDeliveryChosen: false })).split("\n");
    // mutation: drop the question from the show formatter -> red
    expect(out.slice(out.indexOf(QUESTION[0]!), out.indexOf(QUESTION[0]!) + 4)).toEqual([...QUESTION, KEPT_FIRST]);
    // An older panel (absent field) and a chosen project print nothing new.
    expect(formatWithUnestimated(doneKeep({}))).not.toContain("not chosen for this project");
    // mutation: test the field for falsiness instead of === false -> undefined asks, red above; a running group never asks
    expect(formatWithUnestimated({ ...doneKeep({ projectDeliveryChosen: false }), summary: { groupId: "g-alpha", state: "running" } })).not.toContain("not chosen for this project");
  });

  it("group brief asks it too, and prints a working-tree group's lines from the brief's own record", async () => {
    const brief = (extra: Record<string, unknown>) => fakePanel({
      "GET summary": { status: 200, body: { schema: "orca-control-summary-v1", groups: [{ groupId: "g-alpha", state: "done", commandRevision: 7 }] } },
      "GET groups/g-alpha/brief": { status: 200, body: { schema: "orca-group-brief-v1", groupId: "g-alpha", state: "done", acceptance: { tip: TIP, result: "passed", commands: [] }, commandRevision: 7, ...extra } },
    });
    const asked = (await cli(["group", "brief", "g-alpha"], (await brief({ delivery: "keep", projectDeliveryChosen: false })).dir)).stdout.split("\n");
    // mutation: drop the question from the brief formatter -> red
    expect(asked.slice(asked.indexOf(QUESTION[0]!), asked.indexOf(QUESTION[0]!) + 4)).toEqual([...QUESTION, KEPT_FIRST]);
    expect((await cli(["group", "brief", "g-alpha"], (await brief({ delivery: "keep" })).dir)).stdout).not.toContain("not chosen for this project");
    const written = await cli(["group", "brief", "g-alpha"], (await brief({ delivery: "working-tree", integration: { ...WT, lastIntegrated: TIP } })).dir);
    // mutation: drop workingTreeLines from the brief formatter -> red
    expect(written.stdout.split("\n")).toContain("delivery: working-tree -- written into your working tree (uncommitted, tip aaaaaaaaaaaa), including Orca's decision records under .decisions/");
      // #365 review (controller ruling Q2): a brief that carries the registered checkout names it (spec §4.6 <path>), in show too.
    const named = await cli(["group", "brief", "g-alpha"], (await brief({ delivery: "working-tree", integration: { ...WT, lastIntegrated: TIP }, checkoutPath: "/Users/p/proj" })).dir);
    // mutation: drop checkoutPath from the brief formatter's workingTreeLines call -> "your working tree", red
    expect(named.stdout.split("\n")).toEqual(expect.arrayContaining([
      "delivery: working-tree -- written into /Users/p/proj (uncommitted, tip aaaaaaaaaaaa), including Orca's decision records under .decisions/",
      "  review: git -C /Users/p/proj status"]));
    // mutation: drop checkoutPath from the show formatter's call -> red
    expect(formatWithUnestimated(doneKeep({ integration: { ...WT, lastIntegrated: TIP }, checkoutPath: "/Users/p/proj" })).split("\n"))
      .toContain("delivery: working-tree -- written into /Users/p/proj (uncommitted, tip aaaaaaaaaaaa), including Orca's decision records under .decisions/");
  });

  it("group confirm names the question once after its receipt on a never-chosen project, and proceeds", async () => {
    const read = (chosen: boolean | undefined) => ({ "GET repositories/repo-1/integration": { status: 200, body: {
      schema: "orca-repository-integration-v1", repoId: "repo-1", integration: { delivery: "keep" }, revision: 0, suggestedTarget: null, ...(chosen === undefined ? {} : { chosen }) } } });
    const confirmed = await cli(["group", "confirm", "g-alpha"], (await world({}, read(false))).dir);
    expect(confirmed.code, confirmed.stderr).toBe(0);
    const out = confirmed.stdout.split("\n");
    // mutation: drop the confirm lines -> red
    expect(out).toContain(QUESTION[0]);
    expect(out).toContain(QUESTION[2]);
    expect(out.filter((line) => line === QUESTION[0])).toHaveLength(1);
    for (const chosen of [true, undefined]) expect((await cli(["group", "confirm", "g-alpha"], (await world({}, read(chosen))).dir)).stdout).not.toContain("not chosen for this project");
    // A panel without the read still confirms, saying nothing.
    const missing = await cli(["group", "confirm", "g-alpha"], (await world()).dir);
    expect(missing.code).toBe(0);
    expect(missing.stdout).not.toContain("not chosen for this project");
  });
});
