import { describe, expect, it } from "vitest";
import { readDraft, readDrafts, readRequirementGroup, readRounds } from "../../src/control/requirementRecords.js";
import { REQUIREMENT_LIMIT_DEFAULT } from "../../src/control/requirementSchemas.js";
import { readRequirementView } from "../../src/panel/controlViews.js";
import { requirementHarness } from "./fixtures/requirementHarness.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";

// Tester #379 (spec 2026-11-19 resplit-as-new-group; human 「同意」, session 3ba26002): an accepted split found wrong before
// confirm cannot be edited (accept froze the document, queued its export, imported the tasks and queued their estimate),
// and a fresh requirement would throw the paid clarification away. `requirement-resplit` copies the clarified requirement
// into a new clarifying group whose next step is a split call carrying the person's feedback, and archives the old group,
// in one transaction. A refusal changes nothing.
const PARALLEL = { ...VALID_SPLIT, tasks: VALID_SPLIT.tasks.map((task) => ({ ...task, dependsOn: [] })), notes: "Two tasks, together." };
const FEEDBACK = "exporter and images do not import each other; run them in parallel";
type Harness = Awaited<ReturnType<typeof requirementHarness>>;

const bodyOf = (x: Harness, id: string) => {
  const row = x.store.db.prepare("SELECT body FROM groups WHERE id=?").get(id);
  return row === undefined ? undefined : JSON.parse(String(row.body)) as Record<string, unknown>;
};
const setBody = (x: Harness, id: string, change: (body: Record<string, unknown>) => void) => {
  const body = bodyOf(x, id)!;
  change(body);
  x.store.db.prepare("UPDATE groups SET body=? WHERE id=?").run(JSON.stringify(body), id);
};
const resplit = (x: Harness, newGroupId = "r2", feedback = FEEDBACK) =>
  x.service.requirementResplit(x.command("requirement-resplit", { newGroupId, feedback }));

/** Draft 1 sent back with feedback, draft 2 accepted: the old group has a draft history to copy. */
async function accepted(extra: Array<{ purpose: "split"; output: unknown }> = []) {
  const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }, { purpose: "split", output: VALID_SPLIT }, ...extra], startAt: "split" });
  await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
  expect(x.service.requirementDraftFeedback(x.command("requirement-draft-feedback", { draftNo: 1, feedback: "keep it at two tasks" }))).not.toHaveProperty("error");
  await x.until(() => readDraft(x.store, "r", 2).state === "awaiting-review");
  expect(await x.service.acceptRequirementDraft(x.command("requirement-draft-accept", { draftNo: 2, draftHash: readDraft(x.store, "r", 2).draftHash }))).not.toHaveProperty("error");
  return x;
}

describe("requirement-resplit copies the clarified requirement into a new group and archives the old one (#379)", () => {
  it("copies rounds, drafts and the requirement, asks for the next draft with the feedback, archives and links both ways", async () => {
    const x = await accepted([{ purpose: "split", output: PARALLEL }]);
    try {
      const old = readRequirementGroup(x.store, "r").requirement;
      const oldRounds = readRounds(x.store, "r"), oldDrafts = readDrafts(x.store, "r");
      const answer = await resplit(x);
      expect(answer).toMatchObject({ result: { kind: "requirement-resplit", groupId: "r", newGroupId: "r2", draftNo: 3, wakeId: expect.any(String) } });
      const fresh = readRequirementGroup(x.store, "r2");
      expect(fresh.status).toBe("clarifying");
      // mutation: drop the requirement copy (keep insertClarifyingGroup's defaults) -> consensus/slug null, red
      expect(fresh.requirement).toEqual({
        ...old, requirementId: fresh.requirement.requirementId, createdOn: fresh.requirement.createdOn,
        acceptedDraftNo: null, document: null, export: { state: "not-due", path: null, commit: null, parent: null, detail: null },
        resplitOf: { groupId: "r", draftNo: 2 },
      });
      expect(fresh.requirement.requirementId).not.toBe(old.requirementId);
      // mutation: copy the old group's limit -> the plan group's raised limit, red
      expect(fresh.limit).toEqual(REQUIREMENT_LIMIT_DEFAULT);
      expect(fresh.used).toEqual({ tokens: 0, activeMs: 0, attempts: 0, sessions: 0 });
      // mutation: drop the rounds copy -> no rounds, red
      expect(readRounds(x.store, "r2")).toEqual(oldRounds);
      // mutation: copy the accepted draft as it is -> state accepted, feedback null, red
      expect(readDrafts(x.store, "r2").slice(0, 2)).toEqual([oldDrafts[0], { ...oldDrafts[1], state: "rejected", feedback: FEEDBACK }]);
      expect(readDraft(x.store, "r2", 3)).toMatchObject({ state: "drafting", autoRetry: 0, feedback: null });
      // The old group: archived as archive-group archives, its records kept, linked to the new one.
      const oldBody = bodyOf(x, "r")!;
      // mutation: drop the archive mark -> archived absent, red
      expect(oldBody.archived).toEqual({ at: expect.any(Number), actor: "human" });
      expect(x.store.db.prepare("SELECT count(*) AS n FROM activity WHERE group_id='r' AND kind='archived'").get()).toEqual({ n: 1 });
      // mutation: drop the resplitAs link -> undefined, red
      expect(readRequirementGroup(x.store, "r").requirement.resplitAs).toEqual({ groupId: "r2", at: expect.any(String) });
      expect(readDrafts(x.store, "r")).toEqual(oldDrafts);
      expect(readRequirementView(x.store, "e", "r").requirement).toMatchObject({ resplitAs: { groupId: "r2" } });
      expect(readRequirementView(x.store, "e", "r2").requirement).toMatchObject({ resplitOf: { groupId: "r", draftNo: 2 } });
      // mutation: drop the new group's command activity row -> draftingSince null, red
      expect(readRequirementView(x.store, "e", "r2").draftingSince).toEqual(expect.any(Number));
      // The new split call carries the accepted draft's tasks and the feedback, and its draft is accepted as any other.
      await x.until(() => readDraft(x.store, "r2", 3).state === "awaiting-review");
      const prompt = (x.fake.calls.accept.find((envelope) => envelope.claim.groupId === "r2") as { work: { prompt: string } }).work.prompt;
      expect(prompt).toContain(`"draftNo":2`);
      expect(prompt).toContain(FEEDBACK);
      expect(readDraft(x.store, "r2", 3).output).toEqual(PARALLEL);
      // The harness's command() reads r's revision; r2 keeps its own.
      const revision = Number(x.store.db.prepare("SELECT revision FROM groups WHERE id='r2'").get()!.revision);
      const next = await x.service.acceptRequirementDraft({ schema: "orca-raw-command-v1", commandId: "accept-r2", actorId: "human", expectedRevision: revision,
        verb: "requirement-draft-accept", target: { kind: "group", groupId: "r2" }, payload: { draftNo: 3, draftHash: readDraft(x.store, "r2", 3).draftHash } } as never);
      expect(next).toMatchObject({ result: { kind: "requirement-draft-accepted", draftNo: 3 } });
    } finally { await x.dispose(); }
  });

  it("carries a folder group's frozen folder and only the estimator override", async () => {
    const x = await accepted();
    try {
      const dirWorkspace = { dir: "/folders/notes", vaultId: "a".repeat(64) };
      setBody(x, "r", (body) => { body.dirWorkspace = dirWorkspace; body.agentOverrides = { estimator: { agent: "codex" }, worker: { agent: "codex" } }; });
      expect(await resplit(x)).toMatchObject({ result: { kind: "requirement-resplit" } });
      const fresh = bodyOf(x, "r2")!;
      // mutation: drop the dirWorkspace copy -> absent, red
      expect(fresh.dirWorkspace).toEqual(dirWorkspace);
      // mutation: copy every override -> worker present, red
      expect(fresh.agentOverrides).toEqual({ estimator: { agent: "codex" } });
    } finally { await x.dispose(); }
  });

  it("carries a multi-directory group's frozen members, its landing back to null", async () => {
    const x = await accepted();
    try {
      const dirs = [{ key: "posts", repoId: "dir-posts", kind: "dir", dirWorkspace: { dir: "/folders/posts", vaultId: "b".repeat(64) } }, { key: "alpha", repoId: "alpha", kind: "repo" }];
      setBody(x, "r", (body) => { body.multiDir = { project: "repo", dirs, landing: { lastLanded: { alpha: "c".repeat(40) } } }; });
      expect(await resplit(x)).toMatchObject({ result: { kind: "requirement-resplit" } });
      // mutation: copy the landing -> the old landing, red
      expect(bodyOf(x, "r2")!.multiDir).toEqual({ project: "repo", dirs, landing: null });
    } finally { await x.dispose(); }
  });
});

describe("requirement-resplit refuses, changing nothing (#379)", () => {
  const unchanged = (x: Harness, before: { drafts: unknown; body: unknown }) => {
    expect(bodyOf(x, "r2")).toBeUndefined();
    expect(readDrafts(x.store, "r")).toEqual(before.drafts);
    expect(bodyOf(x, "r")).toEqual(before.body);
  };

  it("a split not accepted yet: requirement-not-accepted", async () => {
    const x = await requirementHarness({ answers: [{ purpose: "split", output: VALID_SPLIT }], startAt: "split" });
    try {
      await x.until(() => readDraft(x.store, "r", 1).state === "awaiting-review");
      const before = { drafts: readDrafts(x.store, "r"), body: bodyOf(x, "r") };
      // mutation: drop the acceptedDraftNo check -> a resplit of a clarifying group, red
      expect(await resplit(x)).toMatchObject({ error: { code: "requirement-not-accepted", message: "requirement-not-accepted:clarifying" } });
      unchanged(x, before);
    } finally { await x.dispose(); }
  });

  it("a group with no requirement (an imported plan): requirement-not-accepted, not a bare group-state-invalid", async () => {
    const x = await accepted();
    try {
      // Fixture shortcut: an accepted group without its requirement block is what a plan import leaves (no requirement).
      setBody(x, "r", (body) => { delete body.requirement; });
      const before = { drafts: readDrafts(x.store, "r"), body: bodyOf(x, "r") };
      // mutation: drop the hasRequirementBlock check -> group-state-invalid from readRequirementGroup, red
      expect(await resplit(x)).toMatchObject({ error: { code: "requirement-not-accepted", message: "requirement-not-accepted:no-requirement" } });
      unchanged(x, before);
    } finally { await x.dispose(); }
  });

  it("a confirmed group: proposal-confirmed, naming its status", async () => {
    const x = await accepted();
    try {
      // Fixture shortcut: confirm sets the group status to ready (webService.ts confirm); only that status is read here.
      setBody(x, "r", (body) => { body.status = "ready"; });
      const before = { drafts: readDrafts(x.store, "r"), body: bodyOf(x, "r") };
      // mutation: drop the status check -> resplit succeeds, red
      expect(await resplit(x)).toMatchObject({ error: { code: "proposal-confirmed", message: "proposal-confirmed:resplit:ready" } });
      unchanged(x, before);
    } finally { await x.dispose(); }
  });

  it("an old group archive refuses (an estimate running): archive's own code", async () => {
    const x = await accepted();
    try {
      expect(x.store.db.prepare("UPDATE estimates SET state='running' WHERE group_id='r'").run().changes).toBe(1);
      const before = { drafts: readDrafts(x.store, "r"), body: bodyOf(x, "r") };
      // mutation: drop the archive refusals -> resplit succeeds, red
      expect(await resplit(x)).toMatchObject({ error: { code: "archive-call-in-flight", message: "archive-call-in-flight:estimate" } });
      unchanged(x, before);
    } finally { await x.dispose(); }
  });

  it("a new group id already taken: group-already-exists", async () => {
    const x = await accepted();
    try {
      const before = { drafts: readDrafts(x.store, "r"), body: bodyOf(x, "r") };
      // mutation: drop the exists check -> the insert's constraint error instead, red
      expect(await resplit(x, "r")).toMatchObject({ error: { code: "group-already-exists" } });
      expect(readDrafts(x.store, "r")).toEqual(before.drafts);
      expect(bodyOf(x, "r")).toEqual(before.body);
    } finally { await x.dispose(); }
  });
});
