import { describe, expect, it } from "vitest";
import { readPendingAgentUpdate, writePendingAgentUpdate } from "../src/controlApi.js";

describe("installation update lost-answer identity", () => {
  it("retains the same preview, command ID and revision across a browser reload", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } } as Storage;
    const command = { commandId: "update-1", expectedRevision: 3, payload: { previewId: "preview-1", baseTableHash: "a".repeat(64), acceptedChangeIds: ["change-1"] } };
    writePendingAgentUpdate(storage, command);
    expect(readPendingAgentUpdate(storage)).toEqual(command);
    writePendingAgentUpdate(storage, null);
    expect(readPendingAgentUpdate(storage)).toBeNull();
  });
});
