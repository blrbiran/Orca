import { z } from "zod";

/**
 * Memory tab spec §5.1: the three responses, strict. The server parses every body against these before sending it
 * (src/panel/memoryApi.ts `sendChecked`), so a field that drifts in is a loud 500, never a silent extra. web/ cannot
 * import zod or src/, so it keeps its own copies (web/src/memoryTypes.ts), held in step by tests/memory/memoryWebParity.test.ts.
 */
export const memoryRecordSchema = z.object({
  ref: z.string(),
  scope: z.enum(["global", "project"]),
  projectKey: z.string().nullable(),
  kind: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  pinned: z.boolean(),
  source: z.string(),
  trust: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();
export const MEMORY_RECORD_FIELDS: readonly string[] = Object.keys(memoryRecordSchema.shape);

export const memoryPageSchema = z.object({
  records: z.array(memoryRecordSchema),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict();

export const memoryStatusResponseSchema = z.object({
  adapter: z.object({
    id: z.string(),
    capabilities: z.object({ search: z.literal(true), get: z.literal(true), recordCorrection: z.literal(false) }).strict(),
  }).strict(),
  health: z.union([
    z.object({ status: z.literal("ok") }).strict(),
    z.object({ status: z.literal("unavailable"), code: z.string(), message: z.string() }).strict(),
  ]),
  repos: z.array(z.object({ projectKey: z.string() }).strict()),
}).strict();

export const memoryPageResponseSchema = z.object({ projectKey: z.string(), query: z.string(), page: memoryPageSchema }).strict();
export const memoryItemResponseSchema = z.object({ record: memoryRecordSchema }).strict();

export type MemoryRecordWire = z.infer<typeof memoryRecordSchema>;
export type MemoryStatusResponse = z.infer<typeof memoryStatusResponseSchema>;
export type MemoryPageResponse = z.infer<typeof memoryPageResponseSchema>;
export type MemoryItemResponse = z.infer<typeof memoryItemResponseSchema>;
