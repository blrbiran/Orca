import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { controlRoot } from "../../src/panel/controlOptions.js";
import type { StartedPanel } from "../../src/panel/server.js";
import { login, seedUser, sessionFor } from "./fixtures/auth.js";
import { boot, overSocket, useSocketPanels, workspace } from "./fixtures/socketPanel.js";
import { amountSchema, budgetAmountSchema } from "../../src/control/schema.js";
import { rawAuthorityCommandSchema, spendTokensSchema } from "../../src/control/webProtocol.js";
import { AGENT_AMOUNT_FIELDS, HUMAN_ONLY_FIELDS, HUMAN_ONLY_VERBS, humanOnlyRefusal } from "../../src/panel/humanOnly.js";

const LEAF_KINDS = [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodLiteral, z.ZodEnum, z.ZodNativeEnum, z.ZodNull, z.ZodUndefined, z.ZodUnknown, z.ZodAny, z.ZodDate, z.ZodBigInt];

/** Every amountSchema or spend-cap amount field in every raw command payload, as "<verb>:<path>" (spec §5, C19; accounts spec §3.5). */
function amountFields(): string[] {
  const found: string[] = [];
  const walk = (schema: z.ZodTypeAny, verb: string, path: string[]): void => {
    if (schema === amountSchema || schema === budgetAmountSchema || schema === spendTokensSchema) { found.push(`${verb}:${path.join(".")}`); return; }
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

useSocketPanels();

const commandIds = (state: string): string[] => {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(join(state, "control.sqlite"), { readOnly: true });
  try { return (db.prepare("SELECT id FROM commands ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id); } finally { db.close(); }
};

// Control run decisions plan Task 9: approving a refused decision writes a line into the ledger in the owner's name.
describe("approving a pending decision is an owner's (control run decisions Task 9)", () => {
  // CLI v2 spec §15.1 (plan Task 10; Ruling: 这次批准改写所有必要的判据 (b37f7ce9); 允许改必要的test (8b1469ea)): approve is
  // open to the socket agent (a person acting through their agent); a Web member is refused as before (I3).
  it("refuses approve-pending-decision from a member over the Web; routes the socket agent's to the service", async () => {
    const w = await workspace();
    execFileSync("git", ["init", "-q", "-b", "trunk", w.repo], { env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1" } });
    const panel = await boot(w, [], { port: true });
    seedUser(controlRoot(w.env), "amy", "member");
    const amy = await login(panel.url, "amy");
    const route = "/api/control/groups/g/decisions/approve";
    const payload = { pendingId: "pending-run-x-0", undoHow: `git revert --no-edit ${"e".repeat(40)}` };
    const socket = await overSocket((panel as StartedPanel).socketPath!, "POST", route, { "x-orca-client": "cli:test" }, { commandId: "ad-a", expectedRevision: 0, payload });
    const member = await amy.fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "ad-m", expectedRevision: 0, payload }) });
    // One assertion over both principals, so a mutation shows each of them answered (mutation A1: VERB_ACCESS "any" ->
    // the member's red; SOCKET_TIER "token" -> the socket's red).
    expect({
      socketAgent: [socket.status, JSON.parse(socket.text).error.code],
      webMember: [member.status, ((await member.json()) as { error: { code: string } }).error.code],
    }).toEqual({ socketAgent: [404, "group-not-found"], webMember: [403, "control-verb-human-only"] });
    expect(commandIds(w.state).filter((id) => id.startsWith("ad-"))).toEqual(["ad-a"]);
    // The route is the verb's: an owner's is routed to the service, refused there by name and booked.
    const owner = await sessionFor(panel, w.env);
    const routed = await owner.fetch("/api/control/groups/nogroup/decisions/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ commandId: "ad-o", expectedRevision: 0, payload }) });
    expect([routed.status, ((await routed.json()) as { error: { code: string } }).error.code]).toEqual([404, "group-not-found"]);
    expect(commandIds(w.state)).toContain("ad-o");
  });
});
