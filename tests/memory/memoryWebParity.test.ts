import { describe, expect, it } from "vitest";
import type { MemoryItemResponse as ServerItem, MemoryPageResponse as ServerPage, MemoryStatusResponse as ServerStatus } from "../../src/memory/wire.js";
import { MEMORY_RECORD_FIELDS } from "../../src/memory/wire.js";
import type { MemoryItemResponse as WebItem, MemoryPageResponse as WebPage, MemoryStatusResponse as WebStatus } from "../../web/src/memoryTypes.js";
import { WEB_MEMORY_RECORD_FIELDS } from "../../web/src/memoryTypes.js";

/**
 * Plan D9: the same two halves as tests/panel/webParity.test.ts, in a file of its own so that file is not edited.
 * Runtime: the record's field set. Compile time: the functions below must type-check both ways (npm run typecheck
 * checks this file); they are never called.
 */
describe("web/src/memoryTypes.ts stays in step with src/memory/wire.ts", () => {
  it("has the same record fields", () => {
    expect([...WEB_MEMORY_RECORD_FIELDS].sort()).toEqual([...MEMORY_RECORD_FIELDS].sort());
  });
});

function statusServerToWeb(x: ServerStatus): WebStatus { return x; }
function statusWebToServer(x: WebStatus): ServerStatus { return x; }
function pageServerToWeb(x: ServerPage): WebPage { return x; }
function pageWebToServer(x: WebPage): ServerPage { return x; }
function itemServerToWeb(x: ServerItem): WebItem { return x; }
function itemWebToServer(x: WebItem): ServerItem { return x; }
export const __memoryParityChecks__ = [statusServerToWeb, statusWebToServer, pageServerToWeb, pageWebToServer, itemServerToWeb, itemWebToServer];
