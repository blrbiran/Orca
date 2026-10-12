import { z } from "zod";
import { idSchema } from "./schema.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const installed = z.object({
  id: idSchema, kind: z.string().min(1), command: z.array(z.string()).min(1),
  recordedVersion: z.string().min(1), observedVersion: z.string().min(1).nullable(),
  realpath: z.string().nullable(), status: z.enum(["current", "changed", "unavailable"]),
}).strict();
export const agentObservationSchema = z.object({
  schema: z.literal("orca-agent-detection-observation-v1"), baseTableHash: hash,
  observedAt: z.string().datetime(), installed: z.array(installed),
}).strict();
const change = z.object({
  changeId: idSchema, kind: z.enum(["version", "path", "addition"]), installationId: idSchema,
  command: z.array(z.string()).min(1), realpath: z.string().min(1), version: z.string().min(1),
  installation: z.record(z.unknown()).optional(),
  unavailableReason: z.string().min(1).optional(),
}).strict();
export const agentPreviewSchema = agentObservationSchema.omit({ schema: true }).extend({
  schema: z.literal("orca-agent-detection-preview-v1"), previewId: idSchema, changes: z.array(change),
}).strict();
const table = z.object({ schema: z.literal("ccloop-agents-table-v1"), installations: z.record(z.unknown()) }).strict();
export const agentReceiptSchema = z.object({
  schema: z.literal("orca-agent-detection-receipt-v1"), opId: idSchema, requestDigest: hash,
  previewId: idSchema, acceptedChangeIds: z.array(idSchema).min(1), beforeHash: hash, afterHash: hash,
  before: table, after: table,
}).strict();
const pendingCommand = z.object({
  schema: z.literal("orca-raw-command-v1"), commandId: idSchema, expectedRevision: z.number().int().nonnegative().safe(),
  actorId: idSchema, verb: z.literal("apply-agent-update"), target: z.object({ kind: z.literal("operator"), operatorId: idSchema }).strict(),
  payload: z.object({ previewId: idSchema, baseTableHash: hash, acceptedChangeIds: z.array(idSchema).min(1) }).strict(),
}).strict();
export const agentUpdateStateSchema = z.object({
  schema: z.literal("orca-agent-installation-state-v1"), revision: z.number().int().nonnegative().safe(), pending: z.boolean(),
  pendingCommand: pendingCommand.nullable(), observation: agentObservationSchema.nullable(), preview: agentPreviewSchema.nullable(), failureCode: z.string().min(1).nullable(),
}).strict();
export type AgentObservation = z.infer<typeof agentObservationSchema>;
export type AgentPreview = z.infer<typeof agentPreviewSchema>;
export type AgentReceipt = z.infer<typeof agentReceiptSchema>;
export type AgentApplyRequest = { opId: string; requestDigest: string; previewId: string; baseTableHash: string; acceptedChangeIds: string[] };
