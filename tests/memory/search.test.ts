import { describe, expect, it } from "vitest";
import type { MemoryRecord } from "../../src/memory/adapter.js";
import { parseLimit, parseOffset, parseQuery, parseRef, searchRecords } from "../../src/memory/search.js";

/**
 * Spec §3.5. Search is a substring filter in Orca, not ccmem's hybrid retrieval: ccmem's `list <query>` writes to its
 * database and may call a paid embedding service (spec §3.1). The order is a fixed key, so a person sees the same list
 * twice. NFC matters because the same visible text arrives in either normalisation form (written with escapes here:
 * a file-writing tool may silently normalise a literal).
 */
const rec = (ref: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  ref, scope: "global", projectKey: null, kind: "fact", content: `content ${ref}`, tags: [], pinned: false,
  source: "user_explicit", trust: 0.5, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...over,
});

describe("searchRecords (spec §3.5)", () => {
  it("matches case-insensitively in content", () => {
    const page = searchRecords([rec("1", { content: "Use PNPM here" }), rec("2")], { query: "pnpm", limit: 50 });
    expect(page.records.map((r) => r.ref)).toEqual(["1"]);
  });

  it("matches across normalisation forms, both ways", () => {
    const composed = "caf\u00e9", decomposed = "cafe\u0301";
    expect(searchRecords([rec("1", { content: composed })], { query: decomposed, limit: 50 }).total).toBe(1);
    expect(searchRecords([rec("1", { content: decomposed })], { query: composed, limit: 50 }).total).toBe(1);
    expect(searchRecords([rec("1", { tags: [decomposed] })], { query: composed, limit: 50 }).total).toBe(1);
  });

  it("counts a record whose only match is a tag", () => {
    expect(searchRecords([rec("1", { tags: ["Deploy"] })], { query: "deploy", limit: 50 }).records.map((r) => r.ref)).toEqual(["1"]);
  });

  it("lists everything for an empty or blank query", () => {
    expect(searchRecords([rec("1"), rec("2")], { query: "  ", limit: 50 }).total).toBe(2);
  });

  it("orders pinned first, then newest update, then larger ref", () => {
    const page = searchRecords([
      rec("2", { updatedAt: "2026-09-02T00:00:00.000Z" }),
      rec("10", { updatedAt: "2026-09-02T00:00:00.000Z" }),
      rec("3", { updatedAt: "2026-09-03T00:00:00.000Z" }),
      rec("1", { pinned: true }),
    ], { query: "", limit: 50 });
    expect(page.records.map((r) => r.ref)).toEqual(["1", "3", "10", "2"]);
  });

  it("cuts at limit and says how many matched", () => {
    const page = searchRecords([rec("1"), rec("2"), rec("3")], { query: "", limit: 2 });
    expect(page).toMatchObject({ total: 3, truncated: true });
    expect(page.records).toHaveLength(2);
    expect(searchRecords([rec("1")], { query: "", limit: 2 }).truncated).toBe(false);
  });
});

describe("request parsing (spec §3.5, §5.1, Review Focus 2)", () => {
  it("takes a trimmed query of up to 200 code points", () => {
    expect(parseQuery(undefined)).toEqual({ ok: true, value: "" });
    expect(parseQuery("  x  ")).toEqual({ ok: true, value: "x" });
    expect(parseQuery("\u{1F600}".repeat(200)).ok).toBe(true); // 200 code points, 400 UTF-16 units
    expect(parseQuery("a".repeat(201)).ok).toBe(false);
  });

  it("refuses a control character and a repeated parameter", () => {
    expect(parseQuery("a\u0007b").ok).toBe(false);
    expect(parseQuery(["a", "b"]).ok).toBe(false);
  });

  it("takes a limit of 1-200, default 50, decimal digits only", () => {
    expect(parseLimit(undefined)).toEqual({ ok: true, value: 50 });
    expect(parseLimit("200")).toEqual({ ok: true, value: 200 });
    for (const bad of ["0", "201", "1.5", "1e2", "-1", "", ["1", "2"]]) expect(parseLimit(bad).ok, String(bad)).toBe(false);
  });

  it("takes a ref of 1-16 digits without a leading zero", () => {
    expect(parseRef("42")).toEqual({ ok: true, value: "42" });
    for (const bad of [undefined, "0", "042", "4a", "1".repeat(17), ["1"]]) expect(parseRef(bad).ok, String(bad)).toBe(false);
  });
});

/**
 * Tester #258 (spec 2026-11-11-tester-followup-e-design.md §10; memory tab spec, dated addition): a page starts at
 * `offset` (default 0) over the same fixed order, and says where it starts and whether more follow. `truncated` keeps
 * its meaning (not every match is in this page).
 */
describe("paging (#258)", () => {
  const five = ["1", "2", "3", "4", "5"].map((ref, i) => rec(ref, { updatedAt: `2026-09-0${5 - i}T00:00:00.000Z` }));
  it("pages through the fixed order without gaps or repeats", () => {
    const first = searchRecords(five, { query: "", limit: 2 });
    const second = searchRecords(five, { query: "", limit: 2, offset: 2 });
    const last = searchRecords(five, { query: "", limit: 2, offset: 4 });
    // mutation: ignore offset in the slice -> the second page repeats 1,2, red here
    expect([first, second, last].map((page) => page.records.map((r) => r.ref))).toEqual([["1", "2"], ["3", "4"], ["5"]]);
    // mutation: echo 0 instead of the offset -> red here
    expect([first, second, last].map((page) => page.offset)).toEqual([0, 2, 4]);
    // mutation: hasMore = truncated -> the last page (1 of 5 shown, truncated) says more follow, red here
    expect([first, second, last].map((page) => page.hasMore)).toEqual([true, true, false]);
    expect([first, second, last].map((page) => [page.total, page.truncated])).toEqual([[5, true], [5, true], [5, true]]);
  });
  it("answers an empty page past the end", () => {
    expect(searchRecords(five, { query: "", limit: 2, offset: 9 })).toMatchObject({ records: [], total: 5, offset: 9, hasMore: false, truncated: true });
  });
  it("takes an offset of 0-1000000, default 0, decimal digits only", () => {
    expect(parseOffset(undefined)).toEqual({ ok: true, value: 0 });
    expect(parseOffset("0")).toEqual({ ok: true, value: 0 });
    expect(parseOffset("150")).toEqual({ ok: true, value: 150 });
    expect(parseOffset("1000000")).toEqual({ ok: true, value: 1000000 });
    for (const bad of ["-1", "1000001", "01", "1.5", "1e2", "", " 1", ["1", "2"]]) expect(parseOffset(bad).ok, String(bad)).toBe(false);
  });
});
