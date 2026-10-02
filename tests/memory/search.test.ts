import { describe, expect, it } from "vitest";
import type { MemoryRecord } from "../../src/memory/adapter.js";
import { parseLimit, parseQuery, parseRef, searchRecords } from "../../src/memory/search.js";

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
