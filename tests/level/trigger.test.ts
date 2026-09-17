import { describe, expect, it } from "vitest";
import { decide } from "../../src/level/trigger.js";
import type { NoReading, Reading } from "../../src/level/types.js";

const CONFIGURED = { t1: 330_000, t2: 450_000 };
const WRITE = "WRITE-COMMAND";

function reading(prompt: number, output: number, windowTokens = 1_000_000, reserve?: number): Reading {
  return {
    kind: "reading",
    runtime: "claude-code",
    sessionRef: "s",
    promptTokens: prompt,
    outputTokens: output,
    windowTokens,
    ...(reserve === undefined ? {} : { compactionReserveTokens: reserve }),
    observedAt: "2026-09-17T00:00:00.000Z",
  };
}

describe("decide (D spec section 4)", () => {
  it("stays silent one token below T1", () => {
    expect(decide(reading(329_999, 0), CONFIGURED, null, WRITE)).toEqual({ kind: "silent" });
  });

  it("counts the last call's output: a prompt one below T1 plus one output token reaches T1 (spec 3.1)", () => {
    expect(decide(reading(329_999, 1), CONFIGURED, null, WRITE).kind).toBe("write");
  });

  it("asks for a checkpoint with the reading, both thresholds and the command to run", () => {
    expect(decide(reading(340_000, 5), CONFIGURED, null, WRITE)).toEqual({
      kind: "write",
      text: "orca level: 340005 of 1000000 tokens (T1 330000, T2 450000). Write a checkpoint now. WRITE-COMMAND",
    });
  });

  it("does not ask again once this band has a checkpoint (spec 9, item 10)", () => {
    expect(decide(reading(340_000, 5), CONFIGURED, { path: "/r/x.json", band: 1 }, WRITE)).toEqual({
      kind: "inform",
      text: "orca level: 340005 of 1000000 tokens (T1 330000, T2 450000). A checkpoint for this band is at /r/x.json.",
    });
  });

  it("past T2 a band-1 checkpoint does not cover: breach, still asking for a checkpoint", () => {
    const d = decide(reading(450_000, 0), CONFIGURED, { path: "/p", band: 1 }, WRITE);
    expect(d.kind).toBe("breach");
    expect(d.kind !== "silent" && d.text.endsWith(WRITE)).toBe(true);
  });

  it("past T2 with a band-2 checkpoint: breach pointing at it, without asking to write again", () => {
    expect(decide(reading(460_000, 0), CONFIGURED, { path: "/p2", band: 2 }, WRITE)).toEqual({
      kind: "breach",
      text:
        "orca level: 460000 of 1000000 tokens (T1 330000, T2 450000) is past T2, the session limit. " +
        "A checkpoint for this band is at /p2: hand off now.",
    });
  });

  it("a window smaller than both thresholds pulls them down to it (Codex measured 258,400)", () => {
    expect(decide(reading(258_399, 0, 258_400), CONFIGURED, null, WRITE)).toEqual({ kind: "silent" });
    const d = decide(reading(258_400, 0, 258_400), CONFIGURED, null, WRITE);
    expect(d.kind).toBe("breach");
    expect(d.kind !== "silent" && d.text.startsWith("orca level: 258400 of 258400 tokens (T1 258400, T2 258400)")).toBe(true);
  });

  it("subtracts the runtime's compaction reserve from the window", () => {
    expect(decide(reading(300_000, 0, 400_000, 100_000), CONFIGURED, null, WRITE).kind).toBe("breach");
  });

  it("a missing reading is reported every time, even with a covering checkpoint", () => {
    const none: NoReading = { kind: "no-reading", runtime: "claude-code", sessionRef: "s", reason: "no model attachment in transcript" };
    expect(decide(none, CONFIGURED, { path: "/p", band: 2 }, WRITE)).toEqual({
      kind: "no-reading",
      text: "orca level: no reading — no model attachment in transcript",
    });
  });
});
