import { describe, expect, it } from "vitest";
import { validateLine } from "../../src/ledger/validateLine.js";

function validDecision(overrides: Record<string, unknown> = {}) {
  return {
    ev: "decision",
    id: "run-7c/3",
    at: "2026-08-29T10:04:11.482Z",
    run: "run-7c",
    question: "任务 T4 与 T7 能否并行",
    chose: "串行，T7 等 T4",
    alternatives: [
      {
        option: "并行开两个 worktree",
        why_not: "两者 targetPaths 都含 src/persistence/fileStore.ts，合并必冲突",
      },
    ],
    because: "写集相交（§5.1 判据）",
    undo: {
      how: "git branch -f int/a <ref>",
      cost: "浪费 T4 已跑的 attempt",
      blast_radius: "仅本仓库调度",
    },
    scope: "repo",
    kind: "scheduling",
    ...overrides,
  };
}

const line = (obj: unknown) => JSON.stringify(obj);

describe("validateLine — check 1: all required fields present", () => {
  it("accepts the complete decision example from spec §3.4", () => {
    expect(validateLine(line(validDecision()))).toEqual({ verdict: "ok" });
  });

  // Delete each of the 11 required fields one at a time; each must be rejected on its own.
  // Deliberately not using expect.soft in a for loop — we want one independently
  // failing assertion per field.
  for (const field of [
    "id", "at", "run", "question", "chose", "alternatives", "because", "undo", "scope", "kind",
  ]) {
    it(`rejects when ${field} is missing`, () => {
      const obj = validDecision() as Record<string, unknown>;
      delete obj[field];
      const result = validateLine(line(obj));
      expect(result.verdict).toBe("rejected");
    });
  }

  it("rejects invalid JSON without throwing", () => {
    expect(validateLine("{不是 json").verdict).toBe("rejected");
  });

  it("rejects unknown ev", () => {
    expect(validateLine(line({ ev: "note", id: "run-7c/3" })).verdict).toBe("rejected");
  });
});

describe("validateLine — check 2: alternatives is non-empty and each entry has option and why_not", () => {
  it("rejects when alternatives is an empty array (spec §3.5: not a decision)", () => {
    const result = validateLine(line(validDecision({ alternatives: [] })));
    expect(result.verdict).toBe("rejected");
  });

  it("rejects when an alternatives entry is missing why_not", () => {
    const result = validateLine(
      line(validDecision({ alternatives: [{ option: "并行开两个 worktree" }] })),
    );
    expect(result.verdict).toBe("rejected");
  });

  it("rejects when an alternatives entry's why_not is an empty string", () => {
    const result = validateLine(
      line(validDecision({ alternatives: [{ option: "并行", why_not: "" }] })),
    );
    expect(result.verdict).toBe("rejected");
  });
});

describe("validateLine — check 4: kind and scope whitelists", () => {
  for (const kind of ["dependency", "interface", "scheduling", "abandon", "criteria", "boundary"]) {
    it(`accepts whitelisted kind=${kind}`, () => {
      expect(validateLine(line(validDecision({ kind }))).verdict).toBe("ok");
    });
  }

  it("rejects kind outside the whitelist", () => {
    expect(validateLine(line(validDecision({ kind: "naming" }))).verdict).toBe("rejected");
  });

  for (const scope of ["file", "task", "repo", "cross-repo"]) {
    it(`accepts whitelisted scope=${scope}`, () => {
      expect(validateLine(line(validDecision({ scope }))).verdict).toBe("ok");
    });
  }

  it("rejects scope outside the whitelist", () => {
    expect(validateLine(line(validDecision({ scope: "global" }))).verdict).toBe("rejected");
  });

  it("rejects unknown fields on decision (matches ccloop's .strict() shape)", () => {
    expect(validateLine(line(validDecision({ confidence: 0.9 }))).verdict).toBe("rejected");
  });
});

describe("validateLine — decision /5: reference events require only ev and id", () => {
  it("accepts the bound example given verbatim in spec §3.3 (with note, and without at / run)", () => {
    const result = validateLine(line({ ev: "bound", id: "run-7c/3", note: "落地于本笔提交" }));
    expect(result).toEqual({ verdict: "ok" });
  });

  it("accepts superseded with only ev and id", () => {
    expect(validateLine(line({ ev: "superseded", id: "run-7c/3" })).verdict).toBe("ok");
  });

  it("accepts overturned with only ev and id", () => {
    expect(validateLine(line({ ev: "overturned", id: "run-7c/3" })).verdict).toBe("ok");
  });

  it("rejects a reference event missing id", () => {
    expect(validateLine(line({ ev: "bound" })).verdict).toBe("rejected");
  });
});
