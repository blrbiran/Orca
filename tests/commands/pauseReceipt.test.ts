// Tester #369 (c) (plan 2026-11-18 tester batch D, D4; human ruling: no pause force-kill): `orca group pause` stops new
// claims only; an attempt already running keeps going (stuck-runs spec: "An accepted run is not held; ccloop is never told").
// The tester read "paused" as "stopped" and waited on a run that was still spending. The receipt now says that a running
// run keeps going and names the command that ends one now.
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { groupView, world } from "./fixtures/world.js";
import { en } from "../../web/src/locales/en.js";
import { zh } from "../../web/src/locales/zh.js";

useFakePanels();

const paused = { status: 200, body: { schema: "orca-command-success-v1", commandId: "c", actorId: "human", verb: "pause-dispatch", target: { kind: "group", groupId: "g-alpha" }, commandRevision: 6, projectionSeq: 6, effectivePayloadHash: "h", authorityCommandHash: "h", result: { kind: "paused", stopMode: "pause" } } };

describe("the pause receipt says what a pause does to a running run (#369 c)", () => {
  it("with a running run: it keeps running, and orca run abandon ends it now", async () => {
    const w = await world({}, { "POST groups/g-alpha/pause-dispatch": paused });
    const view = groupView();
    w.state.view = { ...view, runs: [...view.runs, { runId: "run-7", taskId: "t2", state: "running", checkpointId: null }] } as never;
    const out = await cli(["group", "pause", "g-alpha"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: drop the running-run lines from the pause formatter -> neither line, red here.
    expect(out.stdout).toContain("paused: no new run is claimed; 1 run already running keeps going until it ends (run-7)");
    expect(out.stdout).toContain("to end one now: orca run abandon g-alpha --run <run> --note <why>");
  });

  // Review of D4 (I6): a run still starting keeps going too; it is counted with the running ones.
  it("a starting run is counted with the running ones", async () => {
    const w = await world({}, { "POST groups/g-alpha/pause-dispatch": paused });
    const view = groupView();
    w.state.view = { ...view, runs: [...view.runs, { runId: "run-7", taskId: "t2", state: "running", checkpointId: null }, { runId: "run-8", taskId: "t3", state: "starting", checkpointId: null }] } as never;
    const out = await cli(["group", "pause", "g-alpha"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    // mutation: count only "running" -> 1 run (run-7), red here.
    expect(out.stdout).toContain("paused: no new run is claimed; 2 runs already running keep going until they end (run-7, run-8)");
  });

  // Review of D4 (I6): the receipt's view read never blocks the pause; one that fails gives the plain receipt.
  it("the group view cannot be read: the pause is still sent and the receipt is the plain one", async () => {
    const w = await world({}, { "POST groups/g-alpha/pause-dispatch": paused, "GET groups/g-alpha": { status: 500, body: { error: { code: "internal", message: "boom" } } } });
    const out = await cli(["group", "pause", "g-alpha"], w.dir);
    // mutation: read the view before sending, without a catch -> exit 2 and no POST, red here.
    expect(out.code, out.stderr).toBe(0);
    expect(w.posts().map((post) => post.path)).toEqual(["groups/g-alpha/pause-dispatch"]);
    expect(out.stdout.trim()).toBe("paused: no new run is claimed");
  });

  it("with no running run: no line about running runs", async () => {
    const w = await world({}, { "POST groups/g-alpha/pause-dispatch": paused });
    const out = await cli(["group", "pause", "g-alpha"], w.dir);
    expect(out.code, out.stderr).toBe(0);
    expect(out.stdout).toContain("paused: no new run is claimed");
    expect(out.stdout).not.toContain("orca run abandon");
  });

  it("the Web's pause banner says the same, and names the abandon action by its label", () => {
    expect(en.control.group.stopBanner.how.pause).toContain("a run already running keeps going until it ends");
    expect(en.control.group.stopBanner.how.pause).toContain(en.control.abandonRun.open);
    expect(zh.control.group.stopBanner.how.pause).toContain(zh.control.abandonRun.open);
  });
});
