/** GET /api/memory/* -- src/panel/memoryApi.ts. Each call is one getJson; a refusal arrives as a PanelRequestError. */
import { getJson } from "./api.js";
import type { MemoryItemResponse, MemoryPageResponse, MemoryStatusResponse } from "./memoryTypes.js";

const key = (projectKey: string): string => `projectKey=${encodeURIComponent(projectKey)}`;

export const fetchMemoryStatus = (): Promise<MemoryStatusResponse> => getJson<MemoryStatusResponse>("/api/memory/status");
export const fetchMemoryList = (projectKey: string): Promise<MemoryPageResponse> => getJson<MemoryPageResponse>(`/api/memory/list?${key(projectKey)}`);
export const fetchMemorySearch = (projectKey: string, q: string): Promise<MemoryPageResponse> =>
  getJson<MemoryPageResponse>(`/api/memory/search?${key(projectKey)}&q=${encodeURIComponent(q)}`);
export const fetchMemoryItem = (projectKey: string, ref: string): Promise<MemoryItemResponse> =>
  getJson<MemoryItemResponse>(`/api/memory/item?${key(projectKey)}&ref=${encodeURIComponent(ref)}`);
