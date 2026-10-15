// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { sendControlCommand } from "../src/controlApi.js";

afterEach(() => { vi.unstubAllGlobals(); });

// ccloop error codes spec (2026-10-15) §4.2: the server's 424 is only useful if the web files it as a durable refusal --
// a status of 500 or more is "may not have committed" and is looked up instead (controlApi.ts sendControlCommand). This
// pins the web side the server change relies on; it is green before Task A2 (no web change is needed).
describe("a 424 ccloop-failed in the browser", () => {
  it("is an answered refusal, not an uncertain outcome", async () => {
    const body = { error: { code: "ccloop-failed", message: "ccloop-failed:omp-model-catalog-unavailable: spawn ENOENT", commandRevision: 3, evidenceIds: [], retryable: true } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 424, headers: { "content-type": "application/json" } })));
    expect(await sendControlCommand("/api/control/groups/g/confirm", { commandId: "c-1", expectedRevision: 3, payload: {} } as never))
      .toEqual({ kind: "answered", status: 424, body });
  });
});
