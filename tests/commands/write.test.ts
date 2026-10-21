// CLI v2 plan Task 4 (spec §4 "arguments instead of payloads", §6.2, §14 R1, R2): the CLI fills every pin from a read made
// in the same invocation, sends the revision it read unless --if-revision says otherwise, and on an uncertain outcome its
// --json envelope carries the exact request it sent.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, useFakePanels } from "./fixtures/fakePanel.js";
import { H, world } from "./fixtures/world.js";

useFakePanels();

const loopFile = (() => {
  const dir = mkdtempSync(join(tmpdir(), "loop-"));
  const file = join(dir, "loop.json");
  writeFileSync(file, JSON.stringify({ plan: "standard", inputs: { goal: "g", successCondition: "s", targetPaths: ["src"], checks: ["npm test"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null }, work: { tokens: 500, activeMs: 600, attempts: 3 } }));
  return file;
})();
const PROFILES = { estimator: "est-1", worker: "est-1", handoff: "est-1", goalReview: "est-1" };
const HASHES = { estimator: H.est, worker: H.est, handoff: H.est, goalReview: H.est };
const CONFIRM = { planHash: H.plan, proposalVersion: 3, budgetMode: "soft", profileIds: PROFILES, profileHashes: HASHES, contextPolicy: { handoffAtContextTokens: null }, selectionsHash: H.sel };

/** argv → the one POST it must make: route, expectedRevision, payload (spec §4 table, plan "Control verbs → commands"). */
const MAPPINGS: Array<[string[], string, number, unknown]> = [
  [["group", "start", "g-alpha"], "groups/g-alpha/start", 5, {}],
  [["group", "pause", "g-al"], "groups/g-alpha/pause-dispatch", 5, {}],
  [["group", "resume", "g-alpha"], "groups/g-alpha/resume-dispatch", 5, {}],
  [["group", "stop-handoff", "g-alpha"], "groups/g-alpha/handoff-stop", 5, {}],
  [["group", "stop-handoff", "g-alpha", "--deadline", "2026-10-22T10:00:00.000Z"], "groups/g-alpha/handoff-stop", 5, { handoffDeadlineAt: "2026-10-22T10:00:00.000Z" }],
  [["group", "resume-handoff", "g-alpha"], "groups/g-alpha/resume-from-handoff", 5, { selections: [] }],
  [["group", "resume-handoff", "g-alpha", "--continue", "t1"], "groups/g-alpha/resume-from-handoff", 5, { selections: [{ taskId: "t1", predecessorRunId: "run-1", checkpointId: "cp-1" }] }],
  [["group", "archive", "g-alpha"], "groups/g-alpha/archive", 5, {}],
  [["group", "unarchive", "g-alpha"], "groups/g-alpha/unarchive", 5, {}],
  [["group", "estimate", "g-alpha"], "groups/g-alpha/estimates", 5, { proposalVersion: 3, estimatorProfileId: "est-1", estimatorProfileHash: H.est, estimateMode: "soft" }],
  [["group", "confirm", "g-alpha"], "groups/g-alpha/confirm", 5, CONFIRM],
  [["group", "confirm", "g-alpha", "--hold"], "groups/g-alpha/confirm", 5, { ...CONFIRM, hold: true }],
  [["group", "confirm", "g-alpha", "--worker-profile", "work-1", "--handoff-at-context-tokens", "90000"], "groups/g-alpha/confirm", 5,
    { ...CONFIRM, profileIds: { ...PROFILES, worker: "work-1" }, profileHashes: { ...HASHES, worker: H.work }, contextPolicy: { handoffAtContextTokens: 90000 } }],
  [["group", "set-limit", "g-alpha", "--limit", "{\"tokens\":9,\"activeMs\":1,\"attempts\":1,\"sessions\":1}"], "groups/g-alpha/set-limit", 5, { limit: { tokens: 9, activeMs: 1, attempts: 1, sessions: 1 } }],
  [["group", "set-integration", "g-alpha", "--delivery", "keep"], "groups/g-alpha/integration", 5, { integration: { delivery: "keep" } }],
  [["group", "set-integration", "g-alpha", "--delivery", "local", "--trigger", "group", "--method", "merge", "--target", "main"], "groups/g-alpha/integration", 5,
    { integration: { delivery: "local", trigger: "group", method: "merge", target: "main" } }],
  [["group", "retry-integration", "g-alpha"], "groups/g-alpha/integration/retry", 5, {}],
  [["group", "resolve-integration", "g-alpha"], "groups/g-alpha/integration/resolve", 5, {}],
  [["group", "depend", "g-alpha", "--on", "g-beta"], "groups/g-alpha/dependencies/add", 5, { dependsOn: "g-beta" }],
  [["group", "undepend", "g-alpha", "--on", "g-be"], "groups/g-alpha/dependencies/remove", 5, { dependsOn: "g-beta" }],
  [["group", "import", "plan-a", "--group", "g-new"], "groups/import-plan", 0, { groupId: "g-new", repoId: "repo-1", planId: "plan-a" }],
  [["requirement", "open", "--idea", "build a thing", "--group", "g-new"], "requirements", 0, { groupId: "g-new", repoId: "repo-1", idea: "build a thing" }],
  [["requirement", "answer", "g-alpha", "--answer", "R2.Q1", "--answer", "R2.Q2=my answer", "--glossary", "G1=accept", "--adr", "A1=reject"], "groups/g-alpha/requirement/answer", 5,
    { roundNo: 2, answers: [{ id: "R2.Q1", kind: "recommended" }, { id: "R2.Q2", kind: "text", text: "my answer" }], glossaryDecisions: [{ id: "G1", accept: true }], adrDecisions: [{ id: "A1", accept: false }] }],
  [["requirement", "consensus", "g-alpha"], "groups/g-alpha/requirement/consensus", 5, { roundNo: 2 }],
  [["requirement", "continue", "g-alpha"], "groups/g-alpha/requirement/clarify-more", 5, { roundNo: 2 }],
  [["requirement", "feedback", "g-alpha", "--text", "split it"], "groups/g-alpha/requirement/feedback", 5, { draftNo: 1, feedback: "split it" }],
  [["requirement", "accept", "g-alpha"], "groups/g-alpha/requirement/accept", 5, { draftNo: 1, draftHash: H.draft }],
  [["requirement", "classify", "g-alpha", "--scope", "medium", "--clarity", "fair"], "groups/g-alpha/requirement/classify", 5, { scope: "medium", clarity: "fair" }],
  [["task", "retry", "g-alpha", "t1"], "groups/g-alpha/retry-task", 5, { taskId: "t1", runId: "run-1" }],
  [["task", "continue", "g-alpha", "t1"], "groups/g-alpha/tasks/t1/continue", 5, { predecessorRunId: "run-1", checkpointId: "cp-1" }],
  [["task", "set-loop", "g-alpha", "t1", "--file", loopFile], "groups/g-alpha/tasks/t1/loop", 5,
    { baseLoopVersion: 4, plan: "standard", inputs: { goal: "g", successCondition: "s", targetPaths: ["src"], checks: ["npm test"], nonGoals: [], relevantDocs: [], protectedPaths: [], maxFilesTouched: null }, work: { tokens: 500, activeMs: 600, attempts: 3 } }],
  [["task", "set-labels", "g-alpha", "t1", "--label", "area:cli", "--label", "kind:bug"], "groups/g-alpha/tasks/t1/labels", 5, { labels: ["area:cli", "kind:bug"], baseLabelsVersion: 2 }],
  [["task", "set-labels", "g-alpha", "t1", "--clear"], "groups/g-alpha/tasks/t1/labels", 5, { labels: null, baseLabelsVersion: 2 }],
  [["task", "verify-saved-result", "g-alpha", "t1"], "groups/g-alpha/tasks/t1/verify-saved-result", 5, { sourceRunId: "run-0", sourceAttempt: 1, capsuleHash: H.capsule }],
  [["task", "settle-usage", "g-alpha", "t1", "--acknowledge", "charge-remaining-grant"], "groups/g-alpha/settle-unknown-usage", 5,
    { taskId: "t1", runId: "run-1", generation: 3, acknowledge: "charge-remaining-grant" }],
];

describe("requirement, group and task commands: route and payload (spec §4)", () => {
  it.each(MAPPINGS)("orca %j sends one POST %s at revision %i", async (argv, path, revision, payload) => {
    const w = await world();
    const out = await cli([...argv, "--json"], w.dir);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    const posts = w.posts();
    expect(posts).toHaveLength(1);
    expect({ path: posts[0]!.path, expectedRevision: posts[0]!.expectedRevision, payload: posts[0]!.payload }).toEqual({ path, expectedRevision: revision, payload });
    expect(posts[0]!.commandId).toMatch(/^cli-[0-9a-f-]{36}$/);
    expect(out.json()).toMatchObject({ status: 200, commandId: posts[0]!.commandId });
  });
});

describe("the revision (spec §6.2)", () => {
  it("group start sends the revision it just read", async () => {
    const w = await world({ revision: 11 });
    expect((await cli(["group", "start", "g-alpha"], w.dir)).code).toBe(0);
    expect(w.posts()[0]!.expectedRevision).toBe(11);
  });

  it("--if-revision 3 against revision 5: sent as 3, the panel answers revision-conflict, exit 2, the body names currentRevision", async () => {
    const w = await world({ revision: 5 });
    const out = await cli(["group", "start", "g-alpha", "--if-revision", "3", "--json"], w.dir);
    expect(w.posts()[0]!.expectedRevision).toBe(3);
    expect(out.code).toBe(2);
    expect(out.json().body).toMatchObject({ error: { code: "revision-conflict" }, currentRevision: 5 });
  });

  it("--command-id is used for the new request", async () => {
    const w = await world();
    await cli(["group", "start", "g-alpha", "--command-id", "mine-1"], w.dir);
    expect(w.posts()[0]!.commandId).toBe("mine-1");
  });
});

describe("pins come from a read made in this invocation (spec §4)", () => {
  it("a change between two invocations reaches the second one's pins (no cache across invocations)", async () => {
    const w = await world();
    await cli(["task", "retry", "g-alpha", "t1"], w.dir);
    await cli(["task", "set-loop", "g-alpha", "t1", "--file", loopFile], w.dir);
    w.state.view = (await import("./fixtures/world.js")).groupView({ revision: 6, currentRunId: "run-2", loopVersion: 5 });
    await cli(["task", "retry", "g-alpha", "t1"], w.dir);
    await cli(["task", "set-loop", "g-alpha", "t1", "--file", loopFile], w.dir);
    const posts = w.posts();
    expect(posts.map((p) => [p.expectedRevision, (p.payload as { runId?: string }).runId ?? (p.payload as { baseLoopVersion: number }).baseLoopVersion]))
      .toEqual([[5, "run-1"], [5, 4], [6, "run-2"], [6, 5]]);
  });
});

describe("an uncertain outcome (spec §14 R1)", () => {
  it("a dropped connection after send: retried once with the same bytes, then the envelope carries the exact request", async () => {
    const w = await world({}, { "POST groups/g-alpha/pause-dispatch": "drop" });
    const out = await cli(["group", "pause", "g-alpha", "--json"], w.dir);
    expect(out.code).toBe(1);
    const sent = w.requests.filter((r) => r.method === "POST");
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).toBe(sent[0]!.text);
    const envelope = out.json();
    expect(envelope.body.error).toMatchObject({ code: "control-socket-error", retryable: true });
    expect(envelope.request).toEqual({ route: "groups/g-alpha/pause-dispatch", expectedRevision: 5, payload: {}, commandId: envelope.commandId });
    const { route: _route, ...bytes } = envelope.request;
    expect(JSON.stringify({ commandId: bytes.commandId, expectedRevision: bytes.expectedRevision, payload: bytes.payload })).toBe(sent[0]!.text);
  });

  it("a definite answer carries no request", async () => {
    const w = await world();
    expect((await cli(["group", "start", "g-alpha", "--json"], w.dir)).json().request).toBeUndefined();
  });
});

describe("refusals made here", () => {
  it("a confirm with no resolvable selections is refused before sending", async () => {
    const w = await world({}, { "GET groups/g-alpha/agent-preview": { status: 200, body: { groupId: "g-alpha", proposalVersion: 3, selectionsHash: null } } });
    const out = await cli(["group", "confirm", "g-alpha", "--json"], w.dir);
    expect([out.code, out.json().body.error.code]).toEqual([1, "agent-selection-unresolved"]);
    expect(w.posts()).toEqual([]);
  });

  it("a task with no current run cannot be retried by the CLI's read", async () => {
    const w = await world();
    const out = await cli(["task", "retry", "g-alpha", "t2", "--json"], w.dir);
    expect([out.code, out.json().body.error.code]).toEqual([1, "task-has-no-run"]);
    expect(w.posts()).toEqual([]);
  });
});
