import { describe, expect, it } from "vitest";
import { validateLine } from "../../src/ledger/validateLine.js";

/** 六字段齐全的 overturned —— spec §3 的字面示例。 */
function overturned(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ev: "overturned",
    id: "run-7c/3",
    correctionId: "c_01J9X",
    replacedBy: "run-9d/2",
    at: "2026-09-05T18:04:11Z",
    run: "run-9d",
    ...over,
  });
}

describe("overturned — spec §3: six required fields, none optional", () => {
  it("accepts a complete overturned", () => {
    expect(validateLine(overturned()).verdict).toBe("ok");
  });

  // M1×6. 只追加的台账里，可选字段就是永远拿不到的字段（裁决 orca-dev-c1c3c2ec/5）。
  for (const field of ["ev", "id", "correctionId", "replacedBy", "at", "run"]) {
    it(`rejects an overturned missing ${field}`, () => {
      const parsed = JSON.parse(overturned()) as Record<string, unknown>;
      delete parsed[field];
      const result = validateLine(JSON.stringify(parsed));
      // 缺 ev 时走的是「unknown ev」那条，同样必须是 rejected，不是 downgraded。
      expect(result.verdict).toBe("rejected");
    });
  }

  // §6.1：那条降级有两道独立守卫，冗余守卫钉不住；这里钉的是【结果】不是守卫。
  it("rejects — does not downgrade — an overturned missing a required field", () => {
    const parsed = JSON.parse(overturned()) as Record<string, unknown>;
    delete parsed.correctionId;
    expect(validateLine(JSON.stringify(parsed)).verdict).toBe("rejected");
  });

  it("keeps passthrough: an extra note field does not make it invalid", () => {
    expect(validateLine(overturned({ note: "落地于本笔提交" })).verdict).toBe("ok");
  });
});
