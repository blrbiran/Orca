import { describe, expect, it } from "vitest";
import { integrationSchemeSchema } from "../../src/control/webProtocol.js";
import { splitOutputSchema } from "../../src/control/requirementSchemas.js";
import { buildSplitPrompt, SPLIT_INSTRUCTION_V6, SPLIT_JSON_SCHEMA, SPLIT_JSON_SCHEMA_V6 } from "../../src/control/requirementSplit.js";
import { VALID_SPLIT } from "./fixtures/requirementOutputs.js";
import { schemeHash, validateHistoryTasks } from "../../src/control/integrationScheme.js";

const history = {
  version: 1, targetRef: "refs/heads/main", directSecondParent: true,
  sourceRefs: [
    { taskId: "merge-01", ref: "refs/heads/feature/a" },
    { taskId: "merge-02", ref: "refs/heads/feature/b" },
  ],
  artifactPaths: ["MERGE-NOTES.md"],
} as const;
const named = { delivery: "local", trigger: "group", method: "merge", target: "main", historyExpectation: history };

describe("a named-source history promise (#328)", () => {
  it("accepts an explicit ordered source-parent contract, not only a group-tip merge", () => {
    expect(integrationSchemeSchema.safeParse(named).success).toBe(true);
    expect(integrationSchemeSchema.safeParse({ ...named, historyExpectation: { ...history, sourceRefs: [...history.sourceRefs].reverse() } }).success).toBe(true);
    expect(schemeHash(integrationSchemeSchema.parse(named))).not.toBe(schemeHash(integrationSchemeSchema.parse({ ...named, historyExpectation: { ...history, sourceRefs: [...history.sourceRefs].reverse() } })));
  });

  it("accepts a named Orca source branch while keeping the target outside Orca's work namespace", () => {
    const namedSource = { ...named, historyExpectation: { ...history,
      sourceRefs: [{ taskId: "merge-01", ref: "refs/heads/orca/dogfood-20261112-4" }] } };
    expect(integrationSchemeSchema.safeParse(namedSource).success).toBe(true);
    expect(integrationSchemeSchema.safeParse({ ...namedSource, target: "orca/g",
      historyExpectation: { ...namedSource.historyExpectation, targetRef: "refs/heads/orca/g" } }).success).toBe(false);
  });

  it("refuses a history promise that would deliver by another strategy", () => {
    for (const variant of [
      { ...named, trigger: "task" }, { ...named, method: "squash" },
      { ...named, delivery: "push-target", remote: "origin" },
      { ...named, historyExpectation: { ...history, targetRef: "refs/heads/other" } },
      { ...named, historyExpectation: { ...history, sourceRefs: [history.sourceRefs[0], history.sourceRefs[0]] } },
      // Ruling: 2026-11-17 #328, the reported source branches themselves use orca/; reject malformed refs, not that namespace.
      { ...named, historyExpectation: { ...history, sourceRefs: [{ taskId: "merge-01", ref: "refs/heads/a..b" }] } },
    ]) expect(integrationSchemeSchema.safeParse(variant).success, JSON.stringify(variant)).toBe(false);
  });

  it("refuses a proposed source order that task dependencies cannot enforce", () => {
    const accepted = integrationSchemeSchema.parse(named);
    if (accepted.delivery !== "local" || !accepted.historyExpectation) throw new Error("missing fixture history");
    const tasks = [{ taskId: "merge-01", dependencyTaskIds: [] }, { taskId: "merge-02", dependencyTaskIds: ["merge-01"] }];
    expect(() => validateHistoryTasks(accepted.historyExpectation!, tasks)).not.toThrow();
    expect(() => validateHistoryTasks(accepted.historyExpectation!, [{ ...tasks[0]!, dependencyTaskIds: [] }, { ...tasks[1]!, dependencyTaskIds: [] }])).toThrow("integration-history-invalid:order:merge-01:merge-02");
  });

  it("lets a split propose named history without changing ordinary split answers", () => {
    expect(splitOutputSchema.parse(VALID_SPLIT)).toEqual(VALID_SPLIT);
    const proposed = { ...VALID_SPLIT, historyExpectation: { ...history, sourceRefs: [
      { taskId: "exporter", ref: "refs/heads/feature/a" }, { taskId: "images", ref: "refs/heads/feature/b" },
    ] } };
    expect(splitOutputSchema.safeParse(proposed).success).toBe(true);
    expect((SPLIT_JSON_SCHEMA as { properties: Record<string, unknown> }).properties).not.toHaveProperty("historyExpectation");
    expect((SPLIT_JSON_SCHEMA_V6 as { properties: Record<string, unknown> }).properties).toHaveProperty("historyExpectation");
    const prompt = buildSplitPrompt({ document: "Merge named source branches into main.", overview: { canonicalJson: "{}", hash: "f".repeat(64) }, earlierDrafts: [] });
    expect(prompt).toContain("instruction version 6");
    expect(prompt).toContain("historyExpectation");
    expect(SPLIT_INSTRUCTION_V6).toContain("directSecondParent");
    expect(SPLIT_INSTRUCTION_V6).toContain("Each named source task after the first must depend on the previous source task");
    expect(SPLIT_INSTRUCTION_V6).toContain("Do not ask a task agent to create or merge Git branches");
  });

  it("keeps an ordinary local group merge's accepted shape unchanged", () => {
    const ordinary = { delivery: "local", trigger: "group", method: "merge", target: "main" };
    expect(integrationSchemeSchema.parse(ordinary)).toEqual(ordinary);
    expect(Object.hasOwn(integrationSchemeSchema.parse(ordinary), "historyExpectation")).toBe(false);
  });
});
