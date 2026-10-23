import { z } from "zod";

/**
 * Flow engine spec §11.2 [IR-I12, S1 §4 pattern]: the `flows` field of a settings layer -- project (`repository_settings`
 * body) or global (`orchestration_settings` body, which alone may carry `locks`). Every field is optional: absent ⇒ the
 * next layer (project > global > built-in). Pure zod: control's settings bodies import it.
 */
export const FLOW_EFFECT_CLASSES = ["local", "cost", "external", "irreversible"] as const;
export type FlowEffectClass = (typeof FLOW_EFFECT_CLASSES)[number];
export const FLOW_LEVELS = ["apply-flag", "confirm", "stage-only"] as const;
export type FlowLevel = (typeof FLOW_LEVELS)[number];
export const FLOW_LEVEL_SETTINGS = [...FLOW_LEVELS, "follow-template"] as const;
export type FlowLevelSetting = (typeof FLOW_LEVEL_SETTINGS)[number];
/** §11.2: only security-class fields are lockable; nothing is locked by default. */
export const FLOW_LOCKABLE_PATHS = ["effects.local", "effects.cost", "effects.external", "effects.irreversible", "allowedSkillSources", "budgets.tokensPerRun"] as const;
export type FlowLockablePath = (typeof FLOW_LOCKABLE_PATHS)[number];
/** The fields a `set-flow-settings` may clear (the next layer applies again). */
export const FLOW_SETTING_FIELDS = ["effects.local", "effects.cost", "effects.external", "effects.irreversible", "rerunReview", "rerunAskTimeoutSeconds", "roles", "allowedSkillSources", "budgets.tokensPerRun", "paramDefaults"] as const;
export type FlowSettingField = (typeof FLOW_SETTING_FIELDS)[number];

const level = z.enum(FLOW_LEVEL_SETTINGS);
export const flowsLayerSchema = z.object({
  effects: z.object({ local: level.optional(), cost: level.optional(), external: level.optional(), irreversible: level.optional() }).strict().optional(),
  rerunReview: z.enum(["auto", "review"]).optional(),
  /** Gaps spec §5.3: how long an unsure re-run question waits before it resolves to "accept as unchanged". Not lockable. */
  rerunAskTimeoutSeconds: z.number().int().min(30).max(86_400).optional(),
  roles: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(64), z.object({ agent: z.string().min(1).max(200), model: z.string().min(1).max(200).optional() }).strict()).optional(),
  allowedSkillSources: z.array(z.string().min(1).max(500)).max(64).optional(),
  budgets: z.object({ tokensPerRun: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional() }).strict().optional(),
  /**
   * Gaps spec §8.2: preset values per template and param, `{<templateId>: {<paramId>: value}}`; a start's own value wins,
   * then the project's, then the global one, then the template's. Not lockable. Only here may an `image` be absolute.
   */
  paramDefaults: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(64), z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).max(64), z.union([z.string().max(4096), z.number(), z.boolean()]))).optional(),
}).strict();
export const globalFlowsLayerSchema = flowsLayerSchema.extend({
  locks: z.array(z.enum(FLOW_LOCKABLE_PATHS)).max(FLOW_LOCKABLE_PATHS.length).optional(),
}).strict();
export type FlowsLayer = z.infer<typeof flowsLayerSchema>;
export type GlobalFlowsLayer = z.infer<typeof globalFlowsLayerSchema>;
