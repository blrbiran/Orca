import { z } from "zod";
import { triggerSchema } from "./trigger.js";

/**
 * Checks spec 2026-10-22 §4.1: the `checks` field of a settings layer (project: the `repository_settings` body; global:
 * the `orchestration_settings` body, which alone may carry `locks`). Every field is optional: absent ⇒ the next layer
 * (project > global > built-in). A whole `trigger` is one field, replaced as a unit.
 */
export const CHECK_KINDS = ["integration-check", "model-review"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];
export const MAX_SCHEDULED_CHECKS = 8;
export const LOCKABLE_PATHS = ["integrationCheck.command", "modelReview.budgetTokens"] as const;
export type LockablePath = (typeof LOCKABLE_PATHS)[number];

export const integrationCheckLayerSchema = z.object({
  enabled: z.boolean().optional(),
  trigger: triggerSchema.optional(),
  command: z.string().min(1).max(4096).nullable().optional(),
}).strict();
export const modelReviewLayerSchema = z.object({
  enabled: z.boolean().optional(),
  trigger: triggerSchema.optional(),
  budgetTokens: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  maxGroupsPerReview: z.number().int().min(1).max(50).optional(),
}).strict();
export const scheduledCheckSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  kind: z.enum(CHECK_KINDS),
  cron: z.string().min(1).max(200),
  enabled: z.boolean(),
  /** Reserved (spec §2.4): a scheduled check's own params arrive with the flow engine. */
  params: z.object({}).strict(),
}).strict();
export type ScheduledCheck = z.infer<typeof scheduledCheckSchema>;

export const checksLayerSchema = z.object({
  integrationCheck: integrationCheckLayerSchema.optional(),
  modelReview: modelReviewLayerSchema.optional(),
  scheduled: z.array(scheduledCheckSchema).max(MAX_SCHEDULED_CHECKS).optional(),
}).strict();
export const globalChecksLayerSchema = checksLayerSchema.extend({
  locks: z.array(z.enum(LOCKABLE_PATHS)).max(LOCKABLE_PATHS.length).optional(),
}).strict();
export type ChecksLayer = z.infer<typeof checksLayerSchema>;
export type GlobalChecksLayer = z.infer<typeof globalChecksLayerSchema>;
