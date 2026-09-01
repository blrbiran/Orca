import { describe, expect, it } from "vitest";
import { validateFile } from "../../src/ledger/validateFile.js";

function decisionLine(id: string, undoHow = "git branch -f int/a <ref>"): string {
  return JSON.stringify({
    ev: "decision",
    id,
    at: "2026-08-29T10:04:11.482Z",
    run: "run-7c",
    question: "任务 T4 与 T7 能否并行",
    chose: "串行",
    alternatives: [{ option: "并行", why_not: "写集相交" }],
    because: "写集相交（§5.1 判据）",
    undo: { how: undoHow, cost: "浪费一次 attempt", blast_radius: "仅本仓库调度" },
    scope: "repo",
    kind: "scheduling",
  });
}

describe("validateFile — check 5: referenced ids must exist in the file", () => {
  it("passes when a bound references a decision id that exists in the file", () => {
    const result = validateFile([
      decisionLine("run-7c/1"),
      JSON.stringify({ ev: "bound", id: "run-7c/1" }),
    ]);
    expect(result.verdict).toBe("ok");
  });

  it("rejects when a bound references an id that does not exist", () => {
    const result = validateFile([
      decisionLine("run-7c/1"),
      JSON.stringify({ ev: "bound", id: "run-7c/9" }),
    ]);
    expect(result.verdict).toBe("rejected");
    expect(result.lines[1].result.verdict).toBe("rejected");
  });

  it("rejects when a superseded references an id that does not exist", () => {
    const result = validateFile([JSON.stringify({ ev: "superseded", id: "run-7c/9" })]);
    expect(result.verdict).toBe("rejected");
  });

  it("rejects when an overturned references an id that does not exist", () => {
    const result = validateFile([JSON.stringify({ ev: "overturned", id: "run-7c/9" })]);
    expect(result.verdict).toBe("rejected");
  });

  it("passes even when the reference appears before the referenced decision — spec only requires existence in the file, not order", () => {
    const result = validateFile([
      JSON.stringify({ ev: "bound", id: "run-7c/1" }),
      decisionLine("run-7c/1"),
    ]);
    expect(result.verdict).toBe("ok");
  });

  it("a bound cannot reference another bound's id — only a decision counts as the referenced object", () => {
    const result = validateFile([
      decisionLine("run-7c/1"),
      JSON.stringify({ ev: "bound", id: "run-7c/1" }),
      JSON.stringify({ ev: "bound", id: "run-7c/2" }),
    ]);
    expect(result.verdict).toBe("rejected");
  });
});

describe("validateFile — aggregation and line numbers", () => {
  it("blank lines are skipped and do not count as a record", () => {
    const result = validateFile([decisionLine("run-7c/1"), "", "   "]);
    expect(result.verdict).toBe("ok");
    expect(result.lines).toHaveLength(1);
  });

  it("line numbers are 1-based and point at the offending line", () => {
    const result = validateFile([decisionLine("run-7c/1"), "{坏行"]);
    expect(result.lines[1].lineNumber).toBe(2);
    expect(result.lines[1].result.verdict).toBe("rejected");
  });

  it("verdict is downgraded when there are downgrades but no rejections", () => {
    const result = validateFile([decisionLine("run-7c/1", "回滚一下就好")]);
    expect(result.verdict).toBe("downgraded");
  });

  it("verdict is rejected when there are both downgrades and rejections", () => {
    const result = validateFile([decisionLine("run-7c/1", "回滚一下就好"), "{坏行"]);
    expect(result.verdict).toBe("rejected");
  });
});
