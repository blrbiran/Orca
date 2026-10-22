import { z } from "zod";

/**
 * ccloop per-contract tool rules spec 2026-10-22 §2 and §5 (flow engine spec §16.2): Orca's mirror of the rules a contract
 * carries in `executionPolicy.toolRules` and of the report ccloop answers at collect's top level. Both strict, so a shape
 * ccloop does not speak is refused here instead of being half-read.
 */
// §2: bounds are UTF-8 bytes (zod's .max counts UTF-16 code units), no NUL.
const commandValue = z.string().min(1).refine((value) => Buffer.byteLength(value, "utf8") <= 4096 && !value.includes("\u0000"));
const commandRule = z.object({ kind: z.enum(["exact", "prefix"]), value: commandValue }).strict();
const secretName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/);

/** §2: every key required and no default anywhere -- one rule set has exactly one spelling, so one contract hash. */
export const toolRulesSchema = z.object({
  commands: z.array(commandRule).max(64)
    .refine((commands) => new Set(commands.map((rule) => JSON.stringify([rule.kind, rule.value]))).size === commands.length),
  network: z.boolean(),
  secretEnv: z.array(secretName).max(32).refine((names) => new Set(names).size === names.length),
}).strict();
export type ToolRules = z.infer<typeof toolRulesSchema>;

const ruleSchema = z.union([
  z.object({ kind: z.literal("commands-closed") }).strict(),
  z.object({ kind: z.enum(["exact", "prefix"]), value: z.string() }).strict(),
  z.object({ kind: z.literal("network"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("secretEnv"), name: z.string() }).strict(),
]);
/** §5 `ToolRulesReportV1`: one row per rule, with how ccloop could hold the agent to it on this agent kind. */
export const toolRulesReportSchema = z.object({
  schema: z.literal("ccloop-tool-rules-report-v1"),
  agentKind: z.enum(["claude", "codex", "omp"]),
  baseline: z.string().refine((text) => Buffer.byteLength(text, "utf8") <= 1024),
  rules: z.array(z.object({
    rule: ruleSchema,
    status: z.enum(["enforced", "detected", "recorded-only", "refused"]),
    reason: z.string().refine((text) => Buffer.byteLength(text, "utf8") <= 512).nullable(),
    phases: z.array(z.enum(["plan", "execute", "verify"])),
    present: z.boolean().optional(),
  }).strict()),
}).strict();
export type ToolRulesReport = z.infer<typeof toolRulesReportSchema>;
