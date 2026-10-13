import { describe, expect, it } from "vitest";
import { zh } from "../src/locales/zh.js";

/** Taste refinement P2-7: one Chinese name per thing; roles in Chinese; no half-English memory error. */
describe("zh terms (P2-7)", () => {
  it("names the roles in Chinese", () => {
    expect(zh.auth.role).toEqual({ owner: "所有者", member: "成员" });
  });
  it("calls chains 链 everywhere it is named", () => {
    expect(zh.nav.chains).toBe("链（高级）");
    expect(zh.chains.activeBanner).toBe("链 {{chainId}} 正在运行");
    expect(zh.settings.showAdvanced).toContain("链");
  });
  it("never leaves the English role words owner/member inside a zh sentence (final review M2)", () => {
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(zh);
    expect(strings.length).toBeGreaterThan(100);
    expect(strings.filter((v) => /\b(owner|member)\b/i.test(v.replace(/\{\{[^}]*\}\}/g, "").replace(/<[^>]*>/g, "")))).toEqual([]);
  });
});
