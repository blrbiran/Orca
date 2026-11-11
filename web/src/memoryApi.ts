/** GET /api/memory/* -- src/panel/memoryApi.ts. Each call is one getJson; a refusal arrives as a PanelRequestError. */
import { getJson } from "./api.js";
import type { MemoryItemResponse, MemoryPageResponse, MemoryStatusResponse } from "./memoryTypes.js";

const key = (projectKey: string): string => `projectKey=${encodeURIComponent(projectKey)}`;

export const fetchMemoryStatus = (): Promise<MemoryStatusResponse> => getJson<MemoryStatusResponse>("/api/memory/status");
/** Tester #258: a further page names where it starts; the first page's request is unchanged (offset 0 is the default). */
const from = (offset: number): string => (offset > 0 ? `&offset=${offset}` : "");
export const fetchMemoryList = (projectKey: string, offset = 0): Promise<MemoryPageResponse> => getJson<MemoryPageResponse>(`/api/memory/list?${key(projectKey)}${from(offset)}`);
export const fetchMemorySearch = (projectKey: string, q: string, offset = 0): Promise<MemoryPageResponse> =>
  getJson<MemoryPageResponse>(`/api/memory/search?${key(projectKey)}&q=${encodeURIComponent(q)}${from(offset)}`);
export const fetchMemoryItem = (projectKey: string, ref: string): Promise<MemoryItemResponse> =>
  getJson<MemoryItemResponse>(`/api/memory/item?${key(projectKey)}&ref=${encodeURIComponent(ref)}`);
