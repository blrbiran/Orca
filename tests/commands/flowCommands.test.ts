// Flow engine spec §14.2 (plan Task 15): each `orca flow` command sends one POST -- its route, revision 0 (the `@flows`
// scope; the settings their layer's), and the payload built from its arguments and the reads it makes (a run id from a
// prefix, the open plan's number, a clarify round's number, the global lock list `lock`/`unlock` edits one field of).
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { accept, world } from "./fixtures/world.js";

useFakePanels();

const RUN = "fr-0a1b2c3d-0000-4000-8000-000000000001";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const OTHER = "fr-9f000000-0000-4000-8000-000000000002";
const READS = {
  "GET flows": { status: 200, body: { schema: "orca-flow-list-v1", runs: [{ flowRunId: RUN }, { flowRunId: OTHER }] } },
  [`GET flows/${RUN}`]: { status: 200, body: { schema: "orca-flow-run-view-v1", flowRunId: RUN, plans: [{ planNo: 1, state: "abandoned" }, { planNo: 2, state: "proposed" }, { planNo: 3, state: "running" }],
    // Gaps spec §4.6: a feedback intake whose clarify round waits on the person.
    intakes: [{ messageSeq: 5, state: "clarifying", clarify: { roundNo: 1, questions: [{ id: "R1.Q1", question: "Which part?", recommendedAnswer: "The intro" }] } }],
    // The real view's shape (flow/views.ts, kernel openAsks): a waiting clarify round is on its step's latest execution,
    // never in openAsks (T18 acceptance: the CLI read openAsks and could not answer any clarify round).
    openAsks: [], steps: [{ stepKey: "brief", latest: { seq: 1, state: "needs-person", ask: { kind: "clarify-round", roundNo: 2 } } }] } },
  "GET flows/settings": { status: 200, body: { locks: ["effects.cost"] } },
  // The fake ledger: the `@flows` scope is always 0, the global layer is orchestration's 4.
  ...Object.fromEntries(["flows", "flows/messages", "flows/plan", "flows/rerun", "flows/answer", "flows/effect", "flows/pool", "flows/plan-step"].map((path) => [`POST ${path}`, accept(() => 0)])),
  "POST operator/flows/locks": accept(() => 4),
  "POST operator/flows/settings": accept(() => 4),
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
  // Gaps spec §13 (plan Task 9): feedback anchors (each --quote one anchor; --heading and --paragraph one together), a
  // replacement picking a hit, "use my words as they are"; a feedback round's consensus; plan steps; marks; params.
  [["flow", "feedback", "fr-0a", "--quote", "Tea slows you", "--quote", "warm cup", "--heading", "Why", "--paragraph", "2", "--text", "too slow"], "flows/messages", 0,
    { runId: RUN, kind: "feedback", target: { kind: "run" }, body: { text: "too slow", anchors: [{ quote: "Tea slows you" }, { quote: "warm cup" }, { heading: "Why", paragraph: 2 }] } }],
  [["flow", "feedback", "fr-0a", "--paragraph", "3", "--text", "cut it"], "flows/messages", 0, { runId: RUN, kind: "feedback", target: { kind: "run" }, body: { text: "cut it", anchors: [{ paragraph: 3 }] } }],
  [["flow", "feedback", "fr-0a", "--replaces", "4", "--hit", "2", "--text", "that one"], "flows/messages", 0, { runId: RUN, kind: "feedback", target: { kind: "run" }, body: { text: "that one", replaces: 4, hit: 2 } }],
  [["flow", "feedback", "fr-0a", "--step", "voice", "--as-is", "--text", "warmer"], "flows/messages", 0, { runId: RUN, kind: "feedback", target: { kind: "step", stepKey: "voice" }, body: { text: "warmer", asIs: true } }],
  [["flow", "answer", "fr-0a", "--feedback", "5", "--consensus"], "flows/answer", 0, { runId: RUN, feedback: 5, consensus: true }],
  [["flow", "include", "fr-0a", "--step", "cover"], "flows/plan-step", 0, { runId: RUN, planNo: 3, stepKey: "cover", choice: "run" }],
  [["flow", "accept", "fr-0a", "--step", "cover", "--plan", "4"], "flows/plan-step", 0, { runId: RUN, planNo: 4, stepKey: "cover", choice: "accept-unchanged" }],
  [["flow", "skip", "fr-0a", "--step", "cover"], "flows/messages", 0, { runId: RUN, kind: "command", target: { kind: "step", stepKey: "cover" }, body: { command: "skip" } }],
  [["flow", "defer", "fr-0a", "--step", "cover"], "flows/messages", 0, { runId: RUN, kind: "command", target: { kind: "step", stepKey: "cover" }, body: { command: "defer" } }],
  [["flow", "defer", "fr-0a", "--step", "cover", "--effects", "to-draft-box=proceed"], "flows/messages", 0,
    { runId: RUN, kind: "command", target: { kind: "step", stepKey: "cover" }, body: { command: "defer", effects: { "to-draft-box": "proceed" } } }],
  [["flow", "fill", "fr-0a", "--step", "cover"], "flows/messages", 0, { runId: RUN, kind: "command", target: { kind: "step", stepKey: "cover" }, body: { command: "fill" } }],
  [["flow", "params", "fr-0a", "--set", "coverImage=covers/a.png", "--set", "illustrations=false"], "flows/messages", 0,
    { runId: RUN, kind: "command", target: { kind: "run" }, body: { command: "params", set: { coverImage: "covers/a.png", illustrations: false } } }],
  [["flow", "settings", "set", "rerunAskTimeoutSeconds", "600", "--global"], "operator/flows/settings", 4, { set: { rerunAskTimeoutSeconds: 600 }, clear: [] }],
  [["flow", "settings", "set", "paramDefaults.wechat-article.coverImage", "/covers/c.png", "--global"], "operator/flows/settings", 4,
    { set: { paramDefaults: { "wechat-article": { coverImage: "/covers/c.png" } } }, clear: [] }],
  [["flow", "settings", "clear", "paramDefaults.wechat-article.coverImage", "--global"], "operator/flows/settings", 4, { set: {}, clear: ["paramDefaults.wechat-article.coverImage"] }],
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

  it.each([
    [["flow", "defer", "fr-0a", "--step", "cover", "--effects", "to-draft-box=later"], "--effects wants <step>=proceed|wait"],
    [["flow", "feedback", "fr-0a", "--hit", "2", "--text", "x"], "--hit needs --replaces"],
    [["flow", "settings", "set", "rerunAskTimeoutSeconds", "soon", "--global"], "rerunAskTimeoutSeconds wants a positive integer"],
    [["flow", "settings", "set", "paramDefaults.wechat-article", "x", "--global"], "paramDefaults.<template>.<param>"],
    [["flow", "answer", "fr-0a", "--consensus"], "give the waiting step"],
  ])("orca %j is refused before anything is sent", async (argv, message) => {
    const w = await world({}, READS);
    const out = await cli([...argv, "--json"], w.dir);
    expect(out.code).not.toBe(0);
    expect(out.stdout + out.stderr).toContain(message);
    expect(w.posts()).toHaveLength(0);
  });

  it("feedback --attach uploads each file to the run's attachment route first and sends the ids it answered", async () => {
    const w = await world({}, { ...READS, [`POST flows/${RUN}/attachments`]: (_request, nth) => ({ status: 200, body: { schema: "orca-flow-attachment-v1", id: `${String(nth).repeat(64)}.png` } }) });
    writeFileSync(join(w.dir, "shot.png"), PNG);
    writeFileSync(join(w.dir, "second.png"), PNG);
    const out = await cli(["flow", "feedback", "fr-0a", "--attach", join(w.dir, "shot.png"), "--attach", join(w.dir, "second.png"), "--text", "this bit", "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    const uploads = w.requests.filter((r) => r.path === `flows/${RUN}/attachments`);
    expect(uploads.map((r) => [r.method, r.headers["content-type"], r.headers["content-length"]])).toEqual([["POST", "application/octet-stream", String(PNG.length)], ["POST", "application/octet-stream", String(PNG.length)]]);
    const posts = w.requests.filter((r) => r.method === "POST" && r.path === "flows/messages").map((r) => JSON.parse(r.text) as { payload: unknown });
    expect(posts.map((p) => p.payload)).toEqual([{ runId: RUN, kind: "feedback", target: { kind: "run" }, body: { text: "this bit", attachments: [`${"0".repeat(64)}.png`, `${"1".repeat(64)}.png`] } }]);
  });

  it("an attachment the panel refuses stops the command before the message is sent", async () => {
    const w = await world({}, { ...READS, [`POST flows/${RUN}/attachments`]: { status: 400, body: { error: { code: "flow-attachment-invalid", message: "not an image", retryable: false } } } });
    writeFileSync(join(w.dir, "notes.txt"), "text");
    const out = await cli(["flow", "feedback", "fr-0a", "--attach", join(w.dir, "notes.txt"), "--text", "x", "--json"], w.dir);
    expect(out.code).not.toBe(0);
    expect(out.stdout).toContain("flow-attachment-invalid");
    expect(w.requests.filter((r) => r.path === "flows/messages")).toHaveLength(0);
  });

  it("answer --feedback --file answers the intake's waiting round by its number; revise --file edits a round", async () => {
    const w = await world({}, READS);
    writeFileSync(join(w.dir, "answers.json"), JSON.stringify({ answers: [{ id: "R1.Q1", kind: "text", text: "The intro" }] }));
    const revision = { answers: [{ id: "R1.Q1", kind: "recommended" }], glossaryDecisions: [], adrDecisions: [], reason: "changed my mind" };
    writeFileSync(join(w.dir, "revise.json"), JSON.stringify(revision));
    expect((await cli(["flow", "answer", "fr-0a", "--feedback", "5", "--file", join(w.dir, "answers.json"), "--json"], w.dir)).code).toBe(0);
    expect((await cli(["flow", "revise", "fr-0a", "--step", "brief", "--round", "1", "--file", join(w.dir, "revise.json"), "--json"], w.dir)).code).toBe(0);
    expect(w.posts().map((p) => [p.path, p.payload])).toEqual([
      ["flows/answer", { runId: RUN, feedback: 5, clarify: { roundNo: 1, answers: [{ id: "R1.Q1", kind: "text", text: "The intro" }], glossaryDecisions: [], adrDecisions: [] } }],
      ["flows/messages", { runId: RUN, kind: "edit", target: { kind: "round", stepKey: "brief", roundNo: 1 }, body: revision }],
    ]);
    const missing = await cli(["flow", "answer", "fr-0a", "--feedback", "9", "--file", join(w.dir, "answers.json"), "--json"], w.dir);
    expect(missing.code).not.toBe(0);
    expect(missing.stdout + missing.stderr).toContain("feedback 9 has no clarify round waiting");
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
