// Flow engine spec §14.2 (plan Task 15): each `orca flow` command sends one POST -- its route, revision 0 (the `@flows`
// scope; the settings their layer's), and the payload built from its arguments and the reads it makes (a run id from a
// prefix, the open plan's number, a clarify round's number, the global lock list `lock`/`unlock` edits one field of).
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { accept, world } from "./fixtures/world.js";

useFakePanels();

const RUN = "fr-0a1b2c3d-0000-4000-8000-000000000001";
const OTHER = "fr-9f000000-0000-4000-8000-000000000002";
const READS = {
  "GET flows": { status: 200, body: { schema: "orca-flow-list-v1", runs: [{ flowRunId: RUN }, { flowRunId: OTHER }] } },
  [`GET flows/${RUN}`]: { status: 200, body: { schema: "orca-flow-run-view-v1", flowRunId: RUN, plans: [{ planNo: 1, state: "abandoned" }, { planNo: 2, state: "proposed" }],
    // The real view's shape (flow/views.ts, kernel openAsks): a waiting clarify round is on its step's latest execution,
    // never in openAsks (T18 acceptance: the CLI read openAsks and could not answer any clarify round).
    openAsks: [], steps: [{ stepKey: "brief", latest: { seq: 1, state: "needs-person", ask: { kind: "clarify-round", roundNo: 2 } } }] } },
  "GET flows/settings": { status: 200, body: { locks: ["effects.cost"] } },
  // The fake ledger: the `@flows` scope is always 0, the global layer is orchestration's 4.
  ...Object.fromEntries(["flows", "flows/messages", "flows/plan", "flows/rerun", "flows/answer", "flows/effect", "flows/pool"].map((path) => [`POST ${path}`, accept(() => 0)])),
  "POST operator/flows/locks": accept(() => 4),
};

const MAPPINGS: Array<[string[], string, number, unknown]> = [
  [["flow", "start", "wechat-article", "--dir", "/posts/tea", "--param", "idea=Tea for engineers", "--param", "illustrations=true", "--clarify", "skip"], "flows", 0,
    { template: "wechat-article", dir: "/posts/tea", params: { idea: "Tea for engineers", illustrations: true }, clarify: "skip" }],
  [["flow", "start", "wechat-article", "--dir", "/posts/tea", "--pool", "500000", "--unattended"], "flows", 0, { template: "wechat-article", dir: "/posts/tea", params: {}, pool: 500000, unattended: true }],
  [["flow", "feedback", "fr-0a", "--step", "voice", "--text", "warmer"], "flows/messages", 0, { runId: RUN, kind: "feedback", target: { kind: "step", stepKey: "voice" }, body: { text: "warmer" } }],
  [["flow", "feedback", "fr-0a", "--execution", "voice#2", "--text", "warmer"], "flows/messages", 0, { runId: RUN, kind: "feedback", target: { kind: "execution", stepKey: "voice", seq: 2 }, body: { text: "warmer" } }],
  [["flow", "edit", "fr-0a", "--step", "pick-title", "--set", "title=Tea, slowly"], "flows/messages", 0, { runId: RUN, kind: "edit", target: { kind: "step", stepKey: "pick-title" }, body: { record: { title: "Tea, slowly" } } }],
  [["flow", "plan", "fr-0a"], "flows/plan", 0, { runId: RUN }],
  [["flow", "rerun", "fr-0a", "--skip", "cover,pick-title"], "flows/rerun", 0, { runId: RUN, planNo: 2, skip: ["cover", "pick-title"] }],
  [["flow", "rerun", "fr-0a", "--plan", "3", "--add", "visuals"], "flows/rerun", 0, { runId: RUN, planNo: 3, add: ["visuals"] }],
  [["flow", "discard-plan", "fr-0a"], "flows/rerun", 0, { runId: RUN, planNo: 2, discard: true }],
  [["flow", "discard-plan", "fr-0a", "--plan", "3"], "flows/rerun", 0, { runId: RUN, planNo: 3, discard: true }],
  [["flow", "rewind", "fr-0a", "--to", "draft#1", "--exclude", "4"], "flows/messages", 0, { runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "rewind", toStep: "draft", toSeq: 1, exclude: [4] } }],
  [["flow", "pause", "fr-0a"], "flows/messages", 0, { runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "pause" } }],
  [["flow", "resume", "fr-0a"], "flows/messages", 0, { runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "resume" } }],
  [["flow", "stop", "fr-0a"], "flows/messages", 0, { runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "stop" } }],
  [["flow", "retry", "fr-0a", "--step", "to-draft-box"], "flows/messages", 0, { runId: RUN, kind: "command", target: { kind: "step", stepKey: "to-draft-box" }, body: { command: "retry" } }],
  [["flow", "repin", "fr-0a", "--version", "2"], "flows/messages", 0, { runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "repin", version: 2 } }],
  [["flow", "answer", "fr-0a", "pick-title", "--set", "title=Tea, slowly"], "flows/answer", 0, { runId: RUN, stepKey: "pick-title", values: { title: "Tea, slowly" } }],
  [["flow", "answer", "fr-0a", "article", "--text", "plain"], "flows/answer", 0, { runId: RUN, stepKey: "article", text: "plain" }],
  [["flow", "answer", "fr-0a", "brief", "--answer", "R2.Q1", "--answer", "R2.Q2=short", "--glossary", "G1=accept"], "flows/answer", 0,
    { runId: RUN, stepKey: "brief", clarify: { roundNo: 2, answers: [{ id: "R2.Q1", kind: "recommended" }, { id: "R2.Q2", kind: "text", text: "short" }], glossaryDecisions: [{ id: "G1", accept: true }], adrDecisions: [] } }],
  [["flow", "answer", "fr-0a", "brief", "--consensus"], "flows/answer", 0, { runId: RUN, stepKey: "brief", consensus: true }],
  [["flow", "effect", "confirm", "eff-1"], "flows/effect", 0, { recordId: "eff-1", action: "confirm" }],
  [["flow", "effect", "enact", "eff-1"], "flows/effect", 0, { recordId: "eff-1", action: "enact" }],
  [["flow", "effect", "discard", "eff-1"], "flows/effect", 0, { recordId: "eff-1", action: "discard" }],
  [["flow", "pool", "raise", "fr-0a", "--tokens", "500000"], "flows/pool", 0, { runId: RUN, raiseTokens: 500000 }],
  [["flow", "settings", "lock", "effects.irreversible"], "operator/flows/locks", 4, { locks: ["effects.cost", "effects.irreversible"] }],
  [["flow", "settings", "unlock", "effects.cost"], "operator/flows/locks", 4, { locks: [] }],
];

describe("orca flow commands: route, revision and payload (spec §14.2)", () => {
  it.each(MAPPINGS)("orca %j sends one POST %s at revision %i", async (argv, path, revision, payload) => {
    const w = await world({}, READS);
    const out = await cli([...argv, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    const posts = w.posts();
    expect(posts).toHaveLength(1);
    expect({ path: posts[0]!.path, expectedRevision: posts[0]!.expectedRevision, payload: posts[0]!.payload }).toEqual({ path, expectedRevision: revision, payload });
  });

  it("rerun without --plan and no plan waiting is refused before anything is sent (a running plan is not the person's to run)", async () => {
    const w = await world({}, { ...READS, [`GET flows/${OTHER}`]: { status: 200, body: { schema: "orca-flow-run-view-v1", flowRunId: OTHER, plans: [{ planNo: 1, state: "running" }], openAsks: [] } } });
    const out = await cli(["flow", "rerun", "fr-9f", "--json"], w.dir);
    expect(out.code).not.toBe(0);
    expect(out.stdout + out.stderr).toContain("has no plan waiting");
    expect(w.posts()).toHaveLength(0);
  });

  it("an ambiguous run prefix is refused before anything is sent", async () => {
    const w = await world({}, READS);
    const out = await cli(["flow", "plan", "fr-", "--json"], w.dir);
    expect(out.code).not.toBe(0);
    expect(out.stdout + out.stderr).toContain("id-ambiguous");
    expect(w.posts()).toHaveLength(0);
  });
});
