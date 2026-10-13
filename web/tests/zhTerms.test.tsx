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
});
