import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalBytes, sha256Canonical } from "../../src/control/canonicalJson.js";
import { expandLoopTask, expandRecipe, loopPlanFileSchema, loopRecipeSchema, normalizeLoopSkills } from "../../src/control/loopPlans.js";
import { readArchivedPlan } from "../../src/control/queries.js";
import { schedulerControlPlanSourceOf } from "../../src/scheduler/planFile.js";
import { webFixture } from "./fixtures/web.js";

/**
 * Syncskill integration spec §10.4 (Task 3): a loop task may declare `skills`. The golden below was captured at
 * HEAD 847a7a6, BEFORE any skills code existed (script: expandLoopTask("a", "/repo", GOLDEN_INPUT, []), then
 * canonicalBytes/sha256Canonical of the recipe, of the plan entry and of { tasks: [entry] }). A plan without skills must
 * keep these bytes and hashes: absent skills is an omitted key, never `skills: undefined`.
 */
const GOLDEN_INPUT = { plan: "bugfix", goal: "fix login", successCondition: "the login test passes", targetPaths: ["a"], checks: ["npm test"] };
const golden = JSON.parse(readFileSync(new URL("./fixtures/loopPlanGolden.json", import.meta.url), "utf8")) as
  { contractHash: string; recipeCanonical: string; planEntryCanonical: string; planHash: string };

function expandGolden(extra: Record<string, unknown> = {}) {
  const e = expandLoopTask("a", "/repo", { ...GOLDEN_INPUT, ...extra } as never, []);
  if (!e.ok) throw new Error(`refused: ${e.reason}`);
  return e;
}

describe("a loop plan without skills keeps its bytes (golden captured before the change)", () => {
  it("keeps the recipe bytes, plan entry bytes, planHash and contract hash", () => {
    const e = expandGolden();
    const entry = { taskId: "a", dependencyTaskIds: [], targetVersion: 1, loop: e.recipe, originalContractHash: e.hash, originalContractCanonicalJson: e.canonicalJson };
    expect(e.hash).toBe(golden.contractHash);
    expect(canonicalBytes(e.recipe).toString("utf8")).toBe(golden.recipeCanonical);
    expect(canonicalBytes(entry).toString("utf8")).toBe(golden.planEntryCanonical);
    expect(sha256Canonical({ tasks: [entry] })).toBe(golden.planHash);
    expect(Object.keys(e.recipe)).not.toContain("skills");
  });
});

describe("declaring skills on a loop task", () => {
  it("archives names sorted and de-duplicated", () => {
    expect(expandGolden({ skills: { names: ["b", "a", "a"] } }).recipe.skills).toEqual({ names: ["a", "b"] });
  });

  it("archives a profile as declared", () => {
    expect(expandGolden({ skills: { profile: "web-dev_1" } }).recipe.skills).toEqual({ profile: "web-dev_1" });
  });

  it("never lets skills reach the ccloop contract: contract bytes and hash equal the no-skills expansion", () => {
    const plain = expandGolden();
    for (const skills of [{ names: ["b", "a"] }, { profile: "p" }]) {
      const withSkills = expandGolden({ skills });
      expect(withSkills.canonicalJson).toBe(plain.canonicalJson);
      expect(withSkills.hash).toBe(plain.hash);
      expect(withSkills.canonicalJson).not.toContain("skills");
    }
  });

  it("changes the recipe bytes (and so planHash) when skills are declared", () => {
    expect(canonicalBytes(expandGolden({ skills: { names: ["a"] } }).recipe).toString("utf8")).not.toBe(golden.recipeCanonical);
  });

  it.each([
    ["both keys", { profile: "p", names: ["a"] }],
    ["empty names", { names: [] }],
    ["a leading dot", { names: [".x"] }],
    ["a slash", { names: ["a/b"] }],
    ["a comma", { names: ["a,b"] }],
    ["leading whitespace", { names: [" a"] }],
    ["trailing whitespace", { names: ["a "] }],
    ["a profile with a space", { profile: "bad name" }],
    ["an empty profile", { profile: "" }],
  ])("refuses skills-shape for %s", (_label, skills) => {
    expect(expandLoopTask("a", "/repo", { ...GOLDEN_INPUT, skills } as never, [])).toEqual({ ok: false, reason: "skills-shape" });
  });

  it.each([
    ["both keys", { profile: "p", names: ["a"] }],
    ["empty names", { names: [] }],
    ["a profile with a space", { profile: "bad name" }],
    ["an unknown key", { names: ["a"], extra: 1 }],
  ])("the plan file schema itself rejects %s", (_label, skills) => {
    expect(loopPlanFileSchema.safeParse({ ...GOLDEN_INPUT, skills }).success).toBe(false);
  });

  // Human ruling 2026-10-03 (session 9d95e6c8): a wrong skills shape names what to fix as one `skills-shape:<detail>`
  // issue -- zod's union fallout told a person with both keys to drop `names` ("Unrecognized key(s) ... 'names'").
  it.each([
    ["both keys", { profile: "p", names: ["a"] }, "both-profile-and-names"],
    ["neither key", {}, "neither-profile-nor-names"],
    ["an unknown key", { names: ["a"], extra: 1 }, "unknown-key"],
    ["empty names", { names: [] }, "empty-names"],
    ["a non-string name", { names: [1] }, "names-not-strings"],
    ["a profile with a space", { profile: "bad name" }, "profile-name"],
    ["a string", "a", "not-an-object"],
  ])("the plan file schema names the shape it refuses: %s", (_label, skills, detail) => {
    const parsed = loopPlanFileSchema.safeParse({ ...GOLDEN_INPUT, skills });
    expect(parsed.success ? [] : parsed.error.issues.map(issue => [issue.path.join("."), issue.message])).toEqual([["skills", `skills-shape:${detail}`]]);
  });

  it("the plan file's import refusal carries that detail", () => {
    const plan = { targetRepo: "/repo", ccloopBin: "/bin/true", runsDir: "/runs", workBranch: "orca/work", policy: "local-merge", ledgerMode: "out-of-repo",
      goal: "ship", successConditions: ["passes"], tasks: [{ taskId: "a", dependsOn: [], loop: { ...GOLDEN_INPUT, skills: { profile: "p", names: ["a"] } } }] };
    expect(() => schedulerControlPlanSourceOf(plan, "/repo")).toThrow("control-plan-rejected:malformed:tasks.0.loop.skills: skills-shape:both-profile-and-names");
  });

  it("normalizeLoopSkills passes a valid shape and does not mutate its input", () => {
    const input = { names: ["b", "a"] };
    expect(normalizeLoopSkills(input)).toEqual({ names: ["a", "b"] });
    expect(input.names).toEqual(["b", "a"]);
  });
});

describe("the archived recipe carries skills", () => {
  it("re-parses a recipe with skills to its own bytes, and a recipe without skills gains no key", () => {
    const withSkills = expandGolden({ skills: { names: ["b", "a"] } }).recipe;
    expect(loopRecipeSchema.parse(withSkills)).toEqual(withSkills);
    expect(Object.keys(loopRecipeSchema.parse(expandGolden().recipe))).not.toContain("skills");
  });

  it("imports through the Web door: planHash covers the skills and the stored contract is the recipe's expansion", async () => {
    const h = await webFixture(undefined, [{ taskId: "a", loop: { ...GOLDEN_INPUT, skills: { names: ["b", "a", "a"] } } }]);
    try {
      const archived = readArchivedPlan(h.store, "g");
      const task = archived.plan.tasks[0]!;
      expect(task.loop!.skills).toEqual({ names: ["a", "b"] });
      expect(sha256Canonical(archived.plan)).toBe(archived.planHash);
      const again = expandRecipe("a", JSON.parse(task.originalContractCanonicalJson).context.repoPath, task.loop!);
      expect(again.ok && again.canonicalJson).toBe(task.originalContractCanonicalJson);
    } finally { await h.dispose(); }
  });
});
