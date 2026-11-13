import { describe, expect, it } from "vitest";
import { byModelSchema, entryTotal, reconciles } from "../../src/control/usageLedger.js";

/**
 * Raw usage detail spec 2026-11-13 §5/§8 (tester follow-up J): ccloop's byModel entries may carry optional sub-parts
 * and annotations (reasoning, cacheWrite5m, cacheWrite1h, requests, maxRequestInput). Orca must accept them in the
 * same commit that repins to the ccloop that emits them -- its schema is strict -- and they must never change the
 * total the four parts reconcile to.
 */
const base = { model: "m-1", input: 10, output: 20, cacheRead: 300, cacheWrite: 40 };
const detailed = { ...base, reasoning: 5, cacheWrite5m: 30, cacheWrite1h: 10, requests: 3, maxRequestInput: 200 };

describe("byModel with raw usage detail", () => {
  it("accepts every optional detail key and keeps the entry's total at the four parts", () => {
    const parsed = byModelSchema.parse([detailed]);
    expect(parsed[0]).toEqual(detailed);
    expect(entryTotal(parsed[0]!)).toBe(370);
    expect(reconciles(parsed, 370)).toBe(true);
  });

  it("still accepts an entry without any detail key", () => {
    expect(byModelSchema.parse([base])[0]).toEqual(base);
  });

  it("still refuses a key ccloop never sends", () => {
    expect(() => byModelSchema.parse([{ ...base, priceUsd: 1 }])).toThrow();
  });

  it("refuses a negative or fractional detail value", () => {
    expect(() => byModelSchema.parse([{ ...base, requests: -1 }])).toThrow();
    expect(() => byModelSchema.parse([{ ...base, reasoning: 1.5 }])).toThrow();
  });
});
