/**
 * Memory tab spec §5.1: the web copies of src/memory/wire.ts's response shapes (web/ cannot import src/ or zod).
 * tests/memory/memoryWebParity.test.ts keeps them in step, at run time (field set) and at compile time (assignability).
 */
export interface MemoryRecord {
  ref: string;
  scope: "global" | "project";
  projectKey: string | null;
  kind: string;
  content: string;
  tags: string[];
  pinned: boolean;
  source: string;
  trust: number | null;
  createdAt: string;
  updatedAt: string;
}
export const WEB_MEMORY_RECORD_FIELDS = ["ref", "scope", "projectKey", "kind", "content", "tags", "pinned", "source", "trust", "createdAt", "updatedAt"] as const;
export interface MemoryPage { records: MemoryRecord[]; total: number; truncated: boolean }
export type MemoryHealth = { status: "ok" } | { status: "unavailable"; code: string; message: string };
export interface MemoryStatusResponse {
  adapter: { id: string; capabilities: { search: true; get: true; recordCorrection: false } };
  health: MemoryHealth;
  repos: Array<{ projectKey: string }>;
}
export interface MemoryPageResponse { projectKey: string; query: string; page: MemoryPage }
export interface MemoryItemResponse { record: MemoryRecord }
