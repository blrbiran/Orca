import { readdir, readFile } from "node:fs/promises";
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

// bound records carry taskId/runId since P1 Task 2; these criteria are about
// check 5 (does the referenced id exist), so they use an otherwise-valid bound
// and let the reference itself be the only thing under test.
function boundLine(id: string): string {
  return JSON.stringify({ ev: "bound", id, taskId: "t-1", runId: "run-7c" });
}

describe("validateFile — check 5: referenced ids must exist in the file", () => {
  it("passes when a bound references a decision id that exists in the file", () => {
    const result = validateFile([
      decisionLine("run-7c/1"),
      boundLine("run-7c/1"),
    ]);
    expect(result.verdict).toBe("ok");
  });

  it("rejects when a bound references an id that does not exist", () => {
    const result = validateFile([
      decisionLine("run-7c/1"),
      boundLine("run-7c/9"),
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
      boundLine("run-7c/1"),
      decisionLine("run-7c/1"),
    ]);
    expect(result.verdict).toBe("ok");
  });

  it("a bound cannot reference another bound's id — only a decision counts as the referenced object", () => {
    const result = validateFile([
      decisionLine("run-7c/1"),
      boundLine("run-7c/1"),
      boundLine("run-7c/2"),
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

describe("the only downgrade this repository's own ledgers may contain", () => {
  it("is the seven pre-attribution bound lines in orca-dev-09cc3ea1.jsonl, and nothing else", async () => {
    // verify now tolerates exit code 2 from the ledger step, which on its own
    // would let any future downgrade through in silence — a decision whose
    // undo.how is prose, say. This criterion is what keeps that tolerance
    // narrow: it names the exact set of downgraded lines the repository is
    // allowed to carry, so an eighth one is a red test rather than a warning
    // nobody reads.
    const dir = new URL("../../.decisions/", import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl")).sort();
    expect(files.length).toBeGreaterThan(0);

    const downgraded: string[] = [];
    for (const file of files) {
      const text = await readFile(new URL(file, dir), "utf8");
      const verdict = validateFile(text.split("\n"));
      for (const line of verdict.lines) {
        if (line.result.verdict === "downgraded") downgraded.push(`${file}:${line.lineNumber}`);
      }
      expect(verdict.lines.filter((l) => l.result.verdict === "rejected")).toEqual([]);
    }

    expect(downgraded).toEqual([
      "orca-dev-09cc3ea1.jsonl:8",
      "orca-dev-09cc3ea1.jsonl:9",
      "orca-dev-09cc3ea1.jsonl:10",
      "orca-dev-09cc3ea1.jsonl:11",
      "orca-dev-09cc3ea1.jsonl:12",
      "orca-dev-09cc3ea1.jsonl:13",
      "orca-dev-09cc3ea1.jsonl:14",
    ]);
  });
});
