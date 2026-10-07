import { describe, expect, it } from "vitest";
import { z } from "zod";
import { amountSchema } from "../../src/control/schema.js";
import { rawAuthorityCommandSchema, spendTokensSchema } from "../../src/control/webProtocol.js";
import { AGENT_AMOUNT_FIELDS, HUMAN_ONLY_FIELDS, HUMAN_ONLY_VERBS, humanOnlyRefusal } from "../../src/panel/humanOnly.js";

const LEAF_KINDS = [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodLiteral, z.ZodEnum, z.ZodNativeEnum, z.ZodNull, z.ZodUndefined, z.ZodUnknown, z.ZodAny, z.ZodDate, z.ZodBigInt];

/** Every amountSchema or spend-cap amount field in every raw command payload, as "<verb>:<path>" (spec §5, C19; accounts spec §3.5). */
function amountFields(): string[] {
  const found: string[] = [];
  const walk = (schema: z.ZodTypeAny, verb: string, path: string[]): void => {
    if (schema === amountSchema || schema === spendTokensSchema) { found.push(`${verb}:${path.join(".")}`); return; }
    if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) return walk(schema.unwrap(), verb, path);
    if (schema instanceof z.ZodDefault) return walk(schema._def.innerType, verb, path);
    if (schema instanceof z.ZodEffects) return walk(schema.innerType(), verb, path);
    if (schema instanceof z.ZodArray) return walk(schema.element, verb, [...path, "[]"]);
    if (schema instanceof z.ZodRecord) return walk(schema.valueSchema, verb, [...path, "{}"]);
    if (schema instanceof z.ZodObject) { for (const [key, child] of Object.entries(schema.shape)) walk(child as z.ZodTypeAny, verb, [...path, key]); return; }
    if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) { for (const option of schema.options as z.ZodTypeAny[]) walk(option, verb, path); return; }
    if (schema instanceof z.ZodIntersection) { walk(schema._def.left, verb, path); walk(schema._def.right, verb, path); return; }
    // A kind this walker does not know could hide an amount; fail rather than skip it silently.
    if (LEAF_KINDS.some((kind) => schema instanceof kind)) return;
    throw new Error(`unhandled zod kind ${schema.constructor.name} at ${verb}:${path.join(".")}`);
  };
  const union = (rawAuthorityCommandSchema as unknown as z.ZodEffects<z.ZodDiscriminatedUnion<"verb", z.ZodObject<{ verb: z.ZodTypeAny } & z.ZodRawShape>[]>>).innerType();
  for (const option of union.options) {
    const verb = (option.shape.verb as z.ZodLiteral<string>).value;
    walk(option.shape.payload as z.ZodTypeAny, verb, []);
  }
  return [...new Set(found)].sort();
}

describe("the human-only surface (spec §5)", () => {
  it("covers every amount a raw command can carry, or lists it with a reason (C19)", () => {
    const fields = amountFields();
    // Non-vacuous: the walk must see the inputs the specs name, the spend cap's amount among them.
    expect(fields).toEqual(expect.arrayContaining(["set-limit:limit", "requirement-open:limit", "proposal-edit:proposedGroupLimit", "set-spend-cap:tokens"]));
    // Accounts spec §3.5: the cap verbs, and the calendar that moves their boundaries, are human-only.
    expect(HUMAN_ONLY_VERBS).toEqual(expect.arrayContaining(["set-limit", "set-spend-cap", "clear-spend-cap", "set-usage-calendar"]));
    const covered = (entry: string): boolean => {
      const [verb, path] = entry.split(":") as [string, string];
      return (HUMAN_ONLY_VERBS as readonly string[]).includes(verb)
        || ((HUMAN_ONLY_FIELDS as Record<string, readonly string[]>)[verb] ?? []).includes(path)
        || Object.hasOwn(AGENT_AMOUNT_FIELDS, entry);
    };
    expect(fields.filter((entry) => !covered(entry))).toEqual([]);
    for (const reason of Object.values(AGENT_AMOUNT_FIELDS)) expect(reason.trim()).not.toBe("");
  });

  it("refuses the verb and the two fields, and nothing else", () => {
    expect(humanOnlyRefusal("set-limit", { limit: {} })?.code).toBe("control-verb-human-only");
    expect(humanOnlyRefusal("requirement-open", { groupId: "g", limit: {} })?.code).toBe("control-field-human-only");
    expect(humanOnlyRefusal("proposal-edit", { proposedGroupLimit: {} })?.code).toBe("control-field-human-only");
    expect(humanOnlyRefusal("requirement-open", { groupId: "g" })).toBe(null);
    expect(humanOnlyRefusal("proposal-edit", { operations: [] })).toBe(null);
    expect(humanOnlyRefusal("confirm", { limit: {} })).toBe(null);
    expect(humanOnlyRefusal("requirement-open", "not an object")).toBe(null);
    // An inherited property is not the payload's own field.
    expect(humanOnlyRefusal("requirement-open", Object.create({ limit: {} }))).toBe(null);
  });
});
