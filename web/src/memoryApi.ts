/** GET /api/memory/* -- src/panel/memoryApi.ts. Each call is one getJson; a refusal arrives as a PanelRequestError. */
import { getJson } from "./api.js";
import type { MemoryItemResponse, MemoryPageResponse, MemoryStatusResponse } from "./memoryTypes.js";

const key = (projectKey: string): string => `projectKey=${encodeURIComponent(projectKey)}`;

export const fetchMemoryStatus = (): Promise<MemoryStatusResponse> => getJson<MemoryStatusResponse>("/api/memory/status");
/** Tester #281 (2): the page size the server answers when none is asked (src/memory/search.ts MEMORY_LIMIT_DEFAULT). */
export const MEMORY_PAGE_DEFAULT = 50;
/**
 * Tester #258, #281: a page names where it starts and how many it holds; the defaults (offset 0, the server's page size)
 * are left out, so the first page's request is unchanged.
 */
const span = (offset: number, limit: number): string => `${offset > 0 ? `&offset=${offset}` : ""}${limit !== MEMORY_PAGE_DEFAULT ? `&limit=${limit}` : ""}`;
export const fetchMemoryList = (projectKey: string, offset = 0, limit = MEMORY_PAGE_DEFAULT): Promise<MemoryPageResponse> =>
  getJson<MemoryPageResponse>(`/api/memory/list?${key(projectKey)}${span(offset, limit)}`);
export const fetchMemorySearch = (projectKey: string, q: string, offset = 0, limit = MEMORY_PAGE_DEFAULT): Promise<MemoryPageResponse> =>
  getJson<MemoryPageResponse>(`/api/memory/search?${key(projectKey)}&q=${encodeURIComponent(q)}${span(offset, limit)}`);
export const fetchMemoryItem = (projectKey: string, ref: string): Promise<MemoryItemResponse> =>
  getJson<MemoryItemResponse>(`/api/memory/item?${key(projectKey)}&ref=${encodeURIComponent(ref)}`);
