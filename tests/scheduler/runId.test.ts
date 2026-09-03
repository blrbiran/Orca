import { describe, expect, it } from "vitest";
import { deriveRunId } from "../../src/scheduler/runId.js";

describe("deriveRunId", () => {
  it("derives the same id from the same contract and base", async () => {
    const bytes = Buffer.from('{"objective":{"taskId":"T1"}}');
    const base = "abc123def456";
    const a = deriveRunId("T1", bytes, base);
    const b = deriveRunId("T1", bytes, base);
    expect(b).toBe(a);
    expect(a).toMatch(/^orca-T1-[0-9a-f]{8}$/);
  });

  it("changes when the contract bytes change, so a different task body never shares an id", async () => {
    const base = "abc123def456";
    const a = deriveRunId("T1", Buffer.from("one"), base);
    const b = deriveRunId("T1", Buffer.from("two"), base);
    expect(b).not.toBe(a);
  });

  it("changes when the base commit changes, so a rerun on a new base never shares an id", async () => {
    const bytes = Buffer.from("same contract");
    const a = deriveRunId("T1", bytes, "base-one");
    const b = deriveRunId("T1", bytes, "base-two");
    expect(b).not.toBe(a);
  });

  it("rejects a task id that would produce a run id the ledger writer refuses", async () => {
    // src/ledger/writer.ts's RUN_ID validator requires
    // /^[A-Za-z0-9][A-Za-z0-9._-]*$/. A taskId with a slash or a space would
    // slip an unusable id past allocation and fail far away, inside the
    // ledger, on the first appendEvent call for this run.
    const bytes = Buffer.from("x");
    expect(() => deriveRunId("bad/task id", bytes, "base")).toThrow(/task id/);
  });
});
