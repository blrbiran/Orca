import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { buildBudgetEstimateRequest, persistEstimateArtifacts } from "../../src/control/estimator.js";
import { BUDGET_ESTIMATE_JSON_SCHEMA, ESTIMATE_INSTRUCTIONS, buildEstimatePrompt, estimateResponseSchema, estimateTaskIds } from "../../src/control/estimatePrompt.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { resolveProfile } from "../../src/control/profiles.js";
import { singleCallHandler, type SingleCallPrepareDeps } from "../../src/control/singleCallPurposes.js";
import { estimateExecutionContractSchema } from "../../src/control/webProtocol.js";
import { profileSnapshot, webFixture } from "./fixtures/web.js";
import { fixtureResolutionFor } from "./fixtures/agents.js";

// Estimate-usable-answer spec §4.1 and §4.3: instruction v2 keys the answer by taskId, the response schema is built per
// request, the prompt tail lists the ids, and a retry appends the problems. v1 stays byte-identical.
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
// sha256 of buildEstimatePrompt("1", "{\"x\":1}") computed from the code as it stood before v2 (commit 0213d16a).
const V1_PROMPT_SHA256 = "86713fb5faaae5379f60e94f21b6d146cf57c2c8dd7a95d8f2ce28b7578417f0";

const ALLOWED = new Set(["type", "properties", "required", "additionalProperties", "items", "enum"]);
// Every keyword position in the schema (the keys of a "properties" object are names, not keywords).
function keywords(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) { for (const item of node) keywords(item, out); return out; }
  if (node === null || typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out.push(key);
    if (key === "properties") for (const child of Object.values(value as Record<string, unknown>)) keywords(child, out);
    else if (key !== "enum" && key !== "required") keywords(value, out);
  }
  return out;
}

const contract = (id: string) => ({ objective: { taskId: id, goal: "ship" } });
const planOf = (ids: string[]) => ({
  schema: "orca-control-plan-v1", repoId: "repo", planId: "plan", goal: "ship", successConditions: ["passes"],
  tasks: ids.map(id => ({ taskId: id, dependencyTaskIds: [], targetVersion: 1, originalContractHash: sha256Canonical(contract(id)), originalContractCanonicalJson: canonicalBytes(contract(id)).toString("utf8") })),
});
const observe = (version: string) => {
  const snapshot = profileSnapshot();
  snapshot.profile.estimatorPreflight = { ...snapshot.profile.estimatorPreflight!, instructionVersion: version };
  const profile = resolveProfile(snapshot);
  return { profile, observation: { profile, observed: snapshot.profile.capabilities, probeFailureCode: null, resolution: fixtureResolutionFor(snapshot.profile.capabilities, "v1") } };
};
const buildFor = (version: string, ids: string[]) => {
  const plan = planOf(ids);
  return buildBudgetEstimateRequest({ planHash: sha256Canonical(plan), planCanonicalJson: canonicalBytes(plan).toString("utf8"), ...observe(version), mode: "soft" });
};

describe("the v2 estimate prompt and schema", () => {
  it("keeps the v1 prompt and schema byte-identical", () => {
    expect(sha(buildEstimatePrompt("1", "{\"x\":1}"))).toBe(V1_PROMPT_SHA256);
    expect(estimateResponseSchema("1", ["a", "b"])).toBe(BUDGET_ESTIMATE_JSON_SCHEMA);
    // v1 ignores the task list: options never change its bytes.
    expect(buildEstimatePrompt("1", "{\"x\":1}", { taskIds: ["a"] })).toBe(buildEstimatePrompt("1", "{\"x\":1}"));
  });

  it("v2 ends with the task-list line and describes the keyed answer", () => {
    const prompt = buildEstimatePrompt("2", "{\"x\":1}", { taskIds: ["a", "b"] });
    expect(prompt.startsWith(`${ESTIMATE_INSTRUCTIONS["2"]}\n\n{"x":1}\n\n`)).toBe(true);
    expect(prompt.endsWith("This plan has 2 tasks: \"a\", \"b\". Answer each exactly once, as a key of \"tasks\".")).toBe(true);
    expect(ESTIMATE_INSTRUCTIONS["2"]).toContain("budget-estimate-answer-v2");
    expect(ESTIMATE_INSTRUCTIONS["2"]).not.toContain("planHash");
    expect(ESTIMATE_INSTRUCTIONS["2"]).not.toContain("sorted");
    expect(() => buildEstimatePrompt("2", "{}")).toThrow(expect.objectContaining({ detail: "estimate-task-ids-missing" }));
  });

  it("v2 schema keys tasks by id, requires each, adds none, and stays within the allowed keywords", () => {
    const schema = estimateResponseSchema("2", ["a", "b"]) as any;
    expect(schema.required).toEqual(["schema", "tasks", "goalReviewReserve", "groupRationale"]);
    expect(schema.properties.schema).toEqual({ type: "string", enum: ["budget-estimate-answer-v2"] });
    expect(schema.properties.planHash).toBeUndefined();
    expect(schema.properties.tasks).toMatchObject({ type: "object", required: ["a", "b"], additionalProperties: false });
    expect(Object.keys(schema.properties.tasks.properties)).toEqual(["a", "b"]);
    expect(Object.keys(schema.properties.tasks.properties.a.properties).sort()).toEqual(["assumptions", "complexity", "confidence", "handoff", "rationale", "work"]);
    expect(schema.properties.tasks.properties.a.properties.taskId).toBeUndefined();
    for (const word of keywords(schema)) expect(ALLOWED.has(word), word).toBe(true);
    // Ids that are object-prototype names stay own properties.
    const odd = estimateResponseSchema("2", ["constructor", "__proto__", "10"]) as any;
    expect(Object.keys(odd.properties.tasks.properties)).toEqual(expect.arrayContaining(["constructor", "__proto__", "10"]));
    expect(odd.properties.tasks.required).toEqual(["constructor", "__proto__", "10"]);
    expect(() => estimateResponseSchema("3", [])).toThrow(expect.objectContaining({ detail: "estimate-instruction-unknown:3" }));
  });

  it("retryProblems append the feedback paragraph in both versions, after the task line", () => {
    const tail = "Your previous answer was rejected for these problems:\ntask-missing:b\ntask-invalid:a:work\nAnswer again with one JSON object that fixes all of them.";
    const problems = ["task-missing:b", "task-invalid:a:work"];
    expect(buildEstimatePrompt("1", "{}", { taskIds: ["a", "b"], retryProblems: problems })).toBe(`${buildEstimatePrompt("1", "{}")}\n\n${tail}`);
    expect(buildEstimatePrompt("2", "{}", { taskIds: ["a", "b"], retryProblems: problems })).toBe(`${buildEstimatePrompt("2", "{}", { taskIds: ["a", "b"] })}\n\n${tail}`);
    expect(buildEstimatePrompt("2", "{}", { taskIds: ["a"], retryProblems: [] })).toBe(buildEstimatePrompt("2", "{}", { taskIds: ["a"] }));
  });

  it("adds the cut-off sentence when the problem is no-json-object, and only then", () => {
    const sentence = " Your answer may have been cut off: reply with the JSON object only, and keep each rationale to one sentence.";
    for (const version of ["1", "2"]) {
      const options = { taskIds: ["a"], retryProblems: ["no-json-object"] };
      expect(buildEstimatePrompt(version, "{}", options)).toBe(`${buildEstimatePrompt(version, "{}", { taskIds: ["a"] })}\n\nYour previous answer was rejected for these problems:\nno-json-object\nAnswer again with one JSON object that fixes all of them.${sentence}`);
      expect(buildEstimatePrompt(version, "{}", { taskIds: ["a"], retryProblems: ["task-missing:a"] })).not.toContain("cut off");
    }
  });

  it("reads the task ids from the request's plan, in plan order", () => {
    const result = buildFor("2", ["a", "m", "z"]);
    expect(estimateTaskIds(result.request!)).toEqual(["a", "m", "z"]);
  });

  it("counts the v2 tail in the preflight tokens", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `task-number-${i}`).sort();
    const v2 = buildFor("2", ids);
    const bytes = Buffer.byteLength(buildEstimatePrompt("2", canonicalBytes(v2.request).toString("utf8"), { taskIds: ids }));
    expect(v2.state).toBe("queued");
    expect(v2.inputTokens).toBe(Math.ceil(bytes * 2 / 3) + 17);
    const withoutTail = Buffer.byteLength(`${ESTIMATE_INSTRUCTIONS["2"]}\n\n${canonicalBytes(v2.request).toString("utf8")}`);
    expect(bytes - withoutTail).toBeGreaterThan(40 * 10);
    expect(v2.inputTokens!).toBeGreaterThan(Math.ceil(withoutTail * 2 / 3) + 17);
  });
});

describe("ESTIMATE.prepare under a v2 contract", () => {
  type Fixture = Awaited<ReturnType<typeof webFixture>>;
  let nextVersion = 2;
  async function prepareWith(h: Fixture, version: string, retryProblems?: string[]) {
    const plan = readArchivedPlan(h.store, "g");
    const observation = await h.deps.profileRouter.probe(h.frozen, { agent: "codex" });
    const built = buildBudgetEstimateRequest({ planHash: plan.planHash, planCanonicalJson: plan.canonicalJson, profile: h.frozen, observation, mode: "strict" });
    const contract = estimateExecutionContractSchema.parse({ ...built.contract, instructionVersion: version, ...(retryProblems ? { retryProblems } : {}) });
    const id = `estimate-v${version}-${nextVersion}`;
    const row = h.store.db.prepare("SELECT body FROM estimates WHERE group_id='g' AND id=?").get(h.estimateId)!;
    const record = { ...JSON.parse(String(row.body)), estimateId: id, estimateVersion: nextVersion };
    h.store.db.prepare("INSERT INTO estimates(group_id,id,estimate_version,state,body) VALUES ('g',?,?,?,?)").run(id, nextVersion++, record.state, canonicalBytes(record).toString("utf8"));
    persistEstimateArtifacts(h.store, "g", id, { ...built, contract, contractHash: sha256Canonical(contract) });
    const envelope = await singleCallHandler("estimate").prepare({ store: h.store } as unknown as SingleCallPrepareDeps, { runId: "r", groupId: "g", workItemId: "estimate", estimateId: id });
    return { envelope: envelope as { prompt: string; responseSchema: Record<string, unknown> }, record };
  }

  it("sends the v2 schema and the task tail; v1 keeps the fixed schema", async () => {
    const h = await webFixture(); try {
      const v1 = await prepareWith(h, "1");
      const ids = estimateTaskIds(v1.record.request);
      expect(v1.envelope.responseSchema).toBe(BUDGET_ESTIMATE_JSON_SCHEMA);
      expect(v1.envelope.prompt.includes("This plan has")).toBe(false);
      const v2 = await prepareWith(h, "2");
      expect((v2.envelope.responseSchema as any).properties.tasks.required).toEqual(ids);
      expect(v2.envelope.prompt.endsWith(`Answer each exactly once, as a key of "tasks".`)).toBe(true);
      expect(v2.envelope.prompt.includes(`This plan has ${ids.length} tasks: ${ids.map(id => JSON.stringify(id)).join(", ")}.`)).toBe(true);
    } finally { await h.dispose(); }
  });

  it("appends the contract's retryProblems after the tail", async () => {
    const h = await webFixture(); try {
      const { envelope } = await prepareWith(h, "2", ["task-missing:t1"]);
      expect(envelope.prompt.endsWith("Your previous answer was rejected for these problems:\ntask-missing:t1\nAnswer again with one JSON object that fixes all of them.")).toBe(true);
    } finally { await h.dispose(); }
  });
});
