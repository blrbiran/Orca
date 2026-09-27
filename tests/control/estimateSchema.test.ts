import { describe, expect, it } from "vitest";
import { canonicalBytes } from "../../src/control/canonicalJson.js";
import { BUDGET_ESTIMATE_JSON_SCHEMA } from "../../src/control/estimatePrompt.js";
import { budgetEstimateSchema } from "../../src/control/webProtocol.js";

// Single-call estimate spec §6.2: the hand-written JSON Schema ccloop hands the model, judged against the zod schema
// the answer is finally checked with. Drafter finding F9: the constant uses only the keywords real claude has already
// taken (ccloop's phase schemas), so this file interprets exactly those -- and first proves nothing else is used.
type Schema = Record<string, unknown>;
const KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "items", "enum"]);
const nodes = (schema: Schema, path = "#"): Array<[string, Schema]> => {
  const out: Array<[string, Schema]> = [[path, schema]];
  for (const [key, child] of Object.entries((schema.properties ?? {}) as Record<string, Schema>)) out.push(...nodes(child, `${path}/${key}`));
  if (schema.items) out.push(...nodes(schema.items as Schema, `${path}/items`));
  return out;
};
function accepts(schema: Schema, value: unknown): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  switch (schema.type) {
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "array": return Array.isArray(value) && value.every((item) => accepts(schema.items as Schema, item));
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
      const properties = schema.properties as Record<string, Schema>, record = value as Record<string, unknown>;
      if ((schema.required as string[]).some((key) => !Object.hasOwn(record, key))) return false;
      if (schema.additionalProperties === false && Object.keys(record).some((key) => !Object.hasOwn(properties, key))) return false;
      return Object.entries(record).every(([key, item]) => properties[key] === undefined || accepts(properties[key]!, item));
    }
    default: throw new Error(`unsupported type ${String(schema.type)}`);
  }
}
const zodAccepts = (value: unknown) => budgetEstimateSchema.safeParse(value).success;
const jsonAccepts = (value: unknown) => accepts(BUDGET_ESTIMATE_JSON_SCHEMA as Schema, value);

const amount = { tokens: 1_000, activeMs: 60_000, attempts: 1, sessions: 1 };
const task = { taskId: "a", complexity: "M", confidence: "high", work: amount, handoff: { tokens: 0, activeMs: 0, attempts: 0, sessions: 0 }, rationale: "one module", assumptions: ["clean tree"] };
const valid = { schema: "budget-estimate-v1", planHash: "a".repeat(64), tasks: [task], goalReviewReserve: amount, groupRationale: "one task" };
const without = <T extends Record<string, unknown>>(value: T, key: string) => Object.fromEntries(Object.entries(value).filter(([k]) => k !== key));

/** Refused by both: what the schema expresses. */
const BOTH_REJECT: Array<[string, unknown]> = [
  ...Object.keys(valid).map((key): [string, unknown] => [`no top-level ${key}`, without(valid, key)]),
  ...Object.keys(task).map((key): [string, unknown] => [`a task without ${key}`, { ...valid, tasks: [without(task, key)] }]),
  ...Object.keys(amount).map((key): [string, unknown] => [`work without ${key}`, { ...valid, tasks: [{ ...task, work: without(amount, key) }] }]),
  ["an extra top-level key", { ...valid, extra: 1 }],
  ["an extra task key", { ...valid, tasks: [{ ...task, extra: 1 }] }],
  ["an extra amount key", { ...valid, goalReviewReserve: { ...amount, extra: 1 } }],
  ["another schema version", { ...valid, schema: "budget-estimate-v2" }],
  ["a complexity outside S..XL", { ...valid, tasks: [{ ...task, complexity: "XXL" }] }],
  ["a confidence outside low..high", { ...valid, tasks: [{ ...task, confidence: "certain" }] }],
  ["tokens as a string", { ...valid, tasks: [{ ...task, work: { ...amount, tokens: "1" } }] }],
  ["a fractional amount", { ...valid, goalReviewReserve: { ...amount, activeMs: 1.5 } }],
  ["tasks as an object", { ...valid, tasks: {} }],
  ["assumptions as a string", { ...valid, tasks: [{ ...task, assumptions: "clean tree" }] }],
  ["planHash as a number", { ...valid, planHash: 1 }],
];
/** Refused by zod only: the gap the constant leaves to the final check, pinned so it is visible. */
const ZOD_ONLY: Array<[string, unknown]> = [
  ["a negative amount", { ...valid, tasks: [{ ...task, work: { ...amount, tokens: -1 } }] }],
  ["an amount past MAX_SAFE_INTEGER", { ...valid, goalReviewReserve: { ...amount, tokens: 9_007_199_254_740_992 } }],
  ["a planHash that is not 64 hex", { ...valid, planHash: "z".repeat(64) }],
  ["an empty rationale", { ...valid, tasks: [{ ...task, rationale: "" }] }],
  ["an empty groupRationale", { ...valid, groupRationale: "" }],
  ["no assumptions", { ...valid, tasks: [{ ...task, assumptions: [] }] }],
  ["an assumption twice", { ...valid, tasks: [{ ...task, assumptions: ["x", "x"] }] }],
  ["tasks out of taskId order", { ...valid, tasks: [{ ...task, taskId: "b" }, task] }],
  ["a taskId that is not an id", { ...valid, tasks: [{ ...task, taskId: "not an id" }] }],
];

describe("BUDGET_ESTIMATE_JSON_SCHEMA against budgetEstimateSchema (single-call estimate spec §6.2)", () => {
  it("uses only the keywords this file interprets, requires every property, and closes every object", () => {
    for (const [path, node] of nodes(BUDGET_ESTIMATE_JSON_SCHEMA as Schema)) {
      for (const key of Object.keys(node)) expect(KEYWORDS.has(key), `${path}: ${key}`).toBe(true);
      if (node.type === "object") {
        expect(node.additionalProperties, path).toBe(false);
        expect([...(node.required as string[])].sort(), path).toEqual(Object.keys(node.properties as Schema).sort());
      }
    }
    expect((BUDGET_ESTIMATE_JSON_SCHEMA as Schema).type).toBe("object");
  });

  it("accepts a valid estimate on both sides", () => {
    expect(zodAccepts(valid)).toBe(true);
    expect(jsonAccepts(valid)).toBe(true);
  });

  it.each(BOTH_REJECT)("refuses on both sides: %s", (_label, value) => {
    expect(zodAccepts(value)).toBe(false);
    expect(jsonAccepts(value)).toBe(false);
  });

  it.each(ZOD_ONLY)("is left to zod: %s", (_label, value) => {
    expect(zodAccepts(value)).toBe(false);
    expect(jsonAccepts(value)).toBe(true);
  });

  it("never refuses what zod accepts", () => {
    for (const [label, value] of [["valid", valid], ...BOTH_REJECT, ...ZOD_ONLY] as Array<[string, unknown]>) {
      if (zodAccepts(value)) expect(jsonAccepts(value), label).toBe(true);
    }
  });

});
